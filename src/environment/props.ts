/**
 * Prop geometry builders. Each returns a vertex-coloured BufferGeometry in a
 * unit-ish local frame; the scenery instancer scales/positions them.
 */

import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, SphereGeometry, Vector3 } from 'three';
import { Rng } from '../core/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, lumpify } from '../render/geo';
import type { ThemeStyle } from './weatherDefs';

const _c = new Color();
const _c2 = new Color();

/**
 * Anime island palette per theme: flat bands, no noise. `cliff` is used on
 * steep strips, `crown` on the summit of tall (variant 2) islands.
 */
interface IslandPalette {
  under: number;
  surf: number;
  sand: number;
  cliff: number;
  grass: number;
  crown: number;
}
function islandPalette(theme: string, style: ThemeStyle): IslandPalette {
  switch (theme) {
    case 'tropical':
      return { under: 0xe2c07e, surf: 0xffffff, sand: style.sand, cliff: 0xe0a466, grass: style.grass, crown: 0xc2b29c };
    case 'jungle':
      return { under: 0x8a6a44, surf: 0xf2fff6, sand: style.sand, cliff: 0xb08a5a, grass: style.grass, crown: 0x86a86a };
    case 'arctic':
      return { under: 0x6c9cc4, surf: 0xffffff, sand: 0x9cc0dc, cliff: 0xb4d2e8, grass: 0xf6fbff, crown: 0xffffff };
    case 'storm':
      return { under: 0x3a4250, surf: 0xeef4fa, sand: style.sand, cliff: 0x6c7884, grass: style.grass, crown: 0x84909c };
    case 'volcanic':
      return { under: 0x241c28, surf: 0xf4e8e2, sand: style.sand, cliff: style.rockDark, grass: style.rock, crown: 0x5a4652 };
    case 'canal':
      return { under: 0x6a5a4a, surf: 0xffffff, sand: 0xe8d4a8, cliff: 0xc8a882, grass: 0x78cc5a, crown: 0x78cc5a };
    default:
      return { under: 0x22263a, surf: 0x9fe8ff, sand: 0x4a4e66, cliff: 0x363a52, grass: 0x40486a, crown: 0x40486a };
  }
}

/** A rounded island: underwater skirt → white surf → sand → chunky dome, in crisp colour bands. */
export interface IslandMesh {
  geo: BufferGeometry;
  /** Exact ground height at a local, un-rotated offset from the centre. */
  heightAt(lx: number, lz: number): number;
}

export function islandGeometry(r: number, style: ThemeStyle, theme: string, seed: number, variant: number): IslandMesh {
  const rng = new Rng(seed);
  const seg = Math.max(32, Math.round(r * 0.9));
  const tall = theme === 'storm' ? 1.9 : theme === 'volcanic' ? 1.3 : theme === 'neon' ? 0.35 : theme === 'arctic' ? 1.7 : theme === 'jungle' ? 1.15 : 1;
  const peak = (r * 0.32 + rng.range(4, 12)) * tall * (variant === 2 ? 1.5 : 1);
  const pal = islandPalette(theme, style);
  // Radial profile: [radius fraction, height]. A beach shelf, then a chunky
  // rounded dome (mesa for storm, rounded peak for snow/volcano).
  const prof: [number, number][] = [
    [1.15, -3],
    [1.035, -0.6],
    [1.0, 0.3],
  ];
  const storm = theme === 'storm';
  const edge = storm ? 0.97 : 0.86;
  const base = storm ? 0.3 : 1.15;
  if (!storm) prof.push([0.93, 0.75], [edge, base]);
  const N = 11;
  for (let k = 1; k <= N; k++) {
    const t = k / N;
    const u = 1 - Math.pow(t, 1.5); // dense near the dome's foot
    let g: number;
    if (storm) g = Math.pow(1 - Math.pow(u, 4), 0.5);
    else if (theme === 'arctic' || theme === 'volcanic' || variant === 2) g = Math.pow(1 - Math.pow(u, 1.5), 1.5);
    else g = Math.pow(1 - u * u, 0.6);
    prof.push([edge * u, base + (peak - base) * g]);
  }
  const rings = prof.length;
  const phase = rng.range(0, 6.28);
  const wob = [rng.range(0.05, 0.12), rng.range(0.03, 0.08), rng.range(0.02, 0.04)];
  const shape = (th: number) => 1 + wob[0] * Math.sin(th * 2 + phase) + wob[1] * Math.sin(th * 5 + phase * 2) + wob[2] * Math.sin(th * 9 + phase * 3);
  // Shared ring vertices (for smooth normals).
  const W = seg + 1;
  const sp = new Float32Array(rings * W * 3);
  for (let i = 0; i < rings; i++)
    for (let a = 0; a <= seg; a++) {
      const th = (a / seg) * Math.PI * 2;
      const [f, hgt] = prof[i];
      const rr = r * f * shape(th);
      sp.set([Math.cos(th) * rr, hgt, Math.sin(th) * rr], (i * W + a) * 3);
    }
  const idx: number[] = [];
  for (let i = 0; i < rings - 1; i++)
    for (let a = 0; a < seg; a++) {
      const p0 = i * W + a;
      const q0 = p0 + W;
      idx.push(p0, q0, p0 + 1, p0 + 1, q0, q0 + 1);
    }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(sp, 3));
  sg.setIndex(idx);
  sg.computeVertexNormals();
  const sn = sg.getAttribute('normal') as BufferAttribute;
  // Weld the seam (a = 0 and a = seg share a position).
  for (let i = 0; i < rings; i++) {
    const a0 = i * W;
    const a1 = a0 + seg;
    const nx = sn.getX(a0) + sn.getX(a1);
    const ny = sn.getY(a0) + sn.getY(a1);
    const nz = sn.getZ(a0) + sn.getZ(a1);
    const l = Math.hypot(nx, ny, nz) || 1;
    sn.setXYZ(a0, nx / l, ny / l, nz / l);
    sn.setXYZ(a1, nx / l, ny / l, nz / l);
  }
  // Band colour per strip: flat, crisp, cel-anime. Cliffs only skirt the dome's foot.
  const footStrip = storm ? 2 : 4;
  const stripCol: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    const [f0, h0] = prof[i];
    const [f1, h1] = prof[i + 1];
    const slope = (h1 - h0) / Math.max(1e-3, (f0 - f1) * r);
    const hm = (h0 + h1) / 2;
    let c: number;
    if (i === 0) c = pal.under;
    else if (i === 1) c = pal.surf;
    else if (hm < base + 0.05 && !storm) c = pal.sand;
    else if (slope > (storm ? 1.1 : 1.35) && (storm ? hm < peak * 0.8 : i <= footStrip + 3)) c = pal.cliff;
    else if (variant === 2 && hm > peak * 0.72) c = pal.crown;
    else c = pal.grass;
    stripCol.push(c);
  }
  const pos = new Float32Array(idx.length * 3);
  const nrm = new Float32Array(idx.length * 3);
  const col = new Float32Array(idx.length * 3);
  const perStrip = seg * 6;
  for (let j = 0; j < idx.length; j++) {
    const v = idx[j];
    pos[j * 3] = sp[v * 3];
    pos[j * 3 + 1] = sp[v * 3 + 1];
    pos[j * 3 + 2] = sp[v * 3 + 2];
    nrm[j * 3] = sn.getX(v);
    nrm[j * 3 + 1] = sn.getY(v);
    nrm[j * 3 + 2] = sn.getZ(v);
    _c.setHex(stripCol[Math.floor(j / perStrip)]);
    col[j * 3] = _c.r;
    col[j * 3 + 1] = _c.g;
    col[j * 3 + 2] = _c.b;
  }
  sg.dispose();
  const ng = new BufferGeometry();
  ng.setAttribute('position', new BufferAttribute(pos, 3));
  ng.setAttribute('normal', new BufferAttribute(nrm, 3));
  ng.setAttribute('color', new BufferAttribute(col, 3));
  const heightAt = (lx: number, lz: number) => {
    const th = Math.atan2(lz, lx);
    const d = Math.hypot(lx, lz) / (r * shape(th < 0 ? th + Math.PI * 2 : th));
    for (let i = 0; i < prof.length - 1; i++) {
      const [f0, h0] = prof[i];
      const [f1, h1] = prof[i + 1];
      if (d <= f0 && d >= f1) return h1 + ((h0 - h1) * (d - f1)) / Math.max(1e-6, f0 - f1);
    }
    return d > prof[0][0] ? -3 : prof[prof.length - 1][1];
  };
  return { geo: ng, heightAt };
}

