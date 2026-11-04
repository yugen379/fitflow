// Auth proof harness — npm run proof:auth
//
// Covers the three sign-in routes added alongside Google: manual email +
// password, Facebook and Apple.
//
// Three layers, because they fail in three different ways:
//
//   1. POLICY — the pure rules in src/lib/authErrors.ts (what is a valid
//      address, what is an acceptable password, what does the user get told).
//      Imported from the real source, never re-implemented here.
//
//   2. LIVE — the same calls the app makes, against the Firebase Auth
//      emulator. This is the layer that catches the failure a unit test cannot
//      see: an error-code table that maps codes Firebase has stopped emitting.
//      Modern Firebase collapsed auth/wrong-password and auth/user-not-found
//      into auth/invalid-credential; a table written from the old docs looks
//      perfect in review and shows "Sign-in failed (auth/invalid-credential)"
//      to every user who mistypes a password. Every code asserted below is one
//      the live service actually returned during this run.
//
//   3. WIRING — the four providers are reachable from the login screen, and
//      the three places that decide what the APK can finish (capacitor.config,
//      android/variables.gradle, lib/authProviders) agree with each other.
//      They are independent files, so they drift silently.
//
// Run: npm run proof:auth   (boots the Auth emulator itself)

import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'firebase/auth';

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ${C.g}PASS${C.x} ${name}${detail ? ` ${C.d}(${detail})${C.x}` : ''}`);
  } else {
    fail++;
    console.log(`  ${C.r}FAIL${C.x} ${name}${detail ? ` ${C.y}(${detail})${C.x}` : ''}`);
  }
};
const section = (t) => console.log(`\n${C.b}${C.c}${t}${C.x}\n`);

// The real shipped modules. If either grows a firebase/* import this line is
// where it gets caught — that is the point of keeping them SDK-free.
const {
  validateEmail,
  validatePassword,
  passwordStrength,
  normalizeEmail,
  friendlyAuthError,
  isCancellation,
  providerLabel,
  PASSWORD_MIN_LENGTH,
} = await import('../src/lib/authErrors.ts');
const { isProviderAvailable, NATIVE_PROVIDERS, ENABLED_PROVIDERS } = await import('../src/lib/authProviders.ts');

/* ══ 1. POLICY ════════════════════════════════════════════════════════════ */

section('1 — Credential policy (pure, from the shipped source)');

for (const good of [
  'a@b.co',
  'alex.smith@gmail.com',
  'alex+fitflow@gmail.com',
  "o'brien@example.co.uk",
  'user_name-1@sub.domain.io',
  '  Mixed.Case@Example.COM  ',
]) {
  check(`accepts ${JSON.stringify(good)}`, validateEmail(good).ok === true);
}

for (const [bad, why] of [
  ['', 'empty'],
  ['   ', 'whitespace only'],
  ['alex', 'no @'],
  ['alex@', 'no domain'],
  ['@gmail.com', 'no local part'],
  ['alex@gmail', 'no dot in domain'],
  ['alex@.com', 'domain starts with a dot'],
  ['alex@gmail.', 'domain ends with a dot'],
  ['alex smith@gmail.com', 'contains a space'],
  ['a@b@c.com', 'two @'],
  [`${'a'.repeat(250)}@gmail.com`, 'over 254 chars'],
]) {
  const r = validateEmail(bad);
  check(`rejects ${JSON.stringify(bad.slice(0, 24))} — ${why}`, r.ok === false && !!r.message);
}

check('every rejection carries a message the UI can show verbatim',
  ['', 'alex', 'a@b'].every((e) => typeof validateEmail(e).message === 'string' && validateEmail(e).message.length > 8));

check('normalizeEmail trims and lower-cases',
  normalizeEmail('  Alex@Example.COM ') === 'alex@example.com');

// Password policy. The floor is 8 with a letter and a digit — deliberately
// above Firebase's protocol minimum of 6.
check(`the policy floor is ${PASSWORD_MIN_LENGTH}, above Firebase's 6`, PASSWORD_MIN_LENGTH >= 8);
check('rejects an empty password', validatePassword('').ok === false);
check('rejects 7 characters', validatePassword('abcdef1').ok === false);
check(`accepts exactly ${PASSWORD_MIN_LENGTH} characters (boundary is inclusive)`,
  validatePassword('abcdefg1').ok === true);
