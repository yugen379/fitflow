// Cross-platform haptic feedback. On Capacitor (Android/iOS) uses the native
// taptic engine; on the web falls back to navigator.vibrate when available.
// Silently noops if neither is supported so callers can fire and forget.

import { Capacitor } from '@capacitor/core';

type Strength = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

let plugin: any = null;
const getPlugin = async () => {
  if (plugin) return plugin;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod: any = await import('@capacitor/haptics');
    plugin = mod;
    return plugin;
  } catch { return null; }
};

const webVibrate = (ms: number | number[]) => {
  if (typeof navigator === 'undefined') return;
  if ('vibrate' in navigator) {
    try { (navigator as any).vibrate(ms); } catch { /* ignore */ }
  }
};

export const haptic = async (strength: Strength = 'light') => {
  const p = await getPlugin();
  if (p) {
    try {
      switch (strength) {
        case 'light':     return p.Haptics.impact({ style: p.ImpactStyle.Light });
        case 'medium':    return p.Haptics.impact({ style: p.ImpactStyle.Medium });
        case 'heavy':     return p.Haptics.impact({ style: p.ImpactStyle.Heavy });
        case 'success':   return p.Haptics.notification({ type: p.NotificationType.Success });
        case 'warning':   return p.Haptics.notification({ type: p.NotificationType.Warning });
        case 'error':     return p.Haptics.notification({ type: p.NotificationType.Error });
        case 'selection': return p.Haptics.selectionChanged();
      }
    } catch { /* fall through to vibrate */ }
  }
  switch (strength) {
    case 'light':     return webVibrate(10);
    case 'medium':    return webVibrate(20);
    case 'heavy':     return webVibrate(40);
    case 'success':   return webVibrate([15, 50, 30]);
    case 'warning':   return webVibrate([25, 50, 25]);
    case 'error':     return webVibrate([40, 30, 40, 30, 40]);
    case 'selection': return webVibrate(5);
  }
};
