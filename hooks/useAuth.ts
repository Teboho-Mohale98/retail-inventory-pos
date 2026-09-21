// ---------------------------------------------------------------------------
// hooks/useAuth.ts
//
// React hook exposing authentication state + the Firestore user profile with
// role. Subscribes to Firebase Auth and the `users/{uid}` document so role
// changes are reflected immediately without a page refresh.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getAuthService, getFirebaseConfigError, isFirebaseConfigured } from "@/lib/firebase";
import { fetchUserProfile } from "@/lib/auth";
import type { UserProfile } from "@/lib/types";

export interface UseAuthState {
  /** Firebase Auth user (null when signed out / still loading). */
  user: User | null;
  /** Firestore role profile document. */
  profile: UserProfile | null;
  /** True until the initial session check resolves. */
  loading: boolean;
  /** Non-fatal auth/profile error to surface to the UI. */
  error: Error | null;
  hasRole: (...roles: UserProfile["role"][]) => boolean;
}

/**
 * Subscribes to the current authentication + profile state.
 *
 * ```ts
 * const { user, profile, loading, hasRole } = useAuth();
 * ```
 */
export function useAuth(): UseAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    // Guard BEFORE touching the SDK: a missing/deployed-without-env Firebase
    // config must not crash the app — it surfaces as `error` for the UI.
    if (!isFirebaseConfigured()) {
      setError(new Error(getFirebaseConfigError() ?? "Firebase is not configured."));
      setLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(getAuthService(), async (firebaseUser) => {
      if (!firebaseUser) {
        if (active) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      setUser(firebaseUser);
      try {
        const fetched = await fetchUserProfile(firebaseUser.uid);
        if (active) {
          setProfile(fetched);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err : new Error("Failed to load user profile."));
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribeAuth();
    };
  }, []);

  const hasRole = (...roles: UserProfile["role"][]): boolean => {
    if (!profile || !profile.active) return false;
    return roles.includes(profile.role);
  };

  return { user, profile, loading, error, hasRole };
}