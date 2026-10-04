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

import { BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Matrix4, Mesh, type Material, SRGBColorSpace, Vector3 } from 'three';
import { clamp, damp } from '../core/mathx';
import { addOutline, addSmoothNormals, cel, makeCel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import type { Boat } from './boat';
import type { Livery } from './livery';
import MODEL from './riderModel.json';
import { lookFromLivery, type RiderLook } from './riderLook';

type PartName = keyof typeof MODEL.parts;

/** Character palette — chosen per racer from the livery so the field varies. */
const TROUSERS = ['#2f3d63', '#3b3b46', '#5a4632', '#2f5a4a', '#f0e6cc'];
const SHOES = ['#f6f3ea', '#2a2a32', '#c0392b', '#f2c94c'];
const WATCH = '#20242e';
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

/** Build-time switch: coarse hair for the distant-rider LOD (same silhouette, far fewer triangles). */
let hairLite = false;

function buildHead(liv: Livery, look: RiderLook, lite = false) {
  const gb = new GeoBuilder();
  const skin = look.skin;
  gb.add(cut(part('head'), ALL, NECK_M, FWD, UP), skin);
  hairLite = lite;
  addHair(gb, liv, look);
  hairLite = false;
  return gb.build();
}

// ── Hair ──────────────────────────────────────────────────────────────────
/** Head centre and half-extents in model space (from the mesh bounds). */
const HEAD_C = new Vector3(0, 0.55, -0.035);
const HEAD_E = new Vector3(0.255, 0.235, 0.215);

/** Point on the head ellipsoid (head space) for elevation `el` and azimuth `az` (0 = front). */
function onHead(el: number, az: number, k = 1) {
  const c = HEAD_C.clone().sub(NECK_M);
  return new Vector3(Math.sin(az) * Math.cos(el) * HEAD_E.x * k + c.x, Math.sin(el) * HEAD_E.y * k + c.y, Math.cos(az) * Math.cos(el) * HEAD_E.z * k + c.z);
}

/**
 * One anime hair lock: a faceted blade with a diamond cross-section that
 * tapers to a point along a gentle curve. `n` is the head normal at the
 * root; the blade lies flat against it like a real clump of hair.
 */
function lock(gb: GeoBuilder, col: string | Color, base: Vector3, dir: Vector3, n: Vector3, len: number, w: number, t: number, curl: Vector3) {
  const S = hairLite ? 3 : 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const d = dir.clone().normalize();
  const p = new Vector3();
  const tan = new Vector3();
  const side = new Vector3();
  const thick = new Vector3();
  for (let k = 0; k <= S; k++) {
    const u = k / S;
    // Quadratic curve: straight out, bending toward `curl` near the tip.
    p.copy(base).addScaledVector(d, len * u).addScaledVector(curl, len * u * u);
    tan.copy(d).addScaledVector(curl, 2 * u).normalize();
    side.crossVectors(tan, n);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    thick.crossVectors(side, tan).normalize();
    const taper = Math.pow(1 - u, 0.85);
    const ww = w * taper * (k === 0 ? 0.8 : 1);
    const tt = t * taper;
    // Diamond: side, out, other side, in.
    for (const [a, b] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -0.6],
    ])
      pos.push(p.x + side.x * a * ww + thick.x * b * tt, p.y + side.y * a * ww + thick.y * b * tt, p.z + side.z * a * ww + thick.z * b * tt);
  }
  for (let k = 0; k < S; k++)
    for (let q = 0; q < 4; q++) {
      const a = k * 4 + q;
      const b = k * 4 + ((q + 1) % 4);
      idx.push(a, a + 4, b, b, a + 4, b + 4);
    }
  idx.push(0, 1, 2, 0, 2, 3); // root cap
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  gb.add(g, col);
}

