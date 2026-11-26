#!/usr/bin/env node
/**
 * proof:i18n — every sentence the app shows can be translated, and is.
 *
 *   node scripts/i18n-proof.mjs            check (the gate)
 *   node scripts/i18n-proof.mjs --extract  rewrite src/i18n/keys.json from the code
 *
 * Checks:
 *  1. t() / i18n core behaviour (placeholders, fallback, locale mapping), with controls.
 *  2. keys.json equals what the code uses (no stale or missing keys).
 *  3. t() is only ever called with a literal sentence (a variable can't be extracted).
 *  4. Every locale file has every key, nothing extra, the same {placeholders}, no empty value.
 *  5. No user-visible English is left outside t() in .tsx files: JSX text and the
 *     placeholder / aria-label / title / alt / label attributes, minus a justified allowlist.
 *     CONTROL: the scanner must find offenders in hand-written untranslated samples.
 *
 * Env: I18N_MIN_COVERAGE (default 100) lets the wrapping stage run before the
 * translations exist; the release gate is 100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const KEYS = path.join(SRC, 'i18n', 'keys.json');
const LOCALES = ['ms', 'id', 'es', 'pt', 'hi'];
const MIN_COVERAGE = Number(process.env.I18N_MIN_COVERAGE ?? 100);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `\n      ${detail}` : ''}`);
};

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales') walk(p, out); }
    else if (/\.(tsx?|mts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** Strip comments but keep line numbers and string contents intact. */
const stripComments = (src) => {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = src.slice(i, end < 0 ? src.length : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i += chunk.length; continue;
    }
    out += c; i++;
  }
  return out;
};

const unescape = (s, q) => s.replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));

/** Every literal key passed to t(), plus every non-literal call site. */
export const extract = (code) => {
  const keys = [], bad = [];
  const re = /(?<![\w$.])(?:t|msg)\(\s*(?:(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^`\\])*)`|([^)\s][^,)]*))/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[2] !== undefined) keys.push(unescape(m[2], m[1]));
    else if (m[3] !== undefined) { if (m[3].includes('${')) bad.push(m[0]); else keys.push(unescape(m[3], '`')); }
    else bad.push(m[0]);
  }
  return { keys, bad };
};

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');

// ---- 5. untranslated-text scanner ------------------------------------------
const WORDY = /[A-Za-z]{2,}/;
/** Tokens that are not words to translate: units, brand names, abbreviations. */
const NON_WORDS = new Set(['fitflow', 'pro', 'ok', 'ai', 'gps', 'usda', 'kcal', 'kj', 'kg', 'lb', 'lbs', 'st', 'g', 'oz', 'ml', 'fl', 'l',
  'km', 'mi', 'm', 'ft', 'in', 'cm', 'bpm', 'min', 's', 'h', 'pr', 'bmi', 'bmr', 'tdee', 'rpe', 'hr', 'xp', 'lv', 'gal', 'mph', 'kmh',
  'stripe', 'google', 'gemini', 'android', 'ios', 'health', 'connect', 'play']);
