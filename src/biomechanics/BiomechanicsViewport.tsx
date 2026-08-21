/**
 * The 3D biomechanics viewport.
 *
 * Responsibilities, in the order they matter for not shipping a crash:
 *   1. Lifecycle — one scene per mount, disposed exhaustively on unmount, with
 *      WebGL context loss treated as a recoverable state rather than a crash.
 *   2. Backgrounding — the render loop, the telemetry stream and the physics
 *      clock all stop when the app is hidden and resume without a time jump.
 *   3. Gesture isolation — the viewport owns orbit, pan and pinch inside its own
 *      bounds and never lets a drag leak into the page scroller or the router's
 *      swipe-back.
 *   4. Thermal/FPS guardrails — quality steps down under sustained frame-rate
 *      loss and is allowed back up only slowly.
 *
 * Everything drawn per frame is written imperatively. React re-renders here only
 * when a user-visible mode changes, never because the animation advanced.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Maximize2, RefreshCw, RotateCcw } from 'lucide-react';

import { cn } from '../lib/utils';
import { AvatarScene, MEASURED_JOINTS } from './avatarScene';
import type { LayerFlags, SceneFrame } from './avatarScene';
import { getClipOrDefault, sampleClip } from './motions';
import { EQUIPMENT } from './motions';
import { FpsGuard, initialTierForDevice } from './perfGuard';
import { barPosition, readJointAngles, solvePose } from './rig';
import { selectEquipment } from './selectors';
import { useAppDispatch, useAppSelector } from './store';
import { pushTelemetryFrame, telemetryStreamStarted, telemetryStreamStopped } from './telemetryMiddleware';
import { MUSCLE_COUNT } from './types';
import type { JointAngles, MotionClip, Skeleton, Vec3 } from './types';
import { useBiomechanicsControls } from './useBiomechanicsControls';
import {
  contextLost as contextLostAction,
  contextRestored as contextRestoredAction,
  perfSampled,
  QUALITY_PROFILES,
  reducedMotionSet,
  suspendedSet,
  viewportFailed,
  viewportInitialising,
  viewportReady,
} from './viewportSlice';

// ---------------------------------------------------------------------------
// Support probe
// ---------------------------------------------------------------------------

/**
 * Probe for WebGL without keeping the probe context alive — a leaked probe
 * counts against the browser's per-page context budget, and on Android that
 * budget is small enough to matter.
 */
const probeWebGL = (): boolean => {
  if (typeof document === 'undefined') return false;
  let canvas: HTMLCanvasElement | null = document.createElement('canvas');
  try {
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  } finally {
    canvas = null;
  }
};

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface BoundaryProps {
  children: React.ReactNode;
  onReset: () => void;
  /** Bumped by the parent to clear a caught error and remount the canvas. */
  resetToken: number;
}

interface BoundaryState {
  error: Error | null;
  token: number;
}

/**
 * A shader compile failure or a driver-level throw must degrade this one panel,
 * not take down the workout screen around it.
 */
class ViewportErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  declare state: BoundaryState;
  declare props: BoundaryProps;

  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null, token: props.resetToken };
  }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  /**
   * Recovery is driven by the parent bumping `resetToken` rather than by
   * `setState` inside the handler, which keeps the retry path a single source
   * of truth: one token change clears the error and remounts the canvas.
   */
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetToken !== state.token) return { error: null, token: props.resetToken };
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('Biomechanics viewport error:', error, info.componentStack);
    import('../lib/telemetry')
      .then(({ captureError }) => captureError(error, { area: 'biomechanics-viewport' }))
      .catch(() => {});
  }

  handleRetry = () => {
    this.props.onReset();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ViewportFallback
        title="3D view unavailable"
        body="The 3D engine hit an error on this device. Your session and all your data are unaffected."
        detail={this.state.error.message}
        actionLabel="Try again"
        onAction={this.handleRetry}
      />
    );
  }
}

// ---------------------------------------------------------------------------
// Fallback panel
// ---------------------------------------------------------------------------

