// ---------------------------------------------------------------------------
// components/POSCheckout.tsx
//
// Dedicated Point-of-Sale & Picking terminal. Wires the hardware BarcodeScanner
// straight into the `useCart` hook so every scan either adds a line to the
// basket or surfaces a clear "barcode not found / offline" message.
//
// Checkout runs the transactional OUTBOUND stock deduction from useCart and
// renders a confirmation with the receipt id.
// ---------------------------------------------------------------------------

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Receipt, Trash2, Minus, Plus, XCircle } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useInventory } from "@/hooks/useInventory";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, isValidBarcode } from "@/lib/utils";
import { BarcodeScanner, type ScanSource } from "@/components/BarcodeScanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ReceiptConfirmation {
  receiptId: string;
  totalCents: number;
  itemCount: number;
}

export function POSCheckout() {
  const cart = useCart();
  const { findProductByBarcode, products } = useInventory(50);
  const { user, profile } = useAuth();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [receipt, setReceipt] = useState<ReceiptConfirmation | null>(null);
  const [manualSku, setManualSku] = useState("");
  const beepRef = useRef<HTMLAudioElement | null>(null);

  // Offline-ready beep: generate a tiny WebAudio blip instead of bundling audio.
  const playBeep = useCallback((ok: boolean) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.12 : 0.25));
    } catch {
      /* audio unavailable — silent mode */
    }
  }, []);

  // Bring products back into "scan -> cart" flow; unknown barcodes produce a
  // descriptive alert instead of crashing the terminal.
  const handleScan = useCallback(
    (code: string, _source: ScanSource) => {
      if (!isValidBarcode(code)) {
        setMessage({ tone: "error", text: `"${code}" is not a valid barcode.` });
        return;
      }
      const product = findProductByBarcode(code);
      if (!product) {
        playBeep(false);
        setMessage({ tone: "error", text: `Barcode ${code} not found in the article master.` });
        return;
      }
      playBeep(true);
      cart.add(product);
      setMessage({ tone: "success", text: `Added ${product.name} (${product.sku}).` });
    },
    [findProductByBarcode, cart, playBeep]
  );

  useEffect(() => {
    // Keep the scanner channel cold when the receipt shows.
    setMessage(null);
  }, [cart.lines.length]);

  const runCheckout = async () => {
    setMessage(null);
    setReceipt(null);
    try {
      const result = await cart.checkout(user?.uid, profile?.defaultLocationId);
      setReceipt(result);
      playBeep(true);
    } catch (err) {
      playBeep(false);
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Checkout failed." });
    }
  };

  const addBySku = () => {
    const sku = manualSku.trim().toUpperCase();
    if (!sku) return;
    const product = findProductByBarcode(sku) ?? Array.from(products.values()).find((p) => p.sku === sku);
    if (!product) {
      setMessage({ tone: "error", text: `SKU "${sku}" not found.` });
      return;
    }
    cart.add(product);
    setManualSku("");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ------------------------------------------------ scanner + basket */}
      <div className="space-y-6 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Scan items</CardTitle>
            <CardDescription>Point the camera or use a USB scanner — each hit lands straight in the basket.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={manualSku}
                onChange={(e) => setManualSku(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && addBySku()}
                placeholder="Manual SKU lookup…"
              />
              <Button variant="secondary" onClick={addBySku} disabled={!manualSku}>
                Look up
              </Button>
            </div>
            <BarcodeScanner onScan={handleScan} label="Checkout scanner" />
          </CardContent>
        </Card>

        {message && (
          <Alert variant={message.tone === "error" ? "destructive" : "default"}>
            <AlertTitle className="flex items-center gap-2">
              {message.tone === "error" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {message.tone === "error" ? "Scan rejected" : "Item added"}
            </AlertTitle>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Basket</CardTitle>
            <CardDescription>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent>
            {cart.lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Scan a barcode or look up a SKU to begin the sale.
              </p>
            ) : (
              <ul className="divide-y">
                {cart.lines.map((line) => (
                  <li key={line.product.sku} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{line.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.product.sku} · {formatMoney(line.product.price)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => cart.setQuantity(line.product.sku, line.quantity - 1)}>
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-8 text-center font-semibold tabular-nums">{line.quantity}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => cart.add(line.product)}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="w-20 text-right font-semibold tabular-nums">
                      {formatMoney(line.product.price * line.quantity)}
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => cart.remove(line.product.sku)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------- summary */}
      <div className="lg:col-span-2">
        <Card className="sticky top-24">
          <CardHeader>
            <CardTitle>Sale summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Items</span>
              <span className="font-medium">{cart.itemCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">{formatMoney(cart.subtotalCents)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="text-2xl font-bold tabular-nums">{formatMoney(cart.subtotalCents)}</span>
            </div>

            <Button
              className="w-full"
              size="lg"
              variant="success"
              onClick={() => void runCheckout()}
              disabled={cart.lines.length === 0 || cart.busy}
            >
              {cart.busy ? "Processing…" : cart.lines.length === 0 ? "Basket is empty" : `Charge ${formatMoney(cart.subtotalCents)}`}
            </Button>

            {cart.lastError && (
              <p className="text-xs text-destructive">Last attempt failed: {cart.lastError.message}</p>
            )}

            {receipt && (
              <Alert className="border-success">
                <AlertTitle className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" /> Sale complete
                </AlertTitle>
                <AlertDescription>
                  Receipt <span className="font-mono">{receipt.receiptId}</span> for {formatMoney(receipt.totalCents)} with{" "}
                  {receipt.itemCount} units. Stock deducted in real time.
                </AlertDescription>
              </Alert>
            )}

            {cart.itemCount === 0 && Object.keys(products).length === 0 && (
              <p className="text-xs text-warning">
                No products in the database yet. Create articles from the Inventory page first.
              </p>
            )}

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              Scans work fully offline; stock movements queue until Firestore reconnects.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}