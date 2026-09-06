# Sign-in providers

FitFlow offers four routes in: **email + password**, **Google**, **Facebook**, **Apple**.

The code for all four is shipped and proven (`npm run proof:auth`, 102 checks). Two of
them need work in a console that no commit can do for you, and this file is the
checklist. Nothing here is optional-but-nice: a provider that is enabled in the app
and not in the console fails with `auth/operation-not-allowed`, which the user reads
as "this app is broken".

| Route | Web (PWA) | Android APK | Blocked on |
| --- | --- | --- | --- |
| Email + password | code ready | code ready | **one Firebase Console toggle** (see below) |
| Google | ✅ live | ✅ live | — |
| Apple | code ready, hidden | code ready, hidden | Apple Developer Program ($99/yr) |
| Facebook | code ready, hidden | code ready, hidden **+ gradle** | Facebook app credentials |

**Verified against the live project on 2026-09-06**, not assumed. The Identity
Toolkit admin API reported exactly one IdP config (`google.com`, enabled), and
production `accounts:signInWithPassword` answered `PASSWORD_LOGIN_DISABLED`.

A provider that is not enabled in the console answers `auth/operation-not-allowed`,
so `src/lib/authProviders.ts` renders **no button** for one this build does not
claim is enabled — `ENABLED_PROVIDERS`. Nothing else can catch this: the Auth
emulator enables every provider, so `proof:auth` and `proof:ui` are both green
against a project where none of them are on.

---

## How it is wired

Three files decide what the **installed app** can finish. They must agree, and
`proof:auth` fails if they do not:

1. `android/variables.gradle` — `rgcfaInclude*` flags. The Capacitor plugin declares
   every provider dependency `compileOnly` unless the matching flag is true.
   **compileOnly means the plugin compiles fine and the classes are absent at
   runtime** — a missing flag is not a build error, it is a `NoClassDefFoundError`
   the first time a user taps the button.
2. `capacitor.config.ts` — the `FirebaseAuthentication.providers` list.
3. `src/lib/authProviders.ts` — `NATIVE_PROVIDERS`. The login screen renders no
   button for a provider missing from this list when running inside the shell. A
   button that always fails is worse than no button.

The **web** has no such constraint: every provider works as soon as it is enabled in
the Firebase Console, because the JS SDK opens a popup (desktop) or redirects
(mobile/PWA). Nothing has to be compiled in.

Sign-in itself always ends in the **web SDK's** `auth` object, on every platform.
The native plugin runs with `skipNativeAuth: true`, so it returns only a credential
and `src/lib/firebase.ts` exchanges it via `signInWithCredential`. That keeps
`onAuthStateChanged` the single source of auth truth for the whole app.

---

## 1. Email + password — ONE TOGGLE AWAY

**Firebase Console → Authentication → Sign-in method → Email/Password → Enable.**
(Leave "Email link / passwordless" off; the app does not use it.)

This is currently **off**, which is why `password` sits in `ENABLED_PROVIDERS` in
`src/lib/authProviders.ts` but the provider will reject every attempt until the
toggle is flipped. Flip it before or with the deploy — they go out together.

Verify with a call that creates nothing:

```bash
KEY=$(node -p "require('./firebase-applet-config.json').apiKey")
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$KEY"   -H "Content-Type: application/json"   -d '{"email":"probe@fitflow.invalid","password":"NotARealPassword1"}'
```

`PASSWORD_LOGIN_DISABLED` → still off. `EMAIL_NOT_FOUND` / `INVALID_LOGIN_CREDENTIALS`
→ on and working (the probe account simply does not exist).

Worth knowing:

- **Policy is set in the app, not by Firebase.** `src/lib/authErrors.ts` requires 8+
  characters with a letter and a number. Firebase's own floor is 6 and would accept
  `123456`; `proof:auth` asserts the app rejects a password the service allows.
- **Password reset does not confirm whether an account exists.** `sendPasswordReset`
  swallows `auth/user-not-found` and the UI always says "If <email> has a FitFlow
  account…". Distinguishing the two is an account-enumeration oracle. Do not
  "improve" this copy.
- **Verification email** is sent on sign-up but nothing is gated on it. If you ever
  gate a feature on `emailVerified`, remember the account exists and is usable for
  the seconds before the user opens their inbox.
- **Enable email enumeration protection** in Firebase Console →
  Authentication → Settings. With it on, wrong-password and unknown-account both
  return `auth/invalid-credential`; both codes are already mapped.

## 2. Google — live

