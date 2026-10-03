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
import { shade } from '../render/textures';
import type { Boat } from './boat';
import type { Livery } from './livery';

export const SUIT = 0x1d2030;
const SUIT_LIGHT = shade('#1d2030', 0.3);
const RUBBER = 0x15171d;
const STRAP = 0x111318;
const STEEL = 0x8c96a6;

/** Forward lean of the chest over the hips at rest. */
const T = 0.25;
const UPPER_ARM = 0.3;
const FOREARM = 0.3;
const THIGH = 0.46;
const SHIN = 0.45;
/** Hip joints relative to the pelvis centre. */
const HIP_X = 0.09;
const HIP_Y = -0.05;

const leanX = (x: number, y: number, z: number) => new Vector3(x, y * Math.cos(T) - z * Math.sin(T), y * Math.sin(T) + z * Math.cos(T));
/** Shoulder joints and neck base in torso space (left = +x). */
const SHOULDER = [leanX(0.18, 0.48, -0.005), leanX(-0.18, 0.48, -0.005)];
const NECK = leanX(0, 0.56, 0.0);

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

/** Torso cross-sections from the crotch to the base of the neck. */
const TORSO: [number, number, number, number][] = [
  [-0.11, 0.1, 0.08, -0.01],
  [-0.06, 0.155, 0.11, -0.015], // hips and seat
  [0.02, 0.16, 0.11, -0.01],
  [0.1, 0.145, 0.1, 0.0], // waist
  [0.18, 0.138, 0.098, 0.006],
  [0.27, 0.15, 0.108, 0.016], // lower ribs
  [0.36, 0.165, 0.118, 0.022], // chest
  [0.43, 0.172, 0.112, 0.018],
  [0.48, 0.168, 0.096, 0.004], // shoulder line
  [0.52, 0.12, 0.078, 0.0], // trapezius
  [0.56, 0.058, 0.055, 0.008], // neck base
];

/** Same shape, inflated a hair, over a height band (suit panels). */
function band(lo: number, hi: number, grow = 1.04) {
  const out: [number, number, number, number][] = [];
  for (const [a, w, d, o] of TORSO) if (a >= lo && a <= hi) out.push([a, w * grow, d * grow, o]);
  return out;
}

function buildTorso(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(loft(TORSO, 'y', 20), SUIT);
  // Racing-leathers colour yoke across chest and shoulders, a waist band,
  // and a spine hump on the back.
  gb.add(loft(band(0.36, 0.52, 1.035), 'y', 20), liv.hull);
  gb.add(loft(band(0.1, 0.18, 1.03), 'y', 20), liv.accent);
  gb.capsule(0.05, 0.22, SUIT_LIGHT, { y: 0.36, z: -0.1, sx: 1.3, sz: 0.6, rx: 0.08 });
  // Deltoids.
  for (const s of [-1, 1]) gb.sphere(0.06, liv.hull, { x: s * 0.175, y: 0.47, z: -0.005, sx: 1.05, sy: 1.0 }, 12, 8);
  // Collar.
  gb.cyl(0.062, 0.07, 0.04, liv.accent, { y: 0.555, z: 0.008 }, 14);
  const g = gb.build();
  g.rotateX(T);
  return g;
}

function buildHead(liv: Livery) {
  const gb = new GeoBuilder();
  // Neck up from the pivot; a full-face helmet centred above it.
  gb.cyl(0.048, 0.054, 0.12, SUIT, { y: 0.04 }, 12);
  const hy = 0.17;
  const hz = 0.025;
  const shell = { y: hy, z: hz, sy: 1.06, sz: 1.16 };
  gb.sphere(0.145, liv.hull, shell, 22, 16);
  // Visor: a tinted band across the face with a sky highlight.
  gb.add(new SphereGeometry(0.149, 20, 6, Math.PI / 2 - 0.95, 1.9, 1.2, 0.48), 0x0f1a2c, shell);
  gb.add(new SphereGeometry(0.151, 10, 2, Math.PI / 2 - 0.75, 0.45, 1.26, 0.1), 0x7cc4ff, shell);
  // Chin bar, a single crest stripe and the lower rim.
  gb.add(new SphereGeometry(0.152, 20, 4, Math.PI / 2 - 0.8, 1.6, 1.76, 0.38), liv.accent, shell);
  gb.torus(0.148, 0.014, liv.accent, { y: hy, z: hz, ry: Math.PI / 2, sx: 1.16, sy: 1.06 }, Math.PI);
  gb.torus(0.13, 0.016, STRAP, { y: hy - 0.1, z: hz - 0.01, rx: Math.PI / 2, sy: 1.15 });
  return gb.build();
}

function buildUpperArm(liv: Livery) {
  const gb = new GeoBuilder();
  // Shoulder ball → bicep → elbow. +Y = elbow tip side, so biceps sit in −Y.
  gb.add(
    loft(
      [
        [-0.02, 0.05, 0.05, 0],
        [0.04, 0.052, 0.054, -0.002],
        [0.13, 0.048, 0.054, -0.008],
        [0.22, 0.042, 0.044, -0.002],
        [UPPER_ARM, 0.04, 0.04, 0.004],
      ],
      'z',
    ),
    SUIT,
  );
  gb.sphere(0.042, SUIT, { z: UPPER_ARM }, 12, 8);
  // Sleeve stripe down the outside.
  gb.box(0.012, 0.03, UPPER_ARM * 0.8, liv.hull, { x: 0.048, z: UPPER_ARM * 0.48 });
  return gb.build();
}

