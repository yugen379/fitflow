/**
 * Interactive 3D anatomy with a live muscle-activation heatmap.
 *
 * This is deliberately a thin adapter, not a new engine. FitFlow already has a
 * full biomechanics renderer in `src/biomechanics/` — a forward-kinematics rig
 * with anatomically solved keyframes for five lifts, a 16-region muscle
 * heatmap driven by a GPU lookup texture, orbit/pinch gesture isolation,
 * exhaustive WebGL disposal and a frame-rate guardrail. It is verified by 142
 * deterministic assertions plus 13 real-WebGL ones.
 *
 * Building a second, weaker anatomy model next to it would mean two rigs to
 * keep correct and two things to break. So this wraps the good one and gives it
 * the ergonomic surface the rest of the spatial UI wants: pass an exercise, get
 * a rotatable body with the working muscles lit.
 *
 * The Redux Provider is mounted here because the store is a module-level
 * singleton — mounting it around a subtree costs nothing and keeps ~30 kB of
 * RTK off the boot path for every screen that does not show anatomy.
 */

import React, { Suspense, lazy } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { cn } from '../../lib/utils';
import { store } from '../../biomechanics/store';
import { EXERCISE_TO_CLIP, getClipOrDefault } from '../../biomechanics/motions';

const BiomechanicsViewport = lazy(() =>
  import('../../biomechanics/BiomechanicsViewport').then((m) => ({ default: m.BiomechanicsViewport })),
);

interface AnatomyViewerProps {
  /**
   * Exercise id from `src/data/exerciseLibrary.json` (e.g. `bench_press`).
   * Anything without a 3D clip falls back to the closest movement pattern
   * rather than rendering an unrelated lift.
   */
  exerciseId?: string | null;
  className?: string;
  /** Hides the floating joint-angle chips in compact cards. */
  showAngles?: boolean;
}

/** Liquid placeholder while the 3D chunk arrives. */
const AnatomySkeleton: React.FC = () => (
  <div className="w-full h-full liquid-skeleton rounded-[28px] flex items-center justify-center">
    <span className="sr-only">Loading 3D anatomy</span>
  </div>
);

export const AnatomyViewer: React.FC<AnatomyViewerProps> = ({
  exerciseId,
  className,
  showAngles = true,
}) => {
  // Resolve through the library map first, then let the engine's own fallback
  // handle anything unmapped.
  const clipId = exerciseId ? (EXERCISE_TO_CLIP[exerciseId] ?? exerciseId) : null;
  const clip = getClipOrDefault(clipId);

  return (
    <ReduxProvider store={store}>
      <div className={cn('relative w-full h-full', className)}>
        <Suspense fallback={<AnatomySkeleton />}>
          <BiomechanicsViewport clipId={clip.id} showAngles={showAngles} />
        </Suspense>
      </div>
    </ReduxProvider>
  );
};

export default AnatomyViewer;
