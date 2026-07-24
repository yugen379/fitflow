import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { query, collection, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, limit, orderBy } from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { Zap, Bell, X, WifiOff, Volume2, Calendar } from 'lucide-react';
import { Logo } from '../components/Logo';
import { checkAndAwardBadge } from '../services/badgeService';
import { useTodayActivity } from '../hooks/useTodayActivity';
import { scheduleReminders, getDaysSinceLastWorkout } from '../services/notificationService';
import { CoachBriefingCard } from '../components/CoachBriefingCard';
import { recordActiveDay } from '../services/analyticsService';
import { WeeklyRecap } from '../components/WeeklyRecap';
import { PermissionsPrompt } from '../components/PermissionsPrompt';
import { DailyHabits } from '../components/DailyHabits';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { TiltCard } from '../components/TiltCard';
import { AnimatedMesh } from '../components/AnimatedMesh';
import { celebrateSmall } from '../lib/celebrate';
import { haptic } from '../lib/haptics';
import { DailyChallenge } from '../components/DailyChallenge';
import { TrialBanner } from '../components/TrialBanner';
import { TodayMission } from '../components/TodayMission';
import { XPBar } from '../components/XPBar';
import { buildMission, MissionTask } from '../services/missionUtils';
import { Sparkles as SparklesIcon } from 'lucide-react';

