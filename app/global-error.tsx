"use client";

// ---------------------------------------------------------------------------
// app/global-error.tsx
//
// Root error boundary — catches anything not caught by segment boundaries,
// including `app/layout.tsx`. Must render its own <html>/<body> because the
// root layout itself may be the source of the failure.
// ---------------------------------------------------------------------------

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "hsl(222.2 84% 4.9%)", color: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 480, width: "100%", background: "#0b1220", border: "1px solid rgba(248,113,113,.4)", borderRadius: 8, padding: 24 }}>
            <h1 style={{ margin: 0, fontSize: 18 }}>Application error</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: "#94a3b8" }}>
              A client-side exception occurred. Check the browser console for details.
            </p>
            <p style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>
              {error.digest ? `Error digest: ${error.digest}` : error.message}
            </p>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                onClick={reset}
                style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#f8fafc", color: "#0b1220", fontSize: 14, cursor: "pointer" }}
              >
                Try again
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#f8fafc", fontSize: 14, cursor: "pointer" }}
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}