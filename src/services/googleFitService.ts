/// <reference types="vite/client" />
import { doc, updateDoc } from 'firebase/firestore';
import { db, GOOGLE_OAUTH_CLIENT_ID } from '../lib/firebase';

// Use the existing project's OAuth Web Client (already used by Firebase Auth,
// so the Cloud project is consistent and the consent screen is shared).
// Allow override via VITE_GOOGLE_FIT_CLIENT_ID for environments that pin a
// separate client.
const CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_FIT_CLIENT_ID as string | undefined) ||
  GOOGLE_OAUTH_CLIENT_ID;

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read',
].join(' ');

export interface GoogleFitData {
  steps: number;
  activeMinutes: number;
  caloriesBurned: number;
}

// Google Identity Services types — narrow surface to avoid pulling @types.
type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};
type GisTokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};
type GisAccountsOauth2 = {
  initTokenClient: (params: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => GisTokenClient;
};

const getGis = (): GisAccountsOauth2 | null => {
  const g = (window as any).google;
  return g?.accounts?.oauth2 ?? null;
};

const waitForGis = (timeoutMs = 4000): Promise<GisAccountsOauth2 | null> =>
  new Promise(resolve => {
    const existing = getGis();
    if (existing) return resolve(existing);
    const start = Date.now();
    const iv = setInterval(() => {
      const g = getGis();
      if (g) { clearInterval(iv); resolve(g); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(null); }
    }, 100);
  });

// The OAuth token stays ON THIS DEVICE. User docs are readable by any signed-in
// user (leaderboards need that), so a token persisted to Firestore would be
// readable by other users — only the connected flag goes to the profile.
const TOKEN_STORAGE_KEY = 'fitflow.googleFit.token';

export const getStoredGoogleFitToken = (): string | null => {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const { token, expiry } = JSON.parse(raw);
    if (!token || Date.now() >= expiry) return null;
    return token;
  } catch {
    return null;
  }
};

const persistToken = async (uid: string, accessToken: string, expiresInSec: number) => {
  const expiryTime = Date.now() + expiresInSec * 1000;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token: accessToken, expiry: expiryTime }));
  } catch { /* storage full/blocked — connection still works this session */ }
  await updateDoc(doc(db, 'users', uid), {
    googleFitConnected: true,
  });
};

export interface GoogleFitAuthOptions {
  uid?: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

// Modern popup-based consent using Google Identity Services. Falls back to the
// classic OAuth redirect flow only if GIS fails to load (e.g. blocked by an
// ad-blocker or a strict CSP).
export const googleFitAuth = async (opts: GoogleFitAuthOptions = {}) => {
  if (!CLIENT_ID || CLIENT_ID.startsWith('PLACEHOLDER') || CLIENT_ID.length < 30) {
    opts.onError?.('Google Fit OAuth client is not configured.');
    return;
  }

  const gis = await waitForGis();
  if (gis && opts.uid) {
    try {
      const tokenClient = gis.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
          if (resp.error) {
            const msg = resp.error_description || resp.error;
            console.warn('[googleFit] token error:', msg);
            opts.onError?.(`Google Fit connect failed: ${msg}`);
            return;
          }
          if (!resp.access_token) {
            opts.onError?.('Google Fit returned no access token.');
            return;
          }
          try {
            await persistToken(opts.uid!, resp.access_token, resp.expires_in ?? 3600);
            opts.onSuccess?.();
          } catch (e: any) {
            console.error('[googleFit] persist failed:', e);
            opts.onError?.('Connected, but saving the token failed. Try again.');
          }
        },
        error_callback: (err) => {
          // type can be: popup_failed_to_open, popup_closed, unknown
          const msg = err?.message || err?.type || 'Unknown error';
          if (err?.type === 'popup_closed') return; // user dismissed; stay silent
          console.warn('[googleFit] GIS error:', err);
          opts.onError?.(`Google Fit connect failed: ${msg}`);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
      return;
    } catch (e: any) {
      console.warn('[googleFit] GIS init failed, falling back to redirect:', e?.message || e);
    }
  }

  // Fallback: classic implicit-grant redirect (Profile.tsx parses the hash on return).
  const redirectUri = window.location.origin + '/profile';
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&include_granted_scopes=true` +
    `&scope=${encodeURIComponent(SCOPES)}`;
  window.location.href = authUrl;
};

export const fetchGoogleFitData = async (accessToken: string): Promise<GoogleFitData> => {
  const now = new Date();
  const startTimeMillis = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endTimeMillis = now.getTime();

  const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta' },
        { dataTypeName: 'com.google.active_minutes' },
        { dataTypeName: 'com.google.calories.expended' }
      ],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis,
      endTimeMillis
    })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Google Fit data');
  }

  const data = await response.json();
  let steps = 0;
  let activeMinutes = 0;
  let caloriesBurned = 0;

  if (data.bucket && data.bucket[0] && data.bucket[0].dataset) {
    data.bucket[0].dataset.forEach((ds: any) => {
      if (ds.point && ds.point[0]) {
        if (ds.dataSourceId.includes('step_count')) steps = ds.point[0].value[0].intVal || 0;
        if (ds.dataSourceId.includes('active_minutes')) activeMinutes = ds.point[0].value[0].intVal || 0;
        if (ds.dataSourceId.includes('calories')) caloriesBurned = Math.round(ds.point[0].value[0].fpVal || 0);
      }
    });
  }

  return { steps, activeMinutes, caloriesBurned };
};
