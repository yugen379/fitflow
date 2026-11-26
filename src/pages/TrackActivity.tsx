/**
 * GPS walk / run / ride recording.
 *
 * Lazy route (/track-activity). On Android the native GpsTracker plugin runs a
 * `location` foreground service that keeps recording with the screen off; on
 * the web it falls back to watchPosition, which only records while this page
 * is open and the screen is on — and says so.
 *
 * All numbers come from src/lib/gpsMath.ts (filters + smoother + auto-pause),
 * proven by `npm run proof:gps`. The route is drawn as an inline SVG polyline:
 * no map tiles, no new network hosts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, ChevronLeft, Footprints, MapPin, Pause, Play, Square, Timer, Zap } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useUnits } from '../hooks/useUnits';
import { saveUnitPrefs } from '../services/unitsService';
import { logWorkout } from '../services/dataService';
import {
  summarize, simplifyForStorage, formatDistance, formatDuration, formatPace, formatSpeed, routeToSvgPoints,
} from '../lib/gpsMath';
import type { GpsActivity, GpsPoint, UnitSystem } from '../lib/gpsMath';
import { GpsTracker, WebGpsRecorder, gpsErrorMessage, hasNativeGps, nativeDistanceUnit } from '../lib/gpsTracker';
import type { GpsSnapshot, RecordingState } from '../lib/gpsTracker';
import { t, msg, tDyn } from '../i18n/i18n';

const ACTIVITIES: { id: GpsActivity; label: string; icon: typeof Bike; type: string }[] = [
  // `label` is shown with tDyn(); the saved workout title keeps the English.
  { id: 'walk', label: msg('Walk'), icon: Footprints, type: 'Walking' },
  { id: 'run', label: msg('Run'), icon: Zap, type: 'Running' },
  { id: 'cycle', label: msg('Ride'), icon: Bike, type: 'Cycling' },
];

// km / mi used to be a per-device toggle kept in localStorage under this key.
// It now comes from the profile's units (Settings), so every screen agrees;
// the old key is cleared once so it cannot linger.
const LEGACY_UNITS_KEY = 'fitflow.gps.units';
/** "5.00 km", "8:03 /mi", "18.2 mph" from gpsMath's { value, unit }. */
const joinVU = ({ value, unit }: { value: string; unit: string }) => `${value} ${unit}`;

