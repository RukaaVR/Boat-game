/**
 * The rider: the "tiny base" stylised cartoon character (assets/models/
 * tinybase.fbx, converted by scripts/convert-rider.mjs into riderModel.json)
 * cut into rigid parts and driven by a small skeleton.
 *
 * Draw calls: torso (+ sleeves), head, and upper arm / forearm (+ watch and
 * hand) / thigh / shin per side. Arms reach the handlebar and legs reach the
 * fixed footholds with two-bone IK, so the figure flexes: knees soak up
 * landings, hips shift into turns, the head looks where the boat is going.
 * The model's one-piece limbs are split at the elbow and knee, with a joint
 * ball to fill the bend. Shoes stay in the boat's merged parts mesh.
 */

import { BufferAttribute, BufferGeometry, ConeGeometry, Euler, Group, Matrix4, Mesh, type Material, Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../core/mathx';
import { addOutline, cel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import type { Boat } from './boat';
import type { Livery } from './livery';
import MODEL from './riderModel.json';

type PartName = keyof typeof MODEL.parts;

/** Character palette — chosen per racer from the livery so the field varies. */
const SKINS = ['#ffdcc0', '#f6c79e', '#e0a878', '#b97a4e', '#8a5634', '#ffe6d2'];
const TROUSERS = ['#2f3d63', '#3b3b46', '#5a4632', '#2f5a4a', '#f0e6cc'];
const SHOES = ['#f6f3ea', '#2a2a32', '#c0392b', '#f2c94c'];
const HAIRS = ['#2a1d14', '#f2c94c', '#d2532e', '#1e1e2a', '#7b4b2a', '#eef0f4', '#6a4fb5', '#2f9a74', '#3a7bd5', '#e86aa6'];
const WATCH = '#20242e';
const EYE = '#1d2236';
export const SUIT = 0x1d2030;

/** Small stable hash of the livery so each racer gets the same look every race. */
function pick<T>(liv: Livery, arr: T[], salt: number) {
  const key = `${liv.hull}|${liv.accent}|${liv.number}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return arr[(h >>> 0) % arr.length];
}

// ── Rest-pose joints, in model space (metres, +Y up, +Z forward, left = +X) ──
const PELVIS = new Vector3(0, -0.16, 0);
const NECK_M = new Vector3(0, 0.33, -0.02);
const SHOULDER_M = [new Vector3(0.25, 0.22, 0), new Vector3(-0.25, 0.22, 0)];
const ELBOW_X = 0.45;
const WRIST_X = 0.62;
const HIP_M = [new Vector3(0.15, -0.16, 0), new Vector3(-0.15, -0.16, 0)];
const KNEE_Y = -0.46;
const ANKLE_Y = -0.76;
/** Palm centre past the wrist: where the IK puts the handlebar. */
const GRIP = 0.1;

/** Forward lean of the chest over the hips at rest. */
const T = 0.22;
const UPPER_ARM = ELBOW_X - SHOULDER_M[0].x;
const FOREARM = WRIST_X - ELBOW_X;
const THIGH = HIP_M[0].y - KNEE_Y;
const SHIN = KNEE_Y - ANKLE_Y;
/** Hip joints relative to the pelvis centre. */
const HIP_X = HIP_M[0].x;
const HIP_Y = 0;

const leanX = (v: Vector3) => new Vector3(v.x, v.y * Math.cos(T) - v.z * Math.sin(T), v.y * Math.sin(T) + v.z * Math.cos(T));
/** Shoulder joints and neck base in torso space (pelvis origin, leaned). */
const SHOULDER = SHOULDER_M.map((v) => leanX(v.clone().sub(PELVIS)));
const NECK = leanX(NECK_M.clone().sub(PELVIS));

/** A converted part as a fresh indexed geometry (model space). */
function part(name: PartName) {
  const d = MODEL.parts[name];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(d.p), 3));
  g.setIndex(d.i);
  return g;
}

/**
 * Keep only the triangles whose centroid passes `keep`, re-expressed in a
 * bone frame: origin `o`, +Z along `z`, +Y toward `y` (the bend side).
 */
function cut(g: BufferGeometry, keep: (c: Vector3) => boolean, o: Vector3, z: Vector3, y: Vector3) {
  const pos = g.getAttribute('position');
  const idx = g.getIndex()!;
  const X = new Vector3().crossVectors(y, z);
  // Shared vertices are kept shared so the normals come out smooth.
  const remap = new Map<number, number>();
  const out: number[] = [];
  const tris: number[] = [];
  const v = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx.getX(t + k)));
    if (!keep(c.multiplyScalar(1 / 3))) continue;
    for (let k = 0; k < 3; k++) {
      const i = idx.getX(t + k);
      let n = remap.get(i);
      if (n === undefined) {
        n = out.length / 3;
        remap.set(i, n);
        v.fromBufferAttribute(pos, i).sub(o);
        out.push(v.dot(X), v.dot(y), v.dot(z));
      }
      tris.push(n);
    }
  }
  const r = new BufferGeometry();
  r.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  r.setIndex(tris);
  r.computeVertexNormals();
  return r;
}

const ALL = () => true;
const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);
const BACK = new Vector3(0, 0, -1);
const DOWN = new Vector3(0, -1, 0);

function buildTorso(liv: Livery) {
  const gb = new GeoBuilder();
  // Sleeves ride on the upper arms (see buildUpperArm).
  gb.add(cut(part('torso'), ALL, PELVIS, FWD, UP), liv.hull);
  const g = gb.build();
  g.rotateX(T);
  return g;
}

function buildHead(liv: Livery) {
  const gb = new GeoBuilder();
  const skin = pick(liv, SKINS, 1);
  const head = part('head');
  gb.add(cut(head, ALL, NECK_M, FWD, UP), skin);
  // Simple painted eyes on the face, found from the mesh's front surface.
  const pos = head.getAttribute('position');
  for (const s of [-1, 1]) {
    let zMax = -1;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - s * 0.08) < 0.05 && Math.abs(pos.getY(i) - 0.53) < 0.06) zMax = Math.max(zMax, pos.getZ(i));
    gb.sphere(0.034, EYE, { x: s * 0.08, y: 0.53 - NECK_M.y, z: zMax - NECK_M.z - 0.008, sx: 0.8, sy: 1.3, sz: 0.4 }, 12, 8);
    gb.sphere(0.011, '#ffffff', { x: s * 0.08 + 0.01, y: 0.55 - NECK_M.y, z: zMax - NECK_M.z + 0.004, sz: 0.5 }, 6, 4);
  }
  addHair(gb, liv);
  return gb.build();
}

// ── Hair ──────────────────────────────────────────────────────────────────
/** Head centre and half-extents in model space (from the mesh bounds). */
const HEAD_C = new Vector3(0, 0.55, -0.035);
const HEAD_E = new Vector3(0.255, 0.235, 0.215);
const _q = new Quaternion();
const _e = new Euler();

/** Point on the head ellipsoid (head space) for elevation `el` and azimuth `az` (0 = front). */
function onHead(el: number, az: number, k = 1) {
  const c = HEAD_C.clone().sub(NECK_M);
  return new Vector3(Math.sin(az) * Math.cos(el) * HEAD_E.x * k + c.x, Math.sin(el) * HEAD_E.y * k + c.y, Math.cos(az) * Math.cos(el) * HEAD_E.z * k + c.z);
}

/** One faceted spike from `base` along `dir`. */
function spike(gb: GeoBuilder, col: string, base: Vector3, dir: Vector3, len: number, r: number, flat = 0.7) {
  dir.normalize();
  _q.setFromUnitVectors(UP, dir);
  _e.setFromQuaternion(_q, 'YXZ');
  const mid = base.clone().addScaledVector(dir, len / 2);
  gb.add(new ConeGeometry(r, len, 5, 1), col, { x: mid.x, y: mid.y, z: mid.z, rx: _e.x, ry: _e.y, rz: _e.z, sx: 1, sz: flat });
}

function addHair(gb: GeoBuilder, liv: Livery) {
  const col = pick(liv, HAIRS, 2);
  const style = pick(liv, [0, 1, 2], 5);
  // Cap: the head's own top surface, puffed out so it hugs the shape.
  // Hairline sits high on the forehead and low at the nape.
  const ctr = HEAD_C.clone().sub(NECK_M);
  const cap = cut(
    part('head'),
    (c) => {
      const u = c.clone().sub(HEAD_C).divide(HEAD_E);
      const front = u.z / Math.max(1e-3, Math.hypot(u.x, u.z));
      return u.y > (front > 0 ? 0.32 * front + 0.02 : 0.5 * front + 0.02) && Math.abs(u.x) < 1.05;
    },
    NECK_M,
    FWD,
    UP,
  );
  const pos = cap.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().sub(ctr).normalize();
    v.addScaledVector(d, 0.028);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  cap.computeVertexNormals();
  gb.add(cap, col);

  const sweep = new Vector3(0, 0.55, -1); // back and up
  const rnd = (i: number) => ((Math.sin(i * 12.9898 + liv.number * 3.1) * 43758.5453) % 1 + 1) % 1;
  // Crown and back: big spikes sweeping back.
  const rows: [number, number, number, number][] = [
    // [elevation, azimuth span, count, length]
    [1.0, 1.4, 3, 0.22],
    [0.6, 2.4, 4, 0.24],
    [0.2, 2.9, 5, 0.2],
    [-0.2, 2.0, 4, 0.15],
  ];
  let n = 0;
  for (const [el, span, count, len] of rows)
    for (let i = 0; i < count; i++) {
      const az = Math.PI + (count === 1 ? 0 : (i / (count - 1) - 0.5) * span);
      const base = onHead(el, az, 0.92);
      const out = base.clone().sub(ctr).normalize();
      // Mostly swept back, fanning slightly outward with the azimuth.
      const dir = out.multiplyScalar(0.55).addScaledVector(sweep, 1.3 + style * 0.15);
      dir.x += Math.sin(az) * 0.25;
      spike(gb, col, base, dir, len * (0.9 + rnd(n++) * 0.25) * (style === 2 ? 1.12 : 1), 0.09, 0.6);
    }
  // Top: a couple of tall spikes standing up and back.
  for (const [az, lean] of [
    [0.5, 0.35],
    [-0.4, 0.4],
    [0.0, 0.2],
  ] as const) {
    const base = onHead(1.15, az, 0.9);
    spike(gb, col, base, new Vector3(Math.sin(az) * 0.4, 1, -lean - 0.25), 0.2 + style * 0.04, 0.075);
  }
  // Sides: spikes flicking out and back above the ears.
  for (const s of [-1, 1])
    for (const [el, len] of [
      [0.55, 0.16],
      [0.2, 0.15],
    ] as const) {
      const base = onHead(el, s * 1.45, 0.92);
      spike(gb, col, base, new Vector3(s * 1, -0.15, -0.7), len, 0.06);
    }
  // Fringe: short spikes falling over the forehead.
  const fringe = style === 1 ? 4 : 5;
  for (let i = 0; i < fringe; i++) {
    const az = (i / (fringe - 1) - 0.5) * 1.6;
    const base = onHead(0.62, az, 0.95);
    const out = base.clone().sub(ctr).normalize();
    spike(gb, col, base, out.multiplyScalar(0.6).add(new Vector3(Math.sin(az) * 0.5, -1, 0.35)), 0.12 + rnd(n++) * 0.04, 0.055, 0.55);
  }
}

/** Upper arm (shoulder → elbow) for side 0 = left (+X), 1 = right. */
function buildUpperArm(side: number, liv: Livery) {
  const sg = side === 0 ? 1 : -1;
  const gb = new GeoBuilder();
  const dir = new Vector3(sg, 0, 0);
  gb.add(cut(part(side === 0 ? 'armL' : 'armR'), (c) => c.x * sg < ELBOW_X, SHOULDER_M[side], dir, BACK), pick(liv, SKINS, 1));
  gb.add(cut(part(side === 0 ? 'shoulderL' : 'shoulderR'), ALL, SHOULDER_M[side], dir, BACK), liv.accent);
  gb.sphere(0.048, pick(liv, SKINS, 1), { z: UPPER_ARM }, 10, 8); // elbow
  return gb.build();
}

/** Forearm with watch and hand, from the elbow. */
function buildForearm(side: number, liv: Livery) {
  const sg = side === 0 ? 1 : -1;
  const gb = new GeoBuilder();
  const skin = pick(liv, SKINS, 1);
  const elbow = new Vector3(sg * ELBOW_X, SHOULDER_M[side].y, 0);
  const dir = new Vector3(sg, 0, 0);
  gb.add(cut(part(side === 0 ? 'armL' : 'armR'), (c) => c.x * sg >= ELBOW_X, elbow, dir, BACK), skin);
  gb.add(cut(part(side === 0 ? 'watchL' : 'watchR'), ALL, elbow, dir, BACK), WATCH);
  gb.add(cut(part(side === 0 ? 'handL' : 'handR'), ALL, elbow, dir, BACK), skin);
  return gb.build();
}

function buildThigh(side: number, liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(cut(part(side === 0 ? 'legL' : 'legR'), (c) => c.y > KNEE_Y, HIP_M[side], DOWN, FWD), pick(liv, TROUSERS, 3));
  return gb.build();
}

function buildShin(side: number, liv: Livery) {
  const gb = new GeoBuilder();
  const knee = new Vector3(HIP_M[side].x, KNEE_Y, 0);
  gb.add(cut(part(side === 0 ? 'legL' : 'legR'), (c) => c.y <= KNEE_Y, knee, DOWN, FWD), pick(liv, TROUSERS, 3));
  gb.sphere(0.075, pick(liv, TROUSERS, 3), {}, 12, 8); // knee
  return gb.build();
}

/** The model's shoes: static, merged into the hull parts, ankles on the footholds. */
export function addBoots(gb: GeoBuilder, deck: number, zRider: number, liv: Livery) {
  for (let side = 0; side < 2; side++) {
    const f = foothold(side, deck, zRider);
    const ankle = new Vector3(HIP_M[side].x, ANKLE_Y, 0);
    gb.add(cut(part(side === 0 ? 'footL' : 'footR'), ALL, ankle, FWD, UP), pick(liv, SHOES, 4), { x: f.x, y: f.y, z: f.z });
  }
}
/** Ankle position over the deck: the model's sole sits on the deck. */
export function foothold(side: number, deck: number, zRider: number) {
  const soleToAnkle = ANKLE_Y - -0.983;
  return new Vector3(HIP_M[side].x, deck + soleToAnkle, zRider + 0.02);
}

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _pole = new Vector3();
const _mid = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _end = new Vector3();
const _tm = new Matrix4();

/** Place segment meshes `m1` (a→joint) and `m2` (joint→b) by two-bone IK. */
function solve(m1: Mesh, m2: Mesh, a: Vector3, b: Vector3, l1: number, l2: number, pole: Vector3) {
  _z.subVectors(b, a);
  const d = clamp(_z.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 1e-3);
  _z.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _pole.copy(pole).addScaledVector(_z, -pole.dot(_z)).normalize();
  _mid.copy(a).addScaledVector(_z, along).addScaledVector(_pole, h);
  // The far end lands at the clamped reach (hands never stretch the arm).
  _end.copy(a).addScaledVector(_z, d);
  orient(m1, a, _mid, _pole);
  orient(m2, _mid, _end, _pole);
}

/** Mesh at `from`, local +Z toward `to`, local +Y toward the pole. */
function orient(m: Mesh, from: Vector3, to: Vector3, pole: Vector3) {
  _z.subVectors(to, from).normalize();
  _y.copy(pole).addScaledVector(_z, -pole.dot(_z));
  if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
  _y.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  m.quaternion.setFromRotationMatrix(_m);
  m.position.copy(from);
}

export interface RiderAnchors {
  hip: Vector3;
  gripL: Vector3;
  gripR: Vector3;
  footL: Vector3;
  footR: Vector3;
}

export class Rider {
  readonly root = new Group();
  readonly pelvis = new Group();
  readonly head = new Group();
  readonly meshes: Mesh[] = [];
  private torso: Mesh;
  private arms: [Mesh, Mesh][];
  private legs: [Mesh, Mesh][];
  private lean = 0;
  private crouch = 0.42;
  private drop = 0.08;
  private shift = 0;
  private twist = 0;
  private headYaw = 0;
  private headPitch = 0;
  private bob = 0;
  private wave = 0;

  constructor(
    liv: Livery,
    private at: RiderAnchors,
    ghostMat: Material | null,
  ) {
    const mat = ghostMat ?? cel('riderBody', { vertexColors: true, gloss: 0.25 });
    this.torso = new Mesh(buildTorso(liv), mat);
    this.pelvis.add(this.torso);
    const headMesh = new Mesh(buildHead(liv), ghostMat ?? cel('riderHead', { vertexColors: true, gloss: 0.2 }));
    this.head.add(headMesh);
    this.head.position.copy(NECK);
    this.torso.add(this.head);
    this.arms = [0, 1].map((i) => [new Mesh(buildUpperArm(i, liv), mat), new Mesh(buildForearm(i, liv), mat)] as [Mesh, Mesh]);
    this.legs = [0, 1].map((i) => [new Mesh(buildThigh(i, liv), mat), new Mesh(buildShin(i, liv), mat)] as [Mesh, Mesh]);
    this.meshes.push(this.torso, headMesh, ...this.arms.flat(), ...this.legs.flat());
    if (!ghostMat) for (const m of this.meshes) addOutline(m, 1.6);
    this.root.add(this.pelvis, ...this.arms.flat(), ...this.legs.flat());
    this.pelvis.position.copy(at.hip);
  }

  /** LOD: 0 full, 1 no limb outlines, 2 torso + head only. */
  setLod(level: number) {
    for (const m of [...this.arms.flat(), ...this.legs.flat()]) m.visible = level < 2;
    for (const m of this.meshes) for (const c of m.children) if (c.userData.isOutline) c.visible = level < 1 || m === this.torso;
  }

  update(b: Boat, steer: number, dt: number, time: number, celebrate: boolean) {
    // ── Pose targets ────────────────────────────────────────────────────────
    const landK = b.sinceLand < 0.5 ? (1 - b.sinceLand / 0.5) * b.landStrength : 0;
    const turn = clamp(-b.yawRate * 0.32 + steer * 0.12, -0.55, 0.55) + (b.drifting ? b.driftDir * 0.15 : 0);
    let leanT = turn;
    let crouchT = 0.4 + 0.2 * b.boostLevel + 0.06 * b.engine + landK * 0.4;
    let dropT = 0.06 + 0.1 * b.boostLevel + landK * 0.28;
    let shiftT = clamp(turn * 0.22, -0.1, 0.1);
    let twistT = 0;
    let yawT = clamp(steer * 0.38 + b.yawRate * 0.12, -0.6, 0.6);
    let waveT = 0;
    if (b.airborne) {
      if (b.trick === 'frontflip' || b.trick === 'backflip') {
        crouchT = 0.95;
        dropT = 0.3;
      } else if (b.trick === 'spin') {
        crouchT = 0.6;
        dropT = 0.16;
        twistT = b.trickDir * 0.45;
        yawT = b.trickDir * 0.5;
      } else if (b.trick === 'roll') {
        crouchT = 0.75;
        dropT = 0.24;
        leanT = b.trickDir * 0.3;
      } else {
        // Stand up and spot the landing.
        crouchT = 0.2;
        dropT = 0.0;
      }
      shiftT *= 0.4;
    }
    if (b.wipeout > 0) {
      leanT = Math.sin(time * 11) * 0.6;
      crouchT = 0.9 + Math.sin(time * 7) * 0.3;
      dropT = 0.3;
      twistT = Math.sin(time * 5) * 0.5;
      yawT = Math.sin(time * 6) * 0.6;
    }
    if (celebrate) {
      crouchT = -0.05;
      dropT = -0.02;
      leanT = Math.sin(time * 3) * 0.12;
      yawT = Math.sin(time * 1.3) * 0.4;
      waveT = 1;
    }
    this.lean = damp(this.lean, leanT, 8, dt);
    this.crouch = damp(this.crouch, crouchT, 7, dt);
    this.drop = damp(this.drop, dropT, b.sinceLand < 0.15 ? 22 : 8, dt);
    this.shift = damp(this.shift, shiftT, 5, dt);
    this.twist = damp(this.twist, twistT, 6, dt);
    this.headYaw = damp(this.headYaw, yawT, 5, dt);
    this.wave = damp(this.wave, waveT, 4, dt);
    // Head counter-pitches against the crouch so the eyes stay on the horizon.
    this.headPitch = damp(this.headPitch, -this.crouch * 0.75 + 0.05, 9, dt);
    this.bob = damp(this.bob, b.airborne ? 0 : clamp(Math.abs(b.pitchRate) * 0.025, 0, 0.06), 10, dt);

    // ── Skeleton ────────────────────────────────────────────────────────────
    const h = this.at.hip;
    this.pelvis.position.set(h.x + this.shift, h.y - this.drop - this.bob, h.z - this.drop * 0.25);
    this.pelvis.updateMatrix();
    const breathe = 1 + Math.sin(time * 1.9) * 0.012;
    this.torso.rotation.set(this.crouch, this.twist, this.lean, 'YXZ');
    this.torso.scale.set(1, breathe, 1);
    this.torso.updateMatrix();
    this.head.rotation.set(this.headPitch, this.headYaw - this.twist * 0.6, -this.lean * 0.5, 'YXZ');
    _tm.multiplyMatrices(this.pelvis.matrix, this.torso.matrix);

    // Arms: shoulder → grip, elbows out and back.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      const sh = _a.copy(SHOULDER[side]).applyMatrix4(_tm);
      const grip = _b;
      if (this.wave > 0.05 && side === 1) {
        grip.set(sh.x - 0.25, sh.y + 0.62 * this.wave + Math.sin(time * 9) * 0.06, sh.z + 0.1 + Math.sin(time * 9) * 0.14);
        grip.lerp(this.at.gripR, 1 - this.wave);
      } else if (b.wipeout > 0) {
        grip.set(sg * 0.85, sh.y + 0.3 + Math.sin(time * 13 + side) * 0.35, sh.z - 0.15);
      } else grip.copy(side === 0 ? this.at.gripL : this.at.gripR);
      solve(this.arms[side][0], this.arms[side][1], sh.clone(), grip.clone(), UPPER_ARM, FOREARM + GRIP, _pole.set(sg, -0.75, -0.45));
    }
    // Legs: hip → foothold, knees forward and slightly out.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      const hip = _a.set(sg * HIP_X, HIP_Y, 0).add(this.pelvis.position);
      solve(this.legs[side][0], this.legs[side][1], hip.clone(), side === 0 ? this.at.footL : this.at.footR, THIGH, SHIN, _pole.set(sg * 0.25, 0.05, 1));
    }
  }

  dispose() {
    const seen = new Set<unknown>();
    for (const m of this.meshes)
      if (!seen.has(m.geometry)) {
        seen.add(m.geometry);
        m.geometry.dispose();
      }
  }
}
