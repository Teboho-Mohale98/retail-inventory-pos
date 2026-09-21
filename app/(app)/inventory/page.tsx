"use client";

// ---------------------------------------------------------------------------
// app/(app)/inventory/page.tsx
//
// Article Master Data. Admin can create/edit articles; every role sees the
// live table with stock health. Includes a quick "adjust stock" action for
// losses/damage/shrinkage written through the movement audit trail.
// ---------------------------------------------------------------------------

import React, { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useInventory } from "@/hooks/useInventory";
import { useStockMovements } from "@/hooks/useStockMovements";
import { InventoryTable } from "@/components/InventoryTable";
import { ProductFormDialog } from "@/components/ProductFormDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Product } from "@/lib/types";

export default function InventoryPage() {
  const inventory = useInventory(2000);
  const { profile, user } = useAuth();
  const { adjust, busy: adjustBusy, error: adjustError } = useStockMovements(5);

  const [category, setCategory] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  // Adjust-stock dialog state
  const [adjustTarget, setAdjustTarget] = useState<{ sku: string; name: string } | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("shrinkage");
  const [adjustMsg, setAdjustMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const isAdmin = profile?.role === "admin";

  const runAdjustment = async () => {
    if (!adjustTarget || delta === 0) return;
    setAdjustMsg(null);
    try {
      await adjust({
        sku: adjustTarget.sku,
        quantity: Math.abs(delta),
        reason,
        userId: user?.uid,
        locationId: profile?.defaultLocationId,
      });
      setAdjustMsg({ tone: "success", text: `Adjusted ${adjustTarget.sku}. Stock is live.` });
      setAdjustTarget(null);
      setDelta(0);
    } catch (err) {
      setAdjustMsg({ tone: "error", text: err instanceof Error ? err.message : "Adjustment failed." });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Article master data</h1>
          <p className="text-sm text-muted-foreground">
            Products, prices, barcodes and real-time stock across all locations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {PRODUCT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> New product
            </Button>
          )}
        </div>
      </div>

      {inventory.error && (
        <Alert variant="destructive">
          <AlertTitle>Sync interrupted</AlertTitle>
          <AlertDescription>{inventory.error.message}</AlertDescription>
        </Alert>
      )}

      <InventoryTable inventory={inventory} category={category} showLocations={isAdmin} />

      {isAdmin && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Quick adjust (loss / damage / shrinkage)</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Label className="mb-1 block text-xs text-muted-foreground">Product</Label>
              <Select
                value={adjustTarget?.sku ?? ""}
                onValueChange={(sku) => {
                  const p = inventory.products.get(sku);
                  if (p) setAdjustTarget({ sku, name: p.name });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a SKU…" />
                </SelectTrigger>
                <SelectContent>
                  {inventory.productList.map((p) => (
                    <SelectItem key={p.sku} value={p.sku}>
                      {p.name} · {p.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Delta (+add / −remove)</Label>
              <Input
                type="number"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                className="w-32"
                disabled={!adjustTarget}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["shrinkage", "damage", "loss", "found stock", "cycle count correction"].map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => void runAdjustment()}
              disabled={!adjustTarget || delta === 0 || adjustBusy}
            >
              <Settings2 className="h-4 w-4" /> {adjustBusy ? "Adjusting…" : "Adjust stock"}
            </Button>
          </div>
          <div className="mt-2">
            <OutputNote tone={adjustMsg?.tone ?? null} text={adjustMsg?.text ?? null} />
            {adjustError && <p className="text-xs text-destructive">{adjustError.message}</p>}
          </div>
        </div>
      )}

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => setEditing(null)}
      />
    </div>
  );
}

function OutputNote({ tone, text }: { tone: "success" | "error" | null; text: string | null }) {
  if (!text) return null;
  return <p className={`text-xs ${tone === "error" ? "text-destructive" : "text-success"}`}>{text}</p>;
}