// ---------------------------------------------------------------------------
// components/Dashboard.tsx
//
// Audit & Analytics command center. Everything recomputes live from the two
// real-time streams (products + stock_movements): total valuation, gross
// profit, stock alerts, top movers, location/shelf allocation and a running
// activity feed.
//
// All aggregates are pure functions over the in-memory snapshot, so they
// re-render with zero latency as Firestore pushes changes.
// ---------------------------------------------------------------------------

"use client";

import React, { useMemo } from "react";
import {
  Package,
  SwatchBook,
  TrendingUp,
  Wallet,
  AlertTriangle,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings2,
} from "lucide-react";
import { useInventory } from "@/hooks/useInventory";
import { isLowStock, isOutOfStock, stockStatusOf } from "@/lib/products";
import { MOVEMENT_TYPE_LABELS } from "@/lib/constants";
import { formatMoney, formatDateTime, shortLabel } from "@/lib/utils";
import type { Product, StockMovement } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function MetricCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/** Live audit & analytics dashboard. Mount once per dashboard route. */
export function Dashboard() {
  const { products, productList, movements, dailyDemand, countByStatus } = useInventory(500);

  const metrics = useMemo(() => {
    let retailValue = 0;
    let costValue = 0;
    for (const p of productList) {
      retailValue += p.totalStock * p.price;
      costValue += p.totalStock * p.costPrice;
    }

    const today = new Date().toDateString();
    const movementsToday = movements.filter((m) => new Date(m.timestamp).toDateString() === today).length;

    return {
      totalSKUs: productList.length,
      retailValue,
      costValue,
      grossProfit: retailValue - costValue,
      lowStockCount: countByStatus(isLowStock),
      outOfStockCount: countByStatus(isOutOfStock),
      movementsToday,
    };
  }, [productList, movements, countByStatus]);

  const topSelling = useMemo(() => {
    const qtyBySku = new Map<string, number>();
    for (const m of movements) {
      if (m.type !== "OUTBOUND") continue;
      qtyBySku.set(m.sku, (qtyBySku.get(m.sku) ?? 0) + m.quantity);
    }
    return [...qtyBySku.entries()]
      .map(([sku, qty]) => ({ product: products.get(sku), qty }))
      .filter((x) => x.product)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);
  }, [movements, products]);

  const locationAllocation = useMemo(() => {
    const agg = new Map<string, number>();
    for (const p of productList) {
      for (const [loc, qty] of Object.entries(p.stockByLocation ?? {})) {
        agg.set(loc, (agg.get(loc) ?? 0) + qty);
      }
    }
    return [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [productList]);

  const alerts = useMemo(
    () => productList.filter((p) => isLowStock(p) || isOutOfStock(p)).sort((a, b) => a.totalStock - b.totalStock),
    [productList]
  );

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={<Package className="h-4 w-4" />} label="Articles (SKUs)" value={String(metrics.totalSKUs)} sub={`${metrics.totalSKUs} live in the register`} />
        <MetricCard icon={<Wallet className="h-4 w-4" />} label="Retail value" value={formatMoney(metrics.retailValue)} sub={`cost ${formatMoney(metrics.costValue)}`} />
        <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Gross profit" value={formatMoney(metrics.grossProfit)} sub="if all stock sells @ retail" />
        <MetricCard icon={<Boxes className="h-4 w-4" />} label="Movements today" value={String(metrics.movementsToday)} sub={`${metrics.lowStockCount} low · ${metrics.outOfStockCount} out of stock`} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="alerts">Stock alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="stream">Activity stream</TabsTrigger>
          <TabsTrigger value="shelves">Shelves</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Top moving SKUs
              </CardTitle>
              <CardDescription>Units out (sales) across the live window.</CardDescription>
            </CardHeader>
            <CardContent>
              {topSelling.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No outbound activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {topSelling.map((row) => (
                    <li key={row.product!.sku} className="flex items-center gap-3">
                      <span className="w-6 text-xs text-muted-foreground">#{topSelling.indexOf(row) + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{row.product!.name}</span>
                      <Badge variant="secondary">{row.qty} sold</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SwatchBook className="h-4 w-4" /> Category demand
              </CardTitle>
              <CardDescription>Units out per category, same window.</CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryDemand products={new Map([...products])} movements={movements} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> Reorder queue
              </CardTitle>
              <CardDescription>Below/at min-stock threshold. Safety-stock logic from forecast drives urgency.</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">All articles above their thresholds. </p>
              ) : (
                <ul className="divide-y">
                  {alerts.map((p) => (
                    <li key={p.sku} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm tabular-nums">
                          {p.totalStock} on hand / {p.minStockThreshold} threshold
                        </span>
                        <Badge variant={p.totalStock <= 0 ? "destructive" : "warning"}>
                          {p.totalStock <= 0 ? "OUT" : "LOW"}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stream">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" /> Real-time audit stream
              </CardTitle>
              <CardDescription>Every inbound, outbound and adjustment, as it happens.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityStream movements={movements.slice(0, 14)} products={products} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shelves">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="h-4 w-4" /> Location / shelf allocation
              </CardTitle>
              <CardDescription>Units held per configured shelf location.</CardDescription>
            </CardHeader>
            <CardContent>
              {locationAllocation.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No location data yet — allocate shelves from Receiving or POS.</p>
              ) : (
                <div className="space-y-2">
                  {locationAllocation.map(([loc, qty]) => {
                    const max = locationAllocation[0][1] || 1;
                    return (
                      <div key={loc} className="flex items-center gap-3">
                        <span className="w-24 truncate text-xs font-mono text-muted-foreground">{shortLabel(loc)}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(qty / max) * 100}%` }} />
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums">{qty}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Lightweight per-category bar breakdown (pure, no charts lib). */
function CategoryDemand({ products, movements }: { products: Map<string, Product>; movements: StockMovement[] }) {
  const rows = useMemo(() => {
    const catQty = new Map<string, number>();
    for (const m of movements) {
      if (m.type !== "OUTBOUND") continue;
      const p = products.get(m.sku);
      const cat = p?.category ?? "Unknown";
      catQty.set(cat, (catQty.get(cat) ?? 0) + m.quantity);
    }
    return [...catQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [products, movements]);

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No demand yet.</p>;

  const max = rows[0][1] || 1;
  return (
    <div className="space-y-2">
      {rows.map(([cat, qty]) => (
        <div key={cat} className="flex items-center gap-3">
          <span className="w-28 truncate text-xs text-muted-foreground">{shortLabel(cat, 16)}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(qty / max) * 100}%` }} />
          </div>
          <span className="w-12 text-right text-sm tabular-nums">{qty}</span>
        </div>
      ))}
    </div>
  );
}

/** Inline activity feed with movement-type tone + product resolution. */
function ActivityStream({ movements, products }: { movements: StockMovement[]; products: Map<string, Product> }) {
  if (movements.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No movements recorded yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {movements.map((m) => {
        const meta = MOVEMENT_TYPE_LABELS[m.type];
        const product = products.get(m.sku);
        const Icon = m.type === "INBOUND" ? ArrowDownToLine : m.type === "OUTBOUND" ? ArrowUpFromLine : Settings2;
        return (
          <li key={m.id} className="flex items-center gap-3">
            <Badge variant={meta.tone} className="w-32 justify-center">
              <Icon className="mr-1 h-3 w-3" />
              {meta.label}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium">{product?.name ?? m.sku}</span>
                <span className="text-muted-foreground"> · {m.quantity} units</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {m.referenceId && `ref ${m.referenceId} · `}
                {formatDateTime(m.timestamp)}
              </p>
            </div>
            <Badge variant="outline" className="font-mono">{stockStatusOf(product ?? ({} as Product))}</Badge>
          </li>
        );
      })}
    </ul>
  );
}