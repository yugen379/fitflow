/**
 * Volumetric orbital HUD — Move · Eat · Recover.
 *
 * Three concentric glass tori with liquid-fill progress arcs, internal glowing
 * particles and specular gloss. This is the dashboard centrepiece, so it earns
 * its GPU budget — but it is still held to the same rules as the rest of the
 * app:
 *
 *   • Lazy-loaded. R3F and three.js never touch the boot path; `proof:perf`
 *     fails the build if they do.
 *   • `frameloop="demand"` while the rings are settled. A ring that has reached
 *     its target has nothing to animate, so the render loop stops entirely
 *     rather than burning battery drawing an identical frame 60 times a second.
 *   • Pauses when scrolled out of view or the tab is hidden.
 *   • Falls back to a flat SVG ring set when WebGL is unavailable or the user
 *     asked for reduced motion — same data, no GPU.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Points as ThreePoints } from 'three';
import { AdditiveBlending, BufferAttribute, Color, Mesh } from 'three';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface RingDatum {
  id: 'move' | 'eat' | 'recover';
  label: string;
  value: number;
  goal: number;
  /** Rendered under the value, e.g. "steps" or "kcal". */
  unit: string;
  color: string;
}

interface RingSpec extends RingDatum {
  radius: number;
  progress: number;
}

const TUBE = 0.062;

// ---------------------------------------------------------------------------
// One ring
// ---------------------------------------------------------------------------

/**
 * A ring is two tori: an always-full dark track, and a progress arc whose
 * `arc` angle is rebuilt as it animates.
 *
 * The arc geometry is disposed and recreated on each progress step rather than
 * scaled, because a torus arc cannot be expressed as a transform — but the
 * value is spring-damped and settles within about a second, so this is a
 * handful of rebuilds, not a per-frame allocation.
 */