Working on web and in the APK. Requirements already met: `google-services.json`, the
release SHA-1 registered in the Firebase Console, and `rgcfaIncludeGoogle = true`.

> That gradle flag was **added with this change**. Without it `play-services-auth` and
> `androidx.credentials` are compileOnly, so `signInWithGoogleNative()` throws
> `NoClassDefFoundError` in a release APK. If native Google sign-in has ever been
> reported as broken on a device, this was why.

## 3. Apple — needs console setup

No native dependency and no gradle flag: on Android the plugin drives Apple through
`firebase-auth`'s own OAuth activity, which is already on the classpath. So this is
console work only.

1. **Apple Developer Program** membership (paid). There is no free path.
2. In the Apple Developer portal:
   - Enable **Sign In with Apple** on the App ID `com.fitflow.fitness`.
   - Create a **Services ID** (e.g. `com.fitflow.fitness.web`) — this is the OAuth
     client id for web and Android.
   - Register the return URL: `https://<your-firebase-auth-domain>/__/auth/handler`
     (the `authDomain` in `firebase-applet-config.json`).
   - Create a **Sign in with Apple key** (.p8) and note the Key ID and Team ID.
3. Firebase Console → Authentication → Sign-in method → **Apple**: paste the
   Services ID, Team ID, Key ID and the .p8 contents.
4. Add every domain the app is served from to **Authorized domains**.

Notes that bite:

- **Apple gives you the user's name exactly once**, on the very first authorisation,
  and never again. `useAuth` captures it into the profile on the initial write; if
  you delete the Firestore user doc but not the Auth user, the name is gone forever.
- Many users choose **Hide My Email**, so `user.email` is a
  `@privaterelay.appleid.com` relay. It is a real, deliverable address — do not treat
  it as invalid.
- Apple's App Store rules require Sign in with Apple wherever another third-party
  login is offered, so this is **mandatory before an iOS submission**, not optional.

## 4. Facebook — needs console setup + a gradle flag

Web is console-only. **Android is not**, and getting it wrong crashes the app on
launch for everyone — see the warning below.

1. Create an app at developers.facebook.com and add the **Facebook Login** product.
2. Copy the **App ID** and **App Secret** into Firebase Console → Authentication →
   Sign-in method → Facebook.
3. Copy the OAuth redirect URI Firebase shows you into the Facebook app's
   **Valid OAuth Redirect URIs**.
4. Facebook requires **App Review** before login works for anyone outside your test
   users. FitFlow only asks for `email` and `public_profile`, which is the
   lightest review path — do not add scopes no screen reads.
5. Facebook requires a **live privacy policy URL** and a data-deletion callback.
   FitFlow already has `/privacy` and `/delete-account`.

### For the Android APK, additionally:

```gradle
// android/variables.gradle
rgcfaIncludeFacebook = true
```

```xml
<!-- android/app/src/main/res/values/strings.xml -->
<string name="facebook_app_id">YOUR_APP_ID</string>
<string name="fb_login_protocol_scheme">fbYOUR_APP_ID</string>
<string name="facebook_client_token">YOUR_CLIENT_TOKEN</string>
```

…plus the `FacebookActivity`, `CustomTabActivity` and `com.facebook.sdk.*` meta-data
entries in `AndroidManifest.xml` (the Facebook SDK quickstart lists them verbatim).

> ⚠️ **Do all of that in ONE change, or none of it.** Setting
> `rgcfaIncludeFacebook = true` pulls in `com.facebook.android:facebook-login`, whose
> auto-initialisation ContentProvider reads `@string/facebook_app_id` **at app
> start**. Flipping the flag without adding the strings crashes FitFlow on launch for
> every user — not just the ones who tap Facebook.

Finally, add `facebook.com` to the native list so the APK starts offering the button:

```ts
// src/lib/authProviders.ts — DEFAULT_NATIVE_PROVIDERS
'google.com,apple.com,facebook.com'
```

and to `providers` in `capacitor.config.ts`. `npm run proof:auth` asserts these two
stay in step with the gradle flag, so it will fail if you change one and forget the
others.

---

## Verifying

```bash
npm run proof:auth   # 102 checks: policy, live emulator flow, error copy, wiring
```

The live section runs against the Firebase Auth emulator and asserts that the error
codes the service **actually returns** are the ones `friendlyAuthError` maps. That is
the check that catches the classic failure here — an error table written from stale
documentation, which looks correct in review and shows
`Sign-in failed (auth/invalid-credential)` to every user who mistypes a password.

To test a provider end to end before release, use a real device build and a test
account for that provider; none of the three OAuth flows can be driven headlessly.
