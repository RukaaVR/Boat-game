/**
 * Procedural watercraft visuals: lofted hulls, per-style superstructure, a
 * livery texture, an articulated rider, nav lights and a boost flame.
 *
 * Draw calls per boat: hull, parts, the jointed rider (see rider.ts), lights
 * and flame. Everything that does not move relative to the hull (boots,
 * console, fins, engine) is merged into `parts` with vertex colours.
 */

import {
  type ColorRepresentation,
  CatmullRomCurve3,
  LatheGeometry,
  TubeGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Vector2,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { smoothstep } from '../core/mathx';
import { addOutline, cel, makeCel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import { paintDamage, paintLivery, shade } from '../render/textures';
import type { Boat } from './boat';
import type { RiderLook } from './riderLook';
import { addBoots, foothold, Rider, type RiderAnchors } from './rider';
import type { Livery } from './livery';
import type { BoatSpec, HullStyle } from './specs';
import { HOP_TIME } from './boatPhysics';

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

interface RiderRig extends RiderAnchors {
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

  // Console: hull-coloured cowl with a dark dash, glowing display, and a
  // steering column up to a handlebar with rubber grips and bar-end mirrors.
  gb.capsule(0.3, 0.42, hullCol, { y: deckCon + 0.12, z: zCon + 0.08, rx: Math.PI / 2 - 0.12, sx: 1.08, sz: 0.9 });
  gb.box(0.6, 0.16, 0.7, shade(liv.hull, -0.25), { y: deckCon + 0.02, z: zCon + 0.08 });
  gb.box(0.56, 0.06, 0.42, DARK, { y: deckCon + 0.38, z: zCon - 0.04, rx: -0.42 });
  gb.box(0.26, 0.02, 0.16, 0x3be8ff, { y: deckCon + 0.415, z: zCon - 0.06, rx: -0.42 });
  gb.box(0.6, 0.04, 0.08, accent, { y: deckCon + 0.33, z: zCon + 0.28, rx: -0.2 });
  gb.cyl(0.045, 0.06, 0.5, STEEL, { y: deckCon + 0.55, z: zCon - 0.14, rx: -0.5 });
  gb.cyl(0.08, 0.08, 0.1, DARK, { y: deckCon + 0.74, z: zCon - 0.24, rx: -0.5 });
  const barY = deckCon + 0.78;
  const barZ = zCon - 0.24;
  gb.cyl(0.03, 0.03, 0.6, STEEL, { y: barY, z: barZ, rz: Math.PI / 2 });
  for (const s of [-1, 1]) {
    gb.cyl(0.045, 0.045, 0.2, 0x111318, { x: s * 0.36, y: barY, z: barZ, rz: Math.PI / 2 });
    gb.cyl(0.052, 0.052, 0.03, accent, { x: s * 0.47, y: barY, z: barZ, rz: Math.PI / 2 });
    // Mirror on a short stalk.
    gb.cyl(0.012, 0.012, 0.18, STEEL, { x: s * 0.33, y: barY + 0.08, z: barZ + 0.04, rz: -s * 0.5 });
    gb.box(0.13, 0.08, 0.025, DARK, { x: s * 0.39, y: barY + 0.17, z: barZ + 0.06 });
    gb.box(0.11, 0.06, 0.01, 0x9fd8ff, { x: s * 0.39, y: barY + 0.17, z: barZ + 0.045 });
  }
  // Padded saddle: rounded cushion with accent piping and a grab strap.
  gb.capsule(0.21, 0.62, DARK, { y: deck + 0.08, z: zRider - 0.48, rx: Math.PI / 2, sx: 1.18, sz: 0.5 });
  for (const s of [-1, 1]) gb.box(0.02, 0.04, 0.86, accent, { x: s * 0.245, y: deck + 0.07, z: zRider - 0.48 });
  gb.box(0.36, 0.035, 0.05, 0x111318, { y: deck + 0.19, z: zRider - 0.32 });
  // Grab handle behind the seat.
  gb.torus(0.17, 0.025, STEEL, { y: deck + 0.08, z: zRider - 0.98, ry: Math.PI / 2, rz: 0 }, Math.PI);
  // Non-slip foot pads either side of the console.
  for (const s of [-1, 1]) gb.box(0.26, 0.025, 0.7, 0x2b2f38, { x: s * 0.22, y: deck + 0.0, z: zRider + 0.15 });
  // Anime trim: a white rub rail along the sheer of every hull, meeting at the bow.
  // One swept tube per side (a few hundred triangles, not dozens of capsules).
  for (const h of shapes) {
    for (const sd of [-1, 1]) {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = 0.01 + (k / 12) * 0.975;
        pts.push(new Vector3(h.offsetX + sd * beamAt(h, t) * 1.01, sheerAt(h, t) - 0.015, (t - 0.5) * h.L));
      }
      gb.add(new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.034, 5, false), 0xf8f6ee);
    }
  }
  // Bow tow eye.
  gb.torus(0.06, 0.016, STEEL, { y: deckAt(main, 0.95) + 0.03, z: main.L * 0.43 }, Math.PI);
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
    gb.cyl(0.11, 0.11, 0.05, 0x0a0b0f, { y: -0.04, z: -0.5 * main.L - 0.33, rx: Math.PI / 2 });
    // Steering vane and a ride plate under the transom.
    gb.box(0.03, 0.22, 0.14, STEEL, { y: -0.04, z: -0.5 * main.L - 0.36 });
    gb.box(0.5, 0.03, 0.3, STEEL, { y: -0.2, z: -0.5 * main.L - 0.08 });
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
      // Offshore hardtop: raked tinted windshield, two posts and a roof.
      gb.box(0.95, 0.03, 0.6, 0x35577a, { y: deckCon + 0.62, z: zCon + 0.28, rx: -0.75 });
      for (const s of [-1, 1]) {
        gb.cyl(0.03, 0.03, 1.8, STEEL, { x: s * 0.52, y: deckCon + 0.9, z: zCon + 0.05 });
        gb.box(0.04, 0.04, 0.62, DARK, { x: s * 0.48, y: deckCon + 0.62, z: zCon + 0.28, rx: -0.75 });
      }
      gb.box(1.1, 0.06, 1.0, accent, { y: deckCon + 1.8, z: zCon - 0.25 });
      gb.box(1.0, 0.04, 0.9, 0x16202e, { y: deckCon + 1.76, z: zCon - 0.25 });
      // Bow rails that follow the sheer and meet at the stem.
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const t0 = 0.62 + k * 0.1;
          const t1 = t0 + 0.1;
          const a = new Vector3(s * beamAt(main, t0) * 0.85, deckAt(main, t0) + 0.2, (t0 - 0.5) * main.L);
          const b = new Vector3(s * beamAt(main, t1) * 0.85, deckAt(main, t1) + 0.2, (t1 - 0.5) * main.L);
          limb(gb, a, b, 0.025, STEEL);
          gb.cyl(0.02, 0.02, 0.2, STEEL, { x: a.x, y: a.y - 0.1, z: a.z });
        }
      }
      gb.box(0.3, 0.5, 0.28, DARK, { y: deckAt(main, 0.08) + 0.25, z: -0.5 * L + 0.4 });
      break;
    default:
      // Runabout: windscreen + side vents.
      // Wrap-around tinted screen in a dark frame.
      gb.box(0.56, 0.02, 0.34, 0x35577a, { y: deckCon + 0.46, z: zCon + 0.26, rx: -0.95 });
      gb.box(0.6, 0.03, 0.035, DARK, { y: deckCon + 0.59, z: zCon + 0.16 });
      for (const s of [-1, 1]) gb.box(0.04, 0.12, 0.6, accent, { x: s * main.B * 0.47, y: sheerAt(main, 0.3) - 0.08, z: -0.2 * L });
  }

  // Rider anchors: hips above the footholds, boots fixed to the deck.
  const hip = new Vector3(0, deck + 0.7, zRider - 0.06);
  addBoots(gb, deck, zRider, liv);

  const rig: RiderRig = {
    hip,
    gripL: new Vector3(0.34, barY, barZ),
    gripR: new Vector3(-0.34, barY, barZ),
    footL: foothold(0, deck, zRider),
    footR: foothold(1, deck, zRider),
    deckY: deck,
    nozzle,
  };
  return { geo: gb.build(), rig };
}

