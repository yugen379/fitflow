// Backfill the fields the scheduled push jobs select on — one-time, immediately
// after deploying the release that adds them.
//
// syncPublicProfile keeps pushTzBucket and pushReminderHourUtc current, but only
// when a user document is WRITTEN. Until this runs, accounts that have not
// written since the deploy are invisible to the reminder and nudge queries, so
// they silently stop getting pushes. It also seeds community_stats/global, so
// Home has a number before the first hourly refresh.
//
// Usage (needs ADC or GOOGLE_APPLICATION_CREDENTIALS):
//   node scripts/backfill-push-fields.mjs --dry   # writes nothing, prints counts
//   node scripts/backfill-push-fields.mjs
//
// Idempotent: writes only documents whose stored values differ. Safe to re-run;
// a re-run reporting 0 writes is the proof that it finished.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { getFirestore, FieldPath, FieldValue } = require('firebase-admin/firestore');

const DRY = process.argv.includes('--dry');
const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, '..', 'firebase-applet-config.json'), 'utf8'));
admin.initializeApp({ projectId: cfg.projectId, credential: admin.credential.applicationDefault() });
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId || undefined);

// Same rule as the trigger: one implementation, from the built functions.
process.env.FIRESTORE_DATABASE_ID = cfg.firestoreDatabaseId;
const { pushFieldsFor, COMMUNITY_GOALS } = require('./lib/pushJobs.js');

let scanned = 0, changed = 0, last = null;
for (;;) {
  let q = db.collection('users').orderBy(FieldPath.documentId()).limit(400);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  const batch = db.batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    const u = doc.data();
    const next = pushFieldsFor(u);
    if (u.pushTzBucket === next.pushTzBucket && u.pushReminderHourUtc === next.pushReminderHourUtc) continue;
    changed++;
    if (!DRY) { batch.update(doc.ref, next); inBatch++; }
  }
  if (inBatch) await batch.commit();
  scanned += snap.size;
  last = snap.docs[snap.docs.length - 1];
  console.log(`  scanned ${scanned}, ${DRY ? 'would write' : 'wrote'} ${changed}`);
}

const profiles = db.collection('public_profiles');
const count = async (query) => (await query.count().get()).data().count;
const total = await count(profiles);
const byGoal = {};
for (const g of COMMUNITY_GOALS) byGoal[g] = await count(profiles.where('goal', '==', g));
console.log('community', JSON.stringify({ total, byGoal }));
if (!DRY) await db.doc('community_stats/global').set({ total, byGoal, updatedAt: FieldValue.serverTimestamp() });

console.log(`${DRY ? 'DRY RUN: ' : ''}${scanned} users, ${changed} ${DRY ? 'need writing' : 'written'}`);
process.exit(0);
