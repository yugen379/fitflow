// Release gate: refuse to ship legal documents with placeholder identity.
//
// The privacy policy shipped naming "FitFlow, Inc." — an entity that does not
// exist — next to a literal "[REPLACE WITH REGISTERED BUSINESS ADDRESS]". Both
// were rendered to users, and both had been there since June. Nothing in the
// build objected, because nothing was looking.
//
// Now something is. On a release build (CI) an unset field is a hard failure;
// locally it is a loud warning, so day-to-day development is not blocked by a
// value only the publisher can supply.

import { readFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const src = readFileSync(ROOT + 'src/lib/legal.ts', 'utf8');

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', x: '\x1b[0m' };

// Read the literal object rather than importing it — this script runs under
// plain node, and legal.ts is TypeScript.
const body = src.slice(src.indexOf('export const LEGAL'), src.indexOf('legalIdentityIncomplete'));
const field = (name) => {
  const m = body.match(new RegExp(name + `:\\s*(UNSET|'([^']*)')`));
  if (!m) return null;
  return m[1] === 'UNSET' ? null : m[2];
};

const kind = field('kind');
const required = ['name', 'address', 'governingLaw'];
if (kind === 'company') required.push('registrationNumber');

const missing = required.filter((f) => !field(f));

// Placeholder text that must never reach a user, wherever it appears.
const LEGAL_PAGES = ['src/pages/Privacy.tsx', 'src/pages/Terms.tsx', 'src/lib/legal.ts'];
const BANNED = [/\[REPLACE[^\]]*\]/i, /FitFlow,\s*Inc\./, /\bTODO\b/, /lorem ipsum/i];
const banned = [];
for (const page of LEGAL_PAGES) {
  let text;
  try { text = readFileSync(ROOT + page, 'utf8'); } catch { continue; }
  for (const re of BANNED) {
    // legal.ts may legitimately describe the problem in its header comment.
    const stripped = page.endsWith('legal.ts')
      ? text.slice(text.indexOf('const UNSET'))
      : text;
    const hit = stripped.match(re);
    if (hit) banned.push(`${page}: ${hit[0]}`);
  }
}

const isRelease = !!process.env.CI;

if (missing.length === 0 && banned.length === 0) {
  console.log(`${C.g}+ check-legal: publisher identity complete (${kind})${C.x}`);
  process.exit(0);
}

const label = isRelease ? `${C.r}${C.b}BLOCKED` : `${C.y}${C.b}WARNING`;
console.log(`\n${label}: legal documents are not publishable${C.x}`);
if (missing.length) {
  console.log(`  unset in src/lib/legal.ts: ${C.b}${missing.join(', ')}${C.x}`);
}
for (const b of banned) console.log(`  placeholder text still present — ${b}`);
console.log(
  `\n  These strings are rendered to users and are what a privacy policy is FOR:\n` +
  `  they identify the data controller. Set them in src/lib/legal.ts.\n`,
);

if (isRelease) {
  console.log(`${C.r}Release build refused.${C.x}\n`);
  process.exit(1);
}
console.log(`${C.y}Local build allowed to continue. CI will refuse this.${C.x}\n`);
