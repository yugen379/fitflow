/**
 * Proactive nudge engine.
 *
 * Nudges are *derived*, not scripted: each one is a rule over the day's real
 * state — steps against goal, calories and protein against target, recovery,
 * time of day — and a rule that does not fire produces nothing. That is the
 * difference between a coach and a spammer, and it is why the copy quotes exact
 * numbers ("1,760 steps left") rather than generic encouragement.
 *
 * Ordering is by urgency, and only the top few ever surface. A drawer of twelve
 * equally-shouty cards is the same as no drawer.
 *
 * Every nudge carries exactly one action that routes straight into the thing it
 * is about — never into a menu.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Bell, Droplets, Footprints, Salad, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../lib/utils';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';
import { spawnRipple } from './WaterRipple';
import type { RippleTone } from './WaterRipple';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface NudgeContext {
  name?: string;
  hour: number;
  steps: number;
  stepGoal: number;
  caloriesConsumed: number;
  calorieTarget: number;
  proteinG: number;
  proteinTargetG: number;
  /** 0–100, or null when there is no signal. */
  recovery: number | null;
  workoutsToday: number;
  /** Minutes since the app last saw movement, when known. */
  sedentaryMinutes?: number | null;
}

export interface Nudge {
  id: string;
  icon: LucideIcon;
  tone: RippleTone;
  title: string;
  body: string;
  action: { label: string; route: string };
  /** Higher surfaces first. */
  urgency: number;
}

const TONE_HEX: Record<RippleTone, string> = {
  lime: '#CCFF00',
  aqua: '#00F5FF',
  coral: '#FF3366',
  amber: '#FFB800',
};

/**
 * Derive today's nudges. Pure — same context in, same nudges out.
 *
 * Exported so it can be unit-tested without a browser.
 */