const _dir = new Vector3();
const _yAxis = new Vector3(0, 1, 0);
const _ql = new Quaternion();

function limb(gb: GeoBuilder, a: Vector3, b: Vector3, r: number, col: ColorRepresentation, off: { x?: number } = {}) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  _ql.setFromUnitVectors(_yAxis, _dir.normalize());
  const e = new Euler().setFromQuaternion(_ql, 'YXZ');
  gb.capsule(r, Math.max(0.01, len - r), col, { x: (a.x + b.x) / 2 + (off.x ?? 0), y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, rx: e.x, ry: e.y, rz: e.z });
}

const _q = new Quaternion();
const _qt = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

export class BoatVisual {
  readonly root = new Group();
  /** Hull-relative content, offset for keel depth. */
  private body = new Group();
  readonly hull: Mesh;
  readonly parts: Mesh;
  readonly rider: Rider;
  readonly flame: Mesh;
  readonly lights: Mesh;
  readonly rig: RiderRig;
  private livTex: CanvasTexture;
  celebrate = false;
  ghost = false;

  constructor(
    public spec: BoatSpec,
    public livery: Livery,
    opts: { ghost?: boolean; look?: RiderLook | null } = {},
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
    this.parts.name = 'boatParts';
    this.rider = new Rider(livery, rig, this.ghost ? hullMat : null, opts.look ?? undefined);
    // Bold anime ink round the hull and fittings.
    if (!this.ghost) for (const m of [this.hull, this.parts]) addOutline(m, m === this.hull ? 3.6 : 2.8);
    // Nav lights: port red, starboard green, stern white, plus an accent strip.
    const lb = new GeoBuilder();
    const main = shapes[0];
    lb.sphere(0.07, 0xff2a2a, { x: main.B * 0.48 + main.offsetX, y: sheerAt(main, 0.75) + 0.06, z: main.L * 0.25 }, 6, 4);
    lb.sphere(0.07, 0x2aff6a, { x: -main.B * 0.48 + main.offsetX, y: sheerAt(main, 0.75) + 0.06, z: main.L * 0.25 }, 6, 4);
    lb.sphere(0.06, 0xffffff, { y: deckAt(main, 0.02) + 0.1, z: -main.L * 0.49 }, 6, 4);
    lb.box(0.02, 0.025, main.L * 0.5, livery.boost, { x: main.B * 0.505 + main.offsetX, y: -0.02, z: -0.05 });
    lb.box(0.02, 0.025, main.L * 0.5, livery.boost, { x: -main.B * 0.505 + main.offsetX, y: -0.02, z: -0.05 });
    this.lights = new Mesh(lb.build(), new MeshBasicMaterial({ vertexColors: true, fog: true, transparent: this.ghost, opacity: this.ghost ? 0.3 : 1 }));
    // Boost flame: a cartoon fireball — solid livery-coloured outer flame
    // with a white-hot core, bulbous at the nozzle and licking to a point.
    const flameGeo = (k: number) => {
      const g = new LatheGeometry(
        [
          [0.001, 0],
          [0.2, 0.08],
          [0.25, 0.3],
          [0.2, 0.62],
          [0.11, 1.05],
          [0.001, 1.6],
        ].map(([r, y]) => new Vector2(r * k, y * k)),
        8,
      );
      g.rotateX(-Math.PI / 2);
      return g;
    };
    this.flame = new Mesh(flameGeo(1), new MeshBasicMaterial({ color: new Color(livery.boost), fog: false }));
    const core = new Mesh(flameGeo(0.58), new MeshBasicMaterial({ color: 0xffffff, fog: false }));
    core.position.z = -0.04;
    this.flame.add(core);
    this.flame.position.copy(rig.nozzle);
    this.flame.visible = false;
    // Physics floats every hull at one reference draft; lift deeper keels so
    // each design shows the same waterline (just under the chine).
    const lift = Math.max(0, shapes[0].depth - 0.36) * 0.9;
    this.lift = lift;
    this.body.position.y = lift;
    this.body.add(this.hull, this.parts, this.rider.root, this.lights, this.flame);
    this.root.add(this.body);
    this.root.name = `boat_${spec.id}`;
  }

