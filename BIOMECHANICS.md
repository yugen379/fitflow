# Biomechanics Lab — scope record

Interactive 3D biomechanics engine for FitFlow, backed by a Redux Toolkit
(RTK + RTK Query) architecture.

Route: `/lab` — deep-linkable as `/lab?clip=deadlift`.
Entry points: the "Biomechanics Lab" card on the Workout screen.

Proof gates:

```bash
npm run proof:biomechanics   # 142 checks — rig, clips, slices, telemetry, guardrail, fuzz
npm run proof:viewport       # 13 checks  — real WebGL: shader, pixels, disposal, context churn
npm run lint                 # tsc --noEmit
npm run build
```

---

## 1. What was actually built

| Deliverable | File |
|---|---|
| RTK store + typed hooks | `src/biomechanics/store.ts` |
| Session state machine | `src/biomechanics/workoutSlice.ts` |
| 3D viewport / camera / quality state | `src/biomechanics/viewportSlice.ts` |
| RTK Query service | `src/biomechanics/fitnessApi.ts` |
| High-frequency telemetry bridge | `src/biomechanics/telemetryMiddleware.ts` |
| Memoised selectors | `src/biomechanics/selectors.ts` |
| 3D viewport component | `src/biomechanics/BiomechanicsViewport.tsx` |
| Scrub / camera / telemetry hook | `src/biomechanics/useBiomechanicsControls.ts` |
| three.js scene (no React) | `src/biomechanics/avatarScene.ts` |
| FK solver + rig | `src/biomechanics/rig.ts` |
| Authored motion clips | `src/biomechanics/motions.ts` |
| FPS / thermal guardrail | `src/biomechanics/perfGuard.ts` |
| Shared types | `src/biomechanics/types.ts` |
| UI panels | `src/biomechanics/components/*` |
| Screen | `src/pages/Lab.tsx` |

Five movements ship: **Back Squat, Bench Press, Deadlift, Overhead Press,
Barbell Row**. `EXERCISE_TO_CLIP` in `motions.ts` maps 16 library exercises onto
them; anything unmapped simply has no 3D view rather than showing an unrelated
lift.

---

## 2. Deliberate deviations from the brief

The brief specified React Native + `AppState` + RN gesture handlers. FitFlow is
a **React 19 web PWA wrapped in Capacitor**, so those map as follows, with no
loss of behaviour:

| Brief | Here | Why |
|---|---|---|
| React Native | React 19 + Vite | FitFlow's actual stack |
| `AppState` background pause | `visibilitychange` + `pagehide` | Fires in the Capacitor WebView; no extra plugin |
| RN gesture handlers | Pointer Events + `touch-action: none` + pointer capture | Same isolation guarantees on web and in the WebView |
| GPU/geometry disposal | three.js `dispose()` + `forceContextLoss()` | Same lifecycle problem, web API |

**The Redux Provider is mounted on the Lab route, not at the app root.** RTK +
react-redux costs ~30 kB gzipped and nothing outside `/lab` reads the store;
mounting it globally would tax every cold start for a feature most sessions
never open. The store itself is a module-level singleton, so session state, the
RTK Query cache and telemetry accumulators all survive navigating away and back
— only the subscription boundary is scoped. Any other screen that wants the live
session wraps itself the same way and shares the same store instance.

---

## 3. Architecture notes worth keeping

### High-frequency telemetry never touches Redux directly

The render loop produces a joint-angle + activation sample every frame. At 60 Hz
that is 3,600 actions a minute. Instead:

1. The loop calls `pushTelemetryFrame(...)` — writes into a pre-allocated ring
   buffer (180 slots, 3 s of headroom). No dispatch, no allocation.
2. `telemetryMiddleware` drains the buffer every 200 ms and commits **one**
   coalesced action carrying the latest pose and the mean activation.
3. Overflow drops the *oldest* sample and counts it; `droppedSamples` is
   surfaced in state rather than hidden.

Playback position and camera position are likewise advanced on refs inside the
loop and committed to Redux on a 100 ms throttle. Redux holds where the camera
is heading; the loop owns how it gets there.

### The FK rig

Metres, Y-up, +Z is the direction the athlete faces. Two frames, deliberately:

- **Legs** solve in the **world** frame — the floor and gravity define them.
- **Arms** solve in the **trunk** frame — shoulder flexion/abduction are
  anatomically defined relative to the torso.

Four arm DOFs: flexion, abduction, elbow, **and humeral rotation**. The fourth
is not decoration — without it a front rack is geometrically unreachable, because
the forearms can never come vertical under the bar. A grid search over the
3-DOF model found zero valid front-rack poses.

Grip width is expressed as a **shoulder-abduction bias** rather than a sideways
teleport of the hands, because that is how a lifter actually widens a grip. The
barbell half-grip (0.42 m) is the authoring reference and biases by zero.

Standing poses are grounded by translating the figure so the ankles sit at
`RIG.ankleHeight`; supine poses pin the pelvis to the bench and run a one-shot
analytic tibia IK so the feet still reach the floor.

`solvePose` is **total**: every numeric input is sanitised at the door, so no
input — however hostile — can emit NaN geometry. The fuzz suite asserts this
over 5,000 hostile poses.

### Keyframes were solved, not eyeballed

The clip data was fitted against the rig and is asserted in the proof:

