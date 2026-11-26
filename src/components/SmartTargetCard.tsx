import React, { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus, Sparkles, Loader2 } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { getMealCaloriesSince, getWeightHistory } from '../services/dataService';
import { computeDailyTargets } from '../lib/nutritionTargets';
import { adaptiveTarget, adaptiveMessage, dailyIntake, localDate, WINDOW_DAYS, type AdaptiveResult } from '../lib/adaptiveTarget';
import { useUnits } from '../hooks/useUnits';
import { t } from '../i18n/i18n';

/**
 * "Smart target": the user's real daily burn worked out from their weigh-ins
 * and logged meals (lib/adaptiveTarget.ts), and a one-tap change to the daily
 * calorie target when the evidence says the current one is off.
 *
 * Nothing changes without the tap. The target is written the same way the meal
 * plan writes it (macroTargets.calorieTarget), so every screen agrees.
 */
// One computation per user + target per 10 minutes: the card sits on Track,
// which opens often, and the answer only changes with new days of data.
const cache = new Map<string, { at: number; result: AdaptiveResult }>();
const CACHE_MS = 10 * 60_000;

export const SmartTargetCard: React.FC<{ compact?: boolean; onApplied?: (kcal: number) => void }> = ({ compact, onApplied }) => {
  const { profile } = useAuth();
  const units = useUnits();
  const { showToast } = useToast();
  const [result, setResult] = useState<AdaptiveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const current = computeDailyTargets(profile ? { ...profile, dayTargets: undefined } : null).calories;

  useEffect(() => {
    if (!profile?.uid) return;
    let alive = true;
    const key = `${profile.uid}:${current}:${profile.goal ?? ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { setResult(hit.result); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [meals, weights] = await Promise.all([
        getMealCaloriesSince(profile.uid, WINDOW_DAYS + 1),
        getWeightHistory(profile.uid).then((w) => w || []),
      ]);
      if (!alive) return;
      const weighIns = (weights as { weight?: number; timestamp?: { toDate?: () => Date } }[])
        .filter((w) => w.timestamp?.toDate)
        .map((w) => ({ date: localDate(w.timestamp!.toDate!()), kg: Number(w.weight) }));
      const intake = dailyIntake(meals.map((m) => ({ date: localDate(m.at), kcal: m.kcal })));
      const r = adaptiveTarget({ weighIns, intake, today: localDate(new Date()), goal: profile.goal, currentTarget: current });
      cache.set(key, { at: Date.now(), result: r });
      setResult(r);
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // Recompute when the target itself changes (after Apply).
  }, [profile?.uid, current, profile?.goal]);

  const apply = async () => {
    if (!profile?.uid || result?.status !== 'ready') return;
    setSaving(true);
    try {
      const existing = (profile.macroTargets || {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...existing, mode: (existing.mode as string) || 'percent', calorieTarget: result.target };
      // In gram mode the calories come FROM the grams, so a new target alone
      // would change nothing. Keep protein; scale carbs and fat to fit.
      if (existing.mode === 'grams') {
        const p = Number(existing.proteinG) || 0, c = Number(existing.carbsG) || 0, f = Number(existing.fatsG) || 0;
        const rest = c * 4 + f * 9;
        const room = Math.max(0, result.target - p * 4);
        const k = rest > 0 ? room / rest : 0;
        next.carbsG = Math.round(c * k);
        next.fatsG = Math.round(f * k);
      }
      await updateDoc(doc(db, 'users', profile.uid), { macroTargets: next });
      showToast(t('Daily target set to {energy}', { energy: units.formatEnergy(result.target) }), 'success');
      onApplied?.(result.target);
      void import('../services/reviewService').then((m) => m.maybeAskForReview('smart_target')).catch(() => {});
    } catch {
      showToast(t('Could not update your target. Try again.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!profile?.uid) return null;
  if (loading) {
    return compact ? null : (
      <div className="glass p-4 flex items-center gap-2 text-sm text-text-dim" aria-busy="true">
        <Loader2 size={14} className="animate-spin" /> {t('Working out your real burn…')}
      </div>
    );
  }
  if (!result) return null;
  // On busy screens, only speak up when there is something to do.
  if (compact && (result.status !== 'ready' || result.change === 0)) return null;

  const Icon = result.status !== 'ready' ? Sparkles : result.kgPerWeek < -0.05 ? TrendingDown : result.kgPerWeek > 0.05 ? TrendingUp : Minus;

  return (
    <section className="glass p-4 space-y-3" aria-label={t('Smart calorie target')} data-testid="smart-target">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-accent" />
        <p className="text-eyebrow text-accent">{t('Smart target')}</p>
      </div>

      {result.status === 'need_data' ? (
        <>
          <p className="text-sm text-white leading-relaxed">
            {t("Your target adjusts to your real body once there's enough to go on: weigh in a few times a week and log full days.")}
          </p>
          <p className="text-xs text-text-dim">{result.message}</p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-white/[0.03] rounded-xl p-2 border border-white/[0.05]">
              <p className="num text-white font-bold">{result.loggedDays}/10</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider">{t('full days logged')}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2 border border-white/[0.05]">
              <p className="num text-white font-bold">{result.weighIns}/3</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider">{t('weigh-ins')}</p>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Same sentence as result.message, in the person's units. */}
          <p className="text-sm text-white leading-relaxed">
            {adaptiveMessage(result, {
              weightChange: units.formatWeightChange,
              energy: units.formatEnergy,
              energyNumber: units.formatEnergyNumber,
            })}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white/[0.03] rounded-xl p-2 border border-white/[0.05]">
              <p className="num text-white font-bold">{units.formatEnergyNumber(result.burn)}</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider">{t('real burn')}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2 border border-white/[0.05]">
              <p className="num text-white font-bold">{units.weightRateParts(result.kgPerWeek).value}</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider">{units.weightRateParts(result.kgPerWeek).unit}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2 border border-white/[0.05]">
              <p className="num text-accent font-bold">{units.formatEnergyNumber(result.target)}</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider">{result.change === 0 ? t('target') : t('new target')}</p>
            </div>
          </div>
          {result.change !== 0 && (
            <button
              onClick={apply}
              disabled={saving}
              className="w-full bg-accent text-bg font-semibold rounded-xl py-3 text-sm disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {result.change < 0
                ? t('Lower target to {energy}', { energy: units.formatEnergy(result.target) })
                : t('Raise target to {energy}', { energy: units.formatEnergy(result.target) })}
            </button>
          )}
          <p className="text-[11px] text-text-dim leading-relaxed">
            {t('Based on {days} logged days and {weighIns} weigh-ins in the last 4 weeks. If you tend to under-log, this still works: the scale shows what you really ate.', { days: result.loggedDays, weighIns: result.weighIns })}
          </p>
        </>
      )}
    </section>
  );
};
