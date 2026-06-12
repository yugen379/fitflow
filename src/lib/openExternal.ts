import { Capacitor } from '@capacitor/core';

let browserModule: any = null;

const getBrowser = async () => {
  if (browserModule) return browserModule;
  try {
    const mod: any = await import('@capacitor/browser');
    browserModule = mod.Browser;
    return browserModule;
  } catch {
    return null;
  }
};

/**
 * Opens a URL externally. On native (Capacitor) this hands the URL to the system,
 * so YouTube links open in the YouTube app if installed. On the web it opens
 * a new tab with safe rel attributes.
 */
export const openExternal = async (url: string) => {
  if (Capacitor.isNativePlatform()) {
    const browser = await getBrowser();
    if (browser) {
      try {
        await browser.open({ url, presentationStyle: 'fullscreen' });
        return;
      } catch {
        // fall through
      }
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};
