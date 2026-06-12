# iOS build

The iOS Capacitor project is **not committed** because it has to be generated on
a macOS machine with Xcode + CocoaPods installed. Generate it locally with:

```bash
npm install --save @capacitor/ios --legacy-peer-deps
npx cap add ios
npx cap sync ios
```

That creates `ios/App/App.xcodeproj`. Open it in Xcode and:

1. Set the **Bundle Identifier** to `com.fitflow.app` (matches `capacitor.config.ts`)
2. Set your **Team** under Signing & Capabilities
3. Add the following entries to `ios/App/App/Info.plist` (the Xcode pane handles this):

   ```xml
   <key>NSCameraUsageDescription</key>
   <string>FitFlow uses your camera for AI form check, barcode scanning, and food photo analysis.</string>

   <key>NSPhotoLibraryUsageDescription</key>
   <string>FitFlow lets you pick meal photos for AI nutrition analysis.</string>

   <key>NSMicrophoneUsageDescription</key>
   <string>FitFlow can listen for voice commands during workouts (optional).</string>

   <key>NSLocationWhenInUseUsageDescription</key>
   <string>FitFlow uses your location to track outdoor runs, walks, and rides.</string>

   <key>NSHealthShareUsageDescription</key>
   <string>FitFlow reads steps, heart rate, sleep, and workouts from Apple Health to personalize your plan.</string>

   <key>NSHealthUpdateUsageDescription</key>
   <string>FitFlow writes workouts you log here back to Apple Health so your data stays in one place.</string>

   <key>NSUserTrackingUsageDescription</key>
   <string>FitFlow asks before sharing anonymized usage with our analytics to improve the app.</string>
   ```

4. For HealthKit support add the `HealthKit` capability and install a plugin:

   ```bash
   npm install --save @perfood/capacitor-healthkit --legacy-peer-deps
   npx cap sync ios
   ```

   Then update `src/services/healthService.ts` to import HealthKit on iOS the same
   way Health Connect is imported on Android — the abstraction is already in place.

5. Archive in Xcode → Distribute App → App Store Connect to upload a build.
