// Backfill /public_profiles from /users — one-time, after deploying the
// syncPublicProfile trigger and the tightened rules.
//
// The trigger only fires when a user document is WRITTEN. Existing users have
// no mirror until they next log something, so without this the leaderboards go
// empty on the day the rules ship. Run it once, then the trigger maintains it.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
//     node scripts/backfill-public-profiles.mjs
//   # or, logged in with Firebase CLI / gcloud ADC:
//   node scripts/backfill-public-profiles.mjs
//   # dry run (writes nothing, prints what it would do):
//   node scripts/backfill-public-profiles.mjs --dry
//
// Idempotent: rewrites each mirror from the current user doc. Safe to re-run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');
const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, '..', 'firebase-applet-config.json'), 'utf8'));

admin.initializeApp({
  projectId: cfg.projectId,
  credential: admin.credential.applicationDefault(),
});
// Modular getFirestore(app, id) — `admin.firestore(app, id)` silently ignores
// the database id in firebase-admin v13 and writes to (default), which this
// project does not use.
const db = getFirestore(admin.app(), cfg.firestoreDatabaseId || undefined);

// MUST match PUBLIC_PROFILE_FIELDS in functions/src/index.ts.
const PUBLIC_PROFILE_FIELDS = ['displayName', 'photoURL', 'points', 'streak', 'level', 'goal'];

const publicViewOf = (u) => {
  const out = {};
  for (const f of PUBLIC_PROFILE_FIELDS) if (u[f] !== undefined) out[f] = u[f];
  return out;
};

const users = await db.collection('users').get();
console.log(`${users.size} user document(s) in ${cfg.projectId}/${cfg.firestoreDatabaseId || '(default)'}`);

let written = 0;
let batch = db.batch();
let inBatch = 0;

for (const doc of users.docs) {
  const view = publicViewOf(doc.data() || {});
  if (DRY) {
    console.log(`  would mirror ${doc.id}: ${JSON.stringify(view)}`);
    written++;
    continue;
  }
  batch.set(db.doc(`public_profiles/${doc.id}`), view, { merge: false });
  written++;
  if (++inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
}
if (!DRY && inBatch > 0) await batch.commit();

// A mirror whose user is gone must not linger on the leaderboard.
const mirrors = await db.collection('public_profiles').get();
const liveUids = new Set(users.docs.map((d) => d.id));
const orphans = mirrors.docs.filter((d) => !liveUids.has(d.id));
if (orphans.length && !DRY) {
  const b = db.batch();
  orphans.forEach((d) => b.delete(d.ref));
  await b.commit();
}

console.log(`${DRY ? '[dry] ' : ''}mirrored ${written}, removed ${orphans.length} orphan(s)`);
console.log(`${DRY ? '[dry] ' : ''}done — public fields: ${PUBLIC_PROFILE_FIELDS.join(', ')}`);
