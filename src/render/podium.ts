/**
 * Podium / trophy presentation: a small standalone toon scene (like the
 * character stage) with a three-step podium, the top-three riders standing on
 * their steps in their real looks, pooled tumbling confetti, coloured stage
 * lights and a scripted camera (slow orbit, then a push-in on the star).
 *
 * Two flavours:
 *  - 'race'   after a race: the winner celebrates, 2nd/3rd clap.
 *  - 'trophy' after a cup: the player lifts a procedural metal trophy (gold,
 *             silver or bronze) above their head inside a shower of sparkles.
 *
 * Rendered by the game in place of the world, so it costs one small scene —
 * no ocean, no props. Everything is built once on open and disposed on close;
 * the per-frame update allocates nothing.
 */

import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SpotLight,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { AudioEngine } from '../audio/audio';
import type { Boat } from '../boat/boat';
import type { Livery } from '../boat/livery';
import { addBoots, foothold, Rider, type RiderPose } from '../boat/rider';
import type { RiderLook } from '../boat/riderLook';
import { clamp01 } from '../core/mathx';
import { addOutline, cel, celShared, makeCel } from './cel';
import { GeoBuilder } from './geo';

export interface PodiumEntry {
  name: string;
  livery: Livery;
  /** Chosen look (player); null derives it from the livery (AI). */
  look: RiderLook | null;
  /** 1, 2 or 3. */
  place: number;
  isPlayer: boolean;
}

export interface PodiumOptions {
  mode: 'race' | 'trophy';
  /** Trophy metal (trophy mode): 1 gold, 2 silver, 3 bronze. */
  trophyPlace?: number;
  /** UI panel layout: 'side' frames the podium left of a right-hand panel, 'bottom' above a bottom panel. */
  layout?: 'side' | 'bottom';
}

/** Post settings for the podium (bright, a little bloom for the metal and sparkles). */
export const PODIUM_POST = { bloom: 0.3, exposure: 0.96, saturation: 1.1, contrast: 1.06, vignette: 0.3 };

// ── Layout ────────────────────────────────────────────────────────────────
const STEP_W = 1.7;
const STEP_D = 1.5;
/** Step x / height by place (index 0 = 1st). 2nd stands on the viewer's left. */
const STEP_X = [0, -1.8, 1.8];
const STEP_H = [1.25, 0.85, 0.55];
const STEP_COL = ['#ffbf1e', '#c9d4e6', '#e0823e'];
const STEP_DARK = ['#c88a00', '#8a98b4', '#9a4f1e'];
const CONFETTI = 320;
/** Held trophy size (the rider's short anime arms grip the plinth beside their head). */
const TROPHY_SCALE = 1.5;
const SPARKLES = 48;
const CONFETTI_COLS = ['#ff4f8b', '#ffd93a', '#3fe0ff', '#7dff3a', '#ffffff', '#8b6cff', '#ff9a1e'];

/** The handful of boat fields the rider's pose reads, held at "idle on deck". */
function idleBoat() {
  return { airborne: false, boostLevel: 0, driftDir: 0, drifting: false, engine: 0, landStrength: 0, sinceLand: 5, trick: 'none', trickDir: 1, yawRate: 0, wipeout: 0, pitchRate: 0 } as unknown as Boat;
}

function gradientTex() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2a2f9e');
  gr.addColorStop(0.45, '#2f7dff');
  gr.addColorStop(0.72, '#6fd6ff');
  gr.addColorStop(1, '#ffd1ec');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Step front decal: a big ink-outlined number with the rider's name under it. */
function stepDecal(place: number, name: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '400 168px "Bangers", "Arial Black", Impact, sans-serif';
  const label = String(place);
  g.lineWidth = 22;
  g.strokeStyle = '#12306e';
  g.strokeText(label, 128, 168);
  const gr = g.createLinearGradient(0, 30, 0, 170);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.48, STEP_COL[place - 1]);
  gr.addColorStop(0.52, STEP_DARK[place - 1]);
  gr.addColorStop(1, STEP_COL[place - 1]);
  g.fillStyle = gr;
  g.fillText(label, 128, 168);
  // Name pill.
  const nm = name.toUpperCase().slice(0, 14);
  g.font = '400 34px "Bangers", "Arial Black", Impact, sans-serif';
  const w = Math.min(244, g.measureText(nm).width + 34);
  g.fillStyle = '#12306e';
  g.beginPath();
  g.roundRect(128 - w / 2, 192, w, 46, 23);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillText(nm, 128, 228, 220);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Conic stripes for the round stage floor. */
