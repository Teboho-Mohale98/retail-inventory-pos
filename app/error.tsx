"use client";

// ---------------------------------------------------------------------------
// app/error.tsx
//
// App Router error boundary (segment level). Converts an unexpected
// client-side exception into a readable, rebootable screen instead of the
// bare "Application error" overlay.
// ---------------------------------------------------------------------------

import React, { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Intentionally loud: the actual stack should reach the console for the
    // operator to copy when reporting an issue.
    console.error("Retail POS crashed:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-destructive/50 bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A client-side exception occurred. The details are in the browser console (F12 → Console).
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Error digest: {error.digest}</p>
        )}
        <div className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
          {error.message || "Unknown error"}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => (window.location.href = "/")}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}