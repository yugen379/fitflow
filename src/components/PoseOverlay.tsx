import React, { useEffect, useRef } from 'react';
import { getPoseLandmarker, detectPose, bodyFullyVisible, LM, type Landmarks } from '../lib/poseDetector';
import { evaluateForm, type FormVerdict } from '../lib/formRules';

/**
 * Live skeleton drawn over the Form Check camera feed.
 *
 * Runs entirely on-device at ~20 fps: MediaPipe returns 33 landmarks, formRules
 * turns them into a verdict, and limbs at fault are drawn in the alert colour
 * while everything else stays volt-green. The parent still gets a Gemini cue
 * every 3 s for the coaching sentence; this is the part that reacts instantly.
 */

/** Face landmarks are noise for a form app — torso, arms and legs only. */
const CONNECTIONS: Array<[number, number]> = [
  [LM.shoulderL, LM.shoulderR],
  [LM.shoulderL, LM.hipL], [LM.shoulderR, LM.hipR],
  [LM.hipL, LM.hipR],
  [LM.shoulderL, LM.elbowL], [LM.elbowL, LM.wristL],
  [LM.shoulderR, LM.elbowR], [LM.elbowR, LM.wristR],
  [LM.hipL, LM.kneeL], [LM.kneeL, LM.ankleL], [LM.ankleL, LM.footL],
  [LM.hipR, LM.kneeR], [LM.kneeR, LM.ankleR], [LM.ankleR, LM.footR],
];

const JOINTS = [
  LM.shoulderL, LM.shoulderR, LM.elbowL, LM.elbowR, LM.wristL, LM.wristR,
  LM.hipL, LM.hipR, LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR,
];

const COLOR = {
  good: '#CCFF00',
  fix: '#FFB800',
  danger: '#FF3366',
} as const;

/** Detection cadence. Full 60 fps buys nothing visually and cooks the battery. */
const DETECT_INTERVAL_MS = 50;

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  exerciseName: string;
  /** True when the front camera is showing a CSS-mirrored preview. */
  mirrored: boolean;
  paused?: boolean;
  /** Fires on every analysed frame; null when nobody is in view. */
  onVerdict: (v: FormVerdict | null) => void;
  /** Fires once we know whether the on-device model is usable at all. */
  onReady?: (ready: boolean) => void;
}

export const PoseOverlay: React.FC<Props> = ({
  videoRef, exerciseName, mirrored, paused = false, onVerdict, onReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const lastTsRef = useRef(0);
  // Keep the latest callbacks/props in refs so the rAF loop is started once and
  // never torn down mid-session by a re-render.
  const onVerdictRef = useRef(onVerdict);
  const exerciseRef = useRef(exerciseName);
  const pausedRef = useRef(paused);
  onVerdictRef.current = onVerdict;
  exerciseRef.current = exerciseName;
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const landmarker = await getPoseLandmarker();
      if (cancelled) return;
      onReady?.(!!landmarker);
      if (!landmarker) return; // Gemini-only fallback; no overlay.

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

        // Match the backing store to the displayed box, accounting for DPR so
        // the lines are crisp on a phone screen.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
          canvas.width = cw * dpr;
          canvas.height = ch * dpr;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        if (pausedRef.current) return;

        const now = performance.now();
        if (now - lastDetectRef.current < DETECT_INTERVAL_MS) return;
        lastDetectRef.current = now;

        // MediaPipe VIDEO mode rejects a non-increasing timestamp.
        const ts = Math.max(now, lastTsRef.current + 1);
        lastTsRef.current = ts;

        const lm: Landmarks | null = detectPose(landmarker, video, ts);
        if (!lm || !bodyFullyVisible(lm)) {
          onVerdictRef.current(null);
          return;
        }

        const verdict = evaluateForm(lm, exerciseRef.current);
        onVerdictRef.current(verdict);

        // The <video> uses object-cover, so the frame is scaled to fill and
        // centre-cropped. Reproduce exactly that or the skeleton drifts off the
        // body on any aspect ratio but one.
        const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
        const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
        const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
        const px = (n: { x: number }) => ox + n.x * dw;
        const py = (n: { y: number }) => oy + n.y * dh;

        const base = COLOR[verdict.status];
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const [a, b] of CONNECTIONS) {
          const pa = lm[a], pb = lm[b];
          if (!pa || !pb) continue;
          const bad = verdict.badJoints.has(a) && verdict.badJoints.has(b);
          ctx.strokeStyle = bad ? COLOR.danger : base;
          ctx.lineWidth = bad ? 6 : 4;
          ctx.globalAlpha = bad ? 1 : 0.9;
          // A soft glow keeps the skeleton readable over a bright gym floor.
          ctx.shadowColor = ctx.strokeStyle as string;
          ctx.shadowBlur = bad ? 14 : 8;
          ctx.beginPath();
          ctx.moveTo(px(pa), py(pa));
          ctx.lineTo(px(pb), py(pb));
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        for (const j of JOINTS) {
          const p = lm[j];
          if (!p) continue;
          const bad = verdict.badJoints.has(j);
          ctx.beginPath();
          ctx.arc(px(p), py(p), bad ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = bad ? COLOR.danger : base;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.stroke();
        }
      };

      loop();
    };

    run();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // The loop reads everything else through refs, so it is deliberately
    // started once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
    />
  );
};
