// Diagnose the step_days permission-denied — node scripts/diag-stepdays.mjs
//
// Read-only. Uses admin credentials (ADC), which BYPASS security rules, so it
// shows the true server state that the client is being judged against.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dir, '..', 'firebase-applet-config.json'), 'utf8'));

admin.initializeApp({ projectId: cfg.projectId, credential: admin.credential.applicationDefault() });
// Named database, same as the client (getFirestore(app, firestoreDatabaseId))
// and the seed script. db.settings({databaseId}) is NOT the admin API for this
// and silently reads (default) instead, which is how the first run of this
// script reported an empty collection that was really just the wrong database.
const db = cfg.firestoreDatabaseId
  ? admin.firestore(admin.app(), cfg.firestoreDatabaseId)
  : admin.firestore();

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

console.log(`project=${cfg.projectId} db=${cfg.firestoreDatabaseId || '(default)'} today=${dayKey}\n`);

// Which users exist, and what do their step docs look like?
const users = await db.collection('users').limit(10).get();
console.log(`users: ${users.size}`);
for (const u of users.docs) {
  const d = u.data();
  console.log(`  ${u.id}  email=${d.email ?? '-'}  name=${d.displayName ?? d.name ?? '-'}  streak=${d.streak ?? '-'}`);
}

console.log('');
const sd = await db.collection('step_days').limit(20).get();
console.log(`step_days documents on the server: ${sd.size}`);
for (const doc of sd.docs) {
  const d = doc.data();
  const idMatchesOwner = doc.id === `${d.userId}_${d.day}`;
  console.log(`  id=${doc.id}`);
  console.log(`     userId=${d.userId}  day=${d.day}  steps=${d.steps}  source=${d.source ?? '-'}`);
  console.log(`     id == userId_day ? ${idMatchesOwner}`);
  console.log(`     keys: ${Object.keys(d).sort().join(', ')}`);
  console.log(`     updatedAt type: ${d.updatedAt?.constructor?.name ?? typeof d.updatedAt}`);
}

console.log('');
const todays = await db.collection('step_days').where('day', '==', dayKey).get();
console.log(`step_days for TODAY (${dayKey}): ${todays.size}`);
for (const doc of todays.docs) {
  const d = doc.data();
  console.log(`  ${doc.id} -> steps=${d.steps} userId=${d.userId}`);
}

process.exit(0);