export function rockGeometry(variant: number, style: ThemeStyle): BufferGeometry {
  // Chunky, low-facet boulder: few big planes read as a cartoon rock.
  const g = new DodecahedronGeometry(1, 0);
  lumpify(g, 0.22, variant * 3.7 + 1, -0.55);
  g.scale(1.15, 1.05 + variant * 0.15, 1);
  g.rotateY(variant * 1.3);
  g.translate(0, 0.2, 0);
  const ng = g.index ? g.toNonIndexed() : g;
  return facetColor(ng, variant % 2 ? style.rock : mixHex(style.rock, style.rockDark, 0.35));
}

export function seastackGeometry(variant: number, style: ThemeStyle): BufferGeometry {
  const g = new CylinderGeometry(0.6, 1, 4, 7, 3);
  lumpify(g, 0.18, variant * 2.1 + 5);
  g.translate(0, 1.6, 0);
  return facetColor(g.index ? g.toNonIndexed() : g, style.rock);
}

/** Mix two hex colours. */
function mixHex(a: number, b: number, k: number) {
  return _c.setHex(a).lerp(_c2.setHex(b), k).getHex();
}

/**
 * Flat per-face colour: up-facing planes get a light "top" tone, sides the
 * base tone, undersides a cooler shade — the classic anime rock read.
 */
