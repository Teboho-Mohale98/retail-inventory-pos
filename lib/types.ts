// ---------------------------------------------------------------------------
// lib/types.ts
//
// Centralized TypeScript domain model for the entire Retail Inventory & POS
// application. Every entity mirrors the Firestore collection/document schema
// documented in the project README.
//
// Naming rule: *Data interfaces are the "raw" Firestore document shape, while
// `withId` variants add the human readable identifier used by the UI.
// ---------------------------------------------------------------------------

// ------------------------------- Users -------------------------------------

/** Access roles enforced across the application. */
export type UserRole = "admin" | "store_picker" | "receiving_bay";

export interface UserProfile {
  /** Firebase Auth UID — matches `users/{uid}` document id. */
  uid: string;
  /** Display name shown in the app shell. */
  displayName: string;
  email: string;
  role: UserRole;
  /** Default store location slug this user operates from. */
  defaultLocationId?: string;
  active: boolean;
  createdAt: number;
}

// ------------------------------- Products ----------------------------------

/** Lightweight definition of a stock-holding shelf/bin at a store. */
export interface InventoryLocation {
  id: string;
  name: string;
  /** Human readable shelf code, e.g. "A-01-02". */
  shelf: string;
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface Product {
  /** Unique SKU (Stock Keeping Unit) — primary key. */
  sku: string;
  /** Tracks the canonical stock count across all retail locations. */
  totalStock: number;
  /**
   * Per-location stock breakdown. The sum of all location quantities MUST
   * equal `totalStock`. Key is the location id, value is the quantity held.
   */
  stockByLocation: Record<string, number>;
  ean: string;
  name: string;
  category: string;
  brand?: string;
  /** Retail (selling) price in minor currency units, e.g. cents. */
  price: number;
  /** Cost price (what we paid the supplier) in minor currency units. */
  costPrice: number;
  /** Reorder trigger — when totalStock drops below this, alert fires. */
  minStockThreshold: number;
  /** Container/unit the product ships in (e.g. "each", "box of 12"). */
  unit: string;
  /** Optional: fixed shelf for always-stocked goods. */
  defaultShelf?: string;
  /** Optional: public barcode image URL. */
  imageUrl?: string;
  /** Movement type that produced the last stock change. */
  lastMovementType?: StockMovementType;
  /** ISO date string of the last stock mutation. */
  lastUpdated: string;
  createdAt: string;
}

// ---------------------------- Purchase Orders ------------------------------

export const PO_STATUSES = ["draft", "ordered", "partial", "received", "cancelled"] as const;
export type POStatus = (typeof PO_STATUSES)[number];

export interface PurchaseOrderItem {
  sku: string;
  name: string;
  /** Quantity ordered from the supplier. */
  quantityExpected: number;
  /** Quantity physically received to date (incremented at the bay). */
  quantityReceived: number;
  unitPrice: number;
  /** EAN of the received carton/unit for scanner-based receiving. */
  ean?: string;
}

export interface PurchaseOrder {
  poNumber: string;
  vendor: string;
  status: POStatus;
  createdAt: string;
  /** ISO timestamp of the last inbound receiving event. */
  updatedAt: string;
  items: PurchaseOrderItem[];
  /** Supplier invoice reference used for 3-way matching. */
  invoiceNumber?: string;
  /** Expected delivery date (ISO). */
  expectedDelivery?: string;
  /** Note visible to the receiving bay team. */
  note?: string;
  /** UID of the user who created the PO. */
  createdBy?: string;
}

// --------------------------- Stock Movements -------------------------------

export const STOCK_MOVEMENT_TYPES = ["INBOUND", "OUTBOUND", "ADJUSTMENT"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: string;
  timestamp: string;
  type: StockMovementType;
  sku: string;
  /** Positive number for in/out quantities. Sign is derived from `type`. */
  quantity: number;
  /**
   * Business reference document:
   * - INBOUND   -> purchase order number
   * - OUTBOUND  -> POS receipt / picking list id
   * - ADJUSTMENT -> inventory count session id
   */
  referenceId?: string;
  userId?: string;
  /** Location (shelf/bin) where the movement happened. */
  locationId?: string;
  /** Optional free-text reason (losses, damage, shrinkage). */
  reason?: string;
  /** Optional EAN captured from a scanner at time of movement. */
  ean?: string;
}

// ------------------------------ Analytics ----------------------------------

export interface DailyDemand {
  date: string;
  quantity: number;
}

export interface ForecastResult {
  /** Product this forecast applies to. */
  sku: string;
  /** Average units sold per day over the look-back window. */
  dailyDemand: number;
  /** Projected units for the next `horizonDays`. */
  projectedDemand: number;
  /** Safety stock required to cover lead-time variance. */
  safetyStock: number;
  /** Recommended reorder point = (dailyDemand * leadTimeDays) + safetyStock. */
  reorderPoint: number;
  /** Units to order to return to the target cover. */
  suggestedOrderQty: number;
}

// -------------------------------- Views ------------------------------------

/** Aggregated dashboard metrics computed from product + movements streams. */
export interface DashboardMetrics {
  totalSKUs: number;
  /** Inventory on hand valued at retail price. */
  retailValue: number;
  /** Inventory on hand valued at cost price. */
  costValue: number;
  /** Potential profit if everything sold at retail. */
  grossProfit: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Sum of all quantities captured today. */
  movementsToday: number;
  topSelling: Array<Product & { movedQty: number }>;
  /** Live stream of movements, newest first. */
  recentMovements: StockMovement[];
}

/** Stock health summary attached to each product row in table views. */
export interface StockHealth {
  status: StockStatus;
  /** Days-of-cover given the current run-rate. */
  daysOfCover: number | null;
  forecast: ForecastResult | null;
}