check('rejects letters only', validatePassword('abcdefghij').ok === false);
check('rejects digits only', validatePassword('1234567890').ok === false);
check('rejects "password"', validatePassword('password').ok === false);
check('rejects Firebase-legal "123456"', validatePassword('123456').ok === false,
  'the SDK would accept this');
check('accepts a real passphrase', validatePassword('SquatDay2026').ok === true);
check('rejects an absurdly long password', validatePassword('a1'.repeat(3000)).ok === false);

check('strength: a barely-valid password is not called strong',
  passwordStrength('abcdefg1') !== 'strong');
check('strength: a long mixed passphrase is strong',
  passwordStrength('Squat-Day-2026-Lift!') === 'strong', passwordStrength('Squat-Day-2026-Lift!'));
check('strength: anything the policy rejects is weak',
  ['', '123', 'abc'].every((p) => passwordStrength(p) === 'weak'));

/* ══ 2. ERROR COPY ════════════════════════════════════════════════════════ */

section('2 — Error copy');

const MAPPED = [
  'auth/invalid-email',
  'auth/email-already-in-use',
  'auth/weak-password',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/too-many-requests',
  'auth/user-disabled',
  'auth/missing-password',
  'auth/missing-email',
  'auth/account-exists-with-different-credential',
  'auth/credential-already-in-use',
  'auth/provider-already-linked',
  'auth/network-request-failed',
  'auth/operation-not-allowed',
  'auth/unauthorized-domain',
  'auth/popup-blocked',
  'auth/web-storage-unsupported',
  'auth/native-no-id-token',
  'auth/native-no-access-token',
  'auth/provider-not-configured',
];
for (const code of MAPPED) {
  const msg = friendlyAuthError(code);
  check(`${code} has real copy, not the raw code`, !msg.includes(code) && msg.length > 12);
}
check('an unknown code still surfaces the code (so a screenshot is diagnosable)',
  friendlyAuthError('auth/some-future-code').includes('auth/some-future-code'));
check('no code at all still yields a sentence',
  friendlyAuthError(undefined).length > 12 && !friendlyAuthError(undefined).includes('undefined'));

// The enumeration guard: wrong-password and user-not-found must NOT be
// distinguishable in the copy for the collapsed code.
check('the collapsed credential error does not reveal whether the account exists',
  !/no account|not found|does not exist/i.test(friendlyAuthError('auth/invalid-credential')));

check('cancellations are recognised as cancellations, not failures',
  ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/native-cancelled', '12501', '1001']
    .every((c) => isCancellation(c) === true));
check('a real failure is NOT treated as a cancellation',
  ['auth/network-request-failed', 'auth/invalid-credential', undefined, null, '']
    .every((c) => isCancellation(c) === false));

check('provider labels read naturally inside a sentence',
  providerLabel('facebook.com') === 'Facebook' &&
  providerLabel('apple.com') === 'Apple' &&
  providerLabel('password') === 'email and password' &&
  providerLabel('nonsense.com') === 'another sign-in method');

/* ══ 3. LIVE — against the Auth emulator ══════════════════════════════════ */

section('3 — Live email/password flow (Firebase Auth emulator)');

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const stamp = Date.now();
const EMAIL = `proof.${stamp}@fitflow.test`;
const PASSWORD = 'SquatDay2026';
const NAME = 'Proof Runner';

/** Run a call that is expected to fail, and hand back the Firebase code. */
const codeOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e?.code ?? String(e);
  }
};