function addHair(gb: GeoBuilder, liv: Livery, look: RiderLook) {
  const col = look.hairColor;
  // 0 = explosive burst, 1 = messy curls, 2 = swept-back points.
  const style = look.hair === 'burst' ? 0 : look.hair === 'messy' ? 1 : 2;
  const ctr = HEAD_C.clone().sub(NECK_M);
  let seed = liv.number * 7.31 + style * 1.7 + 0.5;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const normalAt = (b: Vector3) => b.clone().sub(ctr).divide(HEAD_E).normalize();

  // Volume: the head's own top surface puffed well out, hairline high on
  // the forehead and low at the nape. The locks grow out of this.
  const cap = cut(
    part('head'),
    (c) => {
      const u = c.clone().sub(HEAD_C).divide(HEAD_E);
      const front = u.z / Math.max(1e-3, Math.hypot(u.x, u.z));
      return u.y > (front > 0 ? 0.3 * front + 0.04 : 0.55 * front + 0.04) && Math.abs(u.x) < 1.05;
    },
    NECK_M,
    FWD,
    UP,
  );
  const pos = cap.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.addScaledVector(v.clone().sub(ctr).normalize(), 0.045);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  cap.computeVertexNormals();
  gb.add(cap, col);

  // Main mass: locks spread evenly (golden spiral) over the crown, sides and
  // back, bursting outward with a lift, so the silhouette is a jagged star.
  const N = hairLite ? 30 : 64;
  const up = new Vector3(0, 1, 0);
  const back = new Vector3(0, 0, -1);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 1.45; // 1 → -0.45
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.39996 + rnd() * 0.3;
    const nx = Math.sin(th) * r;
    const nz = Math.cos(th) * r;
    // Leave the face clear: nothing low on the front.
    if (nz > 0.25 && y < 0.55) continue;
    const el = Math.asin(y);
    const az = Math.atan2(nx, nz);
    const base = onHead(el, az, 1.02);
    const n = normalAt(base);
    const dir = n.clone();
    if (style === 0) dir.addScaledVector(up, 0.2).addScaledVector(back, 0.05);
    else if (style === 1) dir.addScaledVector(up, 0.25).addScaledVector(back, 0.1);
    else dir.addScaledVector(back, 0.85).addScaledVector(up, 0.3);
    dir.x += (rnd() - 0.5) * 0.4;
    const lowBack = y < 0.1;
    const len = (lowBack ? 0.13 : 0.15) + rnd() * (style === 0 ? 0.13 : 0.1);
    const curl = style === 1 ? new Vector3((rnd() - 0.5) * 0.5, -0.25, -0.15) : new Vector3(0, lowBack ? -0.35 : -0.08, -0.12);
    // Neighbouring locks alternate a touch lighter/darker so they read apart.
    const tone = new Color(col).multiplyScalar(0.86 + rnd() * 0.2);
    lock(gb, tone, base.addScaledVector(n, -0.03), dir, n, len, 0.07 + rnd() * 0.03, 0.04, curl);
  }
  // Front crown: spikes across the front of the head pointing forward and
  // up, so the hair is full from the front too, not just at the back.
  for (let row = 0; row < 2; row++) {
    const cnt = row === 0 ? 7 : 5;
    for (let i = 0; i < cnt; i++) {
      const f = i / (cnt - 1) - 0.5;
      const az = f * (row === 0 ? 2.2 : 1.6);
      const el = row === 0 ? 0.62 : 0.92;
      const base = onHead(el, az, 1.02);
      const n = normalAt(base);
      const dir = n.clone().add(new Vector3(Math.sin(az) * 0.3, row === 0 ? 0.35 : 0.6, row === 0 ? 0.55 : 0.3));
      dir.x += (rnd() - 0.5) * 0.3;
      const tone = new Color(col).multiplyScalar(0.88 + rnd() * 0.18);
      lock(gb, tone, base, dir, n, 0.15 + rnd() * 0.08 + (style === 0 ? 0.03 : 0), 0.08, 0.04, new Vector3(0, row === 0 ? -0.18 : -0.05, 0));
    }
  }
  // Face-framing locks hanging down at the front corners.
  for (const sd of [-1, 1])
    for (const [el, az, len] of [
      [0.5, 0.95, 0.2],
      [0.4, 1.15, 0.18],
    ] as const) {
      const base = onHead(el, sd * az, 1.02);
      const n = normalAt(base);
      lock(gb, new Color(col).multiplyScalar(0.9 + rnd() * 0.12), base, new Vector3(sd * 0.25, -1, 0.35), n, len + rnd() * 0.03, 0.075, 0.035, new Vector3(sd * 0.05, 0, 0.08));
    }
  // Temple spikes poking out sideways, longest on the burst style.
  for (const sd of [-1, 1])
    for (const [el, az] of [
      [0.55, 1.35],
      [0.25, 1.55],
      [0.85, 1.1],
    ] as const) {
      const base = onHead(el, sd * az, 1.0);
      const n = normalAt(base);
      const dir = n.clone().add(new Vector3(0, 0.15, -0.25));
      lock(gb, new Color(col).multiplyScalar(0.9 + rnd() * 0.15), base, dir, n, (style === 0 ? 0.2 : 0.15) + rnd() * 0.05, 0.075, 0.04, new Vector3(0, -0.05, -0.1));
    }
  // Nape points hanging down the back of the neck.
  for (let i = 0; i < 4; i++) {
    const az = Math.PI + (i / 3 - 0.5) * 1.6;
    const base = onHead(-0.3, az, 0.98);
    const n = normalAt(base);
    lock(gb, col, base, n.clone().multiplyScalar(0.5).add(new Vector3(0, -1, -0.2)), n, 0.15 + rnd() * 0.05, 0.085, 0.04, new Vector3(0, 0, -0.15));
  }
  // Sideburns: points in front of the ears down toward the cheeks.
  for (const s of [-1, 1]) {
    const base = onHead(0.35, s * 1.2, 1.0);
    const n = normalAt(base);
    lock(gb, col, base, new Vector3(s * 0.15, -1, 0.25), n, 0.15, 0.075, 0.035, new Vector3(s * 0.05, 0, 0.05));
  }
  // Bangs: chunky jagged locks falling over the forehead, stopping above
  // the eyes, the outer ones sweeping out to the sides.
  const bangs = style === 1 ? 8 : 7;
  for (let i = 0; i < bangs; i++) {
    const f = i / (bangs - 1) - 0.5;
    const az = f * 1.7;
    const base = onHead(0.72, az, 1.03);
    const n = normalAt(base);
    const dir = new Vector3(Math.sin(az) * 0.55 + (rnd() - 0.5) * 0.2, -1, 0.55);
    const len = 0.13 + rnd() * 0.05 - Math.abs(f) * 0.03;
    lock(gb, col, base, dir, n, len, 0.07, 0.035, new Vector3(Math.sin(az) * 0.15, 0, 0.2));
  }
}

