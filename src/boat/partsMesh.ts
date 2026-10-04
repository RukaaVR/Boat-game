/**
 * Visible bolt-on parts (garage PARTS tab), modelled like the rest of the
 * boat fittings: primitives and a few swept tubes / extruded fins, merged into
 * the boat's single `parts` mesh with vertex colours, so they share its cel
 * material, ink outline and distance LOD (no extra draw calls).
 */

import { BufferAttribute, BufferGeometry, CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { GeoBuilder } from '../render/geo';
import { shade } from '../render/textures';
import type { Livery } from './livery';
import type { FittedParts } from './parts';
import type { BoatSpec } from './specs';

const DARK = 0x23262e;
const STEEL = 0x8c96a6;
const RUBBER = 0x24262c;
const HAZARD = 0xffc21e;
const GLOW = 0x5ff4ff;

/** What the parts need to know about the hull (functions of station t, 0 = stern, 1 = bow). */
export interface HullProbe {
  spec: BoatSpec;
  /** Main hull length (m) and each hull's lateral centre. */
  L: number;
  hulls: { offsetX: number; L: number; beam: (t: number) => number; sheer: (t: number) => number; chine: (t: number) => number }[];
  /** Outermost hull side (m from centreline) at station t. */
  outerX: (t: number) => number;
  /** Deck height on the centreline at station t. */
  deck: (t: number) => number;
  /** Height of the rear deck where engine parts sit. */
  rearDeckY: number;
}

/**
 * A flat fin outline (z, y points, convex, counter-clockwise seen from +X)
 * extruded `thick` metres along X. Flat-shaded so the cel bands stay crisp.
 */
function finGeo(pts: [number, number][], thick: number) {
  const n = pts.length;
  const pos: number[] = [];
  const h = thick / 2;
  const v = (i: number, side: number) => [side * h, pts[i % n][1], pts[i % n][0]];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let i = 1; i < n - 1; i++) {
    tri(v(0, 1), v(i, 1), v(i + 1, 1));
    tri(v(0, -1), v(i + 1, -1), v(i, -1));
  }
  for (let i = 0; i < n; i++) {
    tri(v(i, 1), v(i, -1), v(i + 1, 1));
    tri(v(i + 1, 1), v(i, -1), v(i + 1, -1));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  // Winding depends on the outline direction; make the normals face out either way.
  const p = g.getAttribute('position');
  const nr = g.getAttribute('normal');
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.count; i++) (cx += p.getX(i)), (cy += p.getY(i)), (cz += p.getZ(i));
  cx /= p.count;
  cy /= p.count;
  cz /= p.count;
  let flip = 0;
  for (let i = 0; i < p.count; i += 3) flip += (p.getX(i) - cx) * nr.getX(i) + (p.getY(i) - cy) * nr.getY(i) + (p.getZ(i) - cz) * nr.getZ(i);
  if (flip < 0) {
    const a = p.array as Float32Array;
    for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) [a[i + 3 + k], a[i + 6 + k]] = [a[i + 6 + k], a[i + 3 + k]];
    g.computeVertexNormals();
  }
  return g;
}

/** A tube through points along one hull side. */
function sideTube(gb: GeoBuilder, pts: Vector3[], r: number, col: number | string, radial = 4, seg = 14) {
  gb.add(new TubeGeometry(new CatmullRomCurve3(pts), seg, r, radial, false), col);
}

