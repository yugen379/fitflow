// In-app review policy proof (src/lib/reviewPrompt.ts).
//
//   npm run proof:reviewprompt
//
// Every rule is driven with a fake clock and fake storage. The suite of rule
// checks is then re-run against deliberately broken copies of the policy
// (CONTROLS): each broken copy must make the suite FAIL, which proves the
// checks can actually see the bug they claim to guard against.
import fs from 'node:fs';
import path from 'node:path';
import {
  decideReview, noteAppOpen, noteError, recordAsk, parseState, emptyState, localDayKey,
  createReviewPrompter, loadState, saveState, WIN_TRIGGERS, DAY_MS, COOLDOWN_MS, MAX_ASKS,
  MIN_INSTALL_AGE_MS, MIN_DISTINCT_DAYS, ERROR_QUIET_MS, STORAGE_KEY,
} from '../src/lib/reviewPrompt.ts';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  — ${detail}` : ''}`);
};

const T0 = new Date(2026, 0, 5, 9, 0).getTime(); // local 09:00, install moment
const H = 3_600_000;
const SID = 'sess:1';

/** A user who installed at T0 and opened the app on `days` distinct days. */
const seasoned = (days = 5, at = T0) => {
  let s = emptyState();
  for (let i = 0; i < days; i++) s = noteAppOpen(s, at + i * DAY_MS, `old:${i}`);
  return s;
};
const ctx = (now, extra = {}) => ({ now, trigger: 'daily_goal', sessionId: SID, interactive: true, ...extra });

// ─── The numbers themselves (the rules below are written against the constants,
// so a constant quietly changed would otherwise still pass) ──────────────────
ok('cooldown is 120 days', COOLDOWN_MS === 120 * DAY_MS);
ok('at most 3 asks ever', MAX_ASKS === 3);
ok('5 distinct days of use', MIN_DISTINCT_DAYS === 5);
ok('3 days since install', MIN_INSTALL_AGE_MS === 3 * DAY_MS);

// ─── The rule suite, parameterised by the policy under test ──────────────────
const ruleSuite = (decide) => {
  const r = [];
  const t = (name, cond) => r.push([name, Boolean(cond)]);
  const ready = seasoned(5);
  const day5 = T0 + 5 * DAY_MS;

  // 1. wins only
  for (const trig of WIN_TRIGGERS) t(`win "${trig}" asks`, decide(ready, ctx(day5, { trigger: trig })).ask);
  for (const trig of ['app_open', 'meal_logged', 'settings_saved', '', 'DAILY_GOAL'])
    t(`non-win "${trig}" never asks`, !decide(ready, ctx(day5, { trigger: trig })).ask);

  // 2. >= 5 distinct days
  t('4 distinct days: no', !decide(seasoned(4), ctx(day5)).ask);
  t('5 distinct days: yes', decide(seasoned(5), ctx(day5)).ask);
  let same = emptyState();
  for (let i = 0; i < 9; i++) same = noteAppOpen(same, T0 + i * H, `s${i}`); // 9 opens, 1 day
  same.firstSeenAt = T0 - 10 * DAY_MS;
  t('9 opens on one day count as 1 day: no', !decide(same, ctx(day5)).ask);

  // 3. >= 3 days since install
  const young = { ...seasoned(5), firstSeenAt: day5 - MIN_INSTALL_AGE_MS + 1 };
  t('install 3 days minus 1 ms ago: no', !decide(young, ctx(day5)).ask);
  t('install exactly 3 days ago: yes', decide({ ...young, firstSeenAt: day5 - MIN_INSTALL_AGE_MS }, ctx(day5)).ask);
  t('unknown install date: no', !decide({ ...ready, firstSeenAt: null }, ctx(day5)).ask);

  // 4. 120 days between asks
  const asked = recordAsk(ready, day5);
  t('ask 1 day after an ask: no', !decide(asked, ctx(day5 + DAY_MS)).ask);
  t('ask 119.99 days after an ask: no', !decide(asked, ctx(day5 + COOLDOWN_MS - 1)).ask);
  t('ask 120 days after an ask: yes', decide(asked, ctx(day5 + COOLDOWN_MS)).ask);
  t('clock set back before the last ask: no', !decide(asked, ctx(day5 - DAY_MS)).ask);

  // 5. at most 3 asks ever
  let three = ready;
  for (let i = 0; i < MAX_ASKS; i++) three = recordAsk(three, day5 + i * COOLDOWN_MS);
  t('after 3 asks, never again (even 5 years later)', !decide(three, ctx(day5 + 5 * 365 * DAY_MS)).ask);
  let two = ready;
  for (let i = 0; i < MAX_ASKS - 1; i++) two = recordAsk(two, day5 + i * COOLDOWN_MS);
  t('after 2 asks, a 3rd is allowed once the cooldown passes', decide(two, ctx(day5 + 2 * COOLDOWN_MS)).ask);

  // 6. never right after an error
  const err = noteError(ready, day5 - 60_000);
  t('error 1 minute ago: no', !decide(err, ctx(day5)).ask);
  t(`error ${ERROR_QUIET_MS / 60000} minutes ago: yes`, decide(noteError(ready, day5 - ERROR_QUIET_MS), ctx(day5)).ask);
  t('error stamped in the future (clock change): no', !decide(noteError(ready, day5 + H), ctx(day5)).ask);

  // 7. first session of the day, before the app is interactive
  const opened = noteAppOpen(ready, day5 - 60_000, SID); // SID is today's first session
  t('first session today, not interactive: no', !decide(opened, ctx(day5, { interactive: false })).ask);
  t('first session today, interactive: yes', decide(opened, ctx(day5, { interactive: true })).ask);
  const later = noteAppOpen(opened, day5 + H, 'sess:2');
  t('a LATER session today, not interactive: allowed by this rule', decide(later, ctx(day5 + H, { sessionId: 'sess:2', interactive: false })).ask);

  return r;
};

