/// <reference types="vite-plugin-pwa/client" />
/**
 * Service worker: on for the website, OFF inside the Android/iOS app.
 *
 * The bug this fixes (found on an Android 16 emulator, v1.6.3 review): the
 * installed app registered the PWA service worker like the website does. Its
 * cache then kept serving the PREVIOUS release's JavaScript after an app
 * update — the device ran `index-C_2dxOLk.js` while the freshly installed APK
 * shipped `index-cF1xv7Ky.js`. A Play update could leave users on old code.
 *
 * Inside the native shell a service worker buys nothing: every file is already
 * on the device inside the APK, served by Capacitor. So the app never registers
 * one, and on launch removes any worker an older install left behind (plus its
 * caches) and reloads once onto the bundle that actually shipped.
 *
 * The website keeps the worker (offline support + installable PWA), registered
 * here instead of through the plugin's injected <script>, which could not tell
 * the two apart.
 */

const isNativeShell = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

const PURGED_KEY = 'ff_native_sw_purged';

export const setupServiceWorker = async (): Promise<void> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  if (isNativeShell()) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) return;
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    // This page itself came from the old worker's cache. Reload once — guarded,
    // so a failure to unregister can never become a reload loop.
    if (navigator.serviceWorker.controller && !sessionStorage.getItem(PURGED_KEY)) {
      sessionStorage.setItem(PURGED_KEY, '1');
      location.reload();
    }
    return;
  }

  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
};
