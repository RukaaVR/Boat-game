/**
 * Procedural watercraft visuals: lofted hulls, per-style superstructure, a
 * livery texture, an articulated rider, nav lights and a boost flame.
 *
 * Draw calls per boat: hull, parts, rider upper body, two arms (each + outline),
 * lights and flame. Everything that does not move relative to the hull (legs,
 * console, fins, engine) is merged into `parts` with vertex colours.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { clamp, damp, smoothstep } from '../core/mathx';
import { addOutline, cel, makeCel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import { paintLivery, shade } from '../render/textures';
import type { Boat } from './boat';
import type { Livery } from './livery';
import type { BoatSpec, HullStyle } from './specs';

interface HullShape {
  L: number;
  B: number;
  depth: number;
  sheerStern: number;
  sheerBow: number;
  /** Fraction of length where the bow entry begins to narrow. */
  entry: number;
  /** Transom width relative to max beam. */
  transom: number;
  crown: number;
  offsetX: number;
}

function hullShapes(spec: BoatSpec): HullShape[] {
  const L = spec.length;
  const B = spec.beam;
  const base = { L, B, crown: 0.07, offsetX: 0 };
  switch (spec.hull) {
    case 'needle':
      return [{ ...base, depth: 0.34, sheerStern: 0.26, sheerBow: 0.42, entry: 0.32, transom: 0.8 }];
    case 'skiff':
      return [{ ...base, depth: 0.26, sheerStern: 0.36, sheerBow: 0.62, entry: 0.62, transom: 0.95 }];
    case 'catamaran':
      return [-1, 1].map((s) => ({ ...base, B: B * 0.34, depth: 0.36, sheerStern: 0.3, sheerBow: 0.5, entry: 0.5, transom: 0.85, crown: 0.05, offsetX: s * B * 0.33 }));
    case 'wing':
      return [
        { ...base, B: B * 0.5, depth: 0.32, sheerStern: 0.3, sheerBow: 0.46, entry: 0.45, transom: 0.85 },
        ...[-1, 1].map((s) => ({ ...base, L: L * 0.62, B: B * 0.22, depth: 0.22, sheerStern: 0.2, sheerBow: 0.34, entry: 0.4, transom: 0.8, crown: 0.04, offsetX: s * B * 0.4 })),
      ];
    case 'deepv':
      return [{ ...base, depth: 0.52, sheerStern: 0.38, sheerBow: 0.78, entry: 0.5, transom: 0.86 }];
    default:
      return [{ ...base, depth: 0.38, sheerStern: 0.32, sheerBow: 0.56, entry: 0.52, transom: 0.88 }];
  }
}

function sheerAt(h: HullShape, t: number) {
  return h.sheerStern + (h.sheerBow - h.sheerStern) * t * t;
}
function beamAt(h: HullShape, t: number) {
  const half = h.B * 0.5;
  if (t < h.entry) return half * (h.transom + (1 - h.transom) * smoothstep(0, h.entry * 0.6, t));
  const u = (t - h.entry) / (1 - h.entry);
  return half * Math.pow(Math.max(0, Math.cos(u * Math.PI * 0.5)), 0.8);
}
function keelAt(h: HullShape, t: number) {
  const rise = Math.pow(smoothstep(0.55, 1, t), 1.4);
  return -h.depth + (sheerAt(h, 1) - 0.18 + h.depth) * rise;
}
function chineAt(h: HullShape, t: number) {
  const rise = smoothstep(0.62, 1, t);
  return -h.depth * 0.32 + (sheerAt(h, 1) - 0.1 + h.depth * 0.32) * rise;
}

/** Deck height at a station (for placing parts). */
function deckAt(h: HullShape, t: number) {
  return sheerAt(h, t) + h.crown;
}

const SECTION_V = [0, 0.17, 0.17, 0.44, 0.44, 0.47, 0.5, 0.53, 0.56, 0.56, 0.83, 0.83, 1];

