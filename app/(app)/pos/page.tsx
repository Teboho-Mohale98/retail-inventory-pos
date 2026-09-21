import type { Metadata } from "next";
import { POSCheckout } from "@/components/POSCheckout";

export const metadata: Metadata = { title: "Point of Sale" };

export default function POSPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Point of Sale & Picking</h1>
        <p className="text-sm text-muted-foreground">
          Barcode-driven checkout. Each scan deducts stock in real time with a full audit trail.
        </p>
      </div>
      <POSCheckout />
    </div>
  );
}