// ── Sign-up ──
let created = null;
try {
  const res = await createUserWithEmailAndPassword(auth, normalizeEmail(EMAIL), PASSWORD);
  created = res.user;
} catch (e) {
  console.error(`  ${C.r}Could not reach the Auth emulator on 127.0.0.1:9099${C.x}`, e?.code || e);
  process.exit(1);
}
check('an account is created for a valid email + password', !!created?.uid);
check('the account carries the email it was created with', created.email === normalizeEmail(EMAIL));
check('a brand-new account is NOT email-verified', created.emailVerified === false,
  'so nothing may be gated on it at sign-up');

// The name the sign-up form collects has to survive to the profile. This is
// the call signUpWithEmail makes; the useAuth side of it (the sessionStorage
// hand-off) is covered by the wiring section below.
await updateProfile(created, { displayName: NAME });
check('displayName is stored on the Auth user', auth.currentUser?.displayName === NAME);

// ── Duplicate ──
const dupCode = await codeOf(() => createUserWithEmailAndPassword(auth, normalizeEmail(EMAIL), PASSWORD));
check('signing up twice with the same email is rejected', dupCode === 'auth/email-already-in-use', dupCode);
check(`${dupCode} is mapped to copy, not shown raw`,
  !friendlyAuthError(dupCode).includes(dupCode));

// Case-insensitivity: FitFlow lower-cases before every call, so ALEX@ and
// alex@ must be the same account rather than two accounts one typo apart.
const dupUpperCode = await codeOf(() =>
  createUserWithEmailAndPassword(auth, normalizeEmail(EMAIL.toUpperCase()), PASSWORD));
check('the same address in a different case is the SAME account',
  dupUpperCode === 'auth/email-already-in-use', dupUpperCode);

// ── Sign-in ──
await signOut(auth);
const signedIn = await signInWithEmailAndPassword(auth, normalizeEmail(EMAIL), PASSWORD);
check('the created account can sign back in', signedIn.user.uid === created.uid);

await signOut(auth);
const upperIn = await signInWithEmailAndPassword(auth, normalizeEmail(EMAIL.toUpperCase()), PASSWORD);
check('sign-in works with the address typed in capitals', upperIn.user.uid === created.uid);

// ── The failures a real user hits ──
await signOut(auth);
const wrongPwCode = await codeOf(() => signInWithEmailAndPassword(auth, normalizeEmail(EMAIL), 'WrongPassword9'));
check('a wrong password is rejected', !!wrongPwCode, wrongPwCode);
check(`the LIVE wrong-password code (${wrongPwCode}) is in the copy table`,
  !friendlyAuthError(wrongPwCode).includes(wrongPwCode),
  'this is the assertion that catches a table written from stale docs');
check('the wrong-password message points at the recovery route',
  /forgot password/i.test(friendlyAuthError(wrongPwCode)));

const noUserCode = await codeOf(() =>
  signInWithEmailAndPassword(auth, `absent.${stamp}@fitflow.test`, PASSWORD));
check('an unknown account is rejected', !!noUserCode, noUserCode);
check(`the LIVE unknown-account code (${noUserCode}) is in the copy table`,
  !friendlyAuthError(noUserCode).includes(noUserCode));

const badEmailCode = await codeOf(() => signInWithEmailAndPassword(auth, 'not-an-email', PASSWORD));
check('a malformed address is rejected by the service too', badEmailCode === 'auth/invalid-email', badEmailCode);
check('…and the client rejects it FIRST, without a round trip',
  validateEmail('not-an-email').ok === false);

// Firebase's own floor is 6, which is why the app does not rely on it.
const shortPwCode = await codeOf(() =>
  createUserWithEmailAndPassword(auth, `short.${stamp}@fitflow.test`, '12345'));
check('the service rejects a 5-character password', shortPwCode === 'auth/weak-password', shortPwCode);
check('the app rejects a 6-character password the SERVICE would accept',
  validatePassword('123456').ok === false,
  'client policy is stricter on purpose');

