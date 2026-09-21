// ---------------------------------------------------------------------------
// components/CreatePurchaseOrderDialog.tsx
//
// Admin-only dialog composing a purchase order from the live article master.
// Quantities + expected unit prices are captured per line; SKU names/EANs are
// pulled straight from Firestore so the receiving bay can match scans.
// ---------------------------------------------------------------------------

"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createPurchaseOrder } from "@/lib/purchaseOrders";
import { useInventory } from "@/hooks/useInventory";
import type { Product } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DraftLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatePurchaseOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (poNumber: string) => void;
}

export function CreatePurchaseOrderDialog({ open, onOpenChange, onCreated }: CreatePurchaseOrderDialogProps) {
  const { productList } = useInventory(2000);
  const [vendor, setVendor] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [note, setNote] = useState("");
  const [pickSku, setPickSku] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (open) {
      setVendor("");
      setPickSku("");
      setLines([]);
      setError(null);
      setNote("");
      setExpectedDelivery("");
    }
  }, [open]);

  const productsBySku = useMemo(() => {
    const map = new Map<string, Product>();
    productList.forEach((p) => map.set(p.sku, p));
    return map;
  }, [productList]);

  const addLine = () => {
    if (!pickSku) return;
    const product = productsBySku.get(pickSku);
    if (!product) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === pickSku);
      if (existing) {
        return prev.map((l) => (l.sku === pickSku ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { sku: pickSku, quantity: 1, unitPrice: product.costPrice }];
    });
    setPickSku("");
  };

  const totalExpected = lines.reduce((a, l) => a + l.quantity, 0);
  const totalValue = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);

  const submit = async () => {
    setError(null);
    if (!vendor.trim()) return setError("Vendor name is required.");
    if (lines.length === 0) return setError("Add at least one line item.");

    setBusy(true);
    try {
      const po = await createPurchaseOrder({
        vendor: vendor.trim(),
        expectedDelivery: expectedDelivery || undefined,
        note: note.trim() || undefined,
        items: lines.map((l) => {
          const p = productsBySku.get(l.sku)!;
          return {
            sku: l.sku,
            name: p.name,
            ean: p.ean,
            quantityExpected: l.quantity,
            unitPrice: l.unitPrice,
          };
        }),
      });
      onOpenChange(false);
      onCreated?.(po.poNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create purchase order.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Compose from the article master — receiving scans later match against these lines.</DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Cannot create PO</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <Label className="mb-1.5 block">Vendor *</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Acme Supply Co." />
            </div>
            <div className="sm:col-span-1">
              <Label className="mb-1.5 block">Expected delivery</Label>
              <Input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
            </div>
            <div className="sm:col-span-1">
              <Label className="mb-1.5 block">Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* line picker */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="mb-1.5 block">Add article</Label>
              <Select value={pickSku} onValueChange={setPickSku}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a product…" />
                </SelectTrigger>
                <SelectContent>
                  {productList.map((p) => (
                    <SelectItem key={p.sku} value={p.sku}>
                      {p.name} · {p.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={addLine} disabled={!pickSku}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </div>

          {/* line table */}
          {lines.length > 0 && (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Unit price</th>
                    <th className="p-2 text-right">Line total</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const product = productsBySku.get(line.sku);
                    return (
                      <tr key={line.sku} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">
                          {product?.name} <span className="text-muted-foreground">({line.sku})</span>
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) => (l.sku === line.sku ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) } : l))
                              )
                            }
                            className="h-8 w-20"
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min={0}
                            value={line.unitPrice}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) => (l.sku === line.sku ? { ...l, unitPrice: Math.max(0, Number(e.target.value) || 0) } : l))
                              )
                            }
                            className="h-8 w-24"
                          />
                        </td>
                        <td className="p-2 text-right tabular-nums">{formatMoney(line.quantity * line.unitPrice)}</td>
                        <td className="p-2 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setLines((prev) => prev.filter((l) => l.sku !== line.sku))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex justify-between p-2 text-xs text-muted-foreground">
                <span>{totalExpected} units expected</span>
                <span>value {formatMoney(totalValue)} @ cost</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : `Create PO (${totalExpected} units)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}