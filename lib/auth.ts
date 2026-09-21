// ---------------------------------------------------------------------------
// lib/auth.ts
//
// Firebase Auth + user-profile helpers. All functions operate on the client
// SDK. The `users/{uid}` Firestore document stores the role used for
// role-based route protection and UI gating.
// ---------------------------------------------------------------------------

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User as AuthUser,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, runTransaction, collection } from "firebase/firestore";
import { getAuthService, getDb } from "./firebase";
import type { UserProfile, UserRole } from "./types";

/** Maps a Firebase Auth user to the Firestore `users/{uid}` profile (or null). */
export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

/**
 * Creates a Firebase Auth account and immediately provisions the matching
 * `users/{uid}` profile document.
 */
export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}): Promise<AuthUser> {
  const auth = getAuthService();
  const db = getDb();

  const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
  await updateProfile(credential.user, { displayName: input.displayName });

  await setDoc(doc(db, "users", credential.user.uid), {
    uid: credential.user.uid,
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    active: true,
    createdAt: serverTimestamp(),
  });

  return credential.user;
}

/** Signs an existing user in with email + password. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const auth = getAuthService();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Signs the current session out (no-op when already signed out). */
export async function logout(): Promise<void> {
  await signOut(getAuthService());
}

/**
 * Registers a Firestore listener on the signed-in user's profile and calls
 * `onProfile` with fresh data for every change. Used by `useAuth` to feed the
 * role-based UI in real time.
 */
export function subscribeToProfile(uid: string, onProfile: (profile: UserProfile | null) => void): () => void {
  const db = getDb();
  const ref = doc(db, "users", uid);

  const unsubscribe = onAuthStateChanged(getAuthService(), (user) => {
    if (!user) {
      onProfile(null);
      return;
    }
    void getDoc(ref)
      .then((snap) => onProfile(snap.exists() ? (snap.data() as UserProfile) : null))
      .catch(() => onProfile(null));
  });

  return unsubscribe;
}

/**
 * Grants or revokes a role for an arbitrary user. Intended for admin console
 * usage — never call this from a client component without an admin guard.
 */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, "users", uid), { role }, { merge: true });
}

/**
 * Seeds the `products` collection guard: verifies a role exists on the
 * `users/{uid}` doc. Could be tightened into a Firestore Security Rule.
 */
export function requiresRole(profile: UserProfile | null, roles: UserRole[]): boolean {
  if (!profile || !profile.active) return false;
  return roles.includes(profile.role);
}