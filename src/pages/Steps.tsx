/**
 * Spatial step analytics.
 *
 * Arrived at by tapping the Home widget, which morphs into this page's header
 * via a shared `layoutId` — the number you tapped is the number you land on.
 *
 * Everything here comes from the local pedometer store (IndexedDB, keyed by
 * date) or from Health Connect when it is available, so the page works offline
 * and shows real history rather than a seeded curve. Days with no record read
 * zero, which is the truth; they are not interpolated.
 */

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Flame, Footprints, MapPin, Timer, TrendingUp } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { useAuth } from '../hooks/useAuth';
import { useTodayActivity } from '../hooks/useTodayActivity';
import { useSteps } from '../hooks/useSteps';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { KCAL_PER_STEP, KM_PER_STEP, formatActiveTime, localDateKey, readStoredDay } from '../lib/pedometer';
import { SPRING } from '../lib/motion';
import { EMPTY_STATS, nextAchievements } from '../lib/achievements';
import type { AchievementStats } from '../lib/achievements';
import type { DayBar } from '../components/3d/StepBars3D';

const StepBars3D = lazy(() => import('../components/3d/StepBars3D').then((m) => ({ default: m.StepBars3D })));

type Horizon = 'day' | 'week' | 'month' | 'year';

const HORIZONS: { id: Horizon; label: string; sub: string }[] = [
  { id: 'day', label: 'Day', sub: 'Today' },
  { id: 'week', label: 'Week', sub: 'Sun–Sat' },
  { id: 'month', label: 'Month', sub: '30 days' },
  { id: 'year', label: 'Year', sub: '12 months' },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEP_GOAL = 10000;

/** The dates of the current Sunday–Saturday week, oldest first. */
const weekDates = (): Date[] => {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
};

const lastNDates = (n: number): Date[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });

const Metric: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({ icon, value, label }) => (
  <div className="glass-spatial px-3 py-3 text-center">
    <span className="inline-flex text-text-mute">{icon}</span>
    <p className="num text-base font-bold text-white tabular-nums mt-1 leading-none">{value}</p>
    <p className="text-[10px] uppercase tracking-[0.12em] text-text-mute mt-1">{label}</p>
  </div>
);