- Squat bottom: knee flexion > 100°, trunk 40–50°, **bar over the mid-foot**,
  hip drops > 40 cm.
- Deadlift start: hands at **0.225 m** — the centre height of a loaded 45 cm
  plate — shoulders ahead of the bar, bar rises monotonically through the pull.
- Bench: > 30 cm bar ROM, bar never sinks below the chest surface, elbows drop
  below the torso plane at the bottom.
- Row: > 30 cm pull, elbow finishes behind the shoulder, torso angle fixed
  throughout.

### The muscle heatmap is a lookup texture, not vertex colours

Each vertex carries the two muscle regions it sits between (`aMuscleA`,
`aMuscleB`, `aBlend`), assigned by direction in a normalised segment space. A
17×1 `DataTexture` holds the current activation. Repainting the heatmap is
therefore a **68-byte texture upload per frame** rather than a rewrite of every
vertex colour. Row 17 is a pinned-zero neutral so head, hands and feet never heat
up.

### Camera auto-framing

Framing is solved **once per clip** from the union of every pose in the rep, not
per frame. A camera chasing the centroid of a deadlift drifts upward through the
pull and makes a steady movement look unstable. `orbit.radius` is therefore a
*multiple of the auto-fit distance* (1.0 = the whole rep fills the frame), which
is why one zoom range works for a bench press and a deadlift with no per-clip
tuning.

### The bar path is a tube, not a Line

`linewidth` is silently ignored on virtually every WebGL implementation, so a
`Line` bar path renders as a 1px hairline that disappears on a phone — the one
layer the feature is named after. It is a `TubeGeometry` over a centripetal
Catmull-Rom curve; progressive reveal is a `setDrawRange` on the index buffer,
so it costs nothing per frame.

---

## 4. Guardrails

| Risk | Mitigation |
|---|---|
| GPU/memory leak | Every GPU object is registered in a `DisposalBin`; `dispose()` is exhaustive by construction and ends with `forceContextLoss()`. Verified by pixel-level proof: 31 geometries → 0, 2 textures → 0. |
| Context-limit exhaustion | 10 mount/dispose cycles asserted in `proof:viewport`. The WebGL support probe also releases its own context via `WEBGL_lose_context`. |
| WebGL context loss | Treated as a recoverable **state**, not a crash: `preventDefault()` on `webglcontextlost`, rebuild on `webglcontextrestored`, with a user-facing "Restoring the 3D view…" overlay. |
| Backgrounding | `visibilitychange` / `pagehide` suspend the loop, the telemetry stream and the clock; on resume the frame clock is reset so the first delta is one frame, not the whole absence. |
| Gesture hijacking | `touch-action: none` + pointer capture + `stopPropagation`, with every orbit value clamped in the reducer. Camera presets provide a non-gesture path to every view. |
| Frame-rate / thermal | `FpsGuard`: EMA over 1 s windows, 2 consecutive bad windows to step down, 6 good ones to climb back, 4 s dwell. Thermal step-downs never climb back while pressure persists. |
| Shader failure | A broken shader still "renders" — it just draws nothing. `proof:viewport` reads pixels back and requires real coverage. |
| Panel crash | A dedicated `ViewportErrorBoundary` degrades the 3D panel only; recovery remounts a genuinely fresh canvas and context. |

**Honest limitation:** the web platform exposes **no thermal API**. There is no
`navigator.thermalState`. The guard treats a sustained frame-time regression as
the thermal signal and uses device hints (`deviceMemory`, `hardwareConcurrency`)
only to pick a sensible starting tier. `setThermalPressure()` exists as the seam
for a future Capacitor plugin.

---

## 5. Bugs the proofs caught during development

Recorded because they are the ones most likely to come back:

1. **Mirrored shoulder rotations** — `right = cross(forward, up)` yields −X, not
   +X. Invisible on bilateral lifts, very visible on anything else. Now
   asserted: the trunk frame must be orthonormal and right-handed at every lean.
2. **Bar-path geometry orphaned on a quality change** — `setQuality` nulled the
   reference without disposing it, leaking one buffer per LOD change. Caught by
   the pixel proof (31 → 2 geometries, not 31 → 0).
3. **Bar-path material allocated per call** — one leaked material for every clip
   or equipment change. Now created once and reused.
4. **Guard skipped ~1 window in 3** — 60 frames of 16.667 ms sum to 999.99 ms,
   not 1000, so the `elapsed < windowMs` comparison silently halved the guard's
   reaction rate.
5. **Bench press activated the quads without declaring them** — the heatmap
   shaded them but the legend could never list them.
6. **NaN propagation** — a non-finite `supinePelvisY` produced an entirely NaN
   skeleton and an invisible avatar with no error at all. `solvePose` is now
   total.

---

## 6. Where to extend

- **More clips:** add to `MOTION_CLIPS` in `motions.ts` and map library ids in
  `EXERCISE_TO_CLIP`. The proof's structural assertions (ascending keyframes,
  contiguous phases, declared muscles, activation range) apply automatically.
- **Remote 3D assets:** `getAssetManifest` is already an RTK Query endpoint; the
  clips just happen to ship in the bundle today. Swapping to hosted geometry is
  a `queryFn` change and nothing else.
- **Real thermal data:** call `FpsGuard.setThermalPressure(true)` from a
  Capacitor plugin.
