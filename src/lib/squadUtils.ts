/**
 * Squads — pure logic, no Firebase. Shared by the UI, the sync service and
 * scripts/squad-proof.mjs (which also checks that the server copy in
 * functions/src/squadCore.ts agrees with this one).
 *
 * A squad's week starts on MONDAY 00:00 in the squad's own time zone (stored
 * when the squad is created), so everyone in it shares one boundary no matter
 * where their phone is. A week is named by the calendar date of that Monday:
 * weekKey "2026-11-23". Calendar arithmetic is done on dates, never by adding
 * 7 × 24 h to an instant, which is what keeps DST weeks (167 h / 169 h) right.
 */

export type SquadMetric = 'steps' | 'activeDays' | 'workouts';
export const SQUAD_METRICS: SquadMetric[] = ['steps', 'activeDays', 'workouts'];

export const SQUAD_MIN_MEMBERS = 2;
export const SQUAD_MAX_MEMBERS = 10;
export const SQUAD_NAME_MIN = 2;
export const SQUAD_NAME_MAX = 30;
/** How many squads one person may be in. Bounds the sync cost per user. */
export const SQUADS_PER_USER = 5;

/** No 0/O or 1/I: a code read aloud or off a screenshot is never ambiguous. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/** Upper bound for one member's week. Mirrors firestore.rules isValidSquadWeek. */
export const WEEK_LIMITS: Record<SquadMetric, number> = {
  steps: 700_000, // 100k/day, the same per-day ceiling step_days enforces
  activeDays: 7,
  workouts: 50,
};

export const GOAL_LIMITS: Record<SquadMetric, { min: number; max: number; def: number }> = {
  steps: { min: 1_000, max: 5_000_000, def: 200_000 },
  activeDays: { min: 1, max: 70, def: 20 },
  workouts: { min: 1, max: 500, def: 15 },
};

export const METRIC_LABEL: Record<SquadMetric, string> = {
  steps: 'Steps',
  activeDays: 'Active days',
  workouts: 'Workouts',
};

// ── Codes ────────────────────────────────────────────────────────────────────

/** `rand(n)` must return an integer in [0, n). Server passes crypto.randomInt. */
export const generateCode = (rand: (n: number) => number): string => {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return s;
};

/**
 * What a person types → a code, or null. Forgiving about case, spaces and
 * dashes, and about the look-alikes the alphabet left out (O→0 is NOT mapped:
 * neither is in the alphabet, so a typed O/0/I/1 can only be a mistake).
 */
export const normalizeCode = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s : null;
};

// ── Names ────────────────────────────────────────────────────────────────────

/** Control, zero-width and bidi-override characters, plus angle brackets. */
const ch = (n: number) => String.fromCharCode(n);
const UNSAFE_CHARS = new RegExp(
  '[\\x00-\\x1f\\x7f-\\x9f' + ch(0x200b) + '-' + ch(0x200f) + ch(0x2028) + '-' + ch(0x202e) +
  ch(0x2066) + '-' + ch(0x2069) + '<>]', 'g');

/** Trim, collapse whitespace, drop control/markup characters; null if 2–30 fails. */
export const sanitizeSquadName = (input: unknown): string | null => {
  if (typeof input !== 'string' || input.length > 200) return null;
  const s = input
    // eslint-disable-next-line no-control-regex
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, ' ')
    .trim();
  const len = [...s].length;
  return len >= SQUAD_NAME_MIN && len <= SQUAD_NAME_MAX ? s : null;
};

export const isSquadMetric = (m: unknown): m is SquadMetric =>
  typeof m === 'string' && (SQUAD_METRICS as string[]).includes(m);

/** A goal the owner typed → a whole number in range, or null. */
export const sanitizeGoal = (metric: SquadMetric, goal: unknown): number | null => {
  const n = typeof goal === 'number' ? goal : typeof goal === 'string' ? Number(goal) : NaN;
  if (!Number.isFinite(n)) return null;
  const g = Math.round(n);
  const { min, max } = GOAL_LIMITS[metric];
  return g >= min && g <= max ? g : null;
};

