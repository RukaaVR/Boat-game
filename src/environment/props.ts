/**
 * Prop geometry builders. Each returns a vertex-coloured BufferGeometry in a
 * unit-ish local frame; the scenery instancer scales/positions them.
 */

import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, SphereGeometry } from 'three';
import { Rng } from '../core/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, lumpify } from '../render/geo';
import type { ThemeStyle } from './weatherDefs';

const _c = new Color();
const _c2 = new Color();

/** A lumpy island: underwater skirt → beach → slope → crown, coloured by height. */
export interface IslandMesh {
  geo: BufferGeometry;
  /** Exact (jitter-free) ground height at a local, un-rotated offset from the centre. */
  heightAt(lx: number, lz: number): number;
}

export function islandGeometry(r: number, style: ThemeStyle, theme: string, seed: number, variant: number): IslandMesh {
  const rng = new Rng(seed);
  const seg = Math.max(28, Math.round(r * 0.9));
  const tall = theme === 'storm' ? 1.9 : theme === 'volcanic' ? 1.3 : theme === 'neon' ? 0.35 : theme === 'arctic' ? 1.7 : theme === 'jungle' ? 1.15 : 1;
  const peak = (r * 0.32 + rng.range(4, 12)) * tall * (variant === 2 ? 1.5 : 1);
  // Radial profile: [radius fraction, height]
  const prof: [number, number][] =
    theme === 'storm'
      ? [
          [1.12, -3],
          [1.0, 0.4],
          [0.95, peak * 0.55],
          [0.8, peak * 0.8],
          [0.55, peak * 0.95],
          [0.25, peak],
          [0, peak * 1.02],
        ]
      : [
          [1.15, -3],
          [1.0, 0.25],
          [0.9, 0.9],
          [0.78, 2.2],
          [0.62, peak * 0.42],
          [0.45, peak * 0.7],
          [0.28, peak * 0.9],
          [0.12, peak * 0.985],
          [0, peak],
        ];
  const rings = prof.length;
  const pos: number[] = [];
  const col: number[] = [];
  const phase = rng.range(0, 6.28);
  const wob = [rng.range(0.05, 0.12), rng.range(0.03, 0.08), rng.range(0.02, 0.05)];
  const shape = (th: number) => 1 + wob[0] * Math.sin(th * 2 + phase) + wob[1] * Math.sin(th * 5 + phase * 2) + wob[2] * Math.sin(th * 11 + phase * 3);
  for (let i = 0; i < rings; i++) {
    for (let a = 0; a <= seg; a++) {
      const th = (a / seg) * Math.PI * 2;
      const n = shape(th);
      const [f, hgt] = prof[i];
      const rr = r * f * n;
      const jitter = i > 1 && i < rings - 1 ? rng.range(-0.025, 0.025) * peak : 0;
      const y = hgt + jitter;
      pos.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      // Colour by height band.
      if (theme === 'tropical') {
        if (y < 0.8) _c.setHex(style.sand);
        else if (y < 1.8) _c.setHex(style.sand).lerp(_c2.setHex(style.grass), 0.5);
        else _c.setHex(style.grass).offsetHSL(0, 0, (rng.next() - 0.5) * 0.06);
        if (variant === 2 && y > peak * 0.7) _c.setHex(style.rock);
      } else if (theme === 'storm') {
        _c.setHex(y < 1 ? style.rockDark : y > peak * 0.9 ? style.grass : style.rock).offsetHSL(0, 0, (rng.next() - 0.5) * 0.05);
      } else if (theme === 'volcanic') {
        _c.setHex(y < 0.6 ? style.rockDark : style.rock).offsetHSL(0, 0, (rng.next() - 0.5) * 0.04);
      } else if (theme === 'jungle') {
        // Muddy bank, then dense green; the odd mossy rock face.
        if (y < 0.7) _c.setHex(style.sand);
        else if (y < 1.6) _c.setHex(style.sand).lerp(_c2.setHex(style.grass), 0.55);
        else _c.setHex(style.grass).offsetHSL(0.02 * (rng.next() - 0.5), 0.05, (rng.next() - 0.5) * 0.08);
        if (variant === 2 && y > peak * 0.55 && rng.next() < 0.5) _c.setHex(style.rock);
      } else if (theme === 'arctic') {
        // Dark wet rock at the waterline, grey cliffs, snow on top.
        if (y < 0.8) _c.setHex(style.rockDark);
        else if (y < peak * 0.38) _c.setHex(0x7d8b99).lerp(_c2.setHex(style.rock), rng.next() * 0.4);
        else _c.setHex(style.sand).offsetHSL(0, 0, (rng.next() - 0.5) * 0.04);
      } else {
        _c.setHex(y < 0.6 ? 0x3a3e48 : 0x5c6070);
      }
      col.push(_c.r, _c.g, _c.b);
    }
  }
  const idx: number[] = [];
  const W = seg + 1;
  for (let i = 0; i < rings - 1; i++)
    for (let a = 0; a < seg; a++) {
      const p0 = i * W + a;
      const p1 = p0 + 1;
      const q0 = p0 + W;
      const q1 = q0 + 1;
      idx.push(p0, q0, p1, p1, q0, q1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  g.dispose();
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
  const g = new DodecahedronGeometry(1, 1);
  lumpify(g, 0.35, variant * 3.7 + 1, -0.6);
  g.scale(1, 0.75 + variant * 0.15, 1);
  return colorize(g.index ? g.toNonIndexed() : g, variant % 2 ? style.rock : style.rockDark, 0.05, variant);
}

export function seastackGeometry(variant: number, style: ThemeStyle): BufferGeometry {
  const g = new CylinderGeometry(0.55, 1, 4, 9, 4);
  lumpify(g, 0.25, variant * 2.1 + 5);
  g.translate(0, 1.6, 0);
  return colorize(g.index ? g.toNonIndexed() : g, style.rock, 0.06, variant);
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

function colorize(g: BufferGeometry, hex: number, jitter: number, seed: number) {
  const rng = new Rng(seed * 17 + 3);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    _c.setHex(hex).offsetHSL(0, 0, (rng.next() - 0.5) * jitter);
    for (let k = 0; k < 3 && i + k < n; k++) {
      col[(i + k) * 3] = _c.r;
      col[(i + k) * 3 + 1] = _c.g;
      col[(i + k) * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Palm: one continuous curved, tapering trunk tube with growth rings, a crown
 * of arched, V-folded fronds with serrated leaflet edges, and coconuts.
 * The trunk bends toward +X; fronds radiate from its tip.
 */
export function palmGeometry(variant: number): { trunk: BufferGeometry; fronds: BufferGeometry } {
  const rng = new Rng(variant * 97 + 11);
  const H = 8.5 + variant * 1.4;
  const lean = 0.22 + variant * 0.07; // total bend (radians) from base to tip
  const RINGS = 14;
  const SIDES = 8;
  const tPos: number[] = [];
  const tCol: number[] = [];
  const tIdx: number[] = [];
  // Spine: integrate a smoothly increasing lean.
  const spine: [number, number, number, number][] = []; // x, y, tx, ty
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
  const bark = [new Color(0x8a6a46), new Color(0x6f5236)];
  for (let i = 0; i <= RINGS; i++) {
    const [cx, cy, tx, ty] = spine[i];
    const t = i / RINGS;
    // Taper with a flared base and a slight swelling under the crown.
    const r = 0.44 - 0.2 * t + 0.2 * Math.exp(-t * 14) + 0.04 * Math.exp(-((t - 0.97) ** 2) / 0.002);
    const c = bark[i % 2];
    for (let k = 0; k < SIDES; k++) {
      const th = (k / SIDES) * Math.PI * 2;
      const ux = -ty * Math.cos(th);
      const uy = tx * Math.cos(th);
      const uz = Math.sin(th);
      // Ring ridges: every other ring slightly fatter.
      const rr = r * (i % 2 ? 0.94 : 1.04);
      tPos.push(cx + ux * rr, cy + uy * rr, uz * rr);
      tCol.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k;
      const b = i * SIDES + ((k + 1) % SIDES);
      const c2 = a + SIDES;
      const d = b + SIDES;
      tIdx.push(a, b, c2, b, d, c2);
    }
  const trunk = new BufferGeometry();
  trunk.setAttribute('position', new BufferAttribute(new Float32Array(tPos), 3));
  trunk.setAttribute('color', new BufferAttribute(new Float32Array(tCol), 3));
  trunk.setIndex(tIdx);
  trunk.computeVertexNormals();

  // ── Crown ────────────────────────────────────────────────────────────────
  const [topX, topY] = spine[RINGS];
  const fPos: number[] = [];
  const fCol: number[] = [];
  const fIdx: number[] = [];
  const dark = new Color(0x1f7a35);
  const mid = new Color(0x34a84a);
  const tip = new Color(0x8fd45a);
  const dry = new Color(0x9a8a3e);
  const tmp = new Color();
  const LEAVES = 9;
  const SEG = 14;
  for (let f = 0; f < LEAVES; f++) {
    const a = (f / LEAVES) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const low = f % 3 === 0; // older, lower, droopier fronds
    const L = rng.range(4.4, 5.4) * (low ? 1.05 : 1);
    const rise = low ? 0.6 : rng.range(1.2, 1.8);
    const droop = low ? 4.2 : rng.range(2.6, 3.4);
    const W = rng.range(0.75, 0.95);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const lx = -dz;
    const lz = dx;
    const base = fPos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const px = topX + dx * L * t;
      const py = topY + 0.1 + rise * t - droop * t * t;
      const pz = dz * L * t;
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.65);
      const serr = k % 2 ? 1 : 0.62; // leaflet tips vs notches
      const fold = 0.22 * w; // spine raised: V-shaped cross-section
      tmp.copy(dark).lerp(mid, Math.min(1, t * 1.6));
      if (low) tmp.lerp(dry, 0.35);
      const edge = tmp.clone().lerp(tip, 0.25 + 0.5 * t);
      // left edge, spine, right edge
      fPos.push(px + lx * w * serr, py - fold * 0.4, pz + lz * w * serr);
      fCol.push(edge.r, edge.g, edge.b);
      fPos.push(px, py + fold, pz);
      fCol.push(tmp.r * 0.85, tmp.g * 0.85, tmp.b * 0.85);
      fPos.push(px - lx * w * serr, py - fold * 0.4, pz - lz * w * serr);
      fCol.push(edge.r, edge.g, edge.b);
    }
    for (let k = 0; k < SEG; k++) {
      const a0 = base + k * 3;
      const b0 = a0 + 3;
      fIdx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      fIdx.push(a0 + 1, b0 + 1, a0 + 2, a0 + 2, b0 + 1, b0 + 2);
    }
  }
  const leaves = new BufferGeometry();
  leaves.setAttribute('position', new BufferAttribute(new Float32Array(fPos), 3));
  leaves.setAttribute('color', new BufferAttribute(new Float32Array(fCol), 3));
  leaves.setIndex(fIdx);
  leaves.computeVertexNormals();

  // Coconuts and the crown knob, merged into the frond geometry.
  const nb = new GeoBuilder();
  nb.sphere(0.32, 0x5f7a2a, { x: topX, y: topY - 0.05, z: 0 }, 8, 6);
  for (let i = 0; i < 3 + (variant % 2); i++) {
    const a = (i / 3) * Math.PI * 2 + variant;
    nb.sphere(0.24, i % 2 ? 0x6b4a24 : 0x7d8a2e, { x: topX + Math.cos(a) * 0.32, y: topY - 0.35, z: Math.sin(a) * 0.32 }, 7, 5);
  }
  const nuts = nb.build();
  const fronds = mergeGeometries([leaves.toNonIndexed(), nuts], false)!;
  fronds.computeVertexNormals();
  leaves.dispose();
  nuts.dispose();
  return { trunk, fronds };
}

export function pineGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.cyl(0.18, 0.25, 2, 0x4a3628, { y: 1 }, 6);
  for (let i = 0; i < 3; i++) gb.cone(1.8 - i * 0.45, 2.6, i % 2 ? 0x2d4a33 : 0x355a3b, { y: 2.6 + i * 1.5 }, 7);
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
    gb.cyl(0.14, 0.14, 2.6, 0x6b4a2e, { x, y: 0.7, z }, 6);
  gb.box(4, 0.25, 4, 0x8c6a44, { y: 1.9 });
  gb.box(3.4, 2, 3.4, 0xe9d7b0, { y: 3.0 });
  gb.cone(3.4, 2.4, 0xc9a35c, { y: 5.2, ry: Math.PI / 4 }, 4);
  gb.box(0.9, 1.4, 0.1, 0x5a3d22, { y: 2.8, z: 1.71 });
  return gb.build();
}

export function dockGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  // Deck runs along local Z.
  gb.box(3.6, 0.3, 22, 0x9b7b56, { y: 1.3 });
  for (let i = 0; i < 11; i++) gb.box(3.7, 0.05, 0.1, 0x6e5235, { y: 1.47, z: -10 + i * 2 });
  for (let i = -2; i <= 2; i++)
    for (const s of [-1, 1]) {
      gb.cyl(0.22, 0.22, 4.2, 0x5a4330, { x: s * 1.7, y: -0.5, z: i * 5 }, 7);
      gb.cyl(0.24, 0.24, 0.2, 0xd8d0c0, { x: s * 1.7, y: 1.65, z: i * 5 }, 7);
    }
  gb.box(2.4, 2.2, 2.6, 0xf2efe6, { y: 2.6, z: 8.5 });
  gb.box(2.8, 0.25, 3, 0x2f6fa8, { y: 3.8, z: 8.5 });
  return gb.build();
}

export function lighthouseGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.rock(6, 0x50565c, { y: -1, sy: 0.5 });
  for (let i = 0; i < 6; i++) {
    const r0 = 2.4 - i * 0.22;
    gb.cyl(r0 - 0.22, r0, 3, i % 2 ? 0xd8302a : 0xf4f1e8, { y: 2 + i * 3 }, 14);
  }
  gb.cyl(1.4, 1.4, 0.3, 0x2a2d33, { y: 19.6 }, 14);
  gb.cyl(1.0, 1.0, 2.2, 0xfff0b0, { y: 20.9 }, 10);
  gb.cone(1.5, 1.6, 0xd8302a, { y: 22.8 }, 12);
  return gb.build();
}

export function wreckGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(5, 3.2, 20, 0x3a2e2a, { y: 0.2, rz: 0.35, rx: 0.12 });
  gb.box(3.6, 3, 5, 0x5a4a40, { y: 2.6, z: -4, rz: 0.35, rx: 0.12 });
  gb.cyl(0.3, 0.3, 9, 0x2a2420, { y: 5, z: 3, rz: 0.55 }, 6);
  gb.box(5.1, 0.6, 20.1, 0x8a3a2a, { y: -1, rz: 0.35, rx: 0.12 });
  return gb.build();
}

export const CONTAINER_COLORS = [0xc2352b, 0x2f6fa8, 0xe08a2a, 0x3a8a4a, 0x8a8f99, 0x7a3a8a];
export function containerGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  // A small stack on a floating barge.
  gb.box(8, 1.6, 14, 0x3a3e48, { y: 0.2 });
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
  const Y = 0xf2b51e;
  gb.box(12, 3, 10, 0x4a4e5a, { y: 0.5 });
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
  gb.box(3, 3, 3.5, 0xe8e8e8, { y: 21.5, z: 2 });
  gb.box(0.4, 9, 0.4, 0x2a2a2a, { y: 18.5, z: -24 });
  gb.box(3, 1, 2.5, 0x2a2a2a, { y: 14, z: -24 });
  gb.box(5, 2, 5, 0x8a8f99, { y: 23.5, z: 14 });
  return gb.build();
}

