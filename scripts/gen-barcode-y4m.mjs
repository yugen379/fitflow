// Generates a fake-camera video (Y4M) containing a real, scannable EAN-13 barcode.
// Chromium reads this via --use-file-for-fake-video-stream so we can drive the
// actual html5-qrcode live-scan pipeline headlessly. Pure Node — no ffmpeg.
//
//   node scripts/gen-barcode-y4m.mjs   →  scripts/.tmp/barcode.y4m  (+ prints the code)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE = '5901234123457';   // valid EAN-13 (check digit 7)

// --- EAN-13 encoding tables ---
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

function ean13Modules(code) {
  const d = code.split('').map(Number);
  const parity = PARITY[d[0]];
  let bits = '101'; // start guard
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[d[i + 1]];
  bits += '01010'; // center guard
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  bits += '101'; // end guard
  return bits; // 95 modules, '1' = bar (black)
}

const MODULE = 4;     // px per module
const QUIET = 12;     // quiet-zone modules each side
const BAR_H = 300;    // barcode height in px
const W = 640, H = 480;   // video frame (even dims for I420)
const FRAMES = 12;

const bits = ean13Modules(CODE);
const totalModules = bits.length + QUIET * 2;
const bcWidth = totalModules * MODULE;
const x0 = Math.floor((W - bcWidth) / 2);
const y0 = Math.floor((H - BAR_H) / 2);

// Build the Y (luma) plane in BT.601 limited range: 235 = white background,
// 16 = black bar. (C420 limited-range is what Chromium's Y4M reader expects.)
const WHITE = 235, BLACK = 16;
const Y = new Uint8Array(W * H).fill(WHITE);
for (let m = 0; m < bits.length; m++) {
  if (bits[m] !== '1') continue;
  const colStart = x0 + (QUIET + m) * MODULE;
  for (let x = colStart; x < colStart + MODULE; x++) {
    for (let y = y0; y < y0 + BAR_H; y++) Y[y * W + x] = BLACK;
  }
}
// Chroma planes: neutral grey (no colour).
const U = new Uint8Array((W / 2) * (H / 2)).fill(128);
const V = new Uint8Array((W / 2) * (H / 2)).fill(128);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '.tmp');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'barcode.y4m');

const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F25:1 Ip A1:1 C420\n`, 'ascii');
const frameMarker = Buffer.from('FRAME\n', 'ascii');
const chunks = [header];
for (let f = 0; f < FRAMES; f++) {
  chunks.push(frameMarker, Buffer.from(Y), Buffer.from(U), Buffer.from(V));
}
fs.writeFileSync(outPath, Buffer.concat(chunks));

console.log(JSON.stringify({ code: CODE, path: outPath, width: W, height: H, frames: FRAMES }));
