// Badge system proof harness — npm run proof:badges
//
// Two halves, both deterministic and both offline:
//
//   Part A — the pure logic in badgeUtils: distinct local days, consecutive
//            runs, and the query lower bound. Exact for known inputs, coherent
//            under fuzz.
//
//   Part B — REACHABILITY. Ten of the badges shipped in ALL_BADGES with no
//            awarding path anywhere in the app: they were rendered in the
//            Profile gallery, with their requirement text, as goals no sequence
//            of user actions could ever unlock. Part B reads the source and
//            fails if any badge becomes unreachable again, or if a checker in
//            badgeService loses its last call site.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { dayKeysOf, hasConsecutiveRun, sinceDaysAgo } = await import('../src/services/badgeUtils.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ${PASS} ${n}`); }
  else { fail++; console.log(`  ${FAIL} ${n}${d ? ` ${C.d}— ${d}${C.x}` : ''}`); }
};

// A Firestore-doc stand-in: only `.data().timestamp.toDate()` is ever touched.
const docAt = (date) => ({ data: () => ({ timestamp: { toDate: () => date } }) });
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

console.log(`\n${C.b}── Badge proof ──${C.x}\n`);

// ─── Part A · dayKeysOf ───────────────────────────────────────────────────────
console.log(`${C.b}Part A · dayKeysOf${C.x}`);
check('empty in, empty out', dayKeysOf([]).length === 0);
check('one doc → one day', dayKeysOf([docAt(at(2026, 6, 12))]).join() === '2026-06-12');
check('two docs, same day → ONE day (distinct)',
  dayKeysOf([docAt(at(2026, 6, 12, 7)), docAt(at(2026, 6, 12, 22))]).length === 1);
check('returned ascending regardless of input order',
  dayKeysOf([docAt(at(2026, 6, 14)), docAt(at(2026, 6, 12)), docAt(at(2026, 6, 13))]).join() ===
  '2026-06-12,2026-06-13,2026-06-14');
check('local day, not UTC — 00:30 local stays on its own date',
  dayKeysOf([docAt(at(2026, 6, 12, 0))]).join() === '2026-06-12');
check('23:00 local stays on its own date',
  dayKeysOf([docAt(at(2026, 6, 12, 23))]).join() === '2026-06-12');

// Malformed records must vanish, never become an epoch day.
check('missing timestamp dropped', dayKeysOf([{ data: () => ({}) }]).length === 0);
check('undefined data dropped', dayKeysOf([{ data: () => undefined }]).length === 0);
check('timestamp without toDate dropped', dayKeysOf([{ data: () => ({ timestamp: {} }) }]).length === 0);
check('Invalid Date dropped', dayKeysOf([docAt(new Date('nope'))]).length === 0);
check('a bad record does not remove a good one',
  dayKeysOf([docAt(new Date('nope')), docAt(at(2026, 6, 12))]).join() === '2026-06-12');

// ─── Part A · hasConsecutiveRun ───────────────────────────────────────────────
console.log(`\n${C.b}Part A · hasConsecutiveRun${C.x}`);
const D = (...ds) => ds.map((d) => `2026-06-${String(d).padStart(2, '0')}`);
check('3 in a row, need 3 → true', hasConsecutiveRun(D(10, 11, 12), 3));
check('3 in a row, need 4 → false', hasConsecutiveRun(D(10, 11, 12), 4) === false);
check('gap breaks the run', hasConsecutiveRun(D(10, 11, 13, 14), 3) === false);
check('run resumes after a gap', hasConsecutiveRun(D(1, 3, 4, 5), 3));
check('run found at the very end', hasConsecutiveRun(D(1, 5, 10, 11, 12), 3));
check('run found at the very start', hasConsecutiveRun(D(10, 11, 12, 20), 3));
check('need 1 → any single day suffices', hasConsecutiveRun(D(7), 1));
check('empty list, need 1 → false', hasConsecutiveRun([], 1) === false);
check('need 0 → vacuously true', hasConsecutiveRun([], 0));
check('7-day run, need 7 (Macro Master) → true', hasConsecutiveRun(D(1, 2, 3, 4, 5, 6, 7), 7));
check('6-day run, need 7 (Macro Master) → false', hasConsecutiveRun(D(1, 2, 3, 4, 5, 6), 7) === false);
check('duplicates do not inflate a run',
  hasConsecutiveRun(['2026-06-10', '2026-06-10', '2026-06-10'], 3) === false);
check('malformed key does not throw', (() => {
  try { hasConsecutiveRun(['nope', '2026-06-10', '2026-06-11'], 2); return true; } catch { return false; }
})());

// Month, year and leap-day boundaries — where naive day arithmetic dies.
check('crosses a month boundary',
  hasConsecutiveRun(['2026-06-29', '2026-06-30', '2026-07-01'], 3));
