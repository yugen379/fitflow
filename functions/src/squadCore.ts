/**
 * Server copy of the squad rules that matter for security. MUST agree with
 * src/lib/squadUtils.ts — `npm run proof:squads` imports both and fails if
 * they disagree on any code, name, goal, time zone or owner hand-over.
 * No Firebase imports here, so the proof can load it in plain Node.
 */
export type SquadMetric = "steps" | "activeDays" | "workouts";
export const SQUAD_METRICS: SquadMetric[] = ["steps", "activeDays", "workouts"];
export const SQUAD_MAX_MEMBERS = 10;
export const SQUADS_PER_USER = 5;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const GOAL_LIMITS: Record<SquadMetric, { min: number; max: number; def: number }> = {
  steps: { min: 1_000, max: 5_000_000, def: 200_000 },
  activeDays: { min: 1, max: 70, def: 20 },
  workouts: { min: 1, max: 500, def: 15 },
};

export const generateCode = (rand: (n: number) => number): string => {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return s;
};

export const normalizeCode = (input: unknown): string | null => {
  if (typeof input !== "string" || input.length > 32) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(s) ? s : null;
};

/** Control, zero-width and bidi-override characters, plus angle brackets. */
const ch = (n: number) => String.fromCharCode(n);
const UNSAFE_CHARS = new RegExp(
  "[\\x00-\\x1f\\x7f-\\x9f" + ch(0x200b) + "-" + ch(0x200f) + ch(0x2028) + "-" + ch(0x202e) +
  ch(0x2066) + "-" + ch(0x2069) + "<>]", "g");

export const sanitizeSquadName =(input: unknown): string | null => {
  if (typeof input !== "string" || input.length > 200) return null;
  const s = input
    // eslint-disable-next-line no-control-regex
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  const len = [...s].length;
  return len >= 2 && len <= 30 ? s : null;
};

export const isSquadMetric = (m: unknown): m is SquadMetric =>
  typeof m === "string" && (SQUAD_METRICS as string[]).includes(m);

export const sanitizeGoal = (metric: SquadMetric, goal: unknown): number | null => {
  const n = typeof goal === "number" ? goal : typeof goal === "string" ? Number(goal) : NaN;
  if (!Number.isFinite(n)) return null;
  const g = Math.round(n);
  const { min, max } = GOAL_LIMITS[metric];
  return g >= min && g <= max ? g : null;
};

export const isValidTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const nextOwner = (
  members: Record<string, { joinedAt: number }>,
  leaving: string,
): string | null => {
  const rest = Object.entries(members).filter(([uid]) => uid !== leaving);
  if (!rest.length) return null;
  rest.sort((a, b) => (a[1].joinedAt - b[1].joinedAt) || a[0].localeCompare(b[0]));
  return rest[0][0];
};

/** Display name for a member card: printable, ≤ 40 chars, never empty. */
export const cleanDisplayName = (v: unknown): string => {
  const s = typeof v === "string"
    // eslint-disable-next-line no-control-regex
    ? v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, "").replace(/\s+/g, " ").trim()
    : "";
  return [...s].slice(0, 40).join("") || "Athlete";
};

/** Only https photo URLs, bounded; anything else becomes "" (initials avatar). */
export const cleanPhotoURL = (v: unknown): string =>
  typeof v === "string" && /^https:\/\//.test(v) && v.length <= 1024 ? v : "";

/**
 * Sliding-window attempt limiter state. Pure so the proof can drive it.
 * Returns the new timestamps list and whether this attempt is allowed.
 */
export const JOIN_WINDOW_MS = 60 * 60 * 1000;
export const JOIN_MAX_PER_WINDOW = 10;
export const takeAttempt = (prev: unknown, now: number): { allowed: boolean; times: number[] } => {
  const times = (Array.isArray(prev) ? prev : [])
    .filter((t): t is number => typeof t === "number" && now - t < JOIN_WINDOW_MS && t <= now)
    .slice(-JOIN_MAX_PER_WINDOW);
  if (times.length >= JOIN_MAX_PER_WINDOW) return { allowed: false, times };
  return { allowed: true, times: [...times, now] };
};
