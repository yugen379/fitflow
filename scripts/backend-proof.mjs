// Backend proof: account deletion + server-authoritative XP, end to end.
//
//   npm run proof:backend
//
// Runs inside the Auth + Firestore + Functions emulators with the real
// functions/lib build and the real firestore.rules. Users sign in through the
// Auth emulator and call the deployed-shape callables through the client SDK,
// exactly as the app does. Seed data is written with the Admin SDK (rules
// bypassed) so the test controls precisely what exists before each call.
//
// Uses a demo project id, so nothing here can touch production.

import { createRequire } from 'node:module';
import { initializeApp as initClient } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  getFirestore as getClientDb, connectFirestoreEmulator, doc as cdoc, setDoc as csetDoc,
  updateDoc as cupdateDoc, serverTimestamp as cserverTimestamp,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { computeLevel } from '../src/services/missionUtils';

// firebase-admin lives in functions/node_modules; resolve it from there.
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { getFirestore: getAdminDb } = require('firebase-admin/firestore');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fitflow';
const DBID = 'ai-studio-0bcd2aaf-b5da-4706-b41f-bfc7daa1974e';
const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}${detail ? `  ${C.d}${detail}${C.x}` : ''}`); }
};
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

// --- Admin (seeding / inspection) -------------------------------------------
const adminApp = admin.initializeApp({ projectId: PROJECT });
const adb = getAdminDb(adminApp, DBID);
const exists = async (path) => (await adb.doc(path).get()).exists;
const ts = admin.firestore.Timestamp;

// --- Client (what the app runs) ---------------------------------------------
const clientApp = initClient({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` });
const auth = getAuth(clientApp);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const cdb = getClientDb(clientApp, DBID);
connectFirestoreEmulator(cdb, '127.0.0.1', 8080);
const fns = getFunctions(clientApp);
connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);
const callErr = async (name, data) => {
  try { await call(name, data); return 'ok'; } catch (e) { return String(e?.code || e?.message || e); }
};

const emails = {};
const newUser = async (tag) => {
  const email = `${tag}-${Date.now()}@proof.test`;
  const cred = await createUserWithEmailAndPassword(auth, email, 'proof-pass-123');
  emails[cred.user.uid] = email;
  return cred.user.uid;
};
const seedUser = (uid, extra = {}) => adb.doc(`users/${uid}`).set({
  uid, displayName: uid.slice(0, 6), photoURL: '', subscriptionType: 'free',
  streak: 0, points: 0, level: 1, badges: [], tzOffsetHours: 8,
  createdAt: ts.now(), ...extra,
});

// =============================================================================
section('1 · Account deletion');

const bob = await newUser('bob');
await seedUser(bob);
await signOut(auth);
const alice = await newUser('alice');
await seedUser(alice);

const COLLECTIONS = [
  'meals', 'workouts', 'water_logs', 'sleep_logs', 'wellness_logs', 'weight_history',
  'body_metrics', 'activity_routes', 'notifications', 'activity_days', 'streak_freezes',
  'workout_plans', 'step_days',
];
for (const c of COLLECTIONS) {
  await adb.doc(`${c}/${alice}_x`).set({ userId: alice, v: 1 });
  await adb.doc(`${c}/${bob}_x`).set({ userId: bob, v: 1 });
}
// Alice's post, with Bob's comment and like under it.
await adb.doc('posts/alicePost').set({ userId: alice, content: 'hi', likesCount: 1, commentsCount: 1 });
await adb.doc('posts/alicePost/comments/c1').set({ userId: bob, content: 'nice' });
await adb.doc(`posts/alicePost/likes/${bob}`).set({ userId: bob });
// Bob's post, with Alice's comment and like under it.
await adb.doc('posts/bobPost').set({ userId: bob, content: 'yo', likesCount: 1, commentsCount: 1 });
await adb.doc('posts/bobPost/comments/c2').set({ userId: alice, content: 'cool' });
await adb.doc(`posts/bobPost/likes/${alice}`).set({ userId: alice });
// Follow edges in both directions.
await adb.doc(`users/${alice}/following/${bob}`).set({ at: 1 });
await adb.doc(`users/${bob}/followers/${alice}`).set({ at: 1 });
await adb.doc(`users/${bob}/following/${alice}`).set({ at: 1 });
await adb.doc(`users/${alice}/followers/${bob}`).set({ at: 1 });
// uid-keyed docs and subcollections.
await adb.doc(`meal_plans/${alice}`).set({ plan: [] });
await adb.doc(`weekly_recaps/${alice}_2026-W44`).set({ recap: {} });
await adb.doc(`weekly_recaps/${alice}_2026-W45`).set({ recap: {} });
await adb.doc(`weekly_recaps/${bob}_2026-W44`).set({ recap: {} });
await adb.doc(`users/${alice}/progression/squat`).set({ w: 100 });
await adb.doc(`public_profiles/${alice}`).set({ displayName: 'alice' });

const result = await callErr('deleteAccount');
check('signed-in user can delete their account', result === 'ok', `got ${result}`);

const leftovers = [];
for (const c of COLLECTIONS) if (await exists(`${c}/${alice}_x`)) leftovers.push(c);
check('every userId collection is emptied (incl. step_days)', leftovers.length === 0, `left: ${leftovers.join(', ')}`);
check('their own post is deleted with its comments and likes',
  !(await exists('posts/alicePost')) && !(await exists('posts/alicePost/comments/c1')) && !(await exists(`posts/alicePost/likes/${bob}`)));
check('their comment on another user\'s post is deleted', !(await exists('posts/bobPost/comments/c2')));
check('their like on another user\'s post is deleted', !(await exists(`posts/bobPost/likes/${alice}`)));
const bobPost = (await adb.doc('posts/bobPost').get()).data() || {};
check('that post\'s counters drop back (1 -> 0)', bobPost.commentsCount === 0 && bobPost.likesCount === 0,
  `comments=${bobPost.commentsCount} likes=${bobPost.likesCount}`);
check('follow edges on the other user are removed',
  !(await exists(`users/${bob}/followers/${alice}`)) && !(await exists(`users/${bob}/following/${alice}`)));
check('weekly recaps are deleted (the old range matched nothing)',
  !(await exists(`weekly_recaps/${alice}_2026-W44`)) && !(await exists(`weekly_recaps/${alice}_2026-W45`)));
check('meal plan, profile, subcollections and public profile are deleted',
  !(await exists(`meal_plans/${alice}`)) && !(await exists(`users/${alice}`)) &&
  !(await exists(`users/${alice}/progression/squat`)) && !(await exists(`public_profiles/${alice}`)));
let authGone = false;
try { await admin.auth().getUser(alice); } catch (e) { authGone = e?.code === 'auth/user-not-found'; }
check('their sign-in is deleted', authGone);

const bobIntact = [];
for (const c of COLLECTIONS) if (!(await exists(`${c}/${bob}_x`))) bobIntact.push(c);
check('another user\'s data is untouched', bobIntact.length === 0 && await exists('posts/bobPost') &&
  await exists(`weekly_recaps/${bob}_2026-W44`) && await exists(`users/${bob}`), `lost: ${bobIntact.join(', ')}`);

