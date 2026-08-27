// Why does step_days never persist? — run inside the emulator:
//   npx firebase emulators:exec --only firestore "node scripts/rules-stepdays-test.mjs"
//
// Order matters here. upsertStepDay READS the doc before writing it, so the
// very first sync of a day is a `get` against a document that does not exist
// yet. This exercises that case FIRST, on a clean id, before anything creates
// the document — which is exactly what the previous version of this script got
// wrong: it read a doc its own baseline write had just created, so the read
// looked fine.

import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);

const UID = 'BActUBi3SBSkLsH690ZPlFIRzNF3';
const DAY = '2026-08-27';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };

const testEnv = await initializeTestEnvironment({
  projectId: 'fitflow-rules-test',
  firestore: { rules: readFileSync(ROOT + 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const db = testEnv.authenticatedContext(UID).firestore();

const payload = () => ({
  userId: UID, day: DAY, steps: 641, distanceKm: 0.47,
  calories: 25, activeMs: 120000, source: 'client', updatedAt: serverTimestamp(),
});

const tryRead = async (label, id) => {
  try { await getDoc(doc(db, 'step_days', id)); console.log(`  ${C.g}ALLOWED${C.x} ${label}`); return true; }
  catch (e) { console.log(`  ${C.r}DENIED ${C.x} ${label}  ${C.b}${e.code || e.message}${C.x}`); return false; }
};
const tryWrite = async (label, id, mutate = (d) => d) => {
  try { await setDoc(doc(db, 'step_days', id), mutate(payload()), { merge: true }); console.log(`  ${C.g}ALLOWED${C.x} ${label}`); return true; }
  catch (e) { console.log(`  ${C.r}DENIED ${C.x} ${label}  ${C.b}${e.code || e.message}${C.x}`); return false; }
};

console.log(`\n${C.b}── step_days: the real call order ──${C.x}\n`);

console.log(`${C.b}1. getDoc on a document that does NOT exist  (what upsertStepDay does first)${C.x}`);
const readMissing = await tryRead('get step_days/<uid>_<day>  [doc absent]', `${UID}_${DAY}`);

console.log(`\n${C.b}2. The write that would have followed${C.x}`);
await tryWrite('setDoc(merge:true)  [creates the doc]', `${UID}_${DAY}`);

console.log(`\n${C.b}3. getDoc again, now that the document exists${C.x}`);
await tryRead('get step_days/<uid>_<day>  [doc present]', `${UID}_${DAY}`);

console.log(`\n${C.b}4. Control — a different day, still absent${C.x}`);
await tryRead('get step_days/<uid>_2026-01-01  [doc absent]', `${UID}_2026-01-01`);

// The get rule was widened from a resource.data check to a doc-id prefix.
// That must not have opened anyone else's steps.
console.log(`\n${C.b}5. Security - another signed-in user must not reach these docs${C.x}`);
const OTHER = 'zybXA0wbwvOweyQrI4ri19SCodD2';
const otherDb = testEnv.authenticatedContext(OTHER).firestore();
const otherTry = async (label, fn) => {
  try { await fn(); console.log(`  ${C.r}ALLOWED${C.x} ${label}  ${C.b}<-- SECURITY REGRESSION${C.x}`); return false; }
  catch (e) { console.log(`  ${C.g}DENIED ${C.x} ${label}  ${C.b}${e.code || e.message}${C.x}`); return true; }
};
let secure = true;
secure = await otherTry("read victim's EXISTING step doc",
  () => getDoc(doc(otherDb, 'step_days', `${UID}_${DAY}`))) && secure;
secure = await otherTry("read victim's ABSENT step doc",
  () => getDoc(doc(otherDb, 'step_days', `${UID}_2030-01-01`))) && secure;
secure = await otherTry("write into victim's step doc",
  () => setDoc(doc(otherDb, 'step_days', `${UID}_${DAY}`), payload(), { merge: true })) && secure;
secure = await otherTry("forge another userId on their own doc id",
  () => setDoc(doc(otherDb, 'step_days', `${OTHER}_${DAY}`), { ...payload(), userId: UID }, { merge: true })) && secure;
console.log(secure ? `  ${C.g}${C.b}cross-user access is blocked${C.x}` : `  ${C.r}${C.b}SECURITY REGRESSION${C.x}`);

console.log(`\n${C.b}── Verdict ──${C.x}`);
if (!readMissing) {
  console.log(`${C.r}${C.b}The FIRST read of each new day is denied.${C.x}`);
  console.log(`upsertStepDay reads before it writes and catches every error the`);
  console.log(`same way, so the denial is recorded as "Save failed" and the write`);
  console.log(`is never attempted. step_days can never receive its first document.`);
} else {
  console.log(`${C.y}Read on a missing doc is allowed — the cause is elsewhere.${C.x}`);
}
console.log('');

await testEnv.cleanup();
