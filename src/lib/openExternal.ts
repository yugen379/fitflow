import { Capacitor } from '@capacitor/core';
import { openUrlInSystem } from './appSettings';

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
 * Opens a URL externally. On native (Capacitor) the URL goes to the OS first
 * (ACTION_VIEW), so YouTube links open in the YouTube app and Play links in the
 * Play Store; if no app claims it, we fall back to an in-app Custom Tab, then
 * to window.open. On the web it opens a new tab with safe rel attributes.
 */
export const openExternal = async (url: string) => {
  if (Capacitor.isNativePlatform()) {
    if (await openUrlInSystem(url)) return;
    try {
      const browser = await getBrowser();
      if (browser) {
        await browser.open({ url, presentationStyle: 'fullscreen' });
        return;
      }
    } catch (err) {
      console.warn('[openExternal] Browser.open failed, falling back to window.open', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};
