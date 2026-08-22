// Post-build secret scanner — hard gate against shipping keys in the client.
//
// Runs automatically after every `npm run build` (see package.json) and in CI,
// so the exact class of bug that put the raw Gemini key into the v1.4.0 APK
// (an env/define combination silently inlining a secret) can never ship again.
//
// Scans every text asset in dist/ for:
//   • Google API keys:  AIzaSy[A-Za-z0-9_-]{33}
//   • Stripe secret/restricted keys:  sk_live_ / sk_test_ / rk_live_
//   • PEM private key blocks
//
// The Firebase *web* API key is public by design (it ships in every Firebase
// web app and is restricted server-side), so it is allowlisted explicitly.
// Anything else fails the build with a non-zero exit.

import fs from 'node:fs';
import path from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Public-by-design values that legitimately appear in the bundle.
const ALLOWLIST = new Set([
  'AIzaSyCGgiaLaaAjfkNJxertfao55jnrIpoED9w', // Firebase web API key (public; see RELEASES.md)
]);

const PATTERNS = [
  { name: 'Google API key', re: /AIzaSy[A-Za-z0-9_-]{33}/g, allowlisted: (m) => ALLOWLIST.has(m) },
  { name: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, allowlisted: () => false },
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, allowlisted: () => false },
];

const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.txt', '.map', '.svg']);

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
};

if (!fs.existsSync(DIST)) {
  console.error(`scan-bundle-secrets: dist/ not found at ${DIST} — run vite build first.`);
  process.exit(1);
}

const files = walk(DIST);
const findings = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const { name, re, allowlisted } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (allowlisted(m[0])) continue;
      findings.push({ file: path.relative(DIST, file), name, match: `${m[0].slice(0, 10)}…${m[0].slice(-4)}` });
    }
  }
}

if (findings.length > 0) {
  console.error(`\n✗ SECRET LEAK — ${findings.length} match(es) in the built bundle:\n`);
  for (const f of findings) console.error(`  ${f.name}  ${f.match}  in dist/${f.file}`);
  console.error('\nThe build is blocked. Remove the secret from the client path (use the');
  console.error('geminiProxy Cloud Function / server-side config) and rebuild.\n');
  process.exit(1);
}

console.log(`✓ scan-bundle-secrets: ${files.length} files clean (no unexpected API keys in dist/)`);