export const Home: React.FC = () => {
  const { profile } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [water, setWater] = useState(0);
  const [sleep, setSleep] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [permsOpen, setPermsOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [daysSinceWorkout, setDaysSinceWorkout] = useState<number | null>(null);
  const navigate = useNavigate();
  // Steps / distance / calories from Health Connect — auto-refreshes on app
  // resume and on an interval; the OS counts steps in the background for us.
  const { metrics: activity, status: activityStatus, connect: connectActivity } = useTodayActivity(
    profile?.uid, (profile as any)?.height,
  );

  useEffect(() => {
    if (!profile?.uid) return;
    scheduleReminders(profile.uid, profile.preferredWorkoutTime);
    recordActiveDay(profile.uid);   // retention instrumentation (#4)
  }, [profile?.uid, profile?.preferredWorkoutTime]);

  // First-launch permissions prompt — single-tap "Allow everything" flow so the
  // user never has to dig through browser settings to enable camera/mic/push.
  useEffect(() => {
    if (!profile?.uid) return;
    const key = `ff_perms_prompted_${profile.uid}`;
    if (localStorage.getItem(key)) return;
    // Don't auto-pop if all three are already granted; just mark as seen.
    const camOk = navigator.permissions
      ? navigator.permissions.query({ name: 'camera' as any }).then(r => r.state === 'granted').catch(() => false)
      : Promise.resolve(false);
    Promise.resolve(camOk).then(ok => {
      const notifOk = typeof Notification !== 'undefined' && Notification.permission === 'granted';
      if (ok && notifOk) {
        localStorage.setItem(key, '1');
        return;
      }
      // Slight delay so the prompt doesn't slam onto an unmounted-feeling home screen.
      const t = setTimeout(() => setPermsOpen(true), 800);
      return () => clearTimeout(t);
    });
  }, [profile?.uid]);

  const closePermsPrompt = () => {
    if (profile?.uid) localStorage.setItem(`ff_perms_prompted_${profile.uid}`, '1');
    setPermsOpen(false);
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!profile?.uid) return;

    const notifQ = query(
      collection(db, 'notifications'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(5)
    );

    const unsubNotifs = onSnapshot(notifQ, (snap) => {
      setNotifications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubNotifs();
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ... existing queries for meals and workouts ...
    const mealsQ = query(
      collection(db, 'meals'), 
      where('userId', '==', profile.uid),
      where('timestamp', '>=', today)
    );
    
    const workoutsQ = query(
      collection(db, 'workouts'),
      where('userId', '==', profile.uid),
      where('timestamp', '>=', today)
    );

    const waterQ = query(
      collection(db, 'water_logs'),
      where('userId', '==', profile.uid),
      where('timestamp', '>=', today)
    );

    const sleepQ = query(
      collection(db, 'sleep_logs'),
      where('userId', '==', profile.uid),
      where('timestamp', '>=', today)
    );

    let meals: any[] = [];
    let workouts: any[] = [];
    let waterLogs: any[] = [];
    let sleepLogs: any[] = [];

    const updateSummary = () => {
      const caloriesConsumed = meals.reduce((acc, m) => acc + m.calories, 0);
      const proteinConsumed = meals.reduce((acc, m) => acc + (m.protein || 0), 0);
      const caloriesBurned = workouts.reduce((acc, w) => acc + (w.caloriesBurned || 0), 0);
      const workoutMinutes = workouts.reduce((acc, w) => acc + (w.duration || 0), 0);
      const currentWater = waterLogs.reduce((acc, w) => acc + w.amount, 0);
      const currentSleep = sleepLogs.reduce((acc, s) => acc + s.hours, 0);
      
      setWater(currentWater);
      setSleep(currentSleep);
      setSummary({
        caloriesConsumed,
        proteinConsumed,
        caloriesBurned,
        workoutMinutes,
        mealCount: meals.length,
        workoutCount: workouts.length
      });
      setLoading(false);
    };

    const unsubMeals = onSnapshot(mealsQ, (snap) => {
      meals = snap.docs.map(doc => doc.data());
      updateSummary();
    });

    const unsubWorkouts = onSnapshot(workoutsQ, (snap) => {
      workouts = snap.docs.map(doc => doc.data());
      updateSummary();
    });

    const unsubWater = onSnapshot(waterQ, (snap) => {
      waterLogs = snap.docs.map(doc => doc.data());
      updateSummary();
    });

    const unsubSleep = onSnapshot(sleepQ, (snap) => {
      sleepLogs = snap.docs.map(doc => doc.data());
      updateSummary();
    });

    return () => {
      unsubMeals();
      unsubWorkouts();
      unsubWater();
      unsubSleep();
    };
  }, [profile?.uid]);

  const [waterPicker, setWaterPicker] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [communityCount, setCommunityCount] = useState<number | null>(null);

  const addWater = async (amount = 250) => {
    if (!profile?.uid) return;
    try {
      celebrateSmall();
      await addDoc(collection(db, 'water_logs'), {
        userId: profile.uid,
        amount,
        timestamp: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', profile.uid), {
        points: (profile.points || 0) + Math.round(amount / 25),
      });
      await checkAndAwardBadge(profile.uid, 'hydration_hero');
    } catch (error) {
      handleFirestoreError(error, 'write', 'water_logs');
    }
  };

  // Days since last workout — feeds the proactive coach's "it's been N days" nudge.
  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    getDaysSinceLastWorkout(profile.uid)
      .then(d => { if (!cancelled) setDaysSinceWorkout(d); })
      .catch(() => { if (!cancelled) setDaysSinceWorkout(null); });
    return () => { cancelled = true; };
  }, [profile?.uid, summary?.workoutCount]);

  // Real community count: how many athletes share the same goal. Falls back to total users.
  useEffect(() => {
    if (!profile?.uid) return;
    const goal = profile.goal;
    const q = goal
      ? query(collection(db, 'users'), where('goal', '==', goal), limit(500))
      : query(collection(db, 'users'), limit(500));
    const unsub = onSnapshot(q,
      (snap) => setCommunityCount(snap.size),
      () => setCommunityCount(null),
    );
    return () => unsub();
  }, [profile?.uid, profile?.goal]);

  // Today's Mission — the deterministic "what should I do RIGHT NOW?" engine.
  const mission = buildMission({
    hour: new Date().getHours(),
    goal: profile?.goal,
    weightKg: profile?.weight,
    caloriesConsumed: summary?.caloriesConsumed || 0,
    mealsLogged: summary?.mealCount || 0,
    workoutsToday: summary?.workoutCount || 0,
    steps: activityStatus === 'connected' && activity ? activity.steps : null,
    streak: profile?.streak || 0,
  });

  // Widget → DIRECT action: rows deep-link straight into the doing, never a menu.
  const onMissionAction = (task: MissionTask) => {
    if (task.action.kind === 'steps-connect') { void connectActivity(); return; }
    navigate(task.action.route);
  };

  return (
    <div className="pb-24 pt-4 px-4 space-y-6 bg-bg overflow-x-hidden relative">
      <AnimatedMesh className="z-0" />
      <div className="relative z-10 space-y-6">
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-center gap-2 bg-accent-2/12 border border-accent-2/25 text-accent-2 py-2 px-3 rounded-xl text-xs font-medium mb-2"
          >
            <WifiOff size={12} />
            <span>You're offline. AI features paused.</span>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex justify-between items-center pt-2 pb-3">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-3"
        >
          <Logo size="sm" showText={false} />
          <div>
            <p className="text-xs text-text-dim font-medium">
              {(() => {
                const h = new Date().getHours();
                return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
              })()}
            </p>
            <h1 className="font-display text-xl font-bold text-white leading-tight tracking-tight">
              {profile?.displayName?.split(' ')[0] || 'Athlete'}
            </h1>
          </div>
        </motion.div>

        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => setShowNotifs(true)}
            className="relative w-11 h-11 flex items-center justify-center glass rounded-2xl text-white transition-colors"
            aria-label="Notifications"
          >
            <Bell size={18} />
            {notifications.length > 0 && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-accent rounded-full ring-2 ring-bg" />
            )}
          </motion.button>
        </div>
      </header>

      <XPBar points={profile?.points} streak={profile?.streak} />

      <TrialBanner />

      <AnimatePresence>
        {showNotifs && (
          <motion.div 
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[100] bg-bg/95 backdrop-blur-3xl px-6 py-12 overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="font-display text-3xl font-bold text-white tracking-tight">Notifications</h2>
              <button onClick={() => setShowNotifs(false)} className="w-11 h-11 glass rounded-2xl flex items-center justify-center text-white active:scale-95 transition-transform" aria-label="Close"><X size={22} /></button>
            </div>
            <div className="space-y-3">
              {notifications.length > 0 ? notifications.map(n => (
                <div key={n.id} className="glass p-5 space-y-2 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="font-semibold text-white text-sm">{n.title}</h4>
                    <span className="text-[10px] text-text-dim font-medium whitespace-nowrap">{n.timestamp?.toDate ? n.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}</span>
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed">{n.body}</p>
                </div>
              )) : (
                <div className="text-center py-24 opacity-50 flex flex-col items-center">
                  <Zap size={40} className="mb-3 text-text-dim" />
                  <p className="text-sm text-text-dim">You're all caught up.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <TodayMission
        mission={mission}
        loading={loading}
        uid={profile?.uid}
        caloriesBurned={summary?.caloriesBurned || 0}
        activeMinutes={summary?.workoutMinutes || 0}
        onAction={onMissionAction}
      />

      <div className="grid grid-cols-2 gap-3">
        {activityStatus === 'connected' && activity ? (
          <div className="col-span-2 glass p-5 flex items-center justify-around">
            <div className="text-center">
              <p className="text-eyebrow text-text-dim">Steps</p>
              <p className="num font-display text-2xl font-bold text-white mt-1">
                <AnimatedNumber value={activity.steps} />
              </p>
            </div>
            <div className="w-px h-10 bg-white/[0.06]" />
            <div className="text-center">
              <p className="text-eyebrow text-text-dim">Distance</p>
              <p className="num font-display text-2xl font-bold text-white mt-1">
                {activity.distanceKm.toFixed(activity.distanceKm >= 10 ? 1 : 2)}
                <span className="text-sm text-text-dim font-medium ml-0.5">km</span>
              </p>
            </div>
            <div className="w-px h-10 bg-white/[0.06]" />
            <div className="text-center">
              <p className="text-eyebrow text-text-dim">Burned</p>
              <p className="num font-display text-2xl font-bold text-white mt-1">
                <AnimatedNumber value={activity.caloriesBurned} />
                <span className="text-sm text-text-dim font-medium ml-0.5">kcal</span>
              </p>
            </div>
          </div>
        ) : activityStatus === 'disconnected' ? (
          <button
            onClick={() => void connectActivity()}
            className="col-span-2 glass p-4 flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center text-accent shrink-0">
              <Zap size={16} />
            </div>
            <div className="flex-1">
              <p className="text-white text-sm font-medium">Track steps, distance &amp; calories automatically</p>
              <p className="text-xs text-text-dim mt-0.5">Connect Health Connect — updates in the background, no logging needed.</p>
            </div>
            <span className="text-eyebrow text-accent shrink-0">Connect →</span>
          </button>
        ) : null}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setWaterPicker(true)}
          className="glass p-4 flex flex-col justify-between h-32 relative overflow-hidden text-left"
        >
          <div className="flex justify-between items-start z-10">
            <div className="w-9 h-9 rounded-xl bg-accent-3/12 border border-accent-3/25 flex items-center justify-center text-base">💧</div>
            <span className="text-eyebrow text-text-dim">Tap to add</span>
          </div>
          <div className="z-10">
            <h3 className="num font-display text-2xl font-bold text-white leading-none">
              <AnimatedNumber value={water} />
              <span className="text-sm text-text-dim font-medium ml-0.5">ml</span>
            </h3>
            <p className="text-xs text-text-dim mt-1">Hydration · <AnimatedNumber value={Math.min(Math.round((water / 3000) * 100), 100)} />%</p>
          </div>
          {/* Animated liquid fill with wave */}
          <motion.div
            initial={false}
            animate={{ height: `${Math.min((water / 3000) * 100, 100)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            className="absolute bottom-0 left-0 w-full bg-accent-3/15 z-0"
          >
            <motion.div
              className="absolute -top-2 left-0 w-full h-3"
              style={{
                background: 'radial-gradient(ellipse at center top, rgba(125,211,252,0.7), transparent 70%)',
                filter: 'blur(2px)',
              }}
              animate={{ x: ['-20%', '20%', '-20%'] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        </motion.button>

        <AnimatePresence>
          {waterPicker && (
            <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setWaterPicker(false)}
              />
              <motion.div
                initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
                transition={{ type: 'spring', damping: 28 }}
                className="relative bg-surface w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 border border-white/[0.06] space-y-5"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-3/12 border border-accent-3/25 flex items-center justify-center text-lg">💧</div>
                  <div>
                    <p className="text-eyebrow text-accent-3">Hydration</p>
                    <p className="text-white font-display text-xl font-bold tracking-tight">{water}<span className="text-base text-text-dim font-medium ml-1">/ 3000 ml</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[100, 250, 500, 750].map(ml => (
                    <button
                      key={ml}
                      onClick={() => { addWater(ml); setWaterPicker(false); }}
                      className="glass p-3 flex flex-col items-center gap-1 hover:border-accent-3/30 transition-colors"
                    >
                      <span className="num font-display text-lg font-bold text-white">{ml}</span>
                      <span className="text-[10px] text-text-dim font-medium">ml</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setWaterPicker(false)} className="btn-ghost h-11 w-full">Cancel</button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/wellness')}
          className="glass p-4 flex flex-col justify-between h-32 relative overflow-hidden text-left"
        >
          <div className="flex justify-between items-start">
            <div className="w-9 h-9 rounded-xl bg-accent-2/12 border border-accent-2/25 flex items-center justify-center text-base">😴</div>
            <span className="text-eyebrow text-text-dim">Log</span>
          </div>
          <div>
            <h3 className="num font-display text-2xl font-bold text-white leading-none">{sleep}<span className="text-sm text-text-dim font-medium ml-0.5">h</span></h3>
            <p className="text-xs text-text-dim mt-1">Sleep last night</p>
          </div>
        </motion.button>
      </div>

      <DailyHabits
        water={water}
        meals={summary?.mealCount || 0}
        workouts={summary?.workoutCount || 0}
        sleep={sleep}
      />

      <DailyChallenge />

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => { haptic('light'); navigate('/coach'); }}
        className="w-full ai-gradient-box rounded-2xl p-4 flex items-center gap-3 text-left relative overflow-hidden"
      >
        <div className="absolute -top-8 -right-8 w-24 h-24 bg-accent/20 blur-2xl rounded-full pointer-events-none" />
        <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center shrink-0 relative">
          <SparklesIcon size={18} className="text-accent" />
        </div>
        <div className="flex-1 relative">
          <p className="text-eyebrow text-accent">AI Coach Chat</p>
          <p className="text-white font-medium text-sm mt-0.5">Ask anything — training, nutrition, recovery</p>
        </div>
        <span className="text-accent text-xl relative">›</span>
      </motion.button>

      <div className="grid grid-cols-2 gap-3 perspective-1000">
        <ActionCard3D icon="🥗" label="Log meal" onClick={() => { haptic('light'); navigate('/track'); }} />
        <ActionCard3D icon="💪" label="Workout" onClick={() => { haptic('light'); navigate('/workout'); }} />
        <ActionCard3D icon="🧘" label="Recovery" onClick={() => { haptic('light'); navigate('/wellness'); }} />
        <ActionCard3D icon="🎯" label="Discover" onClick={() => { haptic('light'); navigate('/explore'); }} />
      </div>

      <CoachBriefingCard
        uid={profile?.uid}
        online={isOnline}
        onWater={() => setWaterPicker(true)}
        ctx={{
          hour: new Date().getHours(),
          goal: profile?.goal,
          weightKg: profile?.weight,
          caloriesConsumed: summary?.caloriesConsumed || 0,
          proteinConsumed: summary?.proteinConsumed || 0,
          waterMl: water,
          trainedToday: (summary?.workoutCount || 0) > 0,
          mealsLogged: summary?.mealCount || 0,
          sleepHours: sleep,
          streak: profile?.streak || 0,
          preferredWorkoutHour: profile?.preferredWorkoutTime
            ? parseInt(profile.preferredWorkoutTime.split(':')[0], 10)
            : null,
          daysSinceLastWorkout: daysSinceWorkout,
        }}
      />

      <section className="space-y-3">
        <div className="flex justify-between items-end">
          <h3 className="font-display text-lg font-bold text-white tracking-tight">Featured workouts</h3>
          <button onClick={() => navigate('/library')} className="text-xs font-semibold text-accent">View all</button>
        </div>
        <div className="flex space-x-4 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
          <HighlightCard 
            title="HIIT Explosions" 
            type="Cardio" 
            img="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&q=80" 
            onClick={() => navigate('/library')}
          />
          <HighlightCard 
            title="Iron Strength" 
            type="Weightlifting" 
            img="https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=400&q=80" 
            onClick={() => navigate('/library')}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex justify-between items-end">
          <h3 className="font-display text-lg font-bold text-white tracking-tight">Community</h3>
          <button onClick={() => navigate('/community')} className="text-xs font-semibold text-accent">Open feed</button>
        </div>
        <div className="glass p-4 flex items-center gap-3">
          <div className="flex -space-x-2">
            {[1,2,3].map(i => (
              <img key={i} src={`https://api.dicebear.com/7.x/avataaars/svg?seed=user${i}`} className="w-8 h-8 rounded-full border-2 border-bg" alt="user" />
            ))}
          </div>
          {communityCount === null ? (
            <p className="text-sm text-white/60 leading-snug">Loading community…</p>
          ) : communityCount === 0 ? (
            <p className="text-sm text-white/80 leading-snug">
              You're the first one here. <button onClick={() => navigate('/community')} className="text-accent font-semibold">Make the first post</button>.
            </p>
          ) : (
            <p className="text-sm text-white/80 leading-snug">
              <span className="text-accent font-semibold num">
                {communityCount === 1 ? 'You' : `${communityCount.toLocaleString()} athletes`}
              </span>{' '}
              {communityCount === 1 ? 'are' : 'are'} training toward {profile?.goal?.replace('_', ' ') || 'their goal'}{communityCount === 1 ? '' : ' today'}.
            </p>
          )}
        </div>
      </section>

      {/* Manual weekly summary trigger — available any day */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => { haptic('light'); setShowRecap(true); }}
        className="w-full glass p-4 flex items-center gap-3 text-left relative overflow-hidden"
      >
        <div className="w-10 h-10 rounded-xl bg-accent-3/12 border border-accent-3/25 flex items-center justify-center shrink-0">
          <Calendar size={18} className="text-accent-3" />
        </div>
        <div className="flex-1">
          <p className="text-eyebrow text-accent-3">Weekly summary</p>
          <p className="text-white font-medium text-sm mt-0.5">Last 7 days · AI recap</p>
        </div>
        <span className="text-accent-3 text-xl">›</span>
      </motion.button>

      <WeeklyRecap manualOpen={showRecap} onManualClose={() => setShowRecap(false)} />
      <PermissionsPrompt open={permsOpen} uid={profile?.uid} onClose={closePermsPrompt} />

      </div>

      {/* Floating scan FAB */}
      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={() => { haptic('medium'); navigate('/track'); }}
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18, delay: 0.4 }}
        className="fixed bottom-24 right-5 w-14 h-14 bg-accent rounded-full flex items-center justify-center shadow-[0_16px_40px_-8px_rgba(198,255,61,0.5)] z-50 text-bg"
        aria-label="Scan food"
      >
        <div className="absolute inset-0 rounded-full bg-accent/30 ring-pulse" />
        <span className="text-xl relative">📸</span>
      </motion.button>
    </div>
  );
};

