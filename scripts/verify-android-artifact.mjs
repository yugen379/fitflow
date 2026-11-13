// Check a built APK or AAB before anyone installs it.
//
//   node scripts/verify-android-artifact.mjs <file.apk|file.aab> [--play]
//
// Looks INSIDE the file for the things that have gone missing without a build
// error before:
//   - Firebase configuration (google-services.json was absent from a worktree,
//     gradle skipped it quietly, and v1.6.5/v1.6.6 shipped with no Google
//     sign-in and no push)
//   - the version baked into the web bundle matches package.json
//   - the launcher class is lowercase com.fitflow.app (the v1.2.0–v1.2.3 crash)
//   - with --play: no Stripe checkout in the bundle (Play payments policy)
//
// Needs `unzip` on PATH (Git Bash and the CI runners both have it).

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const file = process.argv[2];
const PLAY = process.argv.includes('--play');
if (!file || !existsSync(file)) { console.error('usage: verify-android-artifact.mjs <file.apk|file.aab> [--play]'); process.exit(2); }
const isAab = file.toLowerCase().endsWith('.aab');
const root = isAab ? 'base/' : '';

const unzip = (args) => spawnSync('unzip', args, { maxBuffer: 512 * 1024 * 1024 });
const entry = (path) => { const r = unzip(['-p', file, path]); return r.status === 0 ? r.stdout : Buffer.alloc(0); };
const listing = unzip(['-Z1', file]).stdout.toString().split(/\r?\n/).filter(Boolean);
if (!listing.length) { console.error('could not read the archive (is unzip on PATH?)'); process.exit(2); }

let pass = 0, fail = 0;
const check = (n, ok, d = '') => {
  if (ok) { pass++; console.log(`  ${C.g}PASS${C.x} ${n}`); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${n}${d ? `  ${C.d}— ${d}${C.x}` : ''}`); }
};

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
console.log(`\n${C.b}── Android artifact: ${file.split(/[\\/]/).pop()} ──${C.x}  ${C.d}(${(statSync(file).size / 1e6).toFixed(1)} MB, ${isAab ? 'AAB' : 'APK'}${PLAY ? ', Play build' : ''})${C.x}\n`);

// Resource names are stored as plain strings in both formats.
const res = entry(isAab ? 'base/resources.pb' : 'resources.arsc');
const hasRes = (name) => res.includes(Buffer.from(name, 'utf8')) || res.includes(Buffer.from(name, 'utf16le'));
check('Firebase app id is inside (google_app_id)', hasRes('google_app_id'), 'built without android/app/google-services.json');
check('push sender id is inside (gcm_defaultSenderId)', hasRes('gcm_defaultSenderId'));
check('Google sign-in client id is inside (default_web_client_id)', hasRes('default_web_client_id'));

// The web bundle: every JS file under assets/public/assets.
const jsFiles = listing.filter((p) => p.startsWith(`${root}assets/public/assets/`) && p.endsWith('.js'));
check('the web app is bundled inside', jsFiles.length > 5, `${jsFiles.length} JS files`);
const js = Buffer.concat(jsFiles.map(entry)).toString('latin1');
check(`web bundle carries version ${pkg.version}`, js.includes(pkg.version), 'the app would report a different version');
// A build with no Sentry key reports nothing: a tester's crash is never heard of.
// (v1.6.5–v1.6.7's first local builds had none; the key was only in GitHub's secrets.)
check('crash reporting is configured (Sentry key inside)', /https:\/\/[0-9a-f]{32}@[a-z0-9.-]*sentry\.io\/\d+/.test(js),
  'set VITE_SENTRY_DSN in .env before building');
check('the offline food list is bundled', listing.some((p) => /assets\/public\/assets\/common-foods-.*\.js$/.test(p)));

// Dex class names are plain strings too.
const dex = Buffer.concat(listing.filter((p) => /(^|\/)classes\d*\.dex$/.test(p)).map(entry));
check('launcher class is lowercase com/fitflow/app/MainActivity', dex.includes(Buffer.from('Lcom/fitflow/app/MainActivity;')) && !dex.includes(Buffer.from('Lcom/Fitflow/')));

if (PLAY) {
  check('Play build: no Stripe checkout endpoint in the bundle', !/createCheckoutSession|checkout\.stripe\.com/i.test(js), 'Play policy forbids external checkout in a store bundle');
} else {
  check('sideload build: Stripe checkout is present', /createCheckoutSession/i.test(js), 'the APK would say "Billing is being configured"');
}

console.log(`\n${C.b}Result: ${fail ? C.r : C.g}${pass}/${pass + fail}${C.x}${C.b} checks passed${C.x}\n`);
process.exit(fail ? 1 : 0);
