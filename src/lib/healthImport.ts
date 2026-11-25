/**
 * Turning Health Connect records into FitFlow data. Pure (no Capacitor, no
 * Firebase) so scripts/health-import-proof.mjs can test every rule.
 *
 * Weight is the valuable one: a smart scale (Xiaomi, Withings, Eufy, Renpho…)
 * writes to Health Connect, and every weigh-in it records feeds the smart
 * calorie target without the user typing anything.
 */
import { localDate } from './adaptiveTarget';

export interface HcWeightRecord {
  /** ISO time of the measurement. */
  time: string;
  /** Kilograms (already converted from the record's unit). */
  kg: number;
}

/** Health Connect mass -> kg. The plugin reports { value, unit }. */
export const massToKg = (m: { value?: unknown; unit?: unknown } | null | undefined): number | null => {
  const v = Number(m?.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  // The plugin says 'pound', 'gram'… (singular); accept plurals too.
  switch (String(m?.unit || 'kilogram').toLowerCase().replace(/s$/, '')) {
    case 'gram': return v / 1000;
    case 'milligram': return v / 1e6;
    case 'microgram': return v / 1e9;
    case 'pound': return v * 0.45359237;
    case 'ounce': return v * 0.028349523125;
    default: return v; // kilograms
  }
};

/**
 * Which Health Connect weigh-ins to add: one per local day (the latest that
 * day), only for days the user has NO weigh-in yet (a weight they typed always
 * wins), only plausible values (25-400 kg), and none in the future. Returns
 * newest first, at most `max`.
 */
export const weightsToImport = (
  records: HcWeightRecord[],
  existingDates: Iterable<string>,
  now: Date = new Date(),
  max = 60,
): { date: string; kg: number; at: Date }[] => {
  const have = new Set(existingDates);
  const byDay = new Map<string, { kg: number; at: Date }>();
  for (const r of records || []) {
    const at = new Date(r?.time);
    const kg = Number(r?.kg);
    if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 60_000) continue;
    if (!Number.isFinite(kg) || kg < 25 || kg > 400) continue;
    const date = localDate(at);
    if (have.has(date)) continue;
    const prev = byDay.get(date);
    if (!prev || at > prev.at) byDay.set(date, { kg: Math.round(kg * 10) / 10, at });
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, max);
};

/** Deterministic id so a re-sync can never add the same day twice. */
export const importedWeightId = (uid: string, date: string): string =>
  `${uid}_hc_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

/**
 * Resting heart rate for today: the latest Health Connect sample, if it is a
 * plausible human value (30-120 bpm).
 */
export const latestRestingHr = (records: { time?: string; bpm?: unknown }[]): number | null => {
  let best: { t: number; bpm: number } | null = null;
  for (const r of records || []) {
    const t = Date.parse(String(r?.time));
    const bpm = Number(r?.bpm);
    if (!Number.isFinite(t) || !Number.isFinite(bpm) || bpm < 30 || bpm > 120) continue;
    if (!best || t > best.t) best = { t, bpm: Math.round(bpm) };
  }
  return best ? best.bpm : null;
};

// ---- Sleep ---------------------------------------------------------------------
export interface HcSleepSession { start: string; end: string; stages?: { stage: number; start: string; end: string }[] }
export interface NightSummary { minutes: number; deepMin: number; remMin: number; lightMin: number; awakeMin: number; start: string; end: string }

const AWAKE_STAGES = new Set([1, 3, 7]);   // awake, out of bed, awake in bed
const mins = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60_000);

/**
 * Last night's sleep: every session that ENDED between 18:00 yesterday and
 * now (a split night counts once, as the sum), asleep time = session length
 * minus awake stages. Sessions longer than 16 h or with bad times are ignored
 * (a watch left recording). Null when there was no sleep recorded.
 */
export const summarizeLastNight = (sessions: HcSleepSession[], now: Date = new Date()): NightSummary | null => {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  windowStart.setHours(18, 0, 0, 0);
  const night = (sessions || []).filter((s) => {
    const e = Date.parse(s?.end), b = Date.parse(s?.start);
    return Number.isFinite(e) && Number.isFinite(b) && e > b && e > windowStart.getTime() && e <= now.getTime() + 60_000 && (e - b) <= 16 * 3_600_000;
  });
  if (!night.length) return null;
  let total = 0, deep = 0, rem = 0, light = 0, awake = 0;
  for (const s of night) {
    total += mins(s.start, s.end);
    for (const st of s.stages || []) {
      const m = mins(st.start, st.end);
      if (AWAKE_STAGES.has(st.stage)) awake += m;
      else if (st.stage === 5) deep += m;
      else if (st.stage === 6) rem += m;
      else if (st.stage === 4) light += m;
    }
  }
  const asleep = Math.max(0, total - awake);
  if (asleep < 30) return null;   // a nap-length blip is not "last night"
  const starts = night.map((s) => Date.parse(s.start)), ends = night.map((s) => Date.parse(s.end));
  return {
    minutes: Math.round(asleep), deepMin: Math.round(deep), remMin: Math.round(rem), lightMin: Math.round(light), awakeMin: Math.round(awake),
    start: new Date(Math.min(...starts)).toISOString(), end: new Date(Math.max(...ends)).toISOString(),
  };
};

/** Sleep quality 1-5 for the sleep log: hours first, then deep + REM share when stages exist. */
export const sleepQuality = (n: NightSummary): number => {
  const h = n.minutes / 60;
  let q = h >= 7 ? 4 : h >= 6 ? 3 : h >= 5 ? 2 : 1;
  const staged = n.deepMin + n.remMin + n.lightMin;
  if (staged > 0 && (n.deepMin + n.remMin) / staged >= 0.4 && h >= 7) q = 5;
  return q;
};

export const importedSleepId = (uid: string, date: string): string =>
  `${uid}_hcsleep_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
