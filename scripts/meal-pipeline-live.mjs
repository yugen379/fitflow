// Live check of the meal pipeline against the real model (needs GEMINI_API_KEY in .env).
// The model returns ingredients + grams + confidence; every kcal below comes from
// mealMath. Not a gate: model output varies. Run: npm run proof:mealpipeline
import fs from 'node:fs';
try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }
const { analyzeMealText } = await import('../src/services/mealPipeline.ts');
const { mealTotals, suggestedOil, needsHint, lineMacros } = await import('../src/lib/mealMath.ts');

const meals = [
  'nasi lemak with fried chicken, sambal, ikan bilis, peanuts and a teh tarik',
  'stir fried kangkung with white rice and a fried egg',
  '200g grilled chicken breast and a banana',
  'some curry thing',
];
let ok = 0;
for (const m of meals) {
  const t0 = Date.now();
  const a = await analyzeMealText(m);
  const oil = suggestedOil(a.lines);
  const tot = mealTotals(a.lines, oil);
  console.log(`\n"${m}"  (${Date.now() - t0} ms, decomposed=${a.decomposed}, obscured=${a.obscured}, hint=${needsHint(a.lines, a.obscured, false)}, oil=${oil})`);
  for (const l of a.lines) console.log(`   ${String(l.grams ?? '-').padStart(5)} g  ${l.name.padEnd(28)} ${String(lineMacros(l).calories).padStart(5)} kcal  [${l.source}, conf ${l.confidence}]`);
  console.log(`   TOTAL ${tot.calories} kcal`);
  if (a.lines.length || needsHint(a.lines, a.obscured, false)) ok++;
}
console.log(`\n${ok}/${meals.length} meals produced a review list or a hint request`);
