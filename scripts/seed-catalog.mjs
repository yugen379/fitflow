// Seed the shared food_catalog (#4) — kills the cold-start "empty moat" so the
// very first users get instant hits instead of an AI round-trip on every food.
//
// Usage (one-time, or to top up):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
//     node scripts/seed-catalog.mjs
//   # or, if you're logged in with the Firebase CLI / gcloud ADC, just:
//   node scripts/seed-catalog.mjs
//
// Idempotent: upserts by catalogKey with merge, so re-running only refreshes.
// Only writes entries that pass the SAME validation the app uses (proven by
// `npm run proof:seed`). Never overwrites richer user-contributed data destructively.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

const { catalogKey, normalizeCatalogFood } = await import('../src/services/foodCatalogUtils.ts');

const __dir = dirname(fileURLToPath(import.meta.url));
const foods = JSON.parse(readFileSync(join(__dir, 'data', 'common-foods.json'), 'utf8'));

// firebase-applet-config.json carries projectId + the named Firestore database.
const cfg = JSON.parse(readFileSync(join(__dir, '..', 'firebase-applet-config.json'), 'utf8'));

admin.initializeApp({
  projectId: cfg.projectId,
  credential: admin.credential.applicationDefault(),
});
// Match the app's named database (db = getFirestore(app, firestoreDatabaseId)).
const db = cfg.firestoreDatabaseId
  ? admin.firestore(admin.app(), cfg.firestoreDatabaseId)
  : admin.firestore();

const FieldValue = admin.firestore.FieldValue;

let written = 0, skipped = 0;
let batch = db.batch();
let inBatch = 0;

for (const raw of foods) {
  const food = normalizeCatalogFood(raw);
  const key = food ? catalogKey(food.name) : '';
  if (!food || !key) { skipped++; continue; }
  batch.set(
    db.collection('food_catalog').doc(key),
    {
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fats: food.fats,
      ...(food.brand ? { brand: food.brand } : {}),
      seed: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  written++;
  if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
}
if (inBatch > 0) await batch.commit();

console.log(`✓ Seeded food_catalog: ${written} written, ${skipped} skipped (invalid).`);
process.exit(0);
