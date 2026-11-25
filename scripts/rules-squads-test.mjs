// Live rules test for Squads — run inside the emulator:
//   npm run test:rules:squads
//
//   ATTACK  something a hostile client tries; must be refused
//   WORKS   something the app does; must succeed
//
// Control: CONTROL=1 RULES_FILE=<rules without the squads block, or with it
// opened up> runs the same checks and passes only if every ATTACK goes
// through there. `CONTROL=open` swaps in a built-in "members-only, no field
// validation" variant of the squad rules so each attack is shown to depend on
// a specific line, not on the default deny.

import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp, arrayUnion,
} from 'firebase/firestore';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const CONTROL = process.env.CONTROL || '';
let rules = readFileSync(process.env.RULES_FILE || ROOT + 'firestore.rules', 'utf8').replace(/\r\n/g, '\n');
if (CONTROL === 'open') {
  // A plausible-but-naive version: members may read, anyone signed in may write anything.
  rules = rules
    .replace("allow create, update, delete: if false;\n\n      // id `<weekKey>_<uid>`", "allow create, update, delete: if isSignedIn();\n\n      // id `<weekKey>_<uid>`")
    .replace("allow get, list: if isSignedIn() && request.auth.uid in resource.data.memberIds;", 'allow get, list: if isSignedIn();')
    .replace(/allow create, update: if isSquadMember\(squadId\) &&[\s\S]*?isValidSquadWeek\(incoming\(\)\);/, 'allow create, update: if isSignedIn();')
    .replace('allow get, list: if isSquadMember(squadId);', 'allow get, list: if isSignedIn();')
    .replace('a member cannot erase a week.\n        allow delete: if false;', 'a member cannot erase a week.\n        allow delete: if isSignedIn();')
  rules = rules.replace('    match /squads/{squadId} {', '    match /squad_codes/{c} { allow read: if isSignedIn(); }\n    match /squads/{squadId} {');
  if (!rules.includes('allow create, update, delete: if isSignedIn();')) { console.error('control patch did not apply'); process.exit(2); }
}

const ALICE = 'alice_sq_000000000000000001'; // owner
const BOB = 'bob_sq_00000000000000000002';   // member
const EVE = 'eve_sq_00000000000000000003';   // outsider
const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };

