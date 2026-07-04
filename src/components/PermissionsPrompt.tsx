import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Mic, Bell, Check, X, Sparkles, Loader2 } from 'lucide-react';
import { LogoMark } from './Logo';
import { requestPushPermission, isNativeApp, micSupported } from '../lib/pushPermission';
import { openAppSettings } from '../lib/appSettings';

type PermState = 'idle' | 'granted' | 'denied' | 'requesting';

interface Props {
  open: boolean;
  uid?: string;
  onClose: () => void;
  /** Called once all three prompts have been attempted (granted or denied). */
  onComplete?: (result: { camera: PermState; mic: PermState; notifications: PermState }) => void;
}

/**
 * Single-tap permissions flow. Fires camera → mic → notifications in sequence,
 * each as a real browser prompt. Users never need to dig into Chrome settings.
 */
export const PermissionsPrompt: React.FC<Props> = ({ open, uid, onClose, onComplete }) => {
  const [cam, setCam] = useState<PermState>('idle');
  const [mic, setMic] = useState<PermState>('idle');
  const [notif, setNotif] = useState<PermState>(
    typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted'
    : typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied'
    : 'idle',
  );
  const [running, setRunning] = useState(false);
  const [denyReason, setDenyReason] = useState<string | null>(null);

  const reportError = (label: string, err: any) => {
    const name = err?.name || err?.message || String(err);
    console.warn(`[permissions] ${label} failed:`, name, err);
    // Translate the WebRTC error names into something the user can act on.
    if (/NotAllowed|Permission/i.test(name)) {
      return `${label} blocked. Tap the lock/⋮ icon in the address bar → Permissions → set ${label} to Allow → reload.`;
    }
    if (/NotFound|DevicesNotFound/i.test(name)) {
      return `No ${label.toLowerCase()} found on this device.`;
    }
    if (/NotReadable|TrackStart|in use/i.test(name)) {
      return `${label} is in use by another app. Close it and try again.`;
    }
    if (/SecurityError|secure context/i.test(name)) {
      return `${label} needs HTTPS. Make sure the URL starts with https://`;
    }
    if (/Overconstrained/i.test(name)) {
      // Constraint mismatch (e.g. no rear camera) — usually still fine for the app.
      return null;
    }
    return `${label} request failed (${name}).`;
  };

  // Combine camera + mic into a single getUserMedia call. Mobile Chrome is far
  // more reliable with one combined prompt than two sequential ones — back-to-back
  // calls sometimes race the permission UI and the second silently fails.
  const requestCameraAndMic = async (): Promise<{ cam: PermState; mic: PermState }> => {
    setCam('requesting');
    setMic('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
      s.getTracks().forEach(t => t.stop());
      setCam('granted');
      setMic('granted');
      return { cam: 'granted', mic: 'granted' };
    } catch (err: any) {
      // Fall back to individual requests so we can tell which one failed.
      const camRes = await requestCameraOnly(err);
      const micRes = await requestMicOnly(err);
      return { cam: camRes, mic: micRes };
    }
  };

  const requestCameraOnly = async (priorErr?: any): Promise<PermState> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      s.getTracks().forEach(t => t.stop());
      setCam('granted');
      return 'granted';
    } catch (err: any) {
      const msg = reportError('Camera', err || priorErr);
      if (msg) setDenyReason(prev => prev || msg);
      setCam('denied');
      return 'denied';
    }
  };
  const requestMicOnly = async (priorErr?: any): Promise<PermState> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      setMic('granted');
      return 'granted';
    } catch (err: any) {
      const msg = reportError('Microphone', err || priorErr);
      if (msg) setDenyReason(prev => prev || msg);
      setMic('denied');
      return 'denied';
    }
  };
  const requestNotif = async (): Promise<PermState> => {
    setNotif('requesting');
    const r = await requestPushPermission(uid);
    setNotif(r);
    if (r === 'denied' && isNativeApp()) {
      setDenyReason(prev => prev || 'Notifications blocked. Open system Settings → Apps → FitFlow → Notifications → Allow.');
    }
    return r;
  };

  // In the native app the WebView has no Web Speech API, so the mic can't do
  // anything useful — prompt only for camera + notifications there.
  const withMic = micSupported();

  const allowEverything = async () => {
    if (running) return;
    setRunning(true);
    setDenyReason(null);

    // Detect a hard-block (user previously denied at site-settings level) so we
    // can show the recovery path immediately rather than firing a request that
    // silently rejects. Web-only — native uses OS prompts that we can re-fire.
    try {
      if (!isNativeApp() && (navigator as any).permissions?.query) {
        const [camState, micState] = await Promise.all([
          (navigator as any).permissions.query({ name: 'camera' }).catch(() => null),
          (navigator as any).permissions.query({ name: 'microphone' }).catch(() => null),
        ]);
        if (camState?.state === 'denied' || micState?.state === 'denied') {
          setDenyReason('Permissions are blocked at the browser level. Tap the lock/⋮ icon in the address bar → Permissions → set Camera and Microphone to Allow → reload this page.');
        }
      }
    } catch { /* permissions API is best-effort */ }

    let both: { cam: PermState; mic: PermState };
    if (withMic) {
      both = (cam === 'granted' && mic === 'granted')
        ? { cam: 'granted', mic: 'granted' }
        : await requestCameraAndMic();
    } else {
      both = { cam: cam === 'granted' ? 'granted' : await requestCameraOnly(), mic };
    }
    const n = notif === 'granted' ? 'granted' : await requestNotif();
    setRunning(false);
    onComplete?.({ camera: both.cam, mic: both.mic, notifications: n });
    const micOk = !withMic || both.mic === 'granted';
    if (both.cam === 'granted' && micOk && n === 'granted') {
      setTimeout(() => onClose(), 900);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={running ? undefined : onClose}
          />
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="relative bg-surface border border-white/[0.06] w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-5"
          >
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <LogoMark size={32} />
                <div>
                  <p className="text-eyebrow text-accent">One tap</p>
                  <p className="text-xs text-text-dim mt-0.5">All optional, all reversible</p>
                </div>
              </div>
              {!running && (
                <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim hover:text-white" aria-label="Close">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">
                Unlock the full FitFlow.
              </h2>
              <p className="text-text-dim text-sm leading-relaxed">
                {withMic
                  ? 'Allow camera, mic, and notifications in one go — your browser will pop a prompt for each.'
                  : 'Allow camera and notifications in one go — Android will pop a prompt for each.'}
              </p>
            </div>

            <div className="space-y-2">
              <PermLine icon={<Camera size={16} />} label="Camera" sub="Barcode scanner, meal photos, AI form check" state={cam} />
              {withMic && (
                <PermLine icon={<Mic size={16} />} label="Microphone" sub="Voice questions to AI Coach, hands-free logging" state={mic} />
              )}
              <PermLine icon={<Bell size={16} />} label="Notifications" sub="Smart workout reminders, weekly recap" state={notif} />
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={allowEverything}
                disabled={running}
                className="btn-3d w-full h-14 disabled:opacity-70"
              >
                {running ? (
                  <><Loader2 className="animate-spin" size={16} /> Requesting…</>
                ) : (
                  <><Sparkles size={16} /> Allow everything</>
                )}
              </button>
              {!running && (
                <button
                  onClick={onClose}
                  className="w-full h-11 text-xs text-text-dim hover:text-white transition-colors"
                >
                  Maybe later
                </button>
              )}
            </div>

            {(cam === 'denied' || (withMic && mic === 'denied') || notif === 'denied') && (
              <div className="space-y-2">
                <p className="text-xs text-accent-3 leading-snug">
                  {denyReason || (isNativeApp()
                    ? 'Denied one by accident? Fix it in one tap:'
                    : "Denied one by accident? Tap the site lock icon in your browser's address bar, set the permission to Allow, then reload.")}
                </p>
                {isNativeApp() && (
                  <button onClick={() => openAppSettings()} className="btn-ghost w-full h-10 text-xs">
                    Open FitFlow system settings
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const PermLine: React.FC<{ icon: React.ReactNode; label: string; sub: string; state: PermState }> = ({ icon, label, sub, state }) => {
  const isGranted = state === 'granted';
  const isDenied = state === 'denied';
  const isRequesting = state === 'requesting';
  return (
    <div className={`flex items-start gap-3 p-3 rounded-2xl border ${
      isGranted ? 'bg-accent/8 border-accent/30'
      : isDenied ? 'bg-accent-2/8 border-accent-2/25'
      : 'bg-white/[0.02] border-white/[0.06]'
    }`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
        isGranted ? 'bg-accent/15 text-accent'
        : isDenied ? 'bg-accent-2/15 text-accent-2'
        : 'bg-white/[0.04] text-text-dim'
      }`}>
        {icon}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${isGranted ? 'text-accent' : isDenied ? 'text-accent-2' : 'text-white'}`}>{label}</p>
        <p className="text-xs text-text-dim mt-0.5 leading-snug">{sub}</p>
      </div>
      <div className="mt-1.5 shrink-0">
        {isGranted ? <Check size={14} className="text-accent" />
          : isRequesting ? <Loader2 size={14} className="text-accent animate-spin" />
          : isDenied ? <X size={14} className="text-accent-2" />
          : <span className="w-2 h-2 rounded-full bg-white/15" />}
      </div>
    </div>
  );
};
