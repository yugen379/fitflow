/**
 * Cheap, synchronous "is there a signed-in user?" signal.
 *
 * Firebase Auth's browserLocalPersistence writes a `firebase:authUser:*` key to
 * localStorage. Reading it takes microseconds and — crucially — is available
 * from the very first frame, long before the auth SDK has loaded, let alone
 * resolved `onAuthStateChanged`.
 *
 * That makes it the right signal for deciding what to warm at boot: a signed-in
 * user is going to need Firestore, a signed-out user is going to need the Google
 * sign-in widget, and neither should pay for the other's download.
 *
 * It is a heuristic, never an authorisation decision. A wrong answer costs one
 * speculative fetch (or the lack of one); nothing reads it to decide what a user
 * is allowed to see.
 */

const AUTH_KEY_PREFIX = 'firebase:authUser:';

export const hasPersistedAuthSession = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(AUTH_KEY_PREFIX)) return true;
    }
    return false;
  } catch {
    // Storage blocked (private mode, embedded webview) — assume signed out.
    return false;
  }
};

/**
 * The name a user typed on the sign-up form, held just long enough to reach
 * the profile document.
 *
 * `createUserWithEmailAndPassword` fires `onAuthStateChanged` immediately, and
 * useAuth builds the initial Firestore profile from `user.displayName` right
 * then — before `updateProfile()` has come back from the network. Google and
 * Apple hand the name over with the credential so they never hit this; email
 * sign-up otherwise produced an account permanently called "Guest".
 *
 * Deliberately sessionStorage, and deliberately read-once:
 *  - sessionStorage, because this must not survive to a later sign-up in
 *    another tab or a week from now.
 *  - read-once, because the value is only ever correct for the account being
 *    created in this moment.
 */
const PENDING_NAME_KEY = 'ff_pending_display_name';

export const rememberPendingDisplayName = (name: string): void => {
  try {
    sessionStorage.setItem(PENDING_NAME_KEY, name.slice(0, 60));
  } catch {
    // Storage blocked — the name still reaches Auth via updateProfile, and the
    // profile falls back to "Guest". Not worth failing a sign-up over.
  }
};

export const consumePendingDisplayName = (): string | null => {
  try {
    const name = sessionStorage.getItem(PENDING_NAME_KEY);
    if (name) sessionStorage.removeItem(PENDING_NAME_KEY);
    return name || null;
  } catch {
    return null;
  }
};
