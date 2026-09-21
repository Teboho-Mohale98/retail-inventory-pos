"use client";

// ---------------------------------------------------------------------------
// app/(app)/layout.tsx
//
// Authenticated application shell. Gate + role-aware navigation rail:
//   - admin            : everything (master data, POS, receiving, POs)
//   - store_picker     : POS + inventory read + dashboard
//   - receiving_bay    : receiving + POs + dashboard
//
// Renders an offline banner when Firestore connectivity drops so operators
// never mistake cached data for a broken screen.
// ---------------------------------------------------------------------------

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  FileText,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  ShoppingCart,
  Store,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useInventory } from "@/hooks/useInventory";
import { logout } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS: Array<{ href: string; label: string; icon: React.ReactNode; roles: Array<"admin" | "store_picker" | "receiving_bay"> }> = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, roles: ["admin", "store_picker", "receiving_bay"] },
  { href: "/inventory", label: "Inventory", icon: <Boxes className="h-4 w-4" />, roles: ["admin", "store_picker"] },
  { href: "/pos", label: "Point of Sale", icon: <ShoppingCart className="h-4 w-4" />, roles: ["admin", "store_picker"] },
  { href: "/receiving", label: "Receiving Bay", icon: <PackageCheck className="h-4 w-4" />, roles: ["admin", "receiving_bay"] },
  { href: "/purchase-orders", label: "Purchase Orders", icon: <FileText className="h-4 w-4" />, roles: ["admin", "receiving_bay"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const { offline } = useInventory(5);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (!user) return null; // redirect effect above takes over.

  const visible = NAV_ITEMS.filter((item) => profile && item.roles.includes(profile.role));

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <Store className="h-5 w-5" />
          <div>
            <p className="text-sm font-bold leading-tight">Retail POS</p>
            <p className="text-[11px] text-muted-foreground">real-time inventory</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visible.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{profile?.displayName ?? "Operator"}</p>
              <Badge variant="outline" className="mt-1">
                {profile ? ROLE_LABELS[profile.role] : "…"}
              </Badge>
            </div>
            <Button size="icon" variant="ghost" onClick={() => void logout()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-40 border-b bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="font-bold">Retail POS</span>
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>

      {/* content */}
      <main className="flex-1 px-4 pb-16 pt-16 md:ml-60 md:px-8 md:pt-8">
        {offline && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <WifiOff className="h-4 w-4 text-warning" />
            Offline — showing cached data. Changes will sync when the connection returns.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}