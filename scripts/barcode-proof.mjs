// Barcode scanner proof harness.
//
//   npm run proof:barcode      (alias)  or   node --import tsx scripts/barcode-proof.mjs
//
// It imports the SAME barcode logic the app ships (src/services/barcodeUtils.ts),
// so a green run here is evidence the production resolver works — not a mock.
//
// Part A: deterministic logic (check-digit, validation, variants) — must be 100%.
// Part B: live product resolution for a curated set of real-world barcodes
//         (EAN-13, EAN-8, and US UPC-12 to exercise normalization) — reports the
//         real success rate against Open Food Facts / USDA.

import {
  cleanBarcode,
  gtinCheckDigit,
  isValidGtin,
  barcodeVariants,
  lookupBarcodeRaw,
} from '../src/services/barcodeUtils.ts';

const UA = 'FitFlow-Proof/1.0 (gurulinggammuniandy@gmail.com)';
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const ok = (s) => `${C.g}PASS${C.x} ${s}`;
const no = (s) => `${C.r}FAIL${C.x} ${s}`;

let passed = 0, failed = 0;
const assert = (cond, label) => {
  if (cond) { passed++; console.log('  ' + ok(label)); }
  else { failed++; console.log('  ' + no(label)); }
};

// ---------------------------------------------------------------------------
console.log(`\n${C.b}── Part A · Deterministic logic (must be 100%) ──${C.x}`);

console.log(`\n${C.d}cleanBarcode${C.x}`);
assert(cleanBarcode(' 0 49000-02891 1 ') === '049000028911', 'strips spaces/dashes');
assert(cleanBarcode(']E03017620422003') === '03017620422003', 'strips symbology prefix');
assert(cleanBarcode('') === '', 'empty stays empty');

console.log(`\n${C.d}gtinCheckDigit / isValidGtin${C.x}`);
// Known-valid GTINs across all four lengths.
const validCodes = [
  '3017620422003', // EAN-13 Nutella
  '5449000000996', // EAN-13 Coca-Cola
  '028400090858',  // UPC-A 12 Lay's
  '009800895007',  // UPC-A 12 Nutella US
  '80135463',      // EAN-8
  '20724696',      // EAN-8
];
for (const c of validCodes) assert(isValidGtin(c), `valid GTIN ${c}`);
// Check-digit recomputation matches the embedded check digit.
for (const c of validCodes)
  assert(gtinCheckDigit(c.slice(0, -1)) === Number(c.slice(-1)), `check digit recompute ${c}`);
// Known-bad: flip the last digit → must be rejected.
for (const c of validCodes) {
  const bad = c.slice(0, -1) + ((Number(c.slice(-1)) + 1) % 10);
  assert(!isValidGtin(bad), `rejects bad check digit ${bad}`);
}
assert(!isValidGtin('12345'), 'rejects wrong length');
assert(!isValidGtin('abcdefgh'), 'rejects non-numeric');

console.log(`\n${C.d}barcodeVariants${C.x}`);
const v12 = barcodeVariants('028400090858');
assert(v12.includes('028400090858') && v12.includes('0028400090858'), 'UPC-12 yields EAN-13 (leading 0)');
const v13 = barcodeVariants('0028400090858');
assert(v13.includes('028400090858'), 'EAN-13 leading-0 yields UPC-12');
assert(barcodeVariants('').length === 0, 'empty yields no variants');
assert(barcodeVariants('3017620422003')[0] === '3017620422003', 'valid code tried first');

// ---------------------------------------------------------------------------
console.log(`\n${C.b}── Part B · Live product resolution ──${C.x}`);
console.log(`${C.d}Real barcodes through the production resolver (OFF v2 → v0 → USDA).${C.x}\n`);

// Curated, pre-verified real-world barcodes. Mix of EU EAN-13, EAN-8 and US
// UPC-12 so normalization is genuinely exercised.
const liveCodes = [
  ['3017620422003', 'Nutella'],
  ['5449000000996', 'Coca-Cola'],
  ['7622210449283', 'Prince biscuits'],
  ['3046920029759', 'Lindt dark chocolate'],
  ['5000159407236', 'Mars bar'],
  ['80135463',      'Cruesli (EAN-8)'],
  ['20724696',      'Almonds (EAN-8)'],
  ['028400090858',  "Lay's chips (UPC-12)"],
  ['009800895007',  'Nutella US (UPC-12)'],
  ['5000112637922', 'Coca-Cola (alt)'],
  ['4011100001213', 'Mars Minis'],
  ['3168930010265', 'Cruesli nuts'],
  ['5410188031072', 'Alvalle gazpacho'],
  ['8076809513388', 'Barilla arrabbiata'],
  ['4000417025005', 'Ritter Sport'],
  ['5000159484695', 'Twix'],
  ['5060337502900', 'Monster Energy'],
  ['8901491101837', "Lay's India"],
  ['5060335635808', 'Monster Ultra White'],
  ['3046920029759', 'Lindt (repeat → cache-safe)'],
];

const opts = { usdaKey: process.env.VITE_USDA_API_KEY || 'DEMO_KEY', userAgent: UA, retries: 3, backoffMs: 600 };

let liveOk = 0;
const rows = [];
for (const [code, label] of liveCodes) {
  const t0 = Date.now();
  let product = null;
  try { product = await lookupBarcodeRaw(code, opts); } catch (e) { /* counted as miss */ }
  const ms = Date.now() - t0;
  if (product && product.calories > 0) {
    liveOk++;
    rows.push({ code, label, status: 'PASS', detail: `${product.calories} kcal · ${product.source} · ${product.name.slice(0, 28)}`, ms });
  } else {
    rows.push({ code, label, status: 'FAIL', detail: 'no nutrition resolved', ms });
  }
  await new Promise(r => setTimeout(r, 400)); // be polite to OFF
}

console.log(`  ${'BARCODE'.padEnd(15)}${'RESULT'.padEnd(7)}${'TIME'.padEnd(8)}DETAIL`);
console.log('  ' + '─'.repeat(78));
for (const r of rows) {
  const tag = r.status === 'PASS' ? `${C.g}PASS${C.x} ` : `${C.r}FAIL${C.x} `;
  console.log(`  ${r.code.padEnd(15)}${tag}${(r.ms + 'ms').padEnd(8)}${C.d}${r.detail}${C.x}`);
}

// ---------------------------------------------------------------------------
const liveRate = Math.round((liveOk / liveCodes.length) * 100);
const logicRate = Math.round((passed / (passed + failed)) * 100);

console.log(`\n${C.b}── Summary ──${C.x}`);
console.log(`  Logic tests : ${failed === 0 ? C.g : C.r}${passed}/${passed + failed} (${logicRate}%)${C.x}`);
console.log(`  Live lookups: ${liveOk === liveCodes.length ? C.g : (liveRate >= 90 ? C.y : C.r)}${liveOk}/${liveCodes.length} (${liveRate}%)${C.x}`);

const overallGreen = failed === 0 && liveOk === liveCodes.length;
console.log(`\n  ${overallGreen ? C.g + C.b + '✓ 100% — barcode scanner pipeline verified' : C.y + '⚠ see failures above'}${C.x}\n`);

process.exit(overallGreen ? 0 : 1);
