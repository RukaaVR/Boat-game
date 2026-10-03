/**
 * A generated race course: centreline, racing line, speed profile, gates and
 * every gameplay feature placed along it. Pure data + queries — no rendering.
 */

import { Rng } from '../core/rng';
import { clamp, wrapAngle } from '../core/mathx';
import type { BoostPad, Ramp } from '../core/types';
import type { SwellZone } from '../water/waves';
import type { TrackDef } from './trackDefs';

export interface Gate {
  index: number;
  s: number;
  x: number;
  z: number;
  heading: number;
}

export interface Shortcut {
  s1: number;
  s2: number;
  /** Polyline xz pairs, ~3 m spacing. */
  pts: Float32Array;
  /** Cumulative length at each point. */
  len: Float32Array;
  length: number;
  width: number;
}

export interface Hazard {
  x: number;
  z: number;
  r: number;
  kind: 'rock' | 'mine';
}

export interface TrackPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
  heading: number;
}

export interface Projection {
  s: number;
  index: number;
  lateral: number;
  dist: number;
  /** True if the point is better described by a shortcut than by the main line. */
  shortcut: number;
}

const SPACING = 2.5;

export class Track {
  readonly def: TrackDef;
  readonly n: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Signed curvature, positive = turning right (1/m). */
  readonly curv: Float32Array;
  readonly dist: Float32Array;
  /** Racing-line lateral offset (m, + = right). */
  readonly line: Float32Array;
  /** AI target speed (m/s at full-boat top speed 33). */
  readonly speed: Float32Array;
  readonly length: number;
  /** Raced distance per lap: the whole loop, or the start→finish stretch of a sprint. */
  readonly lapLength: number;
  /** Point-to-point sprint (start and finish at different places, the rest walled off). */
  readonly sprint: boolean;
  readonly width: number;
  readonly gates: Gate[] = [];
  readonly ramps: Ramp[] = [];
  readonly pads: BoostPad[] = [];
  readonly swells: SwellZone[] = [];
  readonly hazards: Hazard[] = [];
  readonly shortcuts: Shortcut[] = [];
  readonly bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  readonly rng: Rng;