await signOut(auth);
check('a signed-out caller is refused', (await callErr('deleteAccount')) === 'functions/unauthenticated');

// =============================================================================
section('2 · Leaderboard: the app can no longer write a score');

const carol = await newUser('carol');
// Create the profile through the CLIENT, so the real create rule runs.
const carolRef = cdoc(cdb, 'users', carol);
await csetDoc(carolRef, {
  uid: carol, displayName: 'Carol', photoURL: '', subscriptionType: 'free',
  streak: 0, points: 0, level: 1, badges: [], tzOffsetHours: 8, createdAt: cserverTimestamp(),
}).then(() => check('a new profile starting at 0 XP is accepted', true))
  .catch((e) => check('a new profile starting at 0 XP is accepted', false, e?.code));

const denied = async (data) => cupdateDoc(carolRef, data).then(() => false).catch((e) => e?.code === 'permission-denied');
check('the app cannot set points', await denied({ points: 9999999 }));
check('the app cannot set level', await denied({ level: 99 }));
check('the app cannot add badges', await denied({ badges: ['centurion'] }));
check('normal profile edits still work', await cupdateDoc(carolRef, { displayName: 'Carol K' }).then(() => true).catch(() => false));
await signOut(auth);
const dave = await newUser('dave');
const forgedCreate = await csetDoc(cdoc(cdb, 'users', dave), {
  uid: dave, displayName: 'Dave', photoURL: '', subscriptionType: 'free',
  streak: 0, points: 5000, level: 1, badges: [], createdAt: cserverTimestamp(),
}).then(() => false).catch((e) => e?.code === 'permission-denied');
check('a new profile cannot be CREATED with 5,000 XP either', forgedCreate);
await signOut(auth);

// Old app versions (v1.6.1 and earlier) still finish onboarding by writing the
// starter grant themselves; that exact one-time step must keep working.
const erin = await newUser('erin');
const erinRef = cdoc(cdb, 'users', erin);
await csetDoc(erinRef, {
  uid: erin, displayName: 'Erin', photoURL: '', subscriptionType: 'free',
  streak: 0, points: 0, level: 1, badges: [], createdAt: cserverTimestamp(),
});
const erinTry = (data) => cupdateDoc(erinRef, data).then(() => 'ok').catch((e) => e?.code);
check('a tampered starter grant is refused (100 XP but Level 99)',
  (await erinTry({ points: 100, level: 99, badges: ['pioneer'] })) === 'permission-denied');
check('a bigger "starter grant" is refused (5,000 XP)',
  (await erinTry({ points: 5000, level: 2, badges: ['pioneer'] })) === 'permission-denied');
check('an old app version can still finish onboarding (0 -> 100 XP, L2, Pioneer)',
  (await erinTry({ age: 30, goal: 'lose', points: 100, level: 2, badges: ['pioneer'] })) === 'ok');
check('...but only once (100 -> 200 refused)',
  (await erinTry({ points: 200 })) === 'permission-denied');
check('...and badges cannot be added afterwards',
  (await erinTry({ badges: ['pioneer', 'centurion'] })) === 'permission-denied');
await signOut(auth);
// Back to Carol for the XP section (sign in via a fresh account would lose her doc).
const { signInWithEmailAndPassword } = await import('firebase/auth');
await signInWithEmailAndPassword(auth, emails[carol], 'proof-pass-123');

section('3 · Server-awarded XP');
const award = (reason, refId) => call('awardXp', { reason, refId });
const awardErr = (reason, refId) => callErr('awardXp', { reason, refId });

for (let i = 1; i <= 9; i++) await adb.doc(`meals/carolMeal${i}`).set({ userId: carol, calories: 500 });
await adb.doc('meals/bobMeal').set({ userId: bob, calories: 500 });
await adb.doc('water_logs/carolWater').set({ userId: carol, amount: 500 });
await adb.doc('workouts/carolWorkout').set({ userId: carol, duration: 45 });
await adb.doc('wellness_logs/carolWell').set({ userId: carol, mood: 4 });
await adb.doc('activity_routes/realRun').set({ userId: carol, type: 'run', distance: 5, duration: 1800 });
await adb.doc('activity_routes/fakeRun').set({ userId: carol, type: 'run', distance: 40, duration: 600 });

let expected = 0;
const r1 = await award('meal', 'carolMeal1');
expected += 15;
check('a logged meal earns 15 XP', r1.awarded === 15, JSON.stringify(r1));
const r1b = await award('meal', 'carolMeal1');
check('the same meal cannot be claimed twice', r1b.awarded === 0 && r1b.duplicate === true, JSON.stringify(r1b));
check('another user\'s meal is refused', (await awardErr('meal', 'bobMeal')) === 'functions/permission-denied');
check('a meal that does not exist is refused', (await awardErr('meal', 'noSuchMeal')) === 'functions/permission-denied');
let mealTotal = 15;
let last;
for (let i = 2; i <= 9; i++) { last = await award('meal', `carolMeal${i}`); mealTotal += last.awarded; }
expected += mealTotal - 15;
check('meals are capped at 120 XP a day (9th meal earns 0)', mealTotal === 120 && last.awarded === 0 && last.capped === true,
  `total=${mealTotal} last=${JSON.stringify(last)}`);
const rw = await award('water', 'carolWater'); expected += rw.awarded;
check('500 ml water earns 20 XP (read from the log, not the app)', rw.awarded === 20, JSON.stringify(rw));
const rk = await award('workout', 'carolWorkout'); expected += rk.awarded;
check('a workout earns 40 XP', rk.awarded === 40);
const rl = await award('wellness', 'carolWell'); expected += rl.awarded;
check('a wellness check-in earns 30 XP', rl.awarded === 30);
const rr = await award('run', 'realRun'); expected += rr.awarded;
check('a believable 5 km run earns 500 XP', rr.awarded === 500, JSON.stringify(rr));
const rf = await award('run', 'fakeRun'); expected += rf.awarded;
check('a forged 40 km run in 10 minutes earns 0', rf.awarded === 0, JSON.stringify(rf));
const ro = await award('onboarding'); expected += ro.awarded;
check('onboarding grants 100 XP and the Pioneer badge', ro.awarded === 100 && ro.badgeGranted === true);
check('onboarding cannot be farmed', (await award('onboarding')).duplicate === true);
check('an unknown reason is refused', (await awardErr('cheat', 'x')) === 'functions/invalid-argument');
check('an unknown badge is refused', (await awardErr('badge', 'gold_god')) === 'functions/invalid-argument');
check('a badge the user has not earned is refused (Centurion < 1000 XP)',
  (await awardErr('badge', 'centurion')) === 'functions/failed-precondition');
const rb = await award('badge', 'iron_will'); expected += rb.awarded;
check('a badge grants 150 XP once', rb.awarded === 150 && rb.badgeGranted === true);
check('the same badge cannot be granted twice', (await award('badge', 'iron_will')).duplicate === true);

