import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Lock, Crown, Check, CalendarDays } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { isProUnlocked } from '../lib/billing';
import { baseCaloriesFor, defaultSplitFor, computeDailyTargets } from '../lib/nutritionTargets';
import type { MacroTargets, DayTargets } from '../types';
import { cn } from '../lib/utils';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const numOr = (v: string, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const NutritionGoals: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isPro = isProUnlocked(profile);
  const goal = profile?.goal;
  const baseCals = baseCaloriesFor(goal);

  // --- Macro split state ---
  const initialMt: MacroTargets = profile?.macroTargets ?? { mode: 'percent', ...defaultSplitFor(goal) };
  const [mode, setMode] = useState<'percent' | 'grams'>(initialMt.mode === 'grams' && isPro ? 'grams' : 'percent');
  const split = defaultSplitFor(goal);
  const [proteinPct, setProteinPct] = useState(initialMt.proteinPct ?? split.proteinPct);
  const [carbsPct, setCarbsPct] = useState(initialMt.carbsPct ?? split.carbsPct);
  const [fatsPct, setFatsPct] = useState(initialMt.fatsPct ?? split.fatsPct);

  const defGrams = computeDailyTargets({ goal });
  const [proteinG, setProteinG] = useState(initialMt.proteinG ?? defGrams.proteinG);
  const [carbsG, setCarbsG] = useState(initialMt.carbsG ?? defGrams.carbsG);
  const [fatsG, setFatsG] = useState(initialMt.fatsG ?? defGrams.fatsG);

  // --- Day scheduling state ---
  const initialDt: DayTargets = profile?.dayTargets ?? {
    enabled: false,
    workout: { calories: baseCals + 300, carbsG: defGrams.carbsG + 75 },
    rest: { calories: baseCals - 200, carbsG: Math.max(0, defGrams.carbsG - 60) },
    schedule: {},
  };
  const [dayEnabled, setDayEnabled] = useState(!!initialDt.enabled && isPro);
  const [workoutCals, setWorkoutCals] = useState(initialDt.workout?.calories ?? baseCals + 300);
  const [workoutCarbs, setWorkoutCarbs] = useState(initialDt.workout?.carbsG ?? defGrams.carbsG + 75);
  const [restCals, setRestCals] = useState(initialDt.rest?.calories ?? baseCals - 200);
  const [restCarbs, setRestCarbs] = useState(initialDt.rest?.carbsG ?? Math.max(0, defGrams.carbsG - 60));
  const [schedule, setSchedule] = useState<Record<string, 'workout' | 'rest'>>(initialDt.schedule ?? {});

  const pctSum = proteinPct + carbsPct + fatsPct;
  const pctValid = pctSum === 100;

  const previewGrams = useMemo(() => {
    if (mode === 'grams') {
      const cals = proteinG * 4 + carbsG * 4 + fatsG * 9;
      return { protein: proteinG, carbs: carbsG, fats: fatsG, calories: cals };
    }
    const sum = pctSum || 100;
    return {
      protein: Math.round((baseCals * (proteinPct / sum)) / 4),
      carbs: Math.round((baseCals * (carbsPct / sum)) / 4),
      fats: Math.round((baseCals * (fatsPct / sum)) / 9),
      calories: baseCals,
    };
  }, [mode, proteinG, carbsG, fatsG, proteinPct, carbsPct, fatsPct, pctSum, baseCals]);

  const cycleDay = (idx: number) => {
    if (!dayEnabled) return;
    const key = String(idx);
    setSchedule(prev => {
      const cur = prev[key];
      const next = { ...prev };
      if (cur === undefined) next[key] = 'workout';
      else if (cur === 'workout') next[key] = 'rest';
      else delete next[key];
      return next;
    });
  };

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!profile?.uid) return;
    if (mode === 'percent' && !pctValid) {
      showToast('Macro percentages must add up to 100%.', 'error');
      return;
    }
    const macroTargets: MacroTargets = mode === 'grams'
      ? { mode: 'grams', proteinG, carbsG, fatsG }
      : { mode: 'percent', proteinPct, carbsPct, fatsPct };

    const dayTargets: DayTargets = {
      enabled: dayEnabled,
      workout: { calories: workoutCals, carbsG: workoutCarbs },
      rest: { calories: restCals, carbsG: restCarbs },
      schedule,
    };

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), { macroTargets, dayTargets });
      showToast('Nutrition targets saved', 'success');
      navigate(-1);
    } catch {
      showToast('Could not save targets. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const ProLock: React.FC<{ label: string }> = ({ label }) => (
    <button
      onClick={() => navigate('/pro')}
      className="flex items-center gap-1.5 text-eyebrow text-accent bg-accent/10 border border-accent/25 px-2.5 py-1 rounded-full"
    >
      <Lock size={11} /> {label}
    </button>
  );

  return (
    <div className="pb-28 pt-4 px-4 min-h-screen space-y-5">
      <header className="flex items-center gap-3 pt-2">
        <button onClick={() => navigate(-1)} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <div>
          <p className="text-eyebrow text-accent">Nutrition</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">Macro targets</h1>
        </div>
      </header>

      {/* Live preview */}
      <div className="glass p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-eyebrow text-text-dim">Your daily target</p>
          <p className="num text-accent font-display text-xl font-bold">{previewGrams.calories.toLocaleString()} kcal</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([['Protein', previewGrams.protein], ['Carbs', previewGrams.carbs], ['Fats', previewGrams.fats]] as const).map(([label, g]) => (
            <div key={label} className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.05]">
              <p className="num text-white font-display text-lg font-bold">{g}g</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Macro split */}
      <div className="space-y-2">
        <h3 className="text-eyebrow text-text-dim px-1">Macro split</h3>
        <div className="glass p-4 space-y-4">
          <div className="flex bg-surface rounded-xl p-1 border border-white/[0.06]">
            <button
              onClick={() => setMode('percent')}
              className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all', mode === 'percent' ? 'bg-accent text-bg' : 'text-text-dim')}
            >
              By percentage
            </button>
            <button
              onClick={() => { if (isPro) setMode('grams'); else navigate('/pro'); }}
              className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5', mode === 'grams' ? 'bg-accent text-bg' : 'text-text-dim')}
            >
              {!isPro && <Lock size={11} />} Exact grams
            </button>
          </div>

          {mode === 'percent' ? (
            <>
              {([['Protein', proteinPct, setProteinPct], ['Carbs', carbsPct, setCarbsPct], ['Fats', fatsPct, setFatsPct]] as const).map(([label, val, set]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm text-white w-16">{label}</span>
                  <input
                    type="number" inputMode="numeric" min={0} max={100} value={val}
                    onChange={e => set(Math.max(0, Math.min(100, numOr(e.target.value))))}
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white num text-right"
                  />
                  <span className="text-text-dim text-sm w-6">%</span>
                </div>
              ))}
              <p className={cn('text-xs text-center', pctValid ? 'text-text-dim' : 'text-accent-2')}>
                {pctValid ? 'Adds up to 100% ✓' : `Currently ${pctSum}% — must total 100%`}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-white">Lock exact grams</p>
                <span className="flex items-center gap-1 text-eyebrow text-accent"><Crown size={12} /> Pro</span>
              </div>
              {([['Protein', proteinG, setProteinG], ['Carbs', carbsG, setCarbsG], ['Fats', fatsG, setFatsG]] as const).map(([label, val, set]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm text-white w-16">{label}</span>
                  <input
                    type="number" inputMode="numeric" min={0} value={val}
                    onChange={e => set(Math.max(0, numOr(e.target.value)))}
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white num text-right"
                  />
                  <span className="text-text-dim text-sm w-6">g</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Goal-by-day scheduling */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-eyebrow text-text-dim">Goal-by-day scheduling</h3>
          {!isPro && <ProLock label="Pro" />}
        </div>
        <div className="glass p-4 space-y-4">
          <button
            onClick={() => { if (isPro) setDayEnabled(v => !v); else navigate('/pro'); }}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-lg bg-white/[0.04] text-white/80 flex items-center justify-center">
                <CalendarDays size={16} />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Carb-cycle by day type</p>
                <p className="text-xs text-text-dim">Higher carbs on training days, lower on rest days</p>
              </div>
            </div>
            <div className={cn('w-11 h-6 rounded-full p-0.5 transition-colors shrink-0', dayEnabled ? 'bg-accent' : 'bg-white/[0.1]')}>
              <div className={cn('w-5 h-5 rounded-full bg-white shadow-sm transition-transform', dayEnabled ? 'translate-x-5' : 'translate-x-0')} />
            </div>
          </button>

          {dayEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.05] space-y-2">
                  <p className="text-xs font-semibold text-accent">Workout day</p>
                  <label className="block text-[11px] text-text-dim">Calories
                    <input type="number" inputMode="numeric" value={workoutCals} onChange={e => setWorkoutCals(numOr(e.target.value))}
                      className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-white num" />
                  </label>
                  <label className="block text-[11px] text-text-dim">Carbs (g)
                    <input type="number" inputMode="numeric" value={workoutCarbs} onChange={e => setWorkoutCarbs(numOr(e.target.value))}
                      className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-white num" />
                  </label>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.05] space-y-2">
                  <p className="text-xs font-semibold text-text-dim">Rest day</p>
                  <label className="block text-[11px] text-text-dim">Calories
                    <input type="number" inputMode="numeric" value={restCals} onChange={e => setRestCals(numOr(e.target.value))}
                      className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-white num" />
                  </label>
                  <label className="block text-[11px] text-text-dim">Carbs (g)
                    <input type="number" inputMode="numeric" value={restCarbs} onChange={e => setRestCarbs(numOr(e.target.value))}
                      className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-white num" />
                  </label>
                </div>
              </div>

              <div>
                <p className="text-[11px] text-text-dim mb-2">Tap a day to cycle: base → workout → rest</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d, i) => {
                    const t = schedule[String(i)];
                    return (
                      <button
                        key={d}
                        onClick={() => cycleDay(i)}
                        className={cn(
                          'py-2 rounded-lg text-[11px] font-semibold border transition-all',
                          t === 'workout' ? 'bg-accent text-bg border-accent'
                            : t === 'rest' ? 'bg-white/[0.06] text-text-dim border-white/[0.1]'
                              : 'bg-transparent text-text-mute border-white/[0.05]',
                        )}
                      >
                        {d[0]}
                        <span className="block text-[8px] font-normal mt-0.5">
                          {t === 'workout' ? 'GYM' : t === 'rest' ? 'REST' : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn-3d w-full h-13 disabled:opacity-60">
        <Check size={16} /> {saving ? 'Saving…' : 'Save targets'}
      </button>
    </div>
  );
};
