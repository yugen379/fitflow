import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  Settings, LogOut, Crown, ChevronRight, Weight, Activity, User as UserIcon,
  LineChart as LineChartIcon, Plus, Loader2, Zap, Volume2, VolumeX, TrendingUp, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorkoutHistory } from '../components/WorkoutHistory';
import { StreakHeatmap } from '../components/StreakHeatmap';
import { Avatar } from '../components/Avatar';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { logWeight } from '../services/dataService';
import { query, collection, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { ALL_BADGES } from '../services/badgeService';
import { db } from '../lib/firebase';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '../hooks/useToast';
import { isHealthAvailable, connectAndPersist, DailyHealthMetrics } from '../services/healthService';
import { Capacitor } from '@capacitor/core';
import { allFeaturesFree, getEntitlement } from '../lib/billing';
import { purchaseUiAllowed } from '../services/playBillingService';

const ACCENT = '#C6FF3D';

const goalLabel = (g?: string) => {
  switch (g) {
    case 'fat_loss': return 'Losing fat';
    case 'muscle_gain': return 'Building muscle';
    case 'maintenance': return 'Maintaining';
    case 'athletic_performance': return 'Performance';
    default: return 'Goal not set';
  }
};

export const Profile: React.FC = () => {
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [weightHistory, setWeightHistory] = useState<any[]>([]);
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newBodyFat, setNewBodyFat] = useState('');
  const [newMuscleMass, setNewMuscleMass] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [healthMetrics, setHealthMetrics] = useState<DailyHealthMetrics | null>(null);
  const [healthAvailable, setHealthAvailable] = useState<{ available: boolean; source: DailyHealthMetrics['source'] } | null>(null);
  const [healthSyncing, setHealthSyncing] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  const nativeHealthLabel = Capacitor.getPlatform() === 'ios' ? 'Apple Health' : 'Health Connect';

  useEffect(() => { isHealthAvailable().then(setHealthAvailable); }, []);

  const handleConnectNativeHealth = async () => {
    if (!profile?.uid) return;
    setHealthSyncing(true);
    try {
      const metrics = await connectAndPersist(profile.uid);
      if (metrics) {
        setHealthMetrics(metrics);
        showToast(`${nativeHealthLabel} connected`);
      } else {
        showToast('Permission denied', 'error');
      }
    } catch {
      showToast('Connection failed', 'error');
    } finally {
      setHealthSyncing(false);
    }
  };

  const calculateBMI = (weight: number, height: number) => {
    if (!weight || !height) return null;
    const h = height / 100;
    return (weight / (h * h)).toFixed(1);
  };

  useEffect(() => {
    if (!profile?.uid) return;
    const q = query(
      collection(db, 'weight_history'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'asc'),
      limit(30),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => {
        const d = doc.data();
        return {
          ...d,
          date: d.timestamp?.toDate?.().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        };
      });
      setWeightHistory(data);
    }, (err) => {
      // Snapshot errors are usually transient (network blips, rule warmups) — log and stay
      // silent rather than nagging the customer with a red toast.
      console.warn('weight_history snapshot error:', err?.code || err?.message);
    });
    return () => unsubscribe();
  }, [profile?.uid]);

  const handleLogWeight = async () => {
    if (!profile?.uid || !newWeight) return;
    setIsSyncing(true);
    try {
      await logWeight(profile.uid, parseFloat(newWeight));
      await addDoc(collection(db, 'body_metrics'), {
        userId: profile.uid,
        weight: parseFloat(newWeight),
        bodyFat: newBodyFat ? parseFloat(newBodyFat) : null,
        muscleMass: newMuscleMass ? parseFloat(newMuscleMass) : null,
        timestamp: serverTimestamp(),
      });
      showToast('Logged');
      setIsLoggingWeight(false);
      setNewWeight(''); setNewBodyFat(''); setNewMuscleMass('');
    } catch {
      showToast('Failed to log', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: '', age: '', weight: '', height: '', goal: '',
    voiceSpeed: 'normal', preferredWorkoutTime: '08:00',
  });

  useEffect(() => {
    if (profile) {
      setProfileData({
        displayName: profile.displayName || '',
        age: profile.age?.toString() || '',
        weight: profile.weight?.toString() || '',
        height: profile.height?.toString() || '',
        goal: profile.goal || '',
        voiceSpeed: profile.voiceSpeed || 'normal',
        preferredWorkoutTime: profile.preferredWorkoutTime || '08:00',
      });
    }
  }, [profile]);

  const handleUpdateProfile = async () => {
    if (!profile?.uid) return;
    setIsSyncing(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: profileData.displayName,
        age: profileData.age ? parseInt(profileData.age) : null,
        weight: profileData.weight ? parseFloat(profileData.weight) : null,
        height: profileData.height ? parseFloat(profileData.height) : null,
        goal: profileData.goal,
        voiceSpeed: profileData.voiceSpeed,
        preferredWorkoutTime: profileData.preferredWorkoutTime,
        updatedAt: serverTimestamp(),
      });
      showToast('Saved');
      setIsEditingProfile(false);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleVoiceCoaching = async () => {
    if (!profile?.uid) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        voiceCoachingEnabled: !profile.voiceCoachingEnabled,
      });
      showToast(`Voice coaching ${!profile.voiceCoachingEnabled ? 'on' : 'off'}`);
    } catch {
      showToast('Toggle failed', 'error');
    }
  };

  const ent = getEntitlement(profile);
  // Crown badge appears for anyone with active Pro access (trial or paid).
  const isPremium = ent.isPro;

  return (
    <div className="pb-28 pt-4 px-4 space-y-5">
      {/* Header */}
      <div className="glass p-5 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent-soft to-accent p-[2px]">
              <div className="w-full h-full rounded-full bg-bg overflow-hidden flex items-center justify-center">
                <Avatar src={profile?.photoURL} name={profile?.displayName} size={60} />
              </div>
            </div>
            {isPremium && (
              <div className="absolute -bottom-1 -right-1 bg-accent rounded-full p-1 text-bg border-2 border-bg">
                <Crown size={12} />
              </div>
            )}
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">
              {profile?.displayName?.split(' ')[0] || 'Athlete'}
            </h1>
            <p className="text-sm text-text-dim mt-0.5">{goalLabel(profile?.goal)}</p>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="text-accent font-semibold num">Lv <AnimatedNumber value={profile?.level || 1} duration={600} /></span>
              <span className="text-text-dim num"><AnimatedNumber value={profile?.points || 0} duration={1200} /> XP</span>
              <span className="text-text-dim num">🔥 <AnimatedNumber value={profile?.streak || 0} duration={800} /></span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsEditingProfile(true)}
          className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white transition-colors"
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* Premium banner — hidden while every feature is free (launch mode) */}
      {!isPremium && !allFeaturesFree() && (
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/pro')}
          className="w-full rounded-2xl p-5 relative overflow-hidden text-left"
          style={{
            background: 'linear-gradient(135deg, #C6FF3D 0%, #9CFF1F 100%)',
            boxShadow: '0 14px 40px -10px rgba(198,255,61,0.5)',
          }}
        >
          <div className="relative z-10">
            <span className="text-eyebrow text-bg/80">FitFlow Pro</span>
            <h3 className="font-display text-xl font-bold text-bg mt-1">Unlock the full coach.</h3>
            <p className="text-bg/80 text-sm mt-1 max-w-[80%]">
              AI form check, voice coaching, advanced analytics, unlimited meal plans.
            </p>
            <span className="inline-flex mt-3 px-4 py-2 bg-bg text-white rounded-xl text-sm font-semibold">
              {!purchaseUiAllowed() ? 'About FitFlow Pro'
                : ent.status === 'expired' ? 'Subscribe to FitFlow Pro' : 'See Pro plans'}
            </span>
          </div>
          <Crown className="absolute right-2 bottom-2 w-28 h-28 text-bg/10" />
        </motion.button>
      )}

      {/* Subscribed confirmation — entitlement lives on the account (user doc),
          so signing in with the same Google account anywhere shows this. */}
      {!allFeaturesFree() && ent.source === 'paid' && (
        <button onClick={() => navigate('/pro')} className="w-full glass p-4 flex items-center gap-3 text-left">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <Crown size={16} />
          </div>
          <div className="flex-1">
            <p className="text-eyebrow text-accent">FitFlow Pro</p>
            <p className="text-white text-sm font-medium mt-0.5">
              Subscribed · {ent.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan
            </p>
          </div>
          <span className="text-xs text-text-dim">Manage</span>
        </button>
      )}

      {/* Weight chart */}
      <div className="glass p-5 space-y-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-display text-lg font-bold text-white tracking-tight">Progress</h2>
            <p className="text-xs text-text-dim mt-0.5">Weight over the last 30 logs</p>
          </div>
          <button
            onClick={() => setIsLoggingWeight(true)}
            className="w-10 h-10 bg-accent/12 border border-accent/25 text-accent rounded-xl flex items-center justify-center"
            aria-label="Log weight"
          >
            <Plus size={18} />
          </button>
        </div>

        {weightHistory.length > 1 ? (
          <div className="h-48 w-full -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weightHistory} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#4B5260" fontSize={10} tickLine={false} axisLine={false} dy={6} />
                <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0E1014', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }}
                  itemStyle={{ color: ACCENT, fontWeight: 600 }}
                  labelStyle={{ color: '#8B92A3', fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke={ACCENT}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#fff', stroke: ACCENT, strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 w-full flex items-center justify-center border border-dashed border-white/[0.08] rounded-2xl">
            <div className="text-center space-y-2 px-6">
              <LineChartIcon className="mx-auto text-text-dim" size={22} />
              <p className="text-sm text-text-dim leading-snug">
                {weightHistory.length === 1 ? 'One more log unlocks your progress chart.' : 'Log your weight to start tracking progress.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Weight} label="Weight" value={profile?.weight?.toString() || '–'} unit="kg" />
        <StatCard icon={Activity} label="Body fat" value={profile?.latestBodyFat?.toString() || '–'} unit="%" />
        <StatCard icon={TrendingUp} label="Muscle mass" value={profile?.latestMuscleMass?.toString() || '–'} unit="kg" />
        <StatCard icon={Zap} label="BMI" value={profile?.weight && profile?.height ? calculateBMI(profile.weight, profile.height) || '–' : '–'} unit="" />
      </div>

      {/* Preferences */}
      <div className="glass p-5 space-y-4">
        <h2 className="font-display text-lg font-bold text-white tracking-tight">Preferences</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile?.voiceCoachingEnabled ? <Volume2 className="text-accent" size={18} /> : <VolumeX className="text-text-dim" size={18} />}
            <div>
              <p className="text-white font-medium text-sm">Voice coaching</p>
              <p className="text-xs text-text-dim">Real-time cues during workouts</p>
            </div>
          </div>
          <Toggle on={!!profile?.voiceCoachingEnabled} onChange={toggleVoiceCoaching} />
        </div>
      </div>

      {/* Streak heatmap */}
      <div className="glass p-5">
        <StreakHeatmap />
      </div>

      {/* Recent workouts */}
      <div className="space-y-3">
        <div className="flex justify-between items-end px-1">
          <h2 className="font-display text-lg font-bold text-white tracking-tight">Recent workouts</h2>
        </div>
        <WorkoutHistory limitCount={10} />
      </div>

      {/* Achievements */}
      <div className="glass p-5 space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="font-display text-lg font-bold text-white tracking-tight">Achievements</h2>
          <span className="text-xs text-text-dim num">
            {profile?.badges?.length || 0} / {ALL_BADGES.length}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ALL_BADGES.map((badge) => {
            const isEarned = profile?.badges?.includes(badge.id);
            return (
              <div key={badge.id} className="flex flex-col items-center gap-2">
                <div className={cn(
                  'w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all',
                  isEarned
                    ? 'bg-accent/12 border border-accent/30 text-accent shadow-[0_0_24px_rgba(198,255,61,0.18)]'
                    : 'bg-surface border border-white/[0.06] grayscale opacity-30',
                )}>
                  {badge.icon}
                </div>
                <p className={cn(
                  'text-[10px] text-center leading-tight font-medium',
                  isEarned ? 'text-white' : 'text-text-mute',
                )}>{badge.name}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Wearables */}
      <div className="glass p-5 space-y-3">
        <div className="flex justify-between items-end">
          <h2 className="font-display text-lg font-bold text-white tracking-tight">Connected devices</h2>
          {(profile?.googleFitConnected || (profile as any)?.healthConnectConnected || (profile as any)?.healthKitConnected) && (
            <span className="text-eyebrow text-accent">Live</span>
          )}
        </div>

        {isNative && healthAvailable?.available && (
          <div className="flex items-center justify-between p-3 bg-surface rounded-xl border border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/12 border border-accent/25 flex items-center justify-center">
                <Activity size={16} className="text-accent" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">{nativeHealthLabel}</p>
                <p className="text-xs text-text-dim">
                  {healthMetrics
                    ? `${healthMetrics.steps.toLocaleString()} steps · ${healthMetrics.caloriesBurned} kcal today`
                    : 'Steps · heart rate · sleep · workouts'}
                </p>
              </div>
            </div>
            {((profile as any)?.healthConnectConnected || (profile as any)?.healthKitConnected) ? (
              <button
                onClick={handleConnectNativeHealth}
                disabled={healthSyncing}
                className="text-xs font-semibold text-accent border border-accent/30 px-3 py-1.5 rounded-lg hover:bg-accent/8 transition-colors disabled:opacity-50"
              >
                {healthSyncing ? <Loader2 className="animate-spin" size={12} /> : 'Sync now'}
              </button>
            ) : (
              <button
                onClick={handleConnectNativeHealth}
                disabled={healthSyncing}
                className="text-xs font-semibold text-white border border-white/15 px-3 py-1.5 rounded-lg hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-50"
              >
                {healthSyncing ? <Loader2 className="animate-spin" size={12} /> : 'Connect'}
              </button>
            )}
          </div>
        )}

        {!isNative && (
          <div className="p-3 bg-surface rounded-xl border border-white/[0.06]">
            <p className="text-xs text-text-dim leading-relaxed">
              Install the FitFlow Android app to sync steps, heart rate, sleep, and workouts from Health Connect.
            </p>
          </div>
        )}
      </div>

      {/* Menu */}
      <div className="space-y-2">
        <ProfileMenuItem icon={UserIcon} label="Account info" onClick={() => setIsEditingProfile(true)} />
        <ProfileMenuItem icon={Settings} label="Settings" onClick={() => navigate('/settings')} />
        <ProfileMenuItem icon={LogOut} label="Sign out" danger onClick={signOut} />
      </div>

      {/* Edit profile modal */}
      <AnimatePresence>
        {isEditingProfile && (
          <Modal onClose={() => setIsEditingProfile(false)} title="Account info">
            <div className="space-y-4">
              <Field label="Name">
                <input
                  className="modal-input"
                  value={profileData.displayName}
                  onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Age">
                  <input
                    type="number"
                    className="modal-input"
                    value={profileData.age}
                    onChange={(e) => setProfileData({ ...profileData, age: e.target.value })}
                  />
                </Field>
                <Field label="Daily reminder">
                  <input
                    type="time"
                    className="modal-input"
                    value={profileData.preferredWorkoutTime}
                    onChange={(e) => setProfileData({ ...profileData, preferredWorkoutTime: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Voice pace">
                <select
                  className="modal-input appearance-none"
                  value={profileData.voiceSpeed}
                  onChange={(e) => setProfileData({ ...profileData, voiceSpeed: e.target.value as 'normal' | 'slow' })}
                >
                  <option value="normal">Normal</option>
                  <option value="slow">Slow & steady</option>
                </select>
              </Field>
            </div>
            <button
              onClick={handleUpdateProfile}
              disabled={isSyncing}
              className="btn-3d w-full h-12 mt-6 disabled:opacity-50"
            >
              {isSyncing ? <Loader2 className="animate-spin" size={16} /> : 'Save changes'}
            </button>
          </Modal>
        )}
      </AnimatePresence>

      {/* Log weight modal */}
      <AnimatePresence>
        {isLoggingWeight && (
          <Modal onClose={() => setIsLoggingWeight(false)} title="Log body metrics" size="sm">
            <div className="space-y-3">
              <Field label="Weight (kg)">
                <input
                  type="number"
                  placeholder="75.0"
                  className="modal-input"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                />
              </Field>
              <Field label="Body fat % (optional)">
                <input
                  type="number"
                  placeholder="12.5"
                  className="modal-input"
                  value={newBodyFat}
                  onChange={(e) => setNewBodyFat(e.target.value)}
                />
              </Field>
              <Field label="Muscle mass (kg) (optional)">
                <input
                  type="number"
                  placeholder="35.0"
                  className="modal-input"
                  value={newMuscleMass}
                  onChange={(e) => setNewMuscleMass(e.target.value)}
                />
              </Field>
            </div>
            <button
              onClick={handleLogWeight}
              disabled={isSyncing || !newWeight}
              className="btn-3d w-full h-12 mt-6 disabled:opacity-50"
            >
              {isSyncing ? <Loader2 className="animate-spin" size={16} /> : 'Log metrics'}
            </button>
          </Modal>
        )}
      </AnimatePresence>

      <style>{`
        .modal-input {
          width: 100%;
          height: 3rem;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0.75rem;
          padding: 0 1rem;
          color: white;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .modal-input:focus { border-color: rgba(198,255,61,0.4); }
      `}</style>
    </div>
  );
};

const StatCard: React.FC<{ icon: any; label: string; value: string; unit: string }> = ({ icon: Icon, label, value, unit }) => (
  <div className="glass p-4">
    <div className="flex items-center gap-2 text-text-dim">
      <Icon size={14} />
      <span className="text-xs font-medium">{label}</span>
    </div>
    <div className="flex items-baseline gap-1 mt-2">
      <span className="font-display text-2xl font-bold text-white num tracking-tight">{value}</span>
      {unit && <span className="text-sm text-text-dim">{unit}</span>}
    </div>
  </div>
);

const ProfileMenuItem: React.FC<{ icon: any; label: string; danger?: boolean; onClick?: () => void }> = ({ icon: Icon, label, danger, onClick }) => (
  <button
    onClick={onClick}
    className="w-full h-14 px-4 flex items-center justify-between glass group transition-colors hover:bg-white/[0.02]"
  >
    <div className="flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', danger ? 'bg-red-500/10 text-red-400' : 'bg-white/[0.04] text-white/80')}>
        <Icon size={16} />
      </div>
      <span className={cn('font-medium text-sm', danger ? 'text-red-400' : 'text-white')}>{label}</span>
    </div>
    <ChevronRight className="text-text-dim group-hover:text-white transition-colors" size={18} />
  </button>
);

const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button
    onClick={onChange}
    className={cn(
      'w-11 h-6 rounded-full transition-all relative px-0.5 flex items-center',
      on ? 'bg-accent' : 'bg-white/[0.08]',
    )}
    role="switch"
    aria-checked={on}
  >
    <div className={cn(
      'w-5 h-5 rounded-full bg-white transition-transform',
      on ? 'translate-x-5' : 'translate-x-0',
    )} />
  </button>
);

const Modal: React.FC<{ onClose: () => void; title: string; size?: 'sm' | 'md'; children: React.ReactNode }> = ({ onClose, title, size = 'md', children }) => (
  <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/70 backdrop-blur-md"
      onClick={onClose}
    />
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className={cn(
        'relative bg-surface border border-white/[0.06] w-full rounded-t-3xl sm:rounded-3xl p-6 max-h-[85vh] overflow-y-auto',
        size === 'sm' ? 'max-w-sm' : 'max-w-md',
      )}
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-display text-2xl font-bold text-white tracking-tight">{title}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim hover:text-white" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {children}
    </motion.div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs text-text-dim font-medium ml-1">{label}</label>
    {children}
  </div>
);
