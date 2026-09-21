// ---------------------------------------------------------------------------
// hooks/useStockMovements.ts
//
// Real-time audit stream + mutation hook. Consumed by the Dashboard (activity
// feed, metrics) and by inventory "adjust stock" dialogs (loss/damage/
// shrinkage). Read heavy, one write path.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  collectDailyDemand,
  movementFromSnapshot,
  recordAdjustment,
  recordMovement,
  type RecordMovementInput,
} from "@/lib/stockMovements";
import type { DailyDemand, StockMovement } from "@/lib/types";

export interface UseStockMovements {
  movements: StockMovement[];
  dailyDemand: DailyDemand[];
  loading: boolean;
  error: Error | null;
  /** Generic movement writer (INBOUND/OUTBOUND/ADJUSTMENT). */
  record: (input: RecordMovementInput) => Promise<StockMovement>;
  /** Convenience for shrink/loss/damage corrections. */
  adjust: (input: { sku: string; quantity: number; reason: string; userId?: string; locationId?: string }) => Promise<StockMovement>;
  busy: boolean;
}

/**
 * Subscribe to the most recent `stock_movements` and expose the mutation
 * helpers. Use `limit` on N to bound dashboard memory usage.
 */
export function useStockMovements(maxMovements = 200): UseStockMovements {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, "stock_movements"), orderBy("timestamp", "desc"), limit(maxMovements)),
      (snap) => {
        setMovements(snap.docs.map(movementFromSnapshot));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setLoading(false);
        setError(err instanceof Error ? err : new Error("Movement listener failed."));
      }
    );
    return unsub;
  }, [maxMovements]);

  const record = useCallback(async (input: RecordMovementInput) => {
    setBusy(true);
    setError(null);
    try {
      return await recordMovement(input);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Record failed."));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const adjust = useCallback(
    async (input: { sku: string; quantity: number; reason: string; userId?: string; locationId?: string }) => {
      setBusy(true);
      setError(null);
      try {
        return await recordAdjustment({
          sku: input.sku,
          quantity: input.quantity,
          reason: input.reason,
          userId: input.userId,
          locationId: input.locationId,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Adjustment failed."));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return { movements, dailyDemand: collectDailyDemand(movements), loading, error, record, adjust, busy };
}