export function quayGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  // Long side along local X.
  gb.box(36, 4.5, 9, 0x6a6e78, { y: 0 });
  gb.box(36, 0.4, 0.5, 0xe0c020, { y: 2.3, z: 4.3 });
  for (let i = -3; i <= 3; i++) {
    gb.cyl(0.25, 0.3, 0.6, 0x2a2a2a, { x: i * 5, y: 2.5, z: 3.6 }, 6);
    gb.box(0.4, 1.2, 1.2, 0x23252c, { x: i * 5 + 2.5, y: -0.5, z: 4.6 });
  }
  for (let i = -1; i <= 1; i++) {
    gb.cyl(0.15, 0.15, 7, 0x3a3d45, { x: i * 14, y: 5.8, z: 3 }, 5);
    gb.box(1.2, 0.3, 0.6, 0x3a3d45, { x: i * 14, y: 9.3, z: 3.3 });
  }
  gb.box(10, 6, 7, 0x8a4a3a, { x: -10, y: 5, z: -0.5 });
  gb.box(10.4, 0.6, 7.4, 0x4a4e5a, { x: -10, y: 8.2, z: -0.5 });
  return gb.build();
}

export function mineGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.sphere(1, 0x5a1e1e, {}, 12, 9);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const e = i % 2 ? 0.5 : -0.3;
    gb.cyl(0.08, 0.12, 0.6, 0x2a2a2a, { x: Math.cos(a) * Math.cos(e) * 1.05, y: Math.sin(e) * 1.05, z: Math.sin(a) * Math.cos(e) * 1.05, rz: -a + Math.PI / 2, rx: e }, 5);
  }
  gb.cyl(0.6, 0.8, 0.3, 0x2a2a2a, { y: -0.95 }, 8);
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
  const gb = new GeoBuilder();
  const rng = new Rng(seed);
  const count = 34;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const rr = R + rng.range(-120, 200);
    const h = rng.range(60, theme === 'storm' ? 220 : theme === 'volcanic' ? 180 : 140);
    const w = rng.range(140, 300);
    const g = new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    lumpify(g, 0.18, i * 1.7 + seed);
    const col = theme === 'tropical' ? (i % 3 ? 0x3f8f5a : 0x4f9f6a) : theme === 'neon' ? 0x2a2e3e : i % 2 ? style.rock : style.rockDark;
    gb.add(g, col, { x: cx + Math.cos(a) * rr, y: -6, z: cz + Math.sin(a) * rr, sx: w, sy: h, sz: w * rng.range(0.6, 1) });
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
    gb.box(2.4, 1.2, 9, 0xf4f1e8, { y: 0.3 });
    gb.cyl(0.1, 0.12, 11, 0xdddddd, { y: 6.2, z: 0.6 }, 5);
    gb.add(new ConeGeometry(2.6, 9.5, 3), 0xffffff, { x: 0, y: 6.5, z: -1.2, sx: 0.08, ry: Math.PI / 2 });
    gb.add(new ConeGeometry(1.6, 7, 3), 0xff4a3d, { y: 5.5, z: 2.8, sx: 0.08, ry: Math.PI / 2 });
  } else {
    // Freighter.
    gb.box(10, 4, 46, 0x2a3a5a, { y: 0.6 });
    gb.box(10.2, 1, 46.2, 0x8a2a2a, { y: -1.2 });
    gb.box(8, 7, 7, 0xf2efe6, { y: 6, z: -17 });
    gb.cyl(1, 1.2, 5, 0xe0a020, { y: 11, z: -18 }, 8);
    for (let i = 0; i < 5; i++) gb.box(8, 2.6, 6, CONTAINER_COLORS[i % CONTAINER_COLORS.length], { y: 3.9, z: -6 + i * 6.4 });
  }
  return gb.build();
}

