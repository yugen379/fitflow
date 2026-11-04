/**
 * Local Firebase emulator wiring — for `npm run proof:ui` only.
 *
 * This lives in its own module, reached solely through a dynamic import behind
 * a build-time-constant check in lib/firebase.ts:
 *
 *     if (import.meta.env.VITE_USE_EMULATORS === 'true') { … }
 *
 * Vite substitutes that env reference literally at build time, so in a normal
 * build the condition folds to `false`, the branch is eliminated, and this
 * module is never reachable — Rollup drops it entirely. `npm run build`
 * greps dist/ to prove it (scripts/scan-bundle-secrets.mjs).
 *
 * The first attempt put this inline in firebase.ts behind a helper FUNCTION.
 * That defeats dead-code elimination — the bundler cannot prove a function call
 * is constant — and `__e2eSignIn` duly shipped in the production bundle. It was
 * inert (the flag is never set in production) but it had no business being
 * there, and "it does not run" is a much weaker guarantee than "it is absent".
 */
import type { Auth } from 'firebase/auth';

export const connectEmulators = async (auth: Auth): Promise<void> => {
  const { connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  const { connectFirestoreEmulator } = await import('firebase/firestore');
  const { db } = await import('./firestore');
  try {
    connectFirestoreEmulator(db as never, '127.0.0.1', 8080);
  } catch {
    // Already connected (an HMR re-run) — harmless.
  }

  // The login screen now has a real email/password form, so the harness CAN
  // drive sign-in through the UI. This hook stays because it is faster and
  // because it is the only route for tests that need a session before the
  // login screen has painted; useAuth and ProtectedRoute still run exactly as
  // they do in production — only the credential source differs.
  // XP and account deletion are Cloud Functions (v1.6.2). Without this, an
  // emulator-backed run would send its calls to the PRODUCTION functions.
  // getFunctions(app) returns one cached instance, so this reaches every caller.
  const { getFunctions, connectFunctionsEmulator } = await import('firebase/functions');
  const { app } = await import('./firebase');
  try {
    connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
  } catch {
    /* already connected */
  }

  (window as unknown as Record<string, unknown>).__e2eSignIn = (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password);
};