function loftHull(h: HullShape, stations = 30): BufferGeometry {
  const S = SECTION_V.length;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1);
    const z = (t - 0.5) * h.L;
    const bw = beamAt(h, t);
    const kl = keelAt(h, t);
    const ch = Math.min(chineAt(h, t), sheerAt(h, t) - 0.05);
    const sh = sheerAt(h, t);
    const cr = h.crown * (bw / (h.B * 0.5 + 1e-6));
    const pts: [number, number][] = [
      [0, kl],
      [bw * 0.93, ch],
      [bw * 0.93, ch],
      [bw, sh],
      [bw, sh],
      [bw * 0.8, sh + 0.035],
      [0, sh + cr],
      [-bw * 0.8, sh + 0.035],
      [-bw, sh],
      [-bw, sh],
      [-bw * 0.93, ch],
      [-bw * 0.93, ch],
      [0, kl],
    ];
    for (let j = 0; j < S; j++) {
      pos.push(pts[j][0] + h.offsetX, pts[j][1], z);
      uv.push(t, SECTION_V[j]);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < stations - 1; i++)
    for (let j = 0; j < S - 1; j++) {
      const a = i * S + j;
      const b = (i + 1) * S + j;
      const c = i * S + j + 1;
      const d = (i + 1) * S + j + 1;
      idx.push(a, c, b, c, d, b);
    }
  // Transom cap.
  const cIdx = pos.length / 3;
  const t0kl = keelAt(h, 0);
  pos.push(h.offsetX, (t0kl + sheerAt(h, 0)) * 0.5, -0.5 * h.L);
  uv.push(0.01, 0.5);
  for (let j = 0; j < S - 1; j++) idx.push(cIdx, j + 1, j);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mergeHulls(geos: BufferGeometry[]) {
  if (geos.length === 1) return geos[0];
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.getAttribute('position').count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
    nrm.set(g.getAttribute('normal').array as Float32Array, vo * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, vo * 2);
    const gi = g.index!.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.getAttribute('position').count;
    io += gi.length;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  return out;
}

const DARK = 0x23262e;
const STEEL = 0x8c96a6;
const SUIT = 0x1d2030;
const SKIN = 0xe0a983;

interface RiderRig {
  hipLocal: Vector3;
  gripL: Vector3;
  gripR: Vector3;
  deckY: number;
  nozzle: Vector3;
}

