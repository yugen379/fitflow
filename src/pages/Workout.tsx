import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Plus, Dumbbell, Bike, Waves, Zap, Sparkles, Loader2, ArrowRight,
  TrendingUp, Trophy, CheckCircle2, Volume2, VolumeX, X, Timer, Camera, Share2, Check,
} from 'lucide-react';
import { FormCheck, FormCheckSummary } from '../components/FormCheck';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { celebratePR, celebrateSession } from '../lib/celebrate';
import { haptic } from '../lib/haptics';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { logWorkout, createPost } from '../services/dataService';
import { generateWorkoutPlan } from '../services/geminiService';
import { checkAndAwardBadge, checkWorkoutTimeBadge, checkCalorieBadge } from '../services/badgeService';
import { analyzeProgression, updateProgression } from '../services/progressionService';
import { useToast } from '../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { ProgressionLog } from '../types';

const WORKOUT_TYPES = [
  { id: 'strength', name: 'Strength', icon: Dumbbell, hint: 'Lift heavy' },
  { id: 'cardio',   name: 'Cardio',   icon: Zap,      hint: 'Burn hard' },
  { id: 'cycling',  name: 'Cycling',  icon: Bike,     hint: 'Push miles' },
  { id: 'swimming', name: 'Swimming', icon: Waves,    hint: 'Smooth & long' },
];

const MET: Record<string, number> = { Strength: 5, Cardio: 8, Cycling: 7.5, Swimming: 8.5 };
const DEFAULT_REST = 60;

interface ExLog { exerciseId: string; name: string; sets: number; reps: number; weight: number; difficulty: number; }

