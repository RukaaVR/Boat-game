/**
 * Environment LAYOUT — where everything goes, as plain data.
 *
 * The simulation consumes the colliders and buoys; the renderer consumes the
 * prop list. Keeping placement separate from geometry means the race can run
 * headless (tests) and the visual builder never has to reason about gameplay
 * clearances: if a prop is in this list, it has already been checked against
 * the course, the shortcut corridors, the start grid and every other prop.
 */

import { Rng } from '../core/rng';
import type { Buoy, Collider, StuntRing, ThemeId } from '../core/types';
import type { Track, TrackPoint } from '../race/track';

export type PropKind =
  | 'island'
  | 'rock'
  | 'seastack'
  | 'palm'
  | 'hut'
  | 'dock'
  | 'lighthouse'
  | 'waterfall'
  | 'wreck'
  | 'container'
  | 'crane'
  | 'tower'
  | 'quay'
  | 'bridge'
  | 'lavarock'
  | 'vent'
  | 'volcano'
  | 'mine'
  | 'pine';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  /** Secondary size parameter (island radius, building height, quay length…). */
  size: number;
  variant: number;
}

export interface Sign {
  x: number;
  z: number;
  heading: number;
  /** +1 = arrow points right, −1 = left. */
  dir: number;
}

export interface Layout {
  theme: ThemeId;
  props: Prop[];
  colliders: Collider[];
  buoys: Buoy[];
  signs: Sign[];
  rings: StuntRing[];
  /** Island footprints for the shallow-water map: x, z, radius. */
  islands: { x: number; z: number; r: number }[];
  /** World bounds of the playable/visible area. */
  extent: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const _p: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0, heading: 0 };

