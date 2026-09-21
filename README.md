# Retail Inventory & Point of Sale — Real-Time Cloud ERP

A production-ready **Retail Inventory & POS Tracking** application that replaces monolithic ERP systems (SAP Retail-class) with a lightweight **real-time cloud architecture**: Next.js + Firebase + Tailwind. Every scan, receiving bay line, and stock adjustment propagates to every open screen instantly via Firestore `onSnapshot` listeners.

![stack](https://img.shields.io/badge/Next.js-14-black) ![ts](https://img.shields.io/badge/TypeScript-strict-blue) ![firebase](https://img.shields.io/badge/Firebase-Firestore%2FAuth-orange) ![deploy](https://img.shields.io/badge/deploy-Vercel-black)

---

## Table of contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Firestore data model](#firestore-data-model)
4. [Repository structure](#repository-structure)
5. [Getting started](#getting-started)
6. [Firebase setup (step by step)](#firebase-setup-step-by-step)
7. [Firestore indexes & rules](#firestore-indexes--rules)
8. [Running locally](#running-locally)
9. [Deploy to Vercel](#deploy-to-vercel)
10. [Push to GitHub](#push-to-github)
11. [Roles & permissions](#roles--permissions)
12. [Business logic deep-dive](#business-logic-deep-dive)
13. [Hardware barcode scanners](#hardware-barcode-scanners)
14. [Production hardening checklist](#production-hardening-checklist)
15. [Troubleshooting](#troubleshooting)

---

## Features

| Module | What it does |
| --- | --- |
| **Article Master Data** | Unique SKU + valid EAN-13 generation, categories, price/cost master, min-stock thresholds, per-location (shelf) stock. |
| **Receiving Bay (Inbound)** | Barcode-driven receiving against open Purchase Orders. Automatic over-receipt guard + **3-Way Matching** (PO ↔ goods received ↔ supplier invoice) inside a single Firestore transaction. |
| **Point of Sale (Outbound)** | Camera or hardware-scanner checkout. Instant transactional stock deduction per line, receipts stored, insufficient-stock errors surfaced before any write. |
| **Forecasting & Stock Alerts** | Moving-average daily demand, Z-score safety stock, reorder point, suggested reorder quantity, low-stock / out-of-stock queues. |
| **Audit & Analytics** | Total valuation (@ retail & cost), gross profit, top movers, per-category demand, real-time activity stream, shelf allocation. |

## Architecture

```
┌──────────────────────────── Browser/Tablet/Scanner-Terminal ────────────────────────────┐
│                                                                                         │
│   Next.js 14 (App Router, TypeScript)                                                   │
│   ├── app/                     pages & route groups (protected shell)                    │
│   ├── components/              POS, Receiving Bay, Dashboard, scanners                  │
│   ├── hooks/                   useInventory (onSnapshot), useCart, useAuth…             │
│   └── lib/                     business rules + all Firestore access paths               │
│                                                                                         │
│                    Firebase SDK 10 (web) — offline persistence enabled                   │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ onSnapshot (zero-latency push)
                                           ▼
┌───────────────────────────── Cloud Firestore (real-time DB) ────────────────────────────┐
│  users/  products/  stock_movements/  purchase_orders/  receipts/  counters/            │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                        Firebase Auth (Email/Password, role via users/{uid})
```

**Key architectural decisions**

- **Single write path.** Every stock change funnels through `recordMovement()` (or the transaction-scoped `applyMovementInTransaction()` used by PO receiving). This guarantees the audit trail *always* matches the count — no drift.
- **Client-driven real-time.** `useInventory()` subscribes to `products` + `stock_movements`. No polling, no server round-trips; multi-tab IndexedDB persistence keeps the terminal usable offline.
- **Atomic counters.** PO numbers come from a transactional counter doc, so concurrent operators never collide.

## Firestore data model

```
users/{authUid}
  ├─ uid, displayName, email, role: "admin"|"store_picker"|"receiving_bay"
  ├─ defaultLocationId?, active, createdAt

products/{sku}                              ← SKU is the document id
  ├─ sku, ean (EAN-13), name, category, brand?, unit
  ├─ price, costPrice                       ← minor units (cents)
  ├─ totalStock                            ← AUTHORITATIVE count
  ├─ stockByLocation: { locationId: qty }  ← sum == totalStock
  ├─ minStockThreshold, defaultShelf?, lastUpdated, createdAt
  └─ lastMovementType?

purchase_orders/{poNumber}                  ← e.g. PO-2026-0001
  ├─ poNumber, vendor, status: draft|ordered|partial|received|cancelled
  ├─ invoiceNumber?, expectedDelivery?, note?, createdBy?
  └─ items: [{ sku, name, ean, quantityExpected, quantityReceived, unitPrice }]

stock_movements/{id}                        ← immutable audit trail
  ├─ timestamp, type: INBOUND|OUTBOUND|ADJUSTMENT
  ├─ sku, quantity, referenceId (PO / receipt / cycle count)
  ├─ userId, locationId?, reason?, ean?

receipts/{receiptId}                        ← POS sale records
counters/{po}                               ← monotonic sequence for PO numbers
```

**Consistency rule:** `products/{sku}.totalStock` and `stock_movements` are updated *in the same transaction*. A line receiving `+5` on a PO can never land without its `INBOUND` movement (and vice-versa).

## Repository structure

```
retail-inventory-pos/
├── app/
│   ├── layout.tsx, globals.css, page.tsx        # root + auth gate
│   ├── login/page.tsx                           # sign in / register (role picker)
│   └── (app)/                                   # protected shell (role-aware nav)
│       ├── layout.tsx
│       ├── dashboard/page.tsx                   # audit & analytics
│       ├── inventory/page.tsx                   # article master + adjustments
│       ├── pos/page.tsx                         # outbound checkout
│       ├── receiving/page.tsx                   # inbound receiving bay
│       └── purchase-orders/page.tsx             # PO board + create dialog
├── components/
│   ├── BarcodeScanner.tsx                       # camera + keyboard-wedge scanning
│   ├── InventoryTable.tsx                       # live register with stock health
│   ├── POSCheckout.tsx                          # scanner-driven cart + checkout
│   ├── ReceivingBay.tsx                         # 3-way matching dock
│   ├── Dashboard.tsx                            # metrics, top movers, activity stream
│   ├── ProductFormDialog.tsx, CreatePurchaseOrderDialog.tsx
│   └── ui/                                      # shadcn-style primitives
├── hooks/
│   ├── useAuth.ts                               # session + Firestore profile
│   ├── useInventory.ts                          # ★ onSnapshot product+movement sync
│   ├── useCart.ts                               # POS basket + transactional checkout
│   ├── usePurchaseOrders.ts                     # live PO board + receive actions
│   └── useStockMovements.ts                     # live audit stream + adjustments
├── lib/
│   ├── firebase.ts                              # ★ SDK init (Auth + Firestore + emulators)
│   ├── types.ts                                 # domain model (Firestore contract)
│   ├── constants.ts                             # roles, categories, business knobs
│   ├── utils.ts                                 # EAN-13 checksum, money/date, scan parsing
│   ├── auth.ts, products.ts, purchaseOrders.ts
│   ├── stockMovements.ts                        # ★ transactional movement writer
│   └── forecasting.ts                           # safety-stock engine
├── firestore.rules, firestore.indexes.json
├── .env.example, .gitignore, package.json, tailwind.config.ts, tsconfig.json
└── README.md
```

## Getting started

**Prerequisites**

- Node.js **18.17+** (Next.js 14 requirement)
- A Free-tier [Firebase](https://console.firebase.google.com) project
- (Optional) The [Firebase CLI](https://firebase.google.com/docs/cli) to deploy rules/indexes

```bash
# 1. Clone the repo
git clone https://github.com/<you>/retail-inventory-pos.git
cd retail-inventory-pos

# 2. Install dependencies
npm install

# 3. Configure Firebase (next section), then:
npm run dev
# open http://localhost:3000
```

## Firebase setup (step by step)

1. **Create the project** — console.firebase.google.com → *Add project* → name it (e.g. `retail-inventory-pos`) → continue (Analytics optional).

2. **Enable Authentication**
   - *Build → Authentication → Get started → Sign-in method*.
   - Enable **Email/Password**.

3. **Create Cloud Firestore**
   - *Build → Firestore Database → Create database*.
   - Choose **Production mode** (you'll deploy the included rules later; for local hacking choose *Test mode* and tighten before production).
   - Region: nearest to your stores (e.g. `europe-west2`).

4. **Register a web app**
   - *Project settings → Your apps → ⦿ Web*.
   - Copy the SDK config object.

5. **Create `.env.local`**
   ```bash
   cp .env.example .env.local
   ```
   Fill it from the config copied above:

   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=AIza……
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=retail-inventory-pos.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=retail-inventory-pos
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=retail-inventory-pos.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
   NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:……
   ```

   > Public `apiKey` is **not** a secret in Firebase browsers (it identifies your project). Real security comes from Firestore Security Rules.

6. **(Recommended) Apply rules & indexes** with the Firebase CLI:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use retail-inventory-pos
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Or paste `firestore.rules` / `firestore.indexes.json` from the repo into the Firebase Console.

7. **Register `admin`** — open the app, choose *Register*, role **Admin**. Admins create products and POs; other roles are limited by the shell (see [Roles](#roles--permissions)).

## Firestore indexes & rules

The queries used require these indexes (already in `firestore.indexes.json`; Firestore auto-creates single-field indexes, explicit ones need deploying):

| Collection | Query | Index needed |
| --- | --- | --- |
| `products` | `where ean == …` | ean (single-field, auto) |
| `stock_movements` | `where sku == … and type == …` | `(sku ↑, type ↑)` composite — **deploy** |
| `stock_movements` | `orderBy timestamp desc` | timestamp desc (auto) |
| `purchase_orders` | `orderBy createdAt desc` | createdAt desc (auto) |

Rules enforce: immutable audit trail (no update/delete on `stock_movements`), role-based PO write access, and self-service user profile edits.

## Running locally

```bash
npm run dev          # dev server :3000
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

**Local emulators (fully offline dev)** — uncomment the block in `lib/firebase.ts` and add to `.env.local`:

```env
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST=8080
```

Run `firebase emulators:start` and the SDK auto-connects.

## Deploy to Vercel

1. Push the repo (next section).
2. [vercel.com](https://vercel.com) → **Import project** → pick the repo.
3. Framework preset **Next.js** is auto-detected (build `next build`).
4. Add the **same six `NEXT_PUBLIC_*` environment variables** from `.env.local` (Settings → Environment Variables) for Production *and* Preview. `NEXT_PUBLIC_` is inlined at build time.
5. Deploy. On every `git push` to the default branch Vercel rebuilds automatically.

## Push to GitHub

```bash
# From the project root (if not already a repo)
git init
git add .
git commit -m "feat: retail inventory & POS — real-time cloud ERP"

# Create an empty repo at https://github.com/new (no README — use this one)
git remote add origin https://github.com/<you>/retail-inventory-pos.git
git branch -M main
git push -u origin main
```

`.env.local` is git-ignored — **never commit secrets**. Only the `.env.example` template lives in the repo.

## Roles & permissions

| Capability | admin | store_picker | receiving_bay |
| --- | :-: | :-: | :-: |
| Dashboard & analytics | ✅ | ✅ | ✅ |
| Master data (create/edit) | ✅ | read-only | read-only |
| Adjust stock (loss/damage) | ✅ | ❌ | ❌ |
| Point of Sale checkout | ✅ | ✅ | ❌ |
| Receive inbound goods | ✅ | ❌ | ✅ |
| Create / close purchase orders | ✅ | ❌ | view + close |

Enforced in the shell (`app/(app)/layout.tsx`), the receiving lib layer (`role` param), and mirrored in `firestore.rules`.

## Business logic deep-dive

### 3-Way Matching (Receiving Bay)

Each PO line reconciles three sources:

```
 quantityExpected  (PO)     quantityReceived (goods in)   invoiceNumber (supplier)
        └──────────────┴──── tolerance ±5% ┴────────────────┘
```

`evaluateThreeWayMatch()` in `lib/purchaseOrders.ts` scores every line inside `THREE_WAY_MATCH_TOLERANCE_PERCENT` and produces `matched | mismatch | pending`. Over-receipts are blocked *transactionally* at the receiving line level.

### Demand forecasting & safety stock

`lib/forecasting.ts` computes, from the movement audit trail:

```
 dailyDemand   = Σ(units sold on recorded days) / recorded days
 safetyStock   = 1.28 × σ(dailyDemand) × √leadTime           # 90% service level
 reorderPoint  = dailyDemand × leadTime + safetyStock
 suggestedOrder = targetCoverDays × dailyDemand − currentStock
```

Knobs live in `lib/constants.ts` (`DEMAND_LOOKBACK_DAYS`, `DEMAND_FORECAST_HORIZON_DAYS`, `DEFAULT_LEAD_TIME_DAYS`, `TARGET_STOCK_COVER_DAYS`).

### Error handling philosophy

- **Missing barcode** → POS/Receiving surfaces `"Barcode X not found in the article master"` (never a crash).
- **Insufficient stock** → `InsufficientStockError` thrown *before* the receipt commits; pre-flight checked in `useCart.checkout`.
- **Offline** → Firestore multi-tab persistence keeps the UI readable; shell renders an offline banner; keyboard scan path is 100% local.
- **Unknown Firestore env** → `lib/firebase.ts` throws with the exact missing variable name.

## Hardware barcode scanners

- **USB keyboard-wedge scanners** work out of the box — `BarcodeScanner` buffers the high-speed keystrokes and flushes on `Enter` (auto-distinguishes from human typing).
- **Camera scanning** uses the native `BarcodeDetector` API (Chrome/Edge); other browsers get a clear fallback hint while keyboard scanning stays live.
- Chained handheld formats like `EAN|QTY` are accepted by the receiving bay.
- Scans are validated with a real **EAN-13 checksum** (`ean13CheckDigit` in `lib/utils.ts`).

## Production hardening checklist

- [ ] Replace self-service registration with an admin-invited flow (toggle in `lib/auth.ts` + login page).
- [ ] Enforce **Cloud Firestore Security Rules** (remove `allow create, update, delete: if signedIn()` from `products`, tighten movement creation by role).
- [ ] Move `recordMovement`/PO receiving behind a trusted path (Cloud Function) if you require server-side price/batch validation.
- [ ] Add **Firebase Authentication case-sensitivity** + MFA for admin roles.
- [ ] Wire Firebase **Analytics / Crashlytics** for store-performance telemetry.
- [ ] Add `robots.txt`, CORS + Vercel headers, and a custom error boundary.
- [ ] Load-test the forecast query; add composite indexes as movement volume grows.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Application error: a client-side exception has occurred` on Vercel | The six `NEXT_PUBLIC_FIREBASE_*` vars are missing/empty at build time — add them in **Vercel → Project → Settings → Environment Variables** (Production + Preview), trigger **Redeploy**, and refresh. A setup screen now appears instead of the crash when this is misconfigured. |
| `Firebase is missing required config values…` | `.env.local` incomplete or server not restarted — restart `npm run dev`. |
| `auth/configuration-not-found` | Auth email/password provider not enabled in the console. |
| Data never syncs / blank tables | Firestore in Production mode with no deployed rules — deploy `firestore.rules` or switch to Test mode temporarily. |
| Query `where sku and type` fails | Deploy `firestore.indexes.json` (composite index not auto-created). |
| Camera scanning unavailable | Chromium-only; enable keyboard scanners on other browsers. |
| Scanner types gibberish in fields | The keyboard-wedge buffer ignores focused text inputs except `Enter` — scan with focus on the page. |

---

Built with Next.js 14 (App Router), TypeScript strict, Tailwind CSS + shadcn/ui, and Firebase (Auth + Firestore). Designed for Vercel edge deployment and GitHub collaboration. 🛒