const carolDoc = (await adb.doc(`users/${carol}`).get()).data();
check('stored points equal exactly what was awarded', carolDoc.points === expected, `points=${carolDoc.points} expected=${expected}`);
check('stored level matches the curve', carolDoc.level === computeLevel(expected).level, `level=${carolDoc.level}`);
check('badges were written by the server', carolDoc.badges.includes('pioneer') && carolDoc.badges.includes('iron_will'));
await signOut(auth);
check('a signed-out caller cannot earn XP', (await awardErr('meal', 'carolMeal1')) === 'functions/unauthenticated');

section('4 · Server and app agree on levels');
const { levelFor } = require('./lib/xp.js');
let mismatch = null;
for (let p = 0; p <= 500000 && !mismatch; p += 7) if (levelFor(p) !== computeLevel(p).level) mismatch = p;
check('server level curve == app level curve for 0..500,000 XP', mismatch === null, `first mismatch at ${mismatch}`);

section('5 · Public leaderboard streak is clamped to account age');
await adb.doc(`users/${carol}`).update({ streak: 500, displayName: 'Carol S' });
let mirror = null;
for (let i = 0; i < 40; i++) {
  mirror = (await adb.doc(`public_profiles/${carol}`).get()).data();
  if (mirror?.displayName === 'Carol S') break;
  await new Promise((r) => setTimeout(r, 250));
}
check('a 500-day streak on a new account shows as 1 day', mirror?.streak === 1, JSON.stringify(mirror));
check('the mirror carries server-written points', mirror?.points === expected);

section('6 · Weekly recaps: batched, model-fallback, notification users only');
const { runWeeklyRecaps } = require('./lib/recaps.js');
const WEEK = `proof-${Date.now()}`;
const R = (n) => `recapUser${n}_${WEEK}`;
const recent = ts.fromMillis(Date.now() - 2 * 86_400_000);
const seedRecapUser = async (n, { notif = true, token = true, active = true } = {}) => {
  await adb.doc(`users/${R(n)}`).set({
    displayName: `R${n}`, notificationsEnabled: notif, goal: 'strength', currentStreak: 4,
    lastActiveDay: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    ...(token ? { fcmToken: `token-${n}` } : {}),
  });
  if (active) await adb.collection('meals').add({ userId: R(n), calories: 600, timestamp: recent });
};
for (let n = 1; n <= 6; n++) await seedRecapUser(n);
await seedRecapUser(7, { active: false });           // nothing logged this week
await seedRecapUser(8, { notif: false });            // can't receive the push
await seedRecapUser(9, { token: false });            // no device to push to
await seedRecapUser(10);                             // already has this week's recap
await adb.doc(`weekly_recaps/${R(10)}_${WEEK}`).set({ recap: { headline: 'old' } });

let live = 0, peak = 0;
const prompts = [];
const pushes = [];
const writeRecap = async (prompt) => {
  live++; peak = Math.max(peak, live);
  // Call number taken BEFORE awaiting: concurrent calls must each get their own.
  const k = prompts.push(prompt);
  await new Promise((r) => setTimeout(r, 40));
  live--;
  if (k === 3) return null;            // every model busy
  if (k === 4) return 'not json at all'; // a model answered with junk
  return JSON.stringify({ headline: `AI ${k}`, highlight: 'h', win: 'w', focus: 'f', nextStep: 'n' });
};
const sendPush = async (token, title, body) => { pushes.push({ token, title, body }); };
const ownRecapUsers = (rep) => rep; // report is global across the DB; assert on our docs below
const rep1 = ownRecapUsers(await runWeeklyRecaps({ weekId: WEEK, batchSize: 3, pauseMs: 30, writeRecap, sendPush }));
const docOf = async (n) => (await adb.doc(`weekly_recaps/${R(n)}_${WEEK}`).get()).data();
const written = [];
for (let n = 1; n <= 10; n++) if ((await docOf(n))?.recap && n !== 10) written.push(n);
check('recaps written for the 6 active users with notifications', written.join(',') === '1,2,3,4,5,6', `wrote ${written}`);
check('nobody without notifications or a device token is processed', !(await docOf(8)) && !(await docOf(9)));
check('a user with no activity that week is skipped (no AI spend)', !(await docOf(7)));
check('an existing recap is never regenerated', (await docOf(10))?.recap?.headline === 'old');
check('at most one batch (3) runs at a time', peak <= 3 && peak >= 2, `peak=${peak}`);
const sources = [];
for (let n = 1; n <= 6; n++) sources.push((await docOf(n)).source);
check('when every model is busy, the user still gets a recap from their numbers',
  sources.filter((s) => s === 'fallback').length === 2 && sources.filter((s) => s === 'ai').length === 4, sources.join(','));
const fb = (await Promise.all([1, 2, 3, 4, 5, 6].map(docOf))).find((d) => d.source === 'fallback');
check('the fallback recap is complete and uses real numbers',
  ['headline', 'highlight', 'win', 'focus', 'nextStep'].every((k) => fb.recap[k]) && /600 kcal/.test(fb.recap.highlight), fb?.recap?.highlight);
const ourPushes = pushes.filter((p) => /^token-[1-6]$/.test(p.token));
check('each of the 6 gets exactly one push with their headline', ourPushes.length === 6 && new Set(ourPushes.map((p) => p.token)).size === 6);
const rep2 = await runWeeklyRecaps({ weekId: WEEK, batchSize: 3, pauseMs: 0, writeRecap, sendPush });
check('a second pass the same Sunday writes nothing new (resumable)', rep2.written === 0 && rep2.skippedExisting >= 7, JSON.stringify(rep2));
const rep3 = await runWeeklyRecaps({ weekId: `${WEEK}-b`, batchSize: 3, pauseMs: 0, budgetMs: -1, writeRecap, sendPush });
check('a pass out of time budget stops cleanly for the next pass to finish', rep3.stoppedEarly === true && rep3.written === 0);

// Someone who has not opened the app for weeks must not even be read.
await seedRecapUser(11);
await adb.doc(`users/${R(11)}`).update({ lastActiveDay: '2020-01-01' });
await runWeeklyRecaps({ weekId: WEEK, batchSize: 3, pauseMs: 0, writeRecap, sendPush });
check('a recap pass does not read users inactive for over a week', !(await docOf(11)));

const aiCallsBefore = prompts.length;
const repNoAi = await runWeeklyRecaps({ weekId: `${WEEK}-c`, pauseMs: 0, pageSize: 2, aiBudgetMs: -1, writeRecap, sendPush });
const cDoc = (await adb.doc(`weekly_recaps/${R(1)}_${WEEK}-c`).get()).data();
check('past the AI budget, everyone still gets a recap from their numbers, with no AI calls',
  prompts.length === aiCallsBefore && repNoAi.aiWritten === 0 && repNoAi.fallbackWritten >= 7 && cDoc?.source === 'fallback', JSON.stringify(repNoAi));
const paged = [];
for (let n = 1; n <= 6; n++) paged.push((await adb.doc(`weekly_recaps/${R(n)}_${WEEK}-c`).get()).exists);
check('paging across small pages reaches every active user', paged.every(Boolean), paged.join(','));

section('7 · Scheduled pushes: only people who could be due, a page at a time');
const {
  pushFieldsFor, decideNudge, runEngagementNudges, runWorkoutReminders, runTrialReminders, refreshCommunityStats,
} = require('./lib/pushJobs.js');

