import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Volume2, ChevronRight } from 'lucide-react';
import { getCoachBriefing, type CoachContext, type CoachBriefing } from '../services/geminiService';
import { pushTopNudge } from '../services/notificationService';
import { haptic } from '../lib/haptics';

interface Props {
  uid?: string;
  ctx: CoachContext;
  online?: boolean;
  onWater?: () => void;
}

// Proactive coach briefing — the home screen's "coach reaches out" surface.
// Renders the deterministic engine's prioritised nudges (AI-polished when online)
// with one-tap actions. Degrades gracefully: a stale briefing stays on screen
// while a new one loads, and it never blocks on the network.
export const CoachBriefingCard: React.FC<Props> = ({ uid, ctx, online = true, onWater }) => {
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState<CoachBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const pushedRef = useRef(false);

  // Re-fetch when the meaningful parts of the context change. We stringify a
  // stable subset so we don't refire on every render.
  const ctxKey = JSON.stringify([
    ctx.hour, ctx.goal, ctx.weightKg, ctx.caloriesConsumed, ctx.proteinConsumed,
    ctx.waterMl, ctx.trainedToday, ctx.mealsLogged, ctx.sleepHours, ctx.streak,
    ctx.preferredWorkoutHour, ctx.daysSinceLastWorkout, online,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCoachBriefing(ctx)
      .then(b => {
        if (cancelled) return;
        setBriefing(b);
        // Mirror the top nudge into the notification feed once per day.
        if (uid && b.nudges[0] && !pushedRef.current) {
          pushedRef.current = true;
          pushTopNudge(uid, b.nudges[0]);
        }
      })
      .catch(() => { /* getCoachBriefing never throws, but be defensive */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  const runAction = (n: CoachBriefing['nudges'][number]) => {
    haptic('light');
    if (n.action.kind === 'water' && onWater) { onWater(); return; }
    navigate(n.action.route);
  };

  const speak = () => {
    if (!briefing || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const text = `${briefing.headline}. ${briefing.nudges.map(n => n.message).join(' ')}`;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="glass p-5 flex flex-col gap-4 relative overflow-hidden border-accent/20"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.06] to-transparent pointer-events-none" />
      <div className="absolute -top-10 -right-10 w-28 h-28 bg-accent/10 blur-3xl rounded-full pointer-events-none" />

      <div className="flex items-center gap-2 z-10">
        <div className="w-7 h-7 bg-accent/15 rounded-lg flex items-center justify-center">
          <Sparkles size={14} className="text-accent" />
        </div>
        <span className="text-eyebrow text-accent flex-1">Your coach</span>
        {briefing && (
          <button
            onClick={speak}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-accent transition-colors"
            aria-label="Read briefing aloud"
            title="Listen"
          >
            <Volume2 size={13} />
          </button>
        )}
      </div>

      {loading && !briefing ? (
        <div className="space-y-3 z-10">
          <div className="h-6 w-2/3 rounded bg-white/[0.06] shimmer" />
          <div className="h-3 rounded bg-white/[0.06] shimmer" />
          <div className="h-3 w-4/5 rounded bg-white/[0.06] shimmer" />
        </div>
      ) : briefing ? (
        <div className="z-10 space-y-4">
          <div>
            <h4 className="font-display text-2xl font-bold text-white leading-tight tracking-tight">
              {briefing.headline}
            </h4>
            <p className="text-text-dim text-xs mt-1">{briefing.subtitle}</p>
          </div>

          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {briefing.nudges.map((n, i) => (
                <motion.button
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.06 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => runAction(n)}
                  className="w-full text-left flex items-center gap-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] p-3.5 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center text-lg shrink-0">
                    {n.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm leading-snug">{n.title}</p>
                    <p className="text-white/65 text-xs leading-relaxed mt-0.5">{n.message}</p>
                    <span className="inline-flex items-center gap-1 text-accent text-xs font-semibold mt-2">
                      {n.action.label}
                      <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
};