function buildParts(spec: BoatSpec, liv: Livery, shapes: HullShape[]): { geo: BufferGeometry; rig: RiderRig } {
  const gb = new GeoBuilder();
  const main = shapes[0];
  const L = spec.length;
  const accent = liv.accent;
  const hullCol = liv.hull;
  const tRider = 0.36;
  const zRider = (tRider - 0.5) * main.L;
  const deck = deckAt(main, tRider);
  const tCon = 0.55;
  const zCon = (tCon - 0.5) * main.L;
  const deckCon = deckAt(main, tCon);

  // Console + steering column + handlebar.
  gb.box(0.62, 0.36, 0.55, DARK, { y: deckCon + 0.14, z: zCon, rx: -0.25 });
  gb.cyl(0.05, 0.06, 0.55, STEEL, { y: deckCon + 0.5, z: zCon - 0.12, rx: -0.5 });
  const barY = deckCon + 0.78;
  const barZ = zCon - 0.24;
  gb.cyl(0.035, 0.035, 0.78, DARK, { y: barY, z: barZ, rz: Math.PI / 2 });
  gb.box(0.5, 0.05, 0.12, accent, { y: deckCon + 0.34, z: zCon + 0.2, rx: -0.4 });
  // Seat pad behind the rider.
  gb.box(0.5, 0.16, 0.9, DARK, { y: deck + 0.06, z: zRider - 0.45 });
  // Jet nozzle / outboard.
  const nozzle = new Vector3(main.offsetX, -0.06, -0.5 * main.L - 0.16);
  if (spec.hull === 'catamaran') {
    for (const s of [-1, 1]) {
      gb.cyl(0.16, 0.2, 0.45, DARK, { x: shapes[s < 0 ? 0 : 1].offsetX, y: 0.0, z: -0.5 * L - 0.12, rx: Math.PI / 2 });
    }
    nozzle.x = 0;
  } else {
    gb.cyl(0.15, 0.2, 0.4, DARK, { y: -0.04, z: -0.5 * main.L - 0.1, rx: Math.PI / 2 });
    gb.cyl(0.17, 0.17, 0.06, accent, { y: -0.04, z: -0.5 * main.L - 0.3, rx: Math.PI / 2 });
  }

  switch (spec.hull) {
    case 'needle':
      // Twin tail fins + low spoiler.
      for (const s of [-1, 1]) gb.box(0.05, 0.55, 0.7, accent, { x: s * 0.42, y: deckAt(main, 0.06) + 0.26, z: -0.5 * L + 0.4, rz: s * 0.2, rx: 0.25 });
      gb.box(1.0, 0.05, 0.32, accent, { y: deckAt(main, 0.06) + 0.5, z: -0.5 * L + 0.32 });
      gb.box(0.08, 0.04, L * 0.5, accent, { y: deckAt(main, 0.75) + 0.02, z: L * 0.22 });
      break;
    case 'skiff':
      // Bumper rails and a tall grab bar.
      for (const s of [-1, 1]) gb.cyl(0.06, 0.06, L * 0.7, accent, { x: s * main.B * 0.5, y: sheerAt(main, 0.4) + 0.02, z: -0.1, rx: Math.PI / 2 });
      gb.torus(0.3, 0.035, STEEL, { y: deck + 0.25, z: zRider - 0.75, ry: Math.PI / 2 }, Math.PI);
      break;
    case 'catamaran': {
      // Bridge deck between pontoons, cross beams, roll cage.
      const top = Math.max(deckAt(shapes[0], 0.5), 0.36);
      gb.box(spec.beam * 0.62, 0.14, L * 0.62, hullCol, { y: top - 0.04, z: -0.15 });
      for (const zz of [-0.3, 0.12, 0.35]) gb.box(spec.beam * 0.9, 0.1, 0.14, accent, { y: top + 0.04, z: zz * L });
      for (const s of [-1, 1]) {
        gb.cyl(0.04, 0.04, 1.3, STEEL, { x: s * 0.55, y: top + 0.65, z: zRider - 0.6 });
        gb.cyl(0.04, 0.04, 1.3, STEEL, { x: s * 0.55, y: top + 0.65, z: zRider + 0.7, rx: -0.25 });
      }
      gb.cyl(0.04, 0.04, 1.1, STEEL, { y: top + 1.28, z: zRider - 0.6, rz: Math.PI / 2 });
      gb.cyl(0.04, 0.04, 1.4, STEEL, { x: 0.55, y: top + 1.28, z: zRider + 0.05, rx: Math.PI / 2 });
      gb.cyl(0.04, 0.04, 1.4, STEEL, { x: -0.55, y: top + 1.28, z: zRider + 0.05, rx: Math.PI / 2 });
      break;
    }
    case 'wing': {
      // Rear wing on struts and vertical stabilisers.
      const wy = deckAt(main, 0.1) + 0.72;
      for (const s of [-1, 1]) {
        gb.box(0.06, 0.62, 0.22, DARK, { x: s * 0.5, y: wy - 0.32, z: -0.5 * L + 0.55 });
        gb.box(0.06, 0.5, 0.55, accent, { x: s * spec.beam * 0.47, y: wy, z: -0.5 * L + 0.5 });
        // Sponson struts.
        gb.box(spec.beam * 0.3, 0.08, 0.5, DARK, { x: s * spec.beam * 0.25, y: 0.24, z: -0.2 });
      }
      gb.box(spec.beam * 0.95, 0.07, 0.5, accent, { y: wy + 0.05, z: -0.5 * L + 0.5, rx: -0.1 });
      gb.box(spec.beam * 0.9, 0.04, 0.5, hullCol, { y: 0.32, z: L * 0.3, rx: 0.08 });
      break;
    }
    case 'deepv':
      // Offshore canopy + bow rail.
      gb.box(0.95, 0.42, 1.1, 0x16202e, { y: deckCon + 0.45, z: zCon + 0.1, rx: -0.35 });
      gb.box(1.0, 0.06, 1.15, accent, { y: deckCon + 0.68, z: zCon + 0.05, rx: -0.35 });
      for (const s of [-1, 1]) gb.cyl(0.035, 0.035, L * 0.35, STEEL, { x: s * main.B * 0.36, y: sheerAt(main, 0.82) + 0.18, z: L * 0.3, rx: Math.PI / 2 + 0.25 });
      gb.box(0.3, 0.5, 0.28, DARK, { y: deckAt(main, 0.08) + 0.25, z: -0.5 * L + 0.4 });
      break;
    default:
      // Runabout: windscreen + side vents.
      gb.box(0.9, 0.04, 0.5, 0x2a3d55, { y: deckCon + 0.42, z: zCon + 0.22, rx: -0.9 });
      for (const s of [-1, 1]) gb.box(0.04, 0.12, 0.6, accent, { x: s * main.B * 0.47, y: sheerAt(main, 0.3) - 0.08, z: -0.2 * L });
  }

  // Rider legs (static relative to the hull): feet → knees → hips.
  const hip = new Vector3(0, deck + 0.82, zRider - 0.02);
  for (const s of [-1, 1]) {
    const foot = new Vector3(s * 0.2, deck + 0.05, zRider + 0.12);
    const knee = new Vector3(s * 0.19, deck + 0.46, zRider + 0.36);
    limb(gb, foot, knee, 0.085, SUIT);
    limb(gb, knee, new Vector3(s * 0.13, hip.y, hip.z), 0.1, SUIT);
    gb.box(0.14, 0.1, 0.3, shade(liv.hull, -0.2), { x: s * 0.2, y: deck + 0.05, z: zRider + 0.16 });
  }
  gb.sphere(0.17, SUIT, { y: hip.y, z: hip.z, sx: 1.25, sy: 0.8 });

  const rig: RiderRig = {
    hipLocal: hip,
    gripL: new Vector3(0.36, barY, barZ),
    gripR: new Vector3(-0.36, barY, barZ),
    deckY: deck,
    nozzle,
  };
  return { geo: gb.build(), rig };
}