check('crosses a year boundary',
  hasConsecutiveRun(['2026-12-30', '2026-12-31', '2027-01-01'], 3));
check('crosses a leap day',
  hasConsecutiveRun(['2028-02-28', '2028-02-29', '2028-03-01'], 3));
check('28 Feb → 1 Mar is NOT consecutive in a leap year',
  hasConsecutiveRun(['2028-02-28', '2028-03-01'], 2) === false);
check('28 Feb → 1 Mar IS consecutive in a common year',
  hasConsecutiveRun(['2027-02-28', '2027-03-01'], 2));

// ─── Part A · sinceDaysAgo ────────────────────────────────────────────────────
console.log(`\n${C.b}Part A · sinceDaysAgo${C.x}`);
const now = at(2026, 6, 12, 15);
const s6 = sinceDaysAgo(6, now);
check('lands on local midnight, not the current clock time',
  s6.getHours() === 0 && s6.getMinutes() === 0 && s6.getSeconds() === 0 && s6.getMilliseconds() === 0);
check('6 days back from 12 Jun → 6 Jun', s6.getDate() === 6 && s6.getMonth() === 5);
check('0 days back → today at midnight',
  sinceDaysAgo(0, now).getDate() === 12 && sinceDaysAgo(0, now).getHours() === 0);
check('window covers 7 distinct days inclusive (Week Warrior)', (() => {
  const lo = sinceDaysAgo(6, now);
  let n = 0;
  for (let i = 0; i < 7; i++) { const d = at(2026, 6, 12 - i, 9); if (d >= lo) n++; }
  return n === 7;
})());
check('the 8th day back falls OUTSIDE the 7-day window',
  at(2026, 6, 5, 23) < sinceDaysAgo(6, now));
check('crosses a month boundary backwards', (() => {
  const d = sinceDaysAgo(6, at(2026, 7, 3, 15));
  return d.getMonth() === 5 && d.getDate() === 27;
})());
check('does not mutate the date passed in', (() => {
  const src = at(2026, 6, 12, 15);
  sinceDaysAgo(30, src);
  return src.getDate() === 12 && src.getHours() === 15;
})());

// ─── Part A · fuzz ────────────────────────────────────────────────────────────
console.log(`\n${C.b}Part A · fuzz${C.x}`);
let rng = 20260612;
const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
const keyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let throws = 0, mismatches = 0, monotoneBreaks = 0;
for (let t = 0; t < 3000; t++) {
  const base = new Date(2026, rand(12), 1 + rand(28));
  const n = rand(20);
  const set = new Set();
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + rand(30));
    set.add(keyOf(d));
  }
  const days = Array.from(set).sort();
  try {
    // Brute-force reference: longest run of consecutive calendar days.
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      const [y, m, dd] = k.split('-').map(Number);
      const cur = Date.UTC(y, m - 1, dd) / 86400000;
      run = prev !== null && cur - prev === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = cur;
    }
    for (let need = 1; need <= 8; need++) {
      if (hasConsecutiveRun(days, need) !== (best >= need)) mismatches++;
    }
    // Monotone: if a run of k exists, a run of k-1 must too.
    for (let need = 2; need <= 8; need++) {
      if (hasConsecutiveRun(days, need) && !hasConsecutiveRun(days, need - 1)) monotoneBreaks++;
    }
  } catch { throws++; }
}
check('fuzz: 3,000 day-sets — zero throws', throws === 0, `${throws} threw`);
check('fuzz: matches a brute-force longest-run reference', mismatches === 0, `${mismatches} mismatched`);
check('fuzz: run(k) implies run(k-1), always', monotoneBreaks === 0, `${monotoneBreaks} broke`);

// ─── Part B · reachability ────────────────────────────────────────────────────
console.log(`\n${C.b}Part B · every badge is reachable${C.x}`);

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const SRC = join(ROOT, 'src');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
/**
 * Erase comments, keep code and string literals verbatim.
 *
 * Without this the scan below is satisfied by a call site that has been
 * COMMENTED OUT — which is exactly how a badge goes quietly unreachable — or by
 * a badge id named only in prose. String bodies are preserved (that is where
 * the `'badge_id'` literals live) and skipped over, so a `//` inside a URL is
 * not mistaken for the start of a comment.
 */
const stripComments = (src) => {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i]; i++;
      }
      out += src[i] ?? ''; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
};

const files = walk(SRC);
const sources = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));
const badgeServicePath = files.find((f) => f.endsWith('badgeService.ts'));
const badgeSrc = sources.get(badgeServicePath);