  constructor(def: TrackDef) {
    this.def = def;
    this.width = def.width;
    this.rng = new Rng(def.seed);

    // ── Centreline from the harmonic radius profile ───────────────────────────
    let ampScale = 1;
    let dense: Float64Array;
    for (;;) {
      dense = buildDense(def, ampScale);
      if (minTurnRadius(dense) > 30 || ampScale < 0.3) break;
      ampScale *= 0.85;
    }
    const M = dense.length / 2;
    const cum = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M;
      cum[i + 1] = cum[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1]);
    }
    const total = cum[M];
    const n = Math.round(total / SPACING);
    this.n = n;
    this.length = total;
    this.sprint = !!def.sprint;
    this.lapLength = def.sprint ? total * def.sprint : total;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.curv = new Float32Array(n);
    this.dist = new Float32Array(n);
    this.line = new Float32Array(n);
    this.speed = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = (i / n) * total;
      while (cum[k + 1] < s) k++;
      const f = (s - cum[k]) / (cum[k + 1] - cum[k]);
      const j = (k + 1) % M;
      this.px[i] = dense[k * 2] + (dense[j * 2] - dense[k * 2]) * f;
      this.pz[i] = dense[k * 2 + 1] + (dense[j * 2 + 1] - dense[k * 2 + 1]) * f;
      this.dist[i] = s;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const ha = Math.atan2(this.tx[a], this.tz[a]);
      const hb = Math.atan2(this.tx[b], this.tz[b]);
      this.curv[i] = -wrapAngle(hb - ha) / (2 * SPACING);
    }
    this.computeBounds();
    this.computeRacingLine();
    this.computeSpeedProfile();
    this.placeGates();
    this.findShortcuts();
    this.placeFeatures();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────────────

  /** Is arc length s on the raced part of the course (always true for loops)? */
  inPlay(s: number, margin = 0) {
    if (!this.sprint) return true;
    const w = this.wrapS(s);
    return w <= this.lapLength + margin || w >= this.length - 90 - margin;
  }

  /** Index into `gates` of the gate a racer with `checkpoints` passed is heading for. */
  gateIndexFor(checkpoints: number) {
    return this.sprint ? Math.min(checkpoints, this.gates.length - 1) : checkpoints % this.gates.length;
  }

  /** Number of checkpoint gates per lap (a sprint's finish gate is its last checkpoint). */
  get checkpointCount() {
    return this.sprint ? this.gates.length - 1 : this.gates.length;
  }

  wrapS(s: number) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  indexAt(s: number) {
    return Math.floor(this.wrapS(s) / SPACING) % this.n;
  }

  /** Interpolated centreline point + tangent at arc length s. */
  sample(s: number, out: TrackPoint): TrackPoint {
    const w = this.wrapS(s) / SPACING;
    const i = Math.floor(w) % this.n;
    const j = (i + 1) % this.n;
    const f = w - Math.floor(w);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * f;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * f;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * f;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * f;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.heading = Math.atan2(out.tx, out.tz);
    return out;
  }

  lineAt(s: number) {
    const w = this.wrapS(s) / SPACING;
    const i = Math.floor(w) % this.n;
    const j = (i + 1) % this.n;
    const f = w - Math.floor(w);
    return this.line[i] + (this.line[j] - this.line[i]) * f;
  }

  speedAt(s: number) {
    return this.speed[this.indexAt(s)];
  }

  curvAt(s: number) {
    return this.curv[this.indexAt(s)];
  }

  /**
   * Nearest centreline point. With a valid `hint` index only a window around it
   * is searched (O(1) per frame and immune to jumping across the infield).
   */
  project(x: number, z: number, hint: number, out: Projection): Projection {
    const n = this.n;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let o = -60; o <= 60; o++) {
        const i = (hint + o + n) % n;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (hint < 0 || bestD > 160 * 160) {
      for (let i = 0; i < n; i += 4) {
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      for (let o = -4; o <= 4; o++) {
        const i = (best + o + n) % n;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // Refine along the tangent.
    const dx = x - this.px[best];
    const dz = z - this.pz[best];
    const along = clamp(dx * this.tx[best] + dz * this.tz[best], -SPACING, SPACING);
    out.index = best;
    out.s = this.wrapS(this.dist[best] + along);
    out.lateral = dx * -this.tz[best] + dz * this.tx[best];
    out.dist = Math.sqrt(bestD);
    out.shortcut = -1;
    // Shortcut override: if a shortcut describes the point better, use its mapping.
    for (let c = 0; c < this.shortcuts.length; c++) {
      const sc = this.shortcuts[c];
      const sOnMain = out.s;
      const inSpan = this.inSpan(sOnMain, sc.s1 - 40, sc.s2 + 40);
      if (!inSpan && out.dist < this.width * 1.5) continue;
      const r = projectPolyline(sc, x, z);
      if (r.d < sc.width * 0.8 && r.d < Math.abs(out.lateral) - this.width * 0.3) {
        out.s = this.wrapS(sc.s1 + (this.wrapS(sc.s2 - sc.s1) * r.l) / sc.length);
        out.index = this.indexAt(out.s);
        out.lateral = 0;
        out.dist = r.d;
        out.shortcut = c;
      }
    }
    return out;
  }

  inSpan(s: number, a: number, b: number) {
    const L = this.length;
    const span = (((b - a) % L) + L) % L;
    const off = (((s - a) % L) + L) % L;
    return off <= span;
  }

  /** Start grid slot: 2 columns, rows every 9 m behind the line. */
  gridSlot(slot: number, out: TrackPoint) {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const s = -14 - row * 10 - col * 4;
    this.sample(s, out);
    const lat = (col === 0 ? -1 : 1) * this.width * 0.18;
    out.x += -out.tz * lat;
    out.z += out.tx * lat;
    return out;
  }

  /** Minimum distance from (x,z) to the centreline (coarse, for generation only). */
  distToCentre(x: number, z: number) {
    let best = Infinity;
    for (let i = 0; i < this.n; i += 2) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Minimum distance from (x,z) to any shortcut corridor centre. */
  distToShortcut(x: number, z: number) {
    let best = Infinity;
    for (const sc of this.shortcuts) {
      for (let i = 0; i < sc.pts.length; i += 2) {
        const d = Math.hypot(x - sc.pts[i], z - sc.pts[i + 1]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generation
  // ─────────────────────────────────────────────────────────────────────────

  private computeBounds() {
    let a = Infinity,
      b = -Infinity,
      c = Infinity,
      d = -Infinity;
    for (let i = 0; i < this.n; i++) {
      a = Math.min(a, this.px[i]);
      b = Math.max(b, this.px[i]);
      c = Math.min(c, this.pz[i]);
      d = Math.max(d, this.pz[i]);
    }
    Object.assign(this.bounds, { minX: a, maxX: b, minZ: c, maxZ: d });
  }

  private computeRacingLine() {
    const n = this.n;
    const W = this.width;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = clamp(this.curv[i] * 1100, -1, 1) * W * 0.3;
    // Two box blurs ≈ gaussian: anticipates corners (late apex feel).
    let src = raw;
    for (let pass = 0; pass < 3; pass++) {
      const dst = new Float32Array(n);
      const R = 18;
      let acc = 0;
      for (let o = -R; o <= R; o++) acc += src[(o + n) % n];
      for (let i = 0; i < n; i++) {
        dst[i] = acc / (2 * R + 1);
        acc += src[(i + R + 1) % n] - src[(i - R + n) % n];
      }
      src = dst;
    }
    this.line.set(src);
  }

  private computeSpeedProfile() {
    const n = this.n;
    const omega = 1.25; // effective sustained yaw rate at speed, rad/s
    for (let i = 0; i < n; i++) {
      // Use a short window max curvature so the profile sees the whole corner.
      let k = 0;
      for (let o = -3; o <= 3; o++) k = Math.max(k, Math.abs(this.curv[(i + o + n) % n]));
      const r = 1 / Math.max(k, 1e-4);
      this.speed[i] = Math.min(40, omega * r * 1.05);
    }
    // Back-propagate braking (two laps so the loop closure settles).
    const decel = 11;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const lim = Math.sqrt(this.speed[j] * this.speed[j] + 2 * decel * SPACING);
        if (this.speed[i] > lim) this.speed[i] = lim;
      }
    }
  }

  private placeGates() {
    const G = Math.max(6, Math.round(this.lapLength / 220));
    const p: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
    for (let g = 0; g < G + (this.sprint ? 1 : 0); g++) {
      const s = (g / G) * this.lapLength;
      this.sample(s, p);
      this.gates.push({ index: g, s, x: p.x, z: p.z, heading: p.heading });
    }
  }

  private findShortcuts() {
    const want = this.def.shortcuts;
    if (want <= 0) return;
    const L = this.length;
    const W = this.width;
    type Cand = { s1: number; s2: number; ratio: number };
    const cands: Cand[] = [];
    const a: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0, heading: 0 };
    const b: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0, heading: 0 };
    const end = this.sprint ? this.lapLength : L;
    for (let s1 = 120; s1 < end - 500; s1 += 12) {
      for (let span = 140; span <= 560; span += 20) {
        const s2 = s1 + span;
        if (s2 > end - 120) break;
        this.sample(s1, a);
        this.sample(s2, b);
        const chord = Math.hypot(b.x - a.x, b.z - a.z);
        const ratio = chord / span;
        if (ratio > 0.8 || span - chord < 50 || chord < 60) continue;
        // The chord must clear the main course in its interior.
        let ok = true;
        let maxD = 0;
        for (let k = 1; k < 10; k++) {
          const f = k / 10;
          const x = a.x + (b.x - a.x) * f;
          const z = a.z + (b.z - a.z) * f;
          const d = this.distToCentre(x, z);
          maxD = Math.max(maxD, d);
          if ((f > 0.2 && f < 0.8 && d < W * 0.5 + 18) || d < W * 0.35) {
            ok = false;
            break;
          }
        }
        if (!ok || maxD < W) continue;
        cands.push({ s1, s2, ratio: Math.abs(span - chord - 95) });
      }
    }
    cands.sort((x, y) => x.ratio - y.ratio);
    for (const c of cands) {
      if (this.shortcuts.length >= want) break;
      if (this.shortcuts.some((sc) => !(c.s2 + 150 < sc.s1 || c.s1 > sc.s2 + 150))) continue;
      this.sample(c.s1, a);
      this.sample(c.s2, b);
      // Gentle S-bend so the channel reads as a channel, not a ruler line.
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const nx = -(b.z - a.z);
      const nz = b.x - a.x;
      const nl = Math.hypot(nx, nz) || 1;
      const bend = (this.rng.next() - 0.5) * 0.25 * Math.hypot(b.x - a.x, b.z - a.z);
      const cx = mx + (nx / nl) * bend;
      const cz = mz + (nz / nl) * bend;
      const pts: number[] = [];
      const steps = 64;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        pts.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.z + 2 * u * t * cz + t * t * b.z);
      }
      const P = new Float32Array(pts);
      const len = new Float32Array(steps + 1);
      for (let k = 1; k <= steps; k++) len[k] = len[k - 1] + Math.hypot(P[k * 2] - P[k * 2 - 2], P[k * 2 + 1] - P[k * 2 - 1]);
      this.shortcuts.push({ s1: c.s1, s2: c.s2, pts: P, len, length: len[steps], width: 16 });
    }
  }

  /** Is arc length s within `m` metres of any feature already placed? */
  private crowded(s: number, used: number[], m: number) {
    for (const u of used) {
      const d = Math.abs(this.wrapS(s - u + this.length / 2) - this.length / 2);
      if (d < m) return true;
    }
    return false;
  }

  private straightness(s: number, span: number) {
    let k = 0;
    for (let o = -span; o <= span; o += 5) k = Math.max(k, Math.abs(this.curvAt(s + o)));
    return k;
  }

  private placeFeatures() {
    const rng = this.rng;
    const L = this.length;
    const W = this.width;
    const used: number[] = [0, 30, L - 60];
    for (const g of this.gates) used.push(g.s);
    for (const sc of this.shortcuts) used.push(sc.s1, sc.s2);
    const p: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0, heading: 0 };

    // Candidate arc lengths sorted by straightness.
    const cands: { s: number; k: number }[] = [];
    const end = this.sprint ? this.lapLength : L;
    for (let s = 80; s < end - 80; s += 15) cands.push({ s, k: this.straightness(s, 45) });
    cands.sort((x, y) => x.k - y.k);

    // Ramps on the straightest sections, offset from the racing line so taking
    // one is a choice.
    let placed = 0;
    for (const c of cands) {
      if (placed >= this.def.ramps) break;
      if (this.crowded(c.s, used, 90)) continue;
      this.sample(c.s, p);
      const lat = (rng.next() < 0.5 ? -1 : 1) * W * rng.range(0.05, 0.24);
      this.ramps.push({ x: p.x - p.tz * lat, z: p.z + p.tx * lat, heading: p.heading, length: 15, width: 10, height: 3.4 });
      used.push(c.s);
      placed++;
    }

    // Swell zones: long open sections where the sea is allowed to build.
    placed = 0;
    for (const c of cands) {
      if (placed >= this.def.swells) break;
      if (this.swells.some((z) => Math.hypot(z.x - this.px[this.indexAt(c.s)], z.z - this.pz[this.indexAt(c.s)]) < 260)) continue;
      if (this.ramps.some((r) => Math.hypot(r.x - this.px[this.indexAt(c.s)], r.z - this.pz[this.indexAt(c.s)]) < 90)) continue;
      this.sample(c.s, p);
      this.swells.push({ x: p.x, z: p.z, radius: 75, gain: 0.85 });
      placed++;
    }

    // Boost pads: corner exits first (reward the clean line), then straights.
    const exits: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const k0 = Math.abs(this.curv[i]);
      const k1 = Math.abs(this.curv[(i + 12) % this.n]);
      if (k0 > 0.012 && k1 < 0.006 && this.dist[(i + 16) % this.n] < end - 60) exits.push(this.dist[(i + 16) % this.n]);
    }
    placed = 0;
    const padS = [...exits, ...cands.map((c) => c.s)];
    for (const s of padS) {
      if (placed >= this.def.pads) break;
      if (this.crowded(s, used, 60)) continue;
      this.sample(s, p);
      const lat = this.lineAt(s) + rng.range(-4, 4);
      this.pads.push({ x: p.x - p.tz * lat, z: p.z + p.tx * lat, heading: p.heading, length: 9, width: 6 });
      used.push(s);
      placed++;
    }

    // On-course hazards, placed on the side away from the racing line.
    placed = 0;
    for (let tries = 0; tries < 400 && placed < this.def.hazards; tries++) {
      const s = rng.range(100, end - 100);
      if (this.crowded(s, used, 50)) continue;
      this.sample(s, p);
      const line = this.lineAt(s);
      const side = line > 0 ? -1 : 1;
      const lat = side * W * rng.range(0.22, 0.36);
      const kind = this.def.theme === 'volcanic' || this.def.theme === 'neon' ? (rng.next() < 0.6 ? 'mine' : 'rock') : 'rock';
      this.hazards.push({ x: p.x - p.tz * lat, z: p.z + p.tx * lat, r: kind === 'mine' ? 1.3 : rng.range(2.2, 3.4), kind });
      used.push(s);
      placed++;
    }
  }
}

