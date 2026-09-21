// ---------------------------------------------------------------------------
// lib/utils.ts
//
// Framework-agnostic helpers shared by hooks, components and lib modules:
// class name merging, currency/quantity formatting, EAN-13 checksum logic and
// barcode input parsing.
// ---------------------------------------------------------------------------

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind classes without conflicts. Uses `clsx` for conditional
 * classes and `tailwind-merge` to resolve duplicates.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats a minor-unit (integer cents) value as a localized currency string.
 *
 * @param value amount in cents (integer) OR an already-decimal amount.
 * @param asMoney when true, interprets `value` as minor units (cents).
 */
export function formatMoney(value: number, asMoney = true): string {
  const amount = asMoney ? value / 100 : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Formats an ISO date string into a compact, shipment-friendly date. */
export function formatDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Formats an ISO date string into a time-of-day string. */
export function formatTime(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/** Formats an ISO timestamp into `Sep 21, 14:32:05` style. */
export function formatDateTime(iso: string | number | Date): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** Adds leading zeros until the value is `width` characters long. */
export function pad(value: string | number, width = 12): string {
  return String(value).padStart(width, "0");
}

// ---------------------------- EAN-13 checksum ------------------------------

/**
 * Computes the EAN-13 check digit for the first 12 digits of a code.
 * Throws when the input cannot form a valid EAN prefix.
 *
 * @see https://www.gs1.org/services/how-calculate-check-digit-manually
 */
export function ean13CheckDigit(first12: string): number | null {
  if (!/^\d{12}$/.test(first12)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12[i]);
    // Odd positions (1,3,5,..) weigh 3; even positions weigh 1.
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Builds a fully valid 13-digit EAN-13 from any 12-digit prefix. */
export function createEAN13(prefix12: string): string | null {
  const check = ean13CheckDigit(prefix12);
  if (check === null) return null;
  return `${prefix12}${check}`;
}

/**
 * Generates a valid EAN-13 barcode from a random 12-digit prefix.
 * Used when onboarding a product without supplier-provided barcodes;
 * the caller can later replace it with the official code.
 */
export function generateEAN13(): string {
  let prefix = "";
  for (let i = 0; i < 12; i++) {
    prefix += Math.floor(Math.random() * 10);
  }
  const ean = createEAN13(prefix);
  return ean ?? generateEAN13();
}

/**
 * `true` when the string is a syntactically valid EAN-13, GTIN-13 or UPC-A.
 * Lighter (loose) check — used to accept scans quickly at the bay/POS.
 */
export function isValidBarcode(code: string): boolean {
  const cleaned = code.trim();
  if (!/^\d{8,14}$/.test(cleaned)) return false;
  // Full EAN-13 check when we have exactly 13 digits.
  if (cleaned.length === 13) return ean13CheckDigit(cleaned.slice(0, 12)) === Number(cleaned[12]);
  return true;
}

// -------------------------- Barcode input parsing --------------------------

export interface ScanResult {
  /** Raw string captured from the scanner. */
  raw: string;
  /** Trimmed value. */
  value: string;
  /** True when `value` looks like a valid barcode. */
  valid: boolean;
}

/**
 * Normalizes a barcode input (from keyboard-wedge scanners) into a clean
 * `ScanResult`. Real scanners often append carriage-return / line-feed and
 * sometimes a leading zero for EAN/UPC conversion — we strip both.
 */
export function parseBarcodeInput(input: string): ScanResult {
  const raw = String(input ?? "");
  // Strip control characters and surrounding whitespace.
  let value = raw.replace(/[\r\n\t]/g, "").trim();
  if (value.length > 1 && value.startsWith("0")) value = value.slice(1);
  return { raw, value, valid: isValidBarcode(value) };
}

/** Generates a human-friendly SKU, e.g. `APR-9F3K2M`. */
export function generateSKU(categoryLabel: string): string {
  const slug = (categoryLabel || "GEN")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${slug}-${random}`;
}

// ------------------------------- Numbers -----------------------------------

/** Rounds a number to `dp` decimal places without float artifacts. */
export function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Clamps a quantity to sensible bounds for stock mutations. */
export function clampQuantity(qty: number, max = 1_000_000): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.min(Math.max(Math.round(qty), 0), max);
}

/** Picks the short category for grouping on charts. */
export function shortLabel(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}