// Badge ids, read straight out of ALL_BADGES so a newly added badge is covered
// the moment it is declared — the whole point of this half of the harness.
const allBadgesBlock = badgeSrc.slice(badgeSrc.indexOf('ALL_BADGES'), badgeSrc.indexOf('Core award'));
const badgeIds = [...allBadgesBlock.matchAll(/\{\s*id:\s*'(\w+)'/g)].map((m) => m[1]);
check(`ALL_BADGES parsed (${badgeIds.length} badges)`, badgeIds.length >= 20, `${badgeIds.length} found`);

// Which exported checkers actually have a call site outside badgeService?
const exportedCheckers = [...badgeSrc.matchAll(/export async function (check\w+)/g)].map((m) => m[1]);
const calledSomewhere = new Set();
for (const [path, text] of sources) {
  if (path === badgeServicePath) continue;
  for (const fn of exportedCheckers) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(text)) calledSomewhere.add(fn);
  }
}
const orphanCheckers = exportedCheckers.filter((f) => !calledSomewhere.has(f));
check(`every exported checker has a call site (${exportedCheckers.length} checkers)`,
  orphanCheckers.length === 0, orphanCheckers.join(', '));

// A badge is reachable if some LIVE code path names it: either a call site
// outside badgeService awards it directly, or a checker that IS called names it.
const liveCheckerBodies = exportedCheckers
  .filter((f) => calledSomewhere.has(f))
  .map((f) => {
    const i = badgeSrc.indexOf(`export async function ${f}`);
    const j = badgeSrc.indexOf('\nexport ', i + 1);
    return badgeSrc.slice(i, j === -1 ? badgeSrc.length : j);
  })
  .join('\n');

const outsideText = [...sources.entries()]
  .filter(([p]) => p !== badgeServicePath)
  .map(([, t]) => t)
  .join('\n');

const reachedBy = (id) => {
  const named = new RegExp(`'${id}'`);
  if (named.test(outsideText)) return 'call site';
  if (named.test(liveCheckerBodies)) return 'checker';
  return null;
};
const unreachable = badgeIds.filter((id) => reachedBy(id) === null);
check('no badge is displayed as a goal nobody can reach',
  unreachable.length === 0, unreachable.join(', '));

for (const id of badgeIds) {
  const where = reachedBy(id);
  console.log(`    ${where ? C.g + 'ok' + C.x : C.r + 'XX' + C.x} ${id.padEnd(20)} ${C.d}${where || 'UNREACHABLE'}${C.x}`);
}

// ─── Part B · the plan/workout split ──────────────────────────────────────────
console.log(`\n${C.b}Part B · built plans are not completed workouts${C.x}`);
const libSrc = sources.get(files.find((f) => f.endsWith('Library.tsx')));
const workoutSrc = sources.get(files.find((f) => f.endsWith('Workout.tsx')));
const planSrc = sources.get(files.find((f) => f.endsWith('workoutPlanService.ts')));
check('the session builder no longer writes into `workouts`',
  !/addDoc\(collection\(db,\s*'workouts'\)/.test(libSrc));
check('the session builder saves a plan instead', /saveWorkoutPlan\(/.test(libSrc));
check('plans live in their own collection', /collection\(db,\s*'workout_plans'\)/.test(planSrc));
check('a saved plan can actually be started',
  /startPlan/.test(libSrc) && /startPlan/.test(workoutSrc));

// Rules + indexes must know about the collection, or the feature 403s / hangs.
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const indexes = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8'));
const fnsSrc = readFileSync(join(ROOT, 'functions', 'src', 'index.ts'), 'utf8');
check('workout_plans has security rules', /match \/workout_plans\//.test(rules));
check('workout_plans rules are owner-scoped',
  /match \/workout_plans\/[\s\S]{0,400}?request\.auth\.uid/.test(rules));
check('workout_plans is deleted with the account', /"workout_plans"/.test(fnsSrc));

// ─── Part B · every composite query has an index ──────────────────────────────
console.log(`\n${C.b}Part B · every composite query has an index${C.x}`);
const declared = new Set(
  indexes.indexes.map((i) => `${i.collectionGroup}:${i.fields.map((f) => f.fieldPath).join(',')}`),
);
// (collection, fields) pairs the app actually issues. An equality on userId plus
// a range or an order on a second field needs a composite index; without it
// Firestore throws failed-precondition, which every caller here swallows — so
// the feature does not error, it silently never works.
const required = [
  ['meals', 'userId,timestamp'], ['workouts', 'userId,timestamp'],
  ['water_logs', 'userId,timestamp'], ['sleep_logs', 'userId,timestamp'],
  ['wellness_logs', 'userId,timestamp'], ['weight_history', 'userId,timestamp'],
  ['notifications', 'userId,timestamp'], ['step_days', 'userId,day'],
  ['sleep_logs', 'userId,hours'], ['workout_plans', 'userId,createdAt'],
];
for (const [coll, fields] of required) {
  check(`${coll} (${fields})`, declared.has(`${coll}:${fields}`));
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) {
  console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
} else {
  console.log(`${C.r}${C.b}${fail} FAILED${C.x}\n`);
  process.exit(1);
}