export const TrackActivity: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const native = useMemo(() => hasNativeGps(), []);
  const webRecorder = useRef<WebGpsRecorder | null>(null);
  const webAvailable = useMemo(() => !native && WebGpsRecorder.available(), [native]);

  const [activity, setActivity] = useState<GpsActivity>('run');
  const unitPrefs = useUnits();
  const units: UnitSystem = unitPrefs.prefs.system;
  useEffect(() => { try { localStorage.removeItem(LEGACY_UNITS_KEY); } catch { /* storage blocked: nothing to clear */ } }, []);
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gpsOff, setGpsOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const pointsRef = useRef<GpsPoint[]>([]);

  const apply = useCallback((snap: GpsSnapshot, replace = false) => {
    setState(snap.state);
    setActivity(snap.activity);
    setElapsedMs(snap.elapsedMs);
    setGpsOff(!snap.gpsEnabled && snap.state === 'recording');
    if (replace) pointsRef.current = snap.points.slice();
    else if (snap.points.length && snap.since === pointsRef.current.length) pointsRef.current = pointsRef.current.concat(snap.points);
    setPoints(pointsRef.current);
  }, []);

  // Recover a session the service kept going while this page (or the whole
  // app) was gone — including one that was stopped but never saved.
  useEffect(() => {
    if (!native) return;
    GpsTracker.getCurrent({ since: 0 }).then((snap) => {
      if (snap.state !== 'idle') apply(snap, true);
    }).catch(() => { /* plugin missing on an old build: stays idle */ });
  }, [native, apply]);

  // Poll while a session exists.
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return;
    const tick = () => {
      if (native) {
        GpsTracker.getCurrent({ since: pointsRef.current.length }).then((s) => apply(s)).catch(() => {});
      } else if (webRecorder.current) {
        const snap = webRecorder.current.snapshot(pointsRef.current.length);
        apply(snap);
        setError(webRecorder.current.lastError);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, native, apply]);

  // The ongoing notification shows distance too: keep it in the chosen unit
  // when the km / mi switch (or Settings) changes mid-recording. An APK older
  // than this method just rejects, and its notification stays in km.
  const recording = state === 'recording' || state === 'paused';
  useEffect(() => {
    if (!native || !recording) return;
    GpsTracker.setDistanceUnit({ unit: nativeDistanceUnit(units) }).catch(() => {});
  }, [native, recording, units]);

  const summary = useMemo(
    () => summarize(points, activity, { weightKg: profile?.weight || 70, units }),
    [points, activity, units, profile?.weight],
  );

  // The quick km / mi switch changes the PROFILE setting (distance system
  // only; body weight and energy stay as chosen), so Settings, Steps and the
  // rest of the app follow it. The profile snapshot re-renders this screen.
  const setUnitsPersist = (u: UnitSystem) => {
    if (u === units) return;
    if (!profile?.uid) { showToast(t('Sign in to change units'), 'info'); return; }
    void saveUnitPrefs(profile.uid, { ...unitPrefs.prefs, system: u })
      .catch(() => showToast(t('Could not change units. Try again.'), 'error'));
  };

  const start = async () => {
    setError(null);
    setGpsOff(false);
    void haptic('medium');
    if (native) {
      setBusy(true);
      try {
        const perm = await GpsTracker.checkPermissions();
        if (perm.location !== 'granted') {
          const after = await GpsTracker.requestPermissions({ permissions: ['location', 'notifications'] });
          if (after.location !== 'granted') {
            // Coarse-only still reports as not granted; let the plugin say which.
            const st = await GpsTracker.getStatus().catch(() => null);
            if (!st?.preciseLocation) {
              setError(gpsErrorMessage({ code: after.location === 'denied' ? 'PERMISSION_DENIED' : 'PRECISE_REQUIRED' }));
              return;
            }
          }
        } else if (perm.notifications !== 'granted') {
          // Optional: recording works without it, the user just cannot see it.
          await GpsTracker.requestPermissions({ permissions: ['notifications'] }).catch(() => {});
        }
        pointsRef.current = [];
        apply(await GpsTracker.start({ activity, distanceUnit: nativeDistanceUnit(units) }), true);
      } catch (e) {
        if ((e as { code?: string })?.code === 'GPS_DISABLED') setGpsOff(true);
        setError(gpsErrorMessage(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!webAvailable) return;
    webRecorder.current = new WebGpsRecorder();
    webRecorder.current.start(activity);
    pointsRef.current = [];
    apply(webRecorder.current.snapshot(0), true);
  };

  const pause = async () => {
    void haptic('light');
    if (native) apply(await GpsTracker.pause().catch(() => ({ ...snapFallback(), state: 'paused' as const })));
    else if (webRecorder.current) { webRecorder.current.pause(); apply(webRecorder.current.snapshot(pointsRef.current.length)); }
  };

  const resume = async () => {
    void haptic('light');
    setError(null);
    if (native) {
      try { apply(await GpsTracker.resume()); } catch (e) { setError(gpsErrorMessage(e)); if ((e as { code?: string })?.code === 'GPS_DISABLED') setGpsOff(true); }
    } else if (webRecorder.current) { webRecorder.current.resume(); apply(webRecorder.current.snapshot(pointsRef.current.length)); }
  };

  const finish = async () => {
    void haptic('medium');
    if (native) {
      try { apply(await GpsTracker.stop(), true); } catch (e) { setError(gpsErrorMessage(e)); }
    } else if (webRecorder.current) {
      webRecorder.current.stop();
      apply(webRecorder.current.snapshot(0), true);
    }
  };

  const snapFallback = (): GpsSnapshot => ({
    state, activity, startedAt: 0, elapsedMs, pointCount: pointsRef.current.length, gpsEnabled: true, points: [], since: pointsRef.current.length,
  });

  const reset = async () => {
    if (native) await GpsTracker.clear().catch(() => {});
    webRecorder.current?.clear();
    pointsRef.current = [];
    setPoints([]);
    setElapsedMs(0);
    setState('idle');
  };

  const canSave = summary.distanceM >= 50 || summary.movingS >= 60;

  const save = async () => {
    if (!profile?.uid || busy) return;
    setBusy(true);
    try {
      const route = simplifyForStorage(summary.cleaned).points.map((p) => ({
        lat: Math.round(p.lat * 1e6) / 1e6,
        lng: Math.round(p.lng * 1e6) / 1e6,
      }));
      const meta = ACTIVITIES.find((a) => a.id === activity)!;
      const saved = await logWorkout(profile.uid, {
        type: meta.type,
        title: `${meta.label} · ${joinVU(formatDistance(summary.distanceM, units))}`,
        duration: Math.max(1, Math.round(summary.movingS / 60)),
        caloriesBurned: Math.max(1, Math.round(summary.calories)),
        distanceKm: Math.round(summary.distanceM) / 1000,
        movingSeconds: Math.round(summary.movingS),
        elevationGainM: Math.round(summary.elevationGainM),
        route,
        notes: '',
      });
      showToast(t('Saved to your workouts'), 'success');
      // Finishing a walk / run / ride is a win. A queued (offline or failed)
      // save is not: the review card cannot load offline anyway.
      if (saved !== 'queued' && saved !== 'offline-queued') {
        void import('../services/reviewService').then((m) => m.maybeAskForReview('gps_activity')).catch(() => {});
      }
      await reset();
      navigate('/workout');
    } catch {
      showToast(t('Could not save — your route is kept on this phone, try again'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const dist = formatDistance(summary.distanceM, units);
  const paceOrSpeed = activity === 'cycle'
    ? formatSpeed(summary.speedMps, units)
    : formatPace(summary.paceSPerKm, units);
  const svgPts = useMemo(() => routeToSvgPoints(summary.cleaned, 320, 200), [summary.cleaned]);
  const last = svgPts ? svgPts.split(' ').at(-1)!.split(',') : null;
  const first = svgPts ? svgPts.split(' ')[0].split(',') : null;
  const idle = state === 'idle';

  return (
    <div className="pb-32 pt-4 px-4 space-y-5">
      <div className="flex items-start gap-2 pt-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('Go back')}
          className="w-11 h-11 -ml-2 rounded-xl flex items-center justify-center text-text-dim active:scale-95 transition-transform shrink-0"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-accent">{t('GPS recording')}</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight mt-0.5">
            {t('Record a walk, run or ride')}
          </h1>
        </div>
        <div className="flex rounded-xl border border-white/10 overflow-hidden shrink-0 mt-1" role="group" aria-label={t('Units')}>
          {(['metric', 'imperial'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnitsPersist(u)}
              aria-pressed={units === u}
              className={cn('px-2.5 h-8 text-[11px] font-semibold', units === u ? 'bg-accent text-[#04060A]' : 'text-text-dim')}
            >
              {u === 'metric' ? 'km' : 'mi'}
            </button>
          ))}
        </div>
      </div>

      {!native ? (
        <p className="glass p-4 text-xs text-text-dim leading-relaxed">
          {webAvailable
            ? t('Browser mode: recording only works while this page is open and the screen stays on. For background recording with the screen off, use the FitFlow Android app.')
            : t('GPS recording needs the FitFlow Android app — this browser has no location access.')}
        </p>
      ) : null}

      {idle ? (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Activity')}>
          {ACTIVITIES.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={activity === a.id}
              onClick={() => { void haptic('selection'); setActivity(a.id); }}
              className={cn(
                'glass h-20 flex flex-col items-center justify-center gap-1.5 rounded-2xl transition-colors',
                activity === a.id ? 'border-accent/60 bg-accent/10 text-accent' : 'text-text-dim',
              )}
            >
              <a.icon size={20} aria-hidden="true" />
              <span className="text-sm font-semibold">{tDyn(a.label)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className="glass-spatial p-5">
        <p className="text-eyebrow text-accent inline-flex items-center gap-1.5">
          <Timer size={12} aria-hidden="true" />
          {state === 'recording' ? t('Recording') : state === 'paused' ? t('Paused') : state === 'stopped' ? t('Finished') : t('Ready')}
          {state !== 'idle' ? ` · ${tDyn(ACTIVITIES.find((a) => a.id === activity)?.label)}` : ''}
        </p>
        <p className="num text-6xl font-bold text-white tabular-nums leading-none mt-2" aria-live="off">
          {formatDuration(elapsedMs / 1000)}
        </p>
        <p className="text-xs text-text-dim mt-1.5">{t('Moving {time}', { time: formatDuration(summary.movingS) })}</p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Stat value={dist.value} unit={dist.unit} label={t('Distance')} />
          <Stat value={paceOrSpeed.value} unit={paceOrSpeed.unit} label={activity === 'cycle' ? t('Avg speed') : t('Avg pace')} />
          <Stat value={unitPrefs.formatEnergyNumber(Math.round(summary.calories))} unit={unitPrefs.energyUnit} label={t('Calories')} />
          <Stat {...unitPrefs.elevationParts(summary.elevationGainM)} label={t('Climb')} />
        </div>

        {gpsOff ? (
          <div className="mt-4 rounded-2xl border border-accent-4/30 bg-accent-4/10 p-3">
            <p className="text-xs text-accent-4 font-semibold">{t('Location is off — no route is being recorded.')}</p>
            {native ? (
              <button
                type="button"
                onClick={() => void GpsTracker.openLocationSettings().catch(() => {})}
                className="mt-2 h-10 w-full rounded-xl bg-accent-4/20 text-accent-4 text-xs font-semibold"
              >
                {t('Turn on location')}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-xs text-accent-4 mt-3 leading-relaxed">{error}</p> : null}

        <div className="flex gap-2 mt-5">
          {idle ? (
            <button
              type="button"
              disabled={busy || (!native && !webAvailable)}
              onClick={() => void start()}
              className="flex-1 h-14 rounded-2xl bg-accent text-[#04060A] font-bold text-base inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Play size={18} aria-hidden="true" /> {t('Start')}
            </button>
          ) : null}
          {state === 'recording' ? (
            <button type="button" onClick={() => void pause()} className="flex-1 h-14 rounded-2xl bg-white/10 text-white font-semibold inline-flex items-center justify-center gap-2">
              <Pause size={18} aria-hidden="true" /> {t('Pause')}
            </button>
          ) : null}
          {state === 'paused' ? (
            <button type="button" onClick={() => void resume()} className="flex-1 h-14 rounded-2xl bg-accent text-[#04060A] font-bold inline-flex items-center justify-center gap-2">
              <Play size={18} aria-hidden="true" /> {t('Resume')}
            </button>
          ) : null}
          {state === 'recording' || state === 'paused' ? (
            <button type="button" onClick={() => void finish()} className="flex-1 h-14 rounded-2xl bg-white/10 text-white font-semibold inline-flex items-center justify-center gap-2">
              <Square size={16} aria-hidden="true" /> {t('Finish')}
            </button>
          ) : null}
          {state === 'stopped' ? (
            <>
              <button
                type="button"
                disabled={busy || !canSave || !profile?.uid}
                onClick={() => void save()}
                className="flex-1 h-14 rounded-2xl bg-accent text-[#04060A] font-bold disabled:opacity-50"
              >
                {busy ? t('Saving…') : t('Save')}
              </button>
              <button
                type="button"
                onClick={() => { if (window.confirm(t('Discard this recording?'))) void reset(); }}
                className="h-14 px-5 rounded-2xl bg-white/10 text-text-dim font-semibold"
              >
                {t('Discard')}
              </button>
            </>
          ) : null}
        </div>
        {state === 'stopped' && !canSave ? (
          <p className="text-[11px] text-text-mute mt-2">{t('Too short to save — record at least a minute of movement.')}</p>
        ) : null}
      </section>

      <section className="glass p-4">
        <p className="text-eyebrow text-text-dim inline-flex items-center gap-1.5 mb-2">
          <MapPin size={12} aria-hidden="true" /> {t('Route')}
        </p>
        {svgPts ? (
          <svg viewBox="0 0 320 200" className="w-full h-auto" role="img" aria-label={t('Your route')}>
            <polyline points={svgPts} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="text-accent" />
            {first ? <circle cx={first[0]} cy={first[1]} r={5} className="fill-white" /> : null}
            {last ? <circle cx={last[0]} cy={last[1]} r={6} className="fill-accent" /> : null}
          </svg>
        ) : (
          <p className="text-xs text-text-mute py-8 text-center">
            {state === 'recording' ? t('Waiting for GPS — stand outside with a clear view of the sky.') : t('Your route appears here.')}
          </p>
        )}
      </section>

      {summary.splits.length ? (
        <section className="glass p-4">
          <p className="text-eyebrow text-text-dim mb-2">{t('Splits')}</p>
          <ul className="divide-y divide-white/5">
            {summary.splits.map((s) => {
              const perUnit = s.distanceM > 0 ? s.seconds / (s.distanceM / (units === 'imperial' ? 1609.344 : 1000)) : 0;
              return (
                <li key={s.index} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-text-dim">
                    {s.partial
                      ? joinVU(formatDistance(s.distanceM, units))
                      : units === 'imperial' ? t('Mile {n}', { n: s.index }) : t('Km {n}', { n: s.index })}
                  </span>
                  <span className="num text-white tabular-nums">
                    {activity === 'cycle'
                      ? joinVU(formatSpeed(s.seconds > 0 ? s.distanceM / s.seconds : 0, units))
                      : joinVU(formatPace(units === 'imperial' ? perUnit / 1.609344 : perUnit, units))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

const Stat: React.FC<{ value: string; unit: string; label: string }> = ({ value, unit, label }) => (
  <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
    <p className="num text-2xl font-bold text-white tabular-nums leading-none">
      {value} <span className="text-xs font-semibold text-text-dim">{unit}</span>
    </p>
    <p className="text-[11px] text-text-mute mt-1">{label}</p>
  </div>
);

export default TrackActivity;
