// Offline queue proof harness — npm run proof:offline
//
// This queue holds writes the server has NOT accepted yet: a meal or a workout
// the user has already been told was saved. Every bug in it is silent, and the
// two directions it can fail in are both unacceptable — losing an item, or
// delivering it twice. Neither surfaces an error anywhere.
//
// The module talks to idb-keyval and dataService, so both are stubbed through
// Node's module resolution before it is imported.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// ── Stub loader: idb-keyval -> in-memory, dataService -> scripted behaviour ───
const loaderSrc = `
export async function resolve(spec, ctx, next) {
  if (spec === 'idb-keyval') return { url: 'stub:idb', shortCircuit: true, format: 'module' };
  if (spec.endsWith('/dataService')) return { url: 'stub:data', shortCircuit: true, format: 'module' };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'stub:idb') return { format: 'module', shortCircuit: true, source: \`
    // IndexedDB structured-clones on read AND write. Handing back a live
    // reference instead makes the queue alias its own storage, which is a
    // property real idb-keyval never has.
    export const store = new Map();
    const clone = (v) => (v === undefined ? undefined : structuredClone(v));
    export const get = async (k) => { await new Promise(r => setTimeout(r, 1)); return clone(store.get(k)); };
    export const set = async (k, v) => { await new Promise(r => setTimeout(r, 1)); store.set(k, clone(v)); };
  \` };
  if (url === 'stub:data') return { format: 'module', shortCircuit: true, source: \`
    export const calls = [];
    export let mode = 'ok';
    export const setMode = (m) => { mode = m; };
    const rec = async (type, userId, payload) => {
      calls.push({ type, userId, payload });
      if (mode === 'fail') throw new Error('write rejected');
      return 'ok';
    };
    export const logMeal = (u, p) => rec('logMeal', u, p);
    export const logWorkout = (u, p) => rec('logWorkout', u, p);
  \` };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(loaderSrc), pathToFileURL('./'));

// Node 24 defines navigator as a getter-only global; redefine it.
let online = true;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ onLine: online }),
});
const setOnline = (v) => { online = v; };

const idb = await import('idb-keyval');
const data = await import('../src/services/dataService');
const q = await import('../src/services/offlineService.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};
const reset = () => { idb.store.clear(); data.calls.length = 0; data.setMode('ok'); };

console.log(`\n${C.b}── Offline queue proof ──${C.x}\n`);

console.log(`${C.b}Delivery${C.x}`);
reset();
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'roti' }, userId: 'u1' });
await q.addToOfflineQueue({ type: 'logWorkout', payload: { name: 'squat' }, userId: 'u1' });
check('queued writes are counted', (await q.pendingOfflineCount()) === 2);
let r = await q.syncOfflineQueue();
check('both items delivered', r.sent === 2 && data.calls.length === 2);
check('queue is empty after a clean replay', (await q.pendingOfflineCount()) === 0);

console.log(`\n${C.b}Failure keeps data${C.x}`);
reset();
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'nasi' }, userId: 'u1' });
data.setMode('fail');
r = await q.syncOfflineQueue();
check('a rejected write is NOT dropped', r.failed === 1 && (await q.pendingOfflineCount()) === 1);
const kept = (await idb.get('offline_sync_queue'))[0];
check('the retry is counted', kept.attempts === 1);
data.setMode('ok');
r = await q.syncOfflineQueue();
check('it is delivered on the next replay', r.sent === 1 && (await q.pendingOfflineCount()) === 0);

console.log(`\n${C.b}Concurrency${C.x}`);
// THE regression this file exists for. `syncing` was set AFTER `await readQueue()`,
// so two overlapping replays both passed the guard and delivered the SAME queue
// twice. A duplicated meal is worse than a delayed one.
reset();
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'mee' }, userId: 'u1' });
await q.addToOfflineQueue({ type: 'logWorkout', payload: { name: 'bench' }, userId: 'u1' });
const [a, b] = await Promise.all([q.syncOfflineQueue(), q.syncOfflineQueue()]);
check('two concurrent replays deliver each item exactly once',
  data.calls.length === 2, `delivered ${data.calls.length} writes for 2 queued items`);
check('only one replay does the work', (a.sent === 2) !== (b.sent === 2));
check('queue is drained exactly once', (await q.pendingOfflineCount()) === 0);

// An item queued WHILE a replay is in flight must survive the final write.
reset();
data.setMode('fail');
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'old' }, userId: 'u1' });
const inflight = q.syncOfflineQueue();
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'new' }, userId: 'u1' });
await inflight;
const names = (await idb.get('offline_sync_queue')).map((i) => i.payload.name).sort();
check('an item queued mid-replay is not clobbered',
  names.join(',') === 'new,old', `queue held: ${names.join(',') || '(empty)'}`);

console.log(`\n${C.b}Offline${C.x}`);
reset();
setOnline(false);
await q.addToOfflineQueue({ type: 'logMeal', payload: { name: 'x' }, userId: 'u1' });
r = await q.syncOfflineQueue();
check('nothing is attempted while offline', r.sent === 0 && data.calls.length === 0);
check('the item is still queued', (await q.pendingOfflineCount()) === 1);
setOnline(true);

const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`); process.exit(1); }
