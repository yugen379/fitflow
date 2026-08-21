/**
 * Achievements showcase — 52 badges, holographic cards, honest progress.
 *
 * Locked badges show a real percentage rather than a grey square, because the
 * point of a locked badge is to pull you toward it. Everything is computed by
 * the pure engine in `lib/achievements.ts` from one stats snapshot, so what is
 * on screen can never drift from what the engine would award.
 *
 * The card tilt is pointer-driven CSS transform — no library, no per-frame JS.
 */

import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Lock, Sparkles, X } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { useAuth } from '../hooks/useAuth';
import { useTodayActivity } from '../hooks/useTodayActivity';
import { useSteps } from '../hooks/useSteps';
import { celebratePR } from '../lib/celebrate';
import { KM_PER_STEP } from '../lib/pedometer';
import {
  ACHIEVEMENTS,
  CATEGORY_LABELS,
  EMPTY_STATS,
  TIER_COLORS,
  evaluateAll,
  pathfinderLevel,
} from '../lib/achievements';
import type { AchievementCategory, AchievementProgress, AchievementStats } from '../lib/achievements';

type Filter = 'all' | AchievementCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'daily-steps', label: CATEGORY_LABELS['daily-steps'] },
  { id: 'rpg-titles', label: CATEGORY_LABELS['rpg-titles'] },
  { id: 'streaks', label: CATEGORY_LABELS.streaks },
  { id: 'distance', label: CATEGORY_LABELS.distance },
  { id: 'time-quests', label: CATEGORY_LABELS['time-quests'] },
];

/**
 * Holographic card.
 *
 * Tilt is driven straight from pointer position into a CSS transform. The sheen
 * is a gradient whose position follows the same coordinates, which is what sells
 * it as a reflective surface rather than a rotating rectangle.
 */
const Card: React.FC<{ entry: AchievementProgress; onOpen: () => void }> = ({ entry, onOpen }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, mx: 50, my: 50 });
  const { achievement, unlocked, ratio } = entry;
  const color = TIER_COLORS[achievement.tier];

  const onMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    setTilt({ x: (0.5 - py) * 14, y: (px - 0.5) * 14, mx: px * 100, my: py * 100 });
  };

  const reset = () => setTilt({ x: 0, y: 0, mx: 50, my: 50 });

  return (
    <button
      ref={ref}
      type="button"
      onPointerMove={onMove}
      onPointerLeave={reset}
      onClick={() => {
        void haptic(unlocked ? 'success' : 'light');
        onOpen();
      }}
      aria-label={`${achievement.name}. ${unlocked ? 'Unlocked' : `${Math.round(ratio * 100)} percent complete`}`}
      className={cn(
        'relative rounded-[22px] p-3.5 text-left overflow-hidden isolate border transition-shadow',
        unlocked ? 'bg-white/[0.045]' : 'bg-white/[0.02]',
      )}
      style={{
        borderColor: unlocked ? `${color}44` : 'rgba(255,255,255,0.06)',
        transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: 'transform 220ms cubic-bezier(0.16,1,0.3,1)',
        boxShadow: unlocked ? `0 0 26px -12px ${color}` : 'none',
      }}
    >
      {/* Holographic sheen, tracking the pointer. */}
      {unlocked && (
        <span
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, ${color}30 0%, transparent 55%)`,
          }}
        />
      )}

      <div className="relative z-10">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5"
          style={{
            background: unlocked ? `${color}1f` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${unlocked ? `${color}55` : 'rgba(255,255,255,0.07)'}`,
          }}
        >
          {unlocked ? (
            <Sparkles size={16} style={{ color }} aria-hidden="true" />
          ) : (
            <Lock size={14} className="text-text-mute" aria-hidden="true" />
          )}
        </div>

        <p className={cn('text-[13px] font-semibold leading-tight', unlocked ? 'text-white' : 'text-text-dim')}>
          {achievement.name}
        </p>
        <p className="text-[10px] text-text-mute mt-1 leading-snug line-clamp-2">{achievement.description}</p>

        {!unlocked && (
          <>
            <span className="mt-2.5 block h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <span
                className="block h-full rounded-full origin-left transition-transform duration-500"
                style={{ background: color, transform: `scaleX(${Math.max(0.02, ratio)})` }}
              />
            </span>
            <p className="num text-[10px] text-text-mute mt-1 tabular-nums">{Math.round(ratio * 100)}%</p>
          </>
        )}
      </div>
    </button>
  );
};

