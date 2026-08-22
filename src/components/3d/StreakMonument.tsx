/**
 * Streak monument — a rotating faceted trophy with rising spark particles.
 *
 * The monument earns its weight from the streak itself: the crystal gains
 * facets and the sparks intensify as the run grows, so a 30-day streak visibly
 * outweighs a 3-day one instead of showing the same asset with a different
 * number under it. At a personal best it shifts to gold and the sparks roughly
 * double.
 *
 * Code-split and demand-driven like the rest; falls back to a CSS crystal with
 * the same colour language when WebGL is off or reduced motion is requested.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, Color, Mesh, Points } from 'three';
import { Flame } from 'lucide-react';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

const GOLD = '#FFB800';
const LIME = '#CCFF00';

// ---------------------------------------------------------------------------
// Crystal
// ---------------------------------------------------------------------------

const Crystal: React.FC<{ streak: number; isBest: boolean }> = ({ streak, isBest }) => {
  const mesh = useRef<Mesh>(null);
  const color = useMemo(() => new Color(isBest ? GOLD : LIME), [isBest]);

  // More facets as the streak grows: detail 0 is an octahedron, 2 is dense.
  const detail = streak >= 30 ? 2 : streak >= 10 ? 1 : 0;

  useFrame((state, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.y += delta * 0.55;
    // Slow bob so it reads as floating rather than mounted.
    mesh.current.position.y = Math.sin(state.clock.elapsedTime * 1.1) * 0.08;
  });

  return (
    <mesh ref={mesh}>
      <octahedronGeometry args={[1.05, detail]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={isBest ? 0.8 : 0.62}
        roughness={0.14}
        metalness={0.55}
        flatShading
        toneMapped={false}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Sparks
// ---------------------------------------------------------------------------

/**
 * Embers rising off the monument. Positions are advanced on the CPU and reset
 * to the base once they clear the top, so the effect loops without ever
 * reallocating the buffer.
 */
const Sparks: React.FC<{ count: number; isBest: boolean }> = ({ count, isBest }) => {
  const ref = useRef<Points>(null);
  const MAX = 120;

  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(MAX * 3);
    const spd = new Float32Array(MAX);
    let seed = 0x1f123bb5;
    const rand = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < MAX; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 0.25 + rand() * 0.95;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = -1.1 + rand() * 2.4;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      spd[i] = 0.22 + rand() * 0.5;
    }
    return { positions: pos, speeds: spd };
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const attribute = ref.current.geometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] += speeds[i] * delta;
      if (array[i * 3 + 1] > 1.5) array[i * 3 + 1] = -1.15;
    }
    attribute.needsUpdate = true;
    ref.current.rotation.y += delta * 0.08;
  });

  return (
    <points ref={ref}>
      <bufferGeometry drawRange={{ start: 0, count }}>
        <primitive attach="attributes-position" object={new BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial
        size={0.052}
        color={isBest ? GOLD : LIME}
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
};

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const CssMonument: React.FC<{ isBest: boolean }> = ({ isBest }) => (
  <div className="w-full h-full flex items-center justify-center" aria-hidden="true">
    <div
      className="rotate-45 rounded-[18%]"
      style={{
        width: '46%',
        aspectRatio: '1',
        background: `linear-gradient(135deg, ${isBest ? GOLD : LIME} 0%, ${isBest ? GOLD : LIME}44 100%)`,
        boxShadow: `0 0 52px -8px ${isBest ? GOLD : LIME}`,
      }}
    />
  </div>
);

// ---------------------------------------------------------------------------
// Public
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

export interface StreakMonumentProps {
  streak: number;
  /** Longest streak ever, so a current best can be celebrated honestly. */
  bestStreak?: number;
  className?: string;
}

export const StreakMonument: React.FC<StreakMonumentProps> = ({ streak, bestStreak, className }) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);

  const best = Math.max(bestStreak ?? 0, streak);
  const isBest = streak > 0 && streak >= best;
  const sparks = Math.min(120, 18 + streak * (isBest ? 3.2 : 1.7));

  return (
    <section className={cn('glass-spatial p-5 relative overflow-hidden', className)} aria-labelledby="streak-heading">
      <div className="flex items-center gap-4">
        <div className="w-28 h-28 shrink-0 -my-1">
          {supported && !reduced ? (
            <Canvas
              dpr={[1, 2]}
              camera={{ position: [0, 0, 4] , fov: 45 }}
              gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
              style={{ pointerEvents: 'none' }}
            >
              <ambientLight intensity={0.6} />
              <pointLight position={[2, 3, 3]} intensity={20} />
              <pointLight position={[-2, -1, 2]} intensity={9} color={isBest ? GOLD : LIME} />
              <Crystal streak={streak} isBest={isBest} />
              <Sparks count={Math.round(sparks)} isBest={isBest} />
            </Canvas>
          ) : (
            <CssMonument isBest={isBest} />
          )}
        </div>

        <div className="min-w-0">
          {/* Tokens, not the raw 3D-scene colours: GOLD/LIME are tuned to glow
              against a black canvas and drop to ~1.7:1 on a light card. */}
          <p className="text-eyebrow" style={{ color: isBest ? 'var(--accent-4)' : 'var(--accent)' }}>
            {isBest && streak > 0 ? 'Personal best' : 'Current streak'}
          </p>
          <h2 id="streak-heading" className="font-display text-3xl font-bold text-white tracking-tight mt-0.5 inline-flex items-center gap-2">
            <Flame size={22} style={{ color: isBest ? GOLD : LIME }} aria-hidden="true" />
            <span className="num tabular-nums">{streak}</span>
            <span className="text-lg text-text-dim font-semibold">{streak === 1 ? 'day' : 'days'}</span>
          </h2>
          <p className="text-xs text-text-dim mt-1.5 leading-relaxed">
            {streak === 0
              ? 'Log a session to start a new streak.'
              : isBest
                ? 'This is the longest run you have ever put together.'
                : `Your best is ${best} days — ${Math.max(1, best - streak)} to go.`}
          </p>
        </div>
      </div>
    </section>
  );
};

export default StreakMonument;
