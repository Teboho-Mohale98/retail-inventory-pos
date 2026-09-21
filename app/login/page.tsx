"use client";

// ---------------------------------------------------------------------------
// app/login/page.tsx
//
// Authentication screen: sign in OR self-register with a role. In production
// you typically disable self-registration (Firestore Security Rules + an
// admin-invited flow); this scaffold keeps it for demo convenience and the
// README explains how to lock it down.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StoreIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { login, registerUser, logout } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ROLES: UserRole[] = ["admin", "receiving_bay", "store_picker"];

export default function LoginPage() {
  const { user, loading, error: authError } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("store_picker");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !loading) router.replace("/dashboard");
  }, [user, loading, router]);

  // If Firebase env wasn't configured, both hooks will surface it; this extra
  // guard keeps the alert visible even before the auth listener settles.
  const envError = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ? null
    : "Firebase is not configured. Create `.env.local` from `.env.example` and restart `npm run dev`.";

  const effectiveError = envError ?? error ?? (authError ? authError.message : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        await login(email, password);
      } else {
        await registerUser({ email, password, displayName, role });
      }
      // useAuth listener flips `user` -> effect redirects.
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setError(decodeFirebaseError(code, err instanceof Error ? err.message : "Authentication failed."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <StoreIcon className="h-9 w-9" />
          <h1 className="text-2xl font-bold">Retail Inventory & POS</h1>
          <p className="text-sm text-muted-foreground">Real-time cloud retail operations.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Operator access</CardTitle>
            <CardDescription>Sign in with the account your team manager provisioned.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "register")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              {effectiveError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Unable to continue</AlertTitle>
                  <AlertDescription>{effectiveError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
                {mode === "register" && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Display name</Label>
                    <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jordan Mesa" required />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opies@retail.app" required autoComplete="email" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} />
                </div>

                {mode === "register" && (
                  <div className="space-y-2">
                    <Label>Team role</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {user ? (
            <button className="underline" onClick={() => void logout()}>
              Signed in — sign out to switch
            </button>
          ) : (
            "Demo: register an admin to create products & purchase orders."
          )}
        </p>
      </div>
    </div>
  );
}

function decodeFirebaseError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists for this email — sign in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/network-request-failed":
      return "Network is offline — check your connection.";
    default:
      return fallback;
  }
}