import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Sparkles, ChefHat, ShoppingCart, Flame, X, Loader2, RefreshCw, Replace, Share2, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { generateMealPlan, getRecipe, swapMeal } from '../services/geminiService';
import { useToast } from '../hooks/useToast';
import { db } from '../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { checkAndAwardBadge } from '../services/badgeService';
import { haptic } from '../lib/haptics';
import { celebrateSmall } from '../lib/celebrate';
import { AnimatedNumber } from '../components/AnimatedNumber';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type MealType = typeof MEAL_TYPES[number];

const targetCaloriesFor = (goal?: string) =>
  goal === 'fat_loss' ? 1800 : goal === 'muscle_gain' ? 2800 : 2200;

const macroSplitFor = (goal?: string) =>
  goal === 'fat_loss' ? { p: 0.35, c: 0.35, f: 0.30 }
  : goal === 'muscle_gain' ? { p: 0.30, c: 0.45, f: 0.25 }
  : { p: 0.25, c: 0.45, f: 0.30 };

const macroGramsFor = (kcal: number, goal?: string) => {
  const s = macroSplitFor(goal);
  return {
    protein: Math.round((kcal * s.p) / 4),
    carbs:   Math.round((kcal * s.c) / 4),
    fats:    Math.round((kcal * s.f) / 9),
  };
};

const MacroRing: React.FC<{ protein: number; carbs: number; fats: number; size?: number }> = ({
  protein, carbs, fats, size = 84,
}) => {
  const pK = protein * 4, cK = carbs * 4, fK = fats * 9;
  const total = pK + cK + fK || 1;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pLen = (pK / total) * circ;
  const cLen = (cK / total) * circ;
  const fLen = (fK / total) * circ;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
        strokeDasharray={`${pLen} ${circ - pLen}`} strokeDashoffset={0} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent-3)" strokeWidth={stroke}
        strokeDasharray={`${cLen} ${circ - cLen}`} strokeDashoffset={-pLen} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent-2)" strokeWidth={stroke}
        strokeDasharray={`${fLen} ${circ - fLen}`} strokeDashoffset={-(pLen + cLen)} />
    </svg>
  );
};

interface PlanDay {
  day: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  snack: string;
  calories: number;
}

const TARGET_KEY = (uid: string) => `ff_mealplan_target_${uid}`;

