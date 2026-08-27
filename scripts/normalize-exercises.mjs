// One-shot repair + ongoing normaliser for the exercise library.
//
// Run: node scripts/normalize-exercises.mjs [--write]
//
// Fixes three defects the data had shipped with:
//   1. Fine muscle tags with no coarse parent, so the filter chips missed them
//      (Squats was invisible under "Legs").
//   2. Equipment values outside the filter's vocabulary (Yoga Mat, Bench,
//      Pull-up Bar, Jump Rope, Wall, Box), plus a "Resistance Band" chip that
//      matched nothing.
//   3. Seven duplicated exercise NAMES under different ids — "Mountain
//      Climbers" appeared three times in the list a user scrolls.
//
// Idempotent: running it on already-clean data changes nothing.

import { readFileSync, writeFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const FILE = ROOT + 'src/data/exerciseLibrary.json';
const WRITE = process.argv.includes('--write');

const MUSCLE_PARENT = {
  Quads: 'Legs', Quadriceps: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs',
  Calves: 'Legs', Adductors: 'Legs', Abductors: 'Legs', Hips: 'Legs',
  Biceps: 'Arms', Triceps: 'Arms', Forearms: 'Arms',
  Shoulder: 'Shoulders', Delts: 'Shoulders', Deltoids: 'Shoulders',
  Traps: 'Back', Lats: 'Back', 'Lower Back': 'Back', Rhomboids: 'Back',
  Abs: 'Core', Obliques: 'Core', 'Hip Flexors': 'Core',
  Pecs: 'Chest',
};
const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full Body'];
const EQUIPMENT = ['None', 'Dumbbells', 'Barbell', 'Resistance Band', 'Machine',
  'Kettlebell', 'Pull-up Bar', 'Bench', 'Yoga Mat', 'Jump Rope', 'Box', 'Cable',
  'Medicine Ball', 'Wall'];

// Legacy equipment spellings → canonical.
const EQUIP_ALIAS = {
  Bodyweight: 'None', 'Body weight': 'None', '': 'None',
  Mat: 'Yoga Mat', 'Exercise Mat': 'Yoga Mat',
  'Pull Up Bar': 'Pull-up Bar', 'Pullup Bar': 'Pull-up Bar',
  Dumbbell: 'Dumbbells', 'Med Ball': 'Medicine Ball',
  'Cable Machine': 'Cable', 'Plyo Box': 'Box',
};

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const report = { muscles: 0, equipment: 0, dropped: [] };

// ── 1 + 2: normalise tags ────────────────────────────────────────────────────
for (const ex of data) {
  const before = JSON.stringify(ex.muscleGroups);
  const out = new Set();
  for (const t of ex.muscleGroups || []) {
    out.add(t);
    if (MUSCLE_PARENT[t]) out.add(MUSCLE_PARENT[t]);
  }
  // Anything still without a coarse region is unfilterable — fall back to the
  // broadest honest answer rather than leaving it unreachable.
  if (![...out].some((m) => MUSCLE_GROUPS.includes(m))) out.add('Full Body');
  ex.muscleGroups = [...out];
  if (JSON.stringify(ex.muscleGroups) !== before) report.muscles++;

  const eqBefore = JSON.stringify(ex.equipment);
  const eq = new Set();
  for (const q of ex.equipment || []) {
    const canonical = EQUIP_ALIAS[q] ?? q;
    eq.add(EQUIPMENT.includes(canonical) ? canonical : 'None');
  }
  if (eq.size === 0) eq.add('None');
  ex.equipment = [...eq];
  if (JSON.stringify(ex.equipment) !== eqBefore) report.equipment++;
}

// ── 3: de-duplicate by name ──────────────────────────────────────────────────
//
// Keep the richest entry (most instructions + tips), not merely the first —
// the duplicates were not identical and the better-written one should survive.
const byName = new Map();
const score = (e) =>
  (e.instructions?.length || 0) + (e.tips?.length || 0) + (e.commonMistakes?.length || 0);
for (const ex of data) {
  const key = ex.name.trim().toLowerCase();
  const kept = byName.get(key);
  if (!kept) { byName.set(key, ex); continue; }
  if (score(ex) > score(kept)) {
    byName.set(key, ex);
    report.dropped.push(`${kept.name} (${kept.id})`);
  } else {
    report.dropped.push(`${ex.name} (${ex.id})`);
  }
}
const deduped = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

console.log(`exercises: ${data.length} → ${deduped.length}`);
console.log(`  muscle tags normalised : ${report.muscles}`);
console.log(`  equipment normalised   : ${report.equipment}`);
console.log(`  duplicates removed     : ${report.dropped.length}`);
for (const d of report.dropped) console.log(`      - ${d}`);

if (WRITE) {
  writeFileSync(FILE, JSON.stringify(deduped, null, 2) + '\n', 'utf8');
  console.log('\nwritten.');
} else {
  console.log('\ndry run — pass --write to apply.');
}
