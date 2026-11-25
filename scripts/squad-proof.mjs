// Squads pure-logic proof — npm run proof:squads
//
// Proves src/lib/squadUtils.ts (codes, names, goals, the Monday-00:00 week in
// the squad's time zone incl. DST, ranking with ties, owner hand-over) and that
// the server copy in functions/src/squadCore.ts agrees with it.
//
// Two kinds of control, because a check that cannot fail proves nothing:
//   CONTROL  inside the run: a naive implementation (UTC week, start + 168 h,
//            sort without ties) is run through the same cases and MUST fail them.
//   MUTANT   at the end the proof re-runs itself against a copy of squadUtils
//            with the week boundary broken (Sunday start). That child run MUST
//            exit non-zero; the copy is deleted afterwards.

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const UTILS = process.env.SQUAD_UTILS_PATH || join(HERE, '../src/lib/squadUtils.ts');
const IS_MUTANT = !!process.env.SQUAD_UTILS_PATH;
const S = await import(pathToFileURL(UTILS).href);
const core = await import(pathToFileURL(join(HERE, '../functions/src/squadCore.ts')).href);
const server = core.default && !core.normalizeCode ? core.default : core;

const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  if (!IS_MUTANT || !ok) console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${name}${!ok && detail ? `  ${C.d}— ${detail}${C.x}` : ''}`);
};
const control = (name, naiveIsWrong) => check(`CONTROL ${name}`, naiveIsWrong, 'the naive version passed too, so this case does not discriminate');
const section = (t) => { if (!IS_MUTANT) console.log(`\n${C.b}${t}${C.x}`); };
const H = 3_600_000;

if (!IS_MUTANT) console.log(`\n${C.b}── Squads proof ──${C.x}`);

// ── Codes ────────────────────────────────────────────────────────────────────
section('Invite codes');
check('alphabet has no 0, O, 1 or I', !/[0O1I]/.test(S.CODE_ALPHABET) && S.CODE_ALPHABET.length === 32);
check('alphabet has no repeated characters', new Set(S.CODE_ALPHABET).size === S.CODE_ALPHABET.length);
{
  // mulberry32: a decent deterministic PRNG (the server uses crypto.randomInt).
  let seed = 12345;
  const rand = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  const codes = Array.from({ length: 20000 }, () => S.generateCode(rand));
  check('20,000 generated codes are all 6 chars and valid', codes.every((c) => c.length === 6 && S.normalizeCode(c) === c));
  const counts = {}; for (const c of codes.join('')) counts[c] = (counts[c] || 0) + 1;
  const vals = Object.values(counts);
  check('every alphabet letter is used, roughly evenly', vals.length === 32 && Math.min(...vals) > 0.8 * (120000 / 32) && Math.max(...vals) < 1.2 * (120000 / 32),
    JSON.stringify([Math.min(...vals), Math.max(...vals)]));
  check('collisions are rare (32^6 ≈ 1.07e9 space)', new Set(codes).size >= 19990, String(new Set(codes).size));
}
check('lower case, spaces and dashes are forgiven', S.normalizeCode(' abc-def ') === 'ABCDEF' && S.normalizeCode('k7m 2pq') === 'K7M2PQ');
for (const bad of ['ABC0EF', 'ABCOEF', 'ABC1EF', 'ABCIEF', 'ABCDE', 'ABCDEFG', '', 'ABC_EF', 'ÄBCDEF', null, 123456, {}]) {
  check(`rejects ${JSON.stringify(bad)}`, S.normalizeCode(bad) === null);
}

// ── Names & goals ────────────────────────────────────────────────────────────
section('Names, goals, numbers');
const nameCases = [
  ['  Morning   Crew  ', 'Morning Crew'], ['A', null], ['AB', 'AB'], ['x'.repeat(30), 'x'.repeat(30)], ['x'.repeat(31), null],
  ['<b>Gym</b> Rats', 'bGym/b Rats'], ['Run\u0000\u0007ners', 'Runners'], ['Zero​Width', 'ZeroWidth'], ['‮evil', 'evil'],
  ['   ', null], [42, null], ['Lari 🏃 Kuat', 'Lari 🏃 Kuat'], ['🏃'.repeat(30), '🏃'.repeat(30)], ['🏃'.repeat(31), null],
];
for (const [inp, want] of nameCases) check(`name ${JSON.stringify(inp).slice(0, 34)} → ${JSON.stringify(want)?.slice(0, 34)}`, S.sanitizeSquadName(inp) === want, String(S.sanitizeSquadName(inp)));
check('goal: steps 200000 ok, 999 too low, 5,000,001 too high', S.sanitizeGoal('steps', 200000) === 200000 && S.sanitizeGoal('steps', 999) === null && S.sanitizeGoal('steps', 5000001) === null);
check('goal: "15" (typed) → 15, NaN/Infinity refused', S.sanitizeGoal('workouts', '15') === 15 && S.sanitizeGoal('workouts', NaN) === null && S.sanitizeGoal('workouts', Infinity) === null);
check('goal: active days capped at 70', S.sanitizeGoal('activeDays', 70) === 70 && S.sanitizeGoal('activeDays', 71) === null);
check('metric whitelist', S.isSquadMetric('steps') && S.isSquadMetric('activeDays') && S.isSquadMetric('workouts') && !S.isSquadMetric('calories') && !S.isSquadMetric(undefined));
check('weekly values clamp to the rule bounds', S.clampWeekValue('steps', 9e9) === 700000 && S.clampWeekValue('activeDays', 9) === 7 &&
  S.clampWeekValue('workouts', -3) === 0 && S.clampWeekValue('steps', 10.9) === 10 && S.clampWeekValue('steps', NaN) === 0);
check('WEEK_LIMITS match firestore.rules', (() => {
  const r = readFileSync(join(HERE, '../firestore.rules'), 'utf8');
  return r.includes(`data.steps <= ${S.WEEK_LIMITS.steps}`) && r.includes(`data.activeDays <= ${S.WEEK_LIMITS.activeDays}`) && r.includes(`data.workouts <= ${S.WEEK_LIMITS.workouts}`);
})());
check('time zones: real ones accepted, junk refused', S.isValidTimeZone('Asia/Kuala_Lumpur') && S.isValidTimeZone('America/New_York') &&
  !S.isValidTimeZone('Mars/Olympus') && !S.isValidTimeZone('') && !S.isValidTimeZone(5) && S.safeTimeZone('nope') === 'UTC');

// ── Weeks ────────────────────────────────────────────────────────────────────
section('Week key: Monday 00:00 in the squad\'s zone');
const wk = (iso, tz) => S.weekKey(new Date(iso), tz);
const weekCases = [
  // [instant, zone, expected Monday, why]
  ['2026-11-22T16:00:00Z', 'Asia/Kuala_Lumpur', '2026-11-23', 'KL: Mon 00:00 (+8) is Sun 16:00 UTC'],
  ['2026-11-22T15:59:59Z', 'Asia/Kuala_Lumpur', '2026-11-16', 'KL: one second earlier is still last week'],
  ['2026-11-23T04:59:59Z', 'America/New_York', '2026-11-16', 'NY: Sun 23:59:59 EST'],
  ['2026-11-23T05:00:00Z', 'America/New_York', '2026-11-23', 'NY: Mon 00:00 EST'],
  ['2026-03-09T03:59:59Z', 'America/New_York', '2026-03-02', 'NY: Sun 23:59:59 EDT, the day DST began'],
  ['2026-03-09T04:00:00Z', 'America/New_York', '2026-03-09', 'NY: Mon 00:00 EDT after spring-forward'],
  ['2026-11-02T04:59:59Z', 'America/New_York', '2026-10-26', 'NY: Sun 23:59:59 EST, the day DST ended'],
  ['2026-11-02T05:00:00Z', 'America/New_York', '2026-11-02', 'NY: Mon 00:00 EST after fall-back'],
  ['2026-03-29T22:00:00Z', 'Europe/London', '2026-03-23', 'London: Sun 23:00 BST'],
  ['2026-03-29T23:00:00Z', 'Europe/London', '2026-03-30', 'London: Mon 00:00 BST'],
  ['2026-11-22T10:00:00Z', 'Pacific/Kiritimati', '2026-11-23', 'UTC+14: already Monday'],
  ['2026-11-22T10:00:00Z', 'Pacific/Pago_Pago', '2026-11-16', 'UTC-11: still Saturday... previous week'],
  ['2026-12-31T12:00:00Z', 'UTC', '2026-12-28', 'year end: Thursday'],
  ['2027-01-03T23:59:59Z', 'UTC', '2026-12-28', 'year end: Sunday of the straddling week'],
  ['2027-01-04T00:00:00Z', 'UTC', '2027-01-04', 'new year: first Monday'],
  ['2028-02-29T12:00:00Z', 'UTC', '2028-02-28', 'leap day'],
  ['2026-11-23T00:00:00Z', 'Asia/Kolkata', '2026-11-23', 'half-hour zone (+5:30)'],
  ['2026-11-22T18:29:59Z', 'Asia/Kolkata', '2026-11-16', 'half-hour zone, one second before'],
  ['2026-11-22T18:30:00Z', 'Asia/Kolkata', '2026-11-23', 'half-hour zone, Monday 00:00'],
];
for (const [iso, tz, want, why] of weekCases) check(`${why} → ${want}`, wk(iso, tz) === want, `got ${wk(iso, tz)}`);

// The naive version a busy developer writes: UTC week. It must get the boundary cases wrong.
const naiveWeekKey = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
control('a UTC-only week key gets the KL / NY / Kiritimati boundaries wrong',
  weekCases.filter(([iso, tz, want]) => naiveWeekKey(new Date(iso)) !== want).length >= 5);

section('Week ranges across DST');
const len = (iso, tz) => { const r = S.weekRange(new Date(iso), tz); return (r.end - r.start) / H; };
check('NY spring-forward week is 167 h', len('2026-03-05T12:00:00Z', 'America/New_York') === 167, String(len('2026-03-05T12:00:00Z', 'America/New_York')));
check('NY fall-back week is 169 h', len('2026-10-28T12:00:00Z', 'America/New_York') === 169, String(len('2026-10-28T12:00:00Z', 'America/New_York')));
check('London spring week is 167 h', len('2026-03-25T12:00:00Z', 'Europe/London') === 167);
check('KL (no DST) week is 168 h', len('2026-03-05T12:00:00Z', 'Asia/Kuala_Lumpur') === 168);
check('NY range starts at Mon 00:00 local', S.weekRange(new Date('2026-03-10T12:00:00Z'), 'America/New_York').start.toISOString() === '2026-03-09T04:00:00.000Z');
control('"start + 168 h" misses the DST end by an hour', (() => {
  const r = S.weekRange(new Date('2026-03-05T12:00:00Z'), 'America/New_York');
  return r.start.getTime() + 168 * H !== r.end.getTime();
})());
{
  // Havana springs forward AT midnight: 00:00 on 2026-03-08 does not exist.
  const m = S.zonedMidnight('2026-03-08', 'America/Havana');
  check('a day whose midnight is skipped (Havana) starts at the first real instant',
    S.localDay(m, 'America/Havana') === '2026-03-08' && S.localDay(new Date(m.getTime() - 1), 'America/Havana') === '2026-03-07', m.toISOString());
}
check('weekDays lists Mon..Sun', S.weekDays('2026-12-28').join() === '2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02,2027-01-03');
check('isWeekKey: Monday yes, Tuesday no, 2026-02-30 no, junk no',
  S.isWeekKey('2026-11-23') && !S.isWeekKey('2026-11-24') && !S.isWeekKey('2026-02-30') && !S.isWeekKey('2026-W48') && !S.isWeekKey(null));

section('Fuzz: 4,000 random instants × zones');
{
  const zones = ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
    'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Auckland', 'Pacific/Chatham', 'Asia/Kolkata', 'Asia/Kathmandu',
    'America/Sao_Paulo', 'America/Havana', 'America/Santiago', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Africa/Cairo'];
  let seed = 7, bad = [];
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) {
    const t = new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 5 * 365 * 86400000));
    const tz = zones[i % zones.length];
    const r = S.weekRange(t, tz);
    const ok = S.isWeekKey(r.key) && r.start <= t && t < r.end &&
      S.localDay(r.start, tz) === r.key && S.localDay(new Date(r.start.getTime() - 1), tz) < r.key &&
      S.weekKey(new Date(r.end.getTime() - 1), tz) === r.key && S.weekKey(r.end, tz) === S.addDays(r.key, 7) &&
      [166, 167, 167.5, 168, 168.5, 169, 170].includes((r.end - r.start) / H);
    if (!ok) bad.push(`${t.toISOString()} ${tz} → ${r.key}`);
  }
  check('every instant lies in [Mon 00:00, next Mon 00:00) of its own zone', bad.length === 0, bad.slice(0, 3).join(' | '));
}

// ── Ranking ──────────────────────────────────────────────────────────────────
section('Leaderboard ranking with ties');
{
  const r = S.rankMembers([
    { uid: 'a', name: 'Ana', value: 10 }, { uid: 'b', name: 'Ben', value: 20 },
    { uid: 'c', name: 'Cal', value: 20 }, { uid: 'd', name: 'Dee', value: 0 }, { uid: 'e', name: 'Eve', value: NaN },
  ]);
  const got = r.map((x) => `${x.uid}${x.rank}${x.tied ? 't' : ''}`).join(' ');
  check('20,20,10,0,NaN → 1,1,3,4,4 ("1, 1, 3"), ties flagged', got === 'b1t c1t a3 d4t e4t', got);
  check('ties are listed by name, stable', S.rankMembers([{ uid: 'z', name: 'Zed', value: 5 }, { uid: 'y', name: 'Amy', value: 5 }]).map((x) => x.uid).join() === 'y,z');
  check('empty board is fine', S.rankMembers([]).length === 0);
  const naive = [{ uid: 'b', value: 20 }, { uid: 'c', value: 20 }, { uid: 'a', value: 10 }].map((x, i) => i + 1);
  control('a plain index rank (1,2,3) is not what ties get', naive.join() !== r.slice(0, 3).map((x) => x.rank).join());
  check('squad total ignores junk', S.squadTotal([{ value: 5 }, { value: -2 }, { value: NaN }, { value: 7 }]) === 12);
  check('progress: 50%, capped 100%, 0 goal → 0', S.progressPct(50, 100) === 50 && S.progressPct(500, 100) === 100 && S.progressPct(5, 0) === 0 && S.progressPct(99.9, 100) === 99);
  check('reset countdown text', S.formatResetIn(3 * 86400000 + 4 * H) === '3d 4h' && S.formatResetIn(2 * H + 5 * 60000) === '2h 5m' && S.formatResetIn(-1) === 'now');
}

// ── Owner hand-over ──────────────────────────────────────────────────────────
section('Owner hand-over');
{
  const m = { own: { joinedAt: 1 }, x: { joinedAt: 30 }, y: { joinedAt: 20 }, z: { joinedAt: 20 } };
  check('owner leaves → longest-standing member (earliest joinedAt; uid breaks ties)', S.nextOwner(m, 'own') === 'y');
  check('last member leaves → nobody (squad is deleted)', S.nextOwner({ own: { joinedAt: 1 } }, 'own') === null);
}

// ── Server copy agrees ───────────────────────────────────────────────────────
section('Server (functions/src/squadCore.ts) agrees with the client');
{
  check('same alphabet and limits', server.CODE_ALPHABET === S.CODE_ALPHABET && server.SQUAD_MAX_MEMBERS === S.SQUAD_MAX_MEMBERS &&
    server.SQUADS_PER_USER === S.SQUADS_PER_USER && JSON.stringify(server.GOAL_LIMITS) === JSON.stringify(S.GOAL_LIMITS));
  const inputs = [...nameCases.map((c) => c[0]), 'abc-def', 'ABCDEF', 'ABC0EF', ' k7m 2pq', 'Ünïcödé Crew', 'a\tb'];
  const dis = inputs.filter((v) => server.sanitizeSquadName(v) !== S.sanitizeSquadName(v) || server.normalizeCode(v) !== S.normalizeCode(v));
  check('identical name and code sanitising on every case', dis.length === 0, JSON.stringify(dis));
  const goals = ['steps', 'activeDays', 'workouts'].flatMap((m) => [0, 1, 999, 1000, 70, 71, 500, 501, '15', 5e6, 5e6 + 1].map((g) => [m, g]));
  check('identical goal validation', goals.every(([m, g]) => server.sanitizeGoal(m, g) === S.sanitizeGoal(m, g)));
  let s1 = 1, s2 = 1;
  const r1 = (n) => { s1 = (s1 * 48271) % 2147483647; return s1 % n; };
  const r2 = (n) => { s2 = (s2 * 48271) % 2147483647; return s2 % n; };
  check('identical code generation for the same randomness', Array.from({ length: 200 }, () => server.generateCode(r1) === S.generateCode(r2)).every(Boolean));
  const m = { a: { joinedAt: 3 }, b: { joinedAt: 1 }, c: { joinedAt: 1 } };
  check('identical owner hand-over', ['a', 'b', 'c'].every((u) => server.nextOwner(m, u) === S.nextOwner(m, u)));
  check('server profile cleaners: no http/javascript photo, name capped', server.cleanPhotoURL('javascript:alert(1)') === '' &&
    server.cleanPhotoURL('http://x/a.png') === '' && server.cleanPhotoURL('https://x/a.png') === 'https://x/a.png' &&
    server.cleanDisplayName('') === 'Athlete' && server.cleanDisplayName('x'.repeat(99)).length === 40 && server.cleanDisplayName('<img>Bob') === 'imgBob');
}

section('Join rate limit (server)');
{
  let times = [], allowed = 0;
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 25; i++) { const r = server.takeAttempt(times, t0 + i * 1000); times = r.times; if (r.allowed) allowed++; }
  check('10 attempts per hour, the 11th..25th refused', allowed === 10, String(allowed));
  check('allowed again once the hour has passed', server.takeAttempt(times, t0 + server.JOIN_WINDOW_MS + 1000).allowed === true);
  check('a tampered (non-array / future) record does not lock out or unlock', server.takeAttempt('junk', t0).allowed &&
    server.takeAttempt(Array(50).fill(t0 + 9e9), t0).allowed);
}

// ── Mutation check ───────────────────────────────────────────────────────────
if (!IS_MUTANT) {
  section('Mutation: break the week boundary, the proof must fail');
  const src = readFileSync(UTILS, 'utf8');
  const needle = 'const sinceMonday = (dow + 6) % 7;';
  check('mutation target found in squadUtils.ts', src.includes(needle));
  const mutantPath = join(HERE, '../src/lib/.squadUtils.mutant.ts');
  try {
    writeFileSync(mutantPath, src.replace(needle, 'const sinceMonday = dow; // MUTANT: Sunday-start week'));
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      env: { ...process.env, SQUAD_UTILS_PATH: mutantPath }, encoding: 'utf8',
    });
    const failed = (child.stdout.match(/FAIL/g) || []).length;
    check(`the Sunday-start mutant FAILS the proof (exit ${child.status}, ${failed} failing checks)`, child.status !== 0 && failed > 0,
      (child.stderr || '').slice(0, 200));
  } finally {
    try { unlinkSync(mutantPath); } catch { /* gone */ }
  }
  check('the real squadUtils.ts is untouched', readFileSync(UTILS, 'utf8') === src);
}

console.log(`\n${C.b}Result: ${fail === 0 ? C.g : C.r}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}`);
if (fail === 0) { if (!IS_MUTANT) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`); }
else process.exit(1);