// ── Password reset ──
let resetThrew = null;
try {
  await sendPasswordResetEmail(auth, normalizeEmail(EMAIL));
} catch (e) {
  resetThrew = e?.code;
}
check('a reset link is sent for a real account', resetThrew === null, resetThrew || 'ok');

const unknownResetCode = await codeOf(() =>
  sendPasswordResetEmail(auth, `ghost.${stamp}@fitflow.test`));
// Whatever the service does here, sendPasswordReset() in lib/firebase swallows
// user-not-found so the UI answer is identical either way. Recorded, not gated.
console.log(`  ${C.d}note: reset for an unknown address returned ${unknownResetCode ?? 'no error'} — ` +
  `lib/firebase.sendPasswordReset swallows it so the UI cannot leak account existence${C.x}`);

/* ══ 4. WIRING ════════════════════════════════════════════════════════════ */

section('4 — Wiring: all four routes reachable, native config self-consistent');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const appTsx = read('../src/App.tsx');
const socialTsx = read('../src/components/SocialSignInButtons.tsx');
const formTsx = read('../src/components/EmailPasswordForm.tsx');
const firebaseTs = read('../src/lib/firebase.ts');
const authErrorsTs = read('../src/lib/authErrors.ts');
const useAuthTsx = read('../src/hooks/useAuth.tsx');
const capConfig = read('../capacitor.config.ts');
const variablesGradle = read('../android/variables.gradle');

check('the login screen renders the email/password form',
  /<EmailPasswordForm/.test(appTsx));
check('the login screen renders Google', /<GoogleSignInButton/.test(appTsx));
check('the login screen renders Facebook', /<FacebookSignInButton/.test(appTsx));
check('the login screen renders Apple', /<AppleSignInButton/.test(appTsx));

check('the form calls the real sign-in helpers',
  ['signInWithEmail', 'signUpWithEmail', 'sendPasswordReset'].every((f) => formTsx.includes(f)));
check('sign-up uses autoComplete="new-password" so managers generate rather than autofill',
  /autoComplete=\{isSignup \? 'new-password' : 'current-password'\}/.test(formTsx));
check('the reset screen does not confirm whether the account exists',
  /If \{email\} has a FitFlow account/.test(formTsx));

check('every provider has BOTH a web and a native path',
  ['signInWithGoogle', 'signInWithGoogleNative',
   'signInWithFacebook', 'signInWithFacebookNative',
   'signInWithApple', 'signInWithAppleNative',
  ].every((f) => new RegExp(`export const ${f}\\b`).test(firebaseTs)));

check('native Apple passes the raw nonce with the ID token',
  /rawNonce:\s*result\.credential\?\.nonce/.test(firebaseTs),
  'without it Apple sign-in fails as auth/invalid-credential');

check('the email sign-up name survives the onAuthStateChanged race',
  /rememberPendingDisplayName/.test(firebaseTs) && /consumePendingDisplayName/.test(useAuthTsx));