function buildDense(def: TrackDef, ampScale: number) {
  const M = 2048;
  const out = new Float64Array(M * 2);
  const cr = Math.cos(def.rotation);
  const sr = Math.sin(def.rotation);
  for (let i = 0; i < M; i++) {
    const th = (i / M) * Math.PI * 2;
    let r = 1;
    for (const [h, a, ph] of def.harmonics) r += a * ampScale * Math.cos(h * th + ph);
    r *= def.radius;
    const x = Math.cos(th) * r * def.aspect;
    const z = Math.sin(th) * r;
    out[i * 2] = x * cr - z * sr;
    out[i * 2 + 1] = x * sr + z * cr;
  }
  return out;
}

function minTurnRadius(d: Float64Array) {
  const M = d.length / 2;
  let minR = Infinity;
  for (let i = 0; i < M; i += 2) {
    const a = ((i - 6 + M) % M) * 2;
    const b = i * 2;
    const c = ((i + 6) % M) * 2;
    const ax = d[a],
      az = d[a + 1],
      bx = d[b],
      bz = d[b + 1],
      cx = d[c],
      cz = d[c + 1];
    const ab = Math.hypot(bx - ax, bz - az);
    const bc = Math.hypot(cx - bx, cz - bz);
    const ca = Math.hypot(ax - cx, az - cz);
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if (area2 < 1e-6) continue;
    const R = (ab * bc * ca) / (2 * area2);
    minR = Math.min(minR, R);
  }
  return minR;
}