const ViewportFallback: React.FC<{
  title: string;
  body: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, body, detail, actionLabel, onAction }) => (
  <div className="glass w-full h-full min-h-[280px] flex flex-col items-center justify-center text-center px-6 py-8 gap-3">
    <div className="w-11 h-11 rounded-2xl bg-accent-2/12 border border-accent-2/25 flex items-center justify-center">
      <AlertTriangle size={20} className="text-accent-2" aria-hidden="true" />
    </div>
    <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
    <p className="text-sm text-text-dim leading-relaxed max-w-xs">{body}</p>
    {detail ? <p className="text-xs text-text-mute font-mono max-w-xs truncate">{detail}</p> : null}
    {actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        className="mt-2 h-11 px-5 rounded-xl bg-white/[0.06] text-white text-sm font-medium inline-flex items-center gap-2 active:scale-[0.98] transition-transform"
      >
        <RefreshCw size={15} aria-hidden="true" />
        {actionLabel}
      </button>
    ) : null}
  </div>
);

// ---------------------------------------------------------------------------
// Canvas host
// ---------------------------------------------------------------------------

interface ViewportProps {
  className?: string;
  /** Overrides the clip resolved from the active session. */
  clipId?: string | null;
  /** Hides the floating angle chips (used in compact cards). */
  showAngles?: boolean;
}

