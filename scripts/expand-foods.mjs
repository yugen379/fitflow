// Food catalog expansion — node scripts/expand-foods.mjs [--write]
//
// The seed catalog held 133 items, all Western: banana, chicken breast, oatmeal.
// FitFlow's first twelve testers are in Penang. A tester logs nasi lemak, gets
// nothing, and goes back to MyFitnessPal — not because the app is worse, but
// because their food is not in it. That is the single most likely way the
// closed test loses people in week two.
//
// This adds Malaysian, Chinese, Indian and wider South-East Asian dishes to the
// seed, plus common Western gaps. Values are per typical single serving as
// eaten, since that is how someone logs a meal — not per 100g.
//
// Idempotent: a name already present is skipped.

import { readFileSync, writeFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const FILE = ROOT + 'scripts/data/common-foods.json';
const WRITE = process.argv.includes('--write');

// [name, kcal, protein g, carbs g, fats g] — per typical serving.
const F = (name, calories, protein, carbs, fats) => ({ name, calories, protein, carbs, fats });

const NEW = [
  // ── Malaysian mains ────────────────────────────────────────────────────────
  F('Nasi Lemak', 644, 17, 82, 27),
  F('Nasi Lemak with Fried Chicken', 890, 34, 92, 42),
  F('Nasi Goreng', 637, 19, 84, 24),
  F('Nasi Goreng Kampung', 590, 18, 78, 22),
  F('Char Kway Teow', 742, 23, 76, 38),
  F('Hokkien Mee', 620, 24, 68, 27),
  F('Mee Goreng Mamak', 660, 20, 82, 27),
  F('Maggi Goreng', 580, 16, 74, 24),
  F('Wantan Mee (dry)', 512, 24, 66, 17),
  F('Curry Mee', 605, 22, 62, 30),
  F('Asam Laksa', 380, 18, 55, 9),
  F('Curry Laksa', 590, 22, 58, 30),
  F('Nasi Kandar', 780, 30, 88, 34),
  F('Nasi Campur', 620, 24, 76, 24),
  F('Bak Kut Teh', 430, 34, 12, 26),
  F('Chicken Rice', 607, 28, 73, 22),
  F('Roast Chicken Rice', 640, 30, 74, 25),
  F('Duck Rice', 680, 28, 74, 30),
  F('Lor Mee', 520, 20, 68, 18),
  F('Mee Rebus', 480, 16, 70, 15),
  F('Mee Siam', 450, 12, 68, 14),
  F('Laksa Johor', 550, 22, 66, 22),
  F('Nasi Briyani with Chicken', 830, 33, 96, 33),
  F('Nasi Dagang', 610, 22, 74, 26),
  F('Nasi Kerabu', 520, 20, 72, 17),
  F('Lontong', 420, 11, 52, 19),
  F('Ketupat', 160, 3, 35, 1),
  F('Rendang Daging', 470, 28, 10, 36),
  F('Ayam Masak Merah', 380, 27, 14, 24),
  F('Ayam Percik', 340, 30, 9, 20),
  F('Ayam Goreng Berempah', 390, 28, 12, 26),
  F('Sambal Udang', 300, 22, 12, 18),
  F('Ikan Bakar', 260, 34, 3, 12),
  F('Ikan Goreng', 310, 30, 6, 19),
  F('Otak-Otak', 120, 8, 5, 8),
  F('Satay Ayam (5 sticks)', 280, 26, 10, 15),
  F('Satay Daging (5 sticks)', 320, 27, 11, 19),
  F('Roti Canai', 301, 6, 38, 14),
  F('Roti Telur', 400, 12, 42, 20),
  F('Roti Tissue', 420, 7, 62, 17),
  F('Capati', 150, 5, 24, 4),
  F('Thosai', 170, 5, 30, 4),
  F('Idli (2 pieces)', 116, 4, 24, 1),
  F('Vadai', 180, 6, 20, 9),
  F('Murtabak', 560, 24, 52, 28),
  F('Popiah', 180, 6, 26, 6),
  F('Rojak', 320, 9, 40, 15),
  F('Cendol', 290, 3, 46, 11),
  F('Ais Kacang', 260, 4, 52, 5),
  F('Bubur Cha Cha', 250, 3, 42, 8),
  F('Pisang Goreng (3 pieces)', 280, 3, 42, 12),
  F('Keropok Lekor', 220, 8, 28, 9),
  F('Kuih Lapis', 130, 1, 22, 4),
  F('Onde-Onde (5 pieces)', 200, 2, 33, 7),
  F('Kaya Toast', 230, 6, 32, 9),
  F('Half-Boiled Eggs (2)', 140, 12, 1, 10),
  F('Apam Balik', 300, 6, 45, 11),
  F('Yong Tau Foo (6 pieces)', 280, 20, 18, 14),
  F('Chee Cheong Fun', 240, 6, 44, 5),
  F('Pau Kaya', 180, 4, 32, 4),
  F('Pau Daging', 230, 10, 33, 7),
  F('Dim Sum Siew Mai (4 pieces)', 200, 12, 16, 10),
  F('Har Gow (4 pieces)', 160, 9, 20, 5),
  F('Char Siu Bao', 210, 7, 33, 6),
  F('Tau Fu Fah', 130, 5, 22, 3),

  // ── Malaysian / Asian drinks ──────────────────────────────────────────────
  F('Teh Tarik', 130, 3, 20, 4),
  F('Teh O Ais Limau', 90, 0, 23, 0),
  F('Kopi O', 35, 0, 9, 0),
  F('Kopi Susu', 150, 3, 24, 4),
  F('Milo Ais', 220, 6, 36, 6),
  F('Sirap Bandung', 180, 3, 34, 4),
  F('Air Kelapa (coconut water)', 60, 1, 14, 0),
  F('Sugarcane Juice', 180, 0, 44, 0),
  F('Limau Ais', 70, 0, 18, 0),
  F('Bubble Tea (regular)', 340, 3, 68, 6),

  // ── Wider Asian ───────────────────────────────────────────────────────────
  F('Pad Thai', 660, 24, 82, 26),
  F('Tom Yum Soup', 180, 16, 12, 8),
  F('Green Curry with Rice', 620, 22, 70, 28),
  F('Pho Bo', 420, 26, 60, 8),
  F('Banh Mi', 480, 20, 60, 18),
  F('Chicken Congee', 250, 14, 38, 4),
  F('Fried Rice (Chinese)', 560, 16, 78, 20),
  F('Sweet and Sour Pork', 520, 24, 52, 24),
  F('Kung Pao Chicken', 430, 30, 22, 25),
  F('Mapo Tofu', 320, 18, 12, 22),
  F('Beef Noodle Soup', 480, 30, 56, 14),
  F('Sushi Roll (6 pieces)', 250, 9, 42, 4),
  F('Chicken Katsu Curry', 780, 32, 92, 30),
  F('Ramen (Tonkotsu)', 650, 28, 72, 27),
  F('Gyoza (5 pieces)', 230, 10, 24, 10),
  F('Bibimbap', 590, 22, 82, 18),
  F('Korean Fried Chicken (4 pieces)', 520, 30, 34, 28),
  F('Kimchi', 25, 1, 4, 0),
  F('Chicken Tikka Masala', 490, 32, 18, 32),
  F('Butter Chicken', 520, 30, 16, 37),
  F('Dhal Curry', 210, 11, 28, 6),
  F('Naan', 260, 8, 45, 5),
  F('Basmati Rice (1 cup)', 205, 4, 45, 0),
  F('Samosa (2 pieces)', 300, 6, 34, 16),
  F('Palak Paneer', 380, 17, 14, 29),

  // ── Common Western gaps ───────────────────────────────────────────────────
  F('Chicken Caesar Salad', 470, 30, 14, 33),
  F('Beef Burger with Cheese', 640, 33, 44, 36),
  F('Grilled Chicken Sandwich', 420, 33, 42, 12),
  F('Margherita Pizza (2 slices)', 500, 20, 62, 18),
  F('Pepperoni Pizza (2 slices)', 600, 24, 62, 28),
  F('Spaghetti Bolognese', 590, 27, 74, 20),
  F('Carbonara', 660, 26, 70, 30),
  F('Fish and Chips', 840, 34, 88, 38),
  F('Chicken Wrap', 450, 28, 44, 17),
  F('Club Sandwich', 560, 30, 46, 27),
  F('Baked Potato with Butter', 320, 6, 56, 9),
  F('Sweet Potato Fries', 380, 4, 52, 18),
  F('Onion Rings', 410, 5, 48, 22),
  F('Chicken Nuggets (6 pieces)', 280, 15, 18, 17),
  F('Beef Steak (200g sirloin)', 420, 52, 0, 23),
  F('Grilled Salmon Fillet', 367, 40, 0, 22),
  F('Tuna Salad', 290, 25, 8, 18),
  F('Omelette (3 eggs)', 320, 21, 3, 25),
  F('Scrambled Eggs (2 eggs)', 200, 13, 2, 15),
  F('Pancakes (3)', 350, 9, 52, 12),
  F('French Toast (2 slices)', 340, 12, 40, 15),
  F('Croissant', 270, 6, 31, 14),
  F('Bagel with Cream Cheese', 380, 13, 55, 12),
  F('Overnight Oats', 350, 13, 52, 10),
  F('Protein Shake (1 scoop)', 130, 25, 4, 2),
  F('Protein Bar', 220, 20, 22, 7),
  F('Peanut Butter (2 tbsp)', 190, 8, 6, 16),
  F('Hummus (2 tbsp)', 70, 2, 6, 5),
  F('Mixed Nuts (30g)', 180, 6, 6, 16),
  F('Greek Yogurt (170g)', 100, 17, 6, 0),
  F('Cottage Cheese (100g)', 98, 11, 3, 4),
  F('Caesar Dressing (2 tbsp)', 160, 1, 1, 17),
  F('Olive Oil (1 tbsp)', 119, 0, 0, 14),
  F('Avocado Toast', 290, 8, 30, 16),
  F('Chia Pudding', 240, 8, 26, 12),
  F('Smoothie Bowl', 380, 10, 62, 11),
  F('Chocolate Chip Cookie', 160, 2, 21, 8),
  F('Brownie', 240, 3, 32, 12),
  F('Ice Cream (1 scoop)', 140, 2, 17, 7),
  F('Dark Chocolate (30g)', 170, 2, 13, 12),
];

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const seen = new Set(data.map((f) => String(f.name).trim().toLowerCase()));

const added = [];
const skipped = [];
for (const f of NEW) {
  const key = f.name.trim().toLowerCase();
  if (seen.has(key)) { skipped.push(f.name); continue; }
  seen.add(key);
  added.push(f);
}

// Sanity: reject anything whose macros cannot produce its calorie figure.
// 4/4/9 kcal per gram, allowing a generous margin for fibre, alcohol and
// rounding — a typo here becomes a wrong calorie target for a real person.
const suspect = added.filter((f) => {
  const derived = f.protein * 4 + f.carbs * 4 + f.fats * 9;
  return Math.abs(derived - f.calories) > Math.max(120, f.calories * 0.30);
});

const merged = [...data, ...added].sort((a, b) => a.name.localeCompare(b.name));
console.log(`foods: ${data.length} → ${merged.length}  (+${added.length})`);
if (skipped.length) console.log(`  skipped as already present: ${skipped.join(', ')}`);
if (suspect.length) {
  console.log(`\n  MACRO MISMATCH — review before writing:`);
  for (const f of suspect) {
    console.log(`    ${f.name}: stated ${f.calories} kcal, macros imply ${f.protein * 4 + f.carbs * 4 + f.fats * 9}`);
  }
}

if (WRITE) {
  if (suspect.length) { console.log('\nrefusing to write while macros disagree.'); process.exit(1); }
  writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log('written.');
} else {
  console.log('\ndry run — pass --write to apply.');
}
