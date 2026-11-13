// What does the app load, and from where? — node scripts/csp-survey.mjs [dist]
//
// Lists every outside origin named in the built web app (JS, CSS, HTML), with
// the kind of use it could find. This is the input for the Content-Security-
// Policy in firebase.json: a policy written from memory blocks whatever was
// forgotten, and what gets forgotten is sign-in or the scanner.
//
// It reads the BUILD, not the source, so a library's own URLs are included.
// A URL that is only ever shown as a link (href) needs no CSP entry; the
// survey cannot tell that apart, so the list is an upper bound.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const DIST = process.argv[2] || ROOT + 'dist';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|webmanifest)$/.test(name)) files.push(p);
  }
};
walk(DIST);

const origins = new Map(); // origin -> Set(kind)
const note = (origin, kind) => { if (!origins.has(origin)) origins.set(origin, new Set()); origins.get(origin).add(kind); };
const URL_RE = /\b(https?|wss?):\/\/([a-z0-9*.-]+\.[a-z]{2,})(?::\d+)?([^\s"'`)<>\\]*)/gi;

for (const f of files) {
  const text = readFileSync(f, 'latin1');
  const isCss = f.endsWith('.css');
  for (const m of text.matchAll(URL_RE)) {
    const origin = `${m[1].toLowerCase()}://${m[2].toLowerCase()}`;
    const path = m[3] || '';
    const kind =
      m[1].startsWith('ws') ? 'connect (websocket)' :
      isCss && /\.(woff2?|ttf|otf)\b/.test(path) ? 'font' :
      isCss ? 'style/img (css)' :
      /\.(png|jpe?g|webp|gif|svg|avif)\b/i.test(path) ? 'img' :
      /\.(woff2?|ttf|otf)\b/i.test(path) ? 'font' :
      /\.(m?js|wasm)\b/i.test(path) ? 'script/wasm' :
      /\.(mp4|webm|mp3|ogg)\b/i.test(path) ? 'media' :
      'connect/other';
    note(origin, kind);
  }
}

// Standards documents, XML namespaces and licence text are not network loads.
const NOISE = /(^https?:\/\/(www\.)?(w3\.org|reactjs\.org|react\.dev|github\.com|fb\.me|mozilla\.org|developer\.mozilla\.org|npmjs\.com|opensource\.org|apache\.org|json-schema\.org|schema\.org|example\.com|localhost)$)|(\.md$)/i;
const rows = [...origins.entries()].filter(([o]) => !NOISE.test(o)).sort((a, b) => a[0].localeCompare(b[0]));

console.log(`${files.length} files scanned in ${DIST}\n`);
for (const [origin, kinds] of rows) console.log(`${origin.padEnd(52)} ${[...kinds].sort().join(', ')}`);
console.log(`\n${rows.length} outside origins`);