const results = [];
const run = async (kind, name, p) => {
  let ok = true, msg = '';
  try { await p; } catch (e) { ok = false; msg = String(e?.message || e).slice(0, 110); }
  results.push({ kind, name, ok });
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${C.d}${kind.padEnd(6)}${C.x} ${name}${ok ? '' : `  ${C.d}— ${msg}${C.x}`}`);
};
const attack = (name, p) => run('ATTACK', name, assertFails(p));
const works = (name, p) => run('WORKS', name, assertSucceeds(p));
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

// The squad week that contains "now" in UTC: its Monday.
const mondayOf = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const WK = mondayOf(new Date());
const OLD_WK = mondayOf(new Date(Date.now() - 35 * 86400000));
const NEXT_MONTH_WK = mondayOf(new Date(Date.now() + 35 * 86400000));
const NOT_MONDAY = (() => { const [y, m, d] = WK.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10); })();

const testEnv = await initializeTestEnvironment({
  projectId: 'fitflow-rules-test',
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});
await testEnv.clearFirestore();

const SQ = 'squadAAAAAAAAAAAAAAA1';
const FULL = 'squadFULLFULLFULLFUL1';
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  const m = (name) => ({ name, photoURL: '', joinedAt: 1 });
  await setDoc(doc(adb, 'squads', SQ), {
    name: 'Morning Crew', ownerId: ALICE, memberIds: [ALICE, BOB],
    members: { [ALICE]: m('Alice'), [BOB]: m('Bob') }, tz: 'Asia/Kuala_Lumpur', metric: 'steps', goal: 200000, code: 'ABCDEF',
  });
  const ten = Array.from({ length: 10 }, (_, i) => `full_member_${i}`);
  await setDoc(doc(adb, 'squads', FULL), {
    name: 'Full', ownerId: ten[0], memberIds: ten, members: Object.fromEntries(ten.map((u) => [u, m(u)])),
    tz: 'UTC', metric: 'steps', goal: 1000, code: 'FFFFFF',
  });
  await setDoc(doc(adb, 'squad_codes', 'ABCDEF'), { squadId: SQ });
  await setDoc(doc(adb, `squads/${SQ}/weekly`, `${WK}_${BOB}`), { uid: BOB, weekKey: WK, steps: 4000, activeDays: 1, workouts: 0 });
  await setDoc(doc(adb, 'users', BOB), { uid: BOB, displayName: 'Bob', photoURL: '', email: 'bob@example.test', weight: 82, subscriptionType: 'free' });
  await setDoc(doc(adb, 'meals', 'bobMeal'), { userId: BOB, name: 'Secret donut', calories: 400, timestamp: new Date() });
});

const alice = testEnv.authenticatedContext(ALICE).firestore();
const bob = testEnv.authenticatedContext(BOB).firestore();
const eve = testEnv.authenticatedContext(EVE).firestore();
const week = (uid, extra = {}) => ({ uid, weekKey: WK, steps: 12345, activeDays: 3, workouts: 2, updatedAt: serverTimestamp(), ...extra });

console.log(`\n${C.b}── Rules: squads ${CONTROL ? `(CONTROL=${CONTROL})` : ''} ──${C.x}`);
console.log(`${C.d}current week key ${WK}${C.x}`);

section('Outsiders see nothing');
await attack('a non-member cannot read the squad', getDoc(doc(eve, 'squads', SQ)));
await attack('a non-member cannot list squads they are not in', getDocs(query(collection(eve, 'squads'), where('memberIds', 'array-contains', BOB))));
await attack('a non-member cannot read a member\'s weekly numbers', getDoc(doc(eve, `squads/${SQ}/weekly`, `${WK}_${BOB}`)));
await attack('a non-member cannot list the weekly leaderboard', getDocs(collection(eve, `squads/${SQ}/weekly`)));
await attack('invite codes cannot be looked up (no enumeration)', getDoc(doc(eve, 'squad_codes', 'ABCDEF')));
await attack('a non-member cannot write a weekly doc into the squad', setDoc(doc(eve, `squads/${SQ}/weekly`, `${WK}_${EVE}`), week(EVE)));

section('Membership cannot be self-escalated');
await attack('a non-member cannot add themselves to memberIds', updateDoc(doc(eve, 'squads', SQ), { memberIds: arrayUnion(EVE) }));
await attack('a non-member cannot add themselves even quoting the right code',
  updateDoc(doc(eve, 'squads', SQ), { memberIds: arrayUnion(EVE), code: 'ABCDEF' }));
await attack('nobody can push an 11th member into a full squad', updateDoc(doc(eve, 'squads', FULL), { memberIds: arrayUnion(EVE) }));
await attack('a client cannot create a squad doc directly (cap/owner bypass)',
  setDoc(doc(eve, 'squads', 'squadEVEEVEEVEEVEEVE1'), { name: 'x', ownerId: EVE, memberIds: [EVE], members: {}, tz: 'UTC', metric: 'steps', goal: 1, code: 'ZZZZZZ' }));
await attack('a member (non-owner) cannot rename the squad', updateDoc(doc(bob, 'squads', SQ), { name: 'Bob rules' }));
await attack('a member (non-owner) cannot remove the owner', updateDoc(doc(bob, 'squads', SQ), { memberIds: [BOB] }));
await attack('a member cannot make themselves owner', updateDoc(doc(bob, 'squads', SQ), { ownerId: BOB }));
await attack('a member cannot delete the squad', deleteDoc(doc(bob, 'squads', SQ)));

section('Weekly numbers: only your own, only sane, only this week');
await attack('a member cannot write another member\'s weekly doc', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${BOB}`), week(BOB)));
await attack('a member cannot write a doc under their id claiming another uid', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(BOB)));
await attack('absurd steps (9,999,999) are refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { steps: 9999999 })));
await attack('8 active days in a 7-day week are refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { activeDays: 8 })));
await attack('negative workouts are refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { workouts: -1 })));
await attack('fractional steps are refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { steps: 10.5 })));
await attack('extra fields (e.g. weight) are refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { weight: 70 })));
await attack('a malformed weekKey is refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `2026-W48_${ALICE}`), week(ALICE, { weekKey: '2026-W48' })));
await attack('a weekKey that is not a Monday is refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${NOT_MONDAY}_${ALICE}`), week(ALICE, { weekKey: NOT_MONDAY })));
await attack('a week five weeks ago cannot be rewritten', setDoc(doc(alice, `squads/${SQ}/weekly`, `${OLD_WK}_${ALICE}`), week(ALICE, { weekKey: OLD_WK })));
await attack('a week five weeks ahead cannot be pre-filled', setDoc(doc(alice, `squads/${SQ}/weekly`, `${NEXT_MONTH_WK}_${ALICE}`), week(ALICE, { weekKey: NEXT_MONTH_WK })));
await attack('the doc id must match the weekKey inside it', setDoc(doc(alice, `squads/${SQ}/weekly`, `${OLD_WK}_${ALICE}`), week(ALICE)));
await attack('a client-chosen updatedAt is refused', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { updatedAt: new Date('2020-01-01') })));
await attack('a member cannot delete someone\'s week', deleteDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${BOB}`)));

section('Private profile fields stay private');
await attack('a squad-mate cannot read the other member\'s user doc (email, weight)', getDoc(doc(alice, 'users', BOB)));
await attack('a squad-mate cannot read the other member\'s meals', getDoc(doc(alice, 'meals', 'bobMeal')));
await attack('a squad-mate cannot list the other member\'s meals', getDocs(query(collection(alice, 'meals'), where('userId', '==', BOB))));

section('The legitimate paths work');
await works('a member reads the squad', getDoc(doc(bob, 'squads', SQ)));
await works('a member lists their squads (array-contains query)', getDocs(query(collection(bob, 'squads'), where('memberIds', 'array-contains', BOB))));
await works('a member writes their own weekly doc', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE)));
await works('a member updates their own weekly doc', setDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { steps: 20000 })));
await works('zeros are fine (a quiet week)', setDoc(doc(bob, `squads/${SQ}/weekly`, `${WK}_${BOB}`), week(BOB, { steps: 0, activeDays: 0, workouts: 0 })));
await works('the upper bounds are accepted (700k steps, 7 days, 50 workouts)',
  setDoc(doc(bob, `squads/${SQ}/weekly`, `${WK}_${BOB}`), week(BOB, { steps: 700000, activeDays: 7, workouts: 50 })));
await works('a member reads a squad-mate\'s weekly doc', getDoc(doc(alice, `squads/${SQ}/weekly`, `${WK}_${BOB}`)));
await works('a member lists this week\'s leaderboard', getDocs(query(collection(alice, `squads/${SQ}/weekly`), where('weekKey', '==', WK))));

await testEnv.cleanup();

// ── Mutants: each weekly-doc check must hinge on ITS clause ──────────────────
// Remove one clause from the rules, and the attack aimed at it must now get
// through. An attack that is still refused would be passing for some other
// reason (an evaluation error, a different clause), i.e. proving nothing.
if (!CONTROL) {
  section('Mutants: drop one clause, its attack must get through');
  const mutants = [
    ['data.steps <= 700000', '9,999,999 steps', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { steps: 9999999 }))],
    ['data.activeDays <= 7', '8 active days', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { activeDays: 8 }))],
    ['data.workouts >= 0', 'negative workouts', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { workouts: -1 }))],
    ['data.steps is int', 'fractional steps', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { steps: 10.5 }))],
    ["data.keys().hasOnly(['uid', 'weekKey', 'steps', 'activeDays', 'workouts', 'updatedAt'])", 'extra field', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { weight: 70 }))],
    ['data.uid == request.auth.uid', 'claiming another uid', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(BOB))],
    ['monday.dayOfWeek() == 1', 'non-Monday week key', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${NOT_MONDAY}_${ALICE}`), week(ALICE, { weekKey: NOT_MONDAY }))],
    ["request.time < monday + duration.value(8, 'd')", 'five weeks ago', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${OLD_WK}_${ALICE}`), week(ALICE, { weekKey: OLD_WK }))],
    ["request.time > monday - duration.value(1, 'd')", 'five weeks ahead', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${NEXT_MONTH_WK}_${ALICE}`), week(ALICE, { weekKey: NEXT_MONTH_WK }))],
    ['data.updatedAt == request.time', 'client updatedAt', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${ALICE}`), week(ALICE, { updatedAt: new Date('2020-01-01') }))],
    ["docId == incoming().weekKey + '_' + request.auth.uid", 'another member\'s doc id', (db) => setDoc(doc(db, `squads/${SQ}/weekly`, `${WK}_${BOB}`), week(ALICE))],
    ['request.auth.uid in get(/databases/$(database)/documents/squads/$(squadId)).data.memberIds', 'outsider writes', (db, eveDb) => setDoc(doc(eveDb, `squads/${SQ}/weekly`, `${WK}_${EVE}`), week(EVE))],
  ];
  let i = 0;
  for (const [clause, label, write] of mutants) {
    // Patch the clause INSIDE the squad block only (isValidUser has look-alikes).
    const at = rules.indexOf('function isSquadMember');
    const at2 = at >= 0 ? rules.indexOf(clause, at) : -1;
    if (at2 < 0) { results.push({ kind: 'MUTANT', name: label, ok: false }); console.log(`  ${C.r}FAIL${C.x} clause not found: ${clause}`); continue; }
    const env = await initializeTestEnvironment({
      projectId: `fitflow-rules-mutant-${i++}`,
      firestore: { rules: rules.slice(0, at2) + 'true' + rules.slice(at2 + clause.length), host: '127.0.0.1', port: 8080 },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'squads', SQ), { name: 'M', ownerId: ALICE, memberIds: [ALICE, BOB], members: {}, tz: 'UTC', metric: 'steps', goal: 1000, code: 'ABCDEF' });
    });
    await run('MUTANT', `without "${clause.slice(0, 48)}" the ${label} attack gets through`,
      assertSucceeds(write(env.authenticatedContext(ALICE).firestore(), env.authenticatedContext(EVE).firestore())));
    await env.cleanup();
  }
}

const attacks = results.filter((r) => r.kind === 'ATTACK');
console.log('');
if (CONTROL) {
  const blind = attacks.filter((r) => r.ok);
  console.log(`${C.b}Control: ${attacks.length - blind.length}/${attacks.length} attacks get through on the weakened rules${C.x}`);
  if (blind.length) {
    console.log(`${C.d}Still refused there (default deny / other rules, not the squad block):${C.x}`);
    for (const r of blind) console.log(`  ${C.d}•${C.x} ${r.name}`);
  }
  // The squad-specific attacks MUST get through; the three profile-privacy ones
  // are protected by the /users and /meals rules, which the control leaves alone.
  const squadBlind = blind.filter((r) => !/user doc|meals/.test(r.name));
  if (squadBlind.length) { console.log(`${C.r}${C.b}${squadBlind.length} squad checks prove nothing${C.x}`); process.exit(1); }
  console.log(`${C.g}${C.b}Every squad check detects the weakened rules${C.x}\n`);
  process.exit(0);
}
const total = results.length, ok = results.filter((r) => r.ok).length;
console.log(`${C.b}Result: ${ok === total ? C.g : C.r}${ok}/${total}${C.x}${C.b} checks passed${C.x}  ${C.d}(attacks refused ${attacks.filter((r) => r.ok).length}/${attacks.length})${C.x}`);
if (ok === total) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${total - ok} FAILED${C.x}\n`); process.exit(1); }