function facetColor(g: BufferGeometry, hex: number, top?: number, under?: number) {
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const base = new Color(hex);
  const hi = top !== undefined ? new Color(top) : base.clone().offsetHSL(0.01, 0.02, 0.16);
  const lo = under !== undefined ? new Color(under) : base.clone().offsetHSL(0.03, 0.04, -0.1);
  for (let i = 0; i < n; i += 3) {
    const ny = (nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)) / 3;
    const c = ny > 0.55 ? hi : ny < -0.25 ? lo : base;
    for (let k = 0; k < 3 && i + k < n; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

export function lavarockGeometry(variant: number, style: ThemeStyle): BufferGeometry {
  const g = rockGeometry(variant, style);
  // Glowing seams near the waterline.
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  _c.setHex(style.glow);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const n = Math.sin(pos.getX(i) * 7 + variant) * Math.cos(pos.getZ(i) * 6);
    if (y < 0.1 && n > 0.35) col.setXYZ(i, _c.r * 1.6, _c.g * 1.2, _c.b);
  }
  return g;
}

/**
 * Anime palm: a chunky trunk of stacked, flared bands (crisp light/dark
 * stripes), and a crown of big, broad fronds with a few bold notches. Fronds
 * are thin *closed* shells with a hand-made `smoothNormal`, so the
 * inverted-hull ink outlines them cleanly. The trunk bends toward +X.
 */
/** `low`: a cheap distant version with the same silhouette (fewer bands and frond segments). */
export function palmGeometry(variant: number, low = false): { trunk: BufferGeometry; fronds: BufferGeometry } {
  const rng = new Rng(variant * 97 + 11);
  const H = 8.5 + variant * 1.4;
  const lean = 0.22 + variant * 0.07;
  const RINGS = low ? 4 : 8;
  const SIDES = low ? 5 : 9;
  const spine: [number, number, number, number][] = [];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const ang = lean * t * t * 1.6;
    const tx = Math.sin(ang);
    const ty = Math.cos(ang);
    spine.push([sx, sy, tx, ty]);
    sx += tx * (H / RINGS);
    sy += ty * (H / RINGS);
  }
  const bark = [new Color(0xc08850), new Color(0x8e5f38)];
  const tPos: number[] = [];
  const tCol: number[] = [];
  const tIdx: number[] = [];
  const radius = (t: number) => 0.5 - 0.22 * t + 0.22 * Math.exp(-t * 10);
  for (let i = 0; i < RINGS; i++) {
    // Each band owns its vertices: flared bottom, pinched top → sawtooth silhouette, crisp stripe.
    const c = bark[i % 2];
    const b0 = tPos.length / 3;
    for (const [j, k] of [
      [i, 1.12],
      [i + 1, 0.86],
    ] as const) {
      const [cx, cy, tx, ty] = spine[j];
      const rr = radius(j / RINGS) * k;
      for (let s2 = 0; s2 <= SIDES; s2++) {
        const th = (s2 / SIDES) * Math.PI * 2;
        tPos.push(cx - ty * Math.cos(th) * rr, cy + tx * Math.cos(th) * rr, Math.sin(th) * rr);
        tCol.push(c.r, c.g, c.b);
      }
    }
    for (let s2 = 0; s2 < SIDES; s2++) {
      const p0 = b0 + s2;
      const q0 = p0 + SIDES + 1;
      tIdx.push(p0, p0 + 1, q0, p0 + 1, q0 + 1, q0);
    }
  }
  const trunk = new BufferGeometry();
  trunk.setAttribute('position', new BufferAttribute(new Float32Array(tPos), 3));
  trunk.setAttribute('color', new BufferAttribute(new Float32Array(tCol), 3));
  trunk.setIndex(tIdx);
  trunk.computeVertexNormals();

  // ── Crown: closed-shell fronds ───────────────────────────────────────────
  const [topX, topY] = spine[RINGS];
  const fPos: number[] = [];
  const fCol: number[] = [];
  const fNrmOut: number[] = [];
  const fIdx: number[] = [];
  const LIGHT = new Color(0x86e44e);
  const MID = new Color(0x4cc23e);
  const UNDER = new Color(0x2a8a3c);
  const DRY = new Color(0xb8c84a);
  const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const push = (p: Vector3, c: Color, out: Vector3) => {
    fPos.push(p.x, p.y, p.z);
    fCol.push(c.r, c.g, c.b);
    fNrmOut.push(out.x, out.y, out.z);
    return fPos.length / 3 - 1;
  };
  // Emit a triangle oriented so its normal agrees with `want`.
  const tri = (a: number, b: number, c: number, want: Vector3) => {
    const A = v3(fPos[a * 3], fPos[a * 3 + 1], fPos[a * 3 + 2]);
    const B = v3(fPos[b * 3], fPos[b * 3 + 1], fPos[b * 3 + 2]);
    const C = v3(fPos[c * 3], fPos[c * 3 + 1], fPos[c * 3 + 2]);
    const n = B.sub(A).cross(C.sub(A));
    if (n.dot(want) >= 0) fIdx.push(a, b, c);
    else fIdx.push(a, c, b);
  };
  const LEAVES = 7;
  const SEG = low ? 4 : 9;
  for (let f = 0; f < LEAVES; f++) {
    const a = (f / LEAVES) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const low = f % 3 === 0;
    const L = rng.range(4.6, 5.4) * (low ? 1.05 : 1);
    const rise = low ? 0.5 : rng.range(1.3, 1.8);
    const droop = low ? 4.0 : rng.range(2.6, 3.2);
    const Wd = rng.range(1.15, 1.35);
    const dir = v3(Math.cos(a), 0, Math.sin(a));
    const lat = v3(-dir.z, 0, dir.x);
    const light = low ? LIGHT.clone().lerp(DRY, 0.4) : LIGHT;
    const mid = low ? MID.clone().lerp(DRY, 0.35) : MID;
    const under = low ? UNDER.clone().lerp(DRY, 0.25) : UNDER;
    // Per-section points.
    const S: Vector3[] = [];
    const Lft: Vector3[] = [];
    const Rgt: Vector3[] = [];
    const up: Vector3[] = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const c = v3(topX + dir.x * L * t, topY + 0.15 + rise * t - droop * t * t, dir.z * L * t);
      const slopeY = rise - 2 * droop * t;
      const tan = dir.clone().multiplyScalar(L).add(v3(0, slopeY, 0)).normalize();
      const u = lat.clone().cross(tan).normalize();
      if (u.y < 0) u.negate();
      // Broad leaf with three big notches per side.
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)), 0.7);
      const notch = k > 1 && k < SEG && k % 3 === 0 ? 0.5 : 1;
      const w = Wd * env * notch;
      const fold = 0.3 * w + 0.04;
      S.push(c.clone().addScaledVector(u, fold));
      Lft.push(c.clone().addScaledVector(lat, w));
      Rgt.push(c.clone().addScaledVector(lat, -w));
      up.push(u);
    }
    // Closed wedge: a folded two-tone top (L–spine–R tent) over a flat
    // underside (L–R), so the leaf has volume for the ink hull at ~6 tris/section.
    const ids = { tl: [] as number[], ts1: [] as number[], ts2: [] as number[], tr: [] as number[], bl: [] as number[], br: [] as number[] };
    for (let k = 0; k <= SEG; k++) {
      const u = up[k];
      const mU = u.clone().negate();
      const outL = lat.clone().addScaledVector(u, 0.3).normalize();
      const outR = lat.clone().negate().addScaledVector(u, 0.3).normalize();
      ids.tl.push(push(Lft[k], light, outL));
      ids.ts1.push(push(S[k], light, u));
      ids.ts2.push(push(S[k], mid, u));
      ids.tr.push(push(Rgt[k], mid, outR));
      ids.bl.push(push(Lft[k], under, lat.clone().addScaledVector(mU, 0.3).normalize()));
      ids.br.push(push(Rgt[k], under, lat.clone().negate().addScaledVector(mU, 0.3).normalize()));
    }
    for (let k = 0; k < SEG; k++) {
      const u = up[k];
      const q = (A: number[], B: number[], want: Vector3) => {
        tri(A[k], A[k + 1], B[k], want);
        tri(B[k], A[k + 1], B[k + 1], want);
      };
      q(ids.tl, ids.ts1, u);
      q(ids.ts2, ids.tr, u);
      q(ids.bl, ids.br, u.clone().negate());
    }
  }
  const leaves = new BufferGeometry();
  leaves.setAttribute('position', new BufferAttribute(new Float32Array(fPos), 3));
  leaves.setAttribute('color', new BufferAttribute(new Float32Array(fCol), 3));
  leaves.setAttribute('smoothNormal', new BufferAttribute(new Float32Array(fNrmOut), 3));
  leaves.setIndex(fIdx);
  leaves.computeVertexNormals();

  // Coconuts and the crown knob, merged into the frond geometry.
  const nb = new GeoBuilder();
  nb.sphere(0.36, 0x5aa83a, { x: topX, y: topY + 0.05, z: 0 }, 8, 5);
  for (let i = 0; i < 3 + (variant % 2); i++) {
    const a = (i / 3) * Math.PI * 2 + variant;
    nb.sphere(0.28, 0x8a5a2e, { x: topX + Math.cos(a) * 0.36, y: topY - 0.3, z: Math.sin(a) * 0.36 }, 7, 5);
  }
  const nuts = nb.build();
  nuts.setAttribute('smoothNormal', nuts.getAttribute('normal').clone());
  const fronds = mergeGeometries([leaves.toNonIndexed(), nuts], false)!;
  leaves.dispose();
  nuts.dispose();
  return { trunk, fronds };
}