const HighlightCard: React.FC<{ title: string; type: string; img: string; onClick: () => void }> = ({ title, type, img, onClick }) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className="min-w-[220px] h-36 rounded-2xl glass relative overflow-hidden text-left"
  >
    <img src={img} className="absolute inset-0 w-full h-full object-cover opacity-35 transition-opacity" alt="" loading="lazy" />
    <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
    <div className="absolute bottom-4 left-4 right-4">
      <p className="text-eyebrow text-accent leading-none mb-1.5">{type}</p>
      <h4 className="font-display text-lg font-bold text-white tracking-tight leading-tight">{title}</h4>
    </div>
  </motion.button>
);

const ActionCard3D: React.FC<{ icon: string; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
  <TiltCard
    onClick={onClick}
    className="glass p-4 h-[100px] flex flex-col items-center justify-center gap-2 text-center relative overflow-hidden group cursor-pointer rounded-2xl"
    max={10}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    <motion.span
      className="text-3xl relative"
      style={{ transform: 'translateZ(20px)' }}
      whileHover={{ scale: 1.15 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
    >
      {icon}
    </motion.span>
    <span className="text-sm font-medium text-white/85 group-hover:text-white transition-colors relative" style={{ transform: 'translateZ(10px)' }}>
      {label}
    </span>
  </TiltCard>
);

const ActionCard: React.FC<{ icon: string, label: string, onClick: () => void }> = ({ icon, label, onClick }) => (
  <motion.button 
    whileTap={{ scale: 0.95 }}
    onClick={onClick}
    className="bg-[#1A1A1A] border border-[#222] rounded-[16px] p-4 h-[100px] flex flex-col items-center justify-center space-y-2 text-center group"
  >
    <span className="text-2xl">{icon}</span>
    <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-accent transition-colors">{label}</span>
  </motion.button>
);