// ─── Run the suite on the real policy ────────────────────────────────────────
console.log('\nPolicy rules (real decideReview)\n');
for (const [name, cond] of ruleSuite(decideReview)) ok(name, cond);

// ─── Reasons are specific (so a log line explains a skip) ────────────────────
const R = (s, c) => decideReview(s, c).reason;
const ready = seasoned(5), day5 = T0 + 5 * DAY_MS;
ok('reason: not-a-win', R(ready, ctx(day5, { trigger: 'nope' })) === 'not-a-win');
ok('reason: few-days', R(seasoned(2), ctx(day5)) === 'few-days');
ok('reason: too-new', R({ ...ready, firstSeenAt: day5 - DAY_MS }, ctx(day5)) === 'too-new');
ok('reason: cooldown', R(recordAsk(ready, day5), ctx(day5 + DAY_MS)) === 'cooldown');
ok('reason: max-asks', R({ ...ready, asks: [1, 2, 3] }, ctx(day5)) === 'max-asks');
ok('reason: recent-error', R(noteError(ready, day5), ctx(day5)) === 'recent-error');
ok('reason: clock', R(recordAsk(ready, day5 + DAY_MS), ctx(day5)) === 'clock');

// ─── State bookkeeping ───────────────────────────────────────────────────────
console.log('\nState\n');
const s1 = noteAppOpen(emptyState(), T0, 'a');
ok('first open stamps the install time', s1.firstSeenAt === T0);
ok('later opens keep the original install time', noteAppOpen(s1, T0 + 9 * DAY_MS, 'b').firstSeenAt === T0);
ok('first open of a day becomes that day\'s first session', s1.firstSession?.id === 'a' && s1.firstSession?.day === localDayKey(T0));
ok('a second session the same day does not replace it', noteAppOpen(s1, T0 + H, 'b').firstSession?.id === 'a');
ok('next day: new first session', noteAppOpen(s1, T0 + DAY_MS, 'c').firstSession?.id === 'c');
let many = emptyState();
for (let i = 0; i < 40; i++) many = noteAppOpen(many, T0 + i * DAY_MS, `d${i}`);
ok('days list stays small but >= 5', many.usedDays.length <= 12 && many.usedDays.length >= MIN_DISTINCT_DAYS);
ok('local day key uses the LOCAL date (23:30 stays that day)', localDayKey(new Date(2026, 2, 3, 23, 30).getTime()) === '2026-03-03');
ok('junk storage -> empty state', JSON.stringify(parseState('{not json')) === JSON.stringify(emptyState()) && parseState(null).asks.length === 0);
ok('junk fields dropped', (() => { const p = parseState(JSON.stringify({ firstSeenAt: 'x', usedDays: ['2026-01-01', 'bad', 3, '2026-01-01'], asks: [5, 'x', 1], lastErrorAt: null })); return p.firstSeenAt === null && p.usedDays.length === 1 && p.asks.join() === '1,5'; })());
ok('round trip through storage', (() => { const m = new Map(); const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; saveState(st, recordAsk(ready, day5)); return loadState(st).asks[0] === day5 && m.has(STORAGE_KEY); })());
ok('a throwing storage never throws out of load/save', (() => { const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }; saveState(bad, ready); return loadState(bad).asks.length === 0; })());

