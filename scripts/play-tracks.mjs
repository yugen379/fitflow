// Ask Google Play what the CI service account can see — no dependencies.
//
//   PLAY_SA='<service account JSON>' node scripts/play-tracks.mjs
//
// Prints every track (alpha, beta, internal, production and any custom closed
// track) with the version codes released on it. Exits non-zero with a plain
// explanation when the account has not been granted access in Play Console —
// so a missing permission is a red step with instructions, never a silent skip.
//
// It opens an "edit" only to read, and always deletes it again; nothing is
// changed on Play.
import { createSign } from 'node:crypto';

const PACKAGE = process.env.PLAY_PACKAGE || 'com.fitflow.fitness';
const raw = process.env.PLAY_SA || '';
if (!raw.trim()) {
  console.log('::error::PLAY_SERVICE_ACCOUNT is not set — Play uploads cannot run.');
  process.exit(1);
}
const sa = JSON.parse(raw);

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claim = b64url(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 600,
}));
const signer = createSign('RSA-SHA256');
signer.update(`${header}.${claim}`);
const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;

const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
}).then((r) => r.json());
if (!tok.access_token) {
  console.log(`::error::Could not authenticate the Play service account: ${JSON.stringify(tok).slice(0, 200)}`);
  process.exit(1);
}

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const call = (path, method = 'GET') =>
  fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tok.access_token}` } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const edit = await call('/edits', 'POST');
if (edit.status !== 200) {
  const msg = edit.body?.error?.message || `HTTP ${edit.status}`;
  console.log(`::error::Play refused ${sa.client_email}: ${msg}`);
  console.log('Fix: Play Console -> Users and permissions -> Invite new users -> paste that email ->');
  console.log('     App permissions -> FitFlow -> tick "Release apps to testing tracks" -> Invite user.');
  process.exit(1);
}
try {
  const tracks = await call(`/edits/${edit.body.id}/tracks`);
  console.log(`Play access OK for ${sa.client_email} on ${PACKAGE}\n`);
  for (const t of tracks.body.tracks || []) {
    const rel = (t.releases || []).map((r) => `${r.status}${r.versionCodes ? ` vc${r.versionCodes.join(',')}` : ''}${r.name ? ` "${r.name}"` : ''}`);
    console.log(`  track ${JSON.stringify(t.track).padEnd(28)} ${rel.join(' | ') || '(no releases)'}`);
  }
} finally {
  await call(`/edits/${edit.body.id}`, 'DELETE');
}
