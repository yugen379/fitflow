// Store listing text proof (docs/store).
//
//   npm run proof:storetext
//
// Checks every locale's title / short / full description against Play's length
// limits and a list of phrases a health app's listing must not use (ranking
// claims, guarantees, medical claims, competitor names). CONTROLS run the same
// checker on deliberately bad text and must FAIL, so a checker that silently
// passes everything cannot slip through.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'docs/store';
const LOCALES = ['en-US', 'en-GB', 'ms-MY', 'id-ID'];
const LIMITS = { title: 30, 'short-description': 80, 'full-description': 4000 };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  — ${detail}` : ''}`);
};

/** Play counts characters, not bytes. A trailing newline in the file is not part of the text. */
const chars = (s) => [...s].length;
const readText = (locale, field) => {
  const f = path.join(ROOT, locale, `${field}.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '') : null;
};

// ─── Banned phrases ──────────────────────────────────────────────────────────
// Word-bounded, case-insensitive. Each entry: [regex, why].
const BANNED_ALL = [
  [/#\s*1\b/i, 'ranking claim'],
  [/\bno\.?\s*1\b/i, 'ranking claim'],
  [/\bnumber\s+one\b/i, 'ranking claim'],
  [/\bbest\b/i, 'superlative'],
  [/\btop[-\s]?rated\b/i, 'ranking claim'],
  [/\bguarantee(d|s)?\b/i, 'guarantee'],
  [/\bcure(s|d)?\b/i, 'medical claim'],
  [/\btreat(s|ment|ments|ing)?\b/i, 'medical claim'],
  [/\bdiagnos\w*/i, 'medical claim'],
  [/\bprevent(s|ing)?\s+(disease|diabetes|illness)/i, 'medical claim'],
  [/\bdoctor(s)?\b/i, 'medical authority claim'],
  [/\bclinical(ly)?\b/i, 'clinical claim'],
  [/\bFDA\b/, 'regulatory claim'],
  [/\bscientifically\b/i, 'unsupported claim'],
  [/\bproven\b/i, 'unsupported claim'],
  [/\b100\s?%/i, 'unsupported claim'],
  [/\blose\s+\d+\s*(lb|lbs|kg|pounds)\b/i, 'weight-loss promise'],
  [/\b(burn|melt)\s+fat\s+fast\b/i, 'weight-loss promise'],
  [/\bdetox\b/i, 'unsupported claim'],
  // Competitors and other brands.
  [/my\s*fitness\s*pal/i, 'competitor'],
  [/\bstrava\b/i, 'competitor'],
  [/\bfitbit\b/i, 'competitor'],
  [/\bgarmin\b/i, 'competitor'],
  [/\bnike\b/i, 'competitor'],
  [/\bNTC\b/, 'competitor'],
  [/\bnoom\b/i, 'competitor'],
  [/\blose\s*it!?\b/i, 'competitor'],
  [/\bcronometer\b/i, 'competitor'],
  [/\bpeloton\b/i, 'competitor'],
  [/\bsamsung\s+health\b/i, 'competitor'],
  [/\bapple\s+(health|watch)\b/i, 'not on Android'],
];
// Malay and Indonesian equivalents.
const BANNED_LOCAL = {
  'ms-MY': [
    [/\bterbaik\b/i, 'superlative'], [/\bnombor\s*(1|satu)\b/i, 'ranking claim'],
    [/\b(di)?jamin\b|\bjaminan\b/i, 'guarantee'], [/\bmenyembuhkan\b|\bpenawar\b/i, 'medical claim'],
    [/\bmerawat\b|\brawatan\b/i, 'medical claim'], [/\bdoktor\b/i, 'medical authority claim'],
    [/\bklinikal\b/i, 'clinical claim'], [/\bterbukti\b/i, 'unsupported claim'],
  ],
  'id-ID': [
    [/\bterbaik\b/i, 'superlative'], [/\bnomor\s*(1|satu)\b/i, 'ranking claim'],
    [/\b(di)?jamin\b|\bgaransi\b/i, 'guarantee'], [/\bmenyembuhkan\b/i, 'medical claim'],
    [/\bmengobati\b|\bpengobatan\b/i, 'medical claim'], [/\bdokter\b/i, 'medical authority claim'],
    [/\bklinis\b/i, 'clinical claim'], [/\bterbukti\b/i, 'unsupported claim'],
  ],
};
// "medical" may appear ONLY inside the disclaimer that says the app is NOT one.
const MEDICAL_WORD = { 'en-US': /\bmedical\b/i, 'en-GB': /\bmedical\b/i, 'ms-MY': /\bperubatan\b/i, 'id-ID': /\bmedis\b/i };
const DISCLAIMER = {
  'en-US': /not a medical device/i, 'en-GB': /not a medical device/i,
  'ms-MY': /bukan peranti perubatan/i, 'id-ID': /bukan perangkat medis/i,
};
// Play's metadata policy: no promo words, emoji or shouting in the title.
const TITLE_BANNED = [/\bfree\b/i, /\btop\b/i, /\bbest\b/i, /\bnew\b/i, /\bsale\b/i, /\bdownload\b/i, /\bpercuma\b/i, /\bgratis\b/i, /\p{Extended_Pictographic}/u];

/** All problems with one locale's three texts. Empty array = clean. */
export const checkLocale = (locale, texts) => {
  const problems = [];
  for (const [field, limit] of Object.entries(LIMITS)) {
    const t = texts[field];
    if (t == null || !t.trim()) { problems.push(`${field}: missing or empty`); continue; }
    if (chars(t) > limit) problems.push(`${field}: ${chars(t)} chars > ${limit}`);
  }
  const all = Object.values(texts).filter(Boolean).join('\n');
  for (const [re, why] of [...BANNED_ALL, ...(BANNED_LOCAL[locale] || [])]) {
    const m = all.match(re);
    if (m) problems.push(`banned "${m[0]}" (${why})`);
  }
  const med = MEDICAL_WORD[locale];
  if (med) {
    const withoutDisclaimer = all.replace(new RegExp(DISCLAIMER[locale].source, 'gi'), '');
    if (med.test(withoutDisclaimer)) problems.push('medical wording outside the "not a medical device" disclaimer');
  }
  if (texts['full-description'] && DISCLAIMER[locale] && !DISCLAIMER[locale].test(texts['full-description'])) {
    problems.push('full description lacks the "not a medical device" disclaimer');
  }
  for (const re of TITLE_BANNED) if (texts.title && re.test(texts.title)) problems.push(`title uses "${texts.title.match(re)[0]}"`);
  if (texts.title && !/^FitFlow\b/.test(texts.title)) problems.push('title does not start with the brand');
  if (texts.title && /\b[A-Z]{4,}\b/.test(texts.title.replace(/^FitFlow/, ''))) problems.push('title has an all-caps word');
  return problems;
};

// ─── Real files ──────────────────────────────────────────────────────────────
for (const locale of LOCALES) {
  console.log(`\n${locale}\n`);
  const texts = Object.fromEntries(Object.keys(LIMITS).map((f) => [f, readText(locale, f)]));
  for (const [field, limit] of Object.entries(LIMITS)) {
    const t = texts[field];
    ok(`${field} present`, t != null && t.trim().length > 0);
    if (t != null) ok(`${field} ${chars(t)}/${limit} chars`, chars(t) <= limit);
  }
  const problems = checkLocale(locale, texts);
  ok(`no banned phrases / claims (${problems.length ? problems.join('; ') : 'clean'})`, problems.length === 0);
  ok('full description is substantial (>= 1500 chars)', (texts['full-description'] || '').length >= 1500);
  ok('mentions Health Connect (the Android integration it declares)', /Health Connect/.test(texts['full-description'] || ''));
}

// en-US is aimed at US users: imperial must be front and centre.
const us = readText('en-US', 'full-description') || '';
ok('en-US: imperial units named (lb, feet and inches, miles)', /\blb\b/.test(us) && /feet and inches/.test(us) && /\bmiles\b/.test(us));
ok('en-US: US spelling (no "kilometres"/"catalogue"/"personalised")', !/kilometres|catalogue|personalised|colour/i.test(us));
const gb = readText('en-GB', 'full-description') || '';
ok('en-GB: stones mentioned, British spelling', /stones/.test(gb) && /kilometres/.test(gb) && !/\bkilometers\b|\bcatalog\b/.test(gb));
for (const l of ['ms-MY', 'id-ID']) {
  ok(`${l}: says the app UI is in English (honest for a non-localised app)`, /Inggeris|Inggris/.test(readText(l, 'full-description') || ''));
  ok(`${l}: is not a copy of the English text`, readText(l, 'full-description') !== us && !/Log food in seconds/i.test(readText(l, 'full-description') || ''));
}

// The declarations doc must cover every Health Connect permission in the manifest
// and both foreground-service types, so it cannot drift from the code silently.
console.log('\nplay-declarations.md vs AndroidManifest.xml\n');
const decl = fs.readFileSync(path.join(ROOT, 'play-declarations.md'), 'utf8');
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const hcPerms = [...manifest.matchAll(/android\.permission\.health\.(READ_\w+|WRITE_\w+)/g)].map((m) => m[1]);
ok(`manifest declares Health Connect permissions (${hcPerms.length})`, hcPerms.length > 0);
for (const p of hcPerms) ok(`declarations cover ${p}`, decl.includes(p));
const fgsTypes = [...manifest.matchAll(/foregroundServiceType="(\w+)"/g)].map((m) => m[1]);
for (const t of fgsTypes) ok(`declarations cover foreground service type "${t}"`, new RegExp(`foregroundServiceType="${t}"`).test(decl));
ok('manifest has no background location, and the doc says so', !/ACCESS_BACKGROUND_LOCATION"/.test(manifest) && /ACCESS_BACKGROUND_LOCATION[^\n]*not in the manifest/.test(decl));
ok('declarations give the in-app deletion path', /Settings → Delete account/.test(decl) && /deleteUserData/.test(decl));
ok('declarations cover the in-app review', /In-App Review/i.test(decl) && /com\.google\.android\.play:review/.test(decl));

// ─── CONTROLS: the checker must reject bad text ──────────────────────────────
console.log('\nControls (bad text must be rejected)\n');
const good = Object.fromEntries(Object.keys(LIMITS).map((f) => [f, readText('en-US', f)]));
const bad = (over, locale = 'en-US') => checkLocale(locale, { ...good, ...over });
ok('CONTROL: the real en-US text is clean', bad({}).length === 0, bad({}).join('; '));
ok('CONTROL: a 31-char title is rejected', bad({ title: 'FitFlow: Fitness & Food Coach!!' }).some((p) => p.startsWith('title: 31')));
ok('CONTROL: an 81-char short description is rejected', bad({ 'short-description': 'x'.repeat(81) }).some((p) => p.startsWith('short-description: 81')));
ok('CONTROL: a 4001-char full description is rejected', bad({ 'full-description': good['full-description'] + 'y'.repeat(4001 - chars(good['full-description'])) }).some((p) => p.startsWith('full-description: 4001')));
const claims = [
  ['"#1 fitness app"', '#1 fitness app'], ['"the best tracker"', 'the best tracker'],
  ['"guaranteed results"', 'guaranteed results'], ['"cures diabetes"', 'it cures diabetes'],
  ['"doctor approved"', 'doctor approved'], ['"clinically tested"', 'clinically tested'],
  ['"better than MyFitnessPal"', 'better than MyFitnessPal'], ['"MyFitnessPal" spaced', 'better than My Fitness Pal'],
  ['"sync with Strava"', 'sync with Strava'], ['"Fitbit"', 'works like Fitbit'],
  ['"medical-grade"', 'medical-grade accuracy'],
];
for (const [label, phrase] of claims) {
  ok(`CONTROL: ${label} is rejected`, bad({ 'full-description': `${good['full-description']}\n${phrase}.` }).length > 0);
}
ok('CONTROL: emoji / "Free" in the title are rejected', bad({ title: 'FitFlow Free 💪' }).length >= 2);
ok('CONTROL: a full description without the disclaimer is rejected', bad({ 'full-description': good['full-description'].replace(/not a medical device/i, 'a tracker') }).some((p) => p.includes('disclaimer')));
ok('CONTROL: Malay "terbaik" / "doktor" are rejected', checkLocale('ms-MY', { title: 'FitFlow: Kalori', 'short-description': 'Aplikasi terbaik', 'full-description': 'Disyorkan doktor. bukan peranti perubatan' }).length >= 2);
ok('CONTROL: Indonesian "dijamin" / "dokter" are rejected', checkLocale('id-ID', { title: 'FitFlow: Kalori', 'short-description': 'Hasil dijamin', 'full-description': 'Kata dokter. bukan perangkat medis' }).length >= 2);
ok('CONTROL: "best" inside another word is NOT flagged (word boundary works)', bad({ 'full-description': `${good['full-description']}\nbestow` }).length === 0);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
