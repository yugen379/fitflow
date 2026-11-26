/**
 * Squads — client side. Membership changes go through callable functions
 * (functions/src/squads.ts); the only thing a client writes directly is its
 * own weekly numbers doc, squads/{id}/weekly/{weekKey}_{uid}, which the rules
 * validate field by field.
 *
 * Loaded only by the Squads page and the deferred SquadSyncWatcher, never on
 * the boot path.
 */
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where,
} from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';

import { app } from '../lib/firebase';
import { db } from '../lib/firestore';
import {
  SQUADS_PER_USER, SquadMetric, clampWeekValue, safeTimeZone, weekDays, weekRange, localDay,
} from '../lib/squadUtils';
import { t } from '../i18n/i18n';

export interface SquadMember { name: string; photoURL: string; joinedAt: number }
export interface Squad {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  members: Record<string, SquadMember>;
  tz: string;
  metric: SquadMetric;
  goal: number;
  code: string;
}
export interface SquadWeek { uid: string; weekKey: string; steps: number; activeDays: number; workouts: number }

const toSquad = (id: string, d: Record<string, unknown>): Squad => ({
  id,
  name: String(d.name || 'Squad'),
  ownerId: String(d.ownerId || ''),
  memberIds: Array.isArray(d.memberIds) ? (d.memberIds as string[]) : [],
  members: (d.members as Record<string, SquadMember>) || {},
  tz: safeTimeZone(d.tz),
  metric: (['steps', 'activeDays', 'workouts'].includes(String(d.metric)) ? d.metric : 'steps') as SquadMetric,
  goal: Number(d.goal) || 0,
  code: String(d.code || ''),
});

// ── Callables ────────────────────────────────────────────────────────────────
const call = async <T>(name: string, data: unknown): Promise<T> => {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const res = await httpsCallable(getFunctions(app), name, { timeout: 20_000 })(data);
  return res.data as T;
};

/** A message a person can act on, from a callable error. */
export const squadErrorMessage = (e: unknown): string => {
  const err = e as { code?: string; message?: string };
  const code = String(err?.code || '').replace('functions/', '');
  if (code === 'unavailable' || code === 'internal' || code === 'deadline-exceeded') return t("Can't reach FitFlow right now. Try again.");
  if (code === 'unauthenticated') return t('Sign in again to use squads.');
  return err?.message && code ? err.message : t('Something went wrong. Try again.');
};

export const createSquad = (input: { name: string; metric: SquadMetric; goal?: number }) =>
  call<{ squadId: string; code: string }>('createSquad', {
    ...input, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
export const joinSquad = (code: string) => call<{ squadId: string; name: string; already: boolean }>('joinSquad', { code });
export const leaveSquad = (squadId: string) => call<{ result: string }>('leaveSquad', { squadId });
export const removeMember = (squadId: string, memberUid: string) =>
  call<{ result: string }>('manageSquad', { squadId, action: 'remove', memberUid });
export const renameSquad = (squadId: string, name: string) =>
  call<{ name: string }>('manageSquad', { squadId, action: 'rename', name });
export const setChallenge = (squadId: string, metric: SquadMetric, goal: number) =>
  call<{ metric: SquadMetric; goal: number }>('manageSquad', { squadId, action: 'challenge', metric, goal });

// ── Reads ────────────────────────────────────────────────────────────────────
const mySquadsQuery = (uid: string) =>
  query(collection(db, 'squads'), where('memberIds', 'array-contains', uid), limit(SQUADS_PER_USER));

export const watchMySquads = (uid: string, next: (s: Squad[]) => void, onError: (e: unknown) => void): Unsubscribe =>
  onSnapshot(mySquadsQuery(uid), (snap) => next(snap.docs.map((d) => toSquad(d.id, d.data()))), onError);

export const watchSquad = (id: string, next: (s: Squad | null) => void, onError: (e: unknown) => void): Unsubscribe =>
  onSnapshot(doc(db, 'squads', id), (d) => next(d.exists() ? toSquad(d.id, d.data()) : null), onError);

export const watchWeek = (squadId: string, weekKey: string, next: (w: SquadWeek[]) => void, onError: (e: unknown) => void): Unsubscribe =>
  onSnapshot(
    query(collection(db, 'squads', squadId, 'weekly'), where('weekKey', '==', weekKey)),
    (snap) => next(snap.docs.map((d) => d.data() as SquadWeek)),
    onError,
  );

// ── Measuring and publishing my week ─────────────────────────────────────────
/**
 * My numbers for the squad week [start, end): steps and active days from my
 * own per-day docs (step_days / activity_days, read by id — the rules allow
 * that by uid prefix), workouts from my workouts in the time range.
 */
export const measureWeek = async (uid: string, tz: string, now = new Date()) => {
  const r = weekRange(now, tz);
  // My days are keyed by MY local calendar; the squad week is a calendar
  // week in the squad's zone. Count the squad's Monday..Sunday dates, up to today.
  const today = localDay(now, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const days = weekDays(r.key).filter((d) => d <= today);
  const [stepDocs, activeDocs, workoutSnap] = await Promise.all([
    Promise.all(days.map((d) => getDoc(doc(db, 'step_days', `${uid}_${d}`)).catch(() => null))),
    Promise.all(days.map((d) => getDoc(doc(db, 'activity_days', `${uid}_${d}`)).catch(() => null))),
    getDocs(query(
      collection(db, 'workouts'),
      where('userId', '==', uid),
      where('timestamp', '>=', Timestamp.fromDate(r.start)),
      where('timestamp', '<', Timestamp.fromDate(r.end)),
    )).catch(() => null),
  ]);
  const steps = stepDocs.reduce((s, d) => s + (d?.exists() ? Number(d.data().steps) || 0 : 0), 0);
  const activeDays = activeDocs.filter((d) => d?.exists()).length;
  return {
    weekKey: r.key,
    steps: clampWeekValue('steps', steps),
    activeDays: clampWeekValue('activeDays', activeDays),
    workouts: clampWeekValue('workouts', workoutSnap?.size ?? 0),
  };
};

const lastPublished = new Map<string, string>();

/** Write my weekly doc for one squad, skipping the write when nothing changed. */
export const publishMyWeek = async (uid: string, squad: Pick<Squad, 'id' | 'tz'>, now = new Date()) => {
  const m = await measureWeek(uid, squad.tz, now);
  const id = `${m.weekKey}_${uid}`;
  const sig = `${squad.id}/${id}:${m.steps}/${m.activeDays}/${m.workouts}`;
  if (lastPublished.get(`${squad.id}/${id}`) === sig) return m;
  await setDoc(doc(db, 'squads', squad.id, 'weekly', id), { uid, ...m, updatedAt: serverTimestamp() });
  lastPublished.set(`${squad.id}/${id}`, sig);
  return m;
};

/** Every squad I'm in, once. Used by the background watcher. */
export const publishAllMyWeeks = async (uid: string): Promise<number> => {
  const snap = await getDocs(mySquadsQuery(uid));
  let n = 0;
  for (const d of snap.docs) {
    try {
      await publishMyWeek(uid, toSquad(d.id, d.data()));
      n++;
    } catch {
      /* one squad failing must not stop the others */
    }
  }
  return n;
};
