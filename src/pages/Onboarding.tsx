import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { db } from '../lib/firebase';
import { doc, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Weight, Ruler, Calendar, Target, ChevronRight, HeartPulse, Salad, Camera, Mic, Bell, Check, X as XIcon, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { useToast } from '../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { requestPushPermission, micSupported } from '../lib/pushPermission';
import { computeLevel } from '../services/missionUtils';

type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'athletic_performance';

const GOAL_OPTIONS: { id: Goal; title: string; sub: string; emoji: string }[] = [
  { id: 'fat_loss', title: 'Lose fat', sub: 'Lean down sustainably', emoji: '🔥' },
  { id: 'muscle_gain', title: 'Build muscle', sub: 'Add strength and size', emoji: '💪' },
  { id: 'maintenance', title: 'Stay healthy', sub: 'Maintain and feel great', emoji: '🌱' },
  { id: 'athletic_performance', title: 'Train for performance', sub: 'Hit peaks in your sport', emoji: '🏃' },
];

const HEALTH_OPTIONS = ['Asthma', 'Diabetes', 'Heart condition', 'Injuries', 'None'];
const DIET_OPTIONS = ['Vegan', 'Vegetarian', 'Keto', 'Paleo', 'Gluten free', 'High protein', 'None'];

const TOTAL_STEPS = 8;

type PermState = 'idle' | 'granted' | 'denied' | 'requesting';

export const Onboarding: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    age: '',
    weight: '',
    goalWeight: '',
    height: '',
    goal: 'muscle_gain' as Goal,
    healthConditions: [] as string[],
    dietaryPreferences: [] as string[],
  });
  const [loading, setLoading] = useState(false);
  const [camPerm, setCamPerm] = useState<PermState>('idle');
  const [micPerm, setMicPerm] = useState<PermState>('idle');
  const [notifPerm, setNotifPerm] = useState<PermState>(
    typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted'
    : typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied'
    : 'idle',
  );

  const [allRunning, setAllRunning] = useState(false);

  const requestCamera = async () => {
    setCamPerm('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      stream.getTracks().forEach(t => t.stop());
      setCamPerm('granted');
    } catch {
      setCamPerm('denied');
    }
  };
  const requestMic = async () => {
    setMicPerm('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicPerm('granted');
    } catch {
      setMicPerm('denied');
    }
  };
  const requestNotif = async () => {
    setNotifPerm('requesting');
    setNotifPerm(await requestPushPermission(user?.uid));
  };
  // Mic is web-only: the Android WebView has no Web Speech API for the Coach.
  const withMic = micSupported();
  const allowEverything = async () => {
    if (allRunning) return;
    setAllRunning(true);
    if (camPerm !== 'granted') await requestCamera();
    if (withMic && micPerm !== 'granted') await requestMic();
    if (notifPerm !== 'granted') await requestNotif();
    setAllRunning(false);
  };

  const handleUpdate = async () => {
    if (!user) return;
    if (!formData.age || !formData.weight || !formData.height) {
      showToast('Please fill age, weight, and height to continue', 'error');
      return;
    }
    setLoading(true);
    const userRef = doc(db, 'users', user.uid);

    // Core profile that matches the existing Firestore rule allowlist.
    const corePayload: Record<string, any> = {
      age: parseInt(formData.age),
      weight: parseFloat(formData.weight),
      height: parseFloat(formData.height),
      goal: formData.goal,
      healthConditions: formData.healthConditions.length > 0 ? formData.healthConditions : ['None'],
      dietaryPreferences: formData.dietaryPreferences.length > 0 ? formData.dietaryPreferences : ['None'],
      points: 100,
      // 100 starter XP = Level 2 on the shared curve (see missionUtils) — the
      // classic instant early win. Kept in sync via computeLevel, not hardcoded math.
      level: computeLevel(100).level,
      badges: ['pioneer'],
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(userRef, corePayload);

      // Try to persist goalWeight in a separate write so newer rules can accept it
      // without blocking onboarding when older rules are still deployed.
      if (formData.goalWeight) {
        try {
          await updateDoc(userRef, {
            goalWeight: parseFloat(formData.goalWeight),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // ignore: older Firestore rules don't list goalWeight yet
        }
      }

      try {
        await addDoc(collection(db, 'weight_history'), {
          userId: user.uid,
          weight: parseFloat(formData.weight),
          timestamp: serverTimestamp(),
        });
      } catch (e) { console.warn('Weight history skipped:', e); }

      try {
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          title: 'Welcome to FitFlow',
          body: 'You earned 100 XP and the Pioneer badge. Time to train.',
          timestamp: serverTimestamp(),
        });
      } catch (e) { console.warn('Welcome notif skipped:', e); }

      showToast('Profile saved');
      navigate('/', { replace: true });
    } catch (error: any) {
      console.error('Onboarding save failed:', error);
      const msg = error?.code === 'permission-denied'
        ? "Couldn't save (permissions). Update Firestore rules and try again."
        : 'Could not save profile. Check your connection and try again.';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: 'healthConditions' | 'dietaryPreferences', val: string) =>
    setFormData(prev => ({
      ...prev,
      [key]: prev[key].includes(val) ? prev[key].filter(v => v !== val) : [...prev[key], val],
    }));

  const canContinue =
    (step === 1 && !!formData.age) ||
    (step === 2 && !!formData.weight) ||
    (step === 3 && !!formData.height) ||
    step === 4 ||
    step === 5 ||
    step === 6 ||
    step === 7 ||
    step === 8;

  return (
    <div className="min-h-screen bg-bg flex flex-col px-6 py-10 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-accent/6 blur-[140px] rounded-full pointer-events-none" />

      <div className="flex items-center justify-between mb-8 relative z-10">
        <LogoMark size={32} />
        <span className="num text-xs text-text-dim font-medium">
          {step} / {TOTAL_STEPS}
        </span>
      </div>

      <div className="h-1 bg-white/[0.05] rounded-full mb-10 overflow-hidden relative z-10">
        <motion.div
          className="h-full bg-gradient-to-r from-accent-soft to-accent rounded-full"
          animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        />
      </div>

      <div className="flex-1 relative z-10">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <Step key="1" icon={<Calendar size={20} />} eyebrow="About you" title="How old are you?" subtitle="So we can set the right intensity and calorie targets.">
              <NumberInput suffix="years" value={formData.age} onChange={v => setFormData({ ...formData, age: v })} placeholder="28" />
            </Step>
          )}
          {step === 2 && (
            <Step key="2" icon={<Weight size={20} />} eyebrow="Body" title="Your current weight" subtitle="We'll track this over time to keep your plan adaptive.">
              <NumberInput suffix="kg" value={formData.weight} onChange={v => setFormData({ ...formData, weight: v })} placeholder="72" />
            </Step>
          )}
          {step === 3 && (
            <Step key="3" icon={<Ruler size={20} />} eyebrow="Body" title="And your height?" subtitle="Used for BMR and macro calculations.">
              <NumberInput suffix="cm" value={formData.height} onChange={v => setFormData({ ...formData, height: v })} placeholder="178" />
            </Step>
          )}
          {step === 4 && (
            <Step key="4" icon={<Target size={20} />} eyebrow="Goal" title="What are you training for?" subtitle="Pick one. You can change this anytime.">
              <div className="grid grid-cols-1 gap-3 mt-2">
                {GOAL_OPTIONS.map(g => {
                  const active = formData.goal === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setFormData({ ...formData, goal: g.id })}
                      className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                        active
                          ? 'bg-accent/10 border-accent/40 ring-accent-glow'
                          : 'bg-surface border-white/[0.06] hover:border-white/15'
                      }`}
                    >
                      <span className="text-2xl">{g.emoji}</span>
                      <div className="flex-1">
                        <div className={`font-semibold ${active ? 'text-accent' : 'text-white'}`}>{g.title}</div>
                        <div className="text-xs text-text-dim mt-0.5">{g.sub}</div>
                      </div>
                      {active && <span className="w-2 h-2 bg-accent rounded-full shadow-[0_0_10px_var(--accent)]" />}
                    </button>
                  );
                })}
              </div>
            </Step>
          )}
          {step === 5 && (
            <Step key="5" icon={<HeartPulse size={20} />} eyebrow="Safety" title="Any health conditions?" subtitle="We'll adjust intensity and avoid contraindicated movements.">
              <ChipGrid options={HEALTH_OPTIONS} values={formData.healthConditions} onToggle={v => toggle('healthConditions', v)} />
            </Step>
          )}
          {step === 6 && (
            <Step key="6" icon={<Salad size={20} />} eyebrow="Nutrition" title="Any dietary preferences?" subtitle="Your meal plans will respect these.">
              <ChipGrid options={DIET_OPTIONS} values={formData.dietaryPreferences} onToggle={v => toggle('dietaryPreferences', v)} />
            </Step>
          )}
          {step === 7 && (
            <Step key="7" icon={<Target size={20} />} eyebrow="Target" title="Your goal weight" subtitle="Optional — we'll plot your trajectory and adjust calories as you progress.">
              <NumberInput suffix="kg" value={formData.goalWeight} onChange={v => setFormData({ ...formData, goalWeight: v })} placeholder={formData.weight || '70'} />
            </Step>
          )}
          {step === 8 && (
            <Step key="8" icon={<Sparkles size={20} />} eyebrow="One tap" title="Unlock the full FitFlow" subtitle={withMic
              ? 'Allow camera, mic, and notifications in one go. Your browser will pop a prompt for each — tap Allow.'
              : 'Allow camera and notifications in one go. Android will pop a prompt for each — tap Allow.'}>
              <div className="space-y-3 mt-2">
                <button
                  onClick={allowEverything}
                  disabled={allRunning}
                  className="btn-3d w-full h-14 disabled:opacity-70"
                >
                  {allRunning ? (
                    <><Loader2 className="animate-spin" size={16} /> Requesting…</>
                  ) : (
                    <><Sparkles size={16} /> Allow everything</>
                  )}
                </button>

                <PermRow
                  icon={<Camera size={18} />}
                  title="Camera"
                  desc="Barcode scanner, meal photo log, AI form check"
                  state={camPerm}
                  onRequest={requestCamera}
                />
                {withMic && (
                  <PermRow
                    icon={<Mic size={18} />}
                    title="Microphone"
                    desc="Voice questions to the AI Coach, hands-free logging"
                    state={micPerm}
                    onRequest={requestMic}
                  />
                )}
                <PermRow
                  icon={<Bell size={18} />}
                  title="Notifications"
                  desc="Smart workout reminders, hydration nudges, weekly recap"
                  state={notifPerm}
                  onRequest={requestNotif}
                />
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-surface border border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim">
                    <ImageIcon size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">Photos</p>
                    <p className="text-xs text-text-dim mt-0.5">No prompt needed — the upload picker only sees the photo you choose, never your full library.</p>
                  </div>
                  <Check size={16} className="text-accent mt-1" />
                </div>
                {(camPerm === 'denied' || (withMic && micPerm === 'denied') || notifPerm === 'denied') && (
                  <p className="text-xs text-accent-3 leading-snug px-1">
                    {withMic
                      ? 'Denied one by accident? Tap the site lock icon in the address bar, set the permission to Allow, then reload.'
                      : 'Denied one by accident? Open system Settings → Apps → FitFlow to allow it, or continue — you can enable it later in Settings.'}
                  </p>
                )}
                <p className="text-xs text-text-mute text-center pt-1">All optional — you can skip and start training right away.</p>
              </div>
            </Step>
          )}
        </AnimatePresence>
      </div>

      <div className="pt-6 flex gap-3 relative z-10">
        {step > 1 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="btn-ghost h-14 px-6"
          >
            Back
          </button>
        )}
        <button
          onClick={() => (step < TOTAL_STEPS ? setStep(s => s + 1) : handleUpdate())}
          disabled={loading || !canContinue}
          className="btn-3d h-14 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>{step < TOTAL_STEPS ? 'Continue' : loading ? 'Setting up...' : 'Start training'}</span>
          {step < TOTAL_STEPS && <ChevronRight size={18} strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
};

const Step: React.FC<{ icon: React.ReactNode; eyebrow: string; title: string; subtitle: string; children: React.ReactNode }> = ({ icon, eyebrow, title, subtitle, children }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -16 }}
    transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    className="space-y-6"
  >
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-accent/12 border border-accent/25 text-accent flex items-center justify-center">{icon}</div>
      <span className="text-eyebrow text-accent">{eyebrow}</span>
    </div>
    <div className="space-y-2">
      <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight">{title}</h1>
      <p className="text-text-dim text-sm leading-relaxed">{subtitle}</p>
    </div>
    {children}
  </motion.div>
);

const NumberInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; suffix: string }> = ({ value, onChange, placeholder, suffix }) => (
  <div className="relative">
    <input
      type="number"
      placeholder={placeholder}
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-16 glass px-6 pr-20 num text-3xl font-semibold text-white focus:outline-none focus:border-accent/40 transition-colors"
    />
    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-text-dim text-sm font-medium">{suffix}</span>
  </div>
);

const PermRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
  state: PermState;
  onRequest: () => void;
}> = ({ icon, title, desc, state, onRequest }) => {
  const isGranted = state === 'granted';
  const isDenied = state === 'denied';
  return (
    <button
      onClick={onRequest}
      className={`w-full flex items-start gap-3 p-4 rounded-2xl border text-left transition-all ${
        isGranted
          ? 'bg-accent/10 border-accent/40'
          : isDenied
            ? 'bg-accent-2/8 border-accent-2/30'
            : 'bg-surface border-white/[0.06] hover:border-white/15'
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        isGranted ? 'bg-accent/15 text-accent'
        : isDenied ? 'bg-accent-2/15 text-accent-2'
        : 'bg-white/[0.04] text-text-dim'
      }`}>
        {icon}
      </div>
      <div className="flex-1">
        <p className={`font-medium text-sm ${isGranted ? 'text-accent' : isDenied ? 'text-accent-2' : 'text-white'}`}>{title}</p>
        <p className="text-xs text-text-dim mt-0.5 leading-snug">{desc}</p>
      </div>
      <div className="mt-1 shrink-0">
        {isGranted ? <Check size={16} className="text-accent" />
          : state === 'requesting' ? <Loader2 size={16} className="text-accent animate-spin" />
          : isDenied ? <XIcon size={16} className="text-accent-2" />
          : <span className="text-xs text-accent font-semibold">Allow</span>}
      </div>
    </button>
  );
};

const ChipGrid: React.FC<{ options: string[]; values: string[]; onToggle: (v: string) => void }> = ({ options, values, onToggle }) => (
  <div className="flex flex-wrap gap-2 mt-2">
    {options.map(o => {
      const active = values.includes(o);
      return (
        <button
          key={o}
          onClick={() => onToggle(o)}
          className={`px-4 h-11 rounded-full border text-sm font-medium transition-all ${
            active
              ? 'bg-accent text-bg border-accent'
              : 'bg-surface text-white border-white/10 hover:border-white/25'
          }`}
        >
          {o}
        </button>
      );
    })}
  </div>
);
