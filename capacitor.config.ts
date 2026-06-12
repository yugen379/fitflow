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
