/// <reference types="vite/client" />
/**
 * Which sign-in providers this build can actually complete.
 *
 * Two independent things have to be true before a button may be shown, and
 * they fail in completely different ways:
 *
 * 1. ENABLED — the provider is turned on in the Firebase Console. If it is
 *    not, the call comes back `auth/operation-not-allowed` and the user is
 *    told to go and configure Firebase, which is a developer's sentence
 *    printed on a customer's screen.
 *
 * 2. NATIVE — inside the Capacitor shell only, the provider's native half is
 *    compiled in (see android/variables.gradle). The plugin declares every
 *    provider dependency `compileOnly`, so a missing one does not degrade: it
 *    throws NoClassDefFoundError the moment the button is tapped.
 *
 * The web needs (1) alone; the installed app needs both. Neither is knowable
 * at runtime — Firebase has no client API that lists enabled providers — so
 * both are build-time facts that must be kept honest by hand, which is why
 * `npm run proof:auth` asserts they agree with the gradle flags and the
 * Capacitor config.
 *
 * A button that always fails is worse than no button: it reads as "this app is
 * broken" rather than "this app offers three ways in", and it costs a support
 * email every time.
 *
 * Kept free of `firebase/*` imports so the proof harness can check the lists.
 */

/**
 * Providers enabled in the Firebase Console for this project.
 *
 * Verified against the live project (Identity Toolkit admin API) rather than
 * assumed: as of 2026-09-06 only `google.com` had an IdP config, and
 * production `accounts:signInWithPassword` answered PASSWORD_LOGIN_DISABLED.
 *
 * `password` is listed here because enabling Email/Password is part of
 * shipping this feature — the toggle and this build go out together. Facebook
 * and Apple are NOT, because neither can be enabled at all until credentials
 * exist that no commit can create (a Facebook App ID/secret, an Apple Services
 * ID and .p8 key). AUTH_PROVIDERS.md has both checklists.
 *
 * Override per build with VITE_AUTH_PROVIDERS once a provider goes live.
 */
const DEFAULT_ENABLED_PROVIDERS = 'password,google.com';

/**
 * Providers wired natively in a default build.
 *
 * - google.com: rgcfaIncludeGoogle = true, plus google-services.json + SHA-1.
 * - apple.com: no native dependency at all — the plugin uses firebase-auth's
 *   own OAuth activity, so it works on Android the moment Apple is enabled.
 *
 * Facebook is absent on purpose: it needs the Facebook SDK compiled in AND the
 * app credentials in strings.xml. Add it in the same change that adds those,
 * never before.
 */
const DEFAULT_NATIVE_PROVIDERS = 'google.com,apple.com';

const envList = (name: string, fallback: string): ReadonlySet<string> => {
  const raw =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.[name]) || fallback;
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
};

export const ENABLED_PROVIDERS = envList('VITE_AUTH_PROVIDERS', DEFAULT_ENABLED_PROVIDERS);
export const NATIVE_PROVIDERS = envList('VITE_NATIVE_PROVIDERS', DEFAULT_NATIVE_PROVIDERS);

/**
 * `native` is passed in rather than detected here so this module stays pure —
 * Capacitor's runtime check belongs to the caller, and the harness can ask both
 * questions of the same function.
 */
export const isProviderAvailable = (providerId: string, native: boolean): boolean => {
  const id = providerId.toLowerCase();
  if (!ENABLED_PROVIDERS.has(id)) return false;
  return native ? NATIVE_PROVIDERS.has(id) : true;
};