export function pineGeometry(): BufferGeometry {
  // Anime snowy fir: chunky teal-green tiers, each wearing a fat snow cap.
  const gb = new GeoBuilder();
  gb.cyl(0.22, 0.3, 2, 0x8a5a3a, { y: 1 }, 7);
  for (let i = 0; i < 3; i++) {
    const r = 1.9 - i * 0.5;
    const y = 2.5 + i * 1.5;
    gb.cone(r, 2.5, i % 2 ? 0x2f8a64 : 0x37a070, { y }, 9);
    gb.cone(r * 0.62, 1.05, 0xf6fbff, { y: y + 0.78 }, 9);
  }
  gb.sphere(0.32, 0xf6fbff, { y: 6.6 }, 8, 6);
  return gb.build();
}

export function hutGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  for (const [x, z] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
  ])
    gb.cyl(0.18, 0.18, 2.6, 0x9a6a3e, { x, y: 0.7, z }, 7);
  gb.box(4.2, 0.3, 4.2, 0xc08a52, { y: 1.9 });
  gb.box(3.4, 2, 3.4, 0xfff1d0, { y: 3.0 });
  // Fat, rounded thatch: a squashed dome over a flared cone, with a bright trim band.
  gb.cone(3.6, 2.2, 0xf2c060, { y: 5.0, ry: Math.PI / 8 }, 8);
  gb.sphere(1.3, 0xf2c060, { y: 6.0, sy: 0.8 }, 10, 6);
  gb.cyl(0.07, 0.07, 1.6, 0x7a4a26, { y: 7.3 }, 5);
  gb.box(0.9, 0.55, 0.06, 0xe84a3a, { x: 0.45, y: 7.75 });
  gb.box(0.9, 1.4, 0.1, 0x7a4a26, { y: 2.8, z: 1.71 });
  gb.box(0.8, 0.8, 0.1, 0x6ad0f0, { x: 1.71, y: 3.2, ry: Math.PI / 2 });
  return gb.build();
}

export function dockGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  // Deck runs along local Z.
  gb.box(3.6, 0.3, 22, 0xd09a5e, { y: 1.3 });
  for (let i = 0; i < 11; i++) gb.box(3.7, 0.06, 0.12, 0x9a6a3e, { y: 1.47, z: -10 + i * 2 });
  for (let i = -2; i <= 2; i++)
    for (const s of [-1, 1]) {
      gb.cyl(0.26, 0.26, 4.2, 0x8a5a36, { x: s * 1.7, y: -0.5, z: i * 5 }, 8);
      gb.cyl(0.3, 0.3, 0.24, 0xffffff, { x: s * 1.7, y: 1.65, z: i * 5 }, 8);
    }
  gb.box(2.4, 2.2, 2.6, 0xfff8ec, { y: 2.6, z: 8.5 });
  gb.box(2.9, 0.35, 3.1, 0x3a8fe0, { y: 3.85, z: 8.5 });
  gb.box(0.8, 1.0, 0.1, 0x3a8fe0, { y: 2.4, z: 9.82 });
  return gb.build();
}

