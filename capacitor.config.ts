import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitflow.fitness',
  appName: 'FitFlow',
  webDir: 'dist',
  android: {
    backgroundColor: '#06070A',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#06070A',
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // Native Google sign-in for the APK. skipNativeAuth=true means the plugin only
    // returns the Google credential; we exchange it for a JS-SDK session in
    // src/lib/firebase.ts (signInWithGoogleNative) so the web Firebase SDK stays the
    // single source of auth truth. Requires android/app/google-services.json + the
    // app's SHA-1 registered in the Firebase Console (see RELEASES.md).
    // The list must stay in step with android/variables.gradle (rgcfaInclude*)
    // and with NATIVE_PROVIDERS in src/lib/authProviders.ts — those decide what
    // is actually on the classpath and what the login screen offers. Facebook is
    // absent from all three until the Facebook app credentials exist; see
    // AUTH_PROVIDERS.md. Apple needs no native dependency: the plugin drives it
    // through firebase-auth's own OAuth activity.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#06070A',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    // Dark app → light system-bar icons. The insets themselves are handled
    // natively: with viewport-fit=cover removed (index.html), Capacitor's
    // SystemBars pads the WebView by the real bar sizes, so no screen can sit
    // underneath the status/navigation bars on Android 15+ edge-to-edge.
    SystemBars: {
      style: 'DARK',
    },
  },
};

export default config;