// ── Arctic ─────────────────────────────────────────────────────────────────
/** A faceted iceberg: white crown, blue-green underside, unit footprint ≈ 1. */
export function icebergGeometry(variant: number): BufferGeometry {
  const g = new DodecahedronGeometry(1, 1);
  lumpify(g, 0.45, variant * 5.3 + 2, -0.5);
  g.scale(1, 1.1 + variant * 0.45, 1);
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const rng = new Rng(variant * 31 + 7);
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    _c.setHex(y < -0.15 ? 0x6fc8d8 : y < 0.25 ? 0xbfe9f2 : 0xf6fbff).offsetHSL(0, 0, (rng.next() - 0.5) * 0.06);
    for (let k = 0; k < 3; k++) col.set([_c.r, _c.g, _c.b], (i + k) * 3);
  }
  ng.setAttribute('color', new BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

/** A flat drifting ice floe slab (unit radius). */
export function floeGeometry(variant: number): BufferGeometry {
  const g = new CylinderGeometry(1, 1.06, 0.5, 7 + variant, 1);
  lumpify(g, 0.18, variant * 2.7 + 9);
  g.translate(0, 0.05, 0);
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _c.setHex(pos.getY(i) > 0.2 ? 0xf4faff : 0x9fd6e6);
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  ng.setAttribute('color', new BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

// ── Jungle ─────────────────────────────────────────────────────────────────
/** Rainforest giant: buttressed trunk, layered canopy blobs, hanging vines. */
export function jungleTreeGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  const h = 9 + variant * 3;
  gb.cyl(0.45, 0.85, h, 0x6b5338, { y: h / 2 }, 7);
  for (let k = 0; k < 4; k++) gb.box(0.25, 1.8, 1.4, 0x5d4730, { y: 0.8, ry: (k * Math.PI) / 2, z: 0.6 });
  const greens = [0x2f7d32, 0x3a8f3a, 0x276b2c, 0x4aa04a];
  const blobs = 5 + variant;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + variant;
    const d = k === 0 ? 0 : 2.2 + (k % 2) * 0.8;
    gb.sphere(2.4 - (k === 0 ? -0.6 : 0.3 * (k % 3)), greens[k % 4], { x: Math.cos(a) * d, y: h + 0.6 + (k % 2) * 0.9, z: Math.sin(a) * d, sy: 0.62 }, 9, 6);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + variant;
    gb.cyl(0.05, 0.05, 3.5 + k * 0.6, 0x3f6b2a, { x: Math.cos(a) * 2.6, y: h - 1.8 - k * 0.3, z: Math.sin(a) * 2.6 }, 4);
  }
  return gb.build();
}

/** A stepped temple ruin with a shrine on top, overgrown. */
export function ruinGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  const stone = [0x8a8a72, 0x7a7c64, 0x9a9880];
  for (let i = 0; i < 6; i++) {
    const w = 22 - i * 3.2;
    gb.box(w, 2.6, w, stone[i % 3], { y: 1.3 + i * 2.6 });
  }
  gb.box(5, 4, 5, 0x6a6c56, { y: 15.6 + 2 });
  gb.box(2, 2.6, 0.4, 0x2a2a20, { y: 15.6 + 1.3, z: 2.55 });
  gb.box(6, 0.8, 6, 0x8a8a72, { y: 15.6 + 4.4 });
  // Stairs up the front.
  for (let i = 0; i < 6; i++) gb.box(4, 0.5, 1.4, 0xa4a28a, { y: 0.5 + i * 2.6, z: 11 - i * 1.6 });
  // Moss and vines.
  for (let i = 0; i < 10; i++) gb.sphere(1.2 + (i % 3) * 0.4, i % 2 ? 0x3a7d34 : 0x2f6b2c, { x: Math.cos(i * 2.4) * (10 - (i % 4) * 2), y: 2 + (i % 5) * 2.6, z: Math.sin(i * 2.4) * (10 - (i % 4) * 2), sy: 0.5 }, 7, 5);
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
      gb.cyl(0.55, 0.6, 2.4 + (i % 2) * 0.3, i % 2 ? 0x6b5338 : 0x5a432c, { x: -0.1 + (i % 4) * 0.05, y: y + 0.2, z: (i - 4) * 0.12, rz: Math.PI / 2, ry: (i - 4) * 0.06, sy: 1 }, 7);
    }
    for (let i = 0; i < 6; i++) gb.sphere(0.5, 0x2f7d32, { x: (i - 2.5) * 0.4, y: 2.4, z: (i % 2) * 0.4, sy: 0.6 }, 7, 5);
  } else if (variant === 1) {
    for (let i = 0; i < 7; i++) gb.rock(0.42 + (i % 3) * 0.08, i % 2 ? 0xe8f4fa : 0xbfe2ee, { x: (i - 3) * 0.33, y: 0.6 + (i % 2) * 0.4, z: (i % 3 - 1) * 0.3, sy: 2.4, sx: 0.9 });
  } else {
    for (let i = 0; i < 7; i++) gb.rock(0.42, i % 2 ? 0x5a5650 : 0x4a4640, { x: (i - 3) * 0.33, y: 0.5, z: (i % 3 - 1) * 0.3, sy: 2 });
  }
  return gb.build();
}

