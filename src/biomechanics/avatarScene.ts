/**
 * The three.js scene behind the viewport.
 *
 * This module is plain imperative WebGL work with no React in it, which is
 * deliberate: React owns mounting and state, the scene owns GPU objects. That
 * split is what makes the disposal story provable — every geometry, material
 * and texture created here is registered in a bin and released in `dispose()`.
 *
 * The muscle heatmap is driven by a 17x1 lookup texture rather than per-vertex
 * colour updates. Each vertex carries the two muscle regions it sits between;
 * the fragment shader samples their current activation. Repainting the heatmap
 * is therefore a 68-byte texture upload per frame instead of a rewrite of every
 * vertex colour.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector3,
  WebGLRenderer,
} from 'three';

import { RIG, trunkFrame } from './rig';
import { MUSCLE_COUNT, MUSCLE_INDEX, NEUTRAL_MUSCLE_INDEX } from './types';
import type { EquipmentId, JointId, MuscleId, QualityProfile, Skeleton, Vec3 } from './types';

// ---------------------------------------------------------------------------
// Palette — pulled from FitFlow's design tokens so the avatar sits in-brand.
// ---------------------------------------------------------------------------

const PALETTE = {
  skin: new Color('#78849A'),
  skinDeep: new Color('#2B3240'),
  heatLow: new Color('#59657A'),
  heatMid: new Color('#7DD3FC'),
  heatHigh: new Color('#C6FF3D'),
  rim: new Color('#9CFF1F'),
  bar: new Color('#C9D2E0'),
  plate: new Color('#39404D'),
  bench: new Color('#232A36'),
  path: new Color('#C6FF3D'),
  vector: new Color('#7DD3FC'),
  floor: new Color('#33415A'),
};

const LOOKUP_WIDTH = MUSCLE_COUNT + 1;

// ---------------------------------------------------------------------------
// Disposal bin
// ---------------------------------------------------------------------------

interface Disposable {
  dispose(): void;
}

/**
 * Nothing in this file calls `new` on a GPU-backed object without handing it to
 * a bin. `disposeAll` is then exhaustive by construction rather than by memory.
 */
class DisposalBin {
  private items: Disposable[] = [];

