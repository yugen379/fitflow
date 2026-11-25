// Live rules test for the security-audit fixes — run inside the emulator:
//   npm run test:rules:security
//
// Three kinds of check:
//   ATTACK  something a hostile client tries; must be refused
//   FIXED   something the app does that the old rules wrongly refused
//   WORKS   something the app (or a released older app) does; must keep working
//
// Control: RULES_FILE=<path to the previous firestore.rules> CONTROL=1
// runs the same checks against the old rules and passes only if every ATTACK
// and FIXED check FAILS there. A check that passes on both the old and the new
// rules proves nothing, and this is how that gets caught.

import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const RULES_FILE = process.env.RULES_FILE || ROOT + 'firestore.rules';
const CONTROL = process.env.CONTROL === '1';

const ALICE = 'alice_uid_0000000000000000001';
const BOB = 'bob_uid_00000000000000000002';
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };

const results = [];
const run = async (kind, name, p) => {
  let ok = true, msg = '';
  try { await p; } catch (e) { ok = false; msg = String(e?.message || e).slice(0, 110); }
  results.push({ kind, name, ok });
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${C.d}${kind.padEnd(6)}${C.x} ${name}${ok ? '' : `  ${C.d}— ${msg}${C.x}`}`);
};
const attack = (name, p) => run('ATTACK', name, assertFails(p));
const fixed = (name, p) => run('FIXED', name, assertSucceeds(p));
const works = (name, p) => run('WORKS', name, assertSucceeds(p));
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

const testEnv = await initializeTestEnvironment({
  projectId: 'fitflow-rules-test',
  firestore: { rules: readFileSync(RULES_FILE, 'utf8'), host: '127.0.0.1', port: 8080 },
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  await setDoc(doc(adb, 'users', BOB), {
    uid: BOB, displayName: 'Bob', photoURL: '', subscriptionType: 'free', points: 0, level: 1, badges: [],
  });
  await setDoc(doc(adb, 'posts', 'bobPost'), {
    userId: BOB, username: 'Bob', userPhoto: '', content: 'hello', likesCount: 3, commentsCount: 1,
  });
  for (const id of ['banana', 'apple']) {
    await setDoc(doc(adb, 'food_catalog', id), { name: id, calories: 105, protein: 1, carbs: 27, fats: 0 });
  }
  for (const id of ['c_seed1', 'c_seed2']) {
    await setDoc(doc(adb, 'posts/bobPost/comments', id), { userId: ALICE, username: 'Alice', userPhoto: '', content: 'seeded' });
  }
});

const alice = testEnv.authenticatedContext(ALICE).firestore();
const bob = testEnv.authenticatedContext(BOB).firestore();

// The exact document the app writes at first sign-in (src/hooks/useAuth.tsx).
const newProfile = (uid, extra = {}) => ({
  uid, displayName: 'Alice', photoURL: 'https://example.test/a.png',
  subscriptionType: 'free', trialStartedAt: serverTimestamp(), subscriptionStatus: 'trialing',
  streak: 0, points: 0, level: 1, badges: [], createdAt: serverTimestamp(),
  tzOffsetHours: 8, tzId: 'Asia/Kuala_Lumpur', ...extra,
});
// Each attack gets its own account and its own documents, so one attack that
// gets through (as they all do in the control run) cannot change what the next
// one is testing.
const signUpAs = (uid, extra) =>
  setDoc(doc(testEnv.authenticatedContext(uid).firestore(), 'users', uid), newProfile(uid, extra));

console.log(`\n${C.b}── Rules: security-audit fixes ${CONTROL ? '(CONTROL: previous rules)' : ''} ──${C.x}`);
console.log(`${C.d}rules: ${RULES_FILE}${C.x}`);

section('A new profile carries only what the app writes');
await attack('cannot be created with a Stripe customer id planted', signUpAs('mallory_uid_1', { stripeCustomerId: 'cus_someone_else' }));
await attack('cannot be created with a paid plan and period end planted',
  signUpAs('mallory_uid_2', { plan: 'yearly', currentPeriodEnd: new Date('2099-01-01'), graceUntil: new Date('2099-01-01') }));
await attack('cannot be created with a 999-day streak', signUpAs('mallory_uid_3', { streak: 999 }));
await works('the app\'s own sign-up document is accepted', signUpAs(ALICE));

section('Posts');
const post = (extra = {}) => ({
  userId: ALICE, username: 'Alice', userPhoto: '', content: 'First run done',
  likesCount: 0, commentsCount: 0, createdAt: serverTimestamp(), ...extra,
});
await attack('cannot be created with 9,999 likes', setDoc(doc(alice, 'posts', 'p_likes'), post({ likesCount: 9999 })));
await attack('cannot be created under someone else\'s name', setDoc(doc(alice, 'posts', 'p_spoof'), post({ username: 'Bob' })));
await attack('cannot carry 6,000 characters', setDoc(doc(alice, 'posts', 'p_big'), post({ content: 'x'.repeat(6000) })));
await attack('cannot carry fields the app never writes', setDoc(doc(alice, 'posts', 'p_extra'), post({ pinned: true })));
await works('the app\'s own post is accepted', setDoc(doc(alice, 'posts', 'alicePost'), post()));
await works('a post from a profile with no name ("Athlete") is accepted', setDoc(doc(alice, 'posts', 'p_athlete'), post({ username: 'Athlete' })));
await fixed('the author can edit their post (the app sends updatedAt)',
  updateDoc(doc(alice, 'posts', 'alicePost'), { content: 'First run done!', updatedAt: serverTimestamp() }));
await works('a released app can still add one like to a post', updateDoc(doc(alice, 'posts', 'bobPost'), { likesCount: 4, commentsCount: 1 }));
await works('a counter still cannot jump by more than one',
  assertFails(updateDoc(doc(alice, 'posts', 'bobPost'), { likesCount: 400, commentsCount: 1 })));
await works('someone else still cannot edit the text',
  assertFails(updateDoc(doc(alice, 'posts', 'bobPost'), { content: 'defaced' })));

section('Comments');
const comment = (extra = {}) => ({
  userId: ALICE, username: 'Alice', userPhoto: '', content: 'Nice work', createdAt: serverTimestamp(), ...extra,
});
const c1 = doc(alice, 'posts/bobPost/comments', 'c_alice');
await attack('cannot be posted under someone else\'s name', setDoc(doc(alice, 'posts/bobPost/comments', 'c_spoof'), comment({ username: 'Bob' })));
await attack('cannot carry fields the app never writes', setDoc(doc(alice, 'posts/bobPost/comments', 'c_extra'), comment({ pinned: true })));
await works('the app\'s own comment is accepted', setDoc(c1, comment()));
await attack('the author cannot re-assign their comment to another user', updateDoc(doc(alice, 'posts/bobPost/comments', 'c_seed1'), { userId: BOB }));
await attack('the author cannot rename themselves on it', updateDoc(doc(alice, 'posts/bobPost/comments', 'c_seed2'), { username: 'Bob' }));
await works('the author can still edit the words', updateDoc(c1, { content: 'Nice work!' }));
await works('someone else still cannot edit it', assertFails(updateDoc(doc(bob, 'posts/bobPost/comments', 'c_alice'), { content: 'x' })));

section('Likes');
await attack('a like cannot carry extra fields', setDoc(doc(alice, 'posts/other1/likes', ALICE), { userId: ALICE, weight: 1000 }));
await attack('a like cannot name another user', setDoc(doc(alice, 'posts/other2/likes', ALICE), { userId: BOB }));
await works('the app\'s own like is accepted', setDoc(doc(alice, 'posts/bobPost/likes', ALICE), { userId: ALICE, timestamp: serverTimestamp() }));
await works('nobody can like as someone else', assertFails(setDoc(doc(alice, 'posts/bobPost/likes', BOB), { userId: BOB })));

section('Shared food catalog');
const food = (extra = {}) => ({ name: 'Oat Bar', calories: 190, protein: 4, carbs: 29, fats: 7, updatedAt: serverTimestamp(), ...extra });
await attack('an existing food cannot be overwritten',
  setDoc(doc(alice, 'food_catalog', 'banana'), food({ name: 'Banana', calories: 5, protein: 0, carbs: 0, fats: 0 })));
await attack('an existing food cannot be merged over (what saveToCatalog sends)',
  setDoc(doc(alice, 'food_catalog', 'apple'), food({ name: 'Apple', calories: 900, protein: 0, carbs: 0, fats: 0 }), { merge: true }));
await attack('a food whose macros dwarf its calories is refused',
  setDoc(doc(alice, 'food_catalog', 'poison_pizza'), food({ calories: 1, protein: 100, carbs: 100, fats: 100 })));
await attack('a 999,999 kcal food is refused', setDoc(doc(alice, 'food_catalog', 'huge'), food({ calories: 999999 })));
await attack('a food cannot carry extra fields', setDoc(doc(alice, 'food_catalog', 'extra'), food({ sponsored: true })));
await works('a new, sensible food is accepted', setDoc(doc(alice, 'food_catalog', 'oat_bar'), food()));
await works('a branded food is accepted', setDoc(doc(alice, 'food_catalog', 'oat_bar_acme'), food({ brand: 'Acme' })));
await works('a zero-macro drink is accepted', setDoc(doc(alice, 'food_catalog', 'vodka_shot'), food({ name: 'Vodka', calories: 97, protein: 0, carbs: 0, fats: 0 })));
await attack('a barcode label with per-serving kcal next to per-100 g macros is refused',
  setDoc(doc(alice, 'food_catalog', 'barcode-9555123456789'), food({ name: 'Biscuit', calories: 60, protein: 7, carbs: 65, fats: 18 })));
await attack('a barcode label over 900 kcal per 100 g is refused',
  setDoc(doc(alice, 'food_catalog', 'barcode-9555123456790'), food({ name: 'Biscuit', calories: 1880, protein: 7, carbs: 65, fats: 18 })));
await works('a sensible barcode label is accepted',
  setDoc(doc(alice, 'food_catalog', 'barcode-9555123456791'), food({ name: 'Oat biscuit', calories: 450, protein: 7, carbs: 65, fats: 18 })));
await works('foods still cannot be deleted', assertFails(deleteDoc(doc(alice, 'food_catalog', 'banana'))));

await testEnv.cleanup();

const of = (k) => results.filter((r) => r.kind === k);
const passed = (k) => of(k).filter((r) => r.ok).length;
console.log('');
if (CONTROL) {
  // On the OLD rules every attack must get through and every fix must be broken.
  const detecting = [...of('ATTACK'), ...of('FIXED')];
  const blind = detecting.filter((r) => r.ok);
  console.log(`${C.b}Control: ${detecting.length - blind.length}/${detecting.length} checks fail on the previous rules${C.x}`);
  if (blind.length) {
    console.log(`${C.r}${C.b}These checks pass on the old rules too, so they prove nothing:${C.x}`);
    for (const r of blind) console.log(`  ${C.r}•${C.x} ${r.name}`);
    process.exit(1);
  }
  console.log(`${C.g}${C.b}Every check detects the old behaviour${C.x}\n`);
  process.exit(0);
}
const total = results.length, ok = results.filter((r) => r.ok).length;
console.log(`${C.b}Result: ${ok === total ? C.g : C.r}${ok}/${total}${C.x}${C.b} checks passed${C.x}  ${C.d}(attacks refused ${passed('ATTACK')}/${of('ATTACK').length}, fixes ${passed('FIXED')}/${of('FIXED').length}, still works ${passed('WORKS')}/${of('WORKS').length})${C.x}`);
if (ok === total) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${total - ok} FAILED${C.x}\n`); process.exit(1); }
