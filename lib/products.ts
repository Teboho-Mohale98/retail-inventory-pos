// ---------------------------------------------------------------------------
// lib/products.ts
//
// Firestore data-access for the `products/{sku}` collection: create, read,
// update, delete, and stock-health evaluation.
//
// Design rule: `products/{sku}.totalStock` is AUTHORITATIVE. Every mutation
// goes through `recordMovement()` in stockMovements.ts which updates stock
// inside a Firestore transaction so concurrent POS / Receiving-Bay sessions
// cannot corrupt counts.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { clampQuantity, createEAN13, generateEAN13, generateSKU } from "./utils";
import { computeForecast } from "./forecasting";
import { DEMAND_LOOKBACK_DAYS } from "./constants";
import type { DailyDemand, Product, StockHealth, StockStatus } from "./types";

/** Shape accepted when creating a product. Stock/sku/ean are optional at creation. */
export type ProductInput = Pick<Product, "name" | "price" | "costPrice" | "minStockThreshold"> &
  Partial<
    Pick<
      Product,
      | "sku"
      | "ean"
      | "category"
      | "brand"
      | "unit"
      | "defaultShelf"
      | "imageUrl"
      | "totalStock"
      | "stockByLocation"
    >
  >;

/** Converts a Firestore document id + data into a plain `Product` object. */
export function productFromData(id: string, data: DocumentData): Product {
  const lastUpdated = data.lastUpdated?.toDate?.();
  const createdAt = data.createdAt?.toDate?.();
  return {
    sku: id,
    ...(data as unknown as Partial<Product>),
    lastUpdated: lastUpdated ? lastUpdated.toISOString() : (data.lastUpdated as string) ?? "",
    createdAt: createdAt ? createdAt.toISOString() : (data.createdAt as string) ?? "",
    price: Number(data.price ?? 0),
    costPrice: Number(data.costPrice ?? 0),
    totalStock: Number(data.totalStock ?? 0),
    minStockThreshold: Number(data.minStockThreshold ?? 0),
  } as Product;
}

/** Snapshot -> Product adapter used by listeners and reads. */
export function productFromSnapshot(snap: QueryDocumentSnapshot): Product {
  return productFromData(snap.id, snap.data());
}

/**
 * Creates a new product with an auto-generated SKU + EAN when the caller
 * does not supply one. Uses a Firestore write batch so the product document
 * and its opening stock movement are committed atomically.
 *
 * @throws when the SKU (or generated one) already exists.
 */
export async function createProduct(input: ProductInput): Promise<Product> {
  const db = getDb();
  const sku = input.sku?.trim() || generateSKU(input.category || "GEN");
  const ean =
    input.ean?.trim() ||
    createEAN13(`${Math.floor(1_000_000_000_000 + Math.random() * 8_999_999_999_999)}`.slice(0, 12)) ||
    generateEAN13();

  const ref = doc(db, "products", sku);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error(`A product with SKU "${sku}" already exists.`);
  }

  const initialQty = clampQuantity(input.totalStock ?? 0);

  const batch = writeBatch(db);
  batch.set(ref, {
    sku,
    ean,
    name: input.name,
    category: input.category ?? "General",
    brand: input.brand ?? "",
    unit: input.unit ?? "each",
    defaultShelf: input.defaultShelf ?? "",
    price: Number(input.price ?? 0),
    costPrice: Number(input.costPrice ?? 0),
    minStockThreshold: Number(input.minStockThreshold ?? 5),
    imageUrl: input.imageUrl ?? "",
    totalStock: initialQty,
    stockByLocation: input.stockByLocation ?? {},
    lastUpdated: serverTimestamp(),
    createdAt: serverTimestamp(),
    lastMovementType: initialQty > 0 ? "ADJUSTMENT" : undefined,
  });

  if (initialQty > 0) {
    // Seed the opening balance so the audit trail has a first entry.
    batch.set(doc(db, "stock_movements", `opening-${sku}`), {
      timestamp: serverTimestamp(),
      type: "ADJUSTMENT",
      sku,
      quantity: initialQty,
      referenceId: `opening-${sku}`,
      reason: "Opening balance",
    });
  }

  await batch.commit();
  const fresh = await getDoc(ref);
  if (!fresh.exists()) throw new Error("Failed to create product — write was not persisted.");
  return productFromData(fresh.id, fresh.data());
}

/** Fetches a single product by its SKU document id. */
export async function getProduct(sku: string): Promise<Product | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, "products", sku));
  return snap.exists() ? productFromSnapshot(snap) : null;
}

/** Reverse lookup: finds a product by its EAN barcode (indexed query). */
export async function getProductByEAN(ean: string): Promise<Product | null> {
  const db = getDb();
  const snap = await getDocs(query(collection(db, "products"), where("ean", "==", ean), limit(1)));
  if (snap.empty) return null;
  return productFromSnapshot(snap.docs[0]);
}

/** Applies a partial patch (non-stock fields) to a product document. */
export async function updateProduct(sku: string, patch: Partial<Product>): Promise<void> {
  const db = getDb();
  const ref = doc(db, "products", sku);

  // Strip stock fields from a plain metadata patch — stock must be changed
  // through `recordMovement()` to keep the audit trail intact.
  const { totalStock, stockByLocation, ...metadata } = patch;

  const payload: Record<string, unknown> = { ...metadata, lastUpdated: serverTimestamp() };
  delete payload.lastMovementType;
  await updateDoc(ref, payload);

  // Re-read to throw clearly when the document does not exist.
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Product "${sku}" no longer exists.`);
}

/** Deletes a product and all of its per-location stock breakdown data. */
export async function deleteProduct(sku: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, "products", sku));
}

/** True when the product is due for a reorder given the current threshold. */
export function isLowStock(product: Product): boolean {
  return product.totalStock <= product.minStockThreshold && product.totalStock > 0;
}

/** True when the product is exhausted. */
export function isOutOfStock(product: Product): boolean {
  return product.totalStock <= 0;
}

/** Resolves the coarse stock status enum for a product. */
export function stockStatusOf(product: Product): StockStatus {
  if (isOutOfStock(product)) return "out_of_stock";
  if (isLowStock(product)) return "low_stock";
  return "in_stock";
}

/**
 * Computes StockHealth for a product: its status + a demand forecast built
 * from the `stock_movements` audit trail. Falls back to a threshold-only
 * result when there is no demand history yet.
 */
export async function evaluateStockHealth(
  product: Product,
  recentMovements: DailyDemand[]
): Promise<StockHealth> {
  const status = stockStatusOf(product);

  // Build daily-demand histogram from the provided look-back series.
  const daily = recentMovements.reduce<Record<string, number>>((acc, d) => {
    acc[d.date] = (acc[d.date] ?? 0) + d.quantity;
    return acc;
  }, {});

  const forecast = computeForecast(product.sku, daily, {
    lookbackStart: Date.now() - DEMAND_LOOKBACK_DAYS * 86_400_000,
    currentStock: product.totalStock,
  });

  return {
    status,
    forecast,
    daysOfCover:
      forecast && forecast.dailyDemand > 0 ? product.totalStock / forecast.dailyDemand : product.totalStock > 0 ? null : 0,
  };
}