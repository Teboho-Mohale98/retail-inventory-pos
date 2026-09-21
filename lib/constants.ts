// ---------------------------------------------------------------------------
// lib/constants.ts
//
// App-wide constants: role metadata, product categories, movement labels and
// safety-stock business parameters. Keeping these in one place avoids
// magic strings scattered across components.
// ---------------------------------------------------------------------------

import type { StockMovementType, UserRole } from "./types";

/** Human readable role labels for user-facing UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  store_picker: "Store Picker",
  receiving_bay: "Receiving Bay",
};

/** Default set of product categories shown in onboarding forms. */
export const PRODUCT_CATEGORIES = [
  "Apparel",
  "Beverages",
  "Electronics",
  "Food & Grocery",
  "Health & Beauty",
  "Household",
  "Stationery",
  "Toys",
];

/** Label + tone mapping for each stock movement type. */
export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, { label: string; tone: "success" | "destructive" | "warning" }> = {
  INBOUND: { label: "Inbound", tone: "success" },
  OUTBOUND: { label: "Outbound", tone: "destructive" },
  ADJUSTMENT: { label: "Adjustment", tone: "warning" },
};

// ------------------------- Business rule knobs -----------------------------

/**
 * Number of historical days used to compute average daily demand for
 * forecasting and reorder-point calculations.
 */
export const DEMAND_LOOKBACK_DAYS = 30;

/** Forecast window (ahead) for projected demand. */
export const DEMAND_FORECAST_HORIZON_DAYS = 7;

/**
 * Supplier lead time in days. In a production deployment this would be
 * stored on the purchase order or vendor entity; we use a global default.
 */
export const DEFAULT_LEAD_TIME_DAYS = 5;

/**
 * Target stock coverage (in days) used to size recommended order quantities.
 */
export const TARGET_STOCK_COVER_DAYS = 14;

/** Tolerance (%) allowed when matching invoice vs PO vs received quantities. */
export const THREE_WAY_MATCH_TOLERANCE_PERCENT = 5;

/** Warehouse shelf locations seeded on first run, if none exist. */
export const DEFAULT_LOCATIONS: Array<{ id: string; name: string; shelf: string }> = [
  { id: "wh-main", name: "Main Warehouse", shelf: "WH-01" },
  { id: "wh-aisle-a", name: "Aisle A", shelf: "A-01" },
  { id: "wh-aisle-b", name: "Aisle B", shelf: "B-01" },
  { id: "store-floor", name: "Store Floor", shelf: "F-01" },
];

/** Length, in milliseconds, of the beep + flash feedback on a scan. */
export const SCAN_FEEDBACK_MS = 400;