check('authErrors.ts imports nothing from firebase (so this harness can load it)',
  !/from\s+['"]firebase\//.test(authErrorsTs));

// The verification email is fire-and-forget at sign-up, so a lost one needs a
// route back. Settings is where a user goes to look.
const settingsTsx = read('../src/pages/Settings.tsx');
check('a password user with an unverified email can resend it from Settings',
  /resendVerificationEmail/.test(settingsTsx) && /providerIds\.includes\('password'\)/.test(settingsTsx));
check('Settings refreshes emailVerified rather than trusting the cached user',
  /user\.reload\(\)/.test(settingsTsx),
  'the cached flag is a snapshot from sign-in and would nag a verified user');
check('Settings names the provider the account actually uses',
  /providerLabel/.test(settingsTsx),
  'so nobody resets a password on an account that has none');

// The three places that decide what the APK can finish.
const capProviders = (capConfig.match(/providers:\s*\[([^\]]*)\]/)?.[1] ?? '')
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
check('capacitor.config lists the native providers', capProviders.length > 0, capProviders.join(' '));
// Email/password has no native half — it runs in the JS SDK inside the
// WebView (skipNativeAuth) — so it belongs in NATIVE_PROVIDERS (the APK can
// finish it) but NOT in the plugin's providers list (nothing native to load).
const JS_ONLY_PROVIDERS = new Set(['password']);
const nativeNeedingPlugin = [...NATIVE_PROVIDERS].filter((p) => !JS_ONLY_PROVIDERS.has(p));
check('capacitor.config and lib/authProviders agree',
  capProviders.every((p) => NATIVE_PROVIDERS.has(p)) &&
  nativeNeedingPlugin.every((p) => capProviders.includes(p)),
  `config=[${capProviders}] code=[${nativeNeedingPlugin}]`);
check('email/password is offered in the Android app (no native dependency, so no reason to hide it)',
  NATIVE_PROVIDERS.has('password') && ENABLED_PROVIDERS.has('password'),
  'until v1.6.3 the APK showed only "Continue with Google"');

check('rgcfaIncludeGoogle is ON — native Google needs those classes at RUNTIME',
  /rgcfaIncludeGoogle\s*=\s*true/.test(variablesGradle),
  'compileOnly + no flag = NoClassDefFoundError when the user taps the button');

const fbGradleOn = /rgcfaIncludeFacebook\s*=\s*true/.test(variablesGradle);
check('Facebook native is offered only if the Facebook SDK is compiled in',
  NATIVE_PROVIDERS.has('facebook.com') === fbGradleOn,
  fbGradleOn ? 'SDK on, provider offered' : 'SDK off, provider hidden in the APK');

// A provider that is not enabled in the Firebase Console answers
// `auth/operation-not-allowed`. That is invisible to every other gate — the
// emulator enables everything — so it is asserted structurally here: a button
// may only render for a provider this build claims is enabled.
check('nothing is offered on the web that is not enabled in the console',
  ['google.com', 'facebook.com', 'apple.com', 'password']
    .every((p) => isProviderAvailable(p, false) === ENABLED_PROVIDERS.has(p)),
  `enabled=[${[...ENABLED_PROVIDERS]}]`);
check('the APK hides any provider it cannot finish',
  ['google.com', 'facebook.com', 'apple.com', 'password']
    .every((p) => isProviderAvailable(p, true) === (ENABLED_PROVIDERS.has(p) && NATIVE_PROVIDERS.has(p))));
check('a provider needs BOTH console and native wiring to appear in the APK',
  isProviderAvailable('apple.com', true) === false,
  'apple is natively wired but not yet enabled in the console');
check('the login screen asks before rendering each route',
  /showEmail && \(/.test(appTsx) && /showGoogle && </.test(appTsx));
check('the "or continue with" divider only shows with something on both sides',
  /showEmail && anySocial &&/.test(appTsx));
check('a provider button knows which provider it is',
  /providerId="facebook\.com"/.test(socialTsx) && /providerId="apple\.com"/.test(socialTsx));

/* ══ Result ═══════════════════════════════════════════════════════════════ */

const total = pass + fail;
console.log(
  `\n${C.b}${fail === 0 ? C.g : C.r}${pass}/${total} checks passed${C.x}` +
  `${fail ? ` ${C.r}(${fail} failed)${C.x}` : ''}\n`,
);

/**
 * Tear the SDK down before exiting.
 *
 * Without this the harness printed 96/96 and then died with Windows
 * 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) as the process wound down — the
 * Auth client keeps a live token-refresh timer and an open connection, and
 * exiting out from under them crashes the runtime rather than returning a
 * code. `firebase emulators:exec` only sees the exit status, so a fully green
 * run was reported as a failed gate.
 */
await signOut(auth).catch(() => {});
await deleteApp(app).catch(() => {});
// Let stdout flush before the exit call; a piped stdout on Windows is async.
await new Promise((r) => setTimeout(r, 250));
process.exit(fail === 0 ? 0 : 1);