// ─── The orchestrator, with a fake clock ─────────────────────────────────────
console.log('\nOrchestrator (fake clock, fake native)\n');
const rig = (over = {}) => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const clock = { t: day5 };
  saveState(storage, noteAppOpen(ready, day5 - 60_000, SID));
  const calls = [];
  const deps = {
    storage,
    now: () => clock.t,
    sessionId: () => SID,
    interactive: () => true,
    visible: () => true,
    sleep: async (ms) => { clock.t += ms; },
    requestReview: async () => { calls.push(loadState(storage).asks.length); return { flowFinished: true }; },
    ...over,
  };
  return { storage, clock, calls, ask: createReviewPrompter(deps), m };
};

{
  const r = rig();
  ok('a win on a ready user requests the review', (await r.ask('streak_7')) === 'requested' && r.calls.length === 1);
  ok('the ask is stored BEFORE the native call (a crash cannot loop)', r.calls[0] === 1);
  ok('a second win in the same session does not ask again', (await r.ask('personal_record')) === 'asked-this-session' && r.calls.length === 1);
}
{
  const r = rig();
  ok('a non-win never reaches native', (await r.ask('meal_logged')) === 'not-a-win' && r.calls.length === 0);
}
{
  let r;
  r = rig({ sleep: async (ms) => { r.clock.t += ms; saveState(r.storage, noteError(loadState(r.storage), r.clock.t)); } });
  ok('an error during the delay cancels the ask', (await r.ask('daily_goal')) === 'recent-error' && r.calls.length === 0);
}
{
  const r = rig({ visible: () => false });
  ok('app backgrounded during the delay: no ask, nothing stored', (await r.ask('daily_goal')) === 'hidden' && loadState(r.storage).asks.length === 0);
}
{
  let release;
  const r = rig({ sleep: () => new Promise((res) => { release = res; }) });
  const p1 = r.ask('daily_goal');
  const second = await r.ask('gps_activity');
  release();
  await p1;
  ok('two wins at once: the second is ignored while the first is pending', second === 'busy' && r.calls.length === 1);
}
{
  const r = rig({ requestReview: async () => { throw new Error('Play unavailable'); } });
  const out = await r.ask('smart_target');
  ok('native failure: the ask is rolled back (does not use up 1 of 3)', out === 'failed' && loadState(r.storage).asks.length === 0);
}
{
  const r = rig({ interactive: () => false });
  ok('first session of the day, splash still up / untouched: no ask', (await r.ask('daily_goal')) === 'not-interactive' && r.calls.length === 0);
}

// ─── A year of daily wins, end to end ────────────────────────────────────────
console.log('\nSimulation: 3 years, a win every day, a new session every day\n');
{
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const asks = [];
  for (let d = 0; d < 3 * 365; d++) {
    const now = T0 + d * DAY_MS + 8 * H;
    const sid = `day:${d}`;
    saveState(storage, noteAppOpen(loadState(storage), now, sid));
    const clock = { t: now + 5 * 60_000 };
    const ask = createReviewPrompter({
      storage, now: () => clock.t, sessionId: () => sid, interactive: () => true, visible: () => true,
      sleep: async (ms) => { clock.t += ms; }, requestReview: async () => { asks.push(clock.t); },
    });
    await ask(WIN_TRIGGERS[d % WIN_TRIGGERS.length]);
  }
  const gaps = asks.slice(1).map((a, i) => (a - asks[i]) / DAY_MS);
  ok(`exactly ${MAX_ASKS} asks in 3 years of daily wins (got ${asks.length})`, asks.length === MAX_ASKS);
  ok('first ask only after 5 distinct days and 3 days since install', asks.length > 0 && (asks[0] - T0) >= 4 * DAY_MS);
  ok(`asks are >= 120 days apart (gaps: ${gaps.map((g) => g.toFixed(0)).join(', ')})`, gaps.every((g) => g >= 120));
}

