import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import { computeLevel } from '../services/missionUtils';
import { celebrateLevelUp } from '../lib/celebrate';
import { useBackHandler } from '../lib/backButton';
import { t } from '../i18n/i18n';

// ---------------------------------------------------------------------------
// App-wide level-up moment.
//
// The celebration used to live in the Home XP bar, which only sees a points
// change while Home is on screen. XP is earned on Fuel and Train, so the
// level-up happened silently (seen on a real device: Lv 8 -> 9 with nothing).
// This watches the profile everywhere and remembers the last level the user
// was SHOWN, so a level reached anywhere — even offline — is celebrated once.
// ---------------------------------------------------------------------------

const seenKey = (uid: string) => `ff_level_seen_${uid}`;

export const LevelUpWatcher: React.FC = () => {
  const { profile } = useAuth();
  const [shown, setShown] = useState<number | null>(null);
  useBackHandler(shown !== null, () => setShown(null));

  useEffect(() => {
    const uid = profile?.uid;
    if (!uid || typeof profile?.points !== 'number') return;
    const level = computeLevel(profile.points).level;
    let seen: number | null = null;
    try { const raw = localStorage.getItem(seenKey(uid)); seen = raw ? Number(raw) : null; } catch {}
    // First run on this device: record silently (no fanfare for old news).
    if (seen === null || !Number.isFinite(seen)) {
      try { localStorage.setItem(seenKey(uid), String(level)); } catch {}
      return;
    }
    if (level > seen) {
      try { localStorage.setItem(seenKey(uid), String(level)); } catch {}
      setShown(level);
      celebrateLevelUp();
    }
  }, [profile?.uid, profile?.points]);

  return (
    <AnimatePresence>
      {shown !== null && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6" role="dialog" aria-label={t('Level {n} reached', { n: shown })}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShown(null)}
          />
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative glass rounded-3xl p-7 w-full max-w-xs text-center space-y-3"
          >
            <p className="text-eyebrow text-accent">{t('Level up')}</p>
            <p className="num font-display text-6xl font-bold text-white leading-none">{shown}</p>
            <p className="text-sm text-text-dim">
              {t('Every log and every session got you here. Keep the streak going.')}
            </p>
            <button onClick={() => setShown(null)} className="btn-3d h-12 w-full">{t('Let’s go')}</button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
