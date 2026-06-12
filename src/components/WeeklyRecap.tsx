import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, ArrowRight, Volume2, TrendingUp, Trophy } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { db } from '../lib/firebase';
import {
  collection, query, where, getDocs, orderBy, doc, setDoc, getDoc,
} from 'firebase/firestore';
import { generateWeeklyRecap, WeeklyRecap as WeeklyRecapData } from '../services/geminiService';
import { LogoMark } from './Logo';

const STORAGE_KEY = (uid: string, weekId: string) => `ff_weekly_recap_${uid}_${weekId}`;

const isoWeek = (d: Date) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const thursdayOfWeek = date.getTime();
  // ISO week-year is the year of the Thursday in that week, not the input date.
  const weekYear = date.getUTCFullYear();
  date.setUTCMonth(0, 1);
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.round((thursdayOfWeek - date.getTime()) / 604800000);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
};

interface WeeklyRecapProps {
  /** Imperatively open the recap from a parent button. */
  manualOpen?: boolean;
  onManualClose?: () => void;
}

export const WeeklyRecap: React.FC<WeeklyRecapProps> = ({ manualOpen, onManualClose }) => {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WeeklyRecapData | null>(null);
  const [stats, setStats] = useState<{ workouts: number; minutes: number; calories: number; topExercise?: string } | null>(null);

  useEffect(() => {
    if (!profile?.uid) return;
    const today = new Date();
    // Sun=0, Mon=1, Tue=2 — give weekend-offline users a two-day grace window.
    const day = today.getDay();
    const inWindow = day === 0 || day === 1 || day === 2;
    if (!inWindow) return;
    const week = isoWeek(today);
    const shownKey = STORAGE_KEY(profile.uid, week);
    if (localStorage.getItem(shownKey)) return;
    setOpen(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // Allow a parent to open the recap on demand (e.g. "View weekly summary" button).
  useEffect(() => {
    if (manualOpen && !open) {
      setOpen(true);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualOpen]);

  const load = async () => {
    if (!profile?.uid) return;
    setLoading(true);
    try {
      const today = new Date();
      const weekId = isoWeek(today);

      // Try cached recap from Firestore first
      const cached = await getDoc(doc(db, 'weekly_recaps', `${profile.uid}_${weekId}`));
      if (cached.exists()) {
        const d = cached.data();
        setData(d.recap);
        setStats(d.stats);
        setLoading(false);
        return;
      }

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [workoutsSnap, mealsSnap, waterSnap, sleepSnap] = await Promise.all([
        getDocs(query(collection(db, 'workouts'), where('userId', '==', profile.uid), where('timestamp', '>=', weekAgo), orderBy('timestamp', 'desc'))),
        getDocs(query(collection(db, 'meals'), where('userId', '==', profile.uid), where('timestamp', '>=', weekAgo))),
        getDocs(query(collection(db, 'water_logs'), where('userId', '==', profile.uid), where('timestamp', '>=', weekAgo))),
        getDocs(query(collection(db, 'sleep_logs'), where('userId', '==', profile.uid), where('timestamp', '>=', weekAgo))),
      ]);

      const workouts = workoutsSnap.size;
      const workoutMinutes = workoutsSnap.docs.reduce((a, d) => a + (d.data().duration || 0), 0);
      const caloriesBurned = workoutsSnap.docs.reduce((a, d) => a + (d.data().caloriesBurned || 0), 0);
      const caloriesConsumed = mealsSnap.docs.reduce((a, d) => a + (d.data().calories || 0), 0);
      const waterMl = waterSnap.docs.reduce((a, d) => a + (d.data().amount || 0), 0);
      const sleepHoursTotal = sleepSnap.docs.reduce((a, d) => a + (d.data().hours || 0), 0);
      const sleepHoursAvg = sleepSnap.size ? Math.round((sleepHoursTotal / sleepSnap.size) * 10) / 10 : 0;

      const exerciseCount: Record<string, number> = {};
      workoutsSnap.forEach(d => {
        const t = d.data().type;
        if (t) exerciseCount[t] = (exerciseCount[t] || 0) + 1;
      });
      const topExercise = Object.entries(exerciseCount).sort((a, b) => b[1] - a[1])[0]?.[0];

      const computedStats = { workouts, minutes: workoutMinutes, calories: caloriesBurned, topExercise };
      setStats(computedStats);

      const recap = await generateWeeklyRecap({
        workouts,
        workoutMinutes,
        caloriesBurned,
        caloriesConsumed,
        waterMl,
        sleepHours: sleepHoursAvg,
        streak: profile.streak || 0,
        goal: profile.goal,
        topExercise,
      });
      setData(recap);

      try {
        await setDoc(doc(db, 'weekly_recaps', `${profile.uid}_${weekId}`), {
          recap, stats: computedStats, generatedAt: new Date().toISOString(),
        });
      } catch { /* permission-denied is fine */ }
    } catch {
      // leave empty — the fallback in geminiService will provide a generic recap
    } finally {
      setLoading(false);
    }
  };

  const dismiss = () => {
    if (profile?.uid) {
      const week = isoWeek(new Date());
      localStorage.setItem(STORAGE_KEY(profile.uid, week), '1');
    }
    setOpen(false);
    if (manualOpen && onManualClose) onManualClose();
  };

  const speak = () => {
    if (!data || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const text = `${data.headline}. ${data.highlight} Your win: ${data.win}. Focus next week: ${data.focus}. Try this Monday: ${data.nextStep}.`;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={dismiss}
          />
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative bg-surface border border-white/[0.06] w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <LogoMark size={28} />
                <div>
                  <p className="text-eyebrow text-accent">Week in review</p>
                  <p className="text-xs text-text-dim mt-0.5">Powered by Gemini</p>
                </div>
              </div>
              <button onClick={dismiss} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim hover:text-white" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {loading ? (
              <div className="space-y-3">
                <div className="h-7 rounded bg-white/[0.06] shimmer w-3/4" />
                <div className="h-4 rounded bg-white/[0.06] shimmer" />
                <div className="h-4 rounded bg-white/[0.06] shimmer w-5/6" />
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className="h-16 rounded-xl bg-white/[0.06] shimmer" />
                  <div className="h-16 rounded-xl bg-white/[0.06] shimmer" />
                  <div className="h-16 rounded-xl bg-white/[0.06] shimmer" />
                </div>
              </div>
            ) : data && stats ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h2 className="font-display text-3xl font-bold text-white tracking-tight leading-tight">{data.headline}</h2>
                  <p className="text-white/80 text-sm leading-relaxed">{data.highlight}</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Sessions" value={stats.workouts} />
                  <Stat label="Minutes" value={stats.minutes} />
                  <Stat label="Calories" value={stats.calories} />
                </div>

                <div className="ai-gradient-box p-4 rounded-2xl space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                      <Trophy size={14} className="text-accent" />
                    </div>
                    <div>
                      <p className="text-eyebrow text-accent">Your win</p>
                      <p className="text-sm text-white mt-0.5">{data.win}</p>
                    </div>
                  </div>
                </div>

                <div className="glass p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent-3/15 flex items-center justify-center shrink-0">
                      <TrendingUp size={14} className="text-accent-3" />
                    </div>
                    <div>
                      <p className="text-eyebrow text-accent-3">Focus next</p>
                      <p className="text-sm text-white mt-0.5">{data.focus}</p>
                    </div>
                  </div>
                  <div className="border-t border-white/[0.06] pt-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                      <Sparkles size={14} className="text-accent" />
                    </div>
                    <div>
                      <p className="text-eyebrow text-accent">Monday action</p>
                      <p className="text-sm text-white mt-0.5">{data.nextStep}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={speak} className="btn-ghost h-12 px-4">
                    <Volume2 size={14} /> Listen
                  </button>
                  <button onClick={dismiss} className="btn-3d h-12 flex-1">
                    Let's go <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-text-dim text-sm">No data yet for this week. Log a workout to start your recap.</p>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="glass p-3 text-center">
    <p className="num font-display text-xl font-bold text-white">{value}</p>
    <p className="text-xs text-text-dim mt-0.5">{label}</p>
  </div>
);