function buildForearm(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(
    loft(
      [
        [0, 0.04, 0.04, 0],
        [0.07, 0.046, 0.044, 0.004],
        [0.17, 0.038, 0.034, 0],
        [FOREARM - 0.04, 0.032, 0.026, 0],
      ],
      'z',
    ),
    SUIT,
  );
  // Gauntlet glove: cuff, back of hand, curled fingers and thumb.
  gb.add(
    loft(
      [
        [FOREARM - 0.07, 0.04, 0.036, 0],
        [FOREARM - 0.02, 0.042, 0.036, 0],
        [FOREARM + 0.0, 0.036, 0.026, 0],
      ],
      'z',
      12,
    ),
    liv.hull,
  );
  gb.add(
    loft(
      [
        [FOREARM, 0.03, 0.022, 0],
        [FOREARM + 0.05, 0.042, 0.026, 0.004],
        [FOREARM + 0.09, 0.04, 0.03, 0],
      ],
      'z',
      12,
    ),
    RUBBER,
  );
  for (let f = 0; f < 4; f++) gb.capsule(0.012, 0.03, RUBBER, { x: -0.027 + f * 0.018, y: -0.02, z: FOREARM + 0.1, rx: 1.2 });
  gb.capsule(0.013, 0.035, RUBBER, { x: 0.03, y: -0.028, z: FOREARM + 0.05, rx: 0.9, rz: -0.4 });
  return gb.build();
}

function buildThigh(liv: Livery) {
  const gb = new GeoBuilder();
  // Hip → quads (front, +Y) → knee.
  gb.add(
    loft(
      [
        [-0.03, 0.075, 0.075, 0],
        [0.05, 0.082, 0.084, 0.004],
        [0.16, 0.076, 0.08, 0.008],
        [0.3, 0.064, 0.064, 0.004],
        [THIGH, 0.05, 0.052, 0.002],
      ],
      'z',
    ),
    SUIT,
  );
  gb.sphere(0.052, SUIT, { z: THIGH }, 12, 8);
  // Outer-thigh colour panel.
  gb.add(
    loft(
      [
        [0.06, 0.02, 0.05, 0],
        [0.2, 0.024, 0.05, 0],
        [0.36, 0.016, 0.036, 0],
      ],
      'z',
      10,
    ),
    liv.hull,
    { x: -0.07 },
  );
  return gb.build();
}

function buildShin(liv: Livery) {
  const gb = new GeoBuilder();
  // Knee → calf (back, −Y) → ankle.
  gb.add(
    loft(
      [
        [0, 0.05, 0.05, 0],
        [0.1, 0.05, 0.058, -0.012],
        [0.2, 0.046, 0.052, -0.01],
        [0.33, 0.036, 0.036, -0.002],
        [SHIN, 0.034, 0.034, 0],
      ],
      'z',
    ),
    SUIT,
  );
  // Small knee slider in the livery colour.
  gb.sphere(0.042, liv.hull, { y: 0.03, z: 0.01, sy: 0.6, sz: 1.2 }, 12, 8);
  return gb.build();
}

/** Boots: static, merged into the hull parts. */
export function addBoots(gb: GeoBuilder, deck: number, zRider: number) {
  for (const s of [-1, 1]) {
    const x = s * 0.17;
    // Shaft up the lower shin, then a slim foot with toe cap and sole.
    gb.cyl(0.044, 0.05, 0.24, RUBBER, { x, y: deck + 0.15, z: zRider + 0.1 }, 14);
    gb.add(
      loft(
        [
          [-0.06, 0.05, 0.05, 0.02],
          [0.02, 0.052, 0.055, 0.0],
          [0.12, 0.048, 0.04, -0.012],
          [0.2, 0.042, 0.032, -0.02],
        ],
        'z',
        14,
      ),
      RUBBER,
      { x, y: deck + 0.07, z: zRider + 0.1 },
    );
    gb.box(0.1, 0.022, 0.3, 0xd8d8d0, { x, y: deck + 0.013, z: zRider + 0.17 });
    gb.box(0.104, 0.018, 0.05, STEEL, { x, y: deck + 0.18, z: zRider + 0.1 });
  }
}
export function foothold(side: number, deck: number, zRider: number) {
  return new Vector3(side === 0 ? 0.17 : -0.17, deck + 0.19, zRider + 0.1);
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
    const mat = ghostMat ?? cel('riderBody', { vertexColors: true, gloss: 0.55 });
    this.torso = new Mesh(buildTorso(liv), mat);
    this.pelvis.add(this.torso);
    const headMesh = new Mesh(buildHead(liv), ghostMat ?? cel('riderHelmet', { vertexColors: true, gloss: 1 }));
    this.head.add(headMesh);
    this.head.position.copy(NECK);
    this.torso.add(this.head);
    const ua = buildUpperArm(liv);
    const fa = buildForearm(liv);
    const th = buildThigh(liv);
    const sh = buildShin(liv);
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
      solve(this.arms[side][0], this.arms[side][1], sh.clone(), grip.clone(), UPPER_ARM, FOREARM + 0.05, _pole.set(sg, -0.75, -0.45));
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