  track<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  disposeAll(): void {
    for (const item of this.items) {
      try {
        item.dispose();
      } catch {
        // A double-dispose must never block the rest of the teardown.
      }
    }
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

// ---------------------------------------------------------------------------
// Muscle region assignment
// ---------------------------------------------------------------------------

interface MuscleRegion {
  /** Direction in normalised segment space (unit sphere around the segment). */
  dir: [number, number, number];
  muscle: MuscleId | null;
}

const NEUTRAL: MuscleRegion[] = [{ dir: [0, 0, 1], muscle: null }];

const indexOf = (muscle: MuscleId | null): number =>
  muscle === null ? NEUTRAL_MUSCLE_INDEX : MUSCLE_INDEX[muscle];

/**
 * Tag every vertex with the two nearest muscle regions and the blend between
 * them. Comparison happens in a space where the segment is squashed to a unit
 * sphere, so a long thin limb compares direction fairly rather than being
 * dominated by its length.
 */
const assignRegions = (
  geometry: BufferGeometry,
  regions: MuscleRegion[],
  halfExtents: [number, number, number],
  centre: [number, number, number] = [0, 0, 0],
): void => {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const muscleA = new Float32Array(count);
  const muscleB = new Float32Array(count);
  const blend = new Float32Array(count);

  const [hx, hy, hz] = halfExtents;

  for (let i = 0; i < count; i++) {
    const nx = (position.getX(i) - centre[0]) / (hx || 1);
    const ny = (position.getY(i) - centre[1]) / (hy || 1);
    const nz = (position.getZ(i) - centre[2]) / (hz || 1);
    const len = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / len;
    const uy = ny / len;
    const uz = nz / len;

    let bestIdx = 0;
    let bestDot = -Infinity;
    let secondIdx = 0;
    let secondDot = -Infinity;

    for (let r = 0; r < regions.length; r++) {
      const d = regions[r].dir;
      const dot = ux * d[0] + uy * d[1] + uz * d[2];
      if (dot > bestDot) {
        secondDot = bestDot;
        secondIdx = bestIdx;
        bestDot = dot;
        bestIdx = r;
      } else if (dot > secondDot) {
        secondDot = dot;
        secondIdx = r;
      }
    }

    if (regions.length === 1) secondIdx = bestIdx;

    muscleA[i] = indexOf(regions[bestIdx].muscle);
    muscleB[i] = indexOf(regions[secondIdx].muscle);
    // Angular gap between the two nearest regions, mapped to a soft crossfade
    // so muscle boundaries read as gradients rather than hard seams.
    const gap = Math.max(0, bestDot - secondDot);
    blend[i] = Math.max(0, Math.min(0.5, 0.5 - gap * 0.8));
  }

  geometry.setAttribute('aMuscleA', new BufferAttribute(muscleA, 1));
  geometry.setAttribute('aMuscleB', new BufferAttribute(muscleB, 1));
  geometry.setAttribute('aBlend', new BufferAttribute(blend, 1));
};

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
  attribute float aMuscleA;
  attribute float aMuscleB;
  attribute float aBlend;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vMuscleA;
  varying float vMuscleB;
  varying float vBlend;

  void main() {
    vMuscleA = aMuscleA;
    vMuscleB = aMuscleB;
    vBlend = aBlend;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform sampler2D uActivation;
  uniform float uLookupWidth;
  uniform float uHeatOpacity;
  uniform vec3 uSkin;
  uniform vec3 uSkinDeep;
  uniform vec3 uHeatLow;
  uniform vec3 uHeatMid;
  uniform vec3 uHeatHigh;
  uniform vec3 uRim;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vMuscleA;
  varying float vMuscleB;
  varying float vBlend;

  float sampleActivation(float index) {
    // Sample the centre of the texel so NEAREST filtering can never land on a
    // boundary and pick up the neighbouring muscle.
    float u = (index + 0.5) / uLookupWidth;
    return texture2D(uActivation, vec2(u, 0.5)).r;
  }

  void main() {
    float a = sampleActivation(vMuscleA);
    float b = sampleActivation(vMuscleB);
    float activation = clamp(mix(a, b, vBlend), 0.0, 1.0);

    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Two-light setup: a key from the upper front-right, a cool fill from
    // behind-left so the silhouette stays readable against a dark background.
    float key = max(dot(normal, normalize(vec3(0.55, 0.8, 0.5))), 0.0);
    float fill = max(dot(normal, normalize(vec3(-0.5, 0.1, -0.7))), 0.0);
    float lambert = 0.34 + key * 0.66 + fill * 0.26;

    vec3 base = mix(uSkinDeep, uSkin, lambert);

    vec3 heat = mix(uHeatLow, uHeatMid, smoothstep(0.0, 0.55, activation));
    heat = mix(heat, uHeatHigh, smoothstep(0.5, 1.0, activation));
    float heatWeight = smoothstep(0.04, 0.85, activation) * uHeatOpacity;
    // The heat term keeps a high floor regardless of lambert: a working muscle
    // on the shadowed side of the body still has to read as working, otherwise
    // the heatmap only exists on whichever side faces the key light.
    vec3 color = mix(base, heat * (0.78 + lambert * 0.42), heatWeight);

    // Fresnel rim keeps limbs separated where they overlap on a small screen.
    float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
    color += uRim * rim * (0.10 + activation * 0.30);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Segment definitions
// ---------------------------------------------------------------------------

interface SegmentSpec {
  key: string;
  from: JointId;
  to: JointId;
  radiusTop: number;
  radiusBottom: number;
  regions: MuscleRegion[];
}

const SEGMENTS: SegmentSpec[] = [
  {
    key: 'torso',
    from: 'pelvis',
    to: 'chest',
    radiusTop: 0.165,
    radiusBottom: 0.135,
    regions: [
      { dir: [0, 0.55, 0.84], muscle: 'pecs' },
      { dir: [0, -0.5, 0.87], muscle: 'abs' },
      { dir: [0, 0.78, -0.62], muscle: 'traps' },
      { dir: [0.7, 0.15, -0.7], muscle: 'lats' },
      { dir: [-0.7, 0.15, -0.7], muscle: 'lats' },
      { dir: [0, -0.45, -0.89], muscle: 'erectors' },
      { dir: [0.95, -0.3, 0.1], muscle: 'obliques' },
      { dir: [-0.95, -0.3, 0.1], muscle: 'obliques' },
    ],
  },
  { key: 'neck', from: 'neck', to: 'head', radiusTop: 0.055, radiusBottom: 0.06, regions: NEUTRAL },
  {
    key: 'upperArmL',
    from: 'shoulderL',
    to: 'elbowL',
    radiusTop: 0.06,
    radiusBottom: 0.05,
    regions: [
      { dir: [0, 0, 1], muscle: 'biceps' },
      { dir: [0, 0, -1], muscle: 'triceps' },
    ],
  },
  {
    key: 'upperArmR',
    from: 'shoulderR',
    to: 'elbowR',
    radiusTop: 0.06,
    radiusBottom: 0.05,
    regions: [
      { dir: [0, 0, 1], muscle: 'biceps' },
      { dir: [0, 0, -1], muscle: 'triceps' },
    ],
  },
  { key: 'forearmL', from: 'elbowL', to: 'wristL', radiusTop: 0.05, radiusBottom: 0.035, regions: [{ dir: [0, 0, 1], muscle: 'forearms' }] },
  { key: 'forearmR', from: 'elbowR', to: 'wristR', radiusTop: 0.05, radiusBottom: 0.035, regions: [{ dir: [0, 0, 1], muscle: 'forearms' }] },
  { key: 'handL', from: 'wristL', to: 'handL', radiusTop: 0.035, radiusBottom: 0.03, regions: NEUTRAL },
  { key: 'handR', from: 'wristR', to: 'handR', radiusTop: 0.035, radiusBottom: 0.03, regions: NEUTRAL },
  {
    key: 'thighL',
    from: 'hipL',
    to: 'kneeL',
    radiusTop: 0.095,
    radiusBottom: 0.068,
    regions: [
      { dir: [0, -0.2, 0.98], muscle: 'quads' },
      { dir: [0, -0.2, -0.98], muscle: 'hamstrings' },
      { dir: [0, 0.85, -0.53], muscle: 'glutes' },
    ],
  },
  {
    key: 'thighR',
    from: 'hipR',
    to: 'kneeR',
    radiusTop: 0.095,
    radiusBottom: 0.068,
    regions: [
      { dir: [0, -0.2, 0.98], muscle: 'quads' },
      { dir: [0, -0.2, -0.98], muscle: 'hamstrings' },
      { dir: [0, 0.85, -0.53], muscle: 'glutes' },
    ],
  },
  {
    key: 'shankL',
    from: 'kneeL',
    to: 'ankleL',
    radiusTop: 0.062,
    radiusBottom: 0.04,
    regions: [
      { dir: [0, 0.1, -0.99], muscle: 'calves' },
      { dir: [0, 0, 1], muscle: null },
    ],
  },
  {
    key: 'shankR',
    from: 'kneeR',
    to: 'ankleR',
    radiusTop: 0.062,
    radiusBottom: 0.04,
    regions: [
      { dir: [0, 0.1, -0.99], muscle: 'calves' },
      { dir: [0, 0, 1], muscle: null },
    ],
  },
  { key: 'footL', from: 'ankleL', to: 'toeL', radiusTop: 0.045, radiusBottom: 0.035, regions: NEUTRAL },
  { key: 'footR', from: 'ankleR', to: 'toeR', radiusTop: 0.045, radiusBottom: 0.035, regions: NEUTRAL },
];

interface BlobSpec {
  key: string;
  joint: JointId;
  radius: number;
  regions: MuscleRegion[];
}

const BLOBS: BlobSpec[] = [
  { key: 'head', joint: 'head', radius: RIG.headRadius, regions: NEUTRAL },
  {
    key: 'deltL',
    joint: 'shoulderL',
    radius: 0.085,
    regions: [
      { dir: [0, 0.2, 0.97], muscle: 'delt_front' },
      { dir: [-0.97, 0.2, 0], muscle: 'delt_side' },
      { dir: [0, 0.2, -0.97], muscle: 'delt_rear' },
    ],
  },
  {
    key: 'deltR',
    joint: 'shoulderR',
    radius: 0.085,
    regions: [
      { dir: [0, 0.2, 0.97], muscle: 'delt_front' },
      { dir: [0.97, 0.2, 0], muscle: 'delt_side' },
      { dir: [0, 0.2, -0.97], muscle: 'delt_rear' },
    ],
  },
  {
    key: 'pelvis',
    joint: 'pelvis',
    radius: 0.135,
    regions: [
      { dir: [0, 0, -1], muscle: 'glutes' },
      { dir: [0, 0, 1], muscle: 'abs' },
      { dir: [1, 0, 0], muscle: 'obliques' },
      { dir: [-1, 0, 0], muscle: 'obliques' },
    ],
  },
];

/** Joints that get an angle arc + a projected DOM label. */
export const MEASURED_JOINTS: { id: JointId; from: JointId; to: JointId; label: string }[] = [
  { id: 'kneeR', from: 'hipR', to: 'ankleR', label: 'Knee' },
  { id: 'hipR', from: 'chest', to: 'kneeR', label: 'Hip' },
  { id: 'elbowR', from: 'shoulderR', to: 'wristR', label: 'Elbow' },
];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface SceneFrame {
  skeleton: Skeleton;
  activation: Float32Array;
  /** Trunk lean of the current pose, used to orient limb front/back. */
  trunkDeg: number;
  /** Bar position for the implement + path head. */
  bar: Vec3;
  /** Supine clips render a bench; without it the athlete appears to float. */
  supine: boolean;
  /** 0..1 — how much of the precomputed bar path to reveal. */
  pathProgress: number;
  equipment: EquipmentId;
}

export interface LayerFlags {
  heatmap: boolean;
  jointVectors: boolean;
  barPath: boolean;
  skeleton: boolean;
  equipment: boolean;
}

export interface ProjectedLabel {
  id: JointId;
  label: string;
  /** CSS pixels within the canvas. */
  x: number;
  y: number;
  /** False when the joint is behind the camera or off-screen. */
  visible: boolean;
  angle: number;
}

const ARC_SEGMENTS = 18;

export class AvatarScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;

  private bin = new DisposalBin();
  /** Geometry rebuilt on quality changes gets its own bin so we can swap it. */
  private geometryBin = new DisposalBin();

  private material: ShaderMaterial;
  private lookupData: Uint8Array;
  private lookupTexture: DataTexture;

  private segmentMeshes = new Map<string, { mesh: Mesh; spec: SegmentSpec; baseLength: number }>();
  private blobMeshes = new Map<string, { mesh: Mesh; spec: BlobSpec }>();

  private barPathGeometry: BufferGeometry | null = null;
  /**
   * A tube, not a Line. `linewidth` is silently ignored on almost every WebGL
   * implementation, so a Line bar path renders as a 1px hairline that vanishes
   * on a phone — the one layer the feature is named after.
   */
  private barPathMesh: Mesh | null = null;
  private barPathSegments = 0;
  private barPathRadial = 6;
  /**
   * Created once and reused. Allocating a material per `setBarPath` call would
   * leak one material for every clip or equipment change the athlete makes.
   */
  private barPathMaterial: MeshBasicMaterial | null = null;

  private barGroupMeshes: Mesh[] = [];
  private benchMeshes: Mesh[] = [];
  private cableLine: Line | null = null;

  private arcs = new Map<JointId, { line: Line; geometry: BufferGeometry }>();

  private skeletonLine: Line | null = null;
  private skeletonGeometry: BufferGeometry | null = null;

  private shadowMesh: Mesh | null = null;

  private quality: QualityProfile;
  private disposed = false;

  /**
   * Framing is solved once per clip from the union of every pose in the rep,
   * not per frame. A camera chasing the centroid of a deadlift would drift
   * upward through the pull and make a steady movement look unstable; a fixed
   * frame that contains the whole rep is what a coach actually wants.
   */
  private bounds = { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1.9, minZ: -0.5, maxZ: 0.5 };
  private readonly focus = new Vector3(0, 0.95, 0);
  private fitDistance = 3.4;

  // Scratch objects — reused every frame so the loop allocates nothing.
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpX = new Vector3();
  private readonly tmpY = new Vector3();
  private readonly tmpZ = new Vector3();
  private readonly tmpForward = new Vector3();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly arcBuffer = new Float32Array((ARC_SEGMENTS + 1) * 3);

  constructor(canvas: HTMLCanvasElement, quality: QualityProfile) {
    this.quality = quality;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: true,
      powerPreference: 'high-performance',
      // Depth is needed; stencil is not, and dropping it saves bandwidth on
      // tiled mobile GPUs.
      stencil: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new PerspectiveCamera(38, 1, 0.1, 60);
    this.camera.position.set(2.4, 1.3, 2.4);

    this.lookupData = new Uint8Array(LOOKUP_WIDTH * 4);
    this.lookupTexture = new DataTexture(this.lookupData, LOOKUP_WIDTH, 1, RGBAFormat);
    this.lookupTexture.minFilter = NearestFilter;
    this.lookupTexture.magFilter = NearestFilter;
    this.lookupTexture.wrapS = ClampToEdgeWrapping;
    this.lookupTexture.wrapT = ClampToEdgeWrapping;
    this.lookupTexture.generateMipmaps = false;
    this.lookupTexture.needsUpdate = true;
    this.bin.track(this.lookupTexture);

    this.material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uActivation: { value: this.lookupTexture },
        uLookupWidth: { value: LOOKUP_WIDTH },
        uHeatOpacity: { value: 1 },
        uSkin: { value: PALETTE.skin.clone() },
        uSkinDeep: { value: PALETTE.skinDeep.clone() },
        uHeatLow: { value: PALETTE.heatLow.clone() },
        uHeatMid: { value: PALETTE.heatMid.clone() },
        uHeatHigh: { value: PALETTE.heatHigh.clone() },
        uRim: { value: PALETTE.rim.clone() },
      },
    });
    this.bin.track(this.material);

    this.buildStaticScene();
    this.buildAvatar();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private buildStaticScene(): void {
    // Floor rings — cheap orientation cues that read well on a dark screen.
    for (let i = 1; i <= 3; i++) {
      const radius = i * 0.65;
      const points = new Float32Array(65 * 3);
      for (let s = 0; s <= 64; s++) {
        const angle = (s / 64) * Math.PI * 2;
        points[s * 3] = Math.cos(angle) * radius;
        points[s * 3 + 1] = 0;
        points[s * 3 + 2] = Math.sin(angle) * radius;
      }
      const geometry = this.bin.track(new BufferGeometry());
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      const material = this.bin.track(
        new LineBasicMaterial({ color: PALETTE.floor, transparent: true, opacity: 0.75 - i * 0.16 }),
      );
      this.scene.add(new LineLoop(geometry, material));
    }

    // Soft contact shadow from a generated radial gradient.
    const shadowTexture = this.createShadowTexture();
    if (shadowTexture) {
      const geometry = this.bin.track(new BufferGeometry());
      const size = 1.5;
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute([-size, 0, -size, size, 0, -size, size, 0, size, -size, 0, size], 3),
      );
      geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const material = this.bin.track(
        new MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      this.shadowMesh = new Mesh(geometry, material);
      this.shadowMesh.position.y = 0.002;
      this.scene.add(this.shadowMesh);
    }
  }

  private createShadowTexture(): CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return this.bin.track(texture);
  }