export const MealPlan: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [days, setDays] = useState<PlanDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<{ name: string; type: string; dayIdx: number; mealKey: MealType } | null>(null);
  const [recipe, setRecipe] = useState<any>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [shoppingChecked, setShoppingChecked] = useState<Set<string>>(new Set());
  const [swapping, setSwapping] = useState<{ dayIdx: number; mealKey: MealType } | null>(null);
  const [dailyTarget, setDailyTarget] = useState<number>(() => targetCaloriesFor(profile?.goal));

  // Sync the daily target with profile.goal once profile loads, but let the user override.
  useEffect(() => {
    if (!profile?.uid) return;
    const saved = localStorage.getItem(TARGET_KEY(profile.uid));
    if (saved && parseInt(saved) > 0) setDailyTarget(parseInt(saved));
    else setDailyTarget(targetCaloriesFor(profile.goal));
  }, [profile?.uid, profile?.goal]);

  const updateDailyTarget = (n: number) => {
    const clamped = Math.max(1000, Math.min(5000, n));
    setDailyTarget(clamped);
    if (profile?.uid) localStorage.setItem(TARGET_KEY(profile.uid), String(clamped));
  };

  useEffect(() => { if (profile?.uid) loadSaved(); }, [profile?.uid]);

  const loadSaved = async () => {
    if (!profile?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'meal_plans', profile.uid));
      if (snap.exists()) {
        const data = snap.data();
        setDays(data.days || []);
        if (data.dailyTarget && typeof data.dailyTarget === 'number') {
          setDailyTarget(data.dailyTarget);
          localStorage.setItem(TARGET_KEY(profile.uid), String(data.dailyTarget));
        }
      }
    } catch (e) {
      console.warn('Load saved meal plan failed:', e);
    }
  };

  const persistPlan = async (next: PlanDay[], target: number) => {
    if (!profile?.uid) return;
    try {
      await setDoc(doc(db, 'meal_plans', profile.uid), {
        days: next,
        dailyTarget: target,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.warn('Persist plan failed (permission-denied is OK):', e);
    }
  };

  const generate = async () => {
    haptic('medium');
    setLoading(true);
    try {
      const prefs = profile?.dietaryPreferences?.join(', ')
        || profile?.healthConditions?.join(', ')
        || 'balanced';
      const target = dailyTarget;
      const plan = await generateMealPlan(prefs, target);

      let nextDays: PlanDay[] = [];
      if (Array.isArray(plan) && plan.length > 0) {
        nextDays = plan as PlanDay[];
      } else if (plan && typeof plan === 'object' && Array.isArray((plan as any).days)) {
        nextDays = (plan as any).days;
      }

      // Fallback if Gemini returns empty — generate a sensible static week
      if (nextDays.length === 0) {
        nextDays = fallbackWeek(target);
      }

      // Force the user's daily kcal target across every day of the week.
      nextDays = nextDays.map(d => ({ ...d, calories: target }));

      setDays(nextDays);
      await persistPlan(nextDays, target);
      if (profile?.uid) checkAndAwardBadge(profile.uid, 'ai_chef').catch(() => {});
      celebrateSmall();
      showToast(`Your ${target} kcal/day plan is ready`, 'success');
    } catch (e) {
      console.error('Generate plan failed:', e);
      showToast('Generation failed — using a starter plan', 'info');
      const nextDays = fallbackWeek(dailyTarget).map(d => ({ ...d, calories: dailyTarget }));
      setDays(nextDays);
      await persistPlan(nextDays, dailyTarget);
    } finally {
      setLoading(false);
    }
  };

  const openRecipe = async (name: string, type: string, dayIdx: number, mealKey: MealType) => {
    if (!name) return;
    haptic('light');
    setSelectedMeal({ name, type, dayIdx, mealKey });
    setLoadingRecipe(true);
    setRecipe(null);
    try { setRecipe(await getRecipe(name)); }
    catch { showToast('Recipe unavailable', 'error'); }
    finally { setLoadingRecipe(false); }
  };

  const swapSelected = async () => {
    if (!selectedMeal) return;
    setSwapping({ dayIdx: selectedMeal.dayIdx, mealKey: selectedMeal.mealKey });
    haptic('medium');
    try {
      const prefs = profile?.dietaryPreferences?.join(', ') || 'balanced';
      const result = await swapMeal(selectedMeal.name, `Replace this ${selectedMeal.mealKey}`, prefs);
      if (result?.name) {
        const next = [...days];
        next[selectedMeal.dayIdx] = { ...next[selectedMeal.dayIdx], [selectedMeal.mealKey]: result.name };
        setDays(next);
        await persistPlan(next, dailyTarget);
        setSelectedMeal({ ...selectedMeal, name: result.name });
        setRecipe(null);
        try { setRecipe(await getRecipe(result.name)); } catch {}
        showToast(`Swapped to ${result.name}`, 'success');
      } else {
        showToast('Could not find a swap', 'error');
      }
    } finally {
      setSwapping(null);
    }
  };

  // Build the shopping list from the current 7-day plan
  const shoppingList: string[] = React.useMemo(() => {
    if (!days.length) return [];
    const tokens = new Set<string>();
    days.forEach(d => {
      MEAL_TYPES.forEach(mt => {
        const raw = (d as any)[mt];
        if (typeof raw !== 'string') return;
        // Split on commas and 'with' / 'and' to extract food tokens.
        raw.split(/,| and | with /i).forEach(token => {
          const cleaned = token
            .trim()
            .replace(/^\d+\s*(g|oz|cup|cups|tbsp|tsp)\s*/i, '')
            .replace(/[.()]/g, '')
            .replace(/^a /, '')
            .toLowerCase();
          if (cleaned.length >= 3 && cleaned.length <= 32) tokens.add(cleaned);
        });
      });
    });
    return Array.from(tokens).sort();
  }, [days]);

  const shareShoppingList = async () => {
    const text = `🛒 FitFlow shopping list this week:\n\n${shoppingList.map(i => '• ' + i).join('\n')}`;
    haptic('medium');
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'Shopping list', text }); return; }
      catch { /* user cancelled, fall through */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Shopping list copied', 'success');
    } catch {
      showToast('Open Settings to share', 'info');
    }
  };

  const totalCalsThisWeek = days.reduce((a, d) => a + (d.calories || 0), 0);

  return (
    <div className="pb-28 pt-4 px-4 min-h-screen space-y-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18} /></button>
          <div>
            <p className="text-eyebrow text-accent">Meal plans</p>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">AI weekly menu</h1>
          </div>
        </div>
        {days.length > 0 && (
          <div className="flex gap-2">
            <button onClick={generate} disabled={loading}
              className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-accent transition-colors disabled:opacity-50"
              aria-label="Regenerate">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
            <button onClick={() => { haptic('light'); setShoppingOpen(true); }}
              className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-accent transition-colors"
              aria-label="Shopping list">
              <ShoppingCart size={16} />
            </button>
          </div>
        )}
      </header>

      {days.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-6 text-center">
          <div className="relative">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              className="w-24 h-24 glass rounded-3xl flex items-center justify-center"
            >
              <ChefHat size={40} className="text-text-dim/50" />
            </motion.div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 280, damping: 18 }}
              className="absolute -top-2 -right-2 w-8 h-8 ai-gradient-box rounded-xl flex items-center justify-center"
            >
              <Sparkles size={14} className="text-accent" />
            </motion.div>
          </div>
          <div>
            <p className="font-display text-2xl font-bold text-white tracking-tight">No plan yet</p>
            <p className="text-text-dim text-sm max-w-[280px] mx-auto leading-relaxed mt-2">
              Set your daily calorie target and AI builds a 7-day menu around your goal and preferences.
            </p>
          </div>

          <div className="w-full max-w-xs glass p-5 space-y-3">
            <p className="text-eyebrow text-accent text-center">Daily calorie target</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => updateDailyTarget(dailyTarget - 50)}
                className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/15 text-white text-lg font-bold active:scale-95 transition-transform"
                aria-label="Decrease target"
              >−</button>
              <input
                type="number"
                inputMode="numeric"
                value={dailyTarget}
                onChange={(e) => updateDailyTarget(parseInt(e.target.value) || 0)}
                className="num text-4xl font-bold text-white text-center bg-transparent w-32 focus:outline-none"
              />
              <button
                onClick={() => updateDailyTarget(dailyTarget + 50)}
                className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/15 text-white text-lg font-bold active:scale-95 transition-transform"
                aria-label="Increase target"
              >+</button>
            </div>
            <p className="text-center text-xs text-text-mute">
              kcal · scaled across 7 days = <span className="num text-accent font-semibold">{(dailyTarget * 7).toLocaleString()}</span>/wk
            </p>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[1800, 2200, 2800].map(v => (
                <button
                  key={v}
                  onClick={() => updateDailyTarget(v)}
                  className={`py-2 rounded-lg text-xs font-semibold border transition-all ${dailyTarget === v ? 'bg-accent text-bg border-accent' : 'bg-white/[0.03] text-text-dim border-white/[0.06]'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <button onClick={generate} disabled={loading || dailyTarget < 1000}
            className="btn-3d h-13 px-6 disabled:opacity-60">
            {loading ? <><Loader2 className="animate-spin" size={16} /> Building your week…</>
              : <><Sparkles size={16} /> Generate my plan</>}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass p-5 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-eyebrow text-accent">Week summary</p>
                <p className="num font-display text-xl font-bold text-white mt-1">
                  <AnimatedNumber value={totalCalsThisWeek} /> <span className="text-sm text-text-dim font-medium">kcal · 7 days</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-dim font-medium">Daily target</p>
                <div className="flex items-center gap-1.5 justify-end mt-0.5">
                  <button
                    onClick={() => { updateDailyTarget(dailyTarget - 50); setDays(d => d.map(day => ({ ...day, calories: dailyTarget - 50 }))); }}
                    className="w-6 h-6 rounded-md bg-white/[0.06] border border-white/15 text-white text-xs font-bold active:scale-95 transition-transform"
                    aria-label="Decrease target"
                  >−</button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={dailyTarget}
                    onChange={(e) => { const n = parseInt(e.target.value) || 0; updateDailyTarget(n); setDays(d => d.map(day => ({ ...day, calories: Math.max(1000, Math.min(5000, n)) }))); }}
                    className="num text-lg text-accent font-semibold bg-transparent w-16 text-right focus:outline-none"
                  />
                  <button
                    onClick={() => { updateDailyTarget(dailyTarget + 50); setDays(d => d.map(day => ({ ...day, calories: dailyTarget + 50 }))); }}
                    className="w-6 h-6 rounded-md bg-white/[0.06] border border-white/15 text-white text-xs font-bold active:scale-95 transition-transform"
                    aria-label="Increase target"
                  >+</button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-5 pt-1 border-t border-white/[0.06]">
              {(() => {
                const macros = macroGramsFor(dailyTarget, profile?.goal);
                return (
                  <>
                    <MacroRing protein={macros.protein} carbs={macros.carbs} fats={macros.fats} />
                    <div className="flex-1 space-y-2">
                      <p className="text-eyebrow text-text-dim">Daily macros</p>
                      <div className="space-y-1.5">
                        {[
                          { l: 'Protein', v: macros.protein, c: 'bg-accent',    t: 'text-accent' },
                          { l: 'Carbs',   v: macros.carbs,   c: 'bg-accent-3',  t: 'text-accent-3' },
                          { l: 'Fats',    v: macros.fats,    c: 'bg-accent-2',  t: 'text-accent-2' },
                        ].map(m => (
                          <div key={m.l} className="flex items-center gap-2.5">
                            <span className={`w-2 h-2 rounded-full ${m.c}`} />
                            <span className="text-xs text-text-dim flex-1">{m.l}</span>
                            <span className={`num text-sm font-semibold ${m.t}`}>{m.v}g</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {days.map((day, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, type: 'spring', stiffness: 220, damping: 22 }}
              className="glass overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-white/[0.06] flex justify-between items-center">
                <p className="text-eyebrow text-accent">{day.day}</p>
                <div className="flex items-center gap-1.5">
                  <Flame size={12} className="text-accent-2/70" />
                  <span className="num text-xs text-text-dim font-medium">{day.calories} kcal</span>
                </div>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                {MEAL_TYPES.map(mt => (
                  <button
                    key={mt}
                    onClick={() => openRecipe(day[mt], mt, idx, mt)}
                    className="text-left space-y-1 group"
                  >
                    <p className="text-eyebrow text-text-dim">{mt}</p>
                    <p className="text-sm font-medium text-white leading-snug group-hover:text-accent transition-colors">
                      {day[mt] || '—'}
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Recipe modal with swap */}
      <AnimatePresence>
        {selectedMeal && (
          <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedMeal(null)} className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 240, damping: 28 }}
              className="relative bg-surface w-full max-w-lg rounded-t-3xl sm:rounded-3xl border-t sm:border border-white/[0.06] max-h-[88vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 space-y-5 overflow-y-auto">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-eyebrow text-accent">{selectedMeal.type}</p>
                    <h2 className="font-display text-2xl font-bold text-white tracking-tight leading-tight mt-1">{selectedMeal.name}</h2>
                  </div>
                  <button onClick={() => setSelectedMeal(null)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim shrink-0" aria-label="Close"><X size={16} /></button>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={swapSelected}
                    disabled={swapping !== null}
                    className="btn-ghost h-11 px-4 flex-1 disabled:opacity-50"
                  >
                    {swapping ? <Loader2 className="animate-spin" size={14} /> : <Replace size={14} />}
                    Swap with AI
                  </button>
                </div>

                {loadingRecipe ? (
                  <div className="py-12 flex flex-col items-center gap-3">
                    <Loader2 className="animate-spin text-accent" size={24} />
                    <p className="text-sm text-text-dim">Fetching recipe…</p>
                  </div>
                ) : !recipe ? (
                  <div className="py-10 flex flex-col items-center gap-3 text-center">
                    <ChefHat className="text-text-dim/60" size={32} />
                    <p className="text-sm text-text-dim max-w-[260px] leading-relaxed">
                      AI recipe details are taking a moment. Tap <span className="text-accent font-medium">Swap with AI</span> to pick a different option, or check back shortly.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-2">
                      {[{ l: 'Protein', v: `${recipe.protein || 0}g`, c: 'text-accent' },
                        { l: 'Carbs', v: `${recipe.carbs || 0}g`, c: 'text-accent-3' },
                        { l: 'Fats', v: `${recipe.fats || 0}g`, c: 'text-accent-2' }].map(m => (
                        <div key={m.l} className="glass p-3 text-center">
                          <p className={`num font-display text-lg font-bold ${m.c}`}>{m.v}</p>
                          <p className="text-xs text-text-dim font-medium mt-0.5">{m.l}</p>
                        </div>
                      ))}
                    </div>
                    {recipe.ingredients?.length > 0 && (
                      <div>
                        <p className="text-eyebrow text-accent mb-3">Ingredients</p>
                        <ul className="space-y-2">{recipe.ingredients.map((i: string, j: number) => (
                          <li key={j} className="flex items-center gap-3">
                            <div className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />
                            <span className="text-sm text-white/85">{i}</span>
                          </li>
                        ))}</ul>
                      </div>
                    )}
                    {recipe.instructions?.length > 0 && (
                      <div>
                        <p className="text-eyebrow text-accent mb-3">Instructions</p>
                        <ol className="space-y-3">{recipe.instructions.map((step: string, j: number) => (
                          <li key={j} className="flex gap-3">
                            <span className="num text-accent font-semibold text-sm shrink-0 w-5">{j + 1}.</span>
                            <p className="text-sm text-white/85 leading-relaxed">{step}</p>
                          </li>
                        ))}</ol>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shopping list - dynamic from the plan */}
      <AnimatePresence>
        {shoppingOpen && (
          <div className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShoppingOpen(false)} className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 240, damping: 28 }}
              className="relative bg-surface border border-white/[0.06] w-full max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-4">
                <div>
                  <p className="text-eyebrow text-accent">This week</p>
                  <p className="font-display text-xl font-bold text-white tracking-tight">Shopping list</p>
                  <p className="text-xs text-text-dim mt-0.5 num">
                    {shoppingChecked.size} / {shoppingList.length} ticked
                  </p>
                </div>
                <button onClick={() => setShoppingOpen(false)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 -mx-1 px-1">
                {shoppingList.length === 0 ? (
                  <p className="text-sm text-text-dim text-center py-8">List builds from your meal plan once it's generated.</p>
                ) : shoppingList.map(item => {
                  const checked = shoppingChecked.has(item);
                  return (
                    <button
                      key={item}
                      onClick={() => {
                        haptic('selection');
                        setShoppingChecked(prev => {
                          const next = new Set(prev);
                          if (next.has(item)) next.delete(item); else next.add(item);
                          return next;
                        });
                      }}
                      className={`w-full flex items-center gap-3 p-3 glass rounded-xl text-left transition-all ${checked ? 'opacity-50' : ''}`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-accent border-accent' : 'border-white/25'}`}>
                        {checked && <Check size={12} className="text-bg" strokeWidth={3} />}
                      </div>
                      <span className={`text-sm capitalize ${checked ? 'text-text-dim line-through' : 'text-white'}`}>{item}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-4 pt-4 border-t border-white/[0.06]">
                <button onClick={() => setShoppingChecked(new Set())} className="btn-ghost h-12 px-4">Reset</button>
                <button onClick={shareShoppingList} disabled={shoppingList.length === 0}
                  className="btn-3d h-12 flex-1 disabled:opacity-50">
                  <Share2 size={14} /> Share list
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Sensible fallback if Gemini is down
const fallbackWeek = (target: number): PlanDay[] => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const breakfasts = ['Oatmeal with blueberries and almonds', 'Greek yogurt with honey and walnuts', 'Vegetable omelette with whole grain toast', 'Protein smoothie with banana and oats', 'Avocado toast with poached eggs', 'Cottage cheese with mixed berries', 'Whole grain pancakes with peanut butter'];
  const lunches = ['Grilled chicken salad with quinoa', 'Tuna wrap with greens and hummus', 'Salmon bowl with brown rice and broccoli', 'Turkey and avocado sandwich', 'Lentil soup with whole grain bread', 'Tofu stir-fry with brown rice', 'Chicken burrito bowl with black beans'];
  const dinners = ['Baked salmon with sweet potato and asparagus', 'Grilled chicken with roasted vegetables', 'Lean beef stir-fry with brown rice', 'Whole wheat pasta with turkey meatballs', 'Tofu curry with basmati rice', 'Shrimp tacos with cabbage slaw', 'Roast chicken with quinoa and greens'];
  const snacks = ['Apple with almond butter', 'Greek yogurt with chia seeds', 'Protein shake with banana', 'Carrots with hummus', 'Mixed nuts and dried fruit', 'Cottage cheese with peach', 'Boiled eggs with cucumber'];
  return days.map((d, i) => ({
    day: d,
    breakfast: breakfasts[i],
    lunch: lunches[i],
    dinner: dinners[i],
    snack: snacks[i],
    calories: target,
  }));
};
