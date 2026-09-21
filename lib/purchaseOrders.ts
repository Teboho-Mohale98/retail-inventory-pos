// ---------------------------------------------------------------------------
// lib/purchaseOrders.ts
//
// Purchase-order lifecycle with **3-Way Matching** — the AP check that
// reconciles three documents per line:
//   1. Purchase Order  (what we ordered:  quantityExpected)
//   2. Goods Received  (physical count:   quantityReceived)
//   3. Supplier Invoice (invoiceNumber + unit price tolerance)
//
// `receivePurchaseOrderLine()` is the receiving-bay entry point. It
// atomically updates the PO, the product stock ledger, and the movement
// audit trail inside a single Firestore transaction — so a received carton
// can never update "goods received" without also updating stock.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  updateDoc,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { THREE_WAY_MATCH_TOLERANCE_PERCENT } from "./constants";
import type { POStatus, PurchaseOrder, PurchaseOrderItem } from "./types";
import { applyMovementInTransaction } from "./stockMovements";
import { pad } from "./utils";

/** Result of running 3-way matching over every line of a PO. */
export interface ThreeWayMatchResult {
  status: "matched" | "mismatch" | "pending";
  /** Per-line breakdown of the reconciliation. */
  lines: Array<{
    sku: string;
    expected: number;
    received: number;
    difference: number;
    /** True when received is inside the configured tolerance envelope. */
    matched: boolean;
  }>;
  note?: string;
}

/**
 * Creates a purchase order with a human-readable, zero-padded number like
 * `PO-2026-0001`. The sequence counter lives in `counters/po` and is
 * incremented atomically to prevent duplicate numbers under concurrency.
 */
export async function createPurchaseOrder(input: {
  vendor: string;
  items: Array<Pick<PurchaseOrderItem, "sku" | "name" | "quantityExpected" | "unitPrice" | "ean">>;
  expectedDelivery?: string;
  note?: string;
  createdBy?: string;
}): Promise<PurchaseOrder> {
  const db = getDb();

  if (input.vendor.trim().length === 0) throw new Error("Vendor name is required.");
  if (input.items.length === 0) throw new Error("A purchase order must contain at least one line item.");
  const badQty = input.items.find((it) => it.quantityExpected <= 0);
  if (badQty) throw new Error(`Line item "${badQty.sku}" has an invalid expected quantity.`);

  const poNumber = await withSequence("po", (seq) => `PO-${new Date().getFullYear()}-${pad(seq, 4)}`);

  const ref = doc(db, "purchase_orders", poNumber);
  await setDoc(ref, {
    poNumber,
    vendor: input.vendor,
    status: "ordered",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expectedDelivery: input.expectedDelivery ?? "",
    note: input.note ?? "",
    createdBy: input.createdBy ?? "",
    invoiceNumber: "",
    items: input.items.map((it) => ({
      ...it,
      quantityReceived: 0,
      name: it.name || it.sku,
    })),
  });

  const snap = await getDoc(ref);
  return poFromData(poNumber, snap.data() as DocumentData);
}

/** Maps a purchase-order document into the typed model. */
export function poFromData(id: string, data: DocumentData): PurchaseOrder {
  const createdAt = data.createdAt?.toDate?.();
  const updatedAt = data.updatedAt?.toDate?.();
  return {
    poNumber: id,
    vendor: data.vendor ?? "",
    status: (data.status as POStatus) ?? "ordered",
    invoiceNumber: data.invoiceNumber ?? "",
    expectedDelivery: data.expectedDelivery ?? "",
    note: data.note ?? "",
    createdBy: data.createdBy ?? "",
    items: Array.isArray(data.items) ? (data.items as PurchaseOrderItem[]) : [],
    createdAt: createdAt ? createdAt.toISOString() : (data.createdAt as string) ?? "",
    updatedAt: updatedAt ? updatedAt.toISOString() : (data.updatedAt as string) ?? "",
  } as PurchaseOrder;
}

/** Snapshot adapter for purchase orders. */
export function poFromSnapshot(snap: QueryDocumentSnapshot): PurchaseOrder {
  return poFromData(snap.id, snap.data());
}

/** Fetches the most recent PO documents, newest first. */
export async function listPurchaseOrders(max = 100): Promise<PurchaseOrder[]> {
  const db = getDb();
  const snap = await getDocs(query(collection(db, "purchase_orders"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map(poFromSnapshot);
}

/** Fetches a single purchase order by number. */
export async function getPurchaseOrder(poNumber: string): Promise<PurchaseOrder | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, "purchase_orders", poNumber));
  return snap.exists() ? poFromSnapshot(snap) : null;
}

/**
 * Derives the overall PO status from its line items:
 * - every line fully received -> `received`
 * - some lines received        -> `partial`
 * - nothing received yet       -> `ordered`
 */
export function computePOStatus(items: PurchaseOrderItem[]): POStatus {
  if (items.length === 0) return "ordered";
  const allReceived = items.every((it) => it.quantityReceived >= it.quantityExpected);
  const anyProgress = items.some((it) => it.quantityReceived > 0);
  if (allReceived) return "received";
  if (anyProgress) return "partial";
  return "ordered";
}

