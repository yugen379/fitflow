/**
 * 3D step dial.
 *
 * A real torus in a real scene — `three` 0.170 and `@react-three/fiber` 9 are
 * already dependencies (the Biomechanics Lab and `StepBars3D` use them), so
 * nothing new is pulled in for this.
 *
 * ## How progress is drawn
 *
 * The fifth argument to `torusGeometry` is the arc angle, so the progress ring
 * is a torus built with `arc = ratio * 2PI` — genuinely a partial ring, not a
 * full one faked with opacity or scale. The mesh is then rotated by
 * `PI/2 - arc` on Z, which lands the arc's span exactly on the wedge running
 * clockwise from twelve o'clock. Both rings sit in the XY plane so they face
 * the camera; rotating them onto their side turns the dial into an edge-on
 * ellipse, which is not a dial.
 *
 * Geometry is rebuilt only when the eased ratio crosses one of ARC_STEPS
 * buckets, so a smooth sweep costs a bounded number of rebuilds instead of one
 * allocation per frame on the render hot path.
 *
 * It follows the same three house rules as every other 3D surface here:
 *   • code-split at the call site, so three.js never lands in the boot chunk;
 *   • `frameloop="demand"` — it renders when something actually changes, not
 *     at 60fps forever behind a static number;
 *   • a CSS-only fallback carrying identical information, for no-WebGL and for
 *     `prefers-reduced-motion`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Group, MathUtils } from 'three';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

const LIME = '#CCFF00';
const AQUA = '#00F5FF';

/** Unfilled remainder of the goal, per theme. Solid hex only — see below. */
const DARK_TRACK = '#1B2233';
const LIGHT_TRACK = '#C9CFDA';

/** Buckets the sweep is quantised into. 90 is smooth at this size. */
const ARC_STEPS = 90;
const TAU = Math.PI * 2;

const clamp01 = (value: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

interface RingProps {
  ratio: number;
  tilt: { x: number; y: number };
  animate: boolean;
  /** Unfilled remainder, which has to invert with the theme. */
  trackColor: string;
}

const Ring: React.FC<RingProps> = ({ ratio, tilt, animate, trackColor }) => {
  const group = useRef<Group>(null);
  const eased = useRef(animate ? 0 : clamp01(ratio));
  const [bucket, setBucket] = useState(() => Math.round(clamp01(ratio) * ARC_STEPS));
  const { invalidate } = useThree();

  const target = clamp01(ratio);
  const hitGoal = target >= 1;
  const color = useMemo(() => new Color(hitGoal ? LIME : AQUA), [hitGoal]);

  // A new target has to wake the demand-driven loop, or the sweep never starts.
  useEffect(() => {
    invalidate();
  }, [target, invalidate]);

  useFrame((_, delta) => {
    let dirty = false;

    if (animate && Math.abs(target - eased.current) > 0.0005) {
      eased.current = MathUtils.damp(eased.current, target, 6, delta);
      dirty = true;
    } else if (!animate) {
      eased.current = target;
    }

    const nextBucket = Math.round(eased.current * ARC_STEPS);
    if (nextBucket !== bucket) setBucket(nextBucket);

    if (group.current) {
      const rx = MathUtils.damp(group.current.rotation.x, -tilt.y * 0.3, 8, delta);
      const ry = MathUtils.damp(group.current.rotation.y, tilt.x * 0.3, 8, delta);
      if (
        Math.abs(rx - group.current.rotation.x) > 0.0004 ||
        Math.abs(ry - group.current.rotation.y) > 0.0004
      ) {
        dirty = true;
      }
      group.current.rotation.x = rx;
      group.current.rotation.y = ry;
    }

    if (dirty) invalidate();
  });

  const swept = bucket / ARC_STEPS;
  const arc = Math.max(0.0001, swept * TAU);

  return (
    <group ref={group}>
      <ambientLight intensity={0.75} />
      <pointLight position={[2.5, 3, 5]} intensity={22} color={hitGoal ? LIME : '#ffffff'} />

      {/* Track: the whole goal, as an unfilled ring. */}
      <mesh>
        <torusGeometry args={[1.2, 0.085, 14, 80]} />
        <meshStandardMaterial color={trackColor} roughness={0.9} metalness={0.05} />
      </mesh>

      {/* Progress: a genuine partial torus, seated at twelve o'clock. */}
      {swept > 0.004 ? (
        <mesh rotation={[0, 0, Math.PI / 2 - arc]}>
          <torusGeometry args={[1.2, 0.115, 18, 80, arc]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={hitGoal ? 1.4 : 0.7}
            roughness={0.28}
            metalness={0.45}
          />
        </mesh>
      ) : null}
    </group>
  );
};

const hasWebGL = (): boolean => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/** CSS conic ring carrying the same number, for no-WebGL and reduced motion. */
const FlatDial: React.FC<{ ratio: number; trackColor: string }> = ({ ratio, trackColor }) => {
  const pct = clamp01(ratio) * 100;
  const hit = ratio >= 1;
  return (
    <div
      className="w-full h-full rounded-full"
      style={{
        background: `conic-gradient(${hit ? LIME : AQUA} ${pct}%, ${trackColor} ${pct}%)`,
        // Punches the centre out, so it reads as a ring rather than a pie.
        mask: 'radial-gradient(circle, transparent 58%, #000 60%)',
        WebkitMask: 'radial-gradient(circle, transparent 58%, #000 60%)',
      }}
    />
  );
};

export const StepDial: React.FC<{
  ratio: number;
  tilt?: { x: number; y: number };
  className?: string;
}> = ({ ratio, tilt = { x: 0, y: 0 }, className }) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);

  // Read straight off the attribute the theme provider sets, rather than
  // subscribing: the dial re-renders on tilt anyway, and a dark track on a
  // light card is the one thing that would look broken.
  //
  // Solid hex, NOT rgba(): three.Color cannot parse an alpha channel and
  // silently resolves the whole string to black, which is exactly how this
  // shipped a black ring onto a white card the first time round. The material
  // is opaque anyway, so the alpha would have done nothing.
  const [track, setTrack] = useState(DARK_TRACK);
  useEffect(() => {
    const read = () =>
      setTrack(
        document.documentElement.getAttribute('data-theme') === 'light' ? LIGHT_TRACK : DARK_TRACK,
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn('relative', className)} aria-hidden="true">
      {supported && !reduced ? (
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ position: [0, 0, 4.1], fov: 40 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ pointerEvents: 'none' }}
          onCreated={({ invalidate }) => invalidate()}
        >
          <Ring ratio={ratio} tilt={tilt} animate={!reduced} trackColor={track} />
        </Canvas>
      ) : (
        <FlatDial ratio={ratio} trackColor={track} />
      )}
    </div>
  );
};

export default StepDial;
