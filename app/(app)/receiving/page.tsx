import type { Metadata } from "next";
import { ReceivingBay } from "@/components/ReceivingBay";

export const metadata: Metadata = { title: "Receiving Bay" };

export default function ReceivingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Receiving Bay (Inbound)</h1>
        <p className="text-sm text-muted-foreground">
          Scan supplier shipments in against open purchase orders. Expected vs received reconciled with
          tolerance-based 3-Way matching.
        </p>
      </div>
      <ReceivingBay />
    </div>
  );
}