// ── Canal city ─────────────────────────────────────────────────────────────
const FACADES = [0xd8a26a, 0xc9705a, 0xe8d8b0, 0x8fb0a8, 0xd9c27a, 0xb87a8a];
/** A narrow three/four-storey townhouse; local +Z faces the water. */
export function townhouseGeometry(variant: number): BufferGeometry {
  const gb = new GeoBuilder();
  const floors = 3 + (variant % 2);
  const H = floors * 3.2;
  const col = FACADES[variant % FACADES.length];
  // Foundations run down into the water, Venetian style.
  gb.box(7.6, H + 2.5, 8, col, { y: (H + 2.5) / 2 - 3 });
  gb.box(7.7, 1.2, 8.1, 0x6a6a5a, { y: -1.2 });
  gb.box(8.0, 0.5, 8.4, 0xf2ece0, { y: H - 0.3 });
  // Roof: pitched tiles or a flat parapet.
  if (variant % 3 === 0) gb.box(7.4, 2.6, 8.2, 0xa04a32, { y: H + 1.0, sx: 1, rz: 0 });
  else gb.cone(5.8, 3, 0xa8503a, { y: H + 1.5, ry: Math.PI / 4, sx: 1, sz: 1.06 }, 4);
  // Windows and shutters.
  for (let f = 0; f < floors; f++) {
    for (const x of [-2.2, 0, 2.2]) {
      gb.box(1.1, 1.6, 0.2, 0x2a3440, { x, y: 1.6 + f * 3.2, z: 4.05 });
      gb.box(0.35, 1.7, 0.22, 0x3a6a5a, { x: x - 0.75, y: 1.6 + f * 3.2, z: 4.06 });
      gb.box(0.35, 1.7, 0.22, 0x3a6a5a, { x: x + 0.75, y: 1.6 + f * 3.2, z: 4.06 });
    }
    if (f > 0 && variant % 2 === 0) gb.box(3.4, 0.2, 1, 0x3a3a3a, { y: 0.6 + f * 3.2, z: 4.5 });
  }
  gb.box(1.6, 2.6, 0.2, 0x5a3a22, { y: 0.8, z: 4.05 });
  gb.cyl(0.25, 0.3, 1.2, 0x8a3a2a, { x: 2.6, y: H + 2.6, z: -1.5 }, 6);
  return gb.build();
}

