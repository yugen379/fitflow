/**
 * 3D weekly step columns.
 *
 * Seven extruded bars that rise into place, with a goal threshold plane cutting
 * across them — so "which days did I actually hit it" is answerable at a glance
 * instead of by reading seven numbers.
 *
 * Bars above goal take the lime gradient; bars below stay aqua. That is a
 * second channel on top of height, which matters because height alone is hard
 * to judge against a line in perspective.
 *
 * Same rules as every other 3D surface here: code-split, `frameloop="demand"`
 * once the rise animation settles, and an SVG fallback carrying identical data.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Mesh } from 'three';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

export interface DayBar {
  /** "Sun", "Mon", … */
  label: string;
  steps: number;
  /** Marks today, which gets a brighter treatment. */
  isToday?: boolean;
}

const LIME = '#CCFF00';
const AQUA = '#00F5FF';
const MAX_HEIGHT = 2.6;
const BAR_WIDTH = 0.42;
const SPACING = 0.62;

const Bar: React.FC<{
  bar: DayBar;
  index: number;
  max: number;
  goal: number;
  animate: boolean;
}> = ({ bar, index, max, goal, animate }) => {
  const mesh = useRef<Mesh>(null);
  const height = useRef(0);
  const { invalidate } = useThree();

  const target = max > 0 ? Math.max(0.02, (bar.steps / max) * MAX_HEIGHT) : 0.02;
  const hitGoal = bar.steps >= goal;
  const color = useMemo(() => new Color(hitGoal ? LIME : AQUA), [hitGoal]);
  const x = (index - 3) * SPACING;

  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (!animate) {
      mesh.current.scale.y = target;
      mesh.current.position.y = target / 2;
      return;
    }
    const diff = target - height.current;
    if (Math.abs(diff) < 0.002) return;
    // Staggered rise: later bars start slightly behind, so the week reads
    // left-to-right rather than all popping at once.
    height.current += diff * (1 - Math.exp(-delta / (0.24 + index * 0.03)));
    mesh.current.scale.y = height.current;
    mesh.current.position.y = height.current / 2;
    invalidate();
  });

  return (
    <mesh ref={mesh} position={[x, 0, 0]}>
      <boxGeometry args={[BAR_WIDTH, 1, BAR_WIDTH]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={bar.isToday ? 0.55 : 0.3}
        roughness={0.25}
        metalness={0.2}
        toneMapped={false}
      />
    </mesh>
  );
};

/** The 10k line, drawn as a thin translucent plane through the bars. */
const GoalPlane: React.FC<{ goal: number; max: number }> = ({ goal, max }) => {
  if (max <= 0) return null;
  const y = Math.min(MAX_HEIGHT, (goal / max) * MAX_HEIGHT);
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[4.5, 0.02]} />
      <meshBasicMaterial color="#FFD700" transparent opacity={0.55} toneMapped={false} />
    </mesh>
  );
};

const Scene: React.FC<{ bars: DayBar[]; goal: number; animate: boolean }> = ({ bars, goal, animate }) => {
  const max = Math.max(goal, ...bars.map((b) => b.steps), 1);
  return (
    <>
      <ambientLight intensity={0.72} />
      <pointLight position={[3, 5, 4]} intensity={30} />
      <pointLight position={[-3, 2, 3]} intensity={12} color={AQUA} />
      {bars.map((bar, index) => (
        <Bar key={bar.label} bar={bar} index={index} max={max} goal={goal} animate={animate} />
      ))}
      <GoalPlane goal={goal} max={max} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const FlatBars: React.FC<{ bars: DayBar[]; goal: number }> = ({ bars, goal }) => {
  const max = Math.max(goal, ...bars.map((b) => b.steps), 1);
  return (
    <div className="flex items-end justify-between h-full gap-1.5 px-1 pb-1">
      {bars.map((bar) => {
        const ratio = bar.steps / max;
        const hit = bar.steps >= goal;
        return (
          <div key={bar.label} className="flex-1 flex flex-col justify-end h-full">
            <div
              className="w-full rounded-t-md"
              style={{
                height: `${Math.max(2, ratio * 100)}%`,
                background: hit ? LIME : AQUA,
                boxShadow: `0 0 14px -4px ${hit ? LIME : AQUA}`,
              }}
            />
          </div>
        );
      })}
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

export const StepBars3D: React.FC<{ bars: DayBar[]; goal: number; className?: string }> = ({
  bars,
  goal,
  className,
}) => {
  const reduced = prefersReducedMotion();
  const [supported] = useState(hasWebGL);

  return (
    <div className={cn('relative w-full', className)}>
      <div className="h-44">
        {supported && !reduced ? (
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [0, 1.9, 5.4], fov: 38 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            style={{ pointerEvents: 'none' }}
            onCreated={({ invalidate }) => invalidate()}
          >
            <Scene bars={bars} goal={goal} animate={!reduced} />
          </Canvas>
        ) : (
          <FlatBars bars={bars} goal={goal} />
        )}
      </div>

      {/* Labels and values live in the DOM: crisp at any density, selectable,
          and readable by a screen reader without describing geometry. */}
      <div className="grid grid-cols-7 gap-1 mt-2">
        {bars.map((bar) => (
          <div key={bar.label} className="text-center min-w-0">
            <p
              className={cn(
                'num text-[10px] tabular-nums truncate',
                bar.steps >= goal ? 'text-accent' : 'text-text-dim',
              )}
            >
              {bar.steps >= 1000 ? `${(bar.steps / 1000).toFixed(1)}k` : bar.steps}
            </p>
            <p className={cn('text-[10px] mt-0.5', bar.isToday ? 'text-white font-semibold' : 'text-text-mute')}>
              {bar.label}
            </p>
          </div>
        ))}
      </div>

      <p className="sr-only">
        {bars.map((b) => `${b.label}: ${b.steps} steps`).join('. ')}. Goal {goal} steps.
      </p>
    </div>
  );
};

export default StepBars3D;