  private lod = 0;
  /** Waterline lift for this hull (body rest height). */
  private lift = 0;
  get lodLevel() {
    return this.lod;
  }
  /**
   * Distance LOD: 0 = full detail; 1 = no outlines on limbs, no nav lights;
   * 2 = hull + rider torso only (beyond ~260 m the boat is a few pixels).
   */
  setLod(level: number) {
    if (level === this.lod) return;
    this.lod = level;
    this.rider.setLod(level);
    this.lights.visible = level < 1;
    for (const c of this.parts.children) if (c.userData.isOutline) c.visible = level < 1;
  }

  private damageLevel = 0;
  /** Scuff the hull to match damage 0..1 (repaints only when the level steps). */
  setDamage(d: number, seed: number) {
    const level = Math.min(4, Math.floor(d * 5));
    if (level === this.damageLevel || this.ghost) return;
    this.damageLevel = level;
    paintLivery(this.livery, this.livTex);
    if (level > 0) paintDamage(this.livTex, level, seed);
  }

  /** Repaint after a garage change (same hull style). */
  repaint(l: Livery) {
    this.livery = l;
    this.damageLevel = 0;
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

    // Kart-style drift hop (visual only — physics stays on the water), and a
    // quick bumpy bounce while the slide is held.
    let hopY = 0;
    if (b.hop > 0) hopY = Math.sin(Math.PI * (1 - b.hop / HOP_TIME)) * 0.42;
    else if (b.drifting && !b.airborne) hopY = Math.abs(Math.sin(b.driftTime * 15)) * 0.045;
    this.body.position.y = this.lift + hopY;

    this.rider.update(b, steer, dt, time, this.celebrate);

    // Boost flame.
    const bl = b.boostLevel;
    this.flame.visible = bl > 0.05;
    if (this.flame.visible) {
      // Snappy cartoon flicker: alternate two lengths rather than a smooth pulse.
      const flick = Math.sin(time * 40 + b.position.x) > 0 ? 1 : 0.82;
      this.flame.scale.set(0.5 + bl * 0.6, 0.5 + bl * 0.6, (0.35 + bl * 1.1) * flick);
    }
  }

  dispose() {
    this.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh && !o.userData.isOutline) m.geometry.dispose();
    });
    this.rider.dispose();
    this.livTex.dispose();
    if (!this.ghost) (this.hull.material as { dispose(): void }).dispose();
  }
}

export type { HullStyle };
