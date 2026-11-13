// One food per catalog key — node scripts/dedupe-foods.mjs [--write]
//
// catalogKey() drops the bracketed serving, so "Cashews" and "Cashews (28g)" are
// the same Firestore document: whichever seeds last silently overwrites the
// other. `npm run proof:seed` fails on that. This settles each collision:
//
//   1. genuinely different foods that only shared a key get distinct names
//   2. otherwise the entry that STATES ITS SERVING wins — a calorie figure
//      with no serving cannot be checked by the person logging it
//   3. the loser's aliases are kept on the winner
//
// Idempotent.

import { readFileSync, writeFileSync } from 'node:fs';

const { catalogKey } = await import('../src/services/foodCatalogUtils.ts');

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const FILE = stripDrive(new URL('../', import.meta.url).pathname) + 'scripts/data/common-foods.json';
const WRITE = process.argv.includes('--write');

const RENAME = {
  'French Fries (large)': 'Large French Fries (McDonald\'s)',
  'Ramen (Shoyu)': 'Shoyu Ramen (1 bowl)',
  'Ramen (Tonkotsu)': 'Tonkotsu Ramen (1 bowl)',
  'Wantan Mee (soup)': 'Wantan Mee Soup (1 bowl)',
  'Wantan Mee (dry)': 'Dry Wantan Mee (1 plate)',
};

// Other names people type for foods added before aliases existed. Keyed by
// name; matched through catalogKey so a serving suffix does not matter.
const ALIASES = {
  'Nasi Lemak': ['coconut rice'],
  'Char Kway Teow': ['char kuey teow', 'ckt', 'kuey teow goreng', 'fried kway teow', 'char koay teow'],
  'Roti Canai': ['roti kosong', 'roti prata', 'prata'],
  'Teh Tarik': ['pulled tea', 'teh susu'],
  'Chicken Rice': ['nasi ayam', 'hainanese chicken rice', 'nasi ayam hainan'],
  'Nasi Goreng': ['malay fried rice'],
  'Ais Kacang': ['abc', 'air batu campur', 'ice kacang'],
  'Cendol': ['chendol'],
  'Thosai': ['tosai', 'dosai', 'plain dosa'],
  'Capati': ['chapati', 'chapatti'],
  'Asam Laksa': ['penang laksa', 'laksa'],
  'Curry Mee': ['mee kari', 'kari mee'],
  'Mee Goreng Mamak': ['mee goreng', 'mi goreng'],
  'Satay Ayam': ['chicken satay', 'sate ayam', 'satay'],
  'Rendang Daging': ['beef rendang', 'rendang'],
  'Bak Kut Teh': ['bkt'],
  'Kaya Toast': ['roti bakar', 'roti kaya'],
  'Half-Boiled Eggs': ['telur separuh masak', 'soft boiled eggs'],
  'Milo Ais': ['iced milo', 'milo'],
  'Pisang Goreng': ['banana fritters', 'goreng pisang'],
  'Tau Fu Fah': ['tofu pudding', 'douhua', 'tau huay'],
  'Murtabak': ['martabak'],
  'Rojak': ['pasembur', 'rojak buah'],
  'Bubble Tea': ['boba', 'pearl milk tea', 'boba tea'],
  'Chicken Congee': ['bubur ayam', 'chicken porridge'],
  'Fried Rice': ['nasi goreng cina', 'egg fried rice'],
  'Butter Chicken': ['murgh makhani'],
  'Dhal Curry': ['dal', 'dhal', 'dalca'],
  'Spaghetti Bolognese': ['bolognese', 'spag bol'],
  'Sushi Roll': ['california roll', 'maki'],
  'Pho Bo': ['beef pho'],
  'Nasi Briyani with Chicken': ['chicken biryani', 'nasi briyani ayam', 'biryani', 'briyani'],
  'Ayam Goreng Berempah': ['spiced fried chicken'],
  'Ikan Bakar': ['grilled fish'],
  'Ikan Goreng': ['fried fish'],
  'Sugarcane Juice': ['air tebu'],
  'Kopi O': ['kopi o kosong', 'local black coffee'],
};
const aliasByKey = new Map(Object.entries(ALIASES).map(([n, a]) => [catalogKey(n), a]));

const data = JSON.parse(readFileSync(FILE, 'utf8'));
for (const f of data) {
  if (RENAME[f.name]) f.name = RENAME[f.name];
  const extra = aliasByKey.get(catalogKey(f.name));
  if (extra) f.aliases = [...new Set([...(f.aliases || []), ...extra])];
}

const statesServing = (name) => /\([^)]*\d[^)]*\)/.test(name);
const byKey = new Map();
const dropped = [];
for (const f of data) {
  const key = catalogKey(f.name);
  const held = byKey.get(key);
  if (!held) { byKey.set(key, f); continue; }
  const [win, lose] = statesServing(f.name) && !statesServing(held.name) ? [f, held] : [held, f];
  const aliases = [...new Set([...(win.aliases || []), ...(lose.aliases || [])])];
  if (aliases.length) win.aliases = aliases;
  byKey.set(key, win);
  dropped.push(`${lose.name}  →  ${win.name}`);
}

const out = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
console.log(`foods: ${data.length} → ${out.length}  (${dropped.length} merged)`);
for (const d of dropped) console.log(`  ${d}`);
if (WRITE) { writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n', 'utf8'); console.log('written.'); }
else console.log('\ndry run — pass --write to apply.');
