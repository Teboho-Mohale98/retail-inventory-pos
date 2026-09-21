// ---------------------------------------------------------------------------
// lib/stockMovements.ts
//
// The audit-lockbox of the application. EVERY stock change (POS checkout,
// receiving bay inbound, shrink/loss adjustment) funnels through
// `recordMovement()`, which updates `products/{sku}.totalStock` inside a
// Firestore transaction and appends an immutable `stock_movements/{id}` row.
//
// The movement collection is the source of truth for the analytics dashboard
// (activity stream, top movers, demand forecasting).
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { clampQuantity } from "./utils";
import type { DailyDemand, Product, StockMovement, StockMovementType } from "./types";

export interface RecordMovementInput {
  type: StockMovementType;
  sku: string;
  quantity: number;
  /** PO number (INBOUND), receipt/picking id (OUTBOUND) or count-session id (ADJUSTMENT). */
  referenceId?: string;
  userId?: string;
  /** Shelf/bin where the movement occurred. */
  locationId?: string;
  /** Free text for ADJUSTMENT reasons: "shrinkage", "damage", "lost in transit"... */
  reason?: string;
  /** Scanner-captured EAN at time of movement. */
  ean?: string;
}

/** Error thrown when a movement would push stock below zero. */
export class InsufficientStockError extends Error {
  constructor(sku: string, requested: number, available: number) {
    super(`Insufficient stock for SKU "${sku}": requested ${requested}, available ${available}.`);
    this.name = "InsufficientStockError";
  }
}

/** Error thrown when the referenced SKU does not exist. */
export class UnknownProductError extends Error {
  constructor(sku: string) {
    super(`No product found for SKU "${sku}". Verify the barcode before proceeding.`);
    this.name = "UnknownProductError";
  }
}

function movementFromData(id: string, data: Record<string, unknown>): StockMovement {
  const rawTimestamp = data.timestamp as { toDate?: () => Date } | null;
  const timestamp = rawTimestamp?.toDate?.();
  return {
    ...(data as unknown as StockMovement),
    id,
    timestamp: timestamp ? timestamp.toISOString() : (data.timestamp as string) ?? "",
  } as StockMovement;
}

/** Adapts a Firestore snapshot into a typed StockMovement. */
export function movementFromSnapshot(snap: QueryDocumentSnapshot): StockMovement {
  return movementFromData(snap.id, snap.data());
}

// ---------------------------------------------------------------------------
// recordMovement — THE single write path for stock
// ---------------------------------------------------------------------------

/**
 * Transaction-scoped stock writer. Applies a movement's effect to the product
 * document and appends the audit row WITHOUT running its own transaction.
 * Exposed so composite flows (e.g. PO receiving) can include movements inside
 * an already-open transaction.
 *
 * @throws InsufficientStockError | UnknownProductError
 */
export async function applyMovementInTransaction(
  tx: Transaction,
  movementRef: DocumentReference,
  input: RecordMovementInput
): Promise<void> {
  const qty = clampQuantity(input.quantity);
  if (qty <= 0) throw new Error("Movement quantity must be a positive integer.");

  const productRef = doc(getDb(), "products", input.sku);
  const productSnap = await tx.get(productRef);
  if (!productSnap.exists()) {
    throw new UnknownProductError(input.sku);
  }
  const product = productSnap.data() as Product;

  // OUTBOUND consumes stock; INBOUND / ADJUSTMENT adds stock.
  const delta = input.type === "OUTBOUND" ? -qty : qty;
  const newTotal = (product.totalStock ?? 0) + delta;

  if (newTotal < 0) {
    throw new InsufficientStockError(input.sku, qty, product.totalStock ?? 0);
  }

  const stockByLocation = { ...(product.stockByLocation ?? {}) };
  if (input.locationId) {
    const current = stockByLocation[input.locationId] ?? 0;
    const next = current + delta;
    stockByLocation[input.locationId] = next > 0 ? next : 0;
  }

  tx.update(productRef, {
    totalStock: newTotal,
    stockByLocation,
    lastUpdated: serverTimestamp(),
    lastMovementType: input.type,
  });

  tx.set(movementRef, {
    timestamp: serverTimestamp(),
    type: input.type,
    sku: input.sku,
    quantity: qty,
    referenceId: input.referenceId ?? "",
    userId: input.userId ?? "",
    locationId: input.locationId ?? "",
    reason: input.reason ?? "",
    ean: input.ean ?? "",
  });
}

/**
 * Atomically applies a stock movement:
 * 1. Reads the product (fails fast for unknown SKUs / missing barcodes).
 * 2. Rejects movements that would make stock negative (offline-safe guard).
 * 3. Writes the new total + per-location counts.
 * 4. Appends the immutable movement document for the audit trail.
 *
 * All steps run in ONE Firestore transaction, so two POS terminals scanning
 * the same product concurrently can never corrupt the count.
 *
 * @throws InsufficientStockError | UnknownProductError
 */
export async function recordMovement(input: RecordMovementInput): Promise<StockMovement> {
  const db = getDb();
  const movementRef = doc(collection(db, "stock_movements"));

  let committed: StockMovement | null = null;

  await runTransaction(db, async (tx) => {
    await applyMovementInTransaction(tx, movementRef, input);
    committed = {
      id: movementRef.id,
      timestamp: new Date().toISOString(),
      type: input.type,
      sku: input.sku,
      quantity: clampQuantity(input.quantity),
      referenceId: input.referenceId,
      userId: input.userId,
      locationId: input.locationId,
      reason: input.reason,
      ean: input.ean,
    };
  });

  return committed!;
}

/** Plain adjustment for shrinkage/loss/damage. Positive quantity adds stock. */
export async function recordAdjustment(input: Omit<RecordMovementInput, "type"> & { reason: string }): Promise<StockMovement> {
  return recordMovement({ ...input, type: "ADJUSTMENT" });
}

// ---------------------------------------------------------------------------
// Reads / analytics aggregation
// ---------------------------------------------------------------------------

/** Fetches the `n` most recent movements across all SKUs (dashboard stream). */
export async function fetchRecentMovements(n = 50): Promise<StockMovement[]> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, "stock_movements"), orderBy("timestamp", "desc"), limit(n))
  );
  return snap.docs.map(movementFromSnapshot);
}

/** Fetches recent OUTBOUND movements for one product (demand history). */
export async function fetchSkuSales(sku: string, since: Date = new Date(Date.now() - 30 * 86_400_000)): Promise<StockMovement[]> {
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, "stock_movements"), where("sku", "==", sku), where("type", "==", "OUTBOUND"))
  );
  return snap.docs
    .map(movementFromSnapshot)
    .filter((m) => new Date(m.timestamp).getTime() >= since.getTime());
}

/**
 * Compresses a movement list into a per-day sold-quantity histogram used by
 * the forecasting engine. Non-sale days are omitted (driver: sparse stores).
 */
export function collectDailyDemand(movements: StockMovement[]): DailyDemand[] {
  const byDay = new Map<string, number>();
  for (const m of movements) {
    if (m.type !== "OUTBOUND") continue;
    const day = new Intl.DateTimeFormat("en-CA").format(new Date(m.timestamp)); // YYYY-MM-DD
    byDay.set(day, (byDay.get(day) ?? 0) + m.quantity);
  }
  return [...byDay.entries()]
    .map(([date, quantity]) => ({ date, quantity }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Convenience wrapper producing a movement doc id for tests/analytics. */
export async function createMovementPlaceholder(prefix: string, tick: number): Promise<string> {
  const db = getDb();
  const ref = await addDoc(collection(db, "stock_movements"), {
    prefix,
    tick,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}