/**
 * The rider: a jointed figure standing on the deck.
 *
 * Rigid parts per draw call: torso (pelvis + chest + vest), head (neck +
 * helmet), and upper arm / forearm / thigh / shin per side. Arms reach the
 * handlebar and legs reach the fixed footholds with two-bone IK, so the whole
 * figure flexes naturally: knees soak up landings, hips shift into turns,
 * the head looks where the boat is going. Boots stay in the boat's merged
 * parts mesh because they never move relative to the hull.
 */

import { Group, LatheGeometry, Matrix4, Mesh, type Material, SphereGeometry, Vector2, Vector3 } from 'three';
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
const UPPER_ARM = 0.34;
const FOREARM = 0.35;
const THIGH = 0.46;
const SHIN = 0.45;
/** Hip joints relative to the pelvis centre. */
const HIP_X = 0.11;
const HIP_Y = -0.05;

const leanX = (x: number, y: number, z: number) => new Vector3(x, y * Math.cos(T) - z * Math.sin(T), y * Math.sin(T) + z * Math.cos(T));
/** Shoulder joints and neck base in torso space (left = +x). */
const SHOULDER = [leanX(0.25, 0.52, 0), leanX(-0.25, 0.52, 0)];
const NECK = leanX(0, 0.64, 0.01);

/** Smooth body-of-revolution from a (radius, height) profile, closed at both ends. */
function lathe(profile: [number, number][], seg = 14) {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    seg,
  );
}

/**
 * A limb segment along +Z from 0 to `len`: rounded caps, a mid-length bulge.
 * Local +Y is the joint's bend direction (elbow tip / kneecap side).
 */
function limbGeo(len: number, r0: number, rMid: number, r1: number) {
  const g = lathe([
    [0, -r0],
    [r0 * 0.72, -r0 * 0.7],
    [r0, 0],
    [rMid, len * 0.38],
    [(rMid + r1) / 2, len * 0.72],
    [r1, len],
    [r1 * 0.72, len + r1 * 0.7],
    [0, len + r1],
  ]);
  g.rotateX(Math.PI / 2);
  return g;
}

function buildTorso(liv: Livery) {
  const gb = new GeoBuilder();
  // Pelvis + belt.
  gb.sphere(0.165, SUIT, { y: 0.0, sx: 1.25, sy: 0.85, sz: 0.95 }, 14, 8);
  gb.cyl(0.178, 0.178, 0.07, STRAP, { y: 0.1, sx: 1.2, sz: 0.88 }, 14);
  gb.box(0.09, 0.06, 0.03, STEEL, { y: 0.1, z: 0.16 });
  // Suit torso: waist → ribcage → chest → shoulders → neck.
  gb.add(
    lathe([
      [0, 0.04],
      [0.155, 0.06],
      [0.16, 0.16],
      [0.18, 0.28],
      [0.2, 0.4],
      [0.2, 0.48],
      [0.17, 0.56],
      [0.1, 0.62],
      [0, 0.64],
    ]),
    SUIT,
    { sx: 1.2, sz: 0.8 },
  );
  // Side panels in the livery colour below the vest.
  for (const s of [-1, 1]) gb.box(0.02, 0.16, 0.12, liv.hull, { x: s * 0.2, y: 0.18, z: 0, rz: s * 0.06 });
  // Life vest: open shell over chest and back, straps and buckles.
  gb.add(
    lathe([
      [0.19, 0.2],
      [0.205, 0.3],
      [0.222, 0.4],
      [0.218, 0.48],
      [0.186, 0.56],
      [0.14, 0.6],
    ]),
    liv.accent,
    { sx: 1.18, sz: 0.86 },
  );
  for (const y of [0.27, 0.38]) {
    gb.cyl(0.226, 0.226, 0.035, STRAP, { y, sx: 1.17, sz: 0.85 }, 16);
    gb.box(0.07, 0.045, 0.03, STEEL, { y, z: 0.195 });
  }
  gb.box(0.025, 0.36, 0.02, STRAP, { y: 0.42, z: 0.19 }); // zip
  // Back protector with the livery colour, ridged.
  for (let i = 0; i < 3; i++) gb.box(0.24 - i * 0.03, 0.09, 0.05, liv.hull, { y: 0.29 + i * 0.1, z: -0.185 - i * 0.004 });
  // Shoulder pads and collar.
  for (const s of [-1, 1]) gb.sphere(0.1, liv.hull, { x: s * 0.24, y: 0.52, z: 0, sx: 1.15, sy: 0.75 }, 12, 6);
  gb.torus(0.105, 0.03, liv.accent, { y: 0.6, rx: Math.PI / 2, sy: 0.85 });
  const g = gb.build();
  g.rotateX(T);
  return g;
}

