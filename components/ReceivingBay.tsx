// ---------------------------------------------------------------------------
// components/ReceivingBay.tsx
//
// Real-time inbound dock. Workflows:
//   1. Pick an open purchase order from the live board.
//   2. Scan a barcode (set as `SKU|EAN|QTY` chained scans or press buttons).
//   3. Watch the received-vs-expected progress update instantly with stock.
//   4. Post the supplier invoice to run 3-Way Matching vs PO + goods received.
//
// Error handling: over-receipts are blocked at the transaction layer and every
// failure surfaces with the exact reason (unknown barcode, PO mismatch, qty).
// ---------------------------------------------------------------------------

"use client";

import React, { useCallback, useMemo, useState } from "react";
import { CheckCircle2, PackageCheck, TriangleAlert, XCircle } from "lucide-react";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useInventory } from "@/hooks/useInventory";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, isValidBarcode } from "@/lib/utils";
import { BarcodeScanner, type ScanSource } from "@/components/BarcodeScanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PurchaseOrder } from "@/lib/types";
import type { ThreeWayMatchResult } from "@/lib/purchaseOrders";

export function ReceivingBay() {
  const { orders, openOrders, loading, receiveLine, completeOrder, busy, actionError, getMatchReport, statusOf } =
    usePurchaseOrders();
  const inventory = useInventory(20);
  const { profile } = useAuth();

  const [activePo, setActivePo] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [receivingSku, setReceivingSku] = useState<string | null>(null);
  const [invoice, setInvoice] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selected: PurchaseOrder | null = useMemo(
    () => orders.find((o) => o.poNumber === activePo) ?? null,
    [orders, activePo]
  );

  const match: ThreeWayMatchResult | null = selected ? getMatchReport(selected) : null;

  const pick = (poNumber: string) => {
    setActivePo(poNumber);
    setReceivingSku(null);
    setFeedback(null);
    setQty(1);
  };

  const currentItem = selected?.items.find((it) => it.sku === receivingSku) ?? null;

  // Scanner entry: accept either a plain barcode (auto-match a line) or a
  // chained `EAN|QTY` string that some logistics handhelds emit.
  const handleScan = useCallback(
    (code: string, _source: ScanSource) => {
      if (!selected) {
        setFeedback({ tone: "error", text: "Pick a purchase order first — scan against an open PO only." });
        return;
      }
      if (!isValidBarcode(code)) {
        setFeedback({ tone: "error", text: `"${code}" is not a valid barcode.` });
        return;
      }

      const [ean, maybeQty] = code.split("|");
      const parsedQty = maybeQty ? Math.max(1, parseInt(maybeQty, 10) || 1) : 1;

      const line = selected.items.find((it) => it.ean === ean || it.sku === ean);
      if (!line) {
        setFeedback({ tone: "error", text: `Barcode ${ean} does not appear on ${selected.poNumber}.` });
        return;
      }

      setReceivingSku(line.sku);
      setQty(parsedQty);
      setFeedback({ tone: "success", text: `Queued ${line.name} × ${parsedQty} — confirm to receive.` });
    },
    [selected]
  );

  const receive = async () => {
    if (!selected || !receivingSku || qty <= 0) return;
    try {
      await receiveLine({
        poNumber: selected.poNumber,
        sku: receivingSku,
        quantityReceived: qty,
        scannerEan: currentItem?.ean,
      });
      setFeedback({ tone: "success", text: `Received ${qty}× ${receivingSku} — stock is live.` });
    } catch (err) {
      setFeedback({ tone: "error", text: err instanceof Error ? err.message : "Receive failed." });
    }
  };

  const complete = async () => {
    if (!selected) return;
    try {
      await completeOrder(selected.poNumber, invoice.trim());
      setFeedback({ tone: "success", text: `${selected.poNumber} closed with invoice ${invoice}.` });
    } catch (err) {
      setFeedback({ tone: "error", text: err instanceof Error ? err.message : "Close failed." });
    }
  };

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading purchase orders…</p>;
  }

  if (openOrders.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <PackageCheck className="h-10 w-10 text-muted-foreground" />
          <CardTitle>No open purchase orders</CardTitle>
          <CardDescription>Create a purchase order as an admin, then receiving scans turn into stock here.</CardDescription>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Inbound error</AlertTitle>
          <AlertDescription>{actionError.message}</AlertDescription>
        </Alert>
      )}
      {feedback && (
        <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
          <AlertTitle>{feedback.tone === "error" ? "Not received" : "Queued"}</AlertTitle>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------- PO board */}
        <Card>
          <CardHeader>
            <CardTitle>Open purchase orders</CardTitle>
            <CardDescription>Orders still awaiting goods.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {openOrders.map((po) => (
              <button
                key={po.poNumber}
                onClick={() => pick(po.poNumber)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  activePo === po.poNumber ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{po.poNumber}</span>
                  <Badge variant={po.status === "partial" ? "warning" : "secondary"}>{po.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{po.vendor}</p>
                <p className="text-xs text-muted-foreground">
                  {po.items.reduce((a, i) => a + i.quantityReceived, 0)}/{po.items.reduce((a, i) => a + i.quantityExpected, 0)} units in
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* ------------------------------------------------- receiving deck */}
        <div className="lg:col-span-2">
          {!selected ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Select a purchase order to begin receiving.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-mono">{selected.poNumber}</CardTitle>
                    <CardDescription>
                      {selected.vendor} {selected.invoiceNumber ? `· invoice ${selected.invoiceNumber}` : ""}
                    </CardDescription>
                  </div>
                  <MatchBadge match={match} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* active line scanner */}
                <div className="rounded-md border bg-muted/40 p-3">
                  <BarcodeScanner onScan={handleScan} label={`Receive against ${selected.poNumber}`} />
                  {currentItem && (
                    <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
                      <div className="min-w-[160px] flex-1">
                        <p className="text-sm font-medium">{currentItem.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{currentItem.sku}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Button>
                        <Input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                          className="w-20 text-center"
                          aria-label="Quantity to receive"
                        />
                        <Button size="icon" variant="outline" onClick={() => setQty((q) => q + 1)}>+</Button>
                      </div>
                      <Button variant="success" onClick={() => void receive()} disabled={busy || qty <= 0}>
                        {busy ? "Posting…" : `Receive ${qty}×`}
                      </Button>
                    </div>
                  )}
                </div>

                {/* line progress */}
                <div className="space-y-3">
                  {selected.items.map((item) => {
                    const remaining = item.quantityExpected - item.quantityReceived;
                    const pct = Math.round((item.quantityReceived / item.quantityExpected) * 100);
                    const done = item.quantityReceived >= item.quantityExpected;
                    return (
                      <div key={item.sku} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {item.sku} · EAN {item.ean}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {item.quantityReceived}/{item.quantityExpected}
                              {done && <CheckCircle2 className="ml-1 inline h-4 w-4 text-success" />}
                            </p>
                            <p className="text-xs text-muted-foreground">{formatMoney(item.unitPrice * remaining)} due</p>
                          </div>
                        </div>
                        <Progress value={pct} className="mt-2" />
                      </div>
                    );
                  })}
                </div>

                {/* invoice + 3-way matching */}
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-sm font-medium">Supplier invoice (3-Way Matching)</p>
                  <div className="flex gap-2">
                    <Input
                      value={invoice}
                      onChange={(e) => setInvoice(e.target.value)}
                      placeholder="e.g. INV-2026-4417"
                    />
                    <Button variant="secondary" onClick={() => void complete()} disabled={busy || !invoice.trim()}>
                      Post &amp; close
                    </Button>
                  </div>
                  {match && match.lines.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs">
                      {match.lines.map((l) => (
                        <p key={l.sku} className="flex items-center justify-between">
                          <span className="font-mono">{l.sku}</span>
                          <span className={l.matched ? "text-success" : "text-destructive"}>
                            {l.matched ? "≤ tolerance" : "Δ mismatch"} (received {l.received} vs expected {l.expected})
                          </span>
                        </p>
                      ))}
                      {match.note && <p className="text-muted-foreground">{match.note}</p>}
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Status: <Badge variant={statusOf(selected.poNumber) === "partial" ? "warning" : "secondary"}>{statusOf(selected.poNumber)}</Badge>
                  {selected.poNumber && statusOf(selected.poNumber) === "received" && " · PO fully received"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {inventory.offline && (
        <Alert variant="warning">
          <AlertTitle>Offline mode</AlertTitle>
          <AlertDescription>Real-time sync paused. Scans queue locally &amp; will reconcile on reconnect.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function MatchBadge({ match }: { match: ThreeWayMatchResult | null }) {
  if (!match) return null;
  if (match.status === "matched")
    return (
      <Badge variant="success">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Matched
      </Badge>
    );
  if (match.status === "mismatch")
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" /> Mismatch
      </Badge>
    );
  return (
    <Badge variant="warning">
      <TriangleAlert className="mr-1 h-3 w-3" /> Pending
    </Badge>
  );
}