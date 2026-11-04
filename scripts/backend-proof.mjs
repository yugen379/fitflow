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

console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
process.exit(fail ? 1 : 0);