  /** Builds (or rebuilds, after a quality change) all pose-driven geometry. */
  private buildAvatar(): void {
    const radial = this.quality.radialSegments;

    for (const spec of SEGMENTS) {
      const geometry = this.geometryBin.track(
        new CylinderGeometry(spec.radiusTop, spec.radiusBottom, 1, radial, 1, false),
      );
      // Cylinders are built centred; shift so the segment runs 0..1 along +Y,
      // which lets the frame matrix place it directly from the proximal joint.
      geometry.translate(0, 0.5, 0);
      assignRegions(geometry, spec.regions, [spec.radiusTop, 0.5, spec.radiusTop], [0, 0.5, 0]);
      const mesh = new Mesh(geometry, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.segmentMeshes.set(spec.key, { mesh, spec, baseLength: 1 });
    }

    for (const spec of BLOBS) {
      const geometry = this.geometryBin.track(
        new SphereGeometry(spec.radius, Math.max(6, radial), Math.max(4, Math.round(radial * 0.6))),
      );
      assignRegions(geometry, spec.regions, [spec.radius, spec.radius, spec.radius]);
      const mesh = new Mesh(geometry, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.blobMeshes.set(spec.key, { mesh, spec });
    }

    // Joint angle arcs.
    for (const joint of MEASURED_JOINTS) {
      const geometry = this.geometryBin.track(new BufferGeometry());
      geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.arcBuffer.length), 3));
      const material = this.geometryBin.track(
        new LineBasicMaterial({ color: PALETTE.vector, transparent: true, opacity: 0.9 }),
      );
      const line = new Line(geometry, material);
      line.frustumCulled = false;
      this.scene.add(line);
      this.arcs.set(joint.id, { line, geometry });
    }

