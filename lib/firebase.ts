// ---------------------------------------------------------------------------
// lib/firebase.ts
//
// Firebase SDK initialization for Authentication (Firebase Auth) and the
// real-time database (Cloud Firestore).
//
// This module is the single source of truth for the Firebase instance used
// across the whole application. It is safe to import from both client and
// server contexts; however, all Firestore SDK calls must happen on the client
// because we rely on `onSnapshot` real-time listeners.
// ---------------------------------------------------------------------------

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase Emulator endpoints (optional, for local offline development).
const EMULATOR_AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
const EMULATOR_FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST;

/**
 * Basic sanity check for the environment configuration. Instead of failing
 * silently with a cryptic Firebase error, we surface a clear message telling
 * the developer exactly which variable is missing.
 */
function assertConfig() {
  const required: Array<keyof typeof firebaseConfig> = [
    "apiKey",
    "authDomain",
    "projectId",
  ];

  const missing = required.filter((key) => !firebaseConfig[key]);

  if (missing.length > 0) {
    throw new Error(
      `Firebase is missing required config values: ${missing.join(", ")}.\n` +
        "Create a `.env.local` file from `.env.example` and populate it with the values from your Firebase Console."
    );
  }
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

// ---------------------------------------------------------------------------
// Singleton initialization
// ---------------------------------------------------------------------------

/**
 * Lazily creates (or re-uses) the Firebase App instance.
 */
function createApp(): FirebaseApp {
  // `getApps()` prevents hot-module-reload from stacking duplicate instances.
  if (getApps().length === 0) {
    assertConfig();
    return initializeApp(firebaseConfig);
  }
  return getApp();
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/**
 * Returns the singleton Firestore database handle.
 *
 * The modular JS SDK enables offline persistence (single-tab IndexedDB
 * caching) automatically, so `onSnapshot` listeners keep showing the last
 * synced state when the network drops and replay changes on reconnect.
 */
export function getDb(): Firestore {
  if (!db) {
    app = createApp();
    db = getFirestore(app);
  }
  return db!;
}

/**
 * Returns the singleton Firebase Auth handle.
 */
export function getAuthService(): Auth {
  if (!auth) {
    app = createApp();
    auth = getAuth(app);

    if (typeof window !== "undefined" && EMULATOR_AUTH_HOST) {
      // Dev-only: connect to the local Auth emulator.
      void import("firebase/auth").then(({ connectAuthEmulator }) => {
        connectAuthEmulator(auth as Auth, `http://${EMULATOR_AUTH_HOST}`);
      });
    }
  }
  return auth!;
}

// ---------------------------------------------------------------------------
// Emulator wiring for Firestore (dev-only)
// ---------------------------------------------------------------------------
if (typeof window !== "undefined" && EMULATOR_FIRESTORE_HOST) {
  void import("firebase/firestore").then(({ connectFirestoreEmulator }) => {
    connectFirestoreEmulator(getDb(), "127.0.0.1", Number(EMULATOR_FIRESTORE_HOST));
  });
}

export { db };