export function lighthouseGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.rock(6, 0x9a9aa8, { y: -1, sy: 0.5 });
  for (let i = 0; i < 6; i++) {
    const r0 = 2.4 - i * 0.22;
    gb.cyl(r0 - 0.22, r0, 3, i % 2 ? 0xf0443a : 0xfffaf0, { y: 2 + i * 3 }, 16);
  }
  gb.cyl(1.6, 1.5, 0.4, 0x2c3a5a, { y: 19.6 }, 16);
  gb.cyl(1.0, 1.0, 2.2, 0xfff4b0, { y: 20.9 }, 12);
  gb.cone(1.55, 1.5, 0xf0443a, { y: 22.75 }, 14);
  gb.sphere(0.35, 0xffd21e, { y: 23.7 }, 8, 6);
  return gb.build();
}

export function wreckGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(5, 3.2, 20, 0x7a5a48, { y: 0.2, rz: 0.35, rx: 0.12 });
  gb.box(3.6, 3, 5, 0xa07a5e, { y: 2.6, z: -4, rz: 0.35, rx: 0.12 });
  gb.cyl(0.3, 0.3, 9, 0x6a4a34, { y: 5, z: 3, rz: 0.55 }, 7);
  gb.box(5.1, 0.6, 20.1, 0xd0503a, { y: -1, rz: 0.35, rx: 0.12 });
  gb.box(5.15, 0.25, 20.15, 0xfff4e0, { y: -0.55, rz: 0.35, rx: 0.12 });
  return gb.build();
}

export const CONTAINER_COLORS = [0xf0504a, 0x3a8fe0, 0xffa53a, 0x4cc06a, 0xb8c0cc, 0xa86ad8];
export function containerGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  // A small stack on a floating barge.
  gb.box(8, 1.6, 14, 0x4a5a78, { y: 0.2 });
  gb.box(8.1, 0.25, 14.1, 0xffffff, { y: 1.0 });
  const rng = new Rng(variant * 11 + 2);
  const stacks = 2 + (variant % 3);
  for (let s = 0; s < stacks; s++) {
    const col = CONTAINER_COLORS[rng.int(0, CONTAINER_COLORS.length - 1)];
    const x = (s % 2) * 2.6 - 1.3;
    const lvl = Math.floor(s / 2);
    gb.box(2.44, 2.6, 6.1, col, { x, y: 2.3 + lvl * 2.6, z: rng.range(-3, 3) });
    for (let k = 0; k < 7; k++) gb.box(2.5, 2.4, 0.08, _c.setHex(col).multiplyScalar(0.75).getHex(), { x, y: 2.3 + lvl * 2.6, z: -2.8 + k * 0.9 });
  }
  return gb.build();
}

export function craneGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  const Y = 0xffc21e;
  gb.box(12, 3, 10, 0x5a6a88, { y: 0.5 });
  gb.box(12.1, 0.3, 10.1, 0xffffff, { y: 2.0 });
  for (const [x, z] of [
    [-4, -3.5],
    [4, -3.5],
    [-4, 3.5],
    [4, 3.5],
  ])
    gb.box(0.8, 22, 0.8, Y, { x, y: 13, z });
  gb.box(10, 1.2, 1, Y, { y: 18, z: -3.5 });
  gb.box(10, 1.2, 1, Y, { y: 18, z: 3.5 });
  gb.box(1.4, 1.6, 42, Y, { y: 24, z: -8 });
  gb.box(3, 3, 3.5, 0xffffff, { y: 21.5, z: 2 });
  gb.box(3.1, 0.9, 3.6, 0x3a8fe0, { y: 22.4, z: 2 });
  gb.box(0.4, 9, 0.4, 0x3a4660, { y: 18.5, z: -24 });
  gb.box(3, 1, 2.5, 0xf0504a, { y: 14, z: -24 });
  gb.box(5, 2, 5, 0xb8c0cc, { y: 23.5, z: 14 });
  return gb.build();
}

export function quayGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  // Long side along local X.
  gb.box(36, 4.5, 9, 0xa8b0c0, { y: 0 });
  gb.box(36.2, 0.5, 9.2, 0xeef2f8, { y: 2.2 });
  gb.box(36, 0.4, 0.5, 0xffc21e, { y: 2.5, z: 4.3 });
  for (let i = -3; i <= 3; i++) {
    gb.cyl(0.28, 0.34, 0.6, 0x3a4660, { x: i * 5, y: 2.7, z: 3.6 }, 8);
    gb.box(0.4, 1.2, 1.2, 0x3a4660, { x: i * 5 + 2.5, y: -0.5, z: 4.6 });
  }
  for (let i = -1; i <= 1; i++) {
    gb.cyl(0.15, 0.15, 7, 0x3a4660, { x: i * 14, y: 5.8, z: 3 }, 6);
    gb.box(1.2, 0.3, 0.6, 0x3a4660, { x: i * 14, y: 9.3, z: 3.3 });
  }
  gb.box(10, 6, 7, 0xe07a5a, { x: -10, y: 5, z: -0.5 });
  gb.box(10.4, 0.6, 7.4, 0xfff4e8, { x: -10, y: 8.2, z: -0.5 });
  for (const x of [-13, -10, -7]) gb.box(1.4, 1.6, 0.1, 0x3a5a8a, { x, y: 5.4, z: 3.02 });
  return gb.build();
}