const ViewportCanvas: React.FC<ViewportProps> = ({ className, clipId, showAngles = true }) => {
  const dispatch = useAppDispatch();
  const controls = useBiomechanicsControls();
  const sessionEquipment = useAppSelector(selectEquipment);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const rafRef = useRef<number | null>(null);
  const guardRef = useRef<FpsGuard | null>(null);
  const lastFrameRef = useRef<number>(0);
  const overlayRefs = useRef(new Map<string, HTMLDivElement>());
  const lastOverlayRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Scratch buffers — the loop must not allocate.
  const activationRef = useRef<Float32Array>(new Float32Array(MUSCLE_COUNT));
  const frameRef = useRef<SceneFrame | null>(null);

  // Live mirrors of React state for the loop, so the loop closure is built once.
  const controlsRef = useRef(controls);
  const clipRef = useRef<MotionClip>(getClipOrDefault(clipId ?? controls.clip.id));
  const equipmentRef = useRef(sessionEquipment);
  const layersRef = useRef<LayerFlags>(controls.layers);

  const [unsupported, setUnsupported] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [rebuildToken, setRebuildToken] = useState(0);

  const activeClip = clipId ? getClipOrDefault(clipId) : controls.clip;

  controlsRef.current = controls;
  clipRef.current = activeClip;
  equipmentRef.current = sessionEquipment;
  layersRef.current = controls.layers;

  // -------------------------------------------------------------------------
  // Reduced motion
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => dispatch(reducedMotionSet(query.matches));
    apply();
    // Safari < 14 only supports the deprecated listener API.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', apply);
      return () => query.removeEventListener('change', apply);
    }
    query.addListener(apply);
    return () => query.removeListener(apply);
  }, [dispatch]);

  // -------------------------------------------------------------------------
  // Backgrounding
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      dispatch(suspendedSet(hidden));
      if (!hidden) {
        // Resuming after a background stretch: reset the frame clock so the
        // first delta is a single frame rather than however long we were away.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        lastFrameRef.current = now;
        guardRef.current?.resetTiming(now);
        controlsRef.current.resetCommitClock(now);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    // `pagehide` covers the iOS/Android case where the app is swiped away
    // without a visibilitychange ever firing.
    window.addEventListener('pagehide', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
    };
  }, [dispatch]);

  // -------------------------------------------------------------------------
  // Scene lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    if (!probeWebGL()) {
      setUnsupported(true);
      dispatch(viewportFailed({ reason: 'WebGL is not available on this device', unsupported: true }));
      return;
    }

    dispatch(viewportInitialising());

    const { tier, reason } = initialTierForDevice();
    const guard = new FpsGuard(tier, reason);
    guardRef.current = guard;

    let scene: AvatarScene;
    try {
      scene = new AvatarScene(canvas, QUALITY_PROFILES[tier]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Renderer failed to start';
      dispatch(viewportFailed({ reason: message }));
      return;
    }
    sceneRef.current = scene;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      sizeRef.current = { width, height };
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      scene.setSize(width, height, dpr);
    };
    resize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    if (!observer && typeof window !== 'undefined') window.addEventListener('resize', resize);

    // --- WebGL context loss ------------------------------------------------
    const onContextLost = (event: Event) => {
      // Without preventDefault the context is gone for good; with it the browser
      // will fire `webglcontextrestored` and we can rebuild.
      event.preventDefault();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setContextLost(true);
      dispatch(contextLostAction());
    };
    const onContextRestored = () => {
      setContextLost(false);
      dispatch(contextRestoredAction());
      // Rebuild from scratch: every GPU object created against the dead context
      // is invalid, so reusing the scene object would render nothing.
      setRebuildToken((token) => token + 1);
    };
    canvas.addEventListener('webglcontextlost', onContextLost as EventListener, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);

    dispatch(viewportReady());
    dispatch(telemetryStreamStarted({ intervalMs: 200 }));

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    lastFrameRef.current = now;
    controlsRef.current.resetCommitClock(now);

    // --- Render loop -------------------------------------------------------
    const loop = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const current = sceneRef.current;
      if (!current || current.isDisposed) return;

      const live = controlsRef.current;
      if (live.suspended) {
        // Keep the loop alive but idle so resuming does not need a remount;
        // no GPU work, no telemetry, no clock advance.
        lastFrameRef.current = timestamp;
        return;
      }

      const deltaMs = Math.max(0, timestamp - lastFrameRef.current);
      lastFrameRef.current = timestamp;
      const dt = deltaMs / 1000;

      guard.frame(deltaMs);

      const clip = clipRef.current;
      const equipment = equipmentRef.current;
      const t = live.advancePlayback(dt);

      const { pose } = sampleClip(clip, t, activationRef.current);
      const skeleton: Skeleton = solvePose(pose, {
        posture: clip.posture,
        supinePelvisY: clip.supinePelvisY,
        armsFollowGravity: clip.armsFollowGravity,
        gripHalfWidth: EQUIPMENT[equipment].gripHalfWidth,
      });
      const bar: Vec3 = barPosition(skeleton, clip.barAnchor, pose.trunkDeg);
      const angles: JointAngles = readJointAngles(skeleton);

      const frame = frameRef.current ?? ({} as SceneFrame);
      frame.skeleton = skeleton;
      frame.activation = activationRef.current;
      frame.trunkDeg = pose.trunkDeg;
      frame.bar = bar;
      frame.pathProgress = t;
      frame.equipment = equipment;
      frame.supine = clip.posture === 'supine';
      frameRef.current = frame;

      current.update(frame, layersRef.current);

      const orbit = live.stepCamera(dt);
      current.setCamera(orbit.azimuth, orbit.polar, orbit.radius, orbit.targetY);
      current.render();

      pushTelemetryFrame(t, pose.phase, angles, activationRef.current, bar.y, timestamp);
      live.commitIfDue(timestamp);

      // Angle chips are written straight to the DOM at 12 Hz. Routing them
      // through React would re-render the panel on every animation frame.
      if (showAngles && timestamp - lastOverlayRef.current > 80) {
        lastOverlayRef.current = timestamp;
        const { width, height } = sizeRef.current;
        const labels = current.projectLabels(skeleton, angles as unknown as Record<string, number>, width, height);
        for (const label of labels) {
          const element = overlayRefs.current.get(label.id);
          if (!element) continue;
          if (!label.visible) {
            element.style.opacity = '0';
            continue;
          }
          element.style.opacity = '1';
          element.style.transform = `translate3d(${Math.round(label.x)}px, ${Math.round(label.y)}px, 0) translate(-50%, -50%)`;
          const value = element.firstElementChild;
          if (value) value.textContent = `${Math.round(label.angle)}°`;
        }
      }

      const decision = guard.evaluate(timestamp);
      if (decision) {
        dispatch(perfSampled(decision));
        if (decision.changed) {
          const { width, height } = sizeRef.current;
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          current.setQuality(QUALITY_PROFILES[decision.tier], width, height, dpr);
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);

    // --- Teardown ----------------------------------------------------------
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      observer?.disconnect();
      if (!observer && typeof window !== 'undefined') window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onContextLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      dispatch(telemetryStreamStopped());
      scene.dispose();
      sceneRef.current = null;
      guardRef.current = null;
    };
    // `rebuildToken` is the context-restore trigger: bumping it tears the scene
    // down and builds a fresh one against the new context.
  }, [dispatch, rebuildToken, showAngles]);

  // -------------------------------------------------------------------------
  // Bar path — recomputed on clip/equipment/quality change, never per frame
  // -------------------------------------------------------------------------

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || scene.isDisposed) return;

    const samples = Math.max(16, controls.quality.barPathSamples);
    const scratch = new Float32Array(MUSCLE_COUNT);
    const barPath: Vec3[] = [];
    // Framing needs every joint across the whole rep, not just the bar: a
    // deadlift's bar never rises above the hip, but the athlete's head does.
    const framingPoints: Vec3[] = [];

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const { pose } = sampleClip(activeClip, t, scratch);
      const skeleton = solvePose(pose, {
        posture: activeClip.posture,
        supinePelvisY: activeClip.supinePelvisY,
        armsFollowGravity: activeClip.armsFollowGravity,
        gripHalfWidth: EQUIPMENT[sessionEquipment].gripHalfWidth,
      });
      const bar = barPosition(skeleton, activeClip.barAnchor, pose.trunkDeg);
      barPath.push(bar);
      framingPoints.push(bar);
      // Sample the extremes rather than all twenty joints: the bounding box is
      // identical and this keeps the pass cheap on a clip change.
      framingPoints.push(skeleton.head, skeleton.toeL, skeleton.toeR, skeleton.kneeR, skeleton.wristR, skeleton.pelvis);
      // Account for part of the bar's width so the plates are not perpetually
      // half off-screen — but not the whole 1.6 m, which would shrink the
      // athlete to nothing on a phone.
      framingPoints.push({ x: bar.x - 0.46, y: bar.y, z: bar.z }, { x: bar.x + 0.46, y: bar.y, z: bar.z });
    }

    scene.setBarPath(barPath);
    scene.setFraming(framingPoints);
  }, [activeClip, sessionEquipment, controls.quality.barPathSamples, rebuildToken]);

  // -------------------------------------------------------------------------
  // Gestures
  // -------------------------------------------------------------------------

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureOriginRef = useRef<{ x: number; y: number; distance: number } | null>(null);

  const pointerDistance = (): number => {
    const points: { x: number; y: number }[] = [];
    pointersRef.current.forEach((point) => points.push(point));
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Claim the gesture. Capture means we keep receiving moves even when the
      // finger leaves the canvas, which is what stops a fast drag from handing
      // the rest of the gesture to the page scroller.
      (event.target as Element).setPointerCapture?.(event.pointerId);
      event.stopPropagation();

      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointersRef.current.size === 1) {
        gestureOriginRef.current = { x: event.clientX, y: event.clientY, distance: 0 };
        controls.beginGesture();
      } else if (pointersRef.current.size === 2 && gestureOriginRef.current) {
        gestureOriginRef.current.distance = pointerDistance();
        controls.beginGesture();
      }
    },
    [controls],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.stopPropagation();

      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const origin = gestureOriginRef.current;
      const container = containerRef.current;
      if (!origin || !container) return;

      const rect = container.getBoundingClientRect();
      const twoFinger = pointersRef.current.size >= 2 && origin.distance > 0;

      controls.applyGesture({
        dx: twoFinger ? 0 : event.clientX - origin.x,
        dy: twoFinger ? 0 : event.clientY - origin.y,
        pinch: twoFinger ? pointerDistance() / origin.distance : undefined,
        width: rect.width,
        height: rect.height,
      });
    },
    [controls],
  );

  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      if (pointersRef.current.size === 0) {
        gestureOriginRef.current = null;
        controls.endGesture();
      }
    },
    [controls],
  );

  // Desktop wheel zoom. Registered natively because React's onWheel is passive
  // and therefore cannot preventDefault the page scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      // The wheel has no begin/end, so it nudges the camera target directly
      // rather than going through the pointer-gesture path.
      event.preventDefault();
      controlsRef.current.zoomBy(event.deltaY > 0 ? 1.08 : 0.93);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const registerOverlay = useCallback((id: string) => (element: HTMLDivElement | null) => {
    if (element) overlayRefs.current.set(id, element);
    else overlayRefs.current.delete(id);
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (unsupported) {
    return (
      <ViewportFallback
        title="3D not supported here"
        body="This device or browser has WebGL turned off, so the 3D model can't render. Every other part of your workout works normally."
      />
    );
  }

  return (
    <div className={cn('relative w-full h-full overflow-hidden rounded-3xl', className)}>
      <div
        ref={containerRef}
        className="absolute inset-0"
        // `touch-action: none` is what actually stops the parent scroller from
        // stealing a vertical drag; pointer capture handles the rest.
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          role="img"
          aria-label={`3D model of a ${activeClip.name}, ${controls.phase} phase. Drag to rotate, pinch to zoom.`}
        />
      </div>

      {/* Joint angle chips — positioned imperatively by the render loop. */}
      {showAngles
        ? MEASURED_JOINTS.map((joint) => (
            <div
              key={joint.id}
              ref={registerOverlay(joint.id)}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-200"
              style={{ willChange: 'transform' }}
            >
              <div className="num text-[11px] font-semibold text-accent-3 bg-bg/80 border border-accent-3/30 rounded-lg px-1.5 py-0.5 leading-none tabular-nums">
                0°
              </div>
              <div className="text-[9px] uppercase tracking-[0.14em] text-text-mute mt-0.5 text-center">
                {joint.label}
              </div>
            </div>
          ))
        : null}

      {/* Camera presets — the non-gesture path to every view. */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={controls.resetCamera}
          aria-label="Reset camera"
          className="w-11 h-11 rounded-xl bg-bg/70 border border-white/[0.08] backdrop-blur-md flex items-center justify-center text-text-dim active:scale-95 transition-transform"
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => controls.setPreset('side')}
          aria-label="Side view"
          className="w-11 h-11 rounded-xl bg-bg/70 border border-white/[0.08] backdrop-blur-md flex items-center justify-center text-text-dim active:scale-95 transition-transform"
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      </div>

      {contextLost ? (
        <div className="absolute inset-0 bg-bg/85 backdrop-blur-sm flex flex-col items-center justify-center gap-2 px-6 text-center">
          <RefreshCw size={20} className="text-accent animate-spin" aria-hidden="true" />
          <p className="text-sm text-white font-medium">Restoring the 3D view…</p>
          <p className="text-xs text-text-dim max-w-[16rem]">
            The graphics context was released by the system. Rebuilding — nothing was lost.
          </p>
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export const BiomechanicsViewport: React.FC<ViewportProps> = (props) => {
  const [resetToken, setResetToken] = useState(0);
  return (
    <ViewportErrorBoundary resetToken={resetToken} onReset={() => setResetToken((token) => token + 1)}>
      {/* Keyed so a retry builds a genuinely fresh canvas and WebGL context
          rather than reviving the one that just failed. */}
      <ViewportCanvas key={resetToken} {...props} />
    </ViewportErrorBoundary>
  );
};

export default BiomechanicsViewport;