/**
 * Adds a received quantity for one PO line and instantly reflects it in the
 * product stock + movement audit trail — all inside a single transaction.
 *
 * The `sku` OR the scanner-captured `ean` must match a line on the PO.
 *
 * @throws when over-receiving, the PO is cancelled, or the line is unknown.
 */
export async function receivePurchaseOrderLine(
  input: {
    poNumber: string;
    sku: string;
    quantityReceived: number;
    userId?: string;
    locationId?: string;
    /** When provided, 3-way match is evaluated against the invoice. */
    invoiceNumber?: string;
    scannerEan?: string;
  },
  role: "admin" | "receiving_bay"
): Promise<PurchaseOrder> {
  const qty = Math.max(0, Math.round(input.quantityReceived));
  if (qty <= 0) throw new Error("Received quantity must be greater than zero.");

  const db = getDb();
  const poRef = doc(db, "purchase_orders", input.poNumber);
  const movementRef = doc(collection(db, "stock_movements"));

  await runTransaction(db, async (tx) => {
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error(`Purchase order "${input.poNumber}" does not exist.`);

    const po = poFromData(input.poNumber, poSnap.data() as DocumentData);
    if (po.status === "cancelled") throw new Error("Cannot receive goods on a cancelled purchase order.");

    const itemIndex = po.items.findIndex(
      (it) => it.sku === input.sku || (input.scannerEan && it.ean === input.scannerEan)
    );
    if (itemIndex === -1) {
      throw new Error(`SKU "${input.sku}" is not on purchase order "${input.poNumber}".`);
    }

    const item = po.items[itemIndex];
    const newReceived = item.quantityReceived + qty;
    if (newReceived > item.quantityExpected) {
      throw new Error(
        `Over-receipt blocked: "${item.name ?? item.sku}" expected ${item.quantityExpected}, ` +
          `already received ${item.quantityReceived}, scanning ${qty} more would exceed the order.`
      );
    }

    const items = po.items.map((it) =>
      it.sku === item.sku ? { ...it, quantityReceived: newReceived } : it
    );
    const status = computePOStatus(items);

    tx.update(poRef, {
      items,
      status,
      updatedAt: serverTimestamp(),
      invoiceNumber: input.invoiceNumber ?? po.invoiceNumber ?? "",
    });

    // Stock ledger + audit trail, in the SAME transaction as the PO update.
    await applyMovementInTransaction(tx, movementRef, {
      type: "INBOUND",
      sku: item.sku,
      quantity: qty,
      referenceId: input.poNumber,
      userId: input.userId,
      locationId: input.locationId,
      ean: input.scannerEan,
      reason: `Received against ${input.poNumber}`,
    });
  });

  return (await getPurchaseOrder(input.poNumber))!;
}

/**
 * Evaluates 3-Way Matching for a PO: lines compare expected vs received; the
 * overall status becomes `matched` when ALL lines are inside tolerance AND an
 * invoice was posted. Pure function — safe for SSR and unit tests.
 */
export function evaluateThreeWayMatch(po: PurchaseOrder): ThreeWayMatchResult {
  const lines = po.items.map((it) => {
    const difference = it.quantityReceived - it.quantityExpected;
    const tolerance = Math.round((it.quantityExpected * THREE_WAY_MATCH_TOLERANCE_PERCENT) / 100);
    const matched = difference >= -tolerance && difference <= tolerance;
    return { sku: it.sku, expected: it.quantityExpected, received: it.quantityReceived, difference, matched };
  });

  const allWithinTolerance = lines.every((l) => l.matched);
  const fullyReceived = po.status === "received";

  let status: ThreeWayMatchResult["status"] = "pending";
  let note: string | undefined;
  if (!fullyReceived) {
    status = "pending";
    note = "Waiting for full receipt before matching.";
  } else if (!po.invoiceNumber) {
    status = "mismatch";
    note = "Invoice number missing — cannot complete 3-way matching.";
  } else if (allWithinTolerance) {
    status = "matched";
  } else {
    status = "mismatch";
    note = "One or more lines fall outside the configured tolerance window.";
  }

  return { status, lines, note };
}

/** Closes a purchase order, posting the supplier invoice reference. */
export async function closePurchaseOrder(poNumber: string, invoiceNumber: string): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, "purchase_orders", poNumber), {
    invoiceNumber,
    status: "received",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Atomic sequence generator used for PO numbers. Callers never observe
 * duplicate sequences even when multiple operators create orders at once.
 */
async function withSequence(counterName: string, formatter: (seq: number) => string): Promise<string> {
  const db = getDb();
  const ref = doc(db, "counters", counterName);

  let value = "";
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = ((snap.exists() ? snap.data()?.count : 0) ?? 0) + 1;
    tx.set(ref, { count: next }, { merge: true });
    value = formatter(next);
  });

  return value;
}