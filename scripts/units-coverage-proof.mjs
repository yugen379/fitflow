// Units coverage proof — npm run proof:unitscoverage
//
// Static check, no browser: every screen must show measurements through the
// units core (src/lib/units.ts via useUnits / bindUnits), never a hard-coded
// metric unit. It scans src/**/*.tsx for unit words (kg, kcal, km, /km, ml,
// cm, lb, mph) that are DISPLAY text (JSX text, string and template literals)
// rather than code (identifiers like `kcal`, `per100.kcal`, `{ kg: ... }`,
// Tailwind classes like `ml-2`, comparisons like `=== 'ml'`, comments).
//
// Anything found must be on the ALLOWLIST below with a reason, or the run
// fails. Every allowlist entry must still match something, so a stale entry
// (code fixed or moved) fails too and the list cannot rot.
//
// CONTROLS — the scanner must be able to FAIL:
//   1. the converted screens as they were at b30e0bb (units core merged,
//      screens not yet converted) must each produce offenders, and none now;
//   2. synthetic snippets with known offenders / known code must classify
//      exactly as expected (including comment and URL handling).
//
// Set UNITS_COVERAGE_VERBOSE=1 to also list the allowlisted occurrences.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`, FAIL = `${C.r}FAIL${C.x}`;
const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(decodeURIComponent(new URL('..', import.meta.url).pathname)).replace(/[\\/]$/, '');
const BEFORE = 'b30e0bb';
const VERBOSE = process.env.UNITS_COVERAGE_VERBOSE === '1';

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? PASS : FAIL} ${name}${!ok && detail ? ` ${C.d}— ${detail}${C.x}` : ''}`);
};

// ── The scanner ─────────────────────────────────────────────────────────────
const UNIT = /(?<![\w$.-])(kg|kcal|km|ml|cm|lbs?|mph)(?![\w$-])/g;

/** Blank out comments, keeping line numbers. */
const stripComments = (src) =>
  src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');

/**
 * Is this occurrence code rather than text a person reads? Deliberately
 * conservative: when in doubt it is DISPLAY, so the allowlist has to justify it.
 */
const isCode = (line, at, word) => {
  const before = line.slice(0, at);
  const after = line.slice(at + word.length);
  const quoted = /['"`]\s*$/.test(before); // right after an opening quote: a literal
  // Part of a URL.
  if (/:\/\/\S*$/.test(before)) return true;
  // Inside a string or template literal (odd number of quotes before it, and
  // not inside a ${...} expression): text, unless it is a compared/typed value.
  const plain = before.replace(/\\./g, '');
  const odd = (ch) => (plain.split(ch).length - 1) % 2 === 1;
  if (!/\$\{[^}]*$/.test(before) && (odd("'") || odd('"') || odd('`'))) {
    if (/(===|!==)\s*['"]$/.test(before) || /^['"]\s*(===|!==)/.test(after)) return true;
    if (/\|\s*['"]$/.test(before) || /^['"]\s*\|/.test(after)) return true;
    return false;
  }
  // Text in brackets is text: "Weight (kg)", "(1 kcal = 4.184 kJ)".
  if (/(^|[\s>])\($/.test(before) && /^\)/.test(after)) return false;
  // Inside braces as an expression: {kcal} or {kcal / 4}
  if (/\{\s*$/.test(before) && /^\s*[}*+\-/%?:<>=!)]/.test(after)) return true;
  // Property access: kcal.toLocaleString()
  if (/^\.[A-Za-z_$]/.test(after)) return true;
  // Declarations, keys, assignments, typed params, destructuring, call args
  if (/\b(const|let|var|function)\s+$/.test(before)) return true;
  if (!quoted && /^\s*\??[:=](?!=)/.test(after)) return true;
  if (!quoted && /(?:[,{]|[\w$\]]\(|[^'"`\s]:)\s*$/.test(before) && /^\s*[,})]/.test(after)) return true;
  // Arithmetic, comparison, call or index on an identifier
  if (!quoted && /^\s*[([]/.test(after)) return true;
  if (!quoted && /^\s+([*+\-%?<>]|===?|!==?|&&|\|\|)|^\s*[)\];]|^\s+\/\s/.test(after)) return true;
  if (!quoted && /[*+\-%]\s*$/.test(before)) return true;
  // String literal used as a VALUE to compare or a type: === 'ml', 'kg' | 'lb'
  if (/(===|!==)\s*['"]$/.test(before) || /^['"]\s*(===|!==)/.test(after)) return true;
  if (/\|\s*['"]$/.test(before) || /^['"]\s*\|/.test(after)) return true;
  return false;
};

/** [{ line, col, word, text }] display-unit occurrences in a .tsx source. */
const scan = (src) => {
  const out = [];
  stripComments(src).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(UNIT)) {
      if (isCode(line, m.index, m[1])) continue;
      out.push({ line: i + 1, col: m.index + 1, word: m[1], text: line.trim() });
    }
  });
  return out;
};

// ── Allowlist: places where a metric unit is INTENTIONALLY fixed ─────────────
// file: path under src/, match: tested against the trimmed line, why: reason.
const ALLOWLIST = [
  // Settings: the preset captions NAME the units each preset means.
  { file: 'src/pages/Settings.tsx', match: /^metric: 'kg · cm · km · ml',$/, why: 'Settings preset caption: spells out what "Metric" means' },
  { file: 'src/pages/Settings.tsx', match: /^us: 'lb · ft in · mi · fl oz',$/, why: 'Settings preset caption: spells out what "US" means' },
  { file: 'src/pages/Settings.tsx', match: /^uk: 'st lb · cm · km · ml',$/, why: 'Settings preset caption: spells out what "UK" means' },
  { file: 'src/pages/Settings.tsx', match: /label: 'kcal'/, why: 'Settings energy toggle: this option IS the kcal unit' },
  { file: 'src/pages/Settings.tsx', match: /'Kilojoules \(1 kcal = 4\.184 kJ\)'/, why: 'Settings energy caption: states the kcal-to-kJ factor itself' },
  // Onboarding / Profile (units core): unit pickers and parse hints name units on purpose.
  { file: 'src/pages/Onboarding.tsx', match: /^const weightHint = 'Try 72\.5 kg, 160 lb or 11 st 6';$/, why: 'parse hint: lists the formats the weight field accepts, in every unit' },
  { file: 'src/pages/Onboarding.tsx', match: /^options=\{\[\{ id: 'kg', label: 'kg' \}, \{ id: 'lb', label: 'lb' \}, \{ id: 'st', label: 'st \+ lb' \}\]\}$/, why: 'weight unit picker: the options ARE the units' },
  { file: 'src/pages/Onboarding.tsx', match: /^options=\{\[\{ id: 'metric', label: 'cm' \}, \{ id: 'imperial', label: 'ft \+ in' \}\]\}$/, why: 'height unit picker: the options ARE the units' },
  { file: 'src/pages/Profile.tsx', match: /role="alert">Try 75\.5 kg, 165 lb or 11 st 6</, why: 'parse hint: lists the formats the weight field accepts, in every unit' },
  // Stored text: storage stays metric, so a note written to Firestore stays metric.
  { file: 'src/pages/Lab.tsx', match: /^notes: `Biomechanics Lab · \$\{Math\.round\(volumeKg\)\} kg total volume`,$/, why: 'stored workout note (Firestore, never rendered): storage stays metric' },
  // GPS: the km/mi quick switch's own button labels.
  { file: 'src/pages/TrackActivity.tsx', match: /^\{u === 'metric' \? 'km' : 'mi'\}$/, why: 'km / mi quick-switch buttons: the labels ARE the two choices (they write the profile units)' },
  // Track: the metric branch of a units-aware label (drinks are weighed by volume in metric).
  { file: 'src/pages/Track.tsx', match: /t\('Amount \(oz\)'\) : t\('Amount \(g or ml\)'\)/, why: 'label picked by foodMassUnit; "g or ml" is the metric side of the branch' },
  // NotificationCenter: buildNudges is exported pure for tests; this is its
  // DEFAULT energy formatter, overridden with units.formatEnergy on screen.
  { file: 'src/components/ui/NotificationCenter.tsx', match: /^formatEnergy = \(kcal: number\) => `\$\{kcal\.toLocaleString\(\)\} kcal`,$/, why: 'default formatter for the pure buildNudges(); the component passes units.formatEnergy' },
];

// ── 1. The current tree ─────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
});
const files = walk(join(ROOT, 'src')).map((p) => relative(ROOT, p).split(sep).join('/')).sort();

console.log(`\n${C.b}── Units coverage proof ──${C.x}  ${C.d}(${files.length} .tsx files under src/)${C.x}`);
console.log(`\n${C.b}Current tree: no hard-coded display units outside the allowlist${C.x}`);
const used = new Set();
const offenders = [];
let allowed = 0;
for (const f of files) {
  for (const hit of scan(readFileSync(join(ROOT, f), 'utf8'))) {
    const entry = ALLOWLIST.findIndex((a) => a.file === f && a.match.test(hit.text));
    if (entry >= 0) {
      used.add(entry); allowed++;
      if (VERBOSE) console.log(`    ${C.d}allowed ${f}:${hit.line} "${hit.word}" — ${ALLOWLIST[entry].why}${C.x}`);
      continue;
    }
    offenders.push({ f, ...hit });
  }
}
for (const o of offenders) console.log(`    ${C.r}${o.f}:${o.line}:${o.col}${C.x} "${o.word}"  ${C.d}${o.text.slice(0, 140)}${C.x}`);
check(`no un-allowlisted display units in ${files.length} files (${allowed} allowlisted occurrence(s), ${ALLOWLIST.length} entries)`,
  offenders.length === 0, `${offenders.length} offender(s) above`);
const stale = ALLOWLIST.filter((_, i) => !used.has(i));
for (const s of stale) console.log(`    ${C.r}stale${C.x} ${s.file} ${s.match}`);
check('every allowlist entry still matches something (no stale entries)', stale.length === 0, `${stale.length} stale`);
check('every allowlist entry names one file and gives a reason',
  ALLOWLIST.every((a) => files.includes(a.file) && typeof a.why === 'string' && a.why.length > 20));

// ── 2. CONTROL: the screens before conversion must FAIL ─────────────────────
console.log(`\n${C.b}Control: the same screens at ${BEFORE} (before conversion) must be caught${C.x}`);
const CONTROL_FILES = [
  'src/pages/Workout.tsx', 'src/pages/Track.tsx', 'src/pages/Home.tsx', 'src/pages/Explore.tsx',
  'src/pages/Steps.tsx', 'src/pages/TrackActivity.tsx', 'src/pages/MealPlan.tsx', 'src/pages/Library.tsx',
  'src/pages/Lab.tsx', 'src/pages/Analytics.tsx', 'src/pages/NutritionGoals.tsx',
  'src/components/StepHubWidget.tsx', 'src/components/SmartTargetCard.tsx', 'src/components/HydrationDrop.tsx',
  'src/components/WorkoutHistory.tsx', 'src/components/DailyHabits.tsx', 'src/components/MealDayCard.tsx',
  'src/components/TodayMission.tsx', 'src/components/ui/NotificationCenter.tsx',
  'src/components/3d/MacroMatrix.tsx', 'src/components/3d/OrbitalHUD.tsx',
  'src/biomechanics/components/SetLogger.tsx', 'src/biomechanics/components/EquipmentPicker.tsx',
];
const notAllowed = (f) => (h) => !ALLOWLIST.some((a) => a.file === f && a.match.test(h.text));
let gitOk = true;
let caughtBefore = 0;
for (const f of CONTROL_FILES) {
  let old = null;
  try { old = execFileSync('git', ['show', `${BEFORE}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 << 20 }); }
  catch { gitOk = false; }
  if (old == null) { check(`${f} @ ${BEFORE} readable`, false, 'git show failed'); continue; }
  const hits = scan(old).filter(notAllowed(f));
  const nowHits = scan(readFileSync(join(ROOT, f), 'utf8')).filter(notAllowed(f));
  if (hits.length) caughtBefore++;
  check(`${f}: ${hits.length} offender(s) at ${BEFORE} → ${nowHits.length} now`, hits.length > 0 && nowHits.length === 0,
    hits.length ? `still ${nowHits.length} now` : 'the scanner found nothing in the old file (blind)');
}
check(`git history available for the control (${BEFORE})`, gitOk);
check(`the scanner caught every control file before conversion (${caughtBefore}/${CONTROL_FILES.length})`, caughtBefore === CONTROL_FILES.length);

// ── 3. CONTROL: synthetic classification ────────────────────────────────────
console.log(`\n${C.b}Control: synthetic snippets classify as expected${C.x}`);
const MUST_FLAG = [
  '<span>{w.calories} kcal</span>',
  '<p className="x">{log.sets} × {log.reps} @ {log.weight}kg</p>',
  'const s = `Saved · ${km.toFixed(2)} km`;',
  '<Metric label="Pace" value={pace} unit="min/km" />',
  '<span className="text-[10px]">ml</span>',
  '<label>Weight (kg)</label>',
  "{ id: 'eat', unit: 'kcal' },",
  '              kcal',
  '<p>{h} cm</p>',
  "showToast(`Daily target set to ${t} kcal`);",
  'Grip width {Math.round(w * 200)} cm — this drives',
  '<span>{lbs} lbs</span>',
  'const x = 1; // fine\r\n<b>{n} kcal</b>',
];
const MUST_PASS = [
  'const kcal = Math.round(day.calories * MEAL_SHARE[meal]);',
  '<span className="ml-2 text-xs">x</span>',
  'className="w-11 h-11 -ml-2 rounded-xl"',
  "if (units.volumeUnit === 'ml') return;",
  "type W = 'kg' | 'lb';",
  '{it.per100 ? units.formatEnergy(it.per100.kcal) : null}',
  '.map((w) => ({ date: d, kg: Number(w.weight) }));',
  'const r = (kcal * s.p) / 4;',
  '// 250 kcal in a comment is fine',
  'water: number;       // ml today\r\n',
  '/* 5 km in a block comment */ const a = 1;',
  'const url = "https://example.com/kg";',
  'macroTargets: { ...existing, calorieTarget: kcal },',
  'if (kcal > 0) updateLine(i, { calories: kcal, protein: 0 });',
  'const pace = duration / 60 / Math.max(km, 0.01);',
  '{`${kcal.toLocaleString()}`}',
];
for (const s of MUST_FLAG) check(`flags: ${s.replace(/\s+/g, ' ').trim().slice(0, 70)}`, scan(s).length > 0);
for (const s of MUST_PASS) check(`ignores: ${s.replace(/\s+/g, ' ').trim().slice(0, 70)}`, scan(s).length === 0, JSON.stringify(scan(s).map((h) => h.word)));

// ── Summary ─────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${pass}/${total}${C.x}${C.b} checks passed${C.x}`);
if (fail) { console.log(`${C.r}${C.b}FAILED${C.x}\n`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