export const buildNudges = (context: NudgeContext): Nudge[] => {
  const out: Nudge[] = [];
  const {
    name,
    hour,
    steps,
    stepGoal,
    caloriesConsumed,
    calorieTarget,
    proteinG,
    proteinTargetG,
    recovery,
    workoutsToday,
    sedentaryMinutes,
  } = context;

  const who = name ? `, ${name}` : '';

  // ── Steps ────────────────────────────────────────────────────────────────
  const stepsLeft = Math.max(0, Math.round(stepGoal - steps));
  if (stepsLeft > 0 && steps > 0) {
    // Urgency climbs through the evening: the same gap matters more at 8pm.
    const closing = hour >= 17;
    const nearlyThere = stepsLeft <= stepGoal * 0.25;
    if (closing || nearlyThere) {
      out.push({
        id: 'steps-close',
        icon: Footprints,
        tone: 'lime',
        title: nearlyThere ? `Almost there${who}` : `Still time${who}`,
        body: `${stepsLeft.toLocaleString()} steps left to hit your ${stepGoal.toLocaleString()} goal${
          closing ? ' before the day is out' : ''
        }.`,
        action: { label: 'Start evening walk', route: '/steps' },
        urgency: closing && nearlyThere ? 95 : closing ? 80 : 60,
      });
    }
  }

  // ── Nutrition ────────────────────────────────────────────────────────────
  const calorieGap = Math.round(calorieTarget - caloriesConsumed);
  const proteinGap = Math.round(proteinTargetG - proteinG);
  if (hour >= 11 && calorieGap > 200 && proteinGap > 15) {
    out.push({
      id: 'fuel-gap',
      icon: Salad,
      tone: 'aqua',
      title: 'Fuel alert',
      body: `You are ${calorieGap.toLocaleString()} kcal under target with ${proteinGap}g protein remaining.`,
      action: { label: 'Quick log meal', route: '/track' },
      urgency: hour >= 19 ? 88 : 70,
    });
  } else if (calorieGap < -150) {
    out.push({
      id: 'fuel-over',
      icon: Salad,
      tone: 'coral',
      title: 'Over target',
      body: `${Math.abs(calorieGap).toLocaleString()} kcal above your goal today. Worth a lighter dinner.`,
      action: { label: 'Review intake', route: '/track' },
      urgency: 55,
    });
  }

  // ── Readiness ────────────────────────────────────────────────────────────
  if (recovery !== null && workoutsToday === 0 && hour >= 6 && hour <= 20) {
    if (recovery >= 65) {
      out.push({
        id: 'ready',
        icon: Zap,
        tone: 'lime',
        title: `Recovery is optimal (${Math.round(recovery)}%)`,
        body: 'Your body is ready for a hard session today.',
        action: { label: 'Open workout HUD', route: '/workout' },
        urgency: 75,
      });
    } else if (recovery < 45) {
      out.push({
        id: 'recover',
        icon: Zap,
        tone: 'coral',
        title: `Recovery is low (${Math.round(recovery)}%)`,
        body: 'Keep intensity capped today — mobility or an easy walk will serve you better.',
        action: { label: 'See recovery', route: '/wellness' },
        urgency: 72,
      });
    }
  }

  // ── Mobility ─────────────────────────────────────────────────────────────
  if (sedentaryMinutes != null && sedentaryMinutes >= 90 && hour >= 8 && hour <= 21) {
    out.push({
      id: 'mobility',
      icon: Droplets,
      tone: 'amber',
      title: 'Posture check',
      body: `${Math.round(sedentaryMinutes)} minutes without moving. Take a five-minute stretch break.`,
      action: { label: 'Start mobility', route: '/wellness' },
      urgency: 50,
    });
  }

  return out.sort((left, right) => right.urgency - left.urgency);
};

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const NudgeCard: React.FC<{ nudge: Nudge; onAct: () => void; onDismiss: () => void }> = ({
  nudge,
  onAct,
  onDismiss,
}) => {
  const color = TONE_HEX[nudge.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={SPRING.fluid}
      className="glass-spatial p-4 relative overflow-hidden isolate"
      style={{ borderColor: `${color}33` }}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: color, boxShadow: `0 0 16px ${color}` }}
      />
      <div className="flex items-start gap-3">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}1a`, border: `1px solid ${color}44` }}
        >
          <nudge.icon size={16} style={{ color }} aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">{nudge.title}</p>
          <p className="text-[13px] text-text-dim mt-1 leading-relaxed">{nudge.body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="w-9 h-9 -mr-1 -mt-1 rounded-lg flex items-center justify-center text-text-mute active:scale-95 transition-transform shrink-0"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onPointerDown={(event) => spawnRipple(event.currentTarget, event.clientX, event.clientY, nudge.tone)}
        onClick={onAct}
        className="mt-3 w-full h-11 rounded-xl text-xs font-bold relative overflow-hidden isolate active:scale-[0.98] transition-transform"
        style={{ background: `${color}1a`, border: `1px solid ${color}55`, color }}
      >
        {nudge.action.label}
      </button>
    </motion.div>
  );
};

export interface HistoryItem {
  id: string;
  title?: string;
  body?: string;
  timestamp?: { toDate?: () => Date } | null;
}

/**
 * `history` is the existing Firestore notification inbox. It lives in the same
 * drawer as the derived nudges rather than behind a second bell: two bells is
 * worse than either, and past push messages are still worth keeping.
 */
export const NotificationCenter: React.FC<{
  context: NudgeContext;
  history?: HistoryItem[];
  className?: string;
}> = ({ context, history = [], className }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Dismissals last the session only — a nudge that is still true tomorrow
  // should say so again.
  const nudges = useMemo(
    () => buildNudges(context).filter((n) => !dismissed.includes(n.id)),
    [context, dismissed],
  );

  // Announce the highest-urgency nudge once, politely.
  const [announced, setAnnounced] = useState<string | null>(null);
  useEffect(() => {
    if (nudges.length > 0 && nudges[0].id !== announced) setAnnounced(nudges[0].id);
  }, [nudges, announced]);

  const act = (nudge: Nudge) => {
    void haptic('medium');
    setOpen(false);
    navigate(nudge.action.route);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void haptic('light');
          setOpen(true);
        }}
        aria-label={
          nudges.length > 0 ? `Notifications, ${nudges.length} need attention` : 'Notifications'
        }
        className={cn(
          'relative w-11 h-11 flex items-center justify-center glass-spatial text-white',
          className,
        )}
        style={{ borderRadius: '1rem' }}
      >
        <Bell size={18} aria-hidden="true" />
        {(nudges.length > 0 || history.length > 0) && (
          <span
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full breathing-glow"
            style={{ background: nudges.length > 0 ? '#CCFF00' : '#8B95A8' }}
            aria-hidden="true"
          />
        )}
      </button>

      <p className="sr-only" aria-live="polite">
        {nudges.length > 0 ? `${nudges[0].title}. ${nudges[0].body}` : ''}
      </p>

      <AnimatePresence>
        {open && (
          <motion.div
            key="drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[100] bg-[#04060A]/88 backdrop-blur-xl"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={SPRING.weighty}
              className="absolute inset-y-0 right-0 w-full max-w-md px-5 py-10 overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-eyebrow text-accent">Proactive</p>
                  <h2 className="font-display text-3xl font-bold text-white tracking-tight">Nudges</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="w-11 h-11 glass-spatial flex items-center justify-center text-white active:scale-95 transition-transform"
                  style={{ borderRadius: '1rem' }}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {nudges.map((nudge) => (
                    <NudgeCard
                      key={nudge.id}
                      nudge={nudge}
                      onAct={() => act(nudge)}
                      onDismiss={() => {
                        void haptic('light');
                        setDismissed((prev) => [...prev, nudge.id]);
                      }}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {nudges.length === 0 && (
                <div className="text-center py-14 flex flex-col items-center gap-3">
                  <Bell size={34} className="text-text-mute" aria-hidden="true" />
                  <p className="text-sm text-text-dim">Nothing needs your attention.</p>
                  <p className="text-[11px] text-text-mute max-w-[15rem] leading-relaxed">
                    Nudges appear when your steps, fuel or recovery actually call for one.
                  </p>
                </div>
              )}

              {history.length > 0 && (
                <section className="mt-8">
                  <p className="text-eyebrow text-text-mute mb-3">Earlier</p>
                  <ul className="space-y-2">
                    {history.map((item) => (
                      <li key={item.id} className="glass-spatial p-4 relative overflow-hidden">
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="font-semibold text-white text-sm">{item.title ?? 'Notification'}</h4>
                          <span className="text-[10px] text-text-mute font-medium whitespace-nowrap">
                            {item.timestamp?.toDate
                              ? item.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : 'Now'}
                          </span>
                        </div>
                        {item.body ? (
                          <p className="text-white/70 text-sm leading-relaxed mt-1">{item.body}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default NotificationCenter;
