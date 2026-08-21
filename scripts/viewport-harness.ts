/**
 * Browser-side harness for `npm run proof:viewport`.
 *
 * The Node proof covers everything deterministic; this covers the half that
 * only a real GL context can answer — does the shader compile, does the scene
 * actually draw pixels, and does `dispose()` genuinely release the context.
 *
 * It is bundled by the proof script and loaded in headless Chromium; it is not
 * part of the app bundle.
 */

import { AvatarScene } from '../src/biomechanics/avatarScene';
import { getClip, sampleClip, EQUIPMENT } from '../src/biomechanics/motions';
import { barPosition, readJointAngles, solvePose } from '../src/biomechanics/rig';
import { QUALITY_PROFILES } from '../src/biomechanics/viewportSlice';
import { MUSCLE_COUNT } from '../src/biomechanics/types';
import type { SceneFrame } from '../src/biomechanics/avatarScene';
import type { Vec3 } from '../src/biomechanics/types';

interface HarnessResult {
  ok: boolean;
  steps: { name: string; ok: boolean; detail?: string }[];
}

const result: HarnessResult = { ok: true, steps: [] };
const step = (name: string, ok: boolean, detail?: string) => {
  result.steps.push({ name, ok, detail });
  if (!ok) result.ok = false;
};

const LAYERS = { heatmap: true, jointVectors: true, barPath: true, skeleton: true, equipment: true };