const pf = (tzOffsetHours, preferredWorkoutTime) => pushFieldsFor({ tzOffsetHours, preferredWorkoutTime });
check('a +5:30 user at 08:00 gets a whole reminder hour (2.5 never matched)', pf(5.5, '08:00').pushReminderHourUtc === 2, JSON.stringify(pf(5.5, '08:00')));
check('reminder hour wraps across midnight', pf(-4, '23:00').pushReminderHourUtc === 3 && pf(8, '02:00').pushReminderHourUtc === 18);
check('no stored offset counts as UTC, as the jobs always did', pushFieldsFor({ preferredWorkoutTime: '08:00' }).pushTzBucket === 0);
check('no preferred time means no reminder hour', pushFieldsFor({ tzOffsetHours: 1 }).pushReminderHourUtc === null);

// The trigger keeps the fields current, and must not re-trigger itself forever.
const trigUid = `pushTrig_${WEEK}`;
await adb.doc(`users/${trigUid}`).set({ displayName: 'T', tzOffsetHours: 5.5, preferredWorkoutTime: '08:00' });
let trig;
for (let i = 0; i < 60; i++) {
  trig = (await adb.doc(`users/${trigUid}`).get()).data();
  if (trig.pushReminderHourUtc === 2) break;
  await new Promise((r) => setTimeout(r, 250));
}
check('a user write fills in the push fields', trig.pushTzBucket === 5.5 && trig.pushReminderHourUtc === 2, JSON.stringify(trig));
const settled = (await adb.doc(`users/${trigUid}`).get()).updateTime.toMillis();
await new Promise((r) => setTimeout(r, 2500));
check('that write does not re-trigger itself', (await adb.doc(`users/${trigUid}`).get()).updateTime.toMillis() === settled);

// The comparison: over a whole day, the narrowed queries must select exactly
// the people a scan of everyone would. Fields are seeded directly, in one batch.
const NOW = Date.UTC(2026, 10, 11, 0, 7);
const DAY = 86_400_000;
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = (a) => a[rnd(a.length)];
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const TZS = [undefined, -11, -8, -5, -3.5, 0, 1, 3, 5.5, 5.75, 8, 9.5, 12, 12.75, 14];
const PFX = `diff_${WEEK}_`;
const diffUsers = [];
for (let i = 0; i < 400; i++) {
  const tz = pick(TZS);
  const gap = pick([0, 1, 1, 1, 2, 3, 3, 5, 7, 7, 14, 14, 30, 30, 45]);
  const u = {
    notificationsEnabled: rnd(10) > 0,
    currentStreak: pick([0, 1, 2, 5, 40]),
    winbackLastTier: pick([0, 0, 0, 1, 3, 7]),
    ...(rnd(12) ? { fcmToken: `t${i}` } : {}),
    ...(tz === undefined ? {} : { tzOffsetHours: tz }),
    ...(rnd(10) ? { lastActiveDay: dayKey(NOW - gap * DAY) } : {}),
    ...(rnd(3) === 0 ? { lastMealAt: ts.fromMillis(NOW - rnd(2 * DAY)) } : {}),
    ...(rnd(4) === 0 ? { mealNudgeDate: dayKey(NOW + rnd(2) * DAY) } : {}),
    ...(rnd(4) === 0 ? { streakRiskNotifiedDate: dayKey(NOW + rnd(2) * DAY) } : {}),
  };
  diffUsers.push({ uid: `${PFX}${i}`, ...u, ...pushFieldsFor(u) });
}
for (let i = 0; i < diffUsers.length; i += 200) {
  const b = adb.batch();
  for (const { uid, ...u } of diffUsers.slice(i, i + 200)) b.set(adb.doc(`users/${uid}`), u);
  await b.commit();
}
// The seed's own trigger runs must settle before the comparison starts.
await new Promise((r) => setTimeout(r, 4000));
const everyone = (await adb.collection('users').where('notificationsEnabled', '==', true).get()).docs;

let mismatches = 0, expectedTotal = 0, candidatesRead = 0, fullScanReads = 0;
const kinds = new Set();
const noSend = async () => { throw new Error('the comparison must not send'); };
for (let step = 0; step < 96; step++) {
  const at = NOW + step * 30 * 60_000;
  const expected = new Set(everyone.filter((d) => d.id.startsWith(PFX) && decideNudge(d.data(), at)).map((d) => d.id));
  const got = new Set();
  const rep = await runEngagementNudges({
    now: at, send: noSend, stamp: false,
    onDecision: (uid, push) => { if (uid.startsWith(PFX)) { got.add(uid); kinds.add(push.type); } },
  });
  candidatesRead += rep.candidates;
  fullScanReads += everyone.length;
  expectedTotal += expected.size;
  const missed = [...expected].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !expected.has(x));
  if (missed.length || extra.length) {
    mismatches++;
    if (mismatches === 1) console.log(`    first mismatch at ${new Date(at).toISOString()}: missed ${missed.slice(0, 3)} extra ${extra.slice(0, 3)}`);
  }
}
check('over 48 hours, the queries select exactly who a full scan would', mismatches === 0 && expectedTotal > 200, `${mismatches} half-hours differ, ${expectedTotal} pushes expected`);
check('the comparison exercised all three nudge types', ['streak_risk', 'winback', 'meal_nudge'].every((k) => kinds.has(k)), [...kinds].join(','));
const readRatio = candidatesRead / fullScanReads;
console.log(`    ${C.d}reads over 48 h: ${candidatesRead} vs ${fullScanReads} for a full scan (${Math.round(readRatio * 100)}%)${C.x}`);
check('those selections read well under half as many users', readRatio < 0.4, `${Math.round(readRatio * 100)}%`);

const atMeal = NOW + 11 * 3_600_000; // midday in UTC+1
const decisions = async (pageSize) => {
  const got = [];
  await runEngagementNudges({ now: atMeal, send: noSend, stamp: false, pageSize, onDecision: (uid) => got.push(uid) });
  return got.sort().join();
};
const small = await decisions(7);
check('page size changes nothing: nobody skipped or repeated', small.length > 0 && small === await decisions(500));
check('a run out of time stops cleanly without sending',
  (await runEngagementNudges({ now: atMeal, send: noSend, budgetMs: -1 })).stoppedEarly === true);

// Real delivery path, with a fake sender.
const sent = [];
const send = async (token, push) => { sent.push({ token, type: push.type }); };
const REM = Date.UTC(2026, 10, 11, 1, 30); // reminder target hour 02 UTC
const remU = (id, u) => adb.doc(`users/${id}_${WEEK}`).set({ notificationsEnabled: true, fcmToken: id, ...u, ...pushFieldsFor(u) });
await remU('remIndia', { tzOffsetHours: 5.5, preferredWorkoutTime: '08:00' });
await remU('remOtherHour', { tzOffsetHours: 5.5, preferredWorkoutTime: '09:00' });
await runWorkoutReminders({ now: REM, send });
const remSent = sent.filter((p) => p.token.startsWith('rem')).map((p) => p.token);
check('a half-hour time zone now gets its reminder, and only the right hour fires', remSent.join() === 'remIndia', remSent.join());
await runWorkoutReminders({ now: REM + 30 * 60_000, send });
check('the next run does not send the same reminder twice',
  sent.filter((p) => p.token === 'remIndia').length === 1);
