// ---------------------------------------------------------------------------
// lib/forecasting.ts
//
// Demand forecasting & reorder-point engine.
//
// The model is deliberately lightweight and deterministic — it runs fully
// client-side from the `stock_movements` audit trail so the dashboard can
// recompute instantly on every real-time update. It is the algorithmic motor
// behind the "Demand Forecasting & Stock Alerts" business requirement:
//
//   avgDailyDemand  = moving average of recent sale days
//   safetyStock     = Z(service-level, 1.28 ≈ 90%) × σ(demand) × √leadTime
//   reorderPoint    = avgDailyDemand × leadTimeDays + safetyStock
//   suggestedOrder  = targetCoverDays × avgDailyDemand − currentStock
//
// Swap this module for an ML-backed API later without touching callers — the
// `ForecastResult` type in lib/types.ts is the contract.
// ---------------------------------------------------------------------------

import {
  DEFAULT_LEAD_TIME_DAYS,
  DEMAND_FORECAST_HORIZON_DAYS,
  DEMAND_LOOKBACK_DAYS,
  TARGET_STOCK_COVER_DAYS,
} from "./constants";
import type { ForecastResult } from "./types";

export interface ForecastOptions {
  /** Earliest sale date (ms epoch) included in the moving average. */
  lookbackStart?: number;
  horizonDays?: number;
  leadTimeDays?: number;
  targetCoverDays?: number;
  /** On-hand stock used to size the suggested reorder quantity. */
  currentStock?: number;
}

/**
 * Computes a ForecastResult for one product from a per-day sold-quantity
 * histogram (date -> units sold).
 */
export function computeForecast(
  sku: string,
  daily: Record<string, number>,
  opts: ForecastOptions = {}
): ForecastResult {
  const lookbackStart = opts.lookbackStart ?? Date.now() - DEMAND_LOOKBACK_DAYS * 86_400_000;
  const horizonDays = opts.horizonDays ?? DEMAND_FORECAST_HORIZON_DAYS;
  const leadTimeDays = opts.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const targetCoverDays = opts.targetCoverDays ?? TARGET_STOCK_COVER_DAYS;
  const currentStock = opts.currentStock ?? 0;

  const startMs = lookbackStart;
  const dates = Object.keys(daily)
    .filter((d) => new Date(`${d}T00:00:00Z`).getTime() >= startMs)
    .sort();

  // Sparse-store guard: only the rolling average of days WITH sales is used,
  // otherwise low-volume SKUs would get an unrealistic demand estimate.
  const sales = dates.map((d) => daily[d]);
  const numDays = Math.max(dates.length, 1);
  const totalSold = sales.reduce((a, b) => a + b, 0);
  const dailyDemand = Math.max(totalSold / numDays, 0);

  // Population standard deviation of daily sold quantities.
  const mean = totalSold / numDays;
  const variance = sales.length > 1
    ? sales.reduce((acc, q) => acc + (q - mean) ** 2, 0) / numDays
    : 0;
  const stdDev = Math.sqrt(variance);

  // Z-factor 1.28 ≈ 90% service level.
  const safetyStock = Math.ceil(1.28 * stdDev * Math.sqrt(leadTimeDays));
  const reorderPoint = Math.ceil(dailyDemand * leadTimeDays + safetyStock);
  const projectedDemand = Math.ceil(dailyDemand * horizonDays);
  const suggestedOrderQty = Math.max(0, Math.ceil(targetCoverDays * dailyDemand - currentStock));

  return {
    sku,
    dailyDemand: Math.round(dailyDemand * 100) / 100,
    projectedDemand,
    safetyStock,
    reorderPoint,
    suggestedOrderQty,
  };
}

/**
 * Classifies stock health from the forecast + on-hand, high-level helper
 * used by the StockAlertBadge component.
 */
export function classifyStockLevel(currentStock: number, forecast: ForecastResult | null): "healthy" | "watch" | "critical" {
  if (!forecast || forecast.reorderPoint <= 0) return "healthy";
  if (currentStock <= 0 || currentStock <= forecast.safetyStock) return "critical";
  if (currentStock <= forecast.reorderPoint) return "watch";
  return "healthy";
}