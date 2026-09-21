// ---------------------------------------------------------------------------
// hooks/usePurchaseOrders.ts
//
// Real-time subscription to `purchase_orders` plus the high-level actions the
// receiving bay performs: scanning a line, incrementing received quantities,
// posting invoices, and closing POs. All mutations funnel through lib/
// functions so the transaction + audit guarantees are preserved.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getDb, getFirebaseConfigError, isFirebaseConfigured } from "@/lib/firebase";
import {
  closePurchaseOrder,
  evaluateThreeWayMatch,
  poFromSnapshot,
  receivePurchaseOrderLine,
} from "@/lib/purchaseOrders";
import type { ThreeWayMatchResult } from "@/lib/purchaseOrders";
import type { POStatus, PurchaseOrder } from "@/lib/types";

export interface ReceiveLineInput {
  poNumber: string;
  sku: string;
  quantityReceived: number;
  scannerEan?: string;
}

export interface UsePurchaseOrders {
  orders: PurchaseOrder[];
  /** Orders still accepting receiving scans (`partial` / `ordered`). */
  openOrders: PurchaseOrder[];
  loading: boolean;
  /** Error raised by the last mutation, cleared on next action. */
  actionError: Error | null;
  /** True while a receive/close mutation is in flight. */
  busy: boolean;
  /** Applies a scanner line against a PO and stock in one transaction. */
  receiveLine: (input: ReceiveLineInput) => Promise<PurchaseOrder>;
  /** Posts the invoice and closes the PO. */
  completeOrder: (poNumber: string, invoiceNumber: string) => Promise<void>;
  /** Pure helper: 3-way match report for a given PO. */
  getMatchReport: (po: PurchaseOrder) => ThreeWayMatchResult;
  /** Convenience: resolve the human status of a PO number. */
  statusOf: (poNumber: string) => POStatus | undefined;
}

/**
 * Live purchase-order board. Pass nothing to subscribe to every PO; the hook
 * also exposes the receiving actions wired for barcode scanners.
 */
export function usePurchaseOrders(maxOrders = 50): UsePurchaseOrders {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setActionError(new Error(getFirebaseConfigError() ?? "Firebase is not configured."));
      setLoading(false);
      return;
    }

    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, "purchase_orders"), orderBy("createdAt", "desc"), limit(maxOrders)),
      (snap) => {
        setOrders(snap.docs.map(poFromSnapshot));
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setActionError(err instanceof Error ? err : new Error("Purchase-order listener failed."));
      }
    );
    return unsub;
  }, [maxOrders]);

  const openOrders = useMemo(
    () => orders.filter((o) => o.status === "ordered" || o.status === "partial"),
    [orders]
  );

  const receiveLine = useCallback(
    async (input: ReceiveLineInput): Promise<PurchaseOrder> => {
      setBusy(true);
      setActionError(null);
      try {
        // Role is validated inside the lib layer; the receiving page passes
        // the current session role. Keep this hook role-agnostic.
        return await receivePurchaseOrderLine(
          {
            poNumber: input.poNumber,
            sku: input.sku,
            quantityReceived: input.quantityReceived,
            scannerEan: input.scannerEan,
          },
          "receiving_bay"
        );
      } catch (err) {
        setActionError(err instanceof Error ? err : new Error("Failed to receive line."));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const completeOrder = useCallback(async (poNumber: string, invoiceNumber: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await closePurchaseOrder(poNumber, invoiceNumber);
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error("Failed to close PO."));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const getMatchReport = useCallback((po: PurchaseOrder): ThreeWayMatchResult => evaluateThreeWayMatch(po), []);

  const statusOf = useCallback(
    (poNumber: string): POStatus | undefined => orders.find((o) => o.poNumber === poNumber)?.status,
    [orders]
  );

  return { orders, openOrders, loading, actionError, busy, receiveLine, completeOrder, getMatchReport, statusOf };
}