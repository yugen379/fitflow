# iOS build

The Xcode project **is committed** (`ios/App/App.xcodeproj`). It was generated with
`npx cap add ios` on Windows — Capacitor 8 uses **Swift Package Manager**, not
CocoaPods, so there is no `Podfile` and no macOS-only step in generating it.

What is already done, in-repo:

- Bundle identifier `com.fitflow.fitness` (matches `capacitor.config.ts`)
- `MARKETING_VERSION` 1.5.1 / `CURRENT_PROJECT_VERSION` 21 (in step with Android)
- All five `NS*UsageDescription` strings in `App/App/Info.plist`
- `PrivacyInfo.xcprivacy` — Apple's required privacy manifest
- `ITSAppUsesNonExemptEncryption = false`, so no export-compliance prompt per upload
- App icon + light/dark splash, generated from `assets/*.svg`
- iOS in-app-purchase routing in `src/services/playBillingService.ts`

## Refreshing the web layer

After any web change, re-copy the bundle into the native project:

```bash
npm run build
npx cap sync ios
```

## What still needs a Mac

Everything above runs on Windows. These do not:

1. **Open the project** — `ios/App/App.xcodeproj` in Xcode 15+
2. **Signing** — Signing & Capabilities → pick your Team. Needs a paid Apple
   Developer account ($99/yr); a free account cannot ship to the App Store.
3. **Add the `PrivacyInfo.xcprivacy` file to the App target.** It exists on disk
   but is not yet a target member, because adding it means editing
   `project.pbxproj` blind. In Xcode: drag it into the `App` group, tick the
   `App` target. **Skipping this fails the upload** — App Store Connect rejects
   binaries with a missing privacy manifest.
4. **Archive** → Product → Archive → Distribute App → App Store Connect

## Before the first submission

These need console access, not a Mac, and none of them are wired yet:

- **Firebase iOS app.** Register bundle ID `com.fitflow.fitness` in the Firebase
  console, download `GoogleService-Info.plist`, drop it into `App/App/`. Then add
  the reversed client ID from that file as a URL scheme
  (`CFBundleURLTypes` → `CFBundleURLSchemes`) or **Google sign-in will not
  return to the app.**
- **Push notifications.** Create an APNs auth key in the Apple Developer portal,
  upload it to Firebase Cloud Messaging, and add the Push Notifications +
  Background Modes (remote notifications) capabilities in Xcode.
- **In-app purchase.** App Store Connect: create the `pro` monthly ($4.99) and
  yearly ($60.10) auto-renewing subscriptions, add an iOS app to RevenueCat, then
  set `VITE_REVENUECAT_IOS_KEY` in the build env. Until that key is set the iOS
  build shows **no purchase UI at all** — deliberately: Guideline 3.1.1 forbids
  sending users to external (Stripe) checkout for digital goods, so the app
  describes Pro and stops there. The trial still works, and the same account can
  subscribe on the web.

## Optional: HealthKit

Not required to ship. Steps already work on iOS through
`@capgo/capacitor-pedometer` (Core Motion), which is why
`NSMotionUsageDescription` is set. Adding HealthKit means a new entitlement and
extra App Review scrutiny, so it is deliberately left out. To add it later:

```bash
npm install --save @perfood/capacitor-healthkit --legacy-peer-deps
npx cap sync ios
```

Add the HealthKit capability, the `NSHealthShareUsageDescription` /
`NSHealthUpdateUsageDescription` strings, and an iOS branch in
`getNativePlugin()` in `src/services/healthService.ts` — the abstraction already
has the seam, but the plugin's API shape differs from `capacitor-health-connect`,
so it needs an adapter rather than a straight import.