export function addFittedParts(gb: GeoBuilder, P: HullProbe, liv: Livery, fit: FittedParts) {
  const L = P.L;
  const stern = -0.5 * L;
  const accent = liv.accent;
  const hullCol = liv.hull;
  const outer = P.hulls.length > 1;

  // ── Hull kits ────────────────────────────────────────────────────────────
  if (fit.hull === 'rails') {
    // A diamond-section spray rail along each outer side, between chine and sheer,
    // ending in a sharp swept "razor" fin near the bow.
    for (const h of P.hulls) {
      for (const sd of [-1, 1]) {
        if (outer && Math.sign(h.offsetX) === -sd) continue;
        const pts: Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = 0.08 + (k / 8) * 0.74;
          const y = h.chine(t) * 0.55 + h.sheer(t) * 0.45;
          pts.push(new Vector3(h.offsetX + sd * (h.beam(t) * 0.985 + 0.03), y, (t - 0.5) * h.L));
        }
        sideTube(gb, pts, 0.04, accent, 4, 16);
        const tb = 0.8;
        const yb = h.chine(tb) * 0.55 + h.sheer(tb) * 0.45;
        gb.add(finGeo([[0, 0], [0.42, 0.02], [0.05, 0.16]], 0.03), 0xf8f6ee, { x: h.offsetX + sd * (h.beam(tb) * 0.98 + 0.03), y: yb, z: (tb - 0.5) * h.L - 0.38, ry: sd * 0.08 });
      }
    }
  } else if (fit.hull === 'step') {
    // Planing pads (dark skirts with an accent lip) on the aft half of each
    // hull, a step notch, and a flat bow splitter.
    for (const h of P.hulls) {
      for (const sd of [-1, 1]) {
        if (outer && Math.sign(h.offsetX) === -sd) continue;
        const pts: Vector3[] = [];
        for (let k = 0; k <= 5; k++) {
          const t = 0.04 + (k / 5) * 0.46;
          pts.push(new Vector3(h.offsetX + sd * (h.beam(t) * 0.93 + 0.05), h.chine(t) + 0.03, (t - 0.5) * h.L));
        }
        gb.add(new TubeGeometry(new CatmullRomCurve3(pts), 10, 0.06, 3, false), DARK, { sy: 0.6 });
        const lip = pts.map((p) => new Vector3(p.x + sd * 0.03, p.y * 0.6 + 0.045, p.z));
        sideTube(gb, lip, 0.022, accent, 4, 10);
        // Step notch: a dark vertical bar where the pad ends.
        const ts = 0.5;
        gb.box(0.03, Math.max(0.08, h.sheer(ts) - h.chine(ts) - 0.06), 0.07, DARK, { x: h.offsetX + sd * (h.beam(ts) * 0.99 + 0.012), y: (h.sheer(ts) + h.chine(ts)) / 2 - 0.02, z: (ts - 0.5) * h.L });
      }
    }
    const tb = 0.93;
    const w = Math.max(0.35, P.outerX(tb) * 1.6);
    gb.box(w, 0.035, 0.42, DARK, { y: P.hulls[0].chine(tb) + 0.06, z: (tb - 0.5) * L + 0.12, rx: -0.08 });
    gb.box(w * 0.9, 0.02, 0.06, accent, { y: P.hulls[0].chine(tb) + 0.08, z: (tb - 0.5) * L + 0.33, rx: -0.08 });
  } else if (fit.hull === 'bumper') {
    // Fat rubber fenders along the sheer with hazard bands, a steel bow guard
    // and a stern bumper block.
    for (const h of P.hulls) {
      for (const sd of [-1, 1]) {
        if (outer && Math.sign(h.offsetX) === -sd) continue;
        const pts: Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = 0.06 + (k / 8) * 0.78;
          pts.push(new Vector3(h.offsetX + sd * (h.beam(t) + 0.05), h.sheer(t) - 0.09, (t - 0.5) * h.L));
        }
        sideTube(gb, pts, 0.075, RUBBER, 6, 16);
        for (const t of [0.22, 0.45, 0.68]) {
          const x = h.offsetX + sd * (h.beam(t) + 0.05);
          gb.cyl(0.082, 0.082, 0.08, HAZARD, { x, y: h.sheer(t) - 0.09, z: (t - 0.5) * h.L, rx: Math.PI / 2 }, 8);
        }
      }
    }
    const tb = 0.9;
    const bz = (tb - 0.5) * L + 0.2;
    const by = P.deck(tb) + 0.05;
    const bw = Math.max(0.3, P.outerX(tb) + 0.12);
    gb.torus(bw, 0.035, STEEL, { y: by, z: bz - bw * 0.55, rx: Math.PI / 2, sz: 0.55 }, Math.PI);
    for (const sd of [-1, 1]) gb.cyl(0.03, 0.03, 0.22, STEEL, { x: sd * bw * 0.7, y: by - 0.08, z: bz - bw * 0.35 });
    gb.box(Math.min(1.2, P.outerX(0.02) * 1.7), 0.14, 0.12, RUBBER, { y: P.deck(0.02) - 0.12, z: stern - 0.03 });
    gb.box(Math.min(1.2, P.outerX(0.02) * 1.7) * 0.5, 0.03, 0.125, HAZARD, { y: P.deck(0.02) - 0.12, z: stern - 0.03 });
  }

  // ── Engines ──────────────────────────────────────────────────────────────
  const ry = P.rearDeckY;
  if (fit.engine === 'twin') {
    // Two jet pods hung off the transom corners on short pylons.
    const px = Math.max(0.36, Math.min(0.7, P.outerX(0.04) * 0.75));
    for (const sd of [-1, 1]) {
      const x = sd * px;
      gb.box(0.08, 0.2, 0.26, DARK, { x: x * 0.88, y: ry - 0.2, z: stern + 0.02 });
      gb.capsule(0.13, 0.42, hullCol, { x, y: ry - 0.3, z: stern - 0.12, rx: Math.PI / 2 });
      gb.cyl(0.14, 0.14, 0.06, accent, { x, y: ry - 0.3, z: stern - 0.02, rx: Math.PI / 2 }, 10);
      gb.cyl(0.1, 0.12, 0.16, DARK, { x, y: ry - 0.3, z: stern - 0.4, rx: Math.PI / 2 }, 10);
      gb.cyl(0.075, 0.075, 0.03, 0x0a0b0f, { x, y: ry - 0.3, z: stern - 0.48, rx: Math.PI / 2 }, 10);
    }
  } else if (fit.engine === 'cowl') {
    // Supercharger cowl: a hull-coloured hump with a ram scoop on top and two
    // chrome exhaust stacks raking back.
    const cz = stern + 0.34;
    gb.capsule(0.2, 0.36, hullCol, { y: ry + 0.06, z: cz, rx: Math.PI / 2, sx: 1.25, sy: 1, sz: 0.85 });
    gb.box(0.26, 0.14, 0.3, DARK, { y: ry + 0.28, z: cz + 0.08 });
    gb.box(0.2, 0.08, 0.02, 0x0a0b0f, { y: ry + 0.29, z: cz + 0.235 });
    gb.box(0.3, 0.035, 0.34, accent, { y: ry + 0.365, z: cz + 0.08 });
    for (const sd of [-1, 1]) {
      gb.cyl(0.045, 0.055, 0.42, STEEL, { x: sd * 0.2, y: ry + 0.28, z: cz - 0.16, rx: -0.55 }, 8);
      gb.cyl(0.05, 0.05, 0.05, 0x111318, { x: sd * 0.2, y: ry + 0.46, z: cz - 0.28, rx: -0.55 }, 8);
    }
  } else if (fit.engine === 'core') {
    // Hybrid pod: a dark capsule wrapped by glowing coils, two cooling fins.
    const cz = stern + 0.36;
    gb.capsule(0.17, 0.34, DARK, { y: ry + 0.12, z: cz, rx: Math.PI / 2 });
    for (const k of [-0.13, 0, 0.13]) gb.torus(0.18, 0.025, GLOW, { y: ry + 0.12, z: cz + k });
    gb.sphere(0.07, GLOW, { y: ry + 0.12, z: cz + 0.36 }, 8, 6);
    for (const sd of [-1, 1]) gb.add(finGeo([[0, 0], [0.32, 0], [0.06, 0.2]], 0.03), shade(String(accent), -0.1), { x: sd * 0.12, y: ry + 0.2, z: cz - 0.18, rz: sd * 0.6 });
  }

  // ── Fins ─────────────────────────────────────────────────────────────────
  if (fit.fins === 'shark') {
    // Twin swept dorsals on the aft quarter, canted out.
    const t = 0.13;
    const x = Math.max(0.22, P.outerX(t) * 0.62);
    for (const sd of [-1, 1]) {
      const fin = finGeo([[0.42, 0], [-0.12, 0], [-0.3, 0.5], [-0.14, 0.5]], 0.05);
      gb.add(fin, accent, { x: sd * x, y: P.deck(t) - 0.02, z: (t - 0.5) * L + 0.1, rz: -sd * 0.22 });
      gb.box(0.1, 0.04, 0.5, DARK, { x: sd * x, y: P.deck(t) - 0.01, z: (t - 0.5) * L + 0.15 });
    }
  } else if (fit.fins === 'winglets') {
    // Stub wings off the sides amidships with upturned tips.
    const t = 0.42;
    const x0 = P.outerX(t) - 0.04;
    const y = Math.min(P.deck(t), Math.max(...P.hulls.map((h) => h.sheer(t)))) - 0.04;
    for (const sd of [-1, 1]) {
      const wing = finGeo([[0.32, 0], [-0.3, 0], [-0.36, 0.52], [-0.08, 0.52]], 0.045);
      // Lay the outline flat: y of the outline becomes lateral span.
      gb.add(wing, hullCol, { x: sd * x0, y, z: (t - 0.5) * L, rz: -sd * (Math.PI / 2 - 0.12) });
      const tipX = sd * (x0 + 0.52 * Math.cos(0.12));
      const tipY = y + 0.52 * Math.sin(0.12);
      gb.add(finGeo([[0.12, 0], [-0.3, 0], [-0.4, 0.26], [-0.18, 0.26]], 0.04), accent, { x: tipX, y: tipY - 0.02, z: (t - 0.5) * L - 0.06, rz: -sd * 0.12 });
    }
  } else if (fit.fins === 'rudders') {
    // Two deep rudder blades on the transom, joined by a steel tie bar.
    const px = Math.max(0.26, Math.min(0.55, P.outerX(0.03) * 0.55));
    const top = P.deck(0.02) + 0.18;
    for (const sd of [-1, 1]) {
      gb.add(finGeo([[0.1, 0], [-0.22, 0.04], [-0.24, 0.62], [0.04, 0.66]], 0.05), accent, { x: sd * px, y: top - 0.66, z: stern - 0.1 });
      gb.box(0.07, 0.07, 0.16, STEEL, { x: sd * px, y: top - 0.04, z: stern - 0.04 });
    }
    gb.cyl(0.022, 0.022, px * 2, STEEL, { y: top, z: stern - 0.16, rz: Math.PI / 2 }, 6);
  }
}