const inbox = await adb.collection('notifications').where('userId', '==', `remIndia_${WEEK}`).get();
check('the push also lands in the in-app inbox', inbox.size === 1);

const TRIAL = 6;
const trialU = (id, u) => adb.doc(`users/${id}_${WEEK}`).set({ notificationsEnabled: true, fcmToken: id, ...u });
const started = (days) => ts.fromMillis(REM - days * DAY);
await trialU('trialDue', { trialStartedAt: started(5.5) });
await trialU('trialEarly', { trialStartedAt: started(2) });
await trialU('trialOver', { trialStartedAt: started(7) });
await trialU('trialPaid', { trialStartedAt: started(5.5), subscriptionType: 'premium' });
await runTrialReminders({ now: REM, send, trialDays: TRIAL });
await runTrialReminders({ now: REM, send, trialDays: TRIAL });
const trialSent = sent.filter((p) => p.token.startsWith('trial')).map((p) => p.token);
check('trial reminder: final day only, never paying users, never twice', trialSent.join() === 'trialDue', trialSent.join());

section('8 · Community count: one stored document');
const cBatch = adb.batch();
for (let i = 0; i < 450; i++) cBatch.set(adb.doc(`public_profiles/cnt_${WEEK}_${i}`), { goal: 'maintenance' });
await cBatch.commit();
const cBatch2 = adb.batch();
for (let i = 450; i < 600; i++) cBatch2.set(adb.doc(`public_profiles/cnt_${WEEK}_${i}`), { goal: 'maintenance' });
await cBatch2.commit();
const stats = await refreshCommunityStats();
const stored = (await adb.doc('community_stats/global').get()).data();
check('the count is no longer capped at 500', stats.byGoal.maintenance >= 600, JSON.stringify(stats));
check('the stored document matches the count', stored.byGoal.maintenance === stats.byGoal.maintenance && stored.total >= stored.byGoal.maintenance);

section('9 · AI limits: per user, app-wide, and when the models are over quota');
const guard = require('./lib/aiGuard.js');
const usageOf = async (uid) => (await adb.doc(`users/${uid}/private/ai_usage`).get()).data();
const G_NOW = Date.UTC(2026, 10, 11, 12);
const gUid = `aiFree_${WEEK}`;

const burst = await Promise.all(Array.from({ length: 80 }, () => guard.takeUserAllowance(gUid, 'call', false, G_NOW)));
const burstAllowed = burst.filter(Boolean).length;
check('a burst of 80 parallel requests stays within the free limit, with no server error', burstAllowed >= 1 && burstAllowed <= 50, `${burstAllowed} allowed`);
check('the stored count matches what was allowed, so none slipped through uncounted', (await usageOf(gUid)).calls === burstAllowed, JSON.stringify(await usageOf(gUid)));
let allowedTotal = burstAllowed;
for (let i = 0; i < 60; i++) if (await guard.takeUserAllowance(gUid, 'call', false, G_NOW)) allowedTotal++;
check('counting on from there, exactly 50 are allowed in the day', allowedTotal === 50, String(allowedTotal));
check('Pro users have a higher limit', (await guard.takeUserAllowance(gUid, 'call', true, G_NOW)) === true);
check('form-check frames are counted separately', (await guard.takeUserAllowance(gUid, 'frame', false, G_NOW)) === true);
check('the allowance resets the next day', (await guard.takeUserAllowance(gUid, 'call', false, G_NOW + DAY)) === true);
check('...on one overwritten document that does not grow', (await usageOf(gUid)).calls === 1 && (await usageOf(gUid)).frames === 0, JSON.stringify(await usageOf(gUid)));

// Ceiling: run on a far-off day so other checks can't move its count.
process.env.AI_GLOBAL_CALLS_PER_DAY = '10';
const C_NOW = Date.UTC(2030, 0, 1, 12);
for (let i = 0; i < 8; i++) await guard.countGlobalCall(C_NOW);
check('at 80% of the ceiling, free users are refused and Pro users are not',
  (await guard.globalCeilingAllows(false, C_NOW, 0)) === false && (await guard.globalCeilingAllows(true, C_NOW, 0)) === true);
for (let i = 0; i < 2; i++) await guard.countGlobalCall(C_NOW);
check('at the ceiling, everyone is refused', (await guard.globalCeilingAllows(true, C_NOW, 0)) === false);
const cUid = `aiCeil_${WEEK}`;
check('a request refused by the ceiling names it', (await guard.checkAiAllowance(cUid, 'call', true, C_NOW, 0)) === 'global_limit');
check('and uses none of that user\'s allowance', !(await usageOf(cUid)));
delete process.env.AI_GLOBAL_CALLS_PER_DAY;
const D_NOW = Date.UTC(2030, 5, 1, 12);
check('below the limits, a request is allowed', (await guard.checkAiAllowance(cUid, 'call', true, D_NOW, 0)) === null);
const shardTotal = (await adb.collection('ai_global_usage').get()).docs
  .filter((d) => d.id.startsWith('2030-06-01_')).reduce((n, d) => n + d.data().calls, 0);
check('and is counted once toward the app-wide total', shardTotal === 1, String(shardTotal));

const M = ['m1', 'm2'];
guard.resetCooldowns();
check('a quota error is recognised, and a bad request is not',
  guard.isQuotaError({ status: 429 }) && guard.isQuotaError(new Error('RESOURCE_EXHAUSTED')) && !guard.isQuotaError({ status: 400 }));
guard.coolModel('m1', G_NOW);
check('one model cooling leaves another to use', guard.modelIsCooling('m1', G_NOW) && guard.secondsUntilAnyModel(M, G_NOW) === 0);
guard.coolModel('m2', G_NOW);
check('all models cooling gives a wait for Retry-After', guard.secondsUntilAnyModel(M, G_NOW) === 20, String(guard.secondsUntilAnyModel(M, G_NOW)));
check('and they are usable again afterwards', guard.secondsUntilAnyModel(M, G_NOW + 20_001) === 0);

// The real endpoint, over HTTP, through the Functions emulator.
const proxyUrl = `http://127.0.0.1:5001/${PROJECT}/us-central1/geminiProxy`;
const hitUid = await newUser('aiproxy');
await seedUser(hitUid);
const token = await auth.currentUser.getIdToken();
const hit = async (body, tok = token) => {
  const r = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null), retryAfter: r.headers.get('retry-after') };
};
check('no token: refused', (await hit({ action: 'getRecipe' }, null)).status === 401);
check('unknown action: refused, and costs no allowance',
  (await hit({ action: 'nope' })).status === 400 && !(await usageOf(hitUid)));
check('oversized image: refused, and costs no allowance',
  (await hit({ action: 'analyzeMealImage', payload: { base64Image: 'a'.repeat(10_000_001) } })).status === 413 && !(await usageOf(hitUid)));
