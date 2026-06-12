import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Dumbbell, Zap, Bike, Waves, Activity, Clock, Flame, ChevronDown } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';

interface WorkoutEntry {
  id: string;
  type: string;
  duration: number;
  caloriesBurned: number;
  timestamp: any;
  exerciseLogs?: any[];
  notes?: string;
}

const iconFor = (type: string) => {
  const t = (type || '').toLowerCase();
  if (t.includes('strength')) return Dumbbell;
  if (t.includes('cardio')) return Zap;
  if (t.includes('cycl') || t.includes('ride')) return Bike;
  if (t.includes('swim')) return Waves;
  if (t.includes('run')) return Activity;
  return Activity;
};

const formatRelative = (date: Date) => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const WorkoutHistory: React.FC<{ limitCount?: number }> = ({ limitCount = 20 }) => {
  const { profile } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.uid) return;
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(limitCount),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutEntry)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [profile?.uid, limitCount]);

  if (loading) {
    return (
      <div className="glass p-5 space-y-3">
        <div className="h-4 w-32 bg-white/[0.06] rounded shimmer" />
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white/[0.04] rounded-xl shimmer" />)}
      </div>
    );
  }

  if (workouts.length === 0) {
    return (
      <div className="glass p-8 text-center space-y-2">
        <Dumbbell size={32} className="mx-auto text-text-dim/40" />
        <p className="text-sm text-text-dim">No workouts logged yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {workouts.map((w) => {
        const Icon = iconFor(w.type);
        const date = w.timestamp?.toDate?.();
        const isOpen = expanded === w.id;
        const hasDetails = (w.exerciseLogs?.length || 0) > 0;
        return (
          <motion.div
            key={w.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass overflow-hidden"
          >
            <button
              onClick={() => hasDetails && setExpanded(isOpen ? null : w.id)}
              className="w-full p-4 flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center text-accent shrink-0">
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-white font-medium text-sm truncate">{w.type}</p>
                  <span className="text-xs text-text-dim shrink-0">{date ? formatRelative(date) : ''}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 num text-xs text-text-dim">
                  <span className="flex items-center gap-1"><Clock size={11} />{w.duration || 0}m</span>
                  <span className="flex items-center gap-1"><Flame size={11} />{w.caloriesBurned || 0}c</span>
                  {hasDetails && <span>{w.exerciseLogs!.length} sets</span>}
                </div>
              </div>
              {hasDetails && (
                <ChevronDown
                  size={16}
                  className={cn('text-text-dim transition-transform shrink-0', isOpen && 'rotate-180')}
                />
              )}
            </button>
            <AnimatePresence initial={false}>
              {isOpen && hasDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-1 space-y-2 border-t border-white/[0.04]">
                    {w.exerciseLogs!.map((log: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-1.5">
                        <span className="text-white/85 text-sm">{log.name || log.exerciseName || 'Exercise'}</span>
                        <span className="num text-xs text-text-dim">
                          {log.sets || 0} × {log.reps || 0}
                          {log.weight ? ` @ ${log.weight}kg` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
};