export function mineGeometry(): BufferGeometry {
  // Cartoon sea mine: round navy bomb, stubby spikes with red tips.
  const gb = new GeoBuilder();
  gb.sphere(1, 0x3a3456, {}, 14, 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const e = i % 2 ? 0.5 : -0.3;
    const dx = Math.cos(a) * Math.cos(e);
    const dy = Math.sin(e);
    const dz = Math.sin(a) * Math.cos(e);
    gb.cyl(0.1, 0.14, 0.5, 0x6a6488, { x: dx * 1.05, y: dy * 1.05, z: dz * 1.05, rz: -a + Math.PI / 2, rx: e }, 6);
    gb.sphere(0.14, 0xff3a3a, { x: dx * 1.32, y: dy * 1.32, z: dz * 1.32 }, 6, 4);
  }
  gb.sphere(0.22, 0xeae6ff, { x: -0.45, y: 0.55, z: 0.55 }, 6, 4);
  gb.cyl(0.6, 0.8, 0.3, 0x2a2640, { y: -0.95 }, 10);
  return gb.build();
}

export function volcanoGeometry(style: ThemeStyle): BufferGeometry {
  const g = new ConeGeometry(1, 0.55, 40, 8, true);
  lumpify(g, 0.08, 9.1);
  const pos = g.getAttribute('position');
  // Open the crater.
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.2) {
      const k = 0.13 / Math.max(0.05, Math.hypot(pos.getX(i), pos.getZ(i)) + 1e-3);
      pos.setXYZ(i, pos.getX(i) * Math.max(1, k), Math.min(y, 0.24), pos.getZ(i) * Math.max(1, k));
    }
  }
  g.translate(0, 0.27, 0);
  const ng = g.toNonIndexed();
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const p = ng.getAttribute('position');
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y > 0.47) _c.setHex(style.glow).multiplyScalar(1.5);
    else _c.setHex(style.rockDark).lerp(_c2.setHex(style.rock), Math.min(1, y * 2.5));
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  ng.setAttribute('color', new BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

/** Ring of distant low mountains / headlands, one merged mesh. */
export function distantRangeGeometry(cx: number, cz: number, R: number, style: ThemeStyle, theme: string, seed: number): BufferGeometry {
  // Flat pastel silhouettes (rendered unlit): soft rounded hills fading into the haze.
  const gb = new GeoBuilder();
  const rng = new Rng(seed);
  const count = 34;
  const pastel: Record<string, [number, number]> = {
    tropical: [0x86c8a8, 0x9ed6bc],
    jungle: [0x7cbc94, 0x94ccaa],
    arctic: [0xd2e2f4, 0xbcd0ea],
    storm: [0x7a8a9c, 0x8a98a8],
    volcanic: [0x7a6080, 0x8a6e88],
    canal: [0xc8b4c4, 0xd6c4cc],
  };
  const [ca, cb] = pastel[theme] ?? [0x2a2e3e, 0x323648];
  void style;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const rr = R + rng.range(-120, 200);
    const h = rng.range(60, theme === 'storm' ? 220 : theme === 'volcanic' ? 180 : 140);
    const w = rng.range(140, 300);
    const g = new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    lumpify(g, 0.08, i * 1.7 + seed);
    gb.add(g, i % 2 ? ca : cb, { x: cx + Math.cos(a) * rr, y: -6, z: cz + Math.sin(a) * rr, sx: w, sy: h, sz: w * rng.range(0.6, 1) });
  }
  return gb.build();
}

