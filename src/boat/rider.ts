/**
 * The rider: a jointed figure standing on the deck.
 *
 * Lofted, anatomically proportioned body (slim racing leathers, full-face
 * helmet). Rigid parts per draw call: torso (pelvis + chest), head (neck +
 * helmet), and upper arm / forearm / thigh / shin per side. Arms reach the
 * handlebar and legs reach the fixed footholds with two-bone IK, so the whole
 * figure flexes naturally: knees soak up landings, hips shift into turns,
 * the head looks where the boat is going. Boots stay in the boat's merged
 * parts mesh because they never move relative to the hull.
 */

import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, type Material, SphereGeometry, Vector3 } from 'three';
import { clamp, damp } from '../core/mathx';
import { addOutline, cel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import type { Boat } from './boat';
import type { Livery } from './livery';

/** Character palette — chosen per racer from the livery so the field varies. */
const SKINS = ['#ffdcc0', '#f6c79e', '#e0a878', '#b97a4e', '#8a5634', '#ffe6d2'];
const HAIRS = ['#3a2616', '#f2c94c', '#c0442b', '#1e1e28', '#7b4b2a', '#f4f0e8', '#6a4fb5', '#2f8f6a'];
const PANTS = '#f4ecd8';
const BOOT = '#7a4a2a';
const BOOT_SOLE = '#4a2c18';
const BELT = '#5a3a22';
const BUCKLE = '#ffd24a';
const EYE = '#1d2236';
const WHITE = '#ffffff';
const BLUSH = '#ff9aa6';
const LENS = '#7fd8ff';
const STRAP = '#2a2f3c';
export const SUIT = 0x1d2030;

/** Small stable hash of the livery so each racer gets the same look every race. */
function pick<T>(liv: Livery, arr: T[], salt: number) {
  const key = `${liv.hull}|${liv.accent}|${liv.number}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return arr[(h >>> 0) % arr.length];
}

/** Forward lean of the chest over the hips at rest. */
const T = 0.22;
const UPPER_ARM = 0.25;
const FOREARM = 0.24;
const HAND = 0.07;
const THIGH = 0.34;
const SHIN = 0.33;
/** Hip joints relative to the pelvis centre. */
const HIP_X = 0.085;
const HIP_Y = -0.04;
/** Head radius: chibi proportions, about a third of the figure. */
const HEAD_R = 0.25;

const leanX = (x: number, y: number, z: number) => new Vector3(x, y * Math.cos(T) - z * Math.sin(T), y * Math.sin(T) + z * Math.cos(T));
/** Shoulder joints and neck base in torso space (left = +x). */
const SHOULDER = [leanX(0.15, 0.28, 0), leanX(-0.15, 0.28, 0)];
const NECK = leanX(0, 0.34, 0.01);

/**
 * Lofted body part: elliptical cross-sections stacked along an axis, closed
 * at both ends, with smooth normals. Each section is [along, halfWidth,
 * halfDepth, offsetDepth]; for the torso the axis is +Y (depth = Z), for
 * limbs it is +Z (depth = Y, the bend side).
 */
function loft(sections: [number, number, number, number][], axis: 'y' | 'z', seg = 16) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = sections.length;
  for (const [a, w, d, o] of sections)
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const u = Math.sin(th) * w;
      const v = Math.cos(th) * d + o;
      if (axis === 'y') pos.push(u, a, v);
      else pos.push(u, v, a);
    }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      if (axis === 'y') idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  // End caps: a pole slightly beyond each end for a rounded close.
  const capOf = (si: number, dir: number) => {
    const [a, w, d, o] = sections[si];
    const p = pos.length / 3;
    const ext = Math.min(w, d) * 0.55 * dir;
    if (axis === 'y') pos.push(0, a + ext, o);
    else pos.push(0, o, a + ext);
    for (let k = 0; k < seg; k++) {
      const x = si * seg + k;
      const y = si * seg + ((k + 1) % seg);
      if ((dir > 0) === (axis === 'y')) idx.push(x, p, y);
      else idx.push(x, y, p);
    }
  };
  capOf(0, -1);
  capOf(n - 1, 1);
  // The rings above wind clockwise seen from outside; flip to face outward.
  for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Torso cross-sections from the seat to the base of the neck: a round tunic. */
const TORSO: [number, number, number, number][] = [
  [-0.08, 0.09, 0.07, -0.005],
  [-0.03, 0.135, 0.11, -0.01],
  [0.05, 0.145, 0.115, 0.0],
  [0.14, 0.142, 0.112, 0.008],
  [0.22, 0.138, 0.104, 0.008],
  [0.28, 0.122, 0.09, 0.0],
  [0.32, 0.08, 0.066, 0.0],
  [0.35, 0.04, 0.04, 0.0],
];

function buildTorso(liv: Livery) {
  const gb = new GeoBuilder();
  // Shorts below, tunic above, a flared hem, belt with a gold buckle.
  gb.add(loft(TORSO.slice(0, 3), 'y', 18), PANTS);
  gb.add(loft(TORSO.slice(2), 'y', 18), liv.hull);
  gb.add(
    loft(
      [
        [-0.04, 0.162, 0.13, -0.005],
        [0.03, 0.15, 0.12, 0],
        [0.06, 0.146, 0.117, 0],
      ],
      'y',
      18,
    ),
    liv.hull,
  );
  gb.cyl(0.15, 0.15, 0.035, BELT, { y: 0.05, sz: 0.8 }, 18);
  gb.box(0.05, 0.045, 0.02, BUCKLE, { y: 0.05, z: 0.122 });
  // Tunic trim and a chest emblem in the accent colour.
  gb.cyl(0.165, 0.165, 0.02, liv.accent, { y: -0.035, sz: 0.8 }, 18);
  gb.cyl(0.035, 0.035, 0.012, liv.accent, { x: 0.06, y: 0.2, z: 0.108, rx: Math.PI / 2 - 0.15 }, 12);
  // Scarf round the neck with two tails blowing back.
  gb.torus(0.07, 0.035, liv.accent, { y: 0.31, rx: Math.PI / 2, sy: 0.9 });
  gb.box(0.07, 0.2, 0.025, liv.accent, { x: 0.035, y: 0.24, z: -0.1, rx: -0.5, rz: 0.15 });
  gb.box(0.06, 0.16, 0.025, liv.accent, { x: -0.03, y: 0.25, z: -0.11, rx: -0.75, rz: -0.2 });
  // Puffy shoulders.
  for (const s of [-1, 1]) gb.sphere(0.07, liv.hull, { x: s * 0.14, y: 0.27, z: 0 }, 12, 8);
  const g = gb.build();
  g.rotateX(T);
  return g;
}

function buildHead(liv: Livery) {
  const gb = new GeoBuilder();
  const skin = pick(liv, SKINS, 1);
  const hair = pick(liv, HAIRS, 2);
  const R = HEAD_R;
  // Head centre above the neck pivot; slightly wide, flat-ish face.
  const hc = { y: 0.27, z: 0.02 };
  const shape = { sx: 1.04, sy: 0.96, sz: 0.94 };
  gb.cyl(0.05, 0.055, 0.08, skin, { y: 0.03 }, 12);
  gb.sphere(R, skin, { ...hc, ...shape }, 24, 18);
  // Point on the face surface for (x, y) offsets from the head centre.
  const face = (x: number, y: number, lift = 0) => {
    const zz = Math.sqrt(Math.max(0, 1 - (x / (R * shape.sx)) ** 2 - (y / (R * shape.sy)) ** 2)) * R * shape.sz;
    return { x, y: hc.y + y, z: hc.z + zz + lift };
  };
  // Big oval eyes with a white glint, eyebrows, nose, blush and a smile.
  for (const s of [-1, 1]) {
    const e = face(s * 0.085, -0.01, -0.012);
    gb.sphere(0.046, EYE, { ...e, sx: 0.78, sy: 1.25, sz: 0.45, ry: s * 0.35 }, 14, 10);
    const g1 = face(s * 0.085 + 0.016, 0.022, 0.006);
    gb.sphere(0.016, WHITE, { ...g1, sz: 0.5 }, 8, 6);
    const g2 = face(s * 0.085 - 0.012, -0.03, 0.004);
    gb.sphere(0.007, WHITE, { ...g2, sz: 0.5 }, 6, 4);
    const b = face(s * 0.09, 0.085, 0.004);
    gb.capsule(0.009, 0.05, hair, { ...b, rz: Math.PI / 2 + s * 0.18, sz: 0.6 });
    const c = face(s * 0.135, -0.075, -0.004);
    gb.sphere(0.03, BLUSH, { ...c, sy: 0.6, sz: 0.3, ry: s * 0.5 }, 10, 6);
    // Round ears.
    gb.sphere(0.045, skin, { x: s * R * 1.0, y: hc.y - 0.02, z: hc.z - 0.01, sx: 0.5, sy: 0.9 }, 10, 8);
  }
  gb.sphere(0.022, skin, { ...face(0, -0.055, -0.004), sy: 0.8 }, 10, 6);
  const m = face(0, -0.115, -0.006);
  gb.torus(0.03, 0.007, '#8a3a3a', { ...m, rz: Math.PI, sy: 0.7 }, Math.PI);
  // Hair: a cap over the top and back, a swept fringe of tufts, a back tuft.
  gb.add(new SphereGeometry(R * 1.05, 24, 12, 0, Math.PI * 2, 0, 0.95), hair, { ...hc, ...shape });
  gb.add(new SphereGeometry(R * 1.04, 20, 10, Math.PI / 2 + 1.1, Math.PI * 2 - 2.2, 0.9, 1.45), hair, { ...hc, ...shape });
  const tufts: [number, number, number, number][] = [
    [-0.12, 0.13, 0.3, 0.6],
    [-0.04, 0.15, 0.1, 0.35],
    [0.05, 0.15, -0.15, 0.4],
    [0.13, 0.12, -0.35, 0.55],
  ];
  for (const [x, y, rz, rx] of tufts) {
    const f = face(x, y, -0.02);
    gb.cone(0.055, 0.15, hair, { ...f, rx: Math.PI / 2 + rx, rz, sx: 1.2, sz: 0.6 }, 8);
  }
  // Messy clumps round the hairline so the silhouette reads as hair, not a helmet.
  const onHead = (theta: number, phi: number, k = 1) => ({
    x: -Math.cos(phi) * Math.sin(theta) * R * shape.sx * k,
    y: hc.y + Math.cos(theta) * R * shape.sy * k,
    z: hc.z + Math.sin(phi) * Math.sin(theta) * R * shape.sz * k,
  });
  for (let phi = Math.PI / 2 + 1.05; phi < Math.PI * 2.5 - 1.0; phi += 0.62) {
    gb.sphere(0.09, hair, { ...onHead(1.75, phi, 0.9), sx: 0.9, sy: 1.5, sz: 0.8, ry: -phi }, 12, 8);
  }
  // Spikes on the crown.
  for (const [th, ph, len] of [
    [0.35, 4.4, 0.16],
    [0.55, 3.6, 0.14],
    [0.55, 5.3, 0.14],
    [0.8, 4.7, 0.13],
  ] as const) {
    const p = onHead(th, ph, 0.95);
    gb.cone(0.06, len, hair, { ...p, rx: -th * Math.sin(ph) * -1, rz: th * Math.cos(ph) * -1, sz: 0.8 }, 7);
  }
  // Racing goggles pushed up on the forehead.
  const sr = R * Math.sqrt(1 - (0.12 / (R * shape.sy)) ** 2) * 1.07;
  gb.torus(sr, 0.016, STRAP, { y: hc.y + 0.12, z: hc.z, rx: Math.PI / 2, sx: shape.sx, sy: shape.sz });
  for (const s of [-1, 1]) {
    const g = face(s * 0.07, 0.13, 0.02);
    gb.cyl(0.05, 0.05, 0.035, liv.accent, { ...g, rx: Math.PI / 2 - 0.55 }, 14);
    gb.cyl(0.038, 0.038, 0.04, LENS, { ...g, y: g.y + 0.004, z: g.z + 0.006, rx: Math.PI / 2 - 0.55 }, 14);
  }
  return gb.build();
}

function buildUpperArm(liv: Livery) {
  const gb = new GeoBuilder();
  // Puffy sleeve in the tunic colour.
  gb.add(
    loft(
      [
        [-0.03, 0.05, 0.05, 0],
        [0.05, 0.058, 0.058, 0],
        [0.16, 0.052, 0.052, 0],
        [UPPER_ARM, 0.045, 0.045, 0],
      ],
      'z',
      14,
    ),
    liv.hull,
  );
  gb.cyl(0.05, 0.05, 0.02, liv.accent, { z: UPPER_ARM - 0.01, rx: Math.PI / 2 }, 14);
  return gb.build();
}

function buildForearm(liv: Livery) {
  const gb = new GeoBuilder();
  const skin = pick(liv, SKINS, 1);
  gb.add(
    loft(
      [
        [-0.02, 0.04, 0.04, 0],
        [0.08, 0.042, 0.04, 0],
        [FOREARM, 0.034, 0.032, 0],
      ],
      'z',
      12,
    ),
    skin,
  );
  // Fingerless glove cuff and a big round mitt of a hand with a thumb.
  gb.cyl(0.046, 0.042, 0.06, liv.accent, { z: FOREARM - 0.02, rx: Math.PI / 2 }, 12);
  gb.sphere(0.058, skin, { z: FOREARM + HAND * 0.6, sx: 1.0, sy: 0.85, sz: 1.05 }, 14, 10);
  gb.capsule(0.022, 0.035, skin, { x: 0.035, y: -0.02, z: FOREARM + 0.04, rx: 1.0, rz: -0.4 });
  return gb.build();
}

function buildThigh() {
  const gb = new GeoBuilder();
  gb.add(
    loft(
      [
        [-0.03, 0.07, 0.07, 0],
        [0.06, 0.075, 0.075, 0.004],
        [0.2, 0.065, 0.065, 0.002],
        [THIGH, 0.055, 0.055, 0],
      ],
      'z',
      14,
    ),
    PANTS,
  );
  gb.sphere(0.056, PANTS, { z: THIGH }, 12, 8);
  return gb.build();
}

function buildShin() {
  const gb = new GeoBuilder();
  gb.add(
    loft(
      [
        [0, 0.054, 0.054, 0],
        [0.1, 0.052, 0.056, -0.006],
        [SHIN, 0.045, 0.045, 0],
      ],
      'z',
      14,
    ),
    PANTS,
  );
  return gb.build();
}

/** Chunky cartoon boots: static, merged into the hull parts. */
export function addBoots(gb: GeoBuilder, deck: number, zRider: number) {
  for (const s of [-1, 1]) {
    const x = s * 0.16;
    gb.cyl(0.062, 0.07, 0.2, BOOT, { x, y: deck + 0.15, z: zRider + 0.08 }, 14);
    gb.cyl(0.075, 0.07, 0.04, BOOT_SOLE, { x, y: deck + 0.255, z: zRider + 0.08 }, 14); // turned-down cuff
    gb.sphere(0.09, BOOT, { x, y: deck + 0.08, z: zRider + 0.17, sx: 0.85, sy: 0.7, sz: 1.35 }, 14, 10);
    gb.box(0.15, 0.03, 0.3, BOOT_SOLE, { x, y: deck + 0.017, z: zRider + 0.16 });
  }
}
export function foothold(side: number, deck: number, zRider: number) {
  return new Vector3(side === 0 ? 0.16 : -0.16, deck + 0.22, zRider + 0.08);
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
    const ua = buildUpperArm(liv);
    const fa = buildForearm(liv);
    const th = buildThigh();
    const sh = buildShin();
    this.arms = [0, 1].map(() => [new Mesh(ua, mat), new Mesh(fa, mat)] as [Mesh, Mesh]);
    this.legs = [0, 1].map(() => [new Mesh(th, mat), new Mesh(sh, mat)] as [Mesh, Mesh]);
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
      solve(this.arms[side][0], this.arms[side][1], sh.clone(), grip.clone(), UPPER_ARM, FOREARM + HAND * 0.6, _pole.set(sg, -0.75, -0.45));
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
