import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { useAuth } from '../hooks/useAuth';
import { dayKey } from '../services/retentionUtils';

const WEEKS = 13; // ~3 months
const DAYS = 7;

// One formatter for all 91 cells. Calling toLocaleDateString per cell built a
// fresh Intl formatter 91 times on EVERY render of the Profile tab.
const CELL_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const startOfDay = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

// The shared LOCAL-day key. The local-midnight-then-toISOString() version this
// replaces happened to stay self-consistent, but it labelled every bucket with
// the wrong date for any positive UTC offset — one edit away from a real bug.

interface Props {
  className?: string;
}

export const StreakHeatmap: React.FC<Props> = ({ className }) => {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [maxCount, setMaxCount] = useState(1);

  useEffect(() => {
    if (!profile?.uid) return;
    const since = new Date();
    since.setDate(since.getDate() - WEEKS * DAYS);
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', profile.uid),
      where('timestamp', '>=', since),
      orderBy('timestamp', 'desc'),
    );
    getDocs(q).then(snap => {
      const c: Record<string, number> = {};
      let max = 1;
      snap.docs.forEach(d => {
        const ts = d.data().timestamp?.toDate?.();
        if (!ts) return;
        const k = dayKey(ts);
        c[k] = (c[k] || 0) + 1;
        if (c[k] > max) max = c[k];
      });
      setCounts(c);
      setMaxCount(max);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [profile?.uid]);

  // Build grid: WEEKS columns × 7 rows. Most-recent week on the right.
  // Rebuilt only when the data or the day changes — not on every profile
  // update (XP, steps), which re-render this component constantly.
  const todayKey = dayKey(new Date());
  const cells = useMemo(() => {
    const today = startOfDay(new Date());
    const out: { key: string; col: number; row: number; count: number; label: string }[] = [];
    // Align rightmost column to today's weekday position
    for (let col = WEEKS - 1; col >= 0; col--) {
      for (let row = 0; row < DAYS; row++) {
        const offsetFromToday = (WEEKS - 1 - col) * 7 + ((today.getDay() - row + 7) % 7);
        const date = new Date(today);
        date.setDate(today.getDate() - offsetFromToday);
        const key = dayKey(date);
        const count = counts[key] || 0;
        out.push({ key, col, row, count, label: `${CELL_DATE.format(date)} — ${count} session${count === 1 ? '' : 's'}` });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, todayKey]);

  const intensity = (n: number) => {
    if (n === 0) return 0;
    const r = n / Math.max(maxCount, 1);
    if (r < 0.25) return 1;
    if (r < 0.5) return 2;
    if (r < 0.75) return 3;
    return 4;
  };

  const colorFor = (n: number) => {
    const i = intensity(n);
    if (i === 0) return 'rgba(255,255,255,0.04)';
    if (i === 1) return 'rgba(198,255,61,0.20)';
    if (i === 2) return 'rgba(198,255,61,0.45)';
    if (i === 3) return 'rgba(198,255,61,0.70)';
    return 'rgba(198,255,61,1.00)';
  };

  const totalDaysActive = Object.keys(counts).length;
  const totalSessions = Object.values(counts).reduce<number>((a, b) => a + (b as number), 0);

  return (
    <div className={className}>
      <div className="flex justify-between items-end mb-3">
        <div>
          {/* "Activity", not "Consistency": the RetentionCard right above it on
              Analytics already owns that heading, so the page showed it twice. */}
          <p className="text-eyebrow text-accent">Activity</p>
          <p className="font-display text-lg font-bold text-white tracking-tight">Last {WEEKS} weeks</p>
        </div>
        <div className="text-right">
          <p className="num text-sm font-semibold text-white">{totalDaysActive} <span className="text-text-dim text-xs">days</span></p>
          <p className="num text-xs text-text-dim">{totalSessions} sessions</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-flow-col grid-rows-7 gap-1">
          {Array.from({ length: WEEKS * DAYS }).map((_, i) => (
            <div key={i} className="w-3 h-3 rounded-sm bg-white/[0.04] shimmer" />
          ))}
        </div>
      ) : (
        <>
          <div
            className="grid grid-flow-col gap-1"
            style={{ gridTemplateRows: `repeat(${DAYS}, minmax(0, 1fr))`, gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
          >
            {/* Plain cells with one CSS fade-in (compositor-only). They were 91
                separately animated motion components, each with its own
                animation controller — the single heaviest thing on the tab. */}
            {cells.map(c => (
              <div
                key={c.key}
                title={c.label}
                className="aspect-square rounded-sm ff-cell-in"
                style={{
                  backgroundColor: colorFor(c.count),
                  gridColumn: c.col + 1,
                  gridRow: c.row + 1,
                  animationDelay: `${Math.round((c.col / WEEKS) * 300)}ms`,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs text-text-mute">{WEEKS * 7} days ago</span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-mute">Less</span>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorFor(i === 0 ? 0 : (i / 4) * maxCount) }} />
              ))}
              <span className="text-xs text-text-mute">More</span>
            </div>
            <span className="text-xs text-text-mute">Today</span>
          </div>
        </>
      )}
    </div>
  );
};