export function birdGeometry(): BufferGeometry {
  // A flat gull: two swept wing triangles + body. Wing tips at |x| = 1.
  const pos = new Float32Array([
    0, 0, 0.3, -1, 0.05, -0.15, 0, 0, -0.2,
    0, 0, 0.3, 0, 0, -0.2, 1, 0.05, -0.15,
    0, 0.05, 0.45, -0.08, 0, -0.4, 0.08, 0, -0.4,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function sailboatGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  if (variant === 0) {
    gb.box(2.4, 1.2, 9, 0xfffaf0, { y: 0.3 });
    gb.box(2.45, 0.3, 9.05, 0x3a8fe0, { y: -0.1 });
    gb.cyl(0.12, 0.14, 11, 0xf0e8dc, { y: 6.2, z: 0.6 }, 6);
    gb.add(new ConeGeometry(2.6, 9.5, 3), 0xffffff, { x: 0, y: 6.5, z: -1.2, sx: 0.08, ry: Math.PI / 2 });
    gb.add(new ConeGeometry(1.6, 7, 3), 0xff5a4a, { y: 5.5, z: 2.8, sx: 0.08, ry: Math.PI / 2 });
  } else {
    // Freighter.
    gb.box(10, 4, 46, 0x3a6ab0, { y: 0.6 });
    gb.box(10.2, 1, 46.2, 0xe0503a, { y: -1.2 });
    gb.box(10.1, 0.35, 46.1, 0xffffff, { y: 2.55 });
    gb.box(8, 7, 7, 0xfffaf0, { y: 6, z: -17 });
    gb.cyl(1, 1.2, 5, 0xffb21e, { y: 11, z: -18 }, 10);
    for (let i = 0; i < 5; i++) gb.box(8, 2.6, 6, CONTAINER_COLORS[i % CONTAINER_COLORS.length], { y: 3.9, z: -6 + i * 6.4 });
  }
  return gb.build();
}

// ── Arctic ─────────────────────────────────────────────────────────────────
/** A faceted iceberg: white crown, pale cyan sides, deeper cyan underside, unit footprint ≈ 1. */
export function icebergGeometry(variant: number): BufferGeometry {
  const g = new DodecahedronGeometry(1, variant === 2 ? 1 : 0);
  lumpify(g, 0.3, variant * 5.3 + 2, -0.5);
  g.scale(1, 1.1 + variant * 0.45, 1);
  g.rotateY(variant * 0.9);
  return facetColor(g.index ? g.toNonIndexed() : g, 0xc4ecf8, 0xffffff, 0x7fd2ec);
}

/** A flat drifting ice floe slab (unit radius): snow-white top, cyan rim. */
export function floeGeometry(variant: number): BufferGeometry {
  const g = new CylinderGeometry(1, 1.06, 0.5, 7 + variant, 1);
  lumpify(g, 0.12, variant * 2.7 + 9);
  g.translate(0, 0.05, 0);
  return facetColor(g.index ? g.toNonIndexed() : g, 0x9ddcf0, 0xf6fcff, 0x6fc4e0);
}

// ── Jungle ─────────────────────────────────────────────────────────────────
/** Rainforest giant: buttressed trunk, layered canopy blobs, hanging vines. */
export function jungleTreeGeometry(variant: number): BufferGeometry {
  // Anime rainforest giant: banded trunk, buttress roots and a big puffy
  // cauliflower canopy in bright greens.
  const gb = new GeoBuilder();
  const h = 9 + variant * 3;
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const r0 = 0.9 - 0.45 * t0;
    const r1 = 0.9 - 0.45 * t1;
    gb.cyl(r1 * 0.92, r0 * 1.05, h / bands, i % 2 ? 0x9a6a40 : 0xb8844e, { y: (t0 + t1) * 0.5 * h }, 9);
  }
  for (let k = 0; k < 4; k++) gb.box(0.3, 1.8, 1.5, 0x8a5c38, { y: 0.8, ry: (k * Math.PI) / 2 + 0.4, z: 0.6 });
  const greens = [0x48c040, 0x5cd24a, 0x3aac3e, 0x6ad856];
  const blobs = 5 + variant;
  // Lower ring of puffs, then a crown of smaller ones on top.
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + variant;
    const d = k === 0 ? 0 : 2.4;
    const r = k === 0 ? 3.0 : 2.1 + (k % 2) * 0.3;
    gb.sphere(r, greens[k % 4], { x: Math.cos(a) * d, y: h + 0.4 + (k % 2) * 0.5, z: Math.sin(a) * d, sy: 0.78 }, 10, 7);
  }
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI + variant * 0.7;
    gb.sphere(1.8, greens[(k + 1) % 4], { x: Math.cos(a) * 1.1, y: h + 2.3, z: Math.sin(a) * 1.1, sy: 0.85 }, 10, 7);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + variant;
    gb.cyl(0.07, 0.07, 3.5 + k * 0.6, 0x3a9a3a, { x: Math.cos(a) * 2.8, y: h - 1.8 - k * 0.3, z: Math.sin(a) * 2.8 }, 4);
    gb.sphere(0.25, 0xff6a9a, { x: Math.cos(a) * 2.8, y: h - 3.6 - k * 0.6, z: Math.sin(a) * 2.8 }, 5, 3);
  }
  return gb.build();
}

/** A stepped temple ruin with a shrine on top, overgrown. */
export function ruinGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  const stone = [0xc8c09a, 0xb4ae8a, 0xd8d0aa];
  for (let i = 0; i < 6; i++) {
    const w = 22 - i * 3.2;
    gb.box(w, 2.6, w, stone[i % 3], { y: 1.3 + i * 2.6 });
  }
  gb.box(5, 4, 5, 0xa8a280, { y: 15.6 + 2 });
  gb.box(2, 2.6, 0.4, 0x3a3a50, { y: 15.6 + 1.3, z: 2.55 });
  gb.box(6, 0.8, 6, 0xd8d0aa, { y: 15.6 + 4.4 });
  // Stairs up the front.
  for (let i = 0; i < 6; i++) gb.box(4, 0.5, 1.4, 0xe8e0c0, { y: 0.5 + i * 2.6, z: 11 - i * 1.6 });
  // Moss and vines.
  for (let i = 0; i < 10; i++) gb.sphere(1.2 + (i % 3) * 0.4, i % 2 ? 0x5cc24a : 0x44ac40, { x: Math.cos(i * 2.4) * (10 - (i % 4) * 2), y: 2 + (i % 5) * 2.6, z: Math.sin(i * 2.4) * (10 - (i % 4) * 2), sy: 0.6 }, 10, 6);
  return gb.build();
}

/**
 * Course barrier closing off a point-to-point sprint behind the start and
 * past the finish. Local X spans the course (unit = half-width), Z is along it.
 * 0 = log jam (jungle), 1 = ice wall (arctic), 2 = rock wall.
 */
export function barrierGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  if (variant === 0) {
    for (let i = 0; i < 9; i++) {
      const y = (i % 3) * 0.9;
      gb.cyl(0.55, 0.6, 2.4 + (i % 2) * 0.3, i % 2 ? 0xb07a48 : 0x946238, { x: -0.1 + (i % 4) * 0.05, y: y + 0.2, z: (i - 4) * 0.12, rz: Math.PI / 2, ry: (i - 4) * 0.06, sy: 1 }, 9);
    }
    for (let i = 0; i < 6; i++) gb.sphere(0.5, i % 2 ? 0x5cd24a : 0x44b83e, { x: (i - 2.5) * 0.4, y: 2.4, z: (i % 2) * 0.4, sy: 0.7 }, 10, 6);
  } else if (variant === 1) {
    for (let i = 0; i < 7; i++) gb.rock(0.42 + (i % 3) * 0.08, i % 2 ? 0xf2fbff : 0xbfe6f4, { x: (i - 3) * 0.33, y: 0.6 + (i % 2) * 0.4, z: (i % 3 - 1) * 0.3, sy: 2.4, sx: 0.9 });
  } else {
    for (let i = 0; i < 7; i++) gb.rock(0.42, i % 2 ? 0x8a7e8a : 0x6e6676, { x: (i - 3) * 0.33, y: 0.5, z: (i % 3 - 1) * 0.3, sy: 2 });
  }
  return gb.build();
}

