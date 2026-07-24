import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ProgressRing } from './ProgressRing';
import { AnimatedNumber } from './AnimatedNumber';
import { Mission, MissionTask } from '../services/missionUtils';
import { celebrateSession } from '../lib/celebrate';
import { haptic } from '../lib/haptics';

// Home's hero widget — the answer to "what should I do RIGHT NOW?".
//
// Renders the deterministic Mission from missionUtils.buildMission: three rows
// (workout / calories / steps), each a DIRECT action — tap goes straight to the
// thing, never to a menu. The engine's `next` row is visually promoted with its
// action label; 'over' calories flips the row to coral with corrective copy;
// streak-risk tints the whole card. Completing all three fires one celebration
// per day (localStorage-guarded so re-opening the app doesn't re-confetti).
interface Props {
  mission: Mission;
  loading: boolean;
  uid?: string;
  caloriesBurned: number;
  activeMinutes: number;
  onAction: (task: MissionTask) => void;
}

export const TodayMission: React.FC<Props> = ({
  mission, loading, uid, caloriesBurned, activeMinutes, onAction,
}) => {
  const risk = mission.urgency === 'streak-risk';

  useEffect(() => {
    if (loading || !uid || !mission.complete) return;
    const key = `ff_mission_complete_${uid}_${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    celebrateSession();
  }, [mission.complete, loading, uid]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`glass p-5 relative overflow-hidden transition-shadow duration-500 ${
        risk
          ? 'border-accent-2/40 shadow-[0_0_50px_-18px_rgba(255,107,107,0.45)]'
          : mission.complete && !loading
            ? 'shadow-[0_0_60px_-20px_rgba(198,255,61,0.4)]'
            : ''
      }`}
    >
      <div
        className={`absolute -top-12 -right-12 w-32 h-32 blur-3xl rounded-full pointer-events-none ${
          risk ? 'bg-accent-2/12' : 'bg-accent/8'
        }`}
      />

      {loading ? (
        <div className="h-40 flex items-center justify-center">
          <span className="text-sm text-text-dim pulse-soft">Loading your day…</span>
        </div>
      ) : (
        <div className="relative space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-white tracking-tight leading-tight">
              {mission.headline}
            </h2>
            {risk ? (
              <span className="shrink-0 text-[10px] font-bold text-accent-2 bg-accent-2/12 border border-accent-2/30 rounded-full px-2.5 py-1 whitespace-nowrap">
                🔥 Streak at risk
              </span>
            ) : mission.complete ? (
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 16 }}
                className="shrink-0 text-[10px] font-bold text-accent bg-accent/12 border border-accent/30 rounded-full px-2.5 py-1 whitespace-nowrap"
              >
                ✓ Complete
              </motion.span>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0">
              <ProgressRing
                progress={Math.round((mission.done / mission.total) * 100)}
                size={96}
                strokeWidth={9}
                color={risk ? 'var(--accent-2)' : 'var(--accent)'}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display num text-2xl font-bold text-white leading-none">
                  {mission.done}
                  <span className="text-base text-text-dim">/{mission.total}</span>
                </span>
                <span className="text-[9px] text-accent font-semibold uppercase tracking-wider mt-1">
                  mission
                </span>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              {mission.tasks.map((task, i) => (
                <MissionRow key={task.id} task={task} index={i} onAction={onAction} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 pt-1 border-t border-white/[0.06]">
            <p className="text-xs text-text-dim">
              Burned{' '}
              <span className="num text-white font-semibold">
                <AnimatedNumber value={caloriesBurned} />
              </span>{' '}
              kcal
            </p>
            <div className="w-px h-3 bg-white/[0.06]" />
            <p className="text-xs text-text-dim">
              Active{' '}
              <span className="num text-white font-semibold">
                <AnimatedNumber value={activeMinutes} />
              </span>{' '}
              min
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const MissionRow: React.FC<{
  task: MissionTask;
  index: number;
  onAction: (task: MissionTask) => void;
}> = ({ task, index, onAction }) => {
  const isNext = task.state === 'next';
  const isDone = task.state === 'done';
  const isOver = task.state === 'over';

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => { haptic('light'); onAction(task); }}
      className={`w-full text-left rounded-xl px-2.5 py-2 -mx-1 transition-colors ${
        isNext ? 'bg-accent/[0.07] border border-accent/25' : 'border border-transparent'
      }`}
      aria-label={`${task.label}: ${task.action.label}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm leading-none">{task.icon}</span>
        <span className="text-xs font-medium text-white/85 flex-1 truncate">{task.label}</span>
        <span className={`num text-[11px] font-semibold ${isOver ? 'text-accent-2' : 'text-text-dim'}`}>
          {task.id === 'calories' || task.id === 'steps' ? (
            <>
              <AnimatedNumber value={task.current} />
              <span className="text-text-dim font-medium">/{task.target.toLocaleString()}</span>
            </>
          ) : (
            `${task.current}/${task.target}`
          )}
        </span>
        <span className="w-5 h-5 flex items-center justify-center shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            {isDone ? (
              <motion.span
                key="done"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: [0.3, 1.25, 1], opacity: 1 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="w-[18px] h-[18px] rounded-full bg-accent text-bg text-[10px] font-bold flex items-center justify-center"
              >
                ✓
              </motion.span>
            ) : isOver ? (
              <motion.span
                key="over"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-[18px] h-[18px] rounded-full bg-accent-2/15 border border-accent-2/40 text-accent-2 text-[10px] font-bold flex items-center justify-center"
              >
                !
              </motion.span>
            ) : (
              <motion.span key="chev" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`text-xs ${isNext ? 'text-accent' : 'text-text-dim'}`}>
                ›
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>

      <div className="mt-1.5 h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${task.pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.08 * index }}
          className={`h-full rounded-full ${
            isOver
              ? 'bg-accent-2'
              : isDone
                ? 'bg-accent'
                : 'bg-gradient-to-r from-accent-soft to-accent'
          }`}
        />
      </div>

      {(isNext || isOver) && (
        <p className={`mt-1 text-[10px] font-semibold ${isOver ? 'text-accent-2' : 'text-accent'}`}>
          {isOver ? `Over target — ${task.action.label.toLowerCase()}` : `${task.action.label} →`}
        </p>
      )}
    </motion.button>
  );
};