/** 12 m of stone canal wall with a coping and mooring rings; local Z along the wall. */
export function canalWallGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(2.2, 4.4, 12.2, 0x8a7a66, { y: -0.6 });
  gb.box(2.6, 0.4, 12.4, 0xd8cfbf, { y: 1.8 });
  for (const z of [-4, 0, 4]) gb.box(0.2, 0.9, 0.2, 0x3a3a3a, { x: -1.2, y: 0.6, z });
  // Waterline stain.
  gb.box(2.24, 0.5, 12.24, 0x4a5a4a, { y: -0.2 });
  return gb.build();
}

/** A moored gondola, bow along +Z. */
export function gondolaGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(1.4, 0.7, 9, 0x14141a, { y: 0.2 });
  gb.cone(0.7, 2.2, 0x14141a, { y: 0.4, z: 5.4, rx: Math.PI / 2 - 0.4, sz: 0.4 }, 4);
  gb.box(0.1, 1.4, 0.6, 0xd8c88a, { y: 1.5, z: 6.2 });
  gb.box(1.2, 0.3, 1.6, 0x8a2a3a, { y: 0.65, z: -0.5 });
  gb.cyl(0.08, 0.08, 4, 0x6b5338, { y: 1.8, z: -3.6, rx: 0.3 }, 4);
  return gb.build();
}

/** Iron street lamp (the glow is added by the scenery as a light point). */
export function lampGeometry(): BufferGeometry {
  const gb = new GeoBuilder();
  gb.cyl(0.12, 0.18, 4.6, 0x22262c, { y: 2.3 }, 6);
  gb.box(0.9, 0.12, 0.12, 0x22262c, { y: 4.5, z: 0.3 });
  gb.cyl(0.25, 0.32, 0.6, 0xffd27a, { y: 4.2, z: 0.7 }, 6);
  return gb.build();
}