const run = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 640;
  document.body.appendChild(canvas);

  let scene: AvatarScene | null = null;
  try {
    scene = new AvatarScene(canvas, QUALITY_PROFILES.high);
    step('scene constructs against a real WebGL context', true);
  } catch (error) {
    step('scene constructs against a real WebGL context', false, String(error));
    return result;
  }

  const gl = scene.renderer.getContext();
  step('a GL context is live', !!gl && !gl.isContextLost());

  scene.setSize(480, 640, 1);
  scene.setCamera(-0.62, Math.PI / 2 - 0.16, 1, 0);

  // Drive every clip through a full rep at every quality tier. A shader that
  // only fails on one geometry variant is exactly the bug this catches.
  const activation = new Float32Array(MUSCLE_COUNT);
  const clipIds = ['squats', 'bench_press', 'deadlift', 'shoulder_press', 'cable_row'];
  let frames = 0;

  try {
    for (const tier of ['high', 'balanced', 'low'] as const) {
      scene.setQuality(QUALITY_PROFILES[tier], 480, 640, 1);
      for (const clipId of clipIds) {
        const clip = getClip(clipId)!;
        // Bar path upload happens once per clip, exactly as the component does.
        const path: Vec3[] = [];
        const framing: Vec3[] = [];
        for (let i = 0; i <= 48; i++) {
          const { pose } = sampleClip(clip, i / 48, activation);
          const skeleton = solvePose(pose, {
            posture: clip.posture,
            supinePelvisY: clip.supinePelvisY,
            armsFollowGravity: clip.armsFollowGravity,
            gripHalfWidth: EQUIPMENT.barbell.gripHalfWidth,
          });
          const bar = barPosition(skeleton, clip.barAnchor, pose.trunkDeg);
          path.push(bar);
          framing.push(bar, skeleton.head, skeleton.toeL, skeleton.toeR, skeleton.kneeR, skeleton.wristR, skeleton.pelvis);
        }
        scene.setBarPath(path);
        scene.setFraming(framing);

        for (let i = 0; i <= 30; i++) {
          const t = i / 30;
          const { pose } = sampleClip(clip, t, activation);
          const skeleton = solvePose(pose, {
            posture: clip.posture,
            supinePelvisY: clip.supinePelvisY,
            armsFollowGravity: clip.armsFollowGravity,
            gripHalfWidth: EQUIPMENT.barbell.gripHalfWidth,
          });
          const frame: SceneFrame = {
            skeleton,
            activation,
            trunkDeg: pose.trunkDeg,
            bar: barPosition(skeleton, clip.barAnchor, pose.trunkDeg),
            pathProgress: t,
            equipment: i % 2 === 0 ? 'barbell' : 'dumbbell',
            supine: clip.posture === 'supine',
          };
          scene.update(frame, LAYERS);
          scene.setCamera(t * Math.PI * 2, Math.PI / 2 - 0.2, 1, 0);
          scene.render();
          scene.projectLabels(skeleton, readJointAngles(skeleton) as unknown as Record<string, number>, 480, 640);
          frames++;
        }
      }
    }
    step(`rendered ${frames} frames across 5 clips x 3 quality tiers`, frames === 465, `got ${frames}`);
  } catch (error) {
    step('render loop survives every clip and quality tier', false, String(error));
    return result;
  }

  // A silently failing shader still "renders" — it just renders nothing. Read
  // the pixels back and require that the avatar actually put ink on the canvas.
  try {
    const context = scene.renderer.getContext();
    const pixels = new Uint8Array(480 * 640 * 4);
    context.readPixels(0, 0, 480, 640, context.RGBA, context.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 8 && (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8)) lit++;
    }
    const coverage = lit / (480 * 640);
    step('the avatar actually draws pixels (shader compiled and ran)', coverage > 0.01,
      `${(coverage * 100).toFixed(2)}% of the canvas is lit`);
  } catch (error) {
    step('pixels can be read back', false, String(error));
  }

  // Shader programs report their own compile status; an error log here means a
  // silently broken program even if three.js did not throw.
  try {
    const info = scene.renderer.info;
    step('the renderer reports live geometry and programs',
      info.memory.geometries > 0 && (info.programs?.length ?? 0) > 0,
      `geometries=${info.memory.geometries} programs=${info.programs?.length ?? 0}`);
  } catch (error) {
    step('renderer info is readable', false, String(error));
  }

  // Disposal is the whole ballgame for OOM crashes: after dispose there must be
  // no geometries, no textures and no live context.
  const before = {
    geometries: scene.renderer.info.memory.geometries,
    textures: scene.renderer.info.memory.textures,
  };
  scene.dispose();
  const after = {
    geometries: scene.renderer.info.memory.geometries,
    textures: scene.renderer.info.memory.textures,
  };
  step('dispose released every geometry', before.geometries > 0 && after.geometries === 0,
    `${before.geometries} -> ${after.geometries}`);
  step('dispose released every texture', after.textures === 0, `${before.textures} -> ${after.textures}`);
  step('dispose forced the GL context to be released', scene.renderer.getContext().isContextLost() === true);
  step('dispose is idempotent', (() => {
    try {
      scene!.dispose();
      scene!.dispose();
      return true;
    } catch {
      return false;
    }
  })());
  step('a disposed scene ignores further updates instead of throwing', (() => {
    try {
      const clip = getClip('squats')!;
      const { pose } = sampleClip(clip, 0.5, activation);
      const skeleton = solvePose(pose, { posture: clip.posture });
      scene!.update(
        { skeleton, activation, trunkDeg: pose.trunkDeg, bar: barPosition(skeleton, 'traps', pose.trunkDeg), pathProgress: 0.5, equipment: 'barbell', supine: false },
        LAYERS,
      );
      scene!.render();
      scene!.setBarPath([]);
      return true;
    } catch {
      return false;
    }
  })());

  // Mount/unmount churn is the real-world leak path: navigate into the Lab and
  // back out ten times and the browser must still hand out contexts.
  try {
    let churnOk = true;
    for (let i = 0; i < 10; i++) {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 320;
      document.body.appendChild(c);
      const s = new AvatarScene(c, QUALITY_PROFILES.balanced);
      s.setSize(240, 320, 1);
      const clip = getClip('deadlift')!;
      const { pose } = sampleClip(clip, 0.3, activation);
      const skeleton = solvePose(pose, {
        posture: clip.posture,
        armsFollowGravity: clip.armsFollowGravity,
        gripHalfWidth: EQUIPMENT.barbell.gripHalfWidth,
      });
      s.update(
        { skeleton, activation, trunkDeg: pose.trunkDeg, bar: barPosition(skeleton, clip.barAnchor, pose.trunkDeg), pathProgress: 0.3, equipment: 'barbell', supine: false },
        LAYERS,
      );
      s.render();
      if (s.renderer.getContext().isContextLost()) churnOk = false;
      s.dispose();
      c.remove();
    }
    step('ten mount/dispose cycles never exhaust the WebGL context budget', churnOk);
  } catch (error) {
    step('ten mount/dispose cycles never exhaust the WebGL context budget', false, String(error));
  }

  return result;
};

(window as unknown as { __runHarness: () => Promise<HarnessResult> }).__runHarness = run;
