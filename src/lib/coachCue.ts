// What the Coach card says during a session.
//
// The progression record is weight-centric (suggestedWeight / suggestedReps),
// so the card used to read "Try 20kg × 10 reps" for EVERY session — including
// Swimming, Cycling and Cardio, where kilograms and reps mean nothing. The
// number was real for strength and meaningless everywhere else.
//
// The `trend` itself is modality-agnostic: it comes from how hard the last
// session felt (difficulty) and whether it was completed, which is just as true
// of a swim as of a squat. So the trend is kept and only the SENTENCE changes.
//
// HONESTY BOUNDARY: FitFlow does not measure cardio distance, pace, laps or
// heart-rate zones during a session — only elapsed time. So nothing here quotes
// a pace, a split or a distance. The cues say what to do with effort, which is
// what the recorded data actually supports.

export type Modality = 'strength' | 'cardio' | 'cycling' | 'swimming';

export type Trend = 'up' | 'down' | 'stable';

/** Map a workout type (or exercise name) onto a coaching modality. */
export const modalityOf = (workoutType?: string | null): Modality => {
  const t = String(workoutType ?? '').toLowerCase();
  if (/cycl|bike|spin|ride/.test(t)) return 'cycling';
  if (/swim|pool|lap/.test(t)) return 'swimming';
  if (/cardio|run|jog|treadmill|row|elliptical|walk/.test(t)) return 'cardio';
  return 'strength';
};

/** True when reps and kilograms are the wrong vocabulary for this session. */
export const isEndurance = (m: Modality): boolean => m !== 'strength';

export interface CoachCue {
  /** Full sentence, already correct for the modality. */
  text: string;
  /**
   * The part of `text` worth emphasising (the load for strength, empty for
   * endurance, where the whole sentence is the advice). Always a substring of
   * `text`, so the renderer can split on it without guessing.
   */
  highlight: string;
  /** Short chip next to the sentence. */
  trendLabel: string;
}

const TREND_LABEL: Record<Modality, Record<Trend, string>> = {
  // Strength keeps the lifting vocabulary the user already knows.
  strength: { up: '↑ Progressing', down: '↓ Deload', stable: '→ Maintain' },
  // "Deload" is a barbell word; endurance athletes recover, they do not deload.
  cardio: { up: '↑ Build', down: '↓ Recover', stable: '→ Maintain' },
  cycling: { up: '↑ Build', down: '↓ Recover', stable: '→ Maintain' },
  swimming: { up: '↑ Build', down: '↓ Recover', stable: '→ Maintain' },
};

const ENDURANCE_TEXT: Record<Exclude<Modality, 'strength'>, Record<Trend, string>> = {
  cardio: {
    up: 'Last one felt easy — add five minutes or lift the pace a notch.',
    down: 'Last one was hard. Keep it conversational today.',
    stable: 'Hold a steady pace you could repeat tomorrow.',
  },
  cycling: {
    up: 'Last ride felt easy — add five minutes or push a harder gear.',
    down: 'Last ride was hard. Spin light and keep the legs fresh.',
    stable: 'Hold a steady cadence you could sustain for the whole ride.',
  },
  swimming: {
    up: 'Last swim felt easy — add a few lengths or shorten your rest.',
    down: 'Last swim was hard. Swim easy and focus on a long stroke.',
    stable: 'Hold your pace and keep the stroke long and relaxed.',
  },
};

/** Round a suggested load for display: 22.5 stays 22.5, 20.0 shows as 20. */
const tidyWeight = (kg: unknown): string => {
  const n = Number(kg);
  if (!Number.isFinite(n) || n < 0) return '0';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const tidyReps = (reps: unknown): number => {
  const n = Number(reps);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.round(n);
};

/**
 * The Coach line for this session.
 *
 * Strength quotes the actual suggested load. Endurance never does — it returns
 * an empty `highlight`, and the caller renders the sentence plainly.
 */
export const coachCueFor = (
  modality: Modality,
  trend: Trend,
  suggestion: { suggestedWeight?: number | null; suggestedReps?: number | null } = {},
): CoachCue => {
  const safeTrend: Trend = trend === 'up' || trend === 'down' ? trend : 'stable';
  const trendLabel = TREND_LABEL[modality][safeTrend];

  if (isEndurance(modality)) {
    return {
      text: ENDURANCE_TEXT[modality][safeTrend],
      highlight: '',
      trendLabel,
    };
  }

  const highlight = `${tidyWeight(suggestion.suggestedWeight)}kg × ${tidyReps(suggestion.suggestedReps)} reps`;
  return { text: `Try ${highlight}`, highlight, trendLabel };
};