const _pp = { d: 0, l: 0 };
function projectPolyline(sc: Shortcut, x: number, z: number) {
  let best = Infinity;
  let bestL = 0;
  const P = sc.pts;
  const n = P.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = P[i * 2],
      az = P[i * 2 + 1];
    const bx = P[i * 2 + 2],
      bz = P[i * 2 + 3];
    const ex = bx - ax,
      ez = bz - az;
    const l2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
    const qx = ax + ex * t - x;
    const qz = az + ez * t - z;
    const d = qx * qx + qz * qz;
    if (d < best) {
      best = d;
      bestL = sc.len[i] + (sc.len[i + 1] - sc.len[i]) * t;
    }
  }
  _pp.d = Math.sqrt(best);
  _pp.l = bestL;
  return _pp;
}

export function projectOnShortcut(sc: Shortcut, x: number, z: number) {
  return projectPolyline(sc, x, z);
}

/** Point at distance l along a shortcut. */
export function shortcutPoint(sc: Shortcut, l: number, out: { x: number; z: number; tx: number; tz: number }) {
  const n = sc.pts.length / 2;
  l = clamp(l, 0, sc.length);
  let i = 0;
  while (i < n - 2 && sc.len[i + 1] < l) i++;
  const f = (l - sc.len[i]) / Math.max(1e-6, sc.len[i + 1] - sc.len[i]);
  const ax = sc.pts[i * 2],
    az = sc.pts[i * 2 + 1];
  const bx = sc.pts[i * 2 + 2],
    bz = sc.pts[i * 2 + 3];
  out.x = ax + (bx - ax) * f;
  out.z = az + (bz - az) * f;
  const dl = Math.hypot(bx - ax, bz - az) || 1;
  out.tx = (bx - ax) / dl;
  out.tz = (bz - az) / dl;
  return out;
}
