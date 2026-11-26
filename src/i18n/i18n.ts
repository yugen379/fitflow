/**
 * App text in the user's language.
 *
 * The English sentence IS the key: `t('Log a meal')`. A screen never waits on
 * a key file, a missing translation shows the English, and the extractor
 * (scripts/i18n-extract.mjs) finds every key by scanning for t('...') calls.
 *
 * The language is a DEVICE setting (localStorage), chosen in Settings or taken
 * from the phone's language on first run. Changing it reloads the app once, so
 * `t` is a plain synchronous function: it works in components, toasts, pure
 * helpers and notification text alike, with no hook or re-render plumbing.
 *
 * Boot cost: English loads nothing. Another language loads one JSON chunk
 * before React renders (main.tsx awaits `loadLanguage()`); it is precached by
 * the service worker after the first visit. This module has no imports.
 *
 * Placeholders: `t('{n} kcal left', { n: 420 })`. Translators keep `{n}`.
 * Plurals: pick the sentence in code (`n === 1 ? t('1 day') : t('{n} days', { n })`).
 */

export type Lang = 'en' | 'ms' | 'id' | 'es' | 'pt' | 'hi';

/** Native names, shown in the picker as-is (never translated). */
export const LANGUAGES: readonly { code: Lang; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'ms', name: 'Bahasa Melayu', english: 'Malay' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
];

const CODES = new Set<string>(LANGUAGES.map((l) => l.code));
export const STORAGE_KEY = 'ff_lang';

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && CODES.has(v);

/** "ms-MY" -> ms, "pt-BR" -> pt, "in" (old Indonesian code) -> id, unknown -> en. */
export const langFromLocale = (locale: string | null | undefined): Lang => {
  const base = String(locale || '').toLowerCase().split(/[-_]/)[0];
  if (base === 'in') return 'id';
  if (base === 'zsm') return 'ms';
  return isLang(base) ? base : 'en';
};

let current: Lang = 'en';
let dict: Record<string, string> = {};

const readStored = (): Lang | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch { return null; }
};

const deviceLocale = (): string => {
  try { return typeof navigator !== 'undefined' ? navigator.language : 'en'; } catch { return 'en'; }
};

/** The language this device uses: the saved choice, else the phone's language. */
export const resolveLanguage = (): Lang => readStored() ?? langFromLocale(deviceLocale());

export const getLanguage = (): Lang => current;

// One explicit loader per language so Vite emits one small chunk each.
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Record<string, string> }>> = {
  ms: () => import('./locales/ms.json'),
  id: () => import('./locales/id.json'),
  es: () => import('./locales/es.json'),
  pt: () => import('./locales/pt.json'),
  hi: () => import('./locales/hi.json'),
};

/**
 * Load the device's language before the first render. Never throws and never
 * hangs the boot: on a failed or slow load (2.5 s) the app starts in English.
 */
export const loadLanguage = async (lang: Lang = resolveLanguage()): Promise<Lang> => {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (lang === 'en') { current = 'en'; dict = {}; return 'en'; }
  try {
    const mod = await Promise.race([
      LOADERS[lang](),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 2500)),
    ]);
    dict = mod.default || {};
    current = lang;
  } catch {
    current = 'en';
    dict = {};
    if (typeof document !== 'undefined') document.documentElement.lang = 'en';
  }
  return current;
};

/** Save the choice and restart the app in it (the only way `t` output changes). */
export const setLanguage = (lang: Lang, reload = true): void => {
  if (!isLang(lang)) return;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage blocked: session only */ }
  if (reload && typeof location !== 'undefined') location.reload();
};

/** Fill `{name}` placeholders; an unknown placeholder is left visible, never dropped. */
const fill = (s: string, vars?: Record<string, string | number>): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** The English sentence in the user's language (English when untranslated). */
export const t = (english: string, vars?: Record<string, string | number>): string =>
  fill(dict[english] || english, vars);

/**
 * Mark a sentence for translation WITHOUT translating it now: for module-level
 * constants (badge lists, feature lists, challenge pools). Those are evaluated
 * when the module loads, which can be before the language is, so a `t()` there
 * would freeze in English. Store `msg('...')`, show it with `tDyn(value)`.
 */
export const msg = (english: string): string => english;

/** Translate a sentence held in a variable (one that was marked with msg() or t()). */
export const tDyn = (english: string | null | undefined, vars?: Record<string, string | number>): string =>
  english ? t(english, vars) : '';

/** Test seam for proofs: install a dictionary without a dynamic import. */
export const __setDictionaryForTest = (lang: Lang, d: Record<string, string>): void => {
  current = lang;
  dict = d;
};

/** Name of the language the AI should answer in (English names are what the model reads best). */
export const aiLanguageName = (lang: Lang = current): string =>
  LANGUAGES.find((l) => l.code === lang)?.english ?? 'English';
