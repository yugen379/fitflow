import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { computeLevel } from '../services/missionUtils';
import { celebrateLevelUp } from '../lib/celebrate';

// The XP/Level strip under the Home header. Level and progress are DERIVED from
// lifetime points via the shared curve (missionUtils.computeLevel) — never from
// the stored `level` field — so the bar, Profile, and badges always agree.
//
// Reacts to live profile updates: a points increase floats a "+N XP" chip and
// fills the bar; crossing a level threshold pops the level chip and fires the
// level-up celebration. First paint never animates (no fanfare for old news).
export const XPBar: React.FC<{ points?: number; streak?: number }> = ({ points, streak }) => {
  const info = computeLevel(points);
  const prevPoints = useRef<number | null>(null);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  const [levelPop, setLevelPop] = useState(0);
  const gainSeq = useRef(0);

  useEffect(() => {
    if (typeof points !== 'number' || !Number.isFinite(points)) return;
    const prev = prevPoints.current;
    prevPoints.current = points;
    if (prev === null || points <= prev) return;
    setGain({ id: ++gainSeq.current, amount: points - prev });
    if (computeLevel(prev).level < computeLevel(points).level) {
      setLevelPop((n) => n + 1);
      celebrateLevelUp();
    }
  }, [points]);

  // Let the gain chip finish its float, then clear it.
  useEffect(() => {
    if (!gain) return;
    const t = setTimeout(() => setGain(null), 1500);
    return () => clearTimeout(t);
  }, [gain]);

  return (
    <div className="flex items-center gap-2 -mt-2 mb-1">
      <motion.span
        key={levelPop}
        initial={levelPop === 0 ? false : { scale: 1.35 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 14 }}
        className="num text-[10px] font-bold text-accent bg-accent/10 border border-accent/25 rounded-full px-2 py-0.5 whitespace-nowrap"
      >
        Lv {info.level}
      </motion.span>

      <div
        className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden relative"
        role="progressbar"
        aria-valuenow={info.intoLevel}
        aria-valuemin={0}
        aria-valuemax={info.toNext}
        aria-label={`Level ${info.level} progress`}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${info.pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-accent-soft via-accent to-accent-bright rounded-full"
        />
      </div>

      <div className="relative flex items-center gap-2 whitespace-nowrap">
        <AnimatePresence>
          {gain && (
            <motion.span
              key={gain.id}
              initial={{ opacity: 0, y: 4, scale: 0.85 }}
              animate={{ opacity: 1, y: -16, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="num absolute -left-2 top-0 text-[10px] font-bold text-accent pointer-events-none"
            >
              +{gain.amount} XP
            </motion.span>
          )}
        </AnimatePresence>
        <span className="num text-[10px] text-text-dim font-medium">
          {info.intoLevel}/{info.toNext}
        </span>
        <span className="num text-[10px] text-accent font-semibold">{streak || 0}🔥</span>
      </div>
    </div>
  );
};
