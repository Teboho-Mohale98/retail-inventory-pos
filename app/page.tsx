"use client";

// ---------------------------------------------------------------------------
// app/page.tsx
//
// Entry gate. Redirects based on the live auth state:
//   - session loading -> splash
//   - signed out      -> /login
//   - signed in       -> /dashboard
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Bootstrapping retail workspace…</span>
      </div>
    </div>
  );
}