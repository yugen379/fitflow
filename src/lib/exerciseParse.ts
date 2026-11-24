// ---------------------------------------------------------------------------
// AI plans return exercises as prose: "Bodyweight Squats (3 sets of 10-12
// repetitions)". The session used to paste that whole string into the title
// and open every move at 3 x 10 @ 20 kg, including bodyweight squats and
// planks. This turns the prose into a clean name + prescription.
// ---------------------------------------------------------------------------

export interface ParsedExercise {
  name: string;
  id: string;
  sets?: number;
  reps?: number;
  weight?: number;
  bodyweight: boolean;
  [k: string]: unknown;
}

const BODYWEIGHT = /\b(bodyweight|body weight|push[- ]?ups?|plank|burpees?|crunch(es)?|sit[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|dips?|mountain climbers?|jumping jacks?|glute bridges?|bird[- ]?dogs?|dead ?bugs?|air squats?|wall sits?|high knees|stretch(es|ing)?|jog(ging)?|march(ing)?|run(ning)?|walk(ing)?|jump(s|ing)?|skip(ping)?|in place|cardio|lunges?|step[- ]?ups?|yoga|mobility|warm[- ]?up|cool[- ]?down)\b/i;
// A move naming equipment is loaded even if it also matches above ("dumbbell lunges").
const LOADED = /\b(dumbbells?|barbell|kettlebells?|weights?|cable|machine|band|bottles?)\b/i;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise';

export const parseExercise = (raw: unknown): ParsedExercise => {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = String(typeof raw === 'string' ? raw : obj.name ?? '').trim();

  // Clean name = text before the first "(" (the prescription lives inside).
  const name = (text.split('(')[0].trim() || text || 'Exercise').replace(/\s+/g, ' ');
  const detail = text.slice(name.length);

  const setsM = detail.match(/(\d+)\s*sets?/i);
  const repsM = detail.match(/(?:of|x|×)\s*(\d+)(?:\s*[-–]\s*\d+)?\s*(?:reps?|repetitions?)?/i)
    || detail.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*(?:reps?|repetitions?)/i);

  // Judge the clean name only: the prose ("using light weights or water
  // bottles") would otherwise flip a decision either way.
  const bodyweight = BODYWEIGHT.test(name) && !LOADED.test(name);
  const out: ParsedExercise = {
    ...obj,
    name,
    id: typeof obj.id === 'string' && obj.id ? obj.id : slug(name),
    bodyweight,
  };
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  out.sets = num(obj.sets) ?? (setsM ? Number(setsM[1]) : undefined);
  out.reps = num(obj.reps) ?? (repsM ? Number(repsM[1]) : undefined);
  out.weight = bodyweight ? 0 : num(obj.weight);
  return out;
};

/** "MOBILITY_FLOW" / "full_body" → "Full body". */
export const prettyLabel = (s?: string | null) => {
  const t = String(s ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};