check('free user asking the coach: refused, and costs no allowance',
  (await hit({ action: 'askCoach', payload: { message: 'hi' } })).status === 402 && !(await usageOf(hitUid)));
await adb.doc(`users/${hitUid}/private/ai_usage`).set({ day: dayKey(Date.now()), calls: 50, frames: 0 });
const limited = await hit({ action: 'getRecipe', payload: { mealName: 'x' } });
check('over the daily limit: 429 with a reason and Retry-After',
  limited.status === 429 && limited.body?.code === 'daily_limit' && !!limited.retryAfter, JSON.stringify(limited));
const framesStillOpen = await hit({ action: 'analyzeFormFrame', payload: { base64Image: 'x', exerciseName: 'squat' } });
check('form check has its own allowance, so it passes that gate', framesStillOpen.status !== 429 && (await usageOf(hitUid)).frames === 1, JSON.stringify(framesStillOpen));

section('10 · Capacity: nothing runs on a default nobody chose');
const allFns = require('./lib/index.js');
const endpoints = Object.entries(allFns).filter(([, f]) => f?.__endpoint);
const unbounded = endpoints.filter(([, f]) => !(f.__endpoint.maxInstances > 0) || !(f.__endpoint.timeoutSeconds > 0)).map(([n]) => n);
check('every function sets maxInstances and a timeout', endpoints.length >= 13 && unbounded.length === 0, `${endpoints.length} functions; missing: ${unbounded}`);
const jobs = endpoints.filter(([, f]) => f.__endpoint.scheduleTrigger);
check('scheduled jobs run one at a time, so a slow run cannot overlap the next',
  jobs.length === 5 && jobs.every(([, f]) => f.__endpoint.maxInstances === 1), jobs.map(([n, f]) => `${n}=${f.__endpoint.maxInstances}`).join());
const aiEp = allFns.geminiProxy.__endpoint;
check('the AI endpoint has a set memory, concurrency and timeout',
  aiEp.availableMemoryMb === 1024 && aiEp.concurrency === 40 && aiEp.timeoutSeconds === 30, JSON.stringify(aiEp));