export const Steps: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { metrics, status } = useTodayActivity(profile?.uid, profile?.height);
  const deviceSteps = status === 'connected' && metrics ? metrics.steps : null;
  const live = useSteps({ deviceSteps });

  const [horizon, setHorizon] = useState<Horizon>('week');
  const [history, setHistory] = useState<Record<string, number>>({});

  // Pull stored days for whichever horizon is selected. Reads are cheap and
  // local; nothing here touches the network.
  useEffect(() => {
    let cancelled = false;
    const dates =
      horizon === 'day'
        ? [new Date()]
        : horizon === 'week'
          ? weekDates()
          : horizon === 'month'
            ? lastNDates(30)
            : lastNDates(365);

    void (async () => {
      const entries = await Promise.all(
        dates.map(async (date) => {
          const key = localDateKey(date);
          const snapshot = await readStoredDay(key);
          return [key, snapshot.steps] as const;
        }),
      );
      if (!cancelled) setHistory(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [horizon, live.steps]);

  const todayKey = localDateKey();

  const bars = useMemo<DayBar[]>(() => {
    return weekDates().map((date) => {
      const key = localDateKey(date);
      const stored = history[key] ?? 0;
      // Today always shows the live count, which is ahead of the last flush.
      const steps = key === todayKey ? Math.max(stored, live.steps) : stored;
      return { label: DAY_LABELS[date.getDay()], steps, isToday: key === todayKey };
    });
  }, [history, live.steps, todayKey]);

  const horizonTotals = useMemo(() => {
    const values = Object.entries(history).map(([key, steps]) =>
      key === todayKey ? Math.max(steps, live.steps) : steps,
    );
    const total = values.reduce((a, b) => a + b, 0);
    const activeDays = values.filter((v) => v > 0).length;
    return {
      total,
      average: activeDays > 0 ? Math.round(total / activeDays) : 0,
      best: values.length > 0 ? Math.max(...values) : 0,
      activeDays,
    };
  }, [history, live.steps, todayKey]);

  // Achievement queue is driven by the same numbers shown above it.
  const stats: AchievementStats = useMemo(
    () => ({
      ...EMPTY_STATS,
      todaySteps: live.steps,
      bestDaySteps: Math.max(horizonTotals.best, live.steps),
      totalSteps: horizonTotals.total,
      totalDistanceKm: horizonTotals.total * KM_PER_STEP,
      stepStreak: profile?.streak ?? 0,
      activityStreak: profile?.streak ?? 0,
      activeDays: horizonTotals.activeDays,
      activeMinutes: Math.round(live.activeMs / 60000),
    }),
    [live.steps, live.activeMs, horizonTotals, profile?.streak],
  );

  const upcoming = useMemo(() => nextAchievements(stats, 3), [stats]);

  return (
    <div className="pb-32 pt-4 px-4 space-y-5">
      {/* Header — the morph target for the Home widget. */}
      <div className="flex items-start gap-2 pt-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="w-11 h-11 -ml-2 rounded-xl flex items-center justify-center text-text-dim active:scale-95 transition-transform shrink-0"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-accent">Step analytics</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight mt-0.5">
            Every step today
          </h1>
        </div>
      </div>

      <motion.section layoutId="step-hub-transition" transition={SPRING.weighty} className="glass-spatial p-5">
        <p className="text-eyebrow text-accent inline-flex items-center gap-1.5">
          <Footprints size={12} aria-hidden="true" />
          {live.source === 'health-connect'
            ? 'From Health Connect'
            : live.source === 'device-sensor'
              ? 'From this device'
              : 'Not counting yet'}
        </p>
        <p className="num text-5xl font-bold text-white tabular-nums leading-none mt-2">
          <AnimatedNumber value={Math.round(live.steps)} />
        </p>
        <p className="text-xs text-text-dim mt-1.5">
          of {STEP_GOAL.toLocaleString()} · {live.cadence > 0 ? `${live.cadence} steps/min` : 'stopped'}
        </p>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <Metric icon={<MapPin size={14} />} value={`${live.distanceKm.toFixed(1)} km`} label="Distance" />
          <Metric icon={<Flame size={14} />} value={`${Math.round(live.calories)}`} label="kcal" />
          <Metric icon={<Timer size={14} />} value={formatActiveTime(live.activeMs)} label="Active" />
        </div>

        {live.needsPermission ? (
          <button
            type="button"
            onClick={() => {
              void haptic('selection');
              void live.requestPermission();
            }}
            className="mt-4 w-full h-12 rounded-2xl bg-accent text-[#04060A] font-semibold text-sm active:scale-[0.98] transition-transform"
          >
            Enable motion access
          </button>
        ) : null}

        {!live.supported && live.source === 'none' ? (
          <p className="text-[11px] text-text-mute mt-3 leading-relaxed">
            This browser has no motion sensor. Install FitFlow to your home screen on a phone, or connect Health
            Connect, to count steps.
          </p>
        ) : null}
      </motion.section>

      {/* Horizon tabs */}
      <div className="flex gap-2" role="tablist" aria-label="Time range">
        {HORIZONS.map((item) => {
          const selected = horizon === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                void haptic('selection');
                setHorizon(item.id);
              }}
              className={cn(
                'flex-1 h-12 rounded-2xl border text-xs font-semibold transition-colors duration-150 active:scale-[0.97]',
                selected
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
              )}
            >
              <span className="block leading-none">{item.label}</span>
              <span className="block text-[9px] text-text-mute mt-1 font-medium">{item.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Weekly 3D columns */}
      <section className="glass-spatial p-4" aria-labelledby="week-heading">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 id="week-heading" className="font-display text-base font-semibold text-white">
            This week
          </h2>
          <span className="num text-[11px] text-text-dim tabular-nums">
            avg {horizonTotals.average.toLocaleString()}
          </span>
        </div>
        <Suspense fallback={<div className="h-44 liquid-skeleton rounded-[24px]" />}>
          <StepBars3D bars={bars} goal={STEP_GOAL} />
        </Suspense>
        <p className="text-[11px] text-text-mute mt-2 leading-relaxed">
          Gold line marks {STEP_GOAL.toLocaleString()} steps. Lime bars cleared it.
        </p>
      </section>

      {/* Horizon summary */}
      <section className="grid grid-cols-3 gap-3">
        <Metric icon={<Footprints size={14} />} value={horizonTotals.total.toLocaleString()} label="Total" />
        <Metric icon={<TrendingUp size={14} />} value={horizonTotals.best.toLocaleString()} label="Best day" />
        <Metric
          icon={<MapPin size={14} />}
          value={`${(horizonTotals.total * KM_PER_STEP).toFixed(1)} km`}
          label="Distance"
        />
      </section>

      {/* Next achievements */}
      <section className="glass-spatial p-5 space-y-3" aria-labelledby="next-heading">
        <div>
          <p className="text-eyebrow text-accent">Next up</p>
          <h2 id="next-heading" className="font-display text-base font-semibold text-white mt-0.5">
            Closest unlocks
          </h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-text-dim">Start moving to line up your first badge.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map(({ achievement, ratio, remaining }) => (
              <li key={achievement.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-white truncate">{achievement.name}</span>
                  <span className="num text-[11px] text-text-dim tabular-nums shrink-0">
                    {Math.round(ratio * 100)}%
                  </span>
                </div>
                <span className="mt-1.5 block h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-accent origin-left transition-transform duration-500"
                    style={{ transform: `scaleX(${Math.max(0.02, ratio)})` }}
                  />
                </span>
                <p className="text-[11px] text-text-mute mt-1">
                  {Math.round(remaining).toLocaleString()} {achievement.unit} to go
                </p>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            void haptic('light');
            navigate('/achievements');
          }}
          className="w-full h-11 rounded-2xl bg-white/[0.04] border border-white/[0.07] text-text-dim text-xs font-medium active:scale-[0.98] transition-transform"
        >
          See all 52 achievements
        </button>
      </section>
    </div>
  );
};

export default Steps;