export function buildLayout(track: Track): Layout {
  const theme = track.def.theme;
  const rng = new Rng(track.def.seed * 7 + 13);
  const W = track.width;
  const props: Prop[] = [];
  const colliders: Collider[] = [];
  const islands: Layout['islands'] = [];
  const b = track.bounds;
  const pad = 420;
  const extent = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  // Occupancy check against everything placed so far.
  const occupied: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number, courseMargin: number) => {
    if (track.distToCentre(x, z) < W * 0.5 + r + courseMargin) return false;
    if (track.distToShortcut(x, z) < 12 + r + 6) return false;
    for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r + 4) return false;
    return true;
  };
  const place = (p: Prop, colR: number, kind: Collider['kind'] = 'rock', occR = colR) => {
    props.push(p);
    if (colR > 0) colliders.push({ x: p.x, z: p.z, r: colR, kind });
    occupied.push({ x: p.x, z: p.z, r: occR });
  };
  const randomPoint = (minR: number, maxR: number) => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(minR, maxR);
    return { x: cx + Math.cos(a) * r * 1.2, z: cz + Math.sin(a) * r };
  };

  // ── Infield & outfield islands ───────────────────────────────────────────
  const islandCount = theme === 'neon' ? 3 : theme === 'storm' ? 9 : 11;
  for (let tries = 0, n = 0; tries < 900 && n < islandCount; tries++) {
    const big = n < 3;
    const r = big ? rng.range(45, 85) : rng.range(16, 38);
    const pt = randomPoint(0, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.75);
    if (!clear(pt.x, pt.z, r, 22)) continue;
    const variant = rng.int(0, 3);
    place({ kind: 'island', x: pt.x, z: pt.z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant }, r * 0.88, 'island', r);
    islands.push({ x: pt.x, z: pt.z, r });
    n++;
    // Dress the island.
    if (theme === 'tropical') {
      const palms = Math.round(r / 8) + rng.int(1, 3);
      for (let k = 0; k < palms; k++) {
        const a = rng.range(0, 6.28);
        const d = rng.range(0.2, 0.72) * r;
        props.push({ kind: 'palm', x: pt.x + Math.cos(a) * d, z: pt.z + Math.sin(a) * d, y: 0, rot: rng.range(0, 6.28), scale: rng.range(1.1, 1.7), size: 0, variant: rng.int(0, 2) });
      }
      if (big && rng.chance(0.7)) {
        const a = rng.range(0, 6.28);
        props.push({ kind: 'hut', x: pt.x + Math.cos(a) * r * 0.45, z: pt.z + Math.sin(a) * r * 0.45, y: 0, rot: a, scale: 1, size: 0, variant: rng.int(0, 2) });
      }
      if (n === 1) props.push({ kind: 'waterfall', x: pt.x, z: pt.z, y: 0, rot: rng.range(0, 6.28), scale: r / 60, size: r, variant: 0 });
    } else if (theme === 'storm') {
      const pines = Math.round(r / 10);
      for (let k = 0; k < pines; k++) {
        const a = rng.range(0, 6.28);
        const d = rng.range(0.15, 0.6) * r;
        props.push({ kind: 'pine', x: pt.x + Math.cos(a) * d, z: pt.z + Math.sin(a) * d, y: 0, rot: 0, scale: rng.range(0.8, 1.4), size: 0, variant: 0 });
      }
    } else if (theme === 'volcanic') {
      if (rng.chance(0.6)) props.push({ kind: 'vent', x: pt.x, z: pt.z, y: 0, rot: 0, scale: 1, size: r, variant: 0 });
    }
  }

  // ── Course-side features: docks, rocks, lighthouses, quays ─────────────────
  const sideFeatures = theme === 'neon' ? 16 : 12;
  for (let tries = 0, n = 0; tries < 1200 && n < sideFeatures; tries++) {
    const s = rng.range(0, track.length);
    track.sample(s, _p);
    const side = rng.chance(0.5) ? 1 : -1;
    const off = W * 0.5 + rng.range(16, 40);
    const x = _p.x - _p.tz * off * side;
    const z = _p.z + _p.tx * off * side;
    if (Math.hypot(x - track.px[0], z - track.pz[0]) < 120) continue; // keep start clear for the gate
    let kind: PropKind;
    let r: number;
    if (theme === 'tropical') {
      kind = rng.chance(0.4) ? 'dock' : 'rock';
      r = kind === 'dock' ? 9 : rng.range(3, 7);
    } else if (theme === 'storm') {
      kind = rng.chance(0.25) ? 'lighthouse' : rng.chance(0.3) ? 'wreck' : 'seastack';
      r = kind === 'lighthouse' ? 9 : kind === 'wreck' ? 10 : rng.range(5, 10);
    } else if (theme === 'neon') {
      kind = rng.chance(0.55) ? 'container' : rng.chance(0.5) ? 'crane' : 'quay';
      r = kind === 'quay' ? 14 : kind === 'crane' ? 8 : 7;
    } else {
      kind = rng.chance(0.6) ? 'lavarock' : 'rock';
      r = rng.range(4, 9);
    }
    if (!clear(x, z, r, 6)) continue;
    const rot = _p.heading + (kind === 'dock' || kind === 'quay' || kind === 'crane' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : rng.range(0, 6.28));
    const colKind = kind === 'dock' || kind === 'quay' || kind === 'crane' || kind === 'container' || kind === 'lighthouse' ? 'pile' : 'rock';
    place({ kind, x, z, y: 0, rot, scale: rng.range(0.85, 1.25), size: r, variant: rng.int(0, 3) }, kind === 'dock' ? 0 : r * 0.85, colKind, r);
    if (kind === 'dock') {
      // Piles along the dock's length instead of one big circle.
      const dx = Math.sin(rot);
      const dz = Math.cos(rot);
      for (let k = -1; k <= 1; k++) colliders.push({ x: x + dx * k * 6, z: z + dz * k * 6, r: 2.2, kind: 'pile' });
    }
    if (kind === 'quay') {
      const dx = Math.sin(rot + Math.PI / 2);
      const dz = Math.cos(rot + Math.PI / 2);
      for (let k = -2; k <= 2; k++) colliders.push({ x: x + dx * k * 7, z: z + dz * k * 7, r: 4, kind: 'pile' });
    }
    n++;
  }

  // ── Scattered rocks / stacks for silhouette and danger ───────────────────────
  const rockCount = theme === 'neon' ? 8 : 26;
  for (let tries = 0, n = 0; tries < 1500 && n < rockCount; tries++) {
    const pt = randomPoint(0, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.8);
    const r = rng.range(2, 6.5);
    if (!clear(pt.x, pt.z, r, 3)) continue;
    const kind: PropKind = theme === 'volcanic' ? (rng.chance(0.5) ? 'lavarock' : 'rock') : theme === 'storm' ? (rng.chance(0.4) ? 'seastack' : 'rock') : theme === 'neon' ? 'container' : 'rock';
    place({ kind, x: pt.x, z: pt.z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant: rng.int(0, 3) }, r * 0.8, kind === 'container' ? 'pile' : 'rock', r);
    n++;
  }

  // ── Shortcut corridors: lined with rocks so they read as channels ───────────
  for (const sc of track.shortcuts) {
    const P = sc.pts;
    const n = P.length / 2;
    for (let i = 4; i < n - 4; i += 4) {
      const ax = P[i * 2],
        az = P[i * 2 + 1];
      const bx = P[i * 2 + 2],
        bz = P[i * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / l;
      const nz = (bx - ax) / l;
      for (const side of [-1, 1]) {
        const off = sc.width * 0.5 + rng.range(3.5, 7);
        const x = ax + nx * off * side;
        const z = az + nz * off * side;
        if (track.distToCentre(x, z) < W * 0.5 + 6) continue;
        const r = rng.range(2.2, 4);
        const kind: PropKind = theme === 'neon' ? 'container' : theme === 'volcanic' ? 'lavarock' : 'rock';
        props.push({ kind, x, z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant: rng.int(0, 3) });
        colliders.push({ x, z, r: r * 0.85, kind: kind === 'container' ? 'pile' : 'rock' });
        occupied.push({ x, z, r });
      }
    }
  }

  // ── On-course hazards from the track generator ─────────────────────────────
  for (const h of track.hazards) {
    props.push({ kind: h.kind === 'mine' ? 'mine' : theme === 'volcanic' ? 'lavarock' : 'rock', x: h.x, z: h.z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: h.r, variant: rng.int(0, 3) });
    colliders.push({ x: h.x, z: h.z, r: h.r * (h.kind === 'mine' ? 1 : 0.85), kind: h.kind === 'mine' ? 'mine' : 'rock' });
  }

  // ── Set pieces: a bridge over a straight (neon / storm), volcano, lighthouse ──
  if (theme === 'neon' || theme === 'storm') {
    let bestS = -1;
    let bestK = Infinity;
    for (let s = 200; s < track.length - 200; s += 20) {
      let k = 0;
      for (let o = -40; o <= 40; o += 10) k = Math.max(k, Math.abs(track.curvAt(s + o)));
      const nearRamp = track.ramps.some((r) => Math.hypot(r.x - track.px[track.indexAt(s)], r.z - track.pz[track.indexAt(s)]) < 70);
      if (!nearRamp && k < bestK) {
        bestK = k;
        bestS = s;
      }
    }
    if (bestS > 0) {
      track.sample(bestS, _p);
      const span = W * 0.5 + 9;
      props.push({ kind: 'bridge', x: _p.x, z: _p.z, y: 0, rot: _p.heading, scale: 1, size: span, variant: theme === 'neon' ? 0 : 1 });
      for (const side of [-1, 1]) {
        colliders.push({ x: _p.x - _p.tz * span * side, z: _p.z + _p.tx * span * side, r: 3.2, kind: 'pile' });
      }
    }
  }
  if (theme === 'volcanic') {
    const a = rng.range(0, 6.28);
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 520;
    props.push({ kind: 'volcano', x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, y: 0, rot: 0, scale: 1, size: 260, variant: 0 });
  }
  if (theme === 'neon') {
    // Skyline towers on the far shore.
    const R0 = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 330;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 1.25 + 2.2 + rng.range(-0.02, 0.02);
      const R = R0 + rng.range(0, 200);
      props.push({ kind: 'tower', x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, y: 0, rot: a, scale: 1, size: rng.range(40, 160), variant: rng.int(0, 3) });
    }
  }

  // ── Buoys along both course edges ──────────────────────────────────────────
  const buoys: Buoy[] = [];
  const mouths: { x: number; z: number }[] = [];
  for (const sc of track.shortcuts) {
    mouths.push({ x: sc.pts[0], z: sc.pts[1] }, { x: sc.pts[sc.pts.length - 2], z: sc.pts[sc.pts.length - 1] });
  }
  const step = 19;
  for (let s = 0; s < track.length; s += step) {
    track.sample(s, _p);
    for (const side of [-1, 1]) {
      const lat = side * W * 0.5;
      const x = _p.x - _p.tz * lat;
      const z = _p.z + _p.tx * lat;
      if (mouths.some((m) => Math.hypot(m.x - x, m.z - z) < 30)) continue;
      if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2)) continue;
      buoys.push({ ax: x, az: z, x, z, vx: 0, vz: 0, side: side < 0 ? 0 : 1, wobble: 0 });
    }
  }
  for (const sc of track.shortcuts) {
    const P = sc.pts;
    for (let i = 2; i < P.length / 2 - 2; i += 3) {
      const ax = P[i * 2],
        az = P[i * 2 + 1];
      const bx = P[i * 2 + 2],
        bz = P[i * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      for (const side of [-1, 1]) {
        const x = ax + (-(bz - az) / l) * sc.width * 0.5 * side;
        const z = az + ((bx - ax) / l) * sc.width * 0.5 * side;
        buoys.push({ ax: x, az: z, x, z, vx: 0, vz: 0, side: 2, wobble: 0 });
      }
    }
  }

  // ── Chevron signs on the outside of corners ─────────────────────────────────
  const signs: Sign[] = [];
  let lastSign = -999;
  for (let s = 0; s < track.length; s += 10) {
    const k = track.curvAt(s);
    if (Math.abs(k) < 0.011 || s - lastSign < 70) continue;
    lastSign = s;
    track.sample(s, _p);
    const outside = k > 0 ? -1 : 1; // turning right → outside is left
    const lat = outside * (W * 0.5 + 7);
    const x = _p.x - _p.tz * lat;
    const z = _p.z + _p.tx * lat;
    if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) continue;
    // Face back down the course toward approaching racers.
    signs.push({ x, z, heading: _p.heading + Math.PI, dir: k > 0 ? 1 : -1 });
    colliders.push({ x, z, r: 1.4, kind: 'pile' });
  }

  // ── Stunt rings: over ramps, over swell zones, scattered on straights ───────
  const rings: StuntRing[] = [];
  for (const r of track.ramps) {
    const d = r.length + 16;
    rings.push({ x: r.x + Math.sin(r.heading) * d, y: 7.5, z: r.z + Math.cos(r.heading) * d, heading: r.heading, radius: 4.2, taken: false, respawn: 0 });
  }
  for (let i = 0; i < 8; i++) {
    const s = ((i + 0.5) / 8) * track.length;
    track.sample(s, _p);
    const lat = track.lineAt(s) + rng.range(-8, 8);
    rings.push({ x: _p.x - _p.tz * lat, y: 2.5, z: _p.z + _p.tx * lat, heading: _p.heading, radius: 3.8, taken: false, respawn: 0 });
  }

  return { theme, props, colliders, buoys, signs, rings, islands, extent };
}