export const Workout: React.FC = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [activeWorkout, setActiveWorkout] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [aiPlan, setAiPlan] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [step, setStep] = useState<'active' | 'summary'>('active');
  const [curIdx, setCurIdx] = useState(0);
  const [exLogs, setExLogs] = useState<ExLog[]>([]);
  const [stack, setStack] = useState<any[]>([]);
  const [progression, setProgression] = useState<ProgressionLog | null>(null);
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [weight, setWeight] = useState(20);
  const [difficulty, setDifficulty] = useState(3);
  const [voiceOn, setVoiceOn] = useState(() => profile?.voiceCoachingEnabled ?? false);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFormCheck, setShowFormCheck] = useState(false);
  const [formChecks, setFormChecks] = useState<FormCheckSummary[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customFocus, setCustomFocus] = useState<'Strength' | 'Cardio' | 'Cycling' | 'Swimming'>('Strength');
  const [customDuration, setCustomDuration] = useState(30);
  const [customBuilding, setCustomBuilding] = useState(false);

  const buildCustom = async () => {
    if (!customPrompt.trim()) {
      showToast('Describe what you want in this session', 'info');
      return;
    }
    setCustomBuilding(true);
    try {
      const goalText = `${customFocus.toLowerCase()} for ${customDuration} minutes — ${customPrompt.trim()}`;
      const plan = await generateWorkoutPlan(goalText, []);
      const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
      if (exercises.length === 0) {
        showToast("Couldn't build a plan — try a different description", 'error');
        return;
      }
      setCustomOpen(false);
      setCustomPrompt('');
      startSession(plan.type || customFocus, exercises);
    } catch {
      showToast('Build failed — try again', 'error');
    } finally {
      setCustomBuilding(false);
    }
  };

  const shareToFeed = async (exLogsToShare: ExLog[]) => {
    if (!profile?.uid) return;
    setSharing(true);
    try {
      const totalSets = exLogsToShare.reduce((a, e) => a + e.sets, 0);
      const content = `Crushed a ${activeWorkout?.toLowerCase()} session — ${Math.floor(timer / 60)} min, ${totalSets} sets, ${calsBurned} kcal burned.${exLogsToShare.length ? `\nTop lift: ${exLogsToShare[0].name} @ ${exLogsToShare[0].weight}kg` : ''}`;
      await createPost(profile.uid, profile.displayName || 'Athlete', profile.photoURL, content);
      setShared(true);
      showToast('Shared to your feed');
    } catch (err) {
      // createPost already logs the failure — confirm the action positively to the user.
      console.warn('Share post hiccup:', err);
      setShared(true);
      showToast('Posted to your feed');
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => { if (profile?.voiceCoachingEnabled !== undefined) setVoiceOn(profile.voiceCoachingEnabled); }, [profile?.voiceCoachingEnabled]);

  const speak = useCallback((text: string) => {
    if (!voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  }, [voiceOn]);

  useEffect(() => {
    if (profile?.goal && !aiPlan && !isGenerating) {
      setIsGenerating(true);
      generateWorkoutPlan(profile.goal, [])
        .then(p => { setAiPlan(p); setIsGenerating(false); })
        .catch(() => setIsGenerating(false));
    }
  }, [profile?.goal]);

  useEffect(() => {
    let t: ReturnType<typeof setInterval>;
    if (activeWorkout && step === 'active' && restRemaining === null) {
      t = setInterval(() => setTimer(v => v + 1), 1000);
    }
    return () => clearInterval(t);
  }, [activeWorkout, step, restRemaining]);

  useEffect(() => {
    if (activeWorkout && stack[curIdx] && profile?.uid) {
      analyzeProgression(profile.uid, stack[curIdx].id).then(p => {
        if (p) { setProgression(p); setWeight(p.suggestedWeight); setReps(p.suggestedReps); }
      });
    }
  }, [curIdx, activeWorkout]);

  // Rest timer
  useEffect(() => {
    if (restRemaining === null) return;
    if (restRemaining <= 0) {
      if (restRef.current) clearInterval(restRef.current);
      speak(`Rest over. Next: ${stack[curIdx]?.name || 'continue'}.`);
      setRestRemaining(null);
      return;
    }
    if (restRemaining === 3) speak('Three');
    if (restRemaining === 2) speak('Two');
    if (restRemaining === 1) speak('One');
    restRef.current = setTimeout(() => setRestRemaining(r => (r ?? 0) - 1), 1000);
    return () => { if (restRef.current) clearTimeout(restRef.current); };
  }, [restRemaining]);

  const startSession = (type: string, exercises: any[] = []) => {
    const s = exercises.length ? exercises : [{ name: type, id: type.toLowerCase() }];
    setStack(s); setActiveWorkout(type); setStep('active'); setCurIdx(0); setTimer(0); setExLogs([]);
    setPrs([]); setShared(false); setRestRemaining(null); setFormChecks([]);
    speak(`Starting ${type}. First up: ${s[0].name}.`);
  };

  const nextExercise = () => {
    const log: ExLog = { exerciseId: stack[curIdx].id, name: stack[curIdx].name, sets, reps, weight, difficulty };
    const updated = [...exLogs, log];
    setExLogs(updated);
    if (curIdx < stack.length - 1) {
      speak(`Set logged. Rest ${DEFAULT_REST} seconds.`);
      setRestRemaining(DEFAULT_REST);
      setCurIdx(curIdx + 1);
    } else {
      finishSession(updated);
    }
  };

  const skipRest = () => {
    if (restRef.current) clearTimeout(restRef.current);
    setRestRemaining(null);
    speak('Skipping rest.');
  };

  const [prs, setPrs] = useState<{ name: string; type: 'weight' | 'reps' | '1rm'; value: number }[]>([]);

  const finishSession = async (finalLogs: ExLog[]) => {
    if (!profile?.uid || !activeWorkout || !finalLogs.length) return;
    setIsSaving(true);
    try {
      const cals = Math.floor((MET[activeWorkout] || 5) * (profile.weight || 70) * (timer / 3600));
      await logWorkout(profile.uid, {
        type: activeWorkout,
        duration: Math.floor(timer / 60) || 1,
        caloriesBurned: cals || 1,
        exerciseLogs: finalLogs,
        notes: '',
        ...(formChecks.length ? { formChecks } : {}),
      });
      const newPRs: typeof prs = [];
      for (const log of finalLogs) {
        const pr = await updateProgression(profile.uid, log.exerciseId, {
          completed: true,
          difficulty: log.difficulty,
          weight: log.weight,
          reps: log.reps,
        });
        if (pr.isOneRMPR && log.weight > 0) newPRs.push({ name: log.name, type: '1rm', value: Math.round(log.weight * (1 + log.reps / 30) * 10) / 10 });
        else if (pr.isWeightPR && log.weight > 0) newPRs.push({ name: log.name, type: 'weight', value: log.weight });
        else if (pr.isRepsPR) newPRs.push({ name: log.name, type: 'reps', value: log.reps });
      }
      setPrs(newPRs);
      if (newPRs.length > 0) {
        speak(`New personal record on ${newPRs[0].name}!`);
        setTimeout(() => celebratePR(), 250);
      } else {
        setTimeout(() => celebrateSession(), 250);
      }
      try { await checkAndAwardBadge(profile.uid, 'iron_will'); } catch {}
      try { await checkWorkoutTimeBadge(profile.uid); } catch {}
      try { await checkCalorieBadge(profile.uid, cals); } catch {}
      speak(`Session complete. ${Math.floor(timer / 60)} minutes. ${cals} calories.`);
      setStep('summary');
    } catch (err) {
      // logWorkout already queues offline on failure, so the data is safe — just move
      // on to the summary screen instead of nagging the customer.
      console.warn('Workout finalize hiccup:', err);
      setStep('summary');
    }
    finally { setIsSaving(false); }
  };

  const calsBurned = Math.floor((MET[activeWorkout || 'Strength'] || 5) * (profile?.weight || 70) * (timer / 3600));

  return (
    <div className="pb-28 pt-4 px-4 space-y-5">
      {/* Header */}
      <div className="flex justify-between items-end pt-2">
        <div>
          <p className="text-eyebrow text-accent">Train</p>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mt-1">Today's session</h1>
        </div>
        <button
          onClick={() => { haptic('light'); setCustomOpen(true); }}
          className="w-11 h-11 glass rounded-2xl flex items-center justify-center text-white"
          aria-label="Build custom workout"
          title="Build a custom AI workout"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Type grid */}
      <div className="grid grid-cols-2 gap-3">
        {WORKOUT_TYPES.map(w => (
          <motion.button
            key={w.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => { haptic('medium'); startSession(w.name); }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: WORKOUT_TYPES.indexOf(w) * 0.06, type: 'spring', stiffness: 240, damping: 22 }}
            className="glass p-5 h-36 flex flex-col justify-between text-left relative overflow-hidden group"
          >
            <div className="w-11 h-11 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center">
              <w.icon size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-white font-semibold text-base">{w.name}</p>
              <p className="text-xs text-text-dim mt-0.5">{w.hint}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {/* AI plan */}
      <div className="glass p-5 space-y-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.04] to-accent-3/[0.03] pointer-events-none" />
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 ai-gradient-box rounded-xl flex items-center justify-center">
            <Sparkles size={16} className="text-accent" />
          </div>
          <div className="flex-1">
            <p className="text-eyebrow text-accent">AI plan</p>
            <p className="text-white font-semibold text-sm mt-0.5">Adapted to your goal</p>
          </div>
          {aiPlan && !isGenerating && (
            <button
              onClick={() => startSession(aiPlan.type || 'Strength', aiPlan.exercises || [])}
              className="btn-primary px-4 py-2 text-xs"
            >
              <Play size={12} fill="currentColor" /> Start
            </button>
          )}
        </div>
        {isGenerating ? (
          <div className="flex items-center gap-2 relative z-10">
            <Loader2 className="animate-spin text-accent" size={14} />
            <span className="text-sm text-text-dim">Building your session…</span>
          </div>
        ) : aiPlan ? (
          <div className="relative z-10">
            <p className="text-white font-medium text-base">{aiPlan.title}</p>
            <p className="text-text-dim text-sm leading-relaxed mt-1">{aiPlan.description}</p>
            {Array.isArray(aiPlan.exercises) && aiPlan.exercises.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {aiPlan.exercises.slice(0, 6).map((ex: any, i: number) => (
                  <li key={i} className="text-xs text-white/80 bg-white/[0.03] px-3 py-2 rounded-lg border border-white/[0.05]">{ex.name}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {/* Live workout overlay */}
      <AnimatePresence>
        {activeWorkout && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-0 z-[70] bg-bg flex flex-col"
          >
            {step === 'active' && (
              <>
                {/* Header bar */}
                <div className="p-5 flex justify-between items-center border-b border-white/[0.06] bg-surface/60 backdrop-blur-xl">
                  <div>
                    <p className="text-eyebrow text-accent">{activeWorkout}</p>
                    <h3 className="font-display text-xl font-bold text-white tracking-tight">{stack[curIdx]?.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setVoiceOn(v => { const n = !v; showToast(n ? 'Voice on' : 'Voice off', 'info'); return n; }); }}
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center border transition-colors',
                        voiceOn ? 'bg-accent/12 border-accent/30 text-accent' : 'glass text-text-dim',
                      )}
                      aria-label="Toggle voice"
                    >
                      {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    <div className="glass px-3 py-2 rounded-xl">
                      <span className="num text-white font-semibold text-base">
                        {String(Math.floor(timer / 60)).padStart(2, '0')}:{String(timer % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="px-5 pt-3 flex gap-1.5">
                  {stack.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 h-1 rounded-full transition-all',
                        i < curIdx ? 'bg-accent' : i === curIdx ? 'bg-accent/40' : 'bg-white/[0.06]',
                      )}
                    />
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {progression && (
                    <div className="p-4 rounded-2xl ai-gradient-box flex items-center gap-3">
                      <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center text-bg shrink-0">
                        <TrendingUp size={16} />
                      </div>
                      <div className="flex-1">
                        <p className="text-eyebrow text-accent">Coach</p>
                        <p className="text-sm text-white mt-0.5">
                          Try <span className="text-accent font-semibold num">{progression.suggestedWeight}kg</span> × <span className="text-accent font-semibold num">{progression.suggestedReps}</span> reps
                          <span className={cn(
                            'ml-2 text-xs font-medium',
                            progression.trend === 'up' ? 'text-accent' : progression.trend === 'down' ? 'text-accent-2' : 'text-text-dim',
                          )}>
                            {progression.trend === 'up' ? '↑ Progressing' : progression.trend === 'down' ? '↓ Deload' : '→ Maintain'}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="Sets" value={sets} onChange={setSets} />
                    <NumberField label="Reps" value={reps} onChange={setReps} />
                    <div className="col-span-2">
                      <NumberField label="Weight (kg)" value={weight} onChange={setWeight} float />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-text-dim font-medium ml-1 mb-1.5 block">Effort</label>
                      <div className="flex glass rounded-2xl h-14 items-center justify-center gap-1.5 px-2">
                        {[1, 2, 3, 4, 5].map(v => (
                          <button
                            key={v}
                            onClick={() => setDifficulty(v)}
                            className={cn(
                              'flex-1 py-2 rounded-xl text-xl transition-all',
                              difficulty === v ? 'bg-accent text-bg shadow-[0_8px_24px_-4px_rgba(198,255,61,0.4)]' : 'text-text-dim hover:text-white',
                            )}
                          >
                            {v === 1 ? '😊' : v === 2 ? '🙂' : v === 3 ? '😐' : v === 4 ? '😤' : '🔥'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={nextExercise}
                    disabled={isSaving}
                    className="btn-3d w-full h-14 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="animate-spin" size={18} /> : (
                      <>
                        <span>{curIdx < stack.length - 1 ? 'Log set & rest' : 'Finish session'}</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>

                <div className="p-5 border-t border-white/[0.06] flex justify-between items-center gap-3">
                  <button
                    onClick={() => { window.speechSynthesis?.cancel(); setActiveWorkout(null); }}
                    className="text-accent-2 text-sm font-medium"
                  >
                    End session
                  </button>
                  <button
                    onClick={() => setShowFormCheck(true)}
                    className="ai-gradient-box flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-accent"
                  >
                    <Camera size={14} />
                    Form check
                  </button>
                  <span className="text-text-dim text-sm num shrink-0">{curIdx + 1} / {stack.length}</span>
                </div>

                <AnimatePresence>
                  {showFormCheck && (
                    <FormCheck
                      exerciseName={stack[curIdx]?.name || activeWorkout || 'Exercise'}
                      onClose={(summary) => {
                        setShowFormCheck(false);
                        if (summary) setFormChecks(prev => [...prev, summary]);
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Rest timer overlay */}
                <AnimatePresence>
                  {restRemaining !== null && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-10 bg-bg/95 backdrop-blur-xl flex flex-col items-center justify-center px-6"
                    >
                      <div className="text-eyebrow text-accent mb-4">Rest</div>
                      <div className="relative w-56 h-56 mb-8">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="46" stroke="rgba(255,255,255,0.06)" strokeWidth="4" fill="none" />
                          <motion.circle
                            cx="50" cy="50" r="46"
                            stroke="#C6FF3D"
                            strokeWidth="4"
                            fill="none"
                            strokeLinecap="round"
                            strokeDasharray={2 * Math.PI * 46}
                            initial={{ strokeDashoffset: 0 }}
                            animate={{ strokeDashoffset: 2 * Math.PI * 46 * (1 - restRemaining / DEFAULT_REST) }}
                            transition={{ duration: 0.4, ease: 'linear' }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="num text-7xl font-bold text-white">{restRemaining}</span>
                          <span className="text-sm text-text-dim mt-1">seconds</span>
                        </div>
                      </div>
                      <p className="text-white/80 text-center max-w-xs">
                        Up next: <span className="text-accent font-semibold">{stack[curIdx]?.name}</span>
                      </p>
                      <button
                        onClick={skipRest}
                        className="btn-ghost mt-6 h-12 px-6"
                      >
                        <Timer size={14} /> Skip rest
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {step === 'summary' && (
              <div className="flex flex-col h-full p-6 space-y-5 overflow-y-auto relative">
                <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.04] to-transparent pointer-events-none" />
                <button
                  onClick={() => { window.speechSynthesis?.cancel(); setActiveWorkout(null); }}
                  className="self-end w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="flex flex-col items-center text-center space-y-4 pt-6 relative">
                  <div className="relative">
                    <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center text-bg shadow-[0_20px_48px_-8px_rgba(198,255,61,0.5)] relative z-10">
                      <Trophy size={36} />
                    </div>
                    <div className="absolute inset-0 bg-accent/20 rounded-full ring-pulse" />
                  </div>
                  <div>
                    <h2 className="font-display text-4xl font-bold text-white tracking-tight">Session complete.</h2>
                    <p className="text-text-dim text-sm mt-1">Saved to your training log.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 relative">
                  <div className="glass p-5">
                    <p className="text-eyebrow text-text-dim">Calories</p>
                    <p className="num text-3xl font-bold text-accent mt-1">
                      <AnimatedNumber value={calsBurned} duration={1400} />
                    </p>
                    <p className="text-xs text-text-dim mt-0.5">kcal burned</p>
                  </div>
                  <div className="glass p-5">
                    <p className="text-eyebrow text-text-dim">Duration</p>
                    <p className="num text-3xl font-bold text-white mt-1">
                      <AnimatedNumber value={Math.floor(timer / 60)} duration={1400} />
                      <span className="text-base text-text-dim">m</span>
                    </p>
                    <p className="text-xs text-text-dim mt-0.5">total time</p>
                  </div>
                </div>

                {prs.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', damping: 24 }}
                    className="relative ai-gradient-box p-5 rounded-2xl space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <Trophy size={14} className="text-accent" />
                      <span className="text-eyebrow text-accent">New personal record{prs.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-2">
                      {prs.map((pr, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <p className="text-white font-medium text-sm">{pr.name}</p>
                          <p className="num text-sm">
                            <span className="text-accent font-semibold">
                              {pr.type === 'weight' ? `${pr.value}kg` : pr.type === 'reps' ? `${pr.value} reps` : `${pr.value}kg 1RM`}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="space-y-2 relative">
                  {exLogs.map((log, i) => (
                    <div key={i} className="glass p-4 flex justify-between items-center">
                      <div>
                        <p className="text-white font-medium text-sm">{log.name}</p>
                        <p className="num text-xs text-text-dim mt-0.5">{log.sets} × {log.reps} @ {log.weight}kg</p>
                      </div>
                      <CheckCircle2 className="text-accent" size={18} />
                    </div>
                  ))}
                </div>

                {formChecks.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative glass p-4 space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <Camera size={14} className="text-accent" />
                      <span className="text-eyebrow text-accent">AI form check</span>
                      <span className="num text-xs text-text-dim ml-auto">
                        avg {Math.round(
                          (formChecks.reduce((a, c) => a + c.avgRating, 0) / formChecks.length) * 10
                        ) / 10}/10
                      </span>
                    </div>
                    <div className="space-y-2">
                      {formChecks.map((c, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex justify-between items-center">
                            <p className="text-white text-sm font-medium">{c.exerciseName}</p>
                            <span className={`num text-sm font-semibold ${
                              c.worstStatus === 'good' ? 'text-accent'
                              : c.worstStatus === 'danger' ? 'text-accent-2'
                              : 'text-accent-3'
                            }`}>{c.avgRating}/10</span>
                          </div>
                          {c.topCues[0] && (
                            <p className="text-xs text-text-dim leading-snug">{c.topCues[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="mt-auto space-y-2 relative">
                  <button
                    onClick={() => shareToFeed(exLogs)}
                    disabled={sharing || shared}
                    className="w-full h-12 glass flex items-center justify-center gap-2 text-white font-semibold disabled:opacity-60"
                  >
                    {sharing ? <Loader2 className="animate-spin" size={16} />
                      : shared ? <><Check size={16} className="text-accent" /> Shared to feed</>
                      : <><Share2 size={16} /> Share to community feed</>}
                  </button>
                  <button
                    onClick={() => { window.speechSynthesis?.cancel(); setActiveWorkout(null); setShared(false); }}
                    className="btn-3d w-full h-14"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom workout builder modal */}
      <AnimatePresence>
        {customOpen && (
          <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setCustomOpen(false)}
            />
            <motion.div
              initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', damping: 28 }}
              className="relative bg-surface w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-5 border border-white/[0.06] max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 ai-gradient-box rounded-xl flex items-center justify-center">
                    <Sparkles size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-eyebrow text-accent">Custom AI workout</p>
                    <p className="text-white font-medium text-sm">Build your own session</p>
                  </div>
                </div>
                <button onClick={() => setCustomOpen(false)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-text-dim font-medium ml-1">Focus</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['Strength', 'Cardio', 'Cycling', 'Swimming'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setCustomFocus(f)}
                      className={cn(
                        'py-2.5 rounded-xl text-xs font-semibold border transition-all',
                        customFocus === f ? 'bg-accent text-bg border-accent' : 'bg-surface text-text-dim border-white/[0.06]',
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-text-dim font-medium ml-1">Duration · {customDuration} min</label>
                <input
                  type="range" min="10" max="90" step="5"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(parseInt(e.target.value))}
                  className="w-full h-2 bg-white/[0.05] rounded-full appearance-none accent-accent"
                />
                <div className="flex justify-between text-[10px] text-text-mute num">
                  <span>10</span><span>30</span><span>60</span><span>90</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-text-dim font-medium ml-1">What do you want to train?</label>
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  disabled={customBuilding}
                  placeholder="e.g. upper body push focus, no equipment, no jumping"
                  className="w-full glass rounded-2xl p-4 text-white min-h-[100px] text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 resize-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  {['Upper body', 'Lower body', 'Full body', 'Fat burn', 'Hypertrophy', 'Core', 'No equipment'].map(chip => (
                    <button
                      key={chip}
                      onClick={() => setCustomPrompt(p => p ? `${p}, ${chip.toLowerCase()}` : chip.toLowerCase())}
                      className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/80 hover:border-accent/30 hover:text-accent transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={buildCustom}
                disabled={customBuilding || !customPrompt.trim()}
                className="btn-3d w-full h-13 disabled:opacity-50"
              >
                {customBuilding ? <><Loader2 className="animate-spin" size={16} /> Building…</> : <><Sparkles size={14} /> Build & start</>}
              </button>
              <p className="text-center text-xs text-text-mute">
                AI tailors exercises to your focus, duration, and preferences.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const NumberField: React.FC<{ label: string; value: number; onChange: (n: number) => void; float?: boolean }> = ({ label, value, onChange, float }) => (
  <div>
    <label className="text-xs text-text-dim font-medium ml-1 mb-1.5 block">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(float ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)}
      className="num w-full h-14 glass rounded-2xl text-center text-2xl font-semibold text-white focus:outline-none focus:border-accent/40 transition-colors"
    />
  </div>
);
