import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Trophy, Users, Zap, Shield, TrendingUp, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';
import { collection, query, orderBy, limit, doc, updateDoc, arrayUnion, onSnapshot, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Avatar } from '../components/Avatar';

interface ChallengeDef {
  baseId: string;
  title: string;
  description: string;
  target: number;
  metric: 'workouts' | 'calories' | 'streakDays' | 'water' | 'minutes';
  type: 'community' | 'individual';
  prize: string;
  period: 'weekly' | 'monthly';
}

// Two pools — weekly rotates by ISO week, monthly rotates by month. Each pick is
// deterministic per period so everyone sees the same active set, and challenges
// auto-refresh when the period ends.
const WEEKLY_POOL: ChallengeDef[] = [
  { baseId: 'streak7',        title: '7-day streak together',  description: 'Log a workout every day for 7 days with the whole community.',   target: 7,     metric: 'streakDays', type: 'community',  prize: 'Iron Will badge',       period: 'weekly' },
  { baseId: 'cardio3',        title: '3 cardio sessions',      description: 'Stack three cardio workouts this week — running, cycling, swim.', target: 3,     metric: 'workouts',   type: 'individual', prize: 'Endurance badge',       period: 'weekly' },
  { baseId: 'lift4',          title: '4 strength sessions',    description: 'Hit the iron four times this week to build the habit.',           target: 4,     metric: 'workouts',   type: 'individual', prize: 'Builder badge',         period: 'weekly' },
  { baseId: 'water20l',       title: 'Drink 20L of water',     description: 'Hydration champion challenge — hit 20 litres in 7 days.',         target: 20000, metric: 'water',      type: 'community',  prize: 'Hydration Hero badge',  period: 'weekly' },
  { baseId: 'mins180',        title: '180 active minutes',     description: 'Move with intention — accumulate 180 active minutes this week.',  target: 180,   metric: 'minutes',    type: 'individual', prize: 'Mover badge',           period: 'weekly' },
  { baseId: 'mixed5',         title: 'Mix it up — 5 sessions', description: 'Five workouts across at least three different disciplines.',      target: 5,     metric: 'workouts',   type: 'community',  prize: 'Versatility badge',     period: 'weekly' },
];

const MONTHLY_POOL: ChallengeDef[] = [
  { baseId: 'burn10k',        title: 'Burn 10,000 calories',    description: 'Solo endurance test — torch 10K calories of activity in 30 days.', target: 10000, metric: 'calories',   type: 'individual', prize: 'Elite badge',           period: 'monthly' },
  { baseId: 'workouts20',     title: '20 workouts in a month',  description: 'Show up 20 times this month, in any form. Movement compounds.',    target: 20,    metric: 'workouts',   type: 'individual', prize: 'Consistency badge',     period: 'monthly' },
  { baseId: 'mins1500',       title: '1,500 active minutes',    description: 'A full month of intentional movement — 25 hours of training.',     target: 1500,  metric: 'minutes',    type: 'community',  prize: 'Marathon Mover badge',  period: 'monthly' },
  { baseId: 'water100l',      title: '100 litres of water',     description: 'Community hydration challenge — collectively drink 100L.',         target: 100000,metric: 'water',      type: 'community',  prize: 'Aquaholic badge',       period: 'monthly' },
  { baseId: 'streak30',       title: '30-day streak',           description: 'The legendary one — log activity every day this month.',           target: 30,    metric: 'streakDays', type: 'individual', prize: 'Unbreakable badge',     period: 'monthly' },
];

const isoWeekNum = (d: Date) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = date.getTime();
  date.setUTCMonth(0, 1);
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - date.getTime()) / 604800000);
};

