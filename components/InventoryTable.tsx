// ---------------------------------------------------------------------------
// components/InventoryTable.tsx
//
// Read-only representation of the article master data with live stock health.
// Shares one real-time snapshot (`UseInventory`) so every row updates the
// instant a POS terminal or receiving bay changes anything.
// ---------------------------------------------------------------------------

"use client";

import React, { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import { useInventory } from "@/hooks/useInventory";
import { isLowStock, isOutOfStock, stockStatusOf } from "@/lib/products";
import { formatMoney } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface InventoryTableProps {
  inventory: ReturnType<typeof useInventory>;
  /** Restrict to a category ("all" shows everything). */
  category?: string;
  /** Show/hide the per-location breakdown column. */
  showLocations?: boolean;
}

/** Small status pill derived from threshold + forecast logic. */
function StockStatusBadge({ sku, inventory }: { sku: string; inventory: ReturnType<typeof useInventory> }) {
  const product = inventory.products.get(sku);
  if (!product) return null;
  const status = stockStatusOf(product);

  const variant =
    status === "out_of_stock" ? "destructive" : status === "low_stock" ? "warning" : "success";
  const text = status === "out_of_stock" ? "Out of stock" : status === "low_stock" ? "Low stock" : "In stock";
  return <Badge variant={variant}>{text}</Badge>;
}

/** Live article register with search + category filter. */
export function InventoryTable({ inventory, category = "all", showLocations = false }: InventoryTableProps) {
  const [query, setQuery] = useState("");
  const { products, loading, error } = inventory;
  const list = Array.from(products.values());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.ean.includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [list, query, category]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Real-time sync interrupted</AlertTitle>
        <AlertDescription>{error.message}. Reconnecting…</AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search by name, SKU, EAN or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} of {list.length} SKUs
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <PackageSearch className="h-8 w-8" />
            <p className="text-sm">
              {list.length === 0 ? "No products yet — create the first article." : "No products match your filter."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>EAN</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                {showLocations && <TableHead>Shelves</TableHead>}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.sku}>
                  <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                  <TableCell className="max-w-[240px] truncate font-medium">{product.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{product.ean}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>{formatMoney(product.price)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatMoney(product.costPrice)}</TableCell>
                  <TableCell className="text-right font-semibold">{product.totalStock}</TableCell>
                  <TableCell className="text-right">{product.minStockThreshold}</TableCell>
                  {showLocations && (
                    <TableCell>
                      {Object.entries(product.stockByLocation ?? {})
                        .filter(([, qty]) => qty > 0)
                        .map(([loc, qty]) => `${loc}:${qty}`)
                        .join(", ") || "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <StockStatusBadge sku={product.sku} inventory={inventory} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export { isLowStock, isOutOfStock };