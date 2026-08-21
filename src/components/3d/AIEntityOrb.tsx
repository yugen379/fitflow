/**
 * The AI entity — a geometric orb whose shape and particle density track the
 * conversation state.
 *
 * The states are meant to be legible without a label:
 *   • idle       — slow drift, tight geometry, dim. Waiting.
 *   • listening  — expands and pulses in time with input; particles spread.
 *   • thinking   — fast irregular rotation, geometry tightens, density peaks.
 *   • responding — steady bright pulse synced to the reply cadence.
 *
 * The distortion is done by displacing an icosahedron's vertices along their
 * normals with layered trig, recomputed on the CPU each frame. At 320 vertices
 * that is cheaper than a custom shader pipeline and far easier to reason about.
 *
 * Falls back to a CSS orb — same four states, same colour language — when WebGL
 * is unavailable or reduced motion is requested.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, Color, IcosahedronGeometry, Mesh, Points } from 'three';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

export type EntityState = 'idle' | 'listening' | 'thinking' | 'responding';

interface StateProfile {
  /** Displacement amplitude. */
  amplitude: number;
  /** Trig frequency — higher reads as more agitated. */
  frequency: number;
  /** Rotation speed, radians/sec. */
  spin: number;
  /** Emissive strength. */
  glow: number;
  particles: number;
  color: string;
}

const PROFILES: Record<EntityState, StateProfile> = {
  idle: { amplitude: 0.055, frequency: 1.4, spin: 0.16, glow: 0.42, particles: 26, color: '#00F5FF' },
  listening: { amplitude: 0.16, frequency: 2.1, spin: 0.32, glow: 0.78, particles: 64, color: '#CCFF00' },
  thinking: { amplitude: 0.115, frequency: 4.6, spin: 0.95, glow: 0.66, particles: 92, color: '#FFB800' },
  responding: { amplitude: 0.135, frequency: 2.6, spin: 0.4, glow: 0.92, particles: 76, color: '#CCFF00' },
};

// ---------------------------------------------------------------------------
// Orb
// ---------------------------------------------------------------------------

const Orb: React.FC<{ state: EntityState }> = ({ state }) => {
  const mesh = useRef<Mesh>(null);
  const profile = PROFILES[state];

  // Base geometry kept as the rest pose; the render geometry is displaced from
  // it every frame so distortion never compounds.
  const { geometry, base } = useMemo(() => {
    const geo = new IcosahedronGeometry(1, 4);
    const pos = geo.getAttribute('position') as BufferAttribute;
    return { geometry: geo, base: Float32Array.from(pos.array as Float32Array) };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Eased so a state change morphs rather than snaps.
  const current = useRef({ amplitude: profile.amplitude, frequency: profile.frequency, glow: profile.glow });

  const color = useMemo(() => new Color(profile.color), [profile.color]);

  useFrame((frameState, delta) => {
    const t = frameState.clock.elapsedTime;
    const k = 1 - Math.exp(-delta / 0.28);
    current.current.amplitude += (profile.amplitude - current.current.amplitude) * k;
    current.current.frequency += (profile.frequency - current.current.frequency) * k;
    current.current.glow += (profile.glow - current.current.glow) * k;

    const pos = geometry.getAttribute('position') as BufferAttribute;
    const array = pos.array as Float32Array;
    const { amplitude, frequency } = current.current;

    for (let i = 0; i < array.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const z = base[i + 2];
      // Three layered waves at different frequencies — a single sine reads as a
      // wobbling ball, three read as something alive.
      const displacement =
        1 +
        amplitude *
          (Math.sin(x * frequency + t * 1.6) * 0.5 +
            Math.sin(y * frequency * 1.4 + t * 1.15) * 0.32 +
            Math.sin(z * frequency * 0.85 + t * 2.1) * 0.24);
      array[i] = x * displacement;
      array[i + 1] = y * displacement;
      array[i + 2] = z * displacement;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    if (mesh.current) {
      mesh.current.rotation.y += delta * profile.spin;
      mesh.current.rotation.x += delta * profile.spin * 0.4;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={current.current.glow}
        roughness={0.24}
        metalness={0.1}
        flatShading
        toneMapped={false}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Halo
// ---------------------------------------------------------------------------

const Halo: React.FC<{ state: EntityState }> = ({ state }) => {
  const ref = useRef<Points>(null);
  const profile = PROFILES[state];
  const MAX = 96;

  const positions = useMemo(() => {
    const array = new Float32Array(MAX * 3);
    let seed = 0x5bf03635;
    const rand = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < MAX; i++) {
      // Even-ish spherical shell.
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = 1.4 + rand() * 0.75;
      array[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      array[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
      array[i * 3 + 2] = Math.cos(phi) * r;
    }
    return array;
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y -= delta * 0.14;
    ref.current.rotation.z += delta * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry drawRange={{ start: 0, count: profile.particles }}>
        <primitive attach="attributes-position" object={new BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial
        size={0.045}
        color={profile.color}
        transparent
        opacity={0.72}
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

const CssOrb: React.FC<{ state: EntityState }> = ({ state }) => {
  const profile = PROFILES[state];
  return (
    <div className="w-full h-full flex items-center justify-center" aria-hidden="true">
      <div
        className={cn('rounded-full', state !== 'idle' && 'breathing-glow')}
        style={{
          width: '58%',
          aspectRatio: '1',
          background: `radial-gradient(circle at 35% 30%, ${profile.color} 0%, ${profile.color}55 45%, transparent 72%)`,
          boxShadow: `0 0 46px -6px ${profile.color}`,
        }}
      />
    </div>
  );
};

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

const LABEL: Record<EntityState, string> = {
  idle: 'Coach is ready',
  listening: 'Coach is listening',
  thinking: 'Coach is thinking',
  responding: 'Coach is responding',
};

export const AIEntityOrb: React.FC<{ state?: EntityState; className?: string }> = ({
  state = 'idle',
  className,
}) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);

  return (
    <div className={cn('relative aspect-square w-full', className)}>
      {supported && !reduced ? (
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 3.5], fov: 45 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ pointerEvents: 'none' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[2, 2, 3]} intensity={16} />
          <pointLight position={[-2, -1, 2]} intensity={8} color={PROFILES[state].color} />
          <Orb state={state} />
          <Halo state={state} />
        </Canvas>
      ) : (
        <CssOrb state={state} />
      )}
      <p className="sr-only" aria-live="polite">
        {LABEL[state]}
      </p>
    </div>
  );
};

export default AIEntityOrb;
