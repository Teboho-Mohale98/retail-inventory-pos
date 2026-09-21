"use client";

// ---------------------------------------------------------------------------
// app/(app)/purchase-orders/page.tsx
//
// Purchase-order board for admins (create) and the receiving team (track +
// close). Lists live documents with status badges and inline 3-Way match
// feedback.
// ---------------------------------------------------------------------------

import React, { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { CreatePurchaseOrderDialog } from "@/components/CreatePurchaseOrderDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/utils";
import type { PurchaseOrder } from "@/lib/types";

export default function PurchaseOrdersPage() {
  const { profile } = useAuth();
  const { orders, loading, getMatchReport } = usePurchaseOrders(100);
  const [createOpen, setCreateOpen] = useState(false);

  const isAdmin = profile?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">Order → receive → invoice. Live from Firestore.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New PO
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading purchase orders…</p>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <CardTitle>No purchase orders yet</CardTitle>
            <CardDescription>{isAdmin ? "Create your first PO to start the receiving flow." : "Ask an admin to create a purchase order."}</CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((po) => (
            <OrderCard key={po.poNumber} po={po} matchStatus={getMatchReport(po).status} />
          ))}
        </div>
      )}

      <CreatePurchaseOrderDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function OrderCard({ po, matchStatus }: { po: PurchaseOrder; matchStatus: "matched" | "mismatch" | "pending" }) {
  const totalExpected = po.items.reduce((a, i) => a + i.quantityExpected, 0);
  const totalReceived = po.items.reduce((a, i) => a + i.quantityReceived, 0);
  const value = po.items.reduce((a, i) => a + i.quantityExpected * i.unitPrice, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-base">{po.poNumber}</CardTitle>
          <StatusBadge status={po.status} />
        </div>
        <CardDescription>
          {po.vendor} · created {formatDate(po.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Received</span>
          <span className="font-medium tabular-nums">
            {totalReceived}/{totalExpected} units
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">PO value (cost)</span>
          <span className="font-medium tabular-nums">{formatMoney(value)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">3-Way match</span>
          <MatchPill status={matchStatus} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PurchaseOrder["status"] }) {
  const variant =
    status === "received" ? "success" : status === "partial" ? "warning" : status === "cancelled" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function MatchPill({ status }: { status: "matched" | "mismatch" | "pending" }) {
  const variant = status === "matched" ? "success" : status === "mismatch" ? "destructive" : "warning";
  return <Badge variant={variant}>{status}</Badge>;
}