/**
 * Browser-side harness for `npm run screens:motions` — renders one library
 * exercise's generated demo at a chosen point of the rep, exactly as the
 * viewport does (same solver options, framing, props, equipment), so the
 * result can be eyeballed. Bundled by scripts/exercise-screens.mjs; not part
 * of the app bundle.
 */

import { AvatarScene } from '../src/biomechanics/avatarScene';
import { effectiveTrunkDeg, getExerciseClip, resolveEquipment, sampleClip, solveOptionsFor } from '../src/biomechanics/motions';
import { barPosition, solvePose } from '../src/biomechanics/rig';
import { QUALITY_PROFILES } from '../src/biomechanics/viewportSlice';
import { MUSCLE_COUNT } from '../src/biomechanics/types';
import type { SceneFrame } from '../src/biomechanics/avatarScene';
import type { Skeleton, Vec3 } from '../src/biomechanics/types';

const W = 520;
const H = 640;
const canvas = document.createElement('canvas');
canvas.width = W;
canvas.height = H;
document.body.appendChild(canvas);
const scene = new AvatarScene(canvas, QUALITY_PROFILES.high);
scene.setSize(W, H, 1);

const LAYERS = { heatmap: true, jointVectors: false, barPath: false, skeleton: false, equipment: true };

(window as unknown as { renderExercise: (id: string, t: number, azimuth: number) => string }).renderExercise = (id, t, azimuth) => {
  const clip = getExerciseClip(id);
  if (!clip) return 'no clip';
  const equipment = resolveEquipment(clip, clip.equipment[0]);
  const opts = solveOptionsFor(clip, equipment);
  const framing: Vec3[] = [];
  const path: Vec3[] = [];
  for (let i = 0; i <= 48; i++) {
    const { pose } = sampleClip(clip, i / 48);
    const s = solvePose(pose, opts);
    for (const k of Object.keys(s) as (keyof Skeleton)[]) framing.push(s[k]);
    path.push(barPosition(s, clip.barAnchor, effectiveTrunkDeg(pose)));
  }
  for (const prop of clip.props ?? []) if (prop.sy <= 1.5) framing.push({ x: prop.x, y: prop.y + prop.sy / 2, z: prop.z });
  scene.setFraming(framing);
  scene.setBarPath(path);
  const activation = new Float32Array(MUSCLE_COUNT);
  const { pose } = sampleClip(clip, t, activation);
  const skeleton = solvePose(pose, opts);
  const trunkDeg = effectiveTrunkDeg(pose);
  const frame: SceneFrame = {
    skeleton,
    activation,
    trunkDeg,
    bar: barPosition(skeleton, clip.barAnchor, trunkDeg),
    supine: clip.posture === 'supine',
    pathProgress: t,
    equipment,
    props: clip.props ?? null,
    cableAnchor: clip.cableAnchor ?? null,
  };
  scene.update(frame, LAYERS);
  scene.setCamera(azimuth, Math.PI / 2 - 0.12, 1, 0);
  scene.render();
  return 'ok';
};

(window as unknown as { harnessReady: boolean }).harnessReady = true;