const formatCountdown = (ms: number) => {
  if (ms <= 0) return 'ended';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days >= 7) return `${days}d`;
  if (days >= 1) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m`;
};

interface ActiveChallenge extends ChallengeDef {
  id: string;          // unique per period: e.g. "streak7_2026-W23"
  endsAt: Date;
  endsIn: string;
  current: number;
  periodKey: string;   // "2026-W23" or "2026-06"
}

const buildActiveChallenges = (now: Date): ActiveChallenge[] => {
  const week = isoWeekNum(now);
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  // End of ISO week = next Monday 00:00 UTC
  const endOfWeek = new Date(now);
  const day = endOfWeek.getDay() || 7;
  endOfWeek.setDate(endOfWeek.getDate() + (8 - day));
  endOfWeek.setHours(0, 0, 0, 0);

  // End of month = first of next month
  const endOfMonth = new Date(year, month + 1, 1);

  const weekPick = WEEKLY_POOL[week % WEEKLY_POOL.length];
  const monthPick = MONTHLY_POOL[month % MONTHLY_POOL.length];

  const weekPeriodKey = `${year}-W${String(week).padStart(2, '0')}`;
  const monthPeriodKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  const nowMs = now.getTime();
  return [
    {
      ...weekPick,
      id: `${weekPick.baseId}_${weekPeriodKey}`,
      periodKey: weekPeriodKey,
      endsAt: endOfWeek,
      endsIn: formatCountdown(endOfWeek.getTime() - nowMs),
      current: 0,
    },
    {
      ...monthPick,
      id: `${monthPick.baseId}_${monthPeriodKey}`,
      periodKey: monthPeriodKey,
      endsAt: endOfMonth,
      endsIn: formatCountdown(endOfMonth.getTime() - nowMs),
      current: 0,
    },
  ];
};

export const Challenges: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'global' | 'my'>('global');
  const [selectedChallenge, setSelectedChallenge] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Re-tick every minute so the countdown stays fresh and challenges auto-rotate when the
  // ISO week / month rolls over without needing a manual reload.
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const activeChallenges = useMemo(() => buildActiveChallenges(now), [now]);

  // Real per-user progress for the two active challenges, computed from Firestore.
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    (async () => {
      const results: Record<string, number> = {};
      for (const ch of activeChallenges) {
        const since = ch.period === 'weekly'
          ? new Date(ch.endsAt.getTime() - 7 * 24 * 60 * 60 * 1000)
          : new Date(ch.endsAt.getFullYear(), ch.endsAt.getMonth() - 1, 1);
        try {
          if (ch.metric === 'workouts' || ch.metric === 'minutes' || ch.metric === 'calories') {
            const snap = await getDocs(query(collection(db, 'workouts'),
              where('userId', '==', profile.uid),
              where('timestamp', '>=', since),
            ));
            if (ch.metric === 'workouts') results[ch.id] = snap.size;
            if (ch.metric === 'minutes') results[ch.id] = snap.docs.reduce((a, d) => a + (d.data().duration || 0), 0);
            if (ch.metric === 'calories') results[ch.id] = snap.docs.reduce((a, d) => a + (d.data().caloriesBurned || 0), 0);
          } else if (ch.metric === 'water') {
            const snap = await getDocs(query(collection(db, 'water_logs'),
              where('userId', '==', profile.uid),
              where('timestamp', '>=', since),
            ));
            results[ch.id] = snap.docs.reduce((a, d) => a + (d.data().amount || 0), 0);
          } else if (ch.metric === 'streakDays') {
            results[ch.id] = profile.streak || 0;
          }
        } catch { results[ch.id] = 0; }
      }
      if (!cancelled) setProgress(results);
    })();
    return () => { cancelled = true; };
  }, [profile?.uid, profile?.streak, activeChallenges]);

  // Merge live progress into the challenge cards.
  const challengesWithProgress = activeChallenges.map(ch => ({
    ...ch,
    current: Math.min(ch.target, progress[ch.id] ?? 0),
  }));

  interface LeaderboardRow {
    uid: string;
    displayName: string;
    photoURL?: string;
    points: number;
    streak: number;
  }
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      orderBy('points', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: LeaderboardRow[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              displayName: data.displayName || 'Athlete',
              photoURL: data.photoURL,
              points: typeof data.points === 'number' ? data.points : 0,
              streak: typeof data.streak === 'number' ? data.streak : 0,
            };
          })
          .filter((r) => r.points >= 0); // exclude any malformed docs
        setLeaderboard(rows);
        setBoardLoading(false);
      },
      () => {
        setBoardError("Couldn't load leaderboard");
        setBoardLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const handleJoin = async (challenge: any) => {
    if (!profile?.uid) return;
    setLoading(true);
    try {
      const userRef = doc(db, 'users', profile.uid);
      // Persist baseId so the "joined" state carries across week/month rollovers.
      await updateDoc(userRef, { activeChallenges: arrayUnion(challenge.baseId || challenge.id) });
      showToast(`Joined ${challenge.title}`, 'success');
      setSelectedChallenge(null);
      setActiveTab('my');
    } catch {
      showToast("Couldn't join challenge", 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 bg-bg min-h-screen">
      <header className="flex items-center justify-between mb-5 pt-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18} /></button>
          <div>
            <p className="text-eyebrow text-accent">Compete</p>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">Challenges</h1>
          </div>
        </div>
        <div className="flex bg-surface rounded-xl p-1 border border-white/[0.06]">
           <button
             onClick={() => setActiveTab('global')}
             className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all', activeTab === 'global' ? 'bg-accent text-bg' : 'text-text-dim')}
           >
             All
           </button>
           <button
             onClick={() => setActiveTab('my')}
             className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all', activeTab === 'my' ? 'bg-accent text-bg' : 'text-text-dim')}
           >
             Mine
           </button>
        </div>
      </header>

      {activeTab === 'global' ? (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
              <h3 className="font-display text-lg font-bold text-white tracking-tight">Active challenges</h3>
              <span className="text-xs text-text-dim num">{challengesWithProgress.length} live</span>
            </div>
            <div className="space-y-3">
              {challengesWithProgress.map(ch => (
                <ChallengeCard
                  key={ch.id}
                  challenge={ch}
                  onClick={() => setSelectedChallenge(ch)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
              <div>
                <h3 className="font-display text-lg font-bold text-white tracking-tight">Leaderboard</h3>
                <p className="text-xs text-text-dim">Top athletes by XP · live</p>
              </div>
              <TrendingUp className="text-accent" size={16} />
            </div>
            <div className="glass overflow-hidden">
              {boardLoading ? (
                <div className="p-4 space-y-3">
                  {[0,1,2,3].map(i => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="num text-sm font-semibold w-5 text-text-dim">{i + 1}</div>
                        <div className="w-9 h-9 rounded-xl bg-white/[0.06] shimmer" />
                        <div className="h-3 w-24 rounded bg-white/[0.06] shimmer" />
                      </div>
                      <div className="h-3 w-12 rounded bg-white/[0.06] shimmer" />
                    </div>
                  ))}
                </div>
              ) : boardError ? (
                <div className="p-6 text-center text-sm text-text-dim">{boardError}</div>
              ) : leaderboard.length === 0 ? (
                <div className="p-6 text-center text-sm text-text-dim">
                  No athletes on the board yet. Log a workout to earn XP.
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {leaderboard.slice(0, 10).map((item, idx) => {
                    const isMe = item.uid === profile?.uid;
                    const rankColor =
                      idx === 0 ? 'text-accent'
                      : idx === 1 ? 'text-white'
                      : idx === 2 ? 'text-accent-2'
                      : 'text-text-dim';
                    return (
                      <div key={item.uid} className={cn(
                        'flex items-center justify-between rounded-xl px-2 py-1.5 -mx-2',
                        isMe && 'bg-accent/8 border border-accent/20',
                      )}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={cn('num text-sm font-semibold w-5 shrink-0', rankColor)}>
                            {idx + 1}
                          </span>
                          <div className="w-9 h-9 rounded-xl bg-surface border border-white/[0.06] overflow-hidden shrink-0">
                            <Avatar src={item.photoURL} name={item.displayName} size={36} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {item.displayName}
                              {isMe && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent font-bold">you</span>}
                            </p>
                            {item.streak > 0 && (
                              <p className="num text-[10px] text-text-dim mt-0.5">🔥 {item.streak} day streak</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="num text-sm text-white font-semibold leading-none">{item.points.toLocaleString()}</p>
                          <p className="text-[10px] text-text-dim mt-1">XP</p>
                        </div>
                      </div>
                    );
                  })}
                  {profile?.uid && !leaderboard.slice(0, 10).some(r => r.uid === profile.uid) && (
                    <>
                      <div className="border-t border-white/[0.06] pt-3 mt-2" />
                      {(() => {
                        const myRank = leaderboard.findIndex(r => r.uid === profile.uid);
                        return (
                          <div className="flex items-center justify-between rounded-xl px-2 py-1.5 -mx-2 bg-accent/8 border border-accent/20">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="num text-sm font-semibold w-5 shrink-0 text-accent">
                                {myRank >= 0 ? myRank + 1 : '—'}
                              </span>
                              <div className="w-9 h-9 rounded-xl bg-surface border border-white/[0.06] overflow-hidden shrink-0">
                                <Avatar src={profile.photoURL} name={profile.displayName} size={36} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">
                                  {profile.displayName}
                                  <span className="ml-2 text-[10px] uppercase tracking-wider text-accent font-bold">you</span>
                                </p>
                                <p className="num text-[10px] text-text-dim mt-0.5">🔥 {profile.streak || 0} day streak</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="num text-sm text-white font-semibold leading-none">{(profile.points || 0).toLocaleString()}</p>
                              <p className="text-[10px] text-text-dim mt-1">XP</p>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        (() => {
          const joinedIds = profile?.activeChallenges || [];
          const myChallenges = challengesWithProgress.filter(ch => joinedIds.includes(ch.baseId) || joinedIds.includes(ch.id));
          if (myChallenges.length === 0) {
            return (
              <div className="py-24 flex flex-col items-center justify-center gap-4 text-center">
                <Shield size={42} className="text-text-dim/30" />
                <p className="text-sm text-text-dim">No active challenges yet.</p>
                <button onClick={() => setActiveTab('global')} className="text-accent text-sm font-semibold">Join one →</button>
              </div>
            );
          }
          return (
            <div className="space-y-3">
              <div className="flex justify-between items-end px-1">
                <h3 className="font-display text-lg font-bold text-white tracking-tight">Your active challenges</h3>
                <span className="text-xs text-text-dim num">{myChallenges.length} joined</span>
              </div>
              <div className="space-y-3">
                {myChallenges.map(ch => (
                  <ChallengeCard
                    key={ch.id}
                    challenge={ch}
                    onClick={() => setSelectedChallenge(ch)}
                  />
                ))}
              </div>
            </div>
          );
        })()
      )}

      {/* Challenge Detail Overlay */}
      <AnimatePresence>
        {selectedChallenge && (
          <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-0 sm:p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setSelectedChallenge(null)}
               className="absolute inset-0 bg-black/90 backdrop-blur-md"
             />
             <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="relative bg-bg w-full max-w-lg rounded-t-[40px] sm:rounded-[40px] border-t sm:border border-[#222] overflow-hidden flex flex-col"
             >
                <div className="p-6 space-y-6">
                   <div className="flex justify-between items-start gap-3">
                      <div className="space-y-3 flex-1">
                         <div className="flex items-center gap-2 flex-wrap">
                           <span className="bg-accent/12 text-accent text-xs font-semibold px-2.5 py-1 rounded-full">
                             {selectedChallenge.type}
                           </span>
                           <span className="text-xs text-accent-2 font-medium">Ends in {selectedChallenge.endsIn}</span>
                         </div>
                         <h2 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">{selectedChallenge.title}</h2>
                      </div>
                      <button onClick={() => setSelectedChallenge(null)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim hover:text-white shrink-0" aria-label="Close"><X size={16} /></button>
                   </div>

                   <p className="text-sm text-text-dim leading-relaxed">{selectedChallenge.description}</p>

                   <div className="space-y-3">
                      <div className="flex justify-between items-end">
                         <p className="text-sm text-white font-medium">Progress</p>
                         <p className="num text-sm text-accent font-semibold">{Math.round((selectedChallenge.current / selectedChallenge.target) * 100)}%</p>
                      </div>
                      <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                         <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(selectedChallenge.current / selectedChallenge.target) * 100}%` }}
                            className="h-full bg-gradient-to-r from-accent-soft to-accent rounded-full"
                         />
                      </div>
                      <div className="flex justify-between text-xs text-text-dim num">
                         <span>{selectedChallenge.current.toLocaleString()}</span>
                         <span>{selectedChallenge.target.toLocaleString()}</span>
                      </div>
                   </div>

                   <div className="p-4 bg-surface rounded-2xl border border-white/[0.06] flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center text-accent">
                        <Trophy size={16} />
                      </div>
                      <div>
                        <p className="text-xs text-text-dim font-medium">Reward</p>
                        <p className="text-white font-semibold">{selectedChallenge.prize}</p>
                      </div>
                   </div>

                   <button
                     onClick={() => handleJoin(selectedChallenge)}
                     disabled={loading}
                     className="btn-3d w-full h-14"
                   >
                     {loading ? <Loader2 className="animate-spin" size={18} /> : (
                       <>
                         <span>Join challenge</span>
                         <Zap size={16} fill="currentColor" />
                       </>
                     )}
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ChallengeCard: React.FC<{ challenge: any; onClick: () => void }> = ({ challenge, onClick }) => {
  const pct = Math.min(100, Math.round((challenge.current / challenge.target) * 100));
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group w-full relative glass p-5 hover:border-accent/30 transition-colors text-left overflow-hidden"
    >
      <div className="space-y-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            {challenge.type === 'community' ? <Users size={12} className="text-accent-3" /> : <Zap size={12} className="text-accent" />}
            <span className="text-eyebrow text-text-dim">{challenge.type}</span>
          </div>
          <span className="text-xs text-text-dim font-medium">Ends {challenge.endsIn}</span>
        </div>
        <h4 className="font-display text-xl font-bold text-white tracking-tight leading-tight group-hover:text-accent transition-colors">
          {challenge.title}
        </h4>
        <p className="text-sm text-text-dim leading-relaxed line-clamp-2">{challenge.description}</p>

        <div className="space-y-2">
          <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent-soft to-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between items-center">
            <span className="num text-xs text-text-dim">{challenge.current.toLocaleString()} / {challenge.target.toLocaleString()}</span>
            <div className="flex items-center gap-1">
              <Trophy size={10} className="text-accent" />
              <span className="text-xs text-accent font-semibold">{challenge.prize}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.button>
  );
};