    // Skeleton overlay (optional layer).
    {
      const geometry = this.geometryBin.track(new BufferGeometry());
      geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(SEGMENTS.length * 6), 3));
      const material = this.geometryBin.track(
        new LineBasicMaterial({ color: PALETTE.heatHigh, transparent: true, opacity: 0.75 }),
      );
      this.skeletonGeometry = geometry;
      this.skeletonLine = new Line(geometry, material);
      this.skeletonLine.frustumCulled = false;
      this.skeletonLine.visible = false;
      this.scene.add(this.skeletonLine);
    }

    this.barPathMaterial = this.geometryBin.track(
      new MeshBasicMaterial({
        color: PALETTE.path,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.buildEquipment(radial);
    this.buildBench();
  }

  /**
   * A flat bench, sized and placed against the supine rig: the pad top sits at
   * 0.42 m, which is where the athlete's back actually is once the pelvis is
   * pinned at 0.55 m and the torso has a 0.13 m half-thickness.
   */
  private buildBench(): void {
    const material = this.geometryBin.track(new MeshBasicMaterial({ color: PALETTE.bench }));

    const padGeometry = this.geometryBin.track(new BoxGeometry(0.33, 0.085, 1.45));
    const pad = new Mesh(padGeometry, material);
    pad.position.set(0, 0.378, -0.3);
    pad.visible = false;
    this.scene.add(pad);
    this.benchMeshes.push(pad);

    const legGeometry = this.geometryBin.track(new BoxGeometry(0.3, 0.335, 0.075));
    for (const z of [0.28, -0.88]) {
      const leg = new Mesh(legGeometry, material);
      leg.position.set(0, 0.168, z);
      leg.visible = false;
      this.scene.add(leg);
      this.benchMeshes.push(leg);
    }
  }

  /**
   * Release the bar-path geometry. It is not held in a bin because it is
   * replaced whenever the clip or equipment changes, and a bin would simply
   * accumulate every version ever built.
   */
  private disposeBarPath(): void {
    if (this.barPathMesh) {
      this.scene.remove(this.barPathMesh);
      this.barPathMesh = null;
    }
    if (this.barPathGeometry) {
      this.barPathGeometry.dispose();
      this.barPathGeometry = null;
    }
    this.barPathSegments = 0;
  }

  private buildEquipment(radial: number): void {
    // Barbell shaft plus four plates. Dumbbells reuse the plate meshes at the
    // wrists, so one set of geometry covers both implements.
    const shaftGeometry = this.geometryBin.track(new CylinderGeometry(0.015, 0.015, 1.62, Math.max(6, radial)));
    shaftGeometry.rotateZ(Math.PI / 2);
    const shaftMaterial = this.geometryBin.track(new MeshBasicMaterial({ color: PALETTE.bar }));
    const shaft = new Mesh(shaftGeometry, shaftMaterial);
    shaft.matrixAutoUpdate = false;
    shaft.frustumCulled = false;
    this.scene.add(shaft);
    this.barGroupMeshes.push(shaft);

    const plateGeometry = this.geometryBin.track(new CylinderGeometry(0.17, 0.17, 0.042, Math.max(8, radial)));
    plateGeometry.rotateZ(Math.PI / 2);
    const plateMaterial = this.geometryBin.track(new MeshBasicMaterial({ color: PALETTE.plate }));
    for (let i = 0; i < 4; i++) {
      const plate = new Mesh(plateGeometry, plateMaterial);
      plate.matrixAutoUpdate = false;
      plate.frustumCulled = false;
      this.scene.add(plate);
      this.barGroupMeshes.push(plate);
    }

    const cableGeometry = this.geometryBin.track(new BufferGeometry());
    cableGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    const cableMaterial = this.geometryBin.track(
      new LineBasicMaterial({ color: PALETTE.bar, transparent: true, opacity: 0.8 }),
    );
    this.cableLine = new Line(cableGeometry, cableMaterial);
    this.cableLine.frustumCulled = false;
    this.cableLine.visible = false;
    this.scene.add(this.cableLine);
  }

  /**
   * Upload the precomputed bar path. Called once per clip/equipment change, not
   * per frame — the reveal animation uses `setDrawRange`, which costs nothing.
   */
  setBarPath(points: Vec3[]): void {
    if (this.disposed) return;
    this.disposeBarPath();
    if (points.length < 2 || !this.barPathMaterial) return;

    const curvePoints = points.map((point) => new Vector3(point.x, point.y, point.z));
    // Centripetal parameterisation avoids the cusps a uniform Catmull-Rom
    // produces where a bar path reverses direction at the bottom of a rep.
    const curve = new CatmullRomCurve3(curvePoints, false, 'centripetal');
    const segments = Math.max(12, points.length * 2);
    const radial = 6;
    const geometry = new TubeGeometry(curve, segments, 0.0115, radial, false);

    this.barPathGeometry = geometry;
    this.barPathSegments = segments;
    this.barPathRadial = radial;
    this.barPathMesh = new Mesh(geometry, this.barPathMaterial);
    this.barPathMesh.frustumCulled = false;
    this.scene.add(this.barPathMesh);
  }

  // -------------------------------------------------------------------------
  // Per-frame updates
  // -------------------------------------------------------------------------

  /** Write the activation vector into the GPU lookup texture. */
  private uploadActivation(activation: Float32Array): void {
    const data = this.lookupData;
    for (let i = 0; i < MUSCLE_COUNT; i++) {
      const value = i < activation.length ? activation[i] : 0;
      const byte = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255);
      const o = i * 4;
      data[o] = byte;
      data[o + 1] = byte;
      data[o + 2] = byte;
      data[o + 3] = 255;
    }
    // The neutral row is pinned to zero so head, hands and feet never heat up.
    const neutral = NEUTRAL_MUSCLE_INDEX * 4;
    data[neutral] = 0;
    data[neutral + 1] = 0;
    data[neutral + 2] = 0;
    data[neutral + 3] = 255;
    this.lookupTexture.needsUpdate = true;
  }

  /**
   * Orient a segment from its proximal to its distal joint.
   *
   * The roll around the bone is pinned by `forward` so the front of a limb —
   * and therefore its quadriceps rather than its hamstrings — always faces the
   * front of the body, whatever the pose.
   */
  private orientSegment(mesh: Mesh, from: Vec3, to: Vec3, forward: Vector3): void {
    this.tmpA.set(from.x, from.y, from.z);
    this.tmpB.set(to.x, to.y, to.z);
    this.tmpY.subVectors(this.tmpB, this.tmpA);
    const length = this.tmpY.length();
    if (length < 1e-6) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    this.tmpY.divideScalar(length);

    // Remove the bone-parallel part of `forward` to get a stable local +Z.
    this.tmpZ.copy(forward).addScaledVector(this.tmpY, -forward.dot(this.tmpY));
    if (this.tmpZ.lengthSq() < 1e-8) {
      // Bone is parallel to the body's forward axis; any perpendicular will do.
      this.tmpZ.set(1, 0, 0).addScaledVector(this.tmpY, -this.tmpY.x);
      if (this.tmpZ.lengthSq() < 1e-8) this.tmpZ.set(0, 0, 1);
    }
    this.tmpZ.normalize();
    this.tmpX.crossVectors(this.tmpY, this.tmpZ).normalize();

    this.tmpMatrix.makeBasis(this.tmpX, this.tmpC.copy(this.tmpY).multiplyScalar(length), this.tmpZ);
    this.tmpMatrix.setPosition(this.tmpA);
    mesh.matrix.copy(this.tmpMatrix);
    mesh.matrixWorldNeedsUpdate = true;
  }

  private placeBlob(mesh: Mesh, at: Vec3, forward: Vector3): void {
    this.tmpZ.copy(forward).normalize();
    this.tmpY.set(0, 1, 0);
    if (Math.abs(this.tmpZ.dot(this.tmpY)) > 0.99) this.tmpY.set(1, 0, 0);
    this.tmpX.crossVectors(this.tmpY, this.tmpZ).normalize();
    this.tmpY.crossVectors(this.tmpZ, this.tmpX).normalize();
    this.tmpMatrix.makeBasis(this.tmpX, this.tmpY, this.tmpZ);
    this.tmpMatrix.setPosition(at.x, at.y, at.z);
    mesh.matrix.copy(this.tmpMatrix);
    mesh.matrixWorldNeedsUpdate = true;
  }

  private updateArcs(skeleton: Skeleton, visible: boolean): void {
    for (const joint of MEASURED_JOINTS) {
      const entry = this.arcs.get(joint.id);
      if (!entry) continue;
      entry.line.visible = visible;
      if (!visible) continue;

      const centre = skeleton[joint.id];
      const from = skeleton[joint.from];
      const to = skeleton[joint.to];

      this.tmpA.set(from.x - centre.x, from.y - centre.y, from.z - centre.z);
      this.tmpB.set(to.x - centre.x, to.y - centre.y, to.z - centre.z);
      const lenA = this.tmpA.length();
      const lenB = this.tmpB.length();
      if (lenA < 1e-6 || lenB < 1e-6) {
        entry.line.visible = false;
        continue;
      }
      this.tmpA.divideScalar(lenA);
      this.tmpB.divideScalar(lenB);

      const radius = Math.min(0.16, Math.min(lenA, lenB) * 0.42);
      const dot = Math.max(-1, Math.min(1, this.tmpA.dot(this.tmpB)));
      const total = Math.acos(dot);

      this.tmpC.crossVectors(this.tmpA, this.tmpB);
      if (this.tmpC.lengthSq() < 1e-10) {
        entry.line.visible = false;
        continue;
      }
      this.tmpC.normalize();

      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const angle = (i / ARC_SEGMENTS) * total;
        this.tmpQuat.setFromAxisAngle(this.tmpC, angle);
        this.tmpZ.copy(this.tmpA).applyQuaternion(this.tmpQuat).multiplyScalar(radius);
        this.arcBuffer[i * 3] = centre.x + this.tmpZ.x;
        this.arcBuffer[i * 3 + 1] = centre.y + this.tmpZ.y;
        this.arcBuffer[i * 3 + 2] = centre.z + this.tmpZ.z;
      }

      const attribute = entry.geometry.getAttribute('position') as BufferAttribute;
      (attribute.array as Float32Array).set(this.arcBuffer);
      attribute.needsUpdate = true;
    }
  }

  private updateSkeletonOverlay(skeleton: Skeleton, visible: boolean): void {
    if (!this.skeletonLine || !this.skeletonGeometry) return;
    this.skeletonLine.visible = visible;
    if (!visible) return;
    const attribute = this.skeletonGeometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    let cursor = 0;
    for (const spec of SEGMENTS) {
      const from = skeleton[spec.from];
      const to = skeleton[spec.to];
      array[cursor++] = from.x;
      array[cursor++] = from.y;
      array[cursor++] = from.z;
      array[cursor++] = to.x;
      array[cursor++] = to.y;
      array[cursor++] = to.z;
    }
    attribute.needsUpdate = true;
  }

  private updateEquipment(frame: SceneFrame, visible: boolean): void {
    const { equipment, bar, skeleton } = frame;
    const showBar = visible && (equipment === 'barbell' || equipment === 'dumbbell');
    for (const mesh of this.barGroupMeshes) mesh.visible = showBar;
    if (this.cableLine) this.cableLine.visible = visible && equipment === 'cable';

    if (showBar) {
      const isDumbbell = equipment === 'dumbbell';
      const shaft = this.barGroupMeshes[0];

      if (isDumbbell) {
        // Two short handles, one per hand.
        shaft.visible = false;
        const positions: Vec3[] = [skeleton.wristL, skeleton.wristR];
        for (let i = 0; i < 4; i++) {
          const plate = this.barGroupMeshes[i + 1];
          const hand = positions[i < 2 ? 0 : 1];
          const offset = (i % 2 === 0 ? -1 : 1) * 0.13;
          this.tmpMatrix.makeScale(0.45, 0.45, 0.45);
          this.tmpMatrix.setPosition(hand.x + offset, hand.y, hand.z);
          plate.matrix.copy(this.tmpMatrix);
          plate.matrixWorldNeedsUpdate = true;
        }
      } else {
        shaft.visible = true;
        this.tmpMatrix.identity();
        this.tmpMatrix.setPosition(bar.x, bar.y, bar.z);
        shaft.matrix.copy(this.tmpMatrix);
        shaft.matrixWorldNeedsUpdate = true;

        const halfLength = 0.81;
        const offsets = [-halfLength + 0.12, -halfLength + 0.2, halfLength - 0.2, halfLength - 0.12];
        for (let i = 0; i < 4; i++) {
          const plate = this.barGroupMeshes[i + 1];
          this.tmpMatrix.identity();
          this.tmpMatrix.setPosition(bar.x + offsets[i], bar.y, bar.z);
          plate.matrix.copy(this.tmpMatrix);
          plate.matrixWorldNeedsUpdate = true;
        }
      }
    }

    if (this.cableLine && this.cableLine.visible) {
      const attribute = this.cableLine.geometry.getAttribute('position') as BufferAttribute;
      const array = attribute.array as Float32Array;
      // Pulley anchored behind and above the athlete.
      array[0] = 0;
      array[1] = 1.95;
      array[2] = -1.4;
      array[3] = bar.x;
      array[4] = bar.y;
      array[5] = bar.z;
      attribute.needsUpdate = true;
    }
  }

  /** Apply one solved frame. Allocation-free. */
  update(frame: SceneFrame, layers: LayerFlags): void {
    if (this.disposed) return;
    const { skeleton, activation, trunkDeg } = frame;

    this.uploadActivation(activation);
    this.material.uniforms.uHeatOpacity.value = layers.heatmap ? 1 : 0;

    const forward = trunkFrame(trunkDeg).forward;
    this.tmpForward.set(forward.x, forward.y, forward.z);

    for (const { mesh, spec } of this.segmentMeshes.values()) {
      this.orientSegment(mesh, skeleton[spec.from], skeleton[spec.to], this.tmpForward);
    }
    for (const { mesh, spec } of this.blobMeshes.values()) {
      this.placeBlob(mesh, skeleton[spec.joint], this.tmpForward);
    }

    if (this.shadowMesh) {
      // Anchor the contact shadow between the feet for a standing lift and
      // under the bench for a supine one, so it never floats off on its own.
      const midX = (skeleton.ankleL.x + skeleton.ankleR.x) / 2;
      const midZ = frame.supine ? -0.3 : (skeleton.ankleL.z + skeleton.ankleR.z) / 2;
      this.shadowMesh.position.set(midX, 0.002, midZ);
    }

    for (const mesh of this.benchMeshes) mesh.visible = frame.supine;

    this.updateArcs(skeleton, layers.jointVectors);
    this.updateSkeletonOverlay(skeleton, layers.skeleton);
    this.updateEquipment(frame, layers.equipment);

    if (this.barPathMesh) {
      this.barPathMesh.visible = layers.barPath && this.barPathSegments > 0;
      if (this.barPathMesh.visible) {
        // TubeGeometry emits its indices in tubular-segment order, so revealing
        // the trace is a draw-range change rather than a geometry rebuild.
        const progress = Math.min(1, Math.max(0, frame.pathProgress));
        const shownSegments = Math.max(1, Math.round(this.barPathSegments * progress));
        this.barPathMesh.geometry.setDrawRange(0, shownSegments * this.barPathRadial * 6);
      }
    }
  }

  /**
   * Set the framing volume for the loaded clip. Callers pass every joint and bar
   * position across the whole rep; the camera then frames that union.
   */
  setFraming(points: Vec3[]): void {
    if (this.disposed || points.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    this.bounds = { minX, maxX, minY, maxY, minZ, maxZ };
    this.focus.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    this.recomputeFit();
  }

  /**
   * Distance at which the framing volume fills the viewport. Recomputed on
   * resize as well as on clip change, because rotating a phone changes which
   * axis is the binding constraint.
   */
  private recomputeFit(): void {
    const { minX, maxX, minY, maxY, minZ, maxZ } = this.bounds;
    const height = Math.max(0.4, maxY - minY);
    // The camera orbits, so the worst-case horizontal extent is the diagonal of
    // the footprint rather than either axis on its own.
    const horizontal = Math.max(0.4, Math.hypot(maxX - minX, maxZ - minZ));

    const vFov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect > 0 ? this.camera.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const forHeight = (height * 0.5) / Math.tan(vFov / 2);
    const forWidth = (horizontal * 0.5) / Math.tan(hFov / 2);
    // The margin keeps limbs from grazing the edge of the canvas.
    this.fitDistance = Math.max(forHeight, forWidth) * 1.2;
  }

  /** Project measured joints to canvas pixels for the DOM angle chips. */
  projectLabels(skeleton: Skeleton, angles: Record<string, number>, width: number, height: number): ProjectedLabel[] {
    const out: ProjectedLabel[] = [];
    for (const joint of MEASURED_JOINTS) {
      const position = skeleton[joint.id];
      this.tmpA.set(position.x, position.y, position.z).project(this.camera);
      const visible = this.tmpA.z > -1 && this.tmpA.z < 1 && Math.abs(this.tmpA.x) <= 1.1 && Math.abs(this.tmpA.y) <= 1.1;
      out.push({
        id: joint.id,
        label: joint.label,
        x: (this.tmpA.x * 0.5 + 0.5) * width,
        y: (-this.tmpA.y * 0.5 + 0.5) * height,
        visible,
        angle: angles[joint.label.toLowerCase()] ?? 0,
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Camera / sizing / quality
  // -------------------------------------------------------------------------

  setCamera(azimuth: number, polar: number, distanceScale: number, targetYOffset: number): void {
    const scale = Number.isFinite(distanceScale) && distanceScale > 0 ? distanceScale : 1;
    const distance = this.fitDistance * scale;
    const targetX = this.focus.x;
    const targetY = this.focus.y + (Number.isFinite(targetYOffset) ? targetYOffset : 0);
    const targetZ = this.focus.z;

    const sinPolar = Math.sin(polar);
    this.camera.position.set(
      targetX + distance * sinPolar * Math.sin(azimuth),
      targetY + distance * Math.cos(polar),
      targetZ + distance * sinPolar * Math.cos(azimuth),
    );
    this.camera.lookAt(targetX, targetY, targetZ);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(pixelRatio, this.quality.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.recomputeFit();
  }

  /**
   * Apply a new quality tier. Pixel-ratio-only changes are cheap; segment-count
   * changes rebuild the avatar geometry, which is why the guardrail is
   * rate-limited rather than reacting to every dropped frame.
   */
  setQuality(quality: QualityProfile, width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return;
    const needsRebuild = quality.radialSegments !== this.quality.radialSegments;
    this.quality = quality;

    if (needsRebuild) {
      for (const { mesh } of this.segmentMeshes.values()) this.scene.remove(mesh);
      for (const { mesh } of this.blobMeshes.values()) this.scene.remove(mesh);
      for (const { line } of this.arcs.values()) this.scene.remove(line);
      for (const mesh of this.barGroupMeshes) this.scene.remove(mesh);
      for (const mesh of this.benchMeshes) this.scene.remove(mesh);
      if (this.skeletonLine) this.scene.remove(this.skeletonLine);
      if (this.cableLine) this.scene.remove(this.cableLine);
      // Not just detached: the geometry is bin-less, so dropping the reference
      // here would leak one buffer per quality change.
      this.disposeBarPath();

      this.segmentMeshes.clear();
      this.blobMeshes.clear();
      this.arcs.clear();
      this.barGroupMeshes = [];
      this.benchMeshes = [];
      this.skeletonLine = null;
      this.skeletonGeometry = null;
      this.cableLine = null;
      this.barPathMaterial = null;

      this.geometryBin.disposeAll();
      this.geometryBin = new DisposalBin();
      this.buildAvatar();
    }

    this.setSize(width, height, pixelRatio);
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Release every GPU resource this scene owns.
   *
   * `forceContextLoss` is the part people forget: without it the browser can
   * keep the backing context alive long after the canvas is detached, and a few
   * navigations later you hit the per-page WebGL context limit and every
   * subsequent viewport fails to initialise.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scene.clear();
    this.segmentMeshes.clear();
    this.blobMeshes.clear();
    this.arcs.clear();
    this.barGroupMeshes = [];
    this.benchMeshes = [];
    this.skeletonLine = null;
    this.skeletonGeometry = null;
    this.cableLine = null;
    this.shadowMesh = null;
    this.barPathMaterial = null;

    this.disposeBarPath();
    this.geometryBin.disposeAll();
    this.bin.disposeAll();

    try {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    } catch {
      // Already lost — nothing left to release.
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
