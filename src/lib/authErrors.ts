/**
 * Auth error copy and credential validation — deliberately free of any
 * `firebase/*` import.
 *
 * Everything here is a pure function of strings, which is what lets the proof
 * harness (`npm run proof:auth`) exercise the real shipped rules in Node. The
 * moment this file imports the SDK it needs a browser, an app config and App
 * Check to even load, and the harness would be reduced to re-implementing the
 * rules it is supposed to be checking. `lib/firebase.ts` re-exports
 * `friendlyAuthError` so existing call sites are unchanged.
 */

/** Sign-in methods the app offers, in the order the login screen shows them. */
export type ProviderKind = 'password' | 'google.com' | 'facebook.com' | 'apple.com';

export const PROVIDER_LABELS: Record<string, string> = {
  password: 'email and password',
  'google.com': 'Google',
  'facebook.com': 'Facebook',
  'apple.com': 'Apple',
  emailLink: 'an email link',
};

/** Human name for a Firebase provider id, for use inside a sentence. */
export const providerLabel = (providerId?: string | null): string =>
  (providerId && PROVIDER_LABELS[providerId]) || 'another sign-in method';

/**
 * 8, not Firebase's 6.
 *
 * Firebase's floor is a protocol minimum, not a product decision — it accepts
 * "123456". This is the only credential a FitFlow account has that the user
 * chooses themselves, and the account holds body metrics and meal history, so
 * the bar is the one a password manager would suggest anyway.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 4096; // Firebase's own ceiling.

export interface FieldCheck {
  ok: boolean;
  /** Present only when `ok` is false. Written to be shown verbatim to a user. */
  message?: string;
}

/** Trim + lower-case. Auth treats addresses case-insensitively; the UI should too. */
export const normalizeEmail = (raw: string): string => (raw || '').trim().toLowerCase();

/**
 * Email shape check.
 *
 * Intentionally permissive: the only authority on whether an address exists is
 * the mail server, and every regex stricter than this one has a famous false
 * negative (plus-addressing, new TLDs, apostrophes). This catches the typos
 * that make up virtually all real failures — no @, no domain, no dot, spaces —
 * and leaves the rest to Firebase.
 */
export const validateEmail = (raw: string): FieldCheck => {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, message: 'Enter your email address.' };
  if (/\s/.test(email)) return { ok: false, message: 'Email addresses cannot contain spaces.' };
  if (!/^[^@]+@[^@]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address — it needs one @.' };
  }
  const domain = email.slice(email.indexOf('@') + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return { ok: false, message: 'Check the part after the @ — it needs a domain like gmail.com.' };
  }
  if (email.length > 254) return { ok: false, message: 'That email address is too long.' };
  return { ok: true };
};

export const validatePassword = (password: string): FieldCheck => {
  if (!password) return { ok: false, message: 'Enter a password.' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: 'That password is too long.' };
  }
  if (!/[a-zA-Z]/.test(password)) return { ok: false, message: 'Include at least one letter.' };
  if (!/[0-9]/.test(password)) return { ok: false, message: 'Include at least one number.' };
  return { ok: true };
};

export type PasswordStrength = 'weak' | 'fair' | 'strong';

/**
 * A meter, not a gate. `validatePassword` decides what is accepted; this only
 * tells the user where they stand while they type.
 */
export const passwordStrength = (password: string): PasswordStrength => {
  if (!validatePassword(password).ok) return 'weak';
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score >= 3 ? 'strong' : score >= 1 ? 'fair' : 'weak';
};

/**
 * Codes that mean "the user changed their mind", not "something broke".
 *
 * These must never raise an error toast: closing a Google popup or backing out
 * of the Apple sheet is a normal thing to do, and telling someone their
 * deliberate action failed is how an app teaches them to distrust its
 * messages.
 */
const CANCELLATION_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
  'auth/native-cancelled',
  'auth/redirect-cancelled-by-user',
  '1001', // ASAuthorizationError.canceled (iOS)
  '12501', // Google Play services SIGN_IN_CANCELLED (Android)
]);

export const isCancellation = (codeOrMessage?: string | null): boolean => {
  if (!codeOrMessage) return false;
  const s = String(codeOrMessage);
  if (CANCELLATION_CODES.has(s)) return true;
  return /cancell?ed|canceled|user closed|dismiss/i.test(s);
};

/**
 * Every auth failure the user can see, in their words.
 *
 * The rule for each string: say what happened AND what to do next. A code on
 * its own ("auth/wrong-password") is an invitation to file a support ticket;
 * "Incorrect password. Tap Forgot password?" resolves itself. The raw code is
 * still appended for anything unmapped, because a screenshot with a code in it
 * is worth an hour of back-and-forth.
 */
export const friendlyAuthError = (code?: string): string => {
  switch (code) {
    // ── Domain / configuration ────────────────────────────────────────────
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'That sign-in method is turned off. Enable it in Firebase Console → Authentication → Sign-in method.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'This app build is not authorized for sign-in. Please update to the latest version.';

    // ── Popup / redirect mechanics ────────────────────────────────────────
    case 'auth/popup-blocked':
      return 'Popup blocked. Allow popups for this site, or use "Sign in another way".';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
    case 'auth/native-cancelled':
      return 'Sign-in cancelled.';
    case 'auth/web-storage-unsupported':
      return 'Browser storage is disabled. Enable cookies/localStorage and try again.';

    // ── Email + password ──────────────────────────────────────────────────
    case 'auth/invalid-email':
      return 'That email address is not valid. Check it and try again.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email. Sign in instead, or use "Forgot password?".';
    case 'auth/weak-password':
      return `Password too weak. Use at least ${PASSWORD_MIN_LENGTH} characters with a letter and a number.`;
    case 'auth/user-not-found':
      return 'No account found with that email. Create one below.';
    case 'auth/wrong-password':
      return 'Incorrect password. Try again, or tap "Forgot password?".';
    // Modern Firebase collapses user-not-found and wrong-password into this one
    // on purpose — telling an attacker which emails are registered is an
    // account-enumeration leak. The copy must not un-collapse it.
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Email or password is incorrect. Check both, or tap "Forgot password?".';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or reset your password to get straight back in.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact fitflow2000@gmail.com.';
    case 'auth/requires-recent-login':
      return 'For your security, sign in again before making this change.';
    case 'auth/missing-email':
      return 'Enter the email address for your account.';

    // ── Cross-provider collisions ─────────────────────────────────────────
    case 'auth/account-exists-with-different-credential':
      return 'You already have an account with that email using a different sign-in method. Use that one, then link this provider from Settings.';
    case 'auth/credential-already-in-use':
      return 'That account is already linked to a different FitFlow user.';
    case 'auth/provider-already-linked':
      return 'That sign-in method is already linked to your account.';

    // ── Transport ─────────────────────────────────────────────────────────
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/timeout':
      return 'The sign-in service timed out. Try again.';

    // ── Native provider plumbing ──────────────────────────────────────────
    case 'auth/native-no-id-token':
      return 'Sign-in did not complete. Try again, or use another method.';
    case 'auth/native-no-access-token':
      return 'Facebook did not return a login token. Try again, or use another method.';
    case 'auth/provider-not-configured':
      return 'That sign-in method is not available in this build yet. Please use another one.';

    default:
      return code ? `Sign-in failed (${code}).` : 'Sign-in failed. Please try again.';
  }
};
