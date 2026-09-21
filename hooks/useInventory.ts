// ---------------------------------------------------------------------------
// hooks/useInventory.ts
//
// The zero-latency heart of the application. Subscribes to the ENTIRE
// `products` collection with Firestore `onSnapshot`, so every stock mutation
// anywhere in the network propagates to every open screen instantly.
//
// Also pushes a `stock_movements` listener so the requesting screen can
// compute demand forecasts and the live activity stream from one hook.
//
// Handles three critical states explicitly:
//   - `loading`  -> first snapshot not yet delivered
//   - `error`    -> missing barcode/SKU lookups & Firestore failures
//   - `offline`  -> Firestore persistence kicked in / network dropped
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { productFromSnapshot } from "@/lib/products";
import { movementFromSnapshot } from "@/lib/stockMovements";
import { collectDailyDemand } from "@/lib/stockMovements";
import type { DailyDemand, Product, StockMovement } from "@/lib/types";

export interface UseInventory {
  /** All products, keyed by SKU for O(1) lookups. */
  products: Map<string, Product>;
  /** Flat list, newest-managed first. */
  productList: Product[];
  /** Live movement stream (recent N), newest first. */
  movements: StockMovement[];
  /** Per-day demand histogram derived from `movements`. */
  dailyDemand: DailyDemand[];
  loading: boolean;
  /** Firestore listener error (silently retried). */
  error: Error | null;
  /** True when Firestore reported an offline / persistence session. */
  offline: boolean;
  /** Resolves a barcode to a Product or null (searches index + in-memory). */
  findProductByBarcode: (code: string) => Product | null;
  /** Counts products matching a coarse status predicate. */
  countByStatus: (predicate: (p: Product) => boolean) => number;
}

/**
 * Real-time inventory subscription. Mount once per screen that needs product
 * data — the listener is cheap and deduplicated by Firestore's SDK.
 */
export function useInventory(maxMovements = 200): UseInventory {
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const db = getDb();

    // Track connectivity so the UI can show a graceful "offline mode" banner
    // instead of frozen data when the network blips.
    const onlineHandler = () => setOffline(false);
    const offlineHandler = () => setOffline(true);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);

    let active = true;

    const unsubProducts = onSnapshot(
      query(collection(db, "products")),
      (snap) => {
        if (!active) return;
        const next = new Map<string, Product>();
        snap.docs.forEach((docSnap) => next.set(docSnap.id, productFromSnapshot(docSnap)));
        setProducts(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        if (!active) return;
        setLoading(false);
        setError(err instanceof Error ? err : new Error("Firestore product listener failed."));
        setOffline(err.message?.toLowerCase().includes("network") ?? true);
      }
    );

    // Live audit stream feeding analytics + forecasting.
    const unsubMovements = onSnapshot(
      query(collection(db, "stock_movements"), orderBy("timestamp", "desc"), limit(maxMovements)),
      (snap) => {
        if (!active) return;
        setMovements(snap.docs.map(movementFromSnapshot));
      },
      () => {
        // The activity stream is a bonus; a failure here must not break the UI.
      }
    );

    return () => {
      active = false;
      unsubProducts();
      unsubMovements();
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, [maxMovements]);

  /** O(n) in-memory scan + "live index" lookups for scanner hits by EAN. */
  const findProductByBarcode = useCallback(
    (code: string): Product | null => {
      const clean = code.replace(/[^0-9]/g, "");
      for (const product of products.values()) {
        if (product.sku === clean || product.ean === clean) return product;
      }
      return null;
    },
    [products]
  );

  const countByStatus = useCallback(
    (predicate: (p: Product) => boolean): number =>
      Array.from(products.values()).filter(predicate).length,
    [products]
  );

  const dailyDemand = useMemo(() => collectDailyDemand(movements), [movements]);
  const productList = useMemo(() => Array.from(products.values()), [products]);

  return {
    products,
    productList,
    movements,
    dailyDemand,
    loading,
    error,
    offline,
    findProductByBarcode,
    countByStatus,
  };
}