// ── Canal city ─────────────────────────────────────────────────────────────
const FACADES = [0xffc89a, 0xff9f8a, 0xfff0c8, 0x9fdcc8, 0xffe08a, 0xf6b4cc];
/** A narrow three/four-storey townhouse; local +Z faces the water. */
export function townhouseGeometry(variant: number): BufferGeometry {
  // Cute anime townhouse: pastel walls, white cornices, bright roof, teal
  // shutters and flower boxes.
  const gb = new GeoBuilder();
  const floors = 3 + (variant % 2);
  const H = floors * 3.2;
  const col = FACADES[variant % FACADES.length];
  const roof = variant % 2 ? 0xf0643c : 0xe24a48;
  // Foundations run down into the water, Venetian style.
  gb.box(7.6, H + 2.5, 8, col, { y: (H + 2.5) / 2 - 3 });
  gb.box(7.7, 1.2, 8.1, 0xb8a890, { y: -1.2 });
  gb.box(8.0, 0.5, 8.4, 0xffffff, { y: H - 0.3 });
  gb.box(7.8, 0.3, 8.2, 0xffffff, { y: 0.15 });
  // Roof: pitched tiles or a flat parapet.
  if (variant % 3 === 0) gb.box(7.4, 2.6, 8.2, roof, { y: H + 1.0 });
  else gb.cone(5.8, 3, roof, { y: H + 1.5, ry: Math.PI / 4, sz: 1.06 }, 4);
  // Windows, frames and shutters.
  const shutter = [0x3ab8a0, 0x4a90e0, 0x7ac85a][variant % 3];
  for (let f = 0; f < floors; f++) {
    for (let xi = 0; xi < 3; xi++) {
      const x = (xi - 1) * 2.2;
      const y = 1.6 + f * 3.2;
      gb.box(1.3, 1.8, 0.16, 0xffffff, { x, y, z: 4.02 });
      gb.box(1.0, 1.5, 0.2, 0x3a5a8a, { x, y, z: 4.05 });
      gb.box(0.36, 1.7, 0.22, shutter, { x: x - 0.82, y, z: 4.06 });
      gb.box(0.36, 1.7, 0.22, shutter, { x: x + 0.82, y, z: 4.06 });
      if (f > 0 && (xi + f + variant) % 2 === 0) {
        gb.box(1.2, 0.3, 0.4, 0x9a6a40, { x, y: y - 1.0, z: 4.25 });
        gb.box(0.42, 0.32, 0.32, 0xff5a8a, { x: x - 0.3, y: y - 0.72, z: 4.3, ry: 0.4 });
        gb.box(0.42, 0.32, 0.32, 0xffd21e, { x: x + 0.3, y: y - 0.72, z: 4.3, ry: -0.4 });
      }
    }
    if (f > 0 && variant % 2 === 0) gb.box(3.4, 0.2, 1, 0x2c3a5a, { y: 0.6 + f * 3.2, z: 4.5 });
  }
  gb.box(1.8, 2.8, 0.16, 0xffffff, { y: 0.8, z: 4.02 });
  gb.box(1.5, 2.6, 0.2, 0x8a5a36, { y: 0.8, z: 4.05 });
  gb.cyl(0.3, 0.34, 1.2, 0xc8583a, { x: 2.6, y: H + 2.6, z: -1.5 }, 7);
  return gb.build();
}

/** 12 m of stone canal wall with a coping and mooring rings; local Z along the wall. */
export function canalWallGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(2.2, 4.4, 12.2, 0xd2b48c, { y: -0.6 });
  gb.box(2.6, 0.45, 12.4, 0xfff6e6, { y: 1.8 });
  for (const z of [-4, 0, 4]) gb.box(0.22, 0.9, 0.22, 0x2c3a5a, { x: -1.2, y: 0.6, z });
  // Waterline stain.
  gb.box(2.24, 0.5, 12.24, 0x7aa08a, { y: -0.2 });
  return gb.build();
}

/** A moored gondola, bow along +Z. */
export function gondolaGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(1.4, 0.7, 9, 0x2c2c4a, { y: 0.2 });
  gb.box(1.45, 0.14, 9.05, 0xffd21e, { y: 0.5 });
  gb.cone(0.7, 2.2, 0x2c2c4a, { y: 0.4, z: 5.4, rx: Math.PI / 2 - 0.4, sz: 0.4 }, 4);
  gb.box(0.1, 1.4, 0.6, 0xffe08a, { y: 1.5, z: 6.2 });
  gb.box(1.2, 0.3, 1.6, 0xe8304a, { y: 0.65, z: -0.5 });
  gb.cyl(0.08, 0.08, 4, 0xb8844e, { y: 1.8, z: -3.6, rx: 0.3 }, 5);
  return gb.build();
}

/** Iron street lamp (the glow is added by the scenery as a light point). */
export function lampGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.cyl(0.13, 0.2, 4.6, 0x2c3a5a, { y: 2.3 }, 7);
  gb.box(0.9, 0.12, 0.12, 0x2c3a5a, { y: 4.5, z: 0.3 });
  gb.cyl(0.27, 0.34, 0.6, 0xffe08a, { y: 4.2, z: 0.7 }, 7);
  gb.cone(0.42, 0.35, 0x2c3a5a, { y: 4.68, z: 0.7 }, 7);
  return gb.build();
}

