// Live rules test for the /users privacy boundary — run inside the emulator:
//   npx firebase emulators:exec --only firestore --project fitflow-rules-test \
//     "node scripts/rules-privacy-test.mjs"
//
// The static gate (proof:privacy) reads the rules file. This one asks the actual
// rules engine, which is the only thing that decides in production.

import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);

const ALICE = 'alice_uid_0000000000000000001';
const BOB = 'bob_uid_00000000000000000002';
const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = async (name, p) => {
  try { await p; pass++; console.log(`  ${C.g}PASS${C.x} ${name}`); }
  catch (e) { fail++; console.log(`  ${C.r}FAIL${C.x} ${name} ${C.d}— ${String(e.message).slice(0, 110)}${C.x}`); }
};

const testEnv = await initializeTestEnvironment({
  projectId: 'fitflow-rules-test',
  firestore: { rules: readFileSync(ROOT + 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

// Seed both users and Bob's mirror with rules DISABLED (as the server would).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  for (const uid of [ALICE, BOB]) {
    await setDoc(doc(adb, 'users', uid), {
      displayName: uid === ALICE ? 'Alice' : 'Bob',
      photoURL: 'https://example.test/a.png',
      subscriptionType: 'free',
      points: 120, streak: 4, level: 2, goal: 'fat_loss',
      // the data the old rule exposed to every signed-in account
      age: 31, weight: 68, healthConditions: ['asthma'],
      fcmToken: 'tok_secret', stripeCustomerId: 'cus_secret',
    });
  }
  await setDoc(doc(adb, 'public_profiles', BOB), {
    displayName: 'Bob', photoURL: 'https://example.test/a.png',
    points: 120, streak: 4, level: 2, goal: 'fat_loss',
  });
});

const alice = testEnv.authenticatedContext(ALICE).firestore();
const anon = testEnv.unauthenticatedContext().firestore();

console.log(`\n${C.b}── Rules: /users privacy boundary ──${C.x}\n`);

console.log(`${C.b}Cross-user reads of /users are denied${C.x}`);
await check("Alice cannot read Bob's user document", assertFails(getDoc(doc(alice, 'users', BOB))));
await check('nobody can enumerate /users', assertFails(getDocs(collection(alice, 'users'))));
await check('nobody can rank /users by points',
  assertFails(getDocs(query(collection(alice, 'users'), orderBy('points', 'desc'), limit(10)))));
await check('an anonymous visitor cannot read a user document', assertFails(getDoc(doc(anon, 'users', BOB))));

console.log(`\n${C.b}The owner still works${C.x}`);
await check('Alice can read her own document', assertSucceeds(getDoc(doc(alice, 'users', ALICE))));

console.log(`\n${C.b}The public mirror powers the leaderboards${C.x}`);
await check("Alice can read Bob's public profile", assertSucceeds(getDoc(doc(alice, 'public_profiles', BOB))));
await check('Alice can rank the leaderboard',
  assertSucceeds(getDocs(query(collection(alice, 'public_profiles'), orderBy('points', 'desc'), limit(10)))));
await check('an anonymous visitor cannot read the mirror', assertFails(getDoc(doc(anon, 'public_profiles', BOB))));

console.log(`\n${C.b}The mirror is server-only${C.x}`);
await check('Alice cannot forge a leaderboard entry',
  assertFails(setDoc(doc(alice, 'public_profiles', ALICE), { displayName: 'Alice', points: 999999 })));
await check("Alice cannot tamper with Bob's public profile",
  assertFails(setDoc(doc(alice, 'public_profiles', BOB), { points: 0 })));
await check('Alice cannot delete a mirror', assertFails(deleteDoc(doc(alice, 'public_profiles', BOB))));

// Prove the leak is actually closed, not just that a read was refused.
console.log(`\n${C.b}What the mirror actually exposes${C.x}`);
const snap = await getDoc(doc(alice, 'public_profiles', BOB));
const keys = Object.keys(snap.data() || {});
const SENSITIVE = ['age', 'weight', 'healthConditions', 'fcmToken', 'stripeCustomerId', 'subscriptionType'];
const leaked = keys.filter((k) => SENSITIVE.includes(k));
await check(`the mirror carries only public fields (${keys.sort().join(', ')})`,
  leaked.length ? Promise.reject(new Error('leaked: ' + leaked.join(', '))) : Promise.resolve());

await testEnv.cleanup();
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
