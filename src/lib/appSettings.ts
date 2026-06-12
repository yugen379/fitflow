import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to a small native plugin (android/app/.../AppSettingsPlugin.java) that
// opens the OS "App info" screen, where the user flips Camera permission in one
// tap. This is only possible in the packaged native app — the web has no API to
// open browser/OS settings, so canOpenAppSettings() is false there and the UI
// falls back to the guided steps instead.
interface AppSettingsPlugin {
  openCameraSettings(): Promise<void>;
}

const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

/** True only inside the native Android/iOS app, where a settings deep-link works. */
export const canOpenAppSettings = (): boolean => Capacitor.isNativePlatform();

/** Open the app's system settings page. Returns false on web or on any failure. */
export const openAppSettings = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await AppSettings.openCameraSettings();
    return true;
  } catch {
    return false;
  }
};