function floorTex() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const N = 24;
  for (let i = 0; i < N; i++) {
    g.fillStyle = i % 2 ? '#2a5fe0' : '#3f86ff';
    g.beginPath();
    g.moveTo(256, 256);
    g.arc(256, 256, 256, (i / N) * Math.PI * 2, ((i + 1) / N) * Math.PI * 2);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(256, 256, 246, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#ffd93a';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(256, 256, 228, 0, Math.PI * 2);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ── Shaders ──────────────────────────────────────────────────────────────
/** Sunburst backdrop: soft rotating rays fading out from a centre. */
const raysVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const raysFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
void main() {
  vec2 p = vUv - vec2(0.5, 0.42);
  float a = atan(p.y, p.x) + uTime * 0.08;
  float r = length(p);
  float ray = step(0.0, sin(a * 14.0));
  float fade = smoothstep(0.62, 0.05, r);
  vec3 col = mix(uA, uB, ray * 0.55 + smoothstep(0.25, 0.0, r) * 0.6);
  gl_FragColor = vec4(col, fade * 0.85);
}`;

/** Light beam: additive cone, bright at the lamp and fading down and at the edges. */
const beamVert = /* glsl */ `
varying float vY;
varying float vEdge;
void main() {
  vY = uv.y;
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vEdge = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
varying float vY;
varying float vEdge;
void main() {
  float a = pow(vY, 1.6) * smoothstep(0.0, 0.7, vEdge) * uPower;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/**
 * Anime metal: a fake "studio" reflection in three hard bands (dark floor,
 * body, bright sky), a toon key term, a hard specular dot, fresnel rim and a
 * diagonal shine that sweeps across the trophy every couple of seconds.
 */
const metalVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
  vObj = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const metalFrag = /* glsl */ `
uniform vec3 uDark;
uniform vec3 uBase;
uniform vec3 uLight;
uniform vec3 uKey;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vV);
  vec3 r = reflect(-v, n);
  float e = r.y + 0.12 * r.x;
  vec3 col = e < -0.18 ? uDark : (e < 0.38 ? uBase : uLight);
  // Thin bright horizon line in the reflection, like a studio softbox edge.
  col = mix(col, uLight, smoothstep(0.03, 0.0, abs(e - 0.38)) * 0.8);
  float ndl = dot(n, uKey);
  col *= ndl > -0.1 ? 1.0 : 0.78;
  vec3 h = normalize(uKey + v);
  float sp = pow(max(dot(n, h), 0.0), 70.0);
  col += step(0.45, sp) * vec3(1.0);
  col += uLight * smoothstep(0.55, 0.95, 1.0 - max(dot(n, v), 0.0)) * 0.45;
  float s = fract(uTime * 0.42) * 3.2 - 0.9;
  float d = abs(vObj.y * 1.2 + vObj.x * 0.8 - s);
  col += vec3(1.0, 0.98, 0.9) * smoothstep(0.07, 0.0, d) * 1.2;
  gl_FragColor = vec4(col, 1.0);
}`;

const METALS: [string, string, string][] = [
  ['#7a3f00', '#ffc21e', '#fff4b0'],
  ['#56627c', '#cdd6e6', '#ffffff'],
  ['#5a2a0c', '#d9823f', '#ffd8b0'],
];

/** Procedural cup: lathed bowl + stem, loop handles, a dark plinth with a plaque. */
function buildTrophy(place: number, owned: Material[], geos: BufferGeometry[]) {
  const root = new Group();
  const m = METALS[Math.min(2, Math.max(0, Math.round(place) - 1))];
  const mat = new ShaderMaterial({
    uniforms: {
      uDark: { value: new Color(m[0]) },
      uBase: { value: new Color(m[1]) },
      uLight: { value: new Color(m[2]) },
      uKey: { value: new Vector3(0.4, 0.7, 0.6).normalize() },
      uTime: { value: 0 },
    },
    vertexShader: metalVert,
    fragmentShader: metalFrag,
    side: DoubleSide,
  });
  owned.push(mat);
  // Profile (radius, height) from the foot up the stem, out the bowl and back in over the lip.
  const pts = [
    [0.0, 0.12],
    [0.13, 0.12],
    [0.13, 0.15],
    [0.09, 0.17],
    [0.045, 0.2],
    [0.04, 0.3],
    [0.075, 0.32],
    [0.05, 0.345],
    [0.08, 0.37],
    [0.16, 0.44],
    [0.205, 0.53],
    [0.225, 0.64],
    [0.235, 0.7],
    [0.215, 0.705],
    [0.2, 0.62],
    [0.16, 0.52],
    [0.0, 0.48],
  ].map(([x, y]) => new Vector2(x, y));
  const cupGeo = new LatheGeometry(pts, 28);
  geos.push(cupGeo);
  const cup = new Mesh(cupGeo, mat);
  addOutline(cup, 2.4);
  root.add(cup);
  const hGeo = new TorusGeometry(0.1, 0.02, 8, 18, Math.PI * 1.25);
  geos.push(hGeo);
  for (const s of [-1, 1]) {
    const h = new Mesh(hGeo, mat);
    h.position.set(s * 0.215, 0.56, 0);
    h.rotation.set(0, 0, s > 0 ? -Math.PI * 0.62 : Math.PI * 0.38);
    addOutline(h, 2.0);
    root.add(h);
  }
  // Plinth.
  const gb = new GeoBuilder();
  gb.box(0.34, 0.1, 0.34, '#24285a', { y: 0.05 });
  gb.box(0.3, 0.025, 0.3, '#3a4090', { y: 0.11 });
  gb.box(0.16, 0.05, 0.01, m[1], { y: 0.05, z: 0.172 });
  const plGeo = gb.build();
  geos.push(plGeo);
  const plinth = new Mesh(plGeo, cel('podiumParts', { vertexColors: true, gloss: 0.6 }));
  addOutline(plinth, 2.2);
  root.add(plinth);
  return { root, mat };
}

// ── Scratch (no per-frame allocation) ───────────────────────────────────
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3();
const _look = new Vector3();
const _tgt = new Vector3();
const _c = new Color();
const _sun = new Vector3();

const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

interface Stand {
  entry: PodiumEntry;
  holder: Group;
  rider: Rider;
  boots: Mesh;
  boat: Boat;
  base: Vector3;
  yaw: number;
  pose: RiderPose;
  hop: number;
}

export class PodiumScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 16 / 9, 0.1, 80);
  readonly mode: 'race' | 'trophy';
  /** Seconds the presentation runs before it moves on by itself. */
  readonly duration: number;
  t = 0;
  layout: 'side' | 'bottom';
  private stands: Stand[] = [];
  private owned: Material[] = [];
  private geos: BufferGeometry[] = [];
  private texs: CanvasTexture[] = [];
  private rays: ShaderMaterial;
  private beams: ShaderMaterial[] = [];
  private spot: SpotLight;
  private star: Vector3;
  // Confetti pool.
  private confetti: InstancedMesh;
  private cp = new Float32Array(CONFETTI * 3);
  private cv = new Float32Array(CONFETTI * 3);
  private ca = new Float32Array(CONFETTI * 3);
  private cr = new Float32Array(CONFETTI * 3);
  private cBase = new Float32Array(CONFETTI * 3);
  private cAlive = new Uint8Array(CONFETTI);
  private raining = true;
  private seed = 12345;
  // Trophy + sparkles.
  private trophy: Group | null = null;
  private trophyMat: ShaderMaterial | null = null;
  private trophyStand: Stand | null = null;
  private sparkles: InstancedMesh | null = null;
  private sp = new Float32Array(SPARKLES * 4);
  private cues = 0;
  private saved = { rimColor: new Color(), rim: 0, spec: new Color(), outline: new Color() };

  constructor(
    entries: PodiumEntry[],
    opts: PodiumOptions,
    private audio: AudioEngine | null = null,
  ) {
    this.mode = opts.mode;
    this.layout = opts.layout ?? 'side';
    this.duration = opts.mode === 'trophy' ? 8.5 : 6.5;
    const sc = this.scene;
    const bg = gradientTex();
    this.texs.push(bg);
    sc.background = bg;

    // Cel uniforms are global: take them over while the podium is up, restore on dispose.
    this.saved.rimColor.copy(celShared.uRimColor.value);
    this.saved.rim = celShared.uRim.value;
    this.saved.spec.copy(celShared.uSpecColor.value);
    this.saved.outline.copy(celShared.uOutlineColor.value);
    celShared.uRimColor.value.set(0xfff0ff);
    celShared.uRim.value = 0.7;
    celShared.uSpecColor.value.set(0xffffff);
    celShared.uOutlineColor.value.set(0x1b2150);

    // ── Lights: warm key, cool fill, strong rim from behind, coloured spot on the star.
    const key = new DirectionalLight(0xfff1dc, 1.75);
    key.position.set(3, 6, 5);
    const fill = new DirectionalLight(0x9fc8ff, 0.75);
    fill.position.set(-4, 2, 2);
    const rim = new DirectionalLight(0xffc6f0, 1.9);
    rim.position.set(-1, 4, -5);
    sc.add(key, fill, rim, new HemisphereLight(0xdff2ff, 0x3a3a8a, 0.7), new AmbientLight(0xffffff, 0.12));
    _sun.copy(key.position).normalize();

    // ── Backdrop: sunburst, stage floor, podium.
    const raysGeo = new PlaneGeometry(60, 34);
    this.geos.push(raysGeo);
    this.rays = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uA: { value: new Color('#3f8cff') }, uB: { value: new Color('#bff0ff') } },
      vertexShader: raysVert,
      fragmentShader: raysFrag,
      transparent: true,
      depthWrite: false,
    });
    this.owned.push(this.rays);
    const raysMesh = new Mesh(raysGeo, this.rays);
    raysMesh.position.set(0, 4, -16);
    sc.add(raysMesh);

    const ft = floorTex();
    this.texs.push(ft);
    const floorGeo = new CircleGeometry(6.5, 48);
    floorGeo.rotateX(-Math.PI / 2);
    this.geos.push(floorGeo);
    const floorMat = makeCel({ map: ft, gloss: 0.3 });
    this.owned.push(floorMat);
    const floor = new Mesh(floorGeo, floorMat);
    sc.add(floor);
    // Floor rim.
    const rimGeo = new GeoBuilder().cyl(6.6, 6.75, 0.35, '#12306e', { y: -0.18 }, 48).build();
    this.geos.push(rimGeo);
    const rimMesh = new Mesh(rimGeo, cel('podiumParts', { vertexColors: true, gloss: 0.6 }));
    sc.add(rimMesh);

    const gb = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const x = STEP_X[i];
      const h = STEP_H[i];
      gb.box(STEP_W, h - 0.12, STEP_D, '#fff8e6', { x, y: (h - 0.12) / 2 });
      gb.box(STEP_W + 0.08, 0.14, STEP_D + 0.08, STEP_COL[i], { x, y: h - 0.07 });
      gb.box(STEP_W + 0.02, 0.1, STEP_D + 0.02, i === 0 ? '#ff4f8b' : '#3fe0ff', { x, y: 0.05 });
    }
    // Little stair blocks in front of 1st so it reads as a stepped stage.
    gb.box(STEP_W * 3 + 0.4, 0.12, 0.5, '#12306e', { y: 0.06, z: STEP_D / 2 + 0.3 });
    const podGeo = gb.build();
    this.geos.push(podGeo);
    const podium = new Mesh(podGeo, cel('podiumParts', { vertexColors: true, gloss: 0.6 }));
    addOutline(podium, 2.6);
    sc.add(podium);

    // Bunting strung across the back.
    const bunt = this.bunting();
    sc.add(bunt);

    // ── Riders.
    const decalGeo = new PlaneGeometry(0.95, 0.95);
    this.geos.push(decalGeo);
    const shadowGeo = new CircleGeometry(0.42, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    this.geos.push(shadowGeo);
    const shadowMat = new MeshBasicMaterial({ color: 0x0a1040, transparent: true, opacity: 0.35, depthWrite: false });
    this.owned.push(shadowMat);
    const sorted = entries.slice(0, 3).sort((a, b) => a.place - b.place);
    for (const e of sorted) {
      const i = Math.max(0, Math.min(2, e.place - 1));
      const tex = stepDecal(i + 1, e.name);
      this.texs.push(tex);
      const dm = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      this.owned.push(dm);
      const decal = new Mesh(decalGeo, dm);
      const dh = Math.min(0.95, STEP_H[i] - 0.18);
      decal.scale.setScalar(dh / 0.95);
      decal.position.set(STEP_X[i], (STEP_H[i] - 0.14) / 2 + 0.03, STEP_D / 2 + 0.012);
      sc.add(decal);

      const holder = new Group();
      const base = new Vector3(STEP_X[i], STEP_H[i], 0.05);
      holder.position.copy(base);
      const yaw = i === 0 ? 0 : i === 1 ? 0.28 : -0.28;
      holder.rotation.y = yaw;
      const deck = 0.01;
      const rider = new Rider(e.livery, { hip: new Vector3(0, deck + 0.9, -0.02), gripL: new Vector3(0.36, deck + 0.62, 0.12), gripR: new Vector3(-0.36, deck + 0.62, 0.12), footL: foothold(0, deck, 0), footR: foothold(1, deck, 0) }, null, e.look ?? undefined);
      const bb = new GeoBuilder();
      addBoots(bb, deck, 0, e.livery);
      const bootGeo = bb.build();
      this.geos.push(bootGeo);
      const boots = new Mesh(bootGeo, cel('boatParts', { vertexColors: true, gloss: 0.6 }));
      addOutline(boots, 2.4);
      holder.add(rider.root, boots);
      sc.add(holder);
      const sh = new Mesh(shadowGeo, shadowMat);
      sh.position.set(base.x, base.y + 0.006, base.z);
      sc.add(sh);
      let pose: RiderPose = i === 0 ? 'victory' : 'cheer';
      if (this.mode === 'trophy' && e.isPlayer) pose = 'lift';
      const st: Stand = { entry: e, holder, rider, boots, boat: idleBoat(), base, yaw, pose, hop: 0 };
      rider.pose = pose;
      this.stands.push(st);
    }
    const first = this.stands.find((s) => s.entry.place === 1) ?? this.stands[0];
    this.trophyStand = this.mode === 'trophy' ? (this.stands.find((s) => s.entry.isPlayer) ?? first) : null;
    const focus = this.trophyStand ?? first;
    this.star = new Vector3(focus ? focus.base.x : 0, focus ? focus.base.y : 1.2, 0);

    // Spot on the star + two coloured beams crossing onto them.
    this.spot = new SpotLight(0xffe0f0, 18, 16, 0.32, 0.5, 1.2);
    this.spot.position.set(this.star.x + 0.5, this.star.y + 7, 4);
    this.spot.target.position.set(this.star.x, this.star.y + 0.6, 0);
    sc.add(this.spot, this.spot.target);
    const beamGeo = new ConeGeometry(1.1, 9, 24, 1, true);
    beamGeo.translate(0, -4.5, 0);
    this.geos.push(beamGeo);
    for (const [sx, col] of [
      [-1, '#ff6fb0'],
      [1, '#5fe8ff'],
    ] as const) {
      const bm = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(col) }, uPower: { value: 0.22 } },
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      this.owned.push(bm);
      this.beams.push(bm);
      const beam = new Mesh(beamGeo, bm);
      const top = new Vector3(this.star.x + sx * 4.5, this.star.y + 7.5, -1.5);
      beam.position.copy(top);
      const dir = new Vector3(this.star.x, this.star.y, 0.2).sub(top).normalize();
      beam.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir);
      sc.add(beam);
    }

    // ── Confetti (pooled, instanced, tumbling).
    const qGeo = new PlaneGeometry(0.075, 0.12);
    this.geos.push(qGeo);
    const qMat = new MeshBasicMaterial({ side: DoubleSide });
    this.owned.push(qMat);
    this.confetti = new InstancedMesh(qGeo, qMat, CONFETTI);
    this.confetti.instanceColor = new InstancedBufferAttribute(new Float32Array(CONFETTI * 3), 3);
    this.confetti.frustumCulled = false;
    for (let i = 0; i < CONFETTI; i++) {
      _c.set(CONFETTI_COLS[i % CONFETTI_COLS.length]);
      this.cBase[i * 3] = _c.r;
      this.cBase[i * 3 + 1] = _c.g;
      this.cBase[i * 3 + 2] = _c.b;
      this.spawnRain(i, true);
    }
    sc.add(this.confetti);

    // ── Trophy + sparkles.
    if (this.mode === 'trophy') {
      const tr = buildTrophy(opts.trophyPlace ?? 1, this.owned, this.geos);
      this.trophy = tr.root;
      this.trophyMat = tr.mat;
      this.trophy.scale.setScalar(0.0001);
      (this.trophyStand?.holder ?? sc).add(this.trophy);
    }
    {
      // Four-point star, billboarded.
      const g = new BufferGeometry();
      const v: number[] = [];
      const R = 0.12;
      const r = 0.028;
      for (let k = 0; k < 4; k++) {
        const a0 = (k / 4) * Math.PI * 2;
        const a1 = a0 + Math.PI / 4;
        const a2 = a0 - Math.PI / 4;
        v.push(0, 0, 0, Math.cos(a2) * r, Math.sin(a2) * r, 0, Math.cos(a0) * R, Math.sin(a0) * R, 0);
        v.push(0, 0, 0, Math.cos(a0) * R, Math.sin(a0) * R, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
      }
      g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
      this.geos.push(g);
      const m = new MeshBasicMaterial({ color: 0xfff6c0, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      this.owned.push(m);
      this.sparkles = new InstancedMesh(g, m, SPARKLES);
      this.sparkles.frustumCulled = false;
      for (let i = 0; i < SPARKLES; i++) this.spawnSparkle(i, Math.random());
      sc.add(this.sparkles);
    }
    this.update(0, 16 / 9);
  }

  /** Pennant flags on a sagging line behind the podium (one merged mesh). */
  private bunting() {
    const pos: number[] = [];
    const col: number[] = [];
    const cols = ['#ff4f8b', '#ffd93a', '#3fe0ff', '#7dff3a', '#ffffff'];
    for (const [y0, z, x0, x1] of [
      [5.4, -2.6, -6.5, 6.5],
      [4.6, -3.6, -8, 8],
    ]) {
      const n = Math.round((x1 - x0) / 0.5);
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 0.8) / n;
        const xa = x0 + (x1 - x0) * u0;
        const xb = x0 + (x1 - x0) * u1;
        const ya = y0 - Math.sin(u0 * Math.PI) * 0.9;
        const yb = y0 - Math.sin(u1 * Math.PI) * 0.9;
        const xm = (xa + xb) / 2;
        const ym = (ya + yb) / 2 - 0.42;
        pos.push(xa, ya, z, xm, ym, z, xb, yb, z);
        _c.set(cols[i % cols.length]);
        for (let k = 0; k < 3; k++) col.push(_c.r, _c.g, _c.b);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    this.geos.push(g);
    const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.owned.push(m);
    return new Mesh(g, m);
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private spawnRain(i: number, initial: boolean) {
    const r = () => this.rnd();
    const p = this.cp;
    p[i * 3] = (r() - 0.5) * 11;
    p[i * 3 + 1] = initial ? 7 + r() * 9 : 7 + r() * 2;
    p[i * 3 + 2] = (r() - 0.6) * 5;
    this.cv[i * 3] = (r() - 0.5) * 0.6;
    this.cv[i * 3 + 1] = -0.6 - r() * 0.8;
    this.cv[i * 3 + 2] = (r() - 0.5) * 0.4;
    this.initSpin(i);
    this.cAlive[i] = 1;
  }

  /** Cannon burst from a side of the stage. */
  private spawnCannon(i: number, side: number) {
    const r = () => this.rnd();
    const p = this.cp;
    p[i * 3] = side * 3.4;
    p[i * 3 + 1] = 0.4;
    p[i * 3 + 2] = 1.2;
    this.cv[i * 3] = -side * (2 + r() * 3.5);
    this.cv[i * 3 + 1] = 9 + r() * 6;
    this.cv[i * 3 + 2] = (r() - 0.6) * 3;
    this.initSpin(i);
    this.cAlive[i] = 1;
  }

  private initSpin(i: number) {
    const r = () => this.rnd();
    _axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    this.ca[i * 3] = _axis.x;
    this.ca[i * 3 + 1] = _axis.y;
    this.ca[i * 3 + 2] = _axis.z;
    this.cr[i * 3] = r() * 6.28; // angle
    this.cr[i * 3 + 1] = 4 + r() * 8; // spin speed
    this.cr[i * 3 + 2] = r() * 6.28; // flutter phase
  }

  private spawnSparkle(i: number, age: number) {
    const s = this.sp;
    const a = Math.random() * Math.PI * 2;
    const rr = 0.25 + Math.random() * 0.75;
    s[i * 4] = Math.cos(a) * rr;
    s[i * 4 + 1] = (Math.random() - 0.3) * 0.9;
    s[i * 4 + 2] = Math.sin(a) * rr * 0.6;
    s[i * 4 + 3] = age;
  }

  private burst() {
    let n = 0;
    for (let i = 0; i < CONFETTI && n < 140; i++) {
      if (i % 2 === 0) continue;
      this.spawnCannon(i, n % 2 ? 1 : -1);
      n++;
    }
  }

  get done() {
    return this.t >= this.duration;
  }

  update(dt: number, aspect: number) {
    const t0 = this.t;
    this.t += dt;
    const t = this.t;
    const trophy = this.mode === 'trophy';
    // ── Cues.
    const cue = (at: number, bit: number) => t0 <= at && t > at && !(this.cues & bit) && ((this.cues |= bit), true);
    if (cue(0.05, 1)) {
      this.audio?.fanfare(trophy);
      this.audio?.crowdCheer(trophy ? 4 : 3);
    }
    if (cue(trophy ? 1.0 : 0.5, 2)) {
      this.burst();
      this.audio?.confettiPop();
    }
    if (cue(trophy ? 4.6 : 3.4, 4)) {
      this.burst();
      this.audio?.confettiPop();
    }

    this.rays.uniforms.uTime.value = t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.3);
    for (let i = 0; i < this.beams.length; i++) this.beams[i].uniforms.uPower.value = 0.16 + 0.1 * (i ? 1 - pulse : pulse);
    this.spot.intensity = 14 + pulse * 8;

    // ── Riders.
    for (const st of this.stands) {
      // Winner (or trophy lifter) hops; clappers bounce lightly.
      let hop = 0;
      if (st.pose === 'victory') {
        const ph = (t * 1.6) % 1;
        hop = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) * 0.26 : 0;
      } else if (st.pose === 'lift') {
        // One big jump as the trophy goes up, then small bounces.
        const j = t - 0.7;
        hop = j > 0 && j < 0.55 ? Math.sin((j / 0.55) * Math.PI) * 0.4 : j >= 0.55 ? Math.abs(Math.sin(t * 3.2)) * 0.05 : 0;
      } else if (st.pose === 'cheer') hop = Math.abs(Math.sin(t * 3 + st.base.x)) * 0.05;
      st.hop = hop;
      st.holder.position.set(st.base.x, st.base.y + hop, st.base.z);
      // A full spin on the winner's first big moment (race), facing the camera otherwise.
      let yaw = st.yaw;
      if (st.pose === 'victory' && !trophy) {
        const sp = t - 1.1;
        if (sp > 0 && sp < 0.9) yaw += ease(sp / 0.9) * Math.PI * 2;
      }
      st.holder.rotation.y = yaw;
      const b = st.boat as unknown as Record<string, number>;
      b.yawRate = Math.sin(t * 0.6 + st.base.x) * 0.4;
      b.sinceLand = 5;
      st.rider.update(st.boat, 0, dt, t + st.base.x * 0.7, false);
    }

    // ── Trophy: pops in, then rides in the lifter's hands.
    if (this.trophy && this.trophyMat) {
      this.trophyMat.uniforms.uTime.value = t;
      const st = this.trophyStand;
      const k = ease((t - 0.45) / 0.45);
      const pop = k * (1 + Math.sin(Math.min(1, Math.max(0, t - 0.45) / 0.6) * Math.PI) * 0.25);
      this.trophy.scale.setScalar(Math.max(1e-4, pop * TROPHY_SCALE));
      if (st) {
        const h = st.rider.hands;
        _p.addVectors(h[0], h[1]).multiplyScalar(0.5);
        // Plinth gripped at the sides, held just over the hair; before the lift it floats down into the hands.
        _p.y += -0.03 + (1 - k) * 0.6;
        _p.z += 0.1;
        this.trophy.position.copy(_p);
        this.trophy.rotation.y = Math.sin(t * 1.3) * 0.25;
      }
    }

    // ── Camera.
    const cam = this.camera;
    cam.aspect = aspect;
    const narrow = aspect < 1.25;
    const star = this.star;
    let ang: number;
    let rad: number;
    let hgt: number;
    let push: number;
    if (trophy) {
      // Low wide sweep, then a slow heroic push-in from slightly below.
      push = ease((t - 1.2) / 3.2);
      ang = -0.7 + t * 0.09;
      rad = 11 - push * 4.6;
      hgt = 2.6 - push * 0.6;
    } else {
      push = ease((t - 2.8) / 2.6);
      ang = -0.6 + t * 0.11;
      rad = 11 - push * 3.9;
      hgt = 3.4 - push * 0.7;
    }
    // Portrait: the vertical FOV is fixed, so pull back until the three steps fit across.
    if (narrow) rad *= Math.min(2.4, Math.max(1.35, 1.3 / aspect));
    _look.set(0, 1.5, 0).lerp(_tgt.set(star.x, star.y + (trophy ? 1.95 : 1.05), 0), push);
    cam.position.set(_look.x * 0.6 + Math.sin(ang) * rad, star.y * push * 0.6 + hgt, Math.cos(ang) * rad);
    cam.lookAt(_look);
    // Frame the podium beside / above the UI panel.
    if (this.layout === 'side' && !narrow) cam.setViewOffset(1000 * aspect, 1000, 1000 * aspect * 0.13, 0, 1000 * aspect, 1000);
    else cam.setViewOffset(1000 * aspect, 1000, 0, 1000 * (narrow ? 0.3 : 0.1), 1000 * aspect, 1000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    celShared.uSunView.value.copy(_sun).transformDirection(cam.matrixWorldInverse);

    // ── Confetti.
    const raining = this.raining;
    const cp = this.cp;
    const cv = this.cv;
    const col = this.confetti.instanceColor!.array as Float32Array;
    const drag = Math.exp(-dt * 2.6);
    for (let i = 0; i < CONFETTI; i++) {
      const j = i * 3;
      if (!this.cAlive[i]) {
        _m.makeScale(0, 0, 0);
        this.confetti.setMatrixAt(i, _m);
        continue;
      }
      cv[j] *= drag;
      cv[j + 2] *= drag;
      cv[j + 1] = cv[j + 1] * drag - 3.6 * dt;
      if (cv[j + 1] < -1.5) cv[j + 1] = -1.5;
      const ph = this.cr[j + 2];
      cp[j] += (cv[j] + Math.sin(t * 2.4 + ph) * 0.45) * dt;
      cp[j + 1] += cv[j + 1] * dt;
      cp[j + 2] += (cv[j + 2] + Math.cos(t * 1.9 + ph) * 0.25) * dt;
      this.cr[j] += this.cr[j + 1] * dt;
      if (cp[j + 1] < -0.05) {
        if (raining) this.spawnRain(i, false);
        else this.cAlive[i] = 0;
        continue;
      }
      _axis.set(this.ca[j], this.ca[j + 1], this.ca[j + 2]);
      _q.setFromAxisAngle(_axis, this.cr[j]);
      _p.set(cp[j], cp[j + 1], cp[j + 2]);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.confetti.setMatrixAt(i, _m);
      // Shimmer as the paper turns.
      const sh = 0.55 + 0.45 * Math.abs(Math.cos(this.cr[j]));
      col[j] = this.cBase[j] * sh;
      col[j + 1] = this.cBase[j + 1] * sh;
      col[j + 2] = this.cBase[j + 2] * sh;
    }
    this.confetti.instanceMatrix.needsUpdate = true;
    this.confetti.instanceColor!.needsUpdate = true;

    // ── Sparkles: around the trophy (trophy mode) or the winner's head.
    const spk = this.sparkles;
    if (spk) {
      _tgt.set(star.x, star.y + (trophy ? 0 : 1.9), 0);
      if (trophy && this.trophy && this.trophyStand) {
        this.trophy.getWorldPosition(_tgt);
        _tgt.y += 0.4;
      }
      const on = trophy ? clamp01((t - 0.5) * 2) : clamp01((t - 0.3) * 2) * 0.7;
      const spd = trophy ? 1.1 : 0.8;
      const s = this.sp;
      for (let i = 0; i < SPARKLES; i++) {
        const j = i * 4;
        s[j + 3] += dt * spd;
        if (s[j + 3] >= 1) this.spawnSparkle(i, s[j + 3] - 1);
        const a = s[j + 3];
        const life = Math.sin(a * Math.PI);
        const sz = life * life * on * (i % 3 === 0 ? 1.6 : 1) * (trophy ? 1 : 0.8);
        _p.set(_tgt.x + s[j] * (trophy ? 1 : 1.3), _tgt.y + s[j + 1] + a * 0.25, _tgt.z + s[j + 2]);
        _q.copy(cam.quaternion);
        _axis.set(0, 0, 1);
        _q.multiply(_tmpQ.setFromAxisAngle(_axis, a * 2 + i));
        _m.compose(_p, _q, _s.setScalar(Math.max(1e-4, sz)));
        spk.setMatrixAt(i, _m);
      }
      spk.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const st of this.stands) st.rider.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.owned) m.dispose();
    for (const t of this.texs) t.dispose();
    this.confetti.dispose();
    this.sparkles?.dispose();
    this.stands.length = 0;
    celShared.uRimColor.value.copy(this.saved.rimColor);
    celShared.uRim.value = this.saved.rim;
    celShared.uSpecColor.value.copy(this.saved.spec);
    celShared.uOutlineColor.value.copy(this.saved.outline);
    this.camera.clearViewOffset();
  }
}

const _tmpQ = new Quaternion();