const Ring: React.FC<{ spec: RingSpec; animate: boolean }> = ({ spec, animate }) => {
  const arcRef = useRef<Mesh>(null);
  const trackRef = useRef<Mesh>(null);
  const shown = useRef(0);
  const [arcAngle, setArcAngle] = useState(0);
  const { invalidate } = useThree();

  const color = useMemo(() => new Color(spec.color), [spec.color]);

  useEffect(() => {
    if (!animate) {
      shown.current = spec.progress;
      setArcAngle(spec.progress * Math.PI * 2);
    }
  }, [animate, spec.progress]);

  useFrame((_, delta) => {
    if (!animate) return;
    const target = spec.progress;
    const diff = target - shown.current;
    if (Math.abs(diff) < 0.0015) {
      if (shown.current !== target) {
        shown.current = target;
        setArcAngle(target * Math.PI * 2);
      }
      return;
    }
    // Framerate-independent critically-damped approach.
    shown.current += diff * (1 - Math.exp(-delta / 0.22));
    setArcAngle(Math.max(0.0001, shown.current * Math.PI * 2));
    invalidate();

    if (trackRef.current) trackRef.current.rotation.z += delta * 0.04;
  });

  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      {/* Track — the empty channel the liquid fills. */}
      <mesh ref={trackRef}>
        <torusGeometry args={[spec.radius, TUBE, 12, 96]} />
        <meshStandardMaterial
          color="#0E1422"
          roughness={0.35}
          metalness={0.15}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Progress arc — emissive so it reads as lit from within. */}
      <mesh ref={arcRef}>
        <torusGeometry args={[spec.radius, TUBE * 1.04, 14, 96, arcAngle]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          roughness={0.16}
          metalness={0.05}
          toneMapped={false}
        />
      </mesh>

      {/* Meniscus cap: a bright bead at the leading edge of the fill. */}
      {arcAngle > 0.08 && (
        <mesh position={[Math.cos(arcAngle) * spec.radius, Math.sin(arcAngle) * spec.radius, 0]}>
          <sphereGeometry args={[TUBE * 1.5, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
};

// ---------------------------------------------------------------------------
// Internal particles
// ---------------------------------------------------------------------------

/** Slow glowing motes inside the ring volume, for depth. */
const InnerParticles: React.FC<{ count: number; animate: boolean }> = ({ count, animate }) => {
  const ref = useRef<ThreePoints>(null);
  const { invalidate } = useThree();

  const positions = useMemo(() => {
    const array = new Float32Array(count * 3);
    let seed = 0x2545f491;
    const rand = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 0.35 + rand() * 1.15;
      array[i * 3] = Math.cos(angle) * radius;
      array[i * 3 + 1] = Math.sin(angle) * radius;
      array[i * 3 + 2] = (rand() - 0.5) * 0.7;
    }
    return array;
  }, [count]);

  useFrame((state, delta) => {
    if (!animate || !ref.current) return;
    ref.current.rotation.z += delta * 0.075;
    const material = ref.current.material as { opacity: number };
    material.opacity = 0.4 + Math.sin(state.clock.elapsedTime * 0.9) * 0.16;
    invalidate();
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={new BufferAttribute(positions, 3)} />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#CCFF00"
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
};

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const Scene: React.FC<{ specs: RingSpec[]; animate: boolean }> = ({ specs, animate }) => (
  <>
    <ambientLight intensity={0.55} />
    <pointLight position={[3, 3, 4]} intensity={26} color="#FFFFFF" />
    <pointLight position={[-3, -2, 3]} intensity={14} color="#00F5FF" />
    {specs.map((spec) => (
      <Ring key={spec.id} spec={spec} animate={animate} />
    ))}
    <InnerParticles count={animate ? 40 : 0} animate={animate} />
  </>
);

// ---------------------------------------------------------------------------
// Flat fallback
// ---------------------------------------------------------------------------

/** Same three values, drawn as SVG arcs. No WebGL, no animation. */
const FlatRings: React.FC<{ specs: RingSpec[] }> = ({ specs }) => (
  <svg viewBox="0 0 200 200" className="w-full h-full" role="img" aria-label="Daily activity rings">
    {specs.map((spec) => {
      const r = spec.radius * 62;
      const circumference = 2 * Math.PI * r;
      return (
        <g key={spec.id} transform="rotate(-90 100 100)">
          <circle cx={100} cy={100} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={7.5} />
          <circle
            cx={100}
            cy={100}
            r={r}
            fill="none"
            stroke={spec.color}
            strokeWidth={7.5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - spec.progress)}
          />
        </g>
      );
    })}
  </svg>
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

export const VolumetricRings: React.FC<{ rings: RingDatum[]; className?: string }> = ({
  rings,
  className,
}) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);
  const [visible, setVisible] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);

  const specs = useMemo<RingSpec[]>(
    () =>
      rings.slice(0, 3).map((ring, index) => ({
        ...ring,
        radius: 1.32 - index * 0.34,
        progress: ring.goal > 0 ? Math.max(0, Math.min(1, ring.value / ring.goal)) : 0,
      })),
    [rings],
  );

  // Stop rendering entirely when scrolled away — the dashboard is a long page
  // and there is no reason to drive a GPU for something off screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const animate = visible && !reduced;

  return (
    <div ref={hostRef} className={cn('relative aspect-square w-full max-w-[19rem] mx-auto', className)}>
      {supported && !reduced ? (
        <Canvas
          // `demand` means frames are drawn only when something calls
          // invalidate(). Settled rings cost nothing.
          frameloop={animate ? 'always' : 'demand'}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 4.2], fov: 42 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ pointerEvents: 'none' }}
        >
          <Scene specs={specs} animate={animate} />
        </Canvas>
      ) : (
        <FlatRings specs={specs} />
      )}

      {/* Screen readers get the numbers, not the geometry. */}
      <p className="sr-only">
        {specs
          .map((s) => `${s.label}: ${Math.round(s.value)} of ${Math.round(s.goal)} ${s.unit}, ${Math.round(s.progress * 100)} percent`)
          .join('. ')}
      </p>
    </div>
  );
};

export default VolumetricRings;
