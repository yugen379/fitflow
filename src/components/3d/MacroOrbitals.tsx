/**
 * Macro orbitals — Protein · Carbs · Fat as floating liquid spheres.
 *
 * Each sphere is a glass shell with a fill level inside it: the liquid rises as
 * the day's intake approaches the target, so a glance tells you which macro is
 * behind without reading a number. Logging a meal makes the affected sphere
 * bounce and ripple, which is the whole point — the feedback is spatial, not a
 * toast.
 *
 * Same discipline as the other 3D here: code-split, `frameloop="demand"` once
 * settled, an SVG fallback with identical data when WebGL is unavailable or the
 * user asked for reduced motion, and it stops rendering when scrolled away.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Mesh } from 'three';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

export interface MacroDatum {
  id: 'protein' | 'carbs' | 'fat';
  label: string;
  grams: number;
  targetG: number;
  color: string;
}

interface OrbProps {
  datum: MacroDatum;
  index: number;
  animate: boolean;
  /** Bumped when this macro changes, to trigger the bounce. */
  pulseKey: number;
}

const SPACING = 1.55;

/**
 * One orbital.
 *
 * The fill is a solid inner sphere scaled to the intake ratio rather than a
 * clipped volume — cheaper than a real liquid shader by an order of magnitude,
 * and at this size visually indistinguishable once the glass shell refracts it.
 */
const Orb: React.FC<OrbProps> = ({ datum, index, animate, pulseKey }) => {
  const shell = useRef<Mesh>(null);
  const fill = useRef<Mesh>(null);
  const bounce = useRef(0);
  const shown = useRef(0);
  const { invalidate } = useThree();

  const color = useMemo(() => new Color(datum.color), [datum.color]);
  const ratio = datum.targetG > 0 ? Math.max(0, Math.min(1, datum.grams / datum.targetG)) : 0;
  const x = (index - 1) * SPACING;

  // A new log kicks the sphere; the spring below settles it.
  useEffect(() => {
    if (!animate) return;
    bounce.current = 1;
    invalidate();
  }, [pulseKey, animate, invalidate]);

  useFrame((state, delta) => {
    if (!animate) return;
    let dirty = false;

    // Fill level eases toward the real ratio.
    const diff = ratio - shown.current;
    if (Math.abs(diff) > 0.001) {
      shown.current += diff * (1 - Math.exp(-delta / 0.3));
      dirty = true;
    } else if (shown.current !== ratio) {
      shown.current = ratio;
      dirty = true;
    }
    if (fill.current) {
      // Never fully vanish: an empty macro still reads as a sphere with a floor.
      const s = 0.24 + shown.current * 0.72;
      fill.current.scale.setScalar(s);
    }

    // Elastic bounce decay.
    if (bounce.current > 0.001) {
      bounce.current *= Math.exp(-delta / 0.26);
      dirty = true;
    }
    const kick = Math.sin(bounce.current * Math.PI * 3) * bounce.current * 0.22;

    if (shell.current) {
      // Slow bob, offset per orb so they never move in lockstep.
      const bob = Math.sin(state.clock.elapsedTime * 0.85 + index * 1.9) * 0.07;
      shell.current.position.set(x, bob + kick, 0);
      shell.current.rotation.y += delta * 0.25;
      dirty = true;
    }
    if (fill.current) fill.current.position.set(x, (shell.current?.position.y ?? 0), 0);

    if (dirty) invalidate();
  });

  return (
    <group>
      {/* Liquid core */}
      <mesh ref={fill} position={[x, 0, 0]}>
        <sphereGeometry args={[0.52, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.85}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* Glass shell */}
      <mesh ref={shell} position={[x, 0, 0]}>
        <sphereGeometry args={[0.56, 28, 28]} />
        <meshPhysicalMaterial
          color="#0E1422"
          roughness={0.08}
          metalness={0.1}
          transparent
          opacity={0.16}
          transmission={0}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
    </group>
  );
};

const Scene: React.FC<{ macros: MacroDatum[]; animate: boolean; pulseKeys: number[] }> = ({
  macros,
  animate,
  pulseKeys,
}) => (
  <>
    <ambientLight intensity={0.7} />
    <pointLight position={[2.5, 3, 4]} intensity={22} />
    <pointLight position={[-3, -1.5, 2]} intensity={11} color="#00F5FF" />
    {macros.map((datum, index) => (
      <Orb key={datum.id} datum={datum} index={index} animate={animate} pulseKey={pulseKeys[index] ?? 0} />
    ))}
  </>
);

// ---------------------------------------------------------------------------
// Flat fallback
// ---------------------------------------------------------------------------

const FlatOrbs: React.FC<{ macros: MacroDatum[] }> = ({ macros }) => (
  <div className="flex items-end justify-around h-full px-2 pb-3">
    {macros.map((m) => {
      const ratio = m.targetG > 0 ? Math.max(0, Math.min(1, m.grams / m.targetG)) : 0;
      return (
        <div key={m.id} className="flex flex-col items-center gap-2">
          <div
            className="rounded-full border"
            style={{
              width: 56,
              height: 56,
              borderColor: `${m.color}55`,
              background: `radial-gradient(circle at 50% ${100 - ratio * 70}%, ${m.color} 0%, ${m.color}22 ${Math.max(12, ratio * 78)}%, transparent 80%)`,
            }}
          />
        </div>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

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

export const MacroOrbitals: React.FC<{ macros: MacroDatum[]; className?: string }> = ({
  macros,
  className,
}) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);
  const [visible, setVisible] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);

  // A change in grams bumps that orb's key, which triggers the bounce.
  const pulseKeys = useMemo(() => macros.map((m) => Math.round(m.grams)), [macros]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '100px',
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const animate = visible && !reduced;

  return (
    <div ref={hostRef} className={cn('relative w-full h-32', className)}>
      {supported && !reduced ? (
        <Canvas
          frameloop={animate ? 'always' : 'demand'}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 4.4], fov: 40 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ pointerEvents: 'none' }}
        >
          <Scene macros={macros} animate={animate} pulseKeys={pulseKeys} />
        </Canvas>
      ) : (
        <FlatOrbs macros={macros} />
      )}

      <p className="sr-only">
        {macros.map((m) => `${m.label}: ${Math.round(m.grams)} of ${Math.round(m.targetG)} grams`).join('. ')}
      </p>
    </div>
  );
};

export default MacroOrbitals;
