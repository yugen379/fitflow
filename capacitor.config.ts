import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitflow.app',
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
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#06070A',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