/** True when the text has at least one real word left after numbers, symbols and NON_WORDS are removed. */
const isProse = (s) => (String(s).match(/[A-Za-z][A-Za-z']*/g) || []).some((w) => !NON_WORDS.has(w.toLowerCase()) && w.length >= 2);
const NOT_PROSE = { test: (s) => !isProse(s) };
const ATTRS = /\b(placeholder|aria-label|title|alt|label|ariaLabel|sub|hint|description|emptyText|helperText)\s*=\s*(["'])([^"'{}]*[A-Za-z]{2,}[^"'{}]*)\2/g;
/** A string literal handed straight to something the user reads. */
const CALLS = /\b(showToast|setError|setMessage|toast|alert|confirm|notify)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g;
/** Object properties that hold visible text in data/config objects. */
const PROPS = /(?<![\w$])(title|label|sub|description|message|body|pitch|hint|placeholder|cta|headline|subtitle|tip|text|action|detail|caption|empty|error)\s*:\s*(['"`])((?:\\.|(?!\2)[^\\\n])*?)\2/g;

export const scanUntranslated = (code, { jsx = true } = {}) => {
  const hits = [];
  const lineOf = (idx) => code.slice(0, idx).split('\n').length;
  let m;
  for (const re of [CALLS, PROPS]) {
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      const s = m[3].replace(/\$\{[^}]*\}/g, ' ').trim();
      if (!isProse(s) || !/\s|^[A-Z]/.test(m[3].trim())) continue; // a lone lowercase token is an id/enum
      if (/^[\w-]+(\/[\w-]+)+$|^[a-z]+([A-Z][a-z]+)+$|^#|^\.|^https?:|^\/|\.(png|svg|jpg|json)$/.test(s)) continue; // paths, camelCase ids, urls, files
      hits.push({ line: lineOf(m.index), text: `${m[1]}: "${s.slice(0, 60)}"` });
    }
  }
  if (!jsx) return hits;
  // JSX text: between a tag close '>' (not '=>') and the next '<' or '{'.
  const text = /(?<![=\-])>([^<>{}`]*?)(?=<|\{)/g;
  while ((m = text.exec(code))) {
    const s = m[1].replace(/\s+/g, ' ').trim();
    if (!s || !WORDY.test(s) || NOT_PROSE.test(s)) continue;
    if (/[;=]|&&|\|\||\)\s*$|^\)|=>/.test(s)) continue; // code, not JSX text
    hits.push({ line: lineOf(m.index), text: s });
  }
  while ((m = ATTRS.exec(code))) {
    const s = m[3].trim();
    if (NOT_PROSE.test(s)) continue;
    hits.push({ line: lineOf(m.index), text: `${m[1]}="${s}"` });
  }
  return hits;
};

/**
 * Text that stays English on purpose. Each entry: file, a substring of the hit,
 * and the reason. An entry that matches nothing fails the proof (no stale excuses).
 */
/**
 * .ts files whose strings people read (toasts, badges, briefings, errors).
 * AI prompt builders are NOT here: prompts stay English and ask the model to
 * answer in the user's language instead.
 */
const UI_TS = [
  'src/lib/achievements.ts', 'src/lib/features.ts', 'src/lib/gpsTracker.ts', 'src/lib/authErrors.ts', 'src/lib/stepFormulas.ts',
  'src/lib/coachCue.ts', 'src/lib/adaptiveTarget.ts', 'src/lib/reviewPrompt.ts',
  'src/services/coachBriefing.ts', 'src/services/missionUtils.ts', 'src/services/badgeService.ts', 'src/services/squadService.ts',
  'src/services/healthService.ts', 'src/services/notificationService.ts',
];
const WHOLE_FILE_ENGLISH = [
  { file: 'src/pages/Terms.tsx', why: 'legal text: the English version is the binding one; Settings says so in every language' },
  { file: 'src/pages/Privacy.tsx', why: 'legal text: the English version is the binding one; Settings says so in every language' },
];
const ALLOW = [
  // { file: 'src/pages/Settings.tsx', text: 'English', why: 'language names are shown in their own language' },
];

// ---------------------------------------------------------------------------
const main = async () => {
  // 1. Core behaviour.
  const i18n = await import(pathToFileURL(path.join(SRC, 'i18n', 'i18n.ts')).href).catch(() => null);
  if (!i18n) {
    ok('i18n core loads (run through tsx)', false, 'npm script must be: tsx scripts/i18n-proof.mjs');
  } else {
    const { t, langFromLocale, __setDictionaryForTest, aiLanguageName, isLang } = i18n;
    __setDictionaryForTest('en', {});
    ok('English: t returns the sentence', t('Log a meal') === 'Log a meal');
    ok('placeholders filled', t('{n} kcal left', { n: 420 }) === '420 kcal left');
    ok('unknown placeholder stays visible', t('{n} of {m}', { n: 1 }) === '1 of {m}');
    __setDictionaryForTest('ms', { 'Log a meal': 'Catat makanan', '{n} kcal left': 'Baki {n} kcal' });
    ok('Malay: translated', t('Log a meal') === 'Catat makanan');
    ok('Malay: placeholders filled in the translation', t('{n} kcal left', { n: 5 }) === 'Baki 5 kcal');
    ok('Malay: missing key falls back to English', t('Save') === 'Save');
    ok('CONTROL: a wrong translation is detectable', t('Log a meal') !== 'Log a meal');
    __setDictionaryForTest('en', {});
    ok('locale mapping', langFromLocale('ms-MY') === 'ms' && langFromLocale('in-ID') === 'id' && langFromLocale('pt-BR') === 'pt'
      && langFromLocale('hi-IN') === 'hi' && langFromLocale('es-419') === 'es' && langFromLocale('fr-FR') === 'en' && langFromLocale('') === 'en');
    ok('isLang rejects junk', !isLang('xx') && !isLang(null) && isLang('id'));
    ok('AI language name', aiLanguageName('ms') === 'Malay' && aiLanguageName('en') === 'English');
  }

  // 2/3. Extraction.
  const files = walk(SRC).filter((f) => !rel(f).startsWith('src/i18n/'));
  const used = new Set(), badCalls = [];
  for (const f of files) {
    const { keys, bad } = extract(stripComments(fs.readFileSync(f, 'utf8')));
    keys.forEach((k) => used.add(k));
    bad.forEach((b) => badCalls.push(`${rel(f)}: ${b.slice(0, 80)}`));
  }
  const sorted = [...used].sort();
  if (process.argv.includes('--extract')) {
    fs.writeFileSync(KEYS, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`wrote ${rel(KEYS)}: ${sorted.length} keys`);
  }
  // Extractor controls.
  const ctl = extract(`t('a') t("b \\"q\\"") t(\`c\`) x.t('no') t(name) t(\`x \${y}\`) format('no') msg('d') tDyn(v)`);
  ok('CONTROL: extractor finds literal keys only (t and msg)', JSON.stringify(ctl.keys) === JSON.stringify(['a', 'b "q"', 'c', 'd']) && ctl.bad.length === 2,
    JSON.stringify(ctl));
  ok('t() is only called with a literal sentence', badCalls.length === 0, badCalls.slice(0, 15).join('\n      '));
  const committed = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : [];
  const missing = sorted.filter((k) => !committed.includes(k)), stale = committed.filter((k) => !used.has(k));
  ok(`keys.json matches the code (${sorted.length} keys)`, !missing.length && !stale.length,
    `run: node scripts/i18n-proof.mjs --extract  (missing ${missing.length}, stale ${stale.length}) ${missing.slice(0, 5).join(' | ')}`);
  ok('keys are trimmed and non-empty', sorted.every((k) => k.trim() === k && k.length > 0), sorted.filter((k) => k.trim() !== k || !k).slice(0, 5).join(' | '));

  // 4. Locales.
  for (const lang of LOCALES) {
    const p = path.join(SRC, 'i18n', 'locales', `${lang}.json`);
    const d = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    if (!d) { ok(`${lang}.json exists`, false); continue; }
    const have = sorted.filter((k) => typeof d[k] === 'string' && d[k].trim());
    const pct = sorted.length ? (100 * have.length) / sorted.length : 100;
    ok(`${lang}: ${have.length}/${sorted.length} translated (${pct.toFixed(1)}%, need ${MIN_COVERAGE}%)`, pct >= MIN_COVERAGE,
      sorted.filter((k) => !(typeof d[k] === 'string' && d[k].trim())).slice(0, 5).join(' | '));
    const extra = Object.keys(d).filter((k) => !used.has(k));
    ok(`${lang}: no keys the code no longer uses`, !extra.length, extra.slice(0, 5).join(' | '));
    const ph = have.filter((k) => placeholders(k) !== placeholders(d[k]));
    ok(`${lang}: every {placeholder} kept`, !ph.length, ph.slice(0, 5).map((k) => `${k} -> ${d[k]}`).join(' | '));
    const untouched = have.filter((k) => d[k] === k && /[a-z]{4,}\s+[a-z]{3,}/i.test(k));
    ok(`${lang}: sentences actually translated (<= 3% identical to English)`, untouched.length <= Math.max(3, sorted.length * 0.03),
      `${untouched.length} identical, e.g. ${untouched.slice(0, 5).join(' | ')}`);
  }

  // 3b. t() inside a module-level UPPER_CASE constant runs before the language
  // loads and freezes in English: those must use msg() + tDyn().
  const T_CALL = /(?<![\w$.])t\(/;
  const moduleTIn = (code, name) => {
    const hits = [];
    let inConst = false;
    code.split('\n').forEach((line, i) => {
      if (/^(?:export\s+)?const\s+[A-Z][A-Z0-9_]+\b/.test(line)) inConst = true;
      else if (inConst && /^\S/.test(line) && !/^[\]})]/.test(line)) inConst = false;
      if (inConst && T_CALL.test(line)) hits.push(`${name}:${i + 1}`);
      if (inConst && /^[\]})]/.test(line)) inConst = false;
    });
    return hits;
  };
  const moduleT = files.flatMap((f) => moduleTIn(stripComments(fs.readFileSync(f, 'utf8')), rel(f)));
  ok('no t() inside module-level constants (use msg() + tDyn())', moduleT.length === 0, moduleT.slice(0, 10).join('\n      '));
  ok('CONTROL: the module-scope check sees t() in an UPPER_CASE constant, not in a component',
    moduleTIn("export const FEATURES = [\n  { title: t('x') },\n];\nconst Page = () => {\n  return t('y');\n};", 'c').join() === 'c:2');

  // 5. Untranslated text.
  const sample = `<div>Log a meal</div><Button label="Save meal" /><p>{t('ok')}</p><span>420 kcal</span><b>FitFlow</b>{a => b}
    showToast('Failed to save', 'error'); showToast(t('Saved')); const x = { title: 'Smart target', id: 'smart', label: t('Hi'), kind: 'steps', icon: 'Heart' };`;
  const sh = scanUntranslated(sample);
  ok('CONTROL: scanner flags untranslated JSX text, attributes, toasts and object labels; not numbers/brands/t()/ids',
    sh.length === 4 && sh.some((h) => h.text === 'Log a meal') && sh.some((h) => h.text.includes('Save meal'))
    && sh.some((h) => h.text.includes('Failed to save')) && sh.some((h) => h.text.includes('Smart target')), JSON.stringify(sh));
  const hits = [];
  const only = (process.env.I18N_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
  const scanFiles = files.filter((x) => (x.endsWith('.tsx') || UI_TS.includes(rel(x))) && !WHOLE_FILE_ENGLISH.some((w) => rel(x) === w.file)
    && (!only.length || only.some((o) => rel(x).startsWith(o))));
  for (const f of scanFiles) {
    for (const h of scanUntranslated(stripComments(fs.readFileSync(f, 'utf8')), { jsx: f.endsWith('.tsx') })) hits.push({ file: rel(f), ...h });
  }
  ok('every UI_TS file exists', UI_TS.every((f) => fs.existsSync(path.join(ROOT, f))), UI_TS.filter((f) => !fs.existsSync(path.join(ROOT, f))).join(', '));
  const used_ = new Set();
  const left = hits.filter((h) => {
    const a = ALLOW.findIndex((x) => x.file === h.file && h.text.includes(x.text));
    if (a >= 0) { used_.add(a); return false; }
    return true;
  });
  const byFile = {};
  left.forEach((h) => { byFile[h.file] = (byFile[h.file] || 0) + 1; });
  ok(`no untranslated text left in screens (${left.length} found)`, left.length === 0,
    Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([f, n]) => `${f}: ${n}`).join('\n      ')
    + (left.length ? `\n      e.g. ${left.slice(0, 8).map((h) => `${h.file}:${h.line} "${h.text}"`).join('\n           ')}` : ''));
  const staleAllow = ALLOW.filter((_, i) => !used_.has(i));
  ok('allowlist has no stale entries', !staleAllow.length || only.length > 0, staleAllow.map((a) => `${a.file}: ${a.text}`).join(' | '));
  if (process.argv.includes('--list')) left.forEach((h) => console.log(`${h.file}:${h.line}\t${h.text}`));

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
};
main();
