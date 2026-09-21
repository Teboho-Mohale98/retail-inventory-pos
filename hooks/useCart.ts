// ---------------------------------------------------------------------------
// hooks/useCart.ts
//
// Point-of-Sale cart state: scanner-driven line items, live totals and the
// guarded checkout pipeline. Checkout:
//   1. Validates every line against on-hand stock.
//   2. Writes the `receipts/{id}` document (POS record).
//   3. Fires one OUTBOUND movement per line (deducting stock atomically).
//
// The cart is intentionally NOT persisted — a refresh mid-transaction is safe
// because stock is only deducted once the receipt commits.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useMemo, useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { recordMovement } from "@/lib/stockMovements";
import type { Product } from "@/lib/types";

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface CheckoutResult {
  receiptId: string;
  totalCents: number;
  itemCount: number;
}

export interface UseCart {
  lines: CartLine[];
  /** Subtotal in cents. */
  subtotalCents: number;
  itemCount: number;
  /** Adds (or increments) a product in the cart by EAN/SKU scan or tap. */
  add: (product: Product, quantity?: number) => void;
  /** Decrements a line. Removes it entirely when quantity reaches zero. */
  remove: (sku: string) => void;
  setQuantity: (sku: string, quantity: number) => void;
  clear: () => void;
  busy: boolean;
  lastError: Error | null;
  /**
   * Commits the sale. Throws with a descriptive message on insufficient stock
   * or network failure so the POS screen can show a retry-friendly alert.
   */
  checkout: (userId?: string, locationId?: string) => Promise<CheckoutResult>;
}

export function useCart(): UseCart {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  const upsert = useCallback((product: Product, amount: number) => {
    setLastError(null);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product.sku === product.sku);
      if (idx === -1) {
        return [...prev, { product, quantity: Math.max(amount, 1) }];
      }
      const next = [...prev];
      const qty = next[idx].quantity + amount;
      if (qty <= 0) return next.filter((l) => l.product.sku !== product.sku);
      next[idx] = { ...next[idx], quantity: qty };
      return next;
    });
  }, []);

  const add = useCallback(
    (product: Product, quantity = 1) => upsert(product, quantity),
    [upsert]
  );

  const remove = useCallback((sku: string) => {
    setLines((prev) => prev.filter((l) => l.product.sku !== sku));
  }, []);

  const setQuantity = useCallback((sku: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.sku !== sku)
        : prev.map((l) => (l.product.sku === sku ? { ...l, quantity } : l))
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setLastError(null);
  }, []);

  const { subtotalCents, itemCount } = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const line of lines) {
      total += line.product.price * line.quantity;
      count += line.quantity;
    }
    return { subtotalCents: total, itemCount: count };
  }, [lines]);

  const checkout = useCallback(
    async (userId?: string, locationId?: string): Promise<CheckoutResult> => {
      if (lines.length === 0) throw new Error("Cart is empty — nothing to checkout.");
      setBusy(true);
      setLastError(null);

      try {
        const db = getDb();

        // 1. Pre-flight check: catch insufficient stock BEFORE writing anything.
        for (const line of lines) {
          const available = line.product.totalStock;
          if (available < line.quantity) {
            throw new Error(
              `Insufficient stock for "${line.product.name}" (${line.product.sku}): ` +
                `${line.quantity} requested but only ${available} on hand.`
            );
          }
        }

        // 2. Create the receipt document.
        const receiptRef = await addDoc(collection(db, "receipts"), {
          createdAt: serverTimestamp(),
          items: lines.map((l) => ({
            sku: l.product.sku,
            name: l.product.name,
            ean: l.product.ean,
            priceCents: l.product.price,
            quantity: l.quantity,
            lineTotalCents: l.product.price * l.quantity,
          })),
          subtotalCents,
          userId: userId ?? "",
          locationId: locationId ?? "",
          status: "paid",
        });

        // 3. Deduct stock, one transactional movement per line. The receipt is
        //    already persisted, so a mid-batch network failure leaves audit
        //    evidence the operator can reconcile from the dashboard.
        for (const line of lines) {
          await recordMovement({
            type: "OUTBOUND",
            sku: line.product.sku,
            quantity: line.quantity,
            referenceId: receiptRef.id,
            userId: userId ?? "",
            locationId: locationId ?? "",
            ean: line.product.ean,
            reason: "POS sale",
          });
        }

        setLines([]);
        return { receiptId: receiptRef.id, totalCents: subtotalCents, itemCount };
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error("Checkout failed unexpectedly.");
        setLastError(normalized);
        throw normalized;
      } finally {
        setBusy(false);
      }
    },
    [lines, subtotalCents]
  );

  return { lines, subtotalCents, itemCount, add, remove, setQuantity, clear, busy, lastError, checkout };
}