const _dir = new Vector3();
const _yAxis = new Vector3(0, 1, 0);
const _ql = new Quaternion();

function limb(gb: GeoBuilder, a: Vector3, b: Vector3, r: number, col: number) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  _ql.setFromUnitVectors(_yAxis, _dir.normalize());
  const e = new Euler().setFromQuaternion(_ql, 'YXZ');
  gb.capsule(r, Math.max(0.01, len - r), col, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, rx: e.x, ry: e.y, rz: e.z });
}

function buildUpperBody(liv: Livery) {
  const gb = new GeoBuilder();
  // Torso leaning forward from the hip pivot (origin).
  gb.capsule(0.2, 0.42, SUIT, { y: 0.3, z: 0.05, sx: 1.15, sz: 0.85, rx: 0.25 });
  gb.box(0.3, 0.32, 0.06, liv.accent, { y: 0.34, z: 0.22, rx: 0.25 });
  gb.box(0.44, 0.1, 0.24, liv.hull, { y: 0.56, z: 0.12, rx: 0.25 }); // shoulder pads
  // Helmet + visor + chin.
  gb.sphere(0.2, liv.hull, { y: 0.84, z: 0.22, sy: 1.05 }, 14, 10);
  gb.box(0.3, 0.1, 0.12, 0x0c0f18, { y: 0.84, z: 0.38 });
  gb.box(0.04, 0.2, 0.36, liv.accent, { y: 0.98, z: 0.2 });
  gb.sphere(0.07, SKIN, { y: 0.66, z: 0.25 });
  return gb.build();
}

function armGeometry() {
  const g = new CapsuleGeometry(0.075, 0.85, 3, 8);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  g.scale(1, 1, 1 / 1.0);
  return g;
}

const _q = new Quaternion();
const _qt = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _sh = new Vector3();
const _grip = new Vector3();

