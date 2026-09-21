import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Live valuation, top movers and activity — updated the instant a scan happens anywhere.
        </p>
      </div>
      <Dashboard />
    </div>
  );
}