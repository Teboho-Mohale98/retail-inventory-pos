"use client";

// ---------------------------------------------------------------------------
// app/page.tsx
//
// Entry gate. Redirects based on the live auth state:
//   - session loading -> splash
//   - signed out      -> /login
//   - signed in       -> /dashboard
//   - startup problem -> actionable error screen (never a blank crash)
//
// The error screen is written to be directly actionable: it detects the two
// common startup failures (missing Firebase env vars, Firestore not created
// yet) and hands the operator a Retry button + the exact console panel.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { isFirebaseConfigured } from "@/lib/firebase";
import { Loader2, RefreshCw, TriangleAlert, ExternalLink } from "lucide-react";

function isOfflineError(message: string) {
  return /offline|network|failed to fetch|load failed/i.test(message);
}

export default function HomePage() {
  const { user, loading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (error) return; // stay on the setup screen below
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, error, router]);

  if (error) {
    const message = error.message;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const firestorePanel = projectId
      ? `https://console.firebase.google.com/project/${projectId}/firestore`
      : "https://console.firebase.google.com";

    const unconfigured = !isFirebaseConfigured();
    const needsDb = isOfflineError(message);
    const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-lg rounded-lg border border-warning/50 bg-warning/10 p-6">
          <div className="flex items-center gap-2 text-warning">
            <TriangleAlert className="h-5 w-5" />
            <h1 className="text-base font-semibold">Application could not start</h1>
          </div>

          {offlineNow ? (
            <p className="mt-3 text-sm text-foreground">
              Your device has no internet connection. Reconnect and hit <span className="font-semibold">Retry</span>.
            </p>
          ) : unconfigured ? (
            <div className="mt-3 space-y-3 text-sm text-foreground">
              <p>Firebase isn&apos;t configured in this deployment:</p>
              <p className="whitespace-pre-line text-muted-foreground">{message}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>On Vercel: add the six <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> environment variables.</li>
                <li>Locally: copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> and fill in your Firebase values.</li>
              </ol>
            </div>
          ) : needsDb ? (
            <div className="mt-3 space-y-3 text-sm text-foreground">
              <p>
                The backend database isn&apos;t reachable: <span className="text-muted-foreground">{message}</span>
              </p>
              <p>This almost always means the Firestore database hasn&apos;t been created for this project yet.</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Open the{" "}
                  <a className="font-medium text-primary underline" href={firestorePanel} target="_blank" rel="noreferrer">
                    Firestore panel in Firebase {projectId ? (
                    <ExternalLink className="inline h-3 w-3" />
                  ) : null}</a>{" "}
                  and click <span className="font-semibold">Create database</span> (start in production mode).
                </li>
                <li>Deploy the included security rules with <code className="font-mono">firebase deploy --only firestore:rules,firestore:indexes</code>.</li>
                <li>Then come back and retry.</li>
              </ol>
            </div>
          ) : (
            <p className="mt-3 text-sm text-foreground">
              <span className="text-muted-foreground">{message}</span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
            {!offlineNow && !unconfigured && needsDb && projectId && (
              <a
                href={firestorePanel}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Open Firebase console <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
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