section('11 · The two AI features the server was missing');
const { readFileSync } = await import('node:fs');
const clientSrc = readFileSync(new URL('../src/services/geminiService.ts', import.meta.url), 'utf8');
const serverSrc = readFileSync(new URL('../functions/src/index.ts', import.meta.url), 'utf8');
const sentByApp = [...clientSrc.matchAll(/callProxy\('(\w+)'/g)].map((m) => m[1]);
const allowedSet = serverSrc.match(/const PROXY_ACTIONS = new Set\(\[([\s\S]*?)\]\)/)[1];
const missingAction = sentByApp.filter((a) => !allowedSet.includes(`"${a}"`) || !serverSrc.includes(`case "${a}":`));
check('every AI action the app sends has a server handler', sentByApp.length >= 14 && missingAction.length === 0, `missing: ${missingAction}`);
const allowedList = [...allowedSet.matchAll(/"(\w+)"/g)].map((m) => m[1]);
check('and every allowed action has a case', allowedList.every((a) => serverSrc.includes(`case "${a}":`)));

const { boundBriefing, sanitizePolish } = require('./lib/coachPolish.js');
const pBase = boundBriefing({
  headline: 'Day 12 of your streak', subtitle: 'Keep going',
  nudges: [
    { id: 'water', title: 'Drink water', message: 'You are at 1,200 ml of 2500 ml.' },
    { id: 'protein', title: 'Protein', message: 'You need 40 g more.' },
  ],
});
const polish = sanitizePolish(pBase, {
  headline: '12 days strong', subtitle: 'Keep at it, 100%!',
  nudges: [
    { id: 'water', title: 'Hydrate', message: 'Only 1300 ml left of 2500 ml.' },
    { id: 'protein', title: '**Protein**', message: 'Find 40 g more today.' },
    { id: 'invented', title: 'New', message: 'Added by the model.' },
  ],
});
check('rewording that keeps the numbers is accepted', polish.headline === '12 days strong' && polish.nudges[1].message === 'Find 40 g more today.');
check('a changed number is dropped, so the original wording stays', polish.nudges[0].message === undefined, polish.nudges[0].message);
check('an invented number is dropped', polish.subtitle === undefined, polish.subtitle);
check('a number with a thousands comma still counts as the same number',
  sanitizePolish(pBase, { nudges: [{ id: 'water', message: '1200 ml so far, aiming for 2,500.' }] }).nudges[0].message !== undefined);
check('the model cannot add a nudge', polish.nudges.length === 2 && polish.nudges.every((n) => n.id !== 'invented'));
check('markdown is stripped', polish.nudges[1].title === 'Protein');
check('junk answers are ignored', sanitizePolish(pBase, 'nope') === null && sanitizePolish(pBase, null) === null && sanitizePolish(pBase, []) === null);
check('an oversized briefing from a modified client is bounded',
  boundBriefing({ headline: 'x'.repeat(9999), nudges: Array(50).fill({ id: 'a', message: 'y'.repeat(9999) }) }).nudges.length === 8
  && boundBriefing({ headline: 'x'.repeat(9999) }).headline.length === 200);

const { decidePolish, polishSlot, polishBaseKey } = await import('../src/services/briefingPolishCache.ts');
const noon = polishSlot(new Date(2026, 10, 11, 13), 13);
check('first request in a part of the day calls the AI', decidePolish(null, noon, 'a') === 'call');
const usedSlot = { slot: noon, baseKey: 'a', polished: { headline: 'h', subtitle: 's', nudges: [] } };
check('same briefing again reuses the rewrite, with no call', decidePolish(usedSlot, noon, 'a') === 'reuse');
check('facts changed: plain text, not stale numbers and not another call', decidePolish(usedSlot, noon, 'b') === 'plain');
check('a call that failed is not retried until the next part of the day', decidePolish({ slot: noon, baseKey: 'a', polished: null }, noon, 'a') === 'plain');
check('the next part of the day gets a new rewrite', decidePolish(usedSlot, polishSlot(new Date(2026, 10, 11, 19), 19), 'b') === 'call');
check('the next day gets a new rewrite', decidePolish(usedSlot, polishSlot(new Date(2026, 10, 12, 13), 13), 'a') === 'call');
check('a changed number changes the cache key',
  polishBaseKey({ headline: 'h', subtitle: 's', nudges: [{ id: 'w', title: 't', message: '100 ml' }] })
  !== polishBaseKey({ headline: 'h', subtitle: 's', nudges: [{ id: 'w', title: 't', message: '200 ml' }] }));

const bUid = `aiBrief_${WEEK}`;
let briefingsAllowed = 0;
for (let i = 0; i < 20; i++) if (await guard.takeUserAllowance(bUid, 'briefing', true, G_NOW)) briefingsAllowed++;
check('an old app asking on every Home visit is capped at 6 briefings a day, even on Pro', briefingsAllowed === 6, String(briefingsAllowed));
check('and that leaves their allowance for real features untouched',
  (await usageOf(bUid)).calls === 0 && (await guard.takeUserAllowance(bUid, 'call', false, G_NOW)) === true);
const keptBriefings = (await usageOf(bUid)).briefings;
check('using another feature does not reset the briefing count', keptBriefings === 6, String(keptBriefings));

process.env.AI_GLOBAL_CALLS_PER_DAY = '10';
const L_NOW = Date.UTC(2031, 0, 1, 12);
for (let i = 0; i < 5; i++) await guard.countGlobalCall(L_NOW);
const lowUid = `aiLow_${WEEK}`;
check('at 50% of the ceiling the cosmetic rewrite stops, without using allowance',
  (await guard.checkAiAllowance(lowUid, 'call', true, L_NOW, 0, true)) === 'global_limit' && !(await usageOf(lowUid)));
check('while requests people asked for still go through', (await guard.checkAiAllowance(lowUid, 'call', true, L_NOW, 0, false)) === null);
delete process.env.AI_GLOBAL_CALLS_PER_DAY;
check('the default app-wide limit is the agreed 1,000 a day', guard.AI_LIMITS.globalCallsPerDay === 1000, String(guard.AI_LIMITS.globalCallsPerDay));

// =============================================================================
section('12 · The free trial starts once per account');

const { correctedTrialStart, TRIAL_SLACK_MS } = require('./lib/trialGuard.js');
const T0 = Date.UTC(2026, 0, 1);
check('a profile created seconds after its account keeps its trial start', correctedTrialStart(T0 + 5_000, T0) === null);
check('a profile created just inside the slack is left alone', correctedTrialStart(T0 + TRIAL_SLACK_MS, T0) === null);
check('a profile re-created 30 days later is put back to the account\'s creation',
  correctedTrialStart(T0 + 30 * 86_400_000, T0) === T0);
check('no trial on the profile, or no account to compare with: nothing to correct',
  correctedTrialStart(null, T0) === null && correctedTrialStart(T0, null) === null && correctedTrialStart(NaN, T0) === null);

// Until a value settles: it must hold on two reads half a second apart, so a
// number that is merely passing through does not count.
const holds = async (read, want, ms = 20_000) => {
  const end = Date.now() + ms;
  let last, streak = 0;
  while (Date.now() < end) {
    last = await read();
    streak = JSON.stringify(last) === JSON.stringify(want) ? streak + 1 : 0;
    if (streak >= 2) return { ok: true, last };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, last };
};
const trialOf = async (uid) => (await adb.doc(`users/${uid}`).get()).data()?.trialStartedAt?.toMillis?.() ?? null;

// An account that has existed for 30 days, whose owner deletes the profile
// document and lets the app create it again with a brand-new trial.
const OLD_UID = `oldacct_${WEEK}`;
const oldCreated = new Date(Date.now() - 30 * 86_400_000);
const imported = await admin.auth().importUsers([{
  uid: OLD_UID, email: `${OLD_UID}@proof.test`,
  metadata: { creationTime: oldCreated.toUTCString(), lastSignInTime: oldCreated.toUTCString() },
}]);
const oldAcct = await admin.auth().getUser(OLD_UID);
const oldCreatedMs = Date.parse(oldAcct.metadata.creationTime);
check('the test account really is 30 days old',
  imported.failureCount === 0 && Math.abs(oldCreatedMs - oldCreated.getTime()) < 2000,
  `created ${oldAcct.metadata.creationTime}`);
await seedUser(OLD_UID, { trialStartedAt: ts.now(), subscriptionStatus: 'trialing' });
const restored = await holds(() => trialOf(OLD_UID), oldCreatedMs);
check('its re-created profile gets the ORIGINAL trial start back, not a new 6 days', restored.ok,
  `trial start ${restored.last && new Date(restored.last).toISOString()}, account created ${new Date(oldCreatedMs).toISOString()}`);

// A real first sign-up must not be touched.
await signOut(auth).catch(() => {});
const fresh = await newUser('fresh');
const freshStart = ts.now();
await seedUser(fresh, { trialStartedAt: freshStart, subscriptionStatus: 'trialing' });
// Wait for the trigger to have run (the public mirror appears), then look.
await holds(async () => (await adb.doc(`public_profiles/${fresh}`).get()).exists, true);
check('a genuine new sign-up keeps the trial start it was given', (await trialOf(fresh)) === freshStart.toMillis());

// =============================================================================
section('13 · Like and comment totals are counted, not trusted');

const { writeBatch: cwriteBatch, increment: cincrement, deleteDoc: cdeleteDoc } = await import('firebase/firestore');
const POST = `countPost_${WEEK}`;
const postRef = adb.doc(`posts/${POST}`);
await postRef.set({ userId: bob, username: 'bob', content: 'count me', likesCount: 0, commentsCount: 0, createdAt: ts.now() });
const totals = async () => {
  const d = (await postRef.get()).data() || {};
  return { likes: d.likesCount, comments: d.commentsCount };
};
const cPost = cdoc(cdb, 'posts', POST);
// `fresh` is signed in: an ordinary account with no special rights.
await seedUser(fresh, { displayName: 'Fresh' });

let forgedWrites = 0;
for (let i = 1; i <= 5; i++) {
  await cupdateDoc(cPost, { likesCount: cincrement(1), commentsCount: cincrement(0) }).then(() => forgedWrites++).catch(() => {});
}
check('the rules still accept +1 writes (released apps depend on it)', forgedWrites === 5, `${forgedWrites}/5 accepted`);
const afterForgery = await holds(totals, { likes: 0, comments: 0 });
check('five forged +1 likes with no like behind them are undone', afterForgery.ok, JSON.stringify(afterForgery.last));

// The current app: like document and count in one atomic write.
const likeBatch = cwriteBatch(cdb);
likeBatch.set(cdoc(cdb, `posts/${POST}/likes`, fresh), { userId: fresh, timestamp: cserverTimestamp() });
likeBatch.update(cPost, { likesCount: cincrement(1) });
await likeBatch.commit();
const afterLike = await holds(totals, { likes: 1, comments: 0 });
check('a real like counts as exactly one', afterLike.ok, JSON.stringify(afterLike.last));

// A released app: count first, like document second, as two writes. Simulated
// for a second person with the Admin SDK, in that order.
await postRef.update({ likesCount: 2 });
await adb.doc(`posts/${POST}/likes/${bob}`).set({ userId: bob });
const afterLegacy = await holds(totals, { likes: 2, comments: 0 });
check('a like from an older app (count first, like second) also ends up right', afterLegacy.ok, JSON.stringify(afterLegacy.last));

const commentRef = cdoc(cdb, `posts/${POST}/comments`, `c_${WEEK}`);
const commentBatch = cwriteBatch(cdb);
commentBatch.set(commentRef, { userId: fresh, username: 'Fresh', userPhoto: '', content: 'well done', createdAt: cserverTimestamp() });
commentBatch.update(cPost, { commentsCount: cincrement(1) });
const commented = await commentBatch.commit().then(() => true).catch((e) => e?.code);
check('the app\'s comment write (comment + count together) is accepted by the rules', commented === true, String(commented));
const afterComment = await holds(totals, { likes: 2, comments: 1 });
check('a real comment counts as exactly one', afterComment.ok, JSON.stringify(afterComment.last));

await cupdateDoc(cPost, { likesCount: cincrement(-1), commentsCount: cincrement(-1) });
const afterSabotage = await holds(totals, { likes: 2, comments: 1 });
check('knocking a rival\'s totals down by one is undone too', afterSabotage.ok, JSON.stringify(afterSabotage.last));

await cdeleteDoc(commentRef);
const afterDelete = await holds(totals, { likes: 2, comments: 0 });
check('deleting the comment lowers the total without the app touching the count', afterDelete.ok, JSON.stringify(afterDelete.last));

// =============================================================================
section('14 · Branded food search: Open Food Facts, cleaned and remembered');

const { mapOffHit, mapOffHits, searchKey } = require('./lib/offFoods.js');
const { runFoodSearch } = require('./lib/foodSearch.js');

// The shape search.openfoodfacts.org really returns (captured 2026-11-13).
const milo = {
  code: '9300605126527', brands: ['Milo', 'Nestle'], product_name: 'Nestle Milo',
  nutriments: { 'carbohydrates_100g': 68.5, 'energy-kcal_100g': 430, 'fat_100g': 13, 'proteins_100g': 6 },
};
const m100 = mapOffHit(milo);
check('a real hit becomes a loggable food, per 100 g when no serving is stated',
  m100?.name === 'Nestle Milo (100g)' && m100.calories === 430 && m100.protein === 6 && m100.carbs === 69 && m100.fats === 13
  && m100.brand === 'Milo' && m100.code === '9300605126527' && m100.source === 'OFF', JSON.stringify(m100));
const mServ = mapOffHit({ ...milo, serving_quantity: 30, serving_size: '30 g' });
check('a stated serving scales the numbers (30 g of 430 kcal/100 g = 129)',
  mServ?.name === 'Nestle Milo (30 g)' && mServ.calories === 129 && mServ.carbs === 21, JSON.stringify(mServ));
check('energy given only in kJ is converted', mapOffHit({ product_name: 'Oat Bar', nutriments: { energy_100g: 1800 } })?.calories === 430);
check('a brand given as a comma list still yields one brand', mapOffHit({ ...milo, brands: 'Milo, Nestle' })?.brand === 'Milo');
check('markup in a name is stripped', mapOffHit({ ...milo, product_name: 'Milo <script>x</script>' })?.name.includes('<') === false);

const bad = (over) => mapOffHit({ ...milo, ...over });
const withNutr = (nu) => bad({ nutriments: { ...milo.nutriments, ...nu } });
const refused = [
  ['no name', bad({ product_name: '' })],
  ['no energy at all', bad({ nutriments: { proteins_100g: 5 } })],
  ['zero energy', withNutr({ 'energy-kcal_100g': 0 })],
  ['energy above pure fat (kJ typed as kcal)', withNutr({ 'energy-kcal_100g': 1800 })],
  ['150 g of protein in 100 g', withNutr({ proteins_100g: 150 })],
  ['macros that add up to far more than the energy', withNutr({ 'energy-kcal_100g': 20, fat_100g: 60 })],
  ['negative fat', withNutr({ fat_100g: -3 })],
  ['not an object', mapOffHit('milo')],
].filter(([, r]) => r !== null).map(([why]) => why);
check('rows that cannot be trusted are refused (8 kinds)', refused.length === 0, `let through: ${refused.join('; ')}`);
check('an absurd serving size falls back to per 100 g', mapOffHit({ ...milo, serving_quantity: 50000 })?.name.endsWith('(100g)') === true);
const many = mapOffHits([milo, milo, { ...milo, product_name: 'Milo Cereal' }, null, { product_name: 'x' }, ...Array(30).fill(0).map((_, i) => ({ ...milo, product_name: `Milo ${i}` }))]);
check('repeats are dropped and the list is capped at 10', many.length === 10 && many[0].name === 'Nestle Milo (100g)' && many[1].name === 'Milo Cereal (100g)', String(many.length));
check('search keys are stable and id-safe', searchKey('  Nestlé  MILO!! ') === 'nestle-milo' && searchKey('@@') === '');

// The search itself, with the network replaced so nothing here depends on it.
let fetched = 0;
const fakeFetch = (body, ok = true) => async () => { fetched++; return { ok, json: async () => body }; };
const FS_Q = `milo ${WEEK}`;
const FS_NOW = Date.UTC(2031, 5, 1);
const first = await runFoodSearch(FS_Q, fakeFetch({ hits: [milo, { ...milo, product_name: 'Milo Cereal' }] }), FS_NOW);
check('first search asks Open Food Facts and returns the cleaned foods', first.from === 'live' && first.foods.length === 2 && fetched === 1, JSON.stringify({ from: first.from, n: first.foods.length, fetched }));
const second = await runFoodSearch(`  ${FS_Q.toUpperCase()} `, fakeFetch({ hits: [] }), FS_NOW + 3_600_000);
check('the same search again (any case or spacing) is answered from memory, with no outside request',
  second.from === 'cache' && second.foods.length === 2 && fetched === 1, JSON.stringify({ from: second.from, fetched }));
const later = await runFoodSearch(FS_Q, fakeFetch({ hits: [milo] }), FS_NOW + 31 * 86_400_000);
check('after 30 days it asks again', later.from === 'live' && later.foods.length === 1 && fetched === 2, JSON.stringify({ from: later.from, fetched }));

fetched = 0;
const DOWN_Q = `down ${WEEK}`;
const down = await runFoodSearch(DOWN_Q, fakeFetch({}, false), FS_NOW);
const downAgain = await runFoodSearch(DOWN_Q, async () => { fetched++; throw new Error('timeout'); }, FS_NOW);
check('Open Food Facts down or timing out: no foods, no crash, and the failure is NOT remembered',
  down.from === 'unavailable' && downAgain.from === 'unavailable' && down.foods.length === 0 && fetched === 2
  && !(await exists(`food_search_cache/${searchKey(DOWN_Q)}`)), JSON.stringify({ a: down.from, b: downAgain.from, fetched }));
const recovered = await runFoodSearch(DOWN_Q, fakeFetch({ hits: [milo] }), FS_NOW);
check('and the next search after it recovers gets real results', recovered.from === 'live' && recovered.foods.length === 1);
const garbage = await runFoodSearch(`junk ${WEEK}`, fakeFetch({ hits: 'not a list' }), FS_NOW);
check('a malformed reply is an empty answer, not an error', garbage.foods.length === 0 && garbage.from === 'live');

fetched = 0;
const tiny = await runFoodSearch('ab', fakeFetch({ hits: [milo] }), FS_NOW);
check('a one- or two-letter search never leaves the server', tiny.foods.length === 0 && fetched === 0);

const { getDoc: cgetDoc } = await import('firebase/firestore');
const cacheRead = await cgetDoc(cdoc(cdb, 'food_search_cache', searchKey(FS_Q))).then(() => 'ok').catch((e) => e?.code);
check('the app cannot read or tamper with the search memory directly', cacheRead === 'permission-denied', String(cacheRead));
await signOut(auth);
check('a signed-out caller cannot search', (await callErr('searchFoods', { query: 'milo' })) === 'functions/unauthenticated');

console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
process.exit(fail ? 1 : 0);
