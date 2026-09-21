"use client";

// ---------------------------------------------------------------------------
// app/page.tsx
//
// Entry gate. Redirects based on the live auth state:
//   - session loading -> splash
//   - signed out      -> /login
//   - signed in       -> /dashboard
//   - Firebase unconfigured -> actionable setup screen (no blank crash)
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, TriangleAlert } from "lucide-react";

export default function HomePage() {
  const { user, loading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (error) return; // stay on the setup screen below
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, error, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-lg rounded-lg border border-warning/50 bg-warning/10 p-6">
          <div className="flex items-center gap-2 text-warning">
            <TriangleAlert className="h-5 w-5" />
            <h1 className="text-base font-semibold">Application could not start</h1>
          </div>
          <p className="mt-3 whitespace-pre-line text-sm text-foreground">{error.message}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            After fixing the configuration, refresh the page. No code changes are needed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Bootstrapping retail workspace…</span>
      </div>
    </div>
  );
}