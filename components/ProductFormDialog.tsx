// ---------------------------------------------------------------------------
// components/ProductFormDialog.tsx
//
// Create/edit dialog for the Article Master Data. Validates input with Zod,
// auto-generates SKU + EAN-13 when blank, and routes through the lib layer
// (which owns the Firestore write + opening-balance movement).
// ---------------------------------------------------------------------------

"use client";

import React, { useState } from "react";
import { z } from "zod";
import { createProduct, updateProduct, type ProductInput } from "@/lib/products";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import type { Product } from "@/lib/types";
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

/** Per-field rules. All prices in minor units (cents). */
const productSchema = z.object({
  name: z.string().trim().min(2, "Product name must be at least 2 characters."),
  sku: z.string().trim().toUpperCase().optional(),
  ean: z.coerce.string().regex(/^\d{8,14}$/, "EAN must be 8–14 digits.").optional().or(z.literal("")),
  category: z.string().min(1, "Pick a category."),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1, "Unit is required (e.g. each, box of 12)."),
  defaultShelf: z.string().trim().optional(),
  priceCents: z.coerce.number().int().nonnegative("Price cannot be negative.").positive("Price must be greater than zero."),
  costPriceCents: z.coerce.number().int().nonnegative("Cost cannot be negative."),
  minStockThreshold: z.coerce.number().int().nonnegative(),
  openingStock: z.coerce.number().int().nonnegative().default(0),
});

export type ProductFormValues = z.infer<typeof productSchema>;

export interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this product instead of creating a new one. */
  editing?: Product | null;
  onSaved?: () => void;
}

export function ProductFormDialog({ open, onOpenChange, editing, onSaved }: ProductFormDialogProps) {
  const [values, setValues] = useState<Partial<ProductFormValues>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed the form whenever the dialog opens or switches products.
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    if (editing) {
      setValues({
        name: editing.name,
        sku: editing.sku,
        ean: editing.ean,
        category: editing.category,
        brand: editing.brand ?? "",
        unit: editing.unit,
        defaultShelf: editing.defaultShelf ?? "",
        priceCents: editing.price,
        costPriceCents: editing.costPrice,
        minStockThreshold: editing.minStockThreshold,
      });
    } else {
      setValues({
        category: PRODUCT_CATEGORIES[0],
        unit: "each",
        priceCents: 0,
        costPriceCents: 0,
        minStockThreshold: 5,
        openingStock: 0,
      });
    }
  }, [open, editing]);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async () => {
    setSubmitError(null);
    const parsed = productSchema.safeParse(values);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const field = String(issue.path[0] ?? "form");
        flat[field] = flat[field] ?? issue.message;
      });
      setErrors(flat);
      return;
    }

    setBusy(true);
    try {
      const input: ProductInput = {
        name: parsed.data.name,
        sku: parsed.data.sku,
        ean: parsed.data.ean || undefined,
        category: parsed.data.category,
        brand: parsed.data.brand || undefined,
        unit: parsed.data.unit,
        defaultShelf: parsed.data.defaultShelf || undefined,
        price: parsed.data.priceCents,
        costPrice: parsed.data.costPriceCents,
        minStockThreshold: parsed.data.minStockThreshold,
      };

      if (editing) {
        await updateProduct(editing.sku, input as unknown as Product);
      } else {
        await createProduct({ ...input, totalStock: parsed.data.openingStock });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save product.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.sku}` : "New product"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update article master data. Stock counts are managed from the POS / receiving bay."
              : "Register a new article. Blank SKU / EAN fields are generated automatically."}
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <Alert variant="destructive">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product name" error={errors.name} className="sm:col-span-2">
            <Input
              value={values.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Wireless Mouse Pro"
            />
          </Field>

          <Field label="SKU (optional — auto-generated)" error={errors.sku} hint="Uppercase, unique">
            <Input
              value={values.sku ?? ""}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="APR-7F2K1Q"
              disabled={!!editing}
            />
          </Field>

          <Field label="EAN / barcode (optional)" error={errors.ean} hint="8–14 digits; generates EAN-13 if empty">
            <Input value={values.ean ?? ""} onChange={(e) => set("ean", e.target.value.replace(/\D/g, ""))} placeholder="1234567890123" />
          </Field>

          <Field label="Category" error={errors.category}>
            <Select value={values.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Unit" error={errors.unit}>
            <Input value={values.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="each" />
          </Field>

          <Field label="Brand" error={errors.brand}>
            <Input value={values.brand ?? ""} onChange={(e) => set("brand", e.target.value)} placeholder="Optional" />
          </Field>

          <Field label="Default shelf" error={errors.defaultShelf} hint="e.g. A-01-02">
            <Input value={values.defaultShelf ?? ""} onChange={(e) => set("defaultShelf", e.target.value)} />
          </Field>

          <Field label="Retail price (cents)" error={errors.priceCents}>
            <Input
              type="number"
              min={0}
              value={values.priceCents ?? 0}
              onChange={(e) => set("priceCents", Number(e.target.value))}
            />
          </Field>

          <Field label="Cost price (cents)" error={errors.costPriceCents}>
            <Input
              type="number"
              min={0}
              value={values.costPriceCents ?? 0}
              onChange={(e) => set("costPriceCents", Number(e.target.value))}
            />
          </Field>

          <Field label="Min stock threshold" error={errors.minStockThreshold} hint="Low-stock alert fires at or below this">
            <Input
              type="number"
              min={0}
              value={values.minStockThreshold ?? 5}
              onChange={(e) => set("minStockThreshold", Number(e.target.value))}
            />
          </Field>

          {!editing && (
            <Field label="Opening stock" error={errors.openingStock} hint="Creates an ADJUSTMENT opening movement">
              <Input
                type="number"
                min={0}
                value={values.openingStock ?? 0}
                onChange={(e) => set("openingStock", Number(e.target.value))}
              />
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}