// ── Face ────────────────────────────────────────────────────────────────
/** Face decal region in model space. */
const FACE = { x0: -0.215, x1: 0.215, y0: 0.385, y1: 0.665 };
const faceCache = new Map<string, CanvasTexture>();

/** Anime face painted on a canvas: eyes, brows, nose, mouth, blush. */
function faceTexture(iris: string, brow: string, mood: number) {
  const key = `${iris}|${brow}|${mood}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const W = 512;
  const H = 384;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const X = (x: number) => ((x - FACE.x0) / (FACE.x1 - FACE.x0)) * W;
  const Y = (y: number) => (1 - (y - FACE.y0) / (FACE.y1 - FACE.y0)) * H;
  const sx = W / (FACE.x1 - FACE.x0);
  const sy = H / (FACE.y1 - FACE.y0);
  const ink = '#1a1420';
  for (const s of [-1, 1]) {
    const ex = s * 0.09;
    const ey = 0.508;
    const ew = 0.056 * sx;
    const eh = 0.074 * sy;
    c.save();
    c.translate(X(ex), Y(ey));
    // Sclera: tall rounded eye, flatter on top under the lash.
    c.beginPath();
    c.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.clip();
    // Iris: big, dark at the top fading to a bright lower half.
    const ix = -s * ew * 0.08;
    const iy = eh * 0.12;
    const g = c.createLinearGradient(0, iy - eh, 0, iy + eh);
    g.addColorStop(0, '#120c18');
    g.addColorStop(0.45, iris);
    g.addColorStop(1, '#ffffff');
    c.beginPath();
    c.ellipse(ix, iy, ew * 0.78, eh * 0.86, 0, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = '#120c18';
    c.stroke();
    // Pupil.
    c.beginPath();
    c.ellipse(ix, iy - eh * 0.05, ew * 0.33, eh * 0.42, 0, 0, Math.PI * 2);
    c.fillStyle = '#0c0810';
    c.fill();
    // Shine: a big glint up and out, a small one low and in.
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(ix + s * ew * 0.32, iy - eh * 0.38, ew * 0.26, eh * 0.22, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(ix - s * ew * 0.3, iy + eh * 0.42, ew * 0.11, 0, Math.PI * 2);
    c.fill();
    c.restore();
    // Upper lash line: thick arc with an outer flick; a small lower lash.
    c.save();
    c.translate(X(ex), Y(ey));
    c.fillStyle = ink;
    c.beginPath();
    c.moveTo(-s * ew * 1.08, -eh * 0.35);
    c.quadraticCurveTo(-s * ew * 0.2, -eh * 1.32, s * ew * 1.15, -eh * 0.62);
    c.lineTo(s * ew * 1.45, -eh * 0.42);
    c.quadraticCurveTo(s * ew * 1.0, -eh * 0.78, s * ew * 0.6, -eh * 0.88);
    c.quadraticCurveTo(-s * ew * 0.25, -eh * 1.05, -s * ew * 1.0, -eh * 0.18);
    c.closePath();
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = ink;
    c.beginPath();
    c.moveTo(s * ew * 0.95, eh * 0.5);
    c.quadraticCurveTo(s * ew * 0.6, eh * 0.92, s * ew * 0.1, eh * 1.0);
    c.stroke();
    c.restore();
    // Eyebrow: a tapered stroke, angled by mood (0 calm, 1 fierce).
    c.save();
    c.translate(X(ex), Y(ey + 0.096));
    c.rotate(s * (mood ? 0.28 : -0.08));
    c.fillStyle = brow;
    c.beginPath();
    c.moveTo(-s * ew * 1.1, 4);
    c.quadraticCurveTo(0, -10, s * ew * 1.1, -2);
    c.quadraticCurveTo(0, -1, -s * ew * 1.1, 8);
    c.closePath();
    c.fill();
    c.restore();
    // Blush with hatching.
    c.save();
    c.translate(X(s * 0.135), Y(0.452));
    c.fillStyle = 'rgba(255,120,140,0.45)';
    c.beginPath();
    c.ellipse(0, 0, 0.028 * sx, 0.012 * sy, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(230,80,100,0.7)';
    c.lineWidth = 2.5;
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.moveTo(k * 10 - 4, 5);
      c.lineTo(k * 10 + 4, -5);
      c.stroke();
    }
    c.restore();
  }
  // Nose: a small shade mark.
  c.strokeStyle = 'rgba(150,80,60,0.75)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(X(0.004), Y(0.452));
  c.lineTo(X(-0.006), Y(0.441));
  c.stroke();
  // Mouth: a grin or a set line with a little open corner.
  c.strokeStyle = ink;
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.beginPath();
  if (mood) {
    c.moveTo(X(-0.026), Y(0.414));
    c.quadraticCurveTo(X(0), Y(0.418), X(0.026), Y(0.41));
  } else {
    c.moveTo(X(-0.028), Y(0.418));
    c.quadraticCurveTo(X(0), Y(0.398), X(0.028), Y(0.418));
  }
  c.stroke();
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  return tex;
}

/** Decal over the front of the head (head space), UVs projected flat. */
function buildFaceGeo() {
  const g = cut(
    part('head'),
    (c) => c.z > HEAD_C.z + 0.08 && c.x > FACE.x0 - 0.02 && c.x < FACE.x1 + 0.02 && c.y > FACE.y0 - 0.03 && c.y < FACE.y1 + 0.03,
    NECK_M,
    FWD,
    UP,
  );
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const mx = pos.getX(i) + NECK_M.x;
    const my = pos.getY(i) + NECK_M.y;
    uv[i * 2] = (mx - FACE.x0) / (FACE.x1 - FACE.x0);
    uv[i * 2 + 1] = (my - FACE.y0) / (FACE.y1 - FACE.y0);
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * 0.004, pos.getY(i) + nrm.getY(i) * 0.004, pos.getZ(i) + nrm.getZ(i) * 0.004);
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}
let faceGeo: BufferGeometry | null = null;

function buildFace(look: RiderLook) {
  faceGeo ??= buildFaceGeo();
  const brow = new Color(look.hairColor).multiplyScalar(0.55).getStyle();
  const m = makeCel({ map: faceTexture(look.eyes, brow, look.expression === 'determined' ? 1 : 0), transparent: true });
  m.alphaTest = 0.35;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  return new Mesh(faceGeo, m);
}

/** Upper arm (shoulder → elbow) for side 0 = left (+X), 1 = right. */
function buildUpperArm(side: number, liv: Livery, look: RiderLook) {
  const sg = side === 0 ? 1 : -1;
  const gb = new GeoBuilder();
  const dir = new Vector3(sg, 0, 0);
  gb.add(cut(part(side === 0 ? 'armL' : 'armR'), (c) => c.x * sg < ELBOW_X, SHOULDER_M[side], dir, BACK), look.skin);
  gb.add(cut(part(side === 0 ? 'shoulderL' : 'shoulderR'), ALL, SHOULDER_M[side], dir, BACK), liv.accent);
  gb.sphere(0.048, look.skin, { z: UPPER_ARM }, 10, 8); // elbow
  return gb.build();
}

/** Forearm with watch and hand, from the elbow. */
function buildForearm(side: number, look: RiderLook) {
  const sg = side === 0 ? 1 : -1;
  const gb = new GeoBuilder();
  const skin = look.skin;
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
  readonly look: RiderLook;
  private headMesh!: Mesh;
  private headFull!: BufferGeometry;
  private headLite!: BufferGeometry;
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
    look?: RiderLook,
  ) {
    const lk = look ?? lookFromLivery(liv);
    this.look = lk;
    const mat = ghostMat ?? cel('riderBody', { vertexColors: true, gloss: 0.25 });
    this.torso = new Mesh(buildTorso(liv), mat);
    this.pelvis.add(this.torso);
    const headMesh = new Mesh(buildHead(liv, lk), ghostMat ?? cel('riderHead', { vertexColors: true, gloss: 0.2 }));
    this.headMesh = headMesh;
    this.headFull = headMesh.geometry;
    this.headLite = buildHead(liv, lk, true);
    addSmoothNormals(this.headLite);
    this.head.add(headMesh);
    if (!ghostMat) this.head.add(buildFace(lk));
    this.head.position.copy(NECK);
    this.torso.add(this.head);
    this.arms = [0, 1].map((i) => [new Mesh(buildUpperArm(i, liv, lk), mat), new Mesh(buildForearm(i, lk), mat)] as [Mesh, Mesh]);
    this.legs = [0, 1].map((i) => [new Mesh(buildThigh(i, liv), mat), new Mesh(buildShin(i, liv), mat)] as [Mesh, Mesh]);
    this.meshes.push(this.torso, headMesh, ...this.arms.flat(), ...this.legs.flat());
    this.torso.name = 'riderTorso';
    headMesh.name = 'riderHead';
    for (const [u, f] of this.arms) (u.name = 'riderArm'), (f.name = 'riderArm');
    for (const [t, sh] of this.legs) (t.name = 'riderLeg'), (sh.name = 'riderLeg');
    // Bold ink like an anime cel.
    if (!ghostMat) for (const m of this.meshes) addOutline(m, 2.8);
    this.root.add(this.pelvis, ...this.arms.flat(), ...this.legs.flat());
    this.pelvis.position.copy(at.hip);
  }

  /** LOD: 0 full, 1 no limb outlines, 2 torso + head only. */
  setLod(level: number) {
    // Distant riders swap to the coarse-hair head (mesh and its ink shell).
    const g = level >= 1 ? this.headLite : this.headFull;
    if (this.headMesh.geometry !== g) {
      this.headMesh.geometry = g;
      for (const c of this.headMesh.children) if (c.userData.isOutline) (c as Mesh).geometry = g;
    }
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
      solve(this.arms[side][0], this.arms[side][1], sh, grip, UPPER_ARM, FOREARM + GRIP, _pole.set(sg, -0.75, -0.45));
    }
    // Legs: hip → foothold, knees forward and slightly out.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      const hip = _a.set(sg * HIP_X, HIP_Y, 0).add(this.pelvis.position);
      solve(this.legs[side][0], this.legs[side][1], hip, side === 0 ? this.at.footL : this.at.footR, THIGH, SHIN, _pole.set(sg * 0.25, 0.05, 1));
    }
  }

  dispose() {
    this.headLite.dispose();
    this.headFull.dispose();
    const seen = new Set<unknown>();
    for (const m of this.meshes)
      if (!seen.has(m.geometry)) {
        seen.add(m.geometry);
        m.geometry.dispose();
      }
  }
}