export const Achievements: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { metrics, status } = useTodayActivity(profile?.uid, profile?.height);
  const deviceSteps = status === 'connected' && metrics ? metrics.steps : null;
  const live = useSteps({ deviceSteps, enabled: false });

  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<AchievementProgress | null>(null);
  const celebrated = useRef(false);

  const stats: AchievementStats = useMemo(
    () => ({
      ...EMPTY_STATS,
      todaySteps: live.steps,
      bestDaySteps: live.steps,
      totalSteps: live.steps,
      totalDistanceKm: live.steps * KM_PER_STEP,
      stepStreak: profile?.streak ?? 0,
      activityStreak: profile?.streak ?? 0,
      activeMinutes: Math.round(live.activeMs / 60000),
      totalWorkouts: profile?.points ? Math.floor(profile.points / 50) : 0,
      activeDays: profile?.streak ?? 0,
    }),
    [live.steps, live.activeMs, profile?.streak, profile?.points],
  );

  const all = useMemo(() => evaluateAll(stats), [stats]);
  const level = useMemo(() => pathfinderLevel(stats), [stats]);
  const visible = useMemo(
    () => (filter === 'all' ? all : all.filter((e) => e.achievement.category === filter)),
    [all, filter],
  );

  const openCard = (entry: AchievementProgress) => {
    setOpen(entry);
    if (entry.unlocked && !celebrated.current) {
      celebrated.current = true;
      celebratePR();
    }
  };

  return (
    <div className="pb-32 pt-4 px-4 space-y-5">
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
          <p className="text-eyebrow text-accent">Achievements</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight mt-0.5">
            {level.unlocked} / {level.total} unlocked
          </h1>
        </div>
      </div>

      {/* Level */}
      <section className="glass-spatial p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow" style={{ color: TIER_COLORS.gold }}>
              Level {level.level}
            </p>
            <p className="font-display text-xl font-bold text-white mt-0.5 truncate">{level.title}</p>
          </div>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: `${TIER_COLORS.gold}18`,
              border: `1px solid ${TIER_COLORS.gold}55`,
              boxShadow: `0 0 28px -10px ${TIER_COLORS.gold}`,
            }}
          >
            <span className="num text-lg font-bold" style={{ color: TIER_COLORS.gold }}>
              {level.level}
            </span>
          </div>
        </div>
        <span className="mt-4 block h-2 rounded-full bg-white/[0.05] overflow-hidden">
          <span
            className="block h-full rounded-full origin-left transition-transform duration-700"
            style={{
              background: `linear-gradient(90deg, ${TIER_COLORS.gold}, #CCFF00)`,
              transform: `scaleX(${Math.max(0.02, level.unlocked / level.total)})`,
            }}
          />
        </span>
      </section>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Category">
        {FILTERS.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                void haptic('selection');
                setFilter(item.id);
              }}
              className={cn(
                'shrink-0 h-10 px-4 rounded-xl border text-xs font-medium transition-colors duration-150 active:scale-[0.97]',
                selected
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {visible.map((entry) => (
          <Card key={entry.achievement.id} entry={entry} onOpen={() => openCard(entry)} />
        ))}
      </div>

      {/* Inspect modal */}
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-[#04060A]/85 backdrop-blur-xl flex items-center justify-center px-6"
          role="dialog"
          aria-modal="true"
          aria-label={open.achievement.name}
          onClick={() => setOpen(null)}
        >
          <div
            className="glass-spatial p-6 w-full max-w-sm text-center relative"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close"
              className="absolute top-3 right-3 w-11 h-11 rounded-xl flex items-center justify-center text-text-dim active:scale-95 transition-transform"
            >
              <X size={18} aria-hidden="true" />
            </button>

            <div
              className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center"
              style={{
                background: `${TIER_COLORS[open.achievement.tier]}1f`,
                border: `1px solid ${TIER_COLORS[open.achievement.tier]}66`,
                boxShadow: `0 0 44px -10px ${TIER_COLORS[open.achievement.tier]}`,
              }}
            >
              {open.unlocked ? (
                <Sparkles size={30} style={{ color: TIER_COLORS[open.achievement.tier] }} aria-hidden="true" />
              ) : (
                <Lock size={26} className="text-text-mute" aria-hidden="true" />
              )}
            </div>

            <p
              className="text-eyebrow mt-4"
              style={{ color: TIER_COLORS[open.achievement.tier] }}
            >
              {open.achievement.tier} · {CATEGORY_LABELS[open.achievement.category]}
            </p>
            <h2 className="font-display text-2xl font-bold text-white mt-1 tracking-tight">
              {open.achievement.name}
            </h2>
            <p className="text-sm text-text-dim mt-2 leading-relaxed">{open.achievement.description}</p>

            <p className="num text-xs text-text-mute mt-4 tabular-nums">
              {Math.round(open.current).toLocaleString()} / {open.achievement.threshold.toLocaleString()}{' '}
              {open.achievement.unit}
            </p>

            {!open.unlocked && (
              <span className="mt-3 block h-2 rounded-full bg-white/[0.05] overflow-hidden">
                <span
                  className="block h-full rounded-full origin-left"
                  style={{
                    background: TIER_COLORS[open.achievement.tier],
                    transform: `scaleX(${Math.max(0.02, open.ratio)})`,
                  }}
                />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Achievements;
