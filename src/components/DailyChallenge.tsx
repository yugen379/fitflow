import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Target, Check, Sparkles, RefreshCw } from 'lucide-react';
import { generateDailyChallenge, DailyChallenge as DailyChallengeData } from '../services/geminiService';
import { useAuth } from '../hooks/useAuth';
import { haptic } from '../lib/haptics';
import { celebrateSession } from '../lib/celebrate';

const STORAGE_KEY = (uid: string, date: string) => `ff_challenge_${uid}_${date}`;
const today = () => new Date().toISOString().slice(0, 10);

interface Stored {
  challenge: DailyChallengeData;
  completed: boolean;
}

const CATEGORY_TONE: Record<DailyChallengeData['category'], string> = {
  movement: 'bg-accent/12 border-accent/25 text-accent',
  nutrition: 'bg-accent-2/12 border-accent-2/25 text-accent-2',
  recovery: 'bg-accent-3/12 border-accent-3/25 text-accent-3',
  mindfulness: 'bg-purple-400/12 border-purple-400/25 text-purple-300',
};

export const DailyChallenge: React.FC = () => {
  const { profile } = useAuth();
  const [data, setData] = useState<DailyChallengeData | null>(null);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (forceFresh = false) => {
    if (!profile?.uid) return;
    const key = STORAGE_KEY(profile.uid, today());
    if (!forceFresh) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const stored: Stored = JSON.parse(raw);
          setData(stored.challenge);
          setCompleted(stored.completed);
          setLoading(false);
          return;
        }
      } catch {}
    }
    setRefreshing(forceFresh);
    try {
      const challenge = await generateDailyChallenge({
        goal: profile.goal,
        streak: profile.streak || 0,
      });
      setData(challenge);
      setCompleted(false);
      try { localStorage.setItem(key, JSON.stringify({ challenge, completed: false })); } catch {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profile?.uid]);

  const toggleComplete = () => {
    if (!profile?.uid || !data) return;
    haptic(completed ? 'light' : 'success');
    const next = !completed;
    setCompleted(next);
    if (next) celebrateSession();
    try { localStorage.setItem(STORAGE_KEY(profile.uid, today()), JSON.stringify({ challenge: data, completed: next })); } catch {}
  };

  if (loading || !data) {
    return (
      <div className="glass p-5 h-28">
        <div className="h-3 w-20 bg-white/[0.06] rounded shimmer" />
        <div className="h-5 w-3/4 bg-white/[0.06] rounded shimmer mt-3" />
        <div className="h-3 w-1/2 bg-white/[0.06] rounded shimmer mt-2" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass p-5 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 w-24 h-24 bg-accent/10 blur-2xl rounded-full pointer-events-none" />

      <div className="flex items-start justify-between gap-3 relative">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${CATEGORY_TONE[data.category]}`}>
              <Target size={10} className="inline mr-1 -mt-0.5" />
              {data.category}
            </span>
            <span className="text-eyebrow text-text-dim">Daily challenge</span>
          </div>
          <h3 className={`font-display text-lg font-bold tracking-tight leading-tight transition-colors ${completed ? 'text-text-dim line-through' : 'text-white'}`}>
            {data.title}
          </h3>
          <p className="text-sm text-text-dim mt-1 leading-snug">{data.description}</p>
          <p className="num text-xs text-accent font-semibold mt-2">
            {data.target} {data.unit}
          </p>
        </div>

        <button
          onClick={toggleComplete}
          aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
          className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
            completed
              ? 'bg-accent text-bg shadow-[0_8px_24px_-4px_rgba(198,255,61,0.5)]'
              : 'glass text-text-dim hover:text-accent'
          }`}
        >
          {completed ? <Check size={20} strokeWidth={3} /> : <Sparkles size={18} />}
        </button>
      </div>

      <button
        onClick={() => load(true)}
        disabled={refreshing}
        className="absolute top-3 right-3 w-7 h-7 rounded-lg text-text-mute hover:text-white transition-colors flex items-center justify-center disabled:opacity-50"
        aria-label="New challenge"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </motion.div>
  );
};
