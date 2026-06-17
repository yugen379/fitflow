import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Flame, CalendarCheck, TrendingUp, Snowflake } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getRetentionStats } from '../services/analyticsService';
import { getFreezeStatus, spendStreakFreeze } from '../services/streakFreezeService';
import type { RetentionStats } from '../services/retentionUtils';

// Consistency / retention surface (#4). Shows current & longest streak, rolling
// active-day counts, and the D1/D7/D30 return milestones. Read-only; degrades to a
// loading shimmer and never blocks the page.
export const RetentionCard: React.FC = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState<RetentionStats | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!profile?.uid) return;
    const signup = (profile as any)?.createdAt?.toDate?.() ?? null;
    getRetentionStats(profile.uid, signup)
      .then(setStats)
      .catch(() => { /* getRetentionStats never throws */ });
  }, [profile?.uid]);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.uid) return;
    const signup = (profile as any)?.createdAt?.toDate?.() ?? null;
    getRetentionStats(profile.uid, signup)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { /* getRetentionStats never throws */ });
    return () => { cancelled = true; };
  }, [profile?.uid]);

  const freeze = getFreezeStatus(profile);
  const handleFreeze = async () => {
    if (!profile?.uid || freezing) return;
    setFreezing(true);
    setFreezeMsg(null);
    const res = await spendStreakFreeze(profile.uid, profile);
    setFreezing(false);
    if (res.ok) { setFreezeMsg('Streak protected ❄️'); refresh(); }
    else if (res.reason === 'no-allowance') setFreezeMsg('No freezes left this month — go Pro for unlimited.');
    else setFreezeMsg('Could not protect — try again.');
  };

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

          {/* Streak freeze (#5) — repair a missed day so a hard-won streak survives. */}
          <div className="pt-1">
            <button
              onClick={handleFreeze}
              disabled={freezing || (!freeze.isPro && freeze.remaining <= 0)}
              className="w-full h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center gap-2 text-sm font-medium text-text-dim hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Snowflake size={15} className="text-accent-3" />
              {freezing ? 'Protecting…' : 'Protect a missed day'}
              <span className="text-[10px] text-text-mute ml-1">
                {freeze.isPro ? 'Unlimited' : `${freeze.remaining} left`}
              </span>
            </button>
            {freezeMsg && <p className="text-[11px] text-text-dim text-center mt-2">{freezeMsg}</p>}
          </div>
        </>
      )}
    </motion.div>
  );
};