export class BoatVisual {
  readonly root = new Group();
  readonly hull: Mesh;
  readonly parts: Mesh;
  readonly upper = new Group();
  readonly armL: Mesh;
  readonly armR: Mesh;
  readonly flame: Mesh;
  readonly lights: Mesh;
  readonly rig: RiderRig;
  private livTex: CanvasTexture;
  private lean = 0;
  private crouch = 0.4;
  private bob = 0;
  celebrate = false;
  ghost = false;

  constructor(
    public spec: BoatSpec,
    public livery: Livery,
    opts: { ghost?: boolean } = {},
  ) {
    this.ghost = !!opts.ghost;
    const shapes = hullShapes(spec);
    const hullGeo = mergeHulls(shapes.map((s) => loftHull(s)));
    this.livTex = paintLivery(livery);
    const hullMat = this.ghost
      ? cel(`ghost_hull`, { color: 0x9ff4ff, transparent: true, opacity: 0.35, rim: 2 })
      : makeCel({ map: this.livTex, gloss: 1, rim: 1.2 });
    this.hull = new Mesh(hullGeo, hullMat);
    this.hull.name = 'hull';
    const { geo, rig } = buildParts(spec, livery, shapes);
    this.rig = rig;
    const partsMat = this.ghost ? hullMat : cel('boatParts', { vertexColors: true, gloss: 0.6 });
    this.parts = new Mesh(geo, partsMat);
    const upperMesh = new Mesh(buildUpperBody(livery), this.ghost ? hullMat : cel('riderBody', { vertexColors: true, gloss: 0.5 }));
    this.upper.add(upperMesh);
    this.upper.position.copy(rig.hipLocal);
    const armMat = this.ghost ? hullMat : cel('riderArm', { color: SUIT });
    this.armL = new Mesh(armGeometry(), armMat);
    this.armR = new Mesh(armGeometry(), armMat);
    if (!this.ghost) {
      for (const m of [this.hull, this.parts, upperMesh, this.armL, this.armR]) addOutline(m, m === this.hull ? 2.6 : 2.0);
    }
    // Nav lights: port red, starboard green, stern white, plus an accent strip.
    const lb = new GeoBuilder();
    const main = shapes[0];
    lb.sphere(0.07, 0xff2a2a, { x: main.B * 0.48 + main.offsetX, y: sheerAt(main, 0.75) + 0.06, z: main.L * 0.25 }, 6, 4);
    lb.sphere(0.07, 0x2aff6a, { x: -main.B * 0.48 + main.offsetX, y: sheerAt(main, 0.75) + 0.06, z: main.L * 0.25 }, 6, 4);
    lb.sphere(0.06, 0xffffff, { y: deckAt(main, 0.02) + 0.1, z: -main.L * 0.49 }, 6, 4);
    lb.box(0.02, 0.025, main.L * 0.5, livery.boost, { x: main.B * 0.505 + main.offsetX, y: -0.02, z: -0.05 });
    lb.box(0.02, 0.025, main.L * 0.5, livery.boost, { x: -main.B * 0.505 + main.offsetX, y: -0.02, z: -0.05 });
    this.lights = new Mesh(lb.build(), new MeshBasicMaterial({ vertexColors: true, fog: true, transparent: this.ghost, opacity: this.ghost ? 0.3 : 1 }));
    // Boost flame.
    const fg = new ConeGeometry(0.22, 1.6, 10, 1, true);
    fg.rotateX(-Math.PI / 2);
    fg.translate(0, 0, -0.8);
    this.flame = new Mesh(
      fg,
      new MeshBasicMaterial({ color: new Color(livery.boost), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.flame.position.copy(rig.nozzle);
    this.flame.visible = false;
    this.root.add(this.hull, this.parts, this.upper, this.armL, this.armR, this.lights, this.flame);
    this.root.name = `boat_${spec.id}`;
  }

  /** Repaint after a garage change (same hull style). */
  repaint(l: Livery) {
    this.livery = l;
    paintLivery(l, this.livTex);
    (this.flame.material as MeshBasicMaterial).color.set(l.boost);
  }

  update(b: Boat, steer: number, dt: number, time: number) {
    const r = this.root;
    r.position.copy(b.position);
    _e.set(-b.pitch, b.heading, b.roll, 'YXZ');
    _q.setFromEuler(_e);
    if (b.visPitch !== 0 || b.visYaw !== 0 || b.visRoll !== 0) {
      _e.set(-b.visPitch, b.visYaw, b.visRoll, 'YXZ');
      _qt.setFromEuler(_e);
      _q.multiply(_qt);
    }
    r.quaternion.copy(_q);

    // ── Rider pose ──────────────────────────────────────────────────────────
    const landK = b.sinceLand < 0.5 ? (1 - b.sinceLand / 0.5) * b.landStrength : 0;
    let leanT = clamp(-b.yawRate * 0.32 + steer * 0.12, -0.55, 0.55) + (b.drifting ? b.driftDir * 0.15 : 0);
    let crouchT = 0.42 + 0.18 * b.boostLevel + 0.1 * b.engine + landK * 0.5;
    let twist = 0;
    if (b.airborne) {
      crouchT = b.trick !== 'none' ? 0.85 : 0.25;
      leanT *= 0.5;
    }
    if (b.wipeout > 0) {
      leanT = Math.sin(time * 11) * 0.6;
      crouchT = 0.9 + Math.sin(time * 7) * 0.3;
      twist = Math.sin(time * 5) * 0.5;
    }
    if (this.celebrate) {
      crouchT = -0.05;
      leanT = Math.sin(time * 3) * 0.15;
    }
    this.lean = damp(this.lean, leanT, 8, dt);
    this.crouch = damp(this.crouch, crouchT, 7, dt);
    this.bob = damp(this.bob, -landK * 0.22 - (b.airborne ? 0 : Math.abs(b.pitchRate) * 0.02), 10, dt);
    this.upper.position.set(this.rig.hipLocal.x, this.rig.hipLocal.y + this.bob, this.rig.hipLocal.z);
    this.upper.rotation.set(this.crouch, twist, this.lean, 'YXZ');
    this.upper.updateMatrix();

    // Arms: shoulder (in upper-body space) → grip (hull space). One arm waves at the finish.
    for (let s = 0; s < 2; s++) {
      const arm = s === 0 ? this.armL : this.armR;
      _sh.set(s === 0 ? 0.24 : -0.24, 0.52, 0.12).applyMatrix4(this.upper.matrix);
      if (this.celebrate && s === 1) {
        _grip.set(-0.45, _sh.y + 0.9 + Math.sin(time * 9) * 0.1, _sh.z + 0.1);
      } else if (b.wipeout > 0) {
        _grip.set(s === 0 ? 0.9 : -0.9, _sh.y + 0.5 + Math.sin(time * 13 + s) * 0.4, _sh.z - 0.2);
      } else {
        _grip.copy(s === 0 ? this.rig.gripL : this.rig.gripR);
      }
      arm.position.copy(_sh);
      // Orient in the hull's local space (Object3D.lookAt would work in world space).
      _dir.subVectors(_grip, _sh);
      const len = Math.max(0.2, _dir.length());
      _ql.setFromUnitVectors(_zAxis, _dir.normalize());
      arm.quaternion.copy(_ql);
      arm.scale.set(1, 1, len);
    }

    // Boost flame.
    const bl = b.boostLevel;
    this.flame.visible = bl > 0.05;
    if (this.flame.visible) {
      const flick = 0.85 + 0.15 * Math.sin(time * 60 + b.position.x);
      this.flame.scale.set(0.6 + bl * 0.6, 0.6 + bl * 0.6, (0.4 + bl * 1.2) * flick);
      (this.flame.material as MeshBasicMaterial).opacity = 0.35 + 0.55 * bl;
    }
  }

  dispose() {
    this.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh && !o.userData.isOutline) m.geometry.dispose();
    });
    this.livTex.dispose();
    if (!this.ghost) (this.hull.material as { dispose(): void }).dispose();
  }
}

const _zAxis = new Vector3(0, 0, 1);
export type { HullStyle };
