import React from 'react';
import { motion } from 'motion/react';
import { Check, Droplet, Dumbbell, Utensils, Moon } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  water: number;       // ml today
  meals: number;       // count
  workouts: number;    // count
  sleep: number;       // hours last night
}

export const DailyHabits: React.FC<Props> = ({ water, meals, workouts, sleep }) => {
  const habits = [
    { id: 'water', label: 'Hydrate',  icon: Droplet,  goal: 2000,  current: water,    unit: 'ml', tone: 'accent-3' as const },
    { id: 'meal',  label: 'Eat well', icon: Utensils, goal: 3,     current: meals,    unit: '',   tone: 'accent' as const },
    { id: 'train', label: 'Move',     icon: Dumbbell, goal: 1,     current: workouts, unit: '',   tone: 'accent' as const },
    { id: 'sleep', label: 'Recover',  icon: Moon,     goal: 7,     current: sleep,    unit: 'h',  tone: 'accent-2' as const },
  ];

  const completed = habits.filter(h => h.current >= h.goal).length;
  const pct = (completed / habits.length) * 100;

  return (
    <div className="glass p-5">
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-eyebrow text-accent">Today</p>
          <p className="font-display text-lg font-bold text-white tracking-tight">Daily habits</p>
        </div>
        <div className="text-right">
          <p className="num font-display text-2xl font-bold text-white leading-none">{completed}<span className="text-base text-text-dim font-medium">/{habits.length}</span></p>
          <p className="text-xs text-text-dim mt-1">{pct === 100 ? 'Done · streak +1' : `${4 - completed} to go`}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {habits.map((h, i) => {
          const isDone = h.current >= h.goal;
          const progress = Math.min(h.current / h.goal, 1);
          const toneClass =
            h.tone === 'accent' ? 'text-accent border-accent/25 bg-accent/12' :
            h.tone === 'accent-2' ? 'text-accent-2 border-accent-2/25 bg-accent-2/12' :
            'text-accent-3 border-accent-3/25 bg-accent-3/12';
          return (
            <motion.div
              key={h.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex flex-col items-center gap-1.5"
              title={`${h.label} · ${h.current}${h.unit} / ${h.goal}${h.unit}`}
            >
              <div className={cn(
                'relative w-12 h-12 rounded-2xl border flex items-center justify-center transition-all',
                isDone ? toneClass : 'bg-white/[0.03] border-white/[0.06] text-text-dim',
              )}>
                <h.icon size={16} />
                {isDone && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                    <Check size={10} className="text-bg" strokeWidth={3} />
                  </div>
                )}
                {/* Progress ring */}
                {!isDone && progress > 0 && (
                  <svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                    <circle
                      cx="24" cy="24" r="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 22}
                      strokeDashoffset={2 * Math.PI * 22 * (1 - progress)}
                      className={cn(
                        h.tone === 'accent' ? 'text-accent' :
                        h.tone === 'accent-2' ? 'text-accent-2' :
                        'text-accent-3',
                      )}
                    />
                  </svg>
                )}
              </div>
              <span className="text-[11px] font-medium text-white/85 leading-none">{h.label}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
