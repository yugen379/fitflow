/**
 * Google Identity Services loader.
 *
 * GSI used to be a `<script async defer>` in index.html, which meant every cold
 * start — including the overwhelming majority that are already signed in — paid
 * for a third-party connection, ~80 kB, and script execution during boot.
 *
 * Loading it purely on demand fixed that but created a smaller problem: the
 * request then started only after Firebase Auth had resolved, and GSI needs
 * three chained round trips (client -> style -> button iframe) before the
 * sign-in button exists. On a slow connection that pushed the only actionable
 * control on the login screen several hundred milliseconds later than before.
 *
 * So: start it at boot, but only when the user is probably signed out. Firebase
 * Auth's browserLocalPersistence leaves a `firebase:authUser:*` key in
 * localStorage, which is a cheap synchronous signal available long before the
 * SDK has loaded, let alone resolved. Signed-out users get GSI warming from the
 * first frame; signed-in users never download it at all.
 */

import { hasPersistedAuthSession } from './authSession';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// The precise Window.google shape is declared by GoogleSignInButton, which is
// the only module that calls into the API. This one just needs to know whether
// it is already there.
const gsiLoaded = (): boolean =>
  typeof window !== 'undefined' && !!(window as unknown as { google?: { accounts?: { id?: unknown } } }).google?.accounts?.id;

/** Idempotent: repeated calls reuse the existing tag. */
export const ensureGsiScript = (): void => {
  if (typeof document === 'undefined') return;
  if (gsiLoaded()) return;
  if (document.querySelector(`script[src="${GSI_SRC}"]`)) return;
  const script = document.createElement('script');
  script.src = GSI_SRC;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
};

/** Called once at boot. Never blocks and never throws. */
export const warmGoogleIdentity = (): void => {
  try {
    if (!hasPersistedAuthSession()) ensureGsiScript();
  } catch {
    /* non-critical */
  }
};
