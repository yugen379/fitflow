import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Flame, CalendarCheck, TrendingUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getRetentionStats } from '../services/analyticsService';
import type { RetentionStats } from '../services/retentionUtils';

// Consistency / retention surface (#4). Shows current & longest streak, rolling
// active-day counts, and the D1/D7/D30 return milestones. Read-only; degrades to a
// loading shimmer and never blocks the page.
export const RetentionCard: React.FC = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState<RetentionStats | null>(null);

  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    const signup = (profile as any)?.createdAt?.toDate?.() ?? null;
    getRetentionStats(profile.uid, signup)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { /* getRetentionStats never throws */ });
    return () => { cancelled = true; };
  }, [profile?.uid]);

  const Milestone: React.FC<{ label: string; hit: boolean; elapsed: boolean }> = ({ label, hit, elapsed }) => (
    <div className={`flex-1 rounded-xl py-2.5 text-center border ${hit ? 'bg-accent/12 border-accent/30' : 'bg-white/[0.03] border-white/[0.06]'}`}>
      <p className={`num font-display text-sm font-bold ${hit ? 'text-accent' : 'text-text-dim'}`}>{label}</p>
      <p className="text-[9px] uppercase tracking-wider mt-0.5 text-text-dim">{hit ? 'retained' : elapsed ? 'missed' : 'pending'}</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-accent/15 rounded-lg flex items-center justify-center">
          <CalendarCheck size={12} className="text-accent" />
        </div>
        <span className="text-eyebrow text-accent flex-1">Consistency</span>
      </div>

      {!stats ? (
        <div className="space-y-2">
          <div className="h-16 rounded-xl bg-white/[0.05] shimmer" />
          <div className="h-10 rounded-xl bg-white/[0.05] shimmer" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-3.5 flex items-center gap-3">
              <Flame size={20} className="text-accent shrink-0" />
              <div>
                <p className="num font-display text-2xl font-bold text-white leading-none">{stats.currentStreak}</p>
                <p className="text-[10px] text-text-dim mt-1">day streak</p>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-3.5 flex items-center gap-3">
              <TrendingUp size={20} className="text-accent-3 shrink-0" />
              <div>
                <p className="num font-display text-2xl font-bold text-white leading-none">{stats.longestStreak}</p>
                <p className="text-[10px] text-text-dim mt-1">longest streak</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 text-center">
            <div className="flex-1">
              <p className="num font-display text-lg font-bold text-white">{stats.activeLast7}<span className="text-text-dim text-sm">/7</span></p>
              <p className="text-[10px] text-text-dim">last 7 days</p>
            </div>
            <div className="w-px bg-white/[0.06]" />
            <div className="flex-1">
              <p className="num font-display text-lg font-bold text-white">{stats.activeLast30}<span className="text-text-dim text-sm">/30</span></p>
              <p className="text-[10px] text-text-dim">last 30 days</p>
            </div>
            <div className="w-px bg-white/[0.06]" />
            <div className="flex-1">
              <p className="num font-display text-lg font-bold text-white">{stats.totalActiveDays}</p>
              <p className="text-[10px] text-text-dim">active total</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-text-dim mb-2">Return milestones</p>
            <div className="flex gap-2">
              <Milestone label="D1" hit={stats.d1} elapsed={stats.daysSinceSignup >= 1} />
              <Milestone label="D7" hit={stats.d7} elapsed={stats.daysSinceSignup >= 7} />
              <Milestone label="D30" hit={stats.d30} elapsed={stats.daysSinceSignup >= 30} />
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
};
