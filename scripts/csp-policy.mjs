// The app's full Content-Security-Policy, in one place.
//
//   node scripts/csp-policy.mjs            print it
//   node scripts/csp-policy.mjs --write    put it in firebase.json (Report-Only)
//
// firebase.json carries two headers:
//   Content-Security-Policy               the short ENFORCED one (framing, plugins, <base>)
//   Content-Security-Policy-Report-Only   this one
//
// Report-Only on purpose. This policy lists what the app is allowed to load,
// and the list was built from a survey of the bundle (scripts/csp-survey.mjs)
// and checked by driving every screen with it enforced (scripts/csp-proof.mjs).
// What no local run can exercise is the real Google / Apple / Facebook sign-in
// popups, reCAPTCHA and Stripe on the live domain. A wrong entry there, if
// enforced, is a sign-in button that does nothing. So production reports
// violations to Sentry instead of blocking; once it has run clean for a while,
// rename the header to enforce it.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
export const ROOT = stripDrive(new URL('../', import.meta.url).pathname);

const PROJECT = 'gen-lang-client-0893216108';

/**
 * The inline scripts in index.html (the theme is set before first paint, so it
 * cannot be an external file without a flash). CSP allows an inline script by
 * the hash of its exact text, and "exact" includes line endings: this file is
 * CRLF in a Windows checkout and LF on the Linux build machine. Both are listed.
 */
export const inlineScriptHashes = (html = readFileSync(ROOT + 'index.html', 'utf8')) => {
  const hashes = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    for (const text of [m[1].replace(/\r\n/g, '\n'), m[1].replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')]) {
      hashes.add(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes];
};

/** Sentry's CSP report endpoint for a DSN, or null. Uses only the public key. */
export const reportUriFor = (dsn) => {
  const m = /^https:\/\/([0-9a-f]{32})@([a-z0-9.-]+)\/(\d+)$/.exec(String(dsn || '').trim());
  return m ? `https://${m[2]}/api/${m[3]}/security/?sentry_key=${m[1]}` : null;
};

export const directives = ({ scriptHashes = inlineScriptHashes(), reportUri = null } = {}) => ({
  'default-src': ["'self'"],
  // gapi + GIS for sign-in, reCAPTCHA for App Check, wasm for the scanner and pose model.
  'script-src': ["'self'", "'wasm-unsafe-eval'", ...scriptHashes,
    'https://apis.google.com', 'https://accounts.google.com', 'https://www.google.com', 'https://www.gstatic.com',
    'https://www.recaptcha.net'],
  // React and Motion set style attributes; the instant shell has an inline <style>.
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  // Avatars and food / exercise photos come from many hosts (Google, Facebook, DiceBear, Unsplash, Open Food Facts).
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:'],
  'connect-src': ["'self'", 'data:', 'blob:',
    'https://*.googleapis.com',                 // Firestore, Auth, FCM, installations, App Check, Gemini
    'https://*.cloudfunctions.net', 'https://*.run.app', // Cloud Functions (v1 URLs and v2 services)
    `https://${PROJECT}.firebaseapp.com`, `https://${PROJECT}.web.app`,
    'https://accounts.google.com', 'https://www.google.com', 'https://www.gstatic.com', 'https://www.recaptcha.net',
    'https://api.nal.usda.gov', 'https://world.openfoodfacts.org',
    'https://api.dicebear.com',
    'https://*.sentry.io', 'https://us.i.posthog.com', 'https://us-assets.i.posthog.com'],
  // Firebase's sign-in helper, Google's sign-in, reCAPTCHA, exercise videos.
  'frame-src': ["'self'", `https://${PROJECT}.firebaseapp.com`, `https://${PROJECT}.web.app`,
    'https://accounts.google.com', 'https://www.google.com', 'https://www.recaptcha.net', 'https://recaptcha.google.com',
    'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'", `https://${PROJECT}.web.app`, `https://${PROJECT}.firebaseapp.com`, 'https://localhost', 'capacitor://localhost'],
  ...(reportUri ? { 'report-uri': [reportUri] } : {}),
});

export const render = (d) => Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');

const dsnFromEnv = () => {
  if (process.env.VITE_SENTRY_DSN) return process.env.VITE_SENTRY_DSN;
  try { return (readFileSync(ROOT + '.env', 'utf8').match(/^VITE_SENTRY_DSN=(.+)$/m) || [])[1]; } catch { return undefined; }
};

export const HEADER = 'Content-Security-Policy-Report-Only';

/** The Report-Only policy currently in firebase.json, or null. */
export const policyInFirebaseJson = () => {
  const cfg = JSON.parse(readFileSync(ROOT + 'firebase.json', 'utf8'));
  const all = cfg.hosting.headers.find((h) => h.source === '**');
  return all?.headers.find((h) => h.key === HEADER)?.value ?? null;
};

if (process.argv[1] && stripDrive('/' + process.argv[1].replace(/\\/g, '/')).endsWith('scripts/csp-policy.mjs')) {
  const reportUri = reportUriFor(dsnFromEnv());
  const value = render(directives({ reportUri }));
  if (process.argv.includes('--write')) {
    const path = ROOT + 'firebase.json';
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    const all = cfg.hosting.headers.find((h) => h.source === '**');
    const at = all.headers.findIndex((h) => h.key === HEADER);
    if (at >= 0) all.headers[at].value = value; else all.headers.push({ key: HEADER, value });
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`firebase.json: ${HEADER} written (${value.length} chars, reports ${reportUri ? 'to Sentry' : 'nowhere: no VITE_SENTRY_DSN'})`);
  } else {
    console.log(value.replace(/sentry_key=[0-9a-f]+/, 'sentry_key=<public key>'));
  }
}