// ─── Wiring: every win site asks, lazily ─────────────────────────────────────
console.log('\nWiring\n');
const read = (f) => fs.readFileSync(f, 'utf8');
const SITES = [
  ['src/components/TodayMission.tsx', 'daily_goal'],
  ['src/services/analyticsService.ts', 'streak_7'],
  ['src/pages/Workout.tsx', 'personal_record'],
  ['src/pages/TrackActivity.tsx', 'gps_activity'],
  ['src/components/SmartTargetCard.tsx', 'smart_target'],
];
const LAZY = (trigger) => new RegExp(`import\\(['"][./]+(?:services/)?reviewService['"]\\)\\s*\\.then\\(\\(m\\)\\s*=>\\s*m\\.maybeAskForReview\\('${trigger}'\\)\\)`);
for (const [file, trig] of SITES) ok(`${file} asks on "${trig}" via a lazy import`, LAZY(trig).test(read(file)));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
const staticImporters = walk('src').filter((f) => /^\s*import[^;]*from\s+['"][./]+(?:services\/)?reviewService['"]/m.test(read(f)));
ok(`nothing imports reviewService statically (${staticImporters.join(', ') || 'none'})`, staticImporters.length === 0);
ok('error toasts are noted', /variant === 'error'\)\s*noteReviewError\(\)/.test(read('src/hooks/useToast.tsx')));
ok('error boundary is noted', /componentDidCatch[\s\S]{0,80}noteReviewError\(\)/.test(read('src/components/ErrorBoundary.tsx')));
ok('signals start at boot', /startReviewSignals\(\)/.test(read('src/main.tsx')));
ok('MainActivity registers the native plugin', /registerPlugin\(ReviewPlugin\.class\)/.test(read('android/app/src/main/java/com/fitflow/app/MainActivity.java')));
ok('native plugin name matches the JS name', /@CapacitorPlugin\(name = "Review"\)/.test(read('android/app/src/main/java/com/fitflow/app/review/ReviewPlugin.java')) && /registerPlugin<[^>]+>\('Review'\)/.test(read('src/services/reviewService.ts')));
ok('Play review dependency declared', /com\.google\.android\.play:review:/.test(read('android/app/build.gradle')));
ok('old monolithic play:core is not on the classpath (clashes with core-common)', !/com\.google\.android\.play:core:/.test(read('android/app/build.gradle')));

// ─── CONTROLS: broken policies must FAIL the rule suite ─────────────────────
console.log('\nControls (each broken policy must be caught)\n');
const fails = (decide) => ruleSuite(decide).filter(([, c]) => !c).map(([n]) => n);
const MUTANTS = {
  'no 120-day cooldown': (s, c) => decideReview({ ...s, asks: s.asks.length >= MAX_ASKS ? s.asks : [] }, c),
  'no 3-ask cap': (s, c) => decideReview({ ...s, asks: s.asks.slice(-1) }, c),
  'no 5-day rule': (s, c) => decideReview({ ...s, usedDays: ['2000-01-01', '2000-01-02', '2000-01-03', '2000-01-04', '2000-01-05'] }, c),
  'no install-age rule': (s, c) => decideReview({ ...s, firstSeenAt: s.firstSeenAt === null ? null : Math.min(s.firstSeenAt, c.now - MIN_INSTALL_AGE_MS) }, c),
  'no error rule': (s, c) => decideReview({ ...s, lastErrorAt: null }, c),
  'no interactive rule': (s, c) => decideReview(s, { ...c, interactive: true }),
  'asks on any trigger': (s, c) => decideReview(s, { ...c, trigger: 'daily_goal' }),
  'always asks': () => ({ ask: true, reason: 'ok' }),
};
for (const [name, mutant] of Object.entries(MUTANTS)) {
  const caught = fails(mutant);
  ok(`CONTROL: "${name}" is caught (${caught.length} check${caught.length === 1 ? '' : 's'} fail)`, caught.length > 0, 'the suite cannot see this bug');
}
ok('CONTROL: the real policy fails none of the checks', fails(decideReview).length === 0, fails(decideReview).join('; '));
// The lazy-import wiring scan must flag a static import.
ok('CONTROL: the static-import scan flags `import { maybeAskForReview } from \'../services/reviewService\'`',
  /^\s*import[^;]*from\s+['"][./]+(?:services\/)?reviewService['"]/m.test("import { maybeAskForReview } from '../services/reviewService';"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
