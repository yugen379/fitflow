// On-device pose detection for Form Check.
//
// MediaPipe PoseLandmarker gives 33 body landmarks per frame, locally, with no
// network round-trip — which is what makes a live skeleton overlay possible at
// all. Gemini still writes the coaching sentence (it is far better at that),
// but the geometry, the verdict colour, and the lines on the body come from
// here, every frame, at camera rate.
//
// The model (~5.6 MB) and the MediaPipe wasm runtime live in /public/pose and
// are fetched on first use only. They are excluded from the SW precache and
// picked up by a CacheFirst runtime rule (see vite.config.ts), so the download
// happens once per device and Form Check works offline afterwards.
//
// ONLY THE SIMD WASM IS SHIPPED. MediaPipe also publishes a `nosimd` build for
// WebViews without WebAssembly SIMD, but it is another 11 MB and Capacitor
// copies everything in /public straight into the Android bundle — it alone was
// a third of the APK. Every browser and Android System WebView that has shipped
// in years supports SIMD. On one that does not, FilesetResolver fails to load,
// createFromOptions throws, getPoseLandmarker returns null, and Form Check runs
// its Gemini-only path with no overlay. Degraded, not broken — which is the
// same fallback an offline first-run already takes.

import type { PoseLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Where the model + wasm are served from. Same-origin, versioned by deploy. */
const POSE_ASSET_PATH = '/pose';
const MODEL_FILE = `${POSE_ASSET_PATH}/pose_landmarker_lite.task`;

/** MediaPipe's 33-point topology — only the joints form rules actually use. */
export const LM = {
  nose: 0,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30,
  footL: 31, footR: 32,
} as const;

export type Landmarks = NormalizedLandmark[];

let landmarkerPromise: Promise<PoseLandmarker | null> | null = null;

/**
 * Load the detector once per page. Returns null — never throws — if the model
 * or wasm cannot be fetched (offline first-run, blocked host, unsupported
 * browser); callers fall back to the Gemini-only path so Form Check still works
 * without the overlay rather than showing a dead screen.
 */
export const getPoseLandmarker = async (): Promise<PoseLandmarker | null> => {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    try {
      const { FilesetResolver, PoseLandmarker: PL } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(POSE_ASSET_PATH);
      return await PL.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_FILE,
          // GPU where available; MediaPipe falls back to CPU on its own.
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        // Below these the skeleton jitters between frames badly enough to look
        // broken. Better to show no overlay than a flickering one.
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (e) {
      console.warn('Pose model unavailable — Form Check runs without the overlay:', e);
      return null;
    }
  })();
  return landmarkerPromise;
};

/**
 * Landmarks for one video frame, or null when no body is in view.
 *
 * `timestampMs` must increase strictly between calls — MediaPipe's VIDEO mode
 * rejects a repeated or rewound timestamp, and a rejected frame throws rather
 * than returning empty, which would kill the render loop.
 */
export const detectPose = (
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): Landmarks | null => {
  try {
    const res = landmarker.detectForVideo(video, timestampMs);
    const first = res?.landmarks?.[0];
    return first && first.length ? first : null;
  } catch {
    return null;
  }
};

/** Free the GPU/wasm resources. Safe to call more than once. */
export const closePoseLandmarker = async (): Promise<void> => {
  const p = landmarkerPromise;
  landmarkerPromise = null;
  if (!p) return;
  try {
    const lm = await p;
    lm?.close();
  } catch {
    /* already torn down */
  }
};

/**
 * True when enough of the body is visible to judge form. MediaPipe happily
 * reports landmarks for a half-visible body by extrapolating them off-screen,
 * and scoring those produces confident nonsense — so require the joints that
 * every rule depends on to be genuinely present.
 */
export const bodyFullyVisible = (lm: Landmarks | null): boolean => {
  if (!lm) return false;
  const required = [
    LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR,
    LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR,
  ];
  return required.every((i) => {
    const p = lm[i];
    // `visibility` is MediaPipe's own occlusion score; the coordinate bounds
    // catch the extrapolated-off-frame case it stays optimistic about.
    return !!p && (p.visibility ?? 0) > 0.5 &&
      p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05;
  });
};