/** A measured weekly number → a safe whole number within the rule's bounds. */
export const clampWeekValue = (metric: SquadMetric, v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.min(WEEK_LIMITS[metric], Math.max(0, n));
};

// ── Time zones and weeks ─────────────────────────────────────────────────────

export const isValidTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const safeTimeZone = (tz: unknown): string => (isValidTimeZone(tz) ? tz : 'UTC');

const pad = (n: number) => String(n).padStart(2, '0');
const fmtYmd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const dtf = (tz: string) => {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
};

/** Wall-clock parts of an instant in a zone. */
export const zonedParts = (date: Date, tz: string) => {
  const parts: Record<string, number> = {};
  for (const p of dtf(safeTimeZone(tz)).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour % 24, mi: parts.minute, s: parts.second };
};

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export const localDay = (date: Date, tz: string): string => {
  const p = zonedParts(date, tz);
  return fmtYmd(p.y, p.m, p.d);
};

/** Add whole calendar days to a YYYY-MM-DD string. */
export const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/** Monday of the week containing `date`, as seen in `tz`. This is the week key. */
export const weekKey = (date: Date, tz: string): string => {
  const day = localDay(date, tz);
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return addDays(day, -sinceMonday);
};

export const WEEK_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isWeekKey = (s: unknown): s is string => {
  if (typeof s !== 'string' || !WEEK_KEY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDay() === 1; // real date AND a Monday
};

/** The seven calendar days of a week, Monday first. */
export const weekDays = (wk: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(wk, i));

/** UTC instant of 00:00 on `ymd` in `tz` (00:00 that doesn't exist → first instant after the gap). */
export const zonedMidnight = (ymd: string, tz: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  // Iterate: guess UTC, measure the zone's wall clock there, correct by the difference.
  let t = target;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(new Date(t), tz);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const diff = wall - target;
    if (diff === 0) break;
    t -= diff;
  }
  // In a spring-forward gap the loop can land an hour early (on the previous day). Step forward.
  while (localDay(new Date(t), tz) < ymd) t += 60 * 60 * 1000;
  return new Date(t);
};

/** [start, end) of the squad week containing `date`. */
export const weekRange = (date: Date, tz: string): { key: string; start: Date; end: Date } => {
  const key = weekKey(date, tz);
  return { key, start: zonedMidnight(key, tz), end: zonedMidnight(addDays(key, 7), tz) };
};

// ── Leaderboard ──────────────────────────────────────────────────────────────

export interface RankInput { uid: string; name: string; value: number }
export interface Ranked extends RankInput { rank: number; tied: boolean }

/**
 * Highest first; equal values share a rank and the next rank skips
 * ("1, 1, 3"). Ties are listed by name so the order is stable between renders.
 */
export const rankMembers = (rows: RankInput[]): Ranked[] => {
  const sorted = [...rows]
    .map((r) => ({ ...r, value: Number.isFinite(r.value) && r.value > 0 ? r.value : 0 }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
  return sorted.map((r, i) => {
    const first = sorted.findIndex((x) => x.value === r.value);
    const tied = sorted.filter((x) => x.value === r.value).length > 1;
    return { ...r, rank: first + 1, tied };
  });
};

export const squadTotal = (rows: { value: number }[]): number =>
  rows.reduce((s, r) => s + (Number.isFinite(r.value) && r.value > 0 ? r.value : 0), 0);

/** 0–100, whole. */
export const progressPct = (total: number, goal: number): number =>
  goal > 0 ? Math.max(0, Math.min(100, Math.floor((total / goal) * 100))) : 0;

/**
 * Who becomes owner when the owner leaves: the longest-standing remaining
 * member (earliest joinedAt; uid breaks an exact tie). null when nobody is left.
 */
export const nextOwner = (
  members: Record<string, { joinedAt: number }>,
  leaving: string,
): string | null => {
  const rest = Object.entries(members).filter(([uid]) => uid !== leaving);
  if (!rest.length) return null;
  rest.sort((a, b) => (a[1].joinedAt - b[1].joinedAt) || a[0].localeCompare(b[0]));
  return rest[0][0];
};

/** "3d 4h" until the week resets. */
export const formatResetIn = (ms: number): string => {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
};