function buildHead(liv: Livery) {
  const gb = new GeoBuilder();
  // Neck up from the pivot; helmet centred above it.
  gb.cyl(0.062, 0.07, 0.14, SUIT, { y: 0.05 });
  const hy = 0.2;
  const hz = 0.05;
  const shell = { y: hy, z: hz, sy: 1.04, sz: 1.1 };
  gb.sphere(0.2, liv.hull, shell, 18, 12);
  // Wrap-around visor with a sky highlight.
  gb.add(new SphereGeometry(0.206, 18, 6, Math.PI / 2 - 1.05, 2.1, 1.22, 0.52), 0x0f1a2c, shell);
  gb.add(new SphereGeometry(0.209, 12, 2, Math.PI / 2 - 0.85, 0.55, 1.28, 0.12), 0x7cc4ff, shell);
  // Visor hinge pivots.
  for (const s of [-1, 1]) {
    gb.cyl(0.04, 0.04, 0.03, STRAP, { x: s * 0.198, y: hy + 0.0, z: hz + 0.04, rz: Math.PI / 2 });
    gb.cyl(0.016, 0.016, 0.035, STEEL, { x: s * 0.205, y: hy + 0.0, z: hz + 0.04, rz: Math.PI / 2 });
  }
  // Chin guard, breath vent, crest stripe, top vents, and the lower rim.
  gb.add(new SphereGeometry(0.212, 18, 4, Math.PI / 2 - 0.85, 1.7, 1.78, 0.4), liv.accent, shell);
  gb.box(0.1, 0.025, 0.03, STRAP, { y: hy - 0.13, z: hz + 0.225, rx: 0.4 });
  gb.torus(0.204, 0.028, liv.accent, { y: hy, z: hz, ry: Math.PI / 2, sx: 1.1, sy: 1.04 }, Math.PI);
  for (const s of [-1, 1]) gb.box(0.03, 0.02, 0.09, STRAP, { x: s * 0.06, y: hy + 0.2, z: hz + 0.07, rx: 0.35 });
  gb.torus(0.19, 0.022, STRAP, { y: hy - 0.12, z: hz - 0.01, rx: Math.PI / 2, sy: 1.1 });
  return gb.build();
}

function buildUpperArm(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(limbGeo(UPPER_ARM, 0.082, 0.086, 0.066), SUIT);
  // Elbow pad on the bend side, sleeve stripe.
  gb.sphere(0.06, liv.hull, { y: 0.045, z: UPPER_ARM, sy: 0.6 }, 10, 6);
  gb.cyl(0.08, 0.075, 0.03, SUIT_LIGHT, { z: UPPER_ARM * 0.35, rx: Math.PI / 2 }, 12);
  return gb.build();
}

function buildForearm(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(limbGeo(FOREARM, 0.064, 0.07, 0.054), SUIT);
  // Glove: flared cuff in the livery colour, a fist and thumb.
  gb.cyl(0.072, 0.064, 0.08, liv.hull, { z: FOREARM - 0.03, rx: Math.PI / 2 }, 12);
  gb.sphere(0.07, RUBBER, { z: FOREARM + 0.06, sx: 0.85, sy: 0.95, sz: 1.05 }, 12, 8);
  gb.capsule(0.022, 0.05, RUBBER, { x: 0.0, y: -0.05, z: FOREARM + 0.07, rx: 0.9 });
  for (let i = 0; i < 3; i++) gb.box(0.11, 0.012, 0.02, 0x2a2e38, { y: 0.06 - i * 0.02, z: FOREARM + 0.11 });
  return gb.build();
}

function buildThigh(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(limbGeo(THIGH, 0.1, 0.112, 0.082), SUIT);
  // Outer-thigh panel.
  gb.capsule(0.05, THIGH * 0.5, liv.hull, { x: 0, y: -0.07, z: THIGH * 0.5, rx: Math.PI / 2, sx: 1.4, sy: 1, sz: 0.5 });
  return gb.build();
}

function buildShin(liv: Livery) {
  const gb = new GeoBuilder();
  gb.add(limbGeo(SHIN, 0.08, 0.086, 0.062), SUIT);
  // Kneecap pad and a shin guard down the front (+Y = knee side).
  gb.sphere(0.088, liv.hull, { y: 0.03, z: 0.0, sy: 0.8 }, 12, 8);
  gb.box(0.11, 0.035, SHIN * 0.62, liv.hull, { y: 0.07, z: SHIN * 0.42 });
  gb.box(0.07, 0.01, SHIN * 0.5, shade(liv.hull, -0.25), { y: 0.09, z: SHIN * 0.42 });
  return gb.build();
}

/** Boots: static, merged into the hull parts. */
export function addBoots(gb: GeoBuilder, deck: number, zRider: number) {
  for (const s of [-1, 1]) {
    const x = s * 0.21;
    gb.cyl(0.085, 0.09, 0.2, RUBBER, { x, y: deck + 0.13, z: zRider + 0.12 }, 10);
    gb.box(0.17, 0.11, 0.32, RUBBER, { x, y: deck + 0.08, z: zRider + 0.2 });
    gb.sphere(0.085, RUBBER, { x, y: deck + 0.07, z: zRider + 0.35, sy: 0.65 }, 10, 6);
    gb.box(0.18, 0.035, 0.42, 0xd8d8d0, { x, y: deck + 0.02, z: zRider + 0.21 });
    gb.box(0.175, 0.025, 0.06, 0x8c96a6, { x, y: deck + 0.17, z: zRider + 0.2 }); // buckle strap
  }
}
export function foothold(side: number, deck: number, zRider: number) {
  return new Vector3(side === 0 ? 0.21 : -0.21, deck + 0.17, zRider + 0.12);
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
    this.head.scale.setScalar(0.93);
    this.torso.add(this.head);
    const ua = buildUpperArm(liv);
    const fa = buildForearm(liv);
    const th = buildThigh(liv);
    const sh = buildShin(liv);
    this.arms = [0, 1].map(() => [new Mesh(ua, mat), new Mesh(fa, mat)] as [Mesh, Mesh]);
    this.legs = [0, 1].map(() => [new Mesh(th, mat), new Mesh(sh, mat)] as [Mesh, Mesh]);
    this.meshes.push(this.torso, headMesh, ...this.arms.flat(), ...this.legs.flat());
    if (!ghostMat) for (const m of this.meshes) addOutline(m, 2.0);
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
      solve(this.arms[side][0], this.arms[side][1], sh.clone(), grip.clone(), UPPER_ARM, FOREARM, _pole.set(sg, -0.75, -0.45));
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
