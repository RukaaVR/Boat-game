/**
 * Battle-arena LAYOUT: a circular lagoon instead of a course.
 *
 *   r <  180   open lagoon: ramps, pads, whirlpools (from the Track), floating
 *              platforms, a few rocks, a ring of colourful marker buoys
 *   r ≈ 222    a ring of palm islands with channels between them; a rock
 *              arch spans one channel, a lighthouse guards the north mouth
 *   r ≈ 262–305 an outer moat: sneak round behind the islands
 *   r ≈ 360    a continuous wall of tall islands closes the arena
 *
 * Same contract as `buildLayout`: every prop here is already cleared against
 * every other one, so the renderer never reasons about gameplay.
 */

import { Rng } from '../core/rng';
import type { Buoy, Collider, StuntRing } from '../core/types';
import type { Track } from '../race/track';
import type { Layout, Prop } from './layout';

/** Radius of the open lagoon (inside the island ring). */
export const LAGOON_R = 182;
const EDGE_R = 222;
const EDGE_N = 12;
const WALL_R = 362;
const WALL_N = 24;

export function buildArenaLayout(track: Track): Layout {
  const rng = new Rng(track.def.seed * 7 + 13);
  const props: Prop[] = [];
  const colliders: Collider[] = [];
  const islands: Layout['islands'] = [];
  const occupied: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => {
    for (const o of occupied) if (Math.hypot(x - o.x, z - o.z) < o.r + r + 4) return false;
    for (const rp of track.ramps) if (Math.hypot(x - rp.x, z - rp.z) < r + 24) return false;
    for (const p of track.pads) if (Math.hypot(x - p.x, z - p.z) < r + 12) return false;
    for (const w of track.whirlpools) if (Math.hypot(x - w.x, z - w.z) < w.r + r + 8) return false;
    for (const h of track.hazards) if (Math.hypot(x - h.x, z - h.z) < r + 8) return false;
    return true;
  };
  const island = (x: number, z: number, r: number, variant: number) => {
    props.push({ kind: 'island', x, z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant });
    colliders.push({ x, z, r: r * 0.88, kind: 'island' });
    islands.push({ x, z, r });
    occupied.push({ x, z, r });
  };
  const palms = (x: number, z: number, r: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, 6.28);
      const d = rng.range(0.15, 0.7) * r;
      props.push({ kind: 'palm', x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, y: 0, rot: rng.range(0, 6.28), scale: rng.range(1.1, 1.7), size: 0, variant: rng.int(0, 2) });
    }
  };

  // ── Ring of edge islands, channels between them ─────────────────────────
  const edgeA: number[] = [];
  for (let i = 0; i < EDGE_N; i++) {
    const a = ((i + 0.5) / EDGE_N) * Math.PI * 2 + rng.range(-0.04, 0.04);
    edgeA.push(a);
    const r = rng.range(33, 39);
    const R = EDGE_R + rng.range(-4, 4);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    island(x, z, r, i % 4 === 1 ? 2 : rng.int(0, 1));
    palms(x, z, r, 4 + rng.int(0, 3));
    if (i % 3 === 0) {
      const ha = a + Math.PI + rng.range(-0.5, 0.5);
      props.push({ kind: 'hut', x: x + Math.cos(ha) * r * 0.45, z: z + Math.sin(ha) * r * 0.45, y: 0, rot: ha, scale: 1, size: 0, variant: rng.int(0, 2) });
    }
  }
  // Docks poking into the lagoon from a few islands.
  for (const i of [2, 6, 10]) {
    const a = edgeA[i];
    const R = EDGE_R - 44;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const rot = a + Math.PI; // dock runs along local +Z → point it at the centre
    props.push({ kind: 'dock', x, z, y: 0, rot: Math.atan2(-Math.cos(a), -Math.sin(a)), scale: 1, size: 9, variant: 0 });
    for (let k = -1; k <= 1; k++) colliders.push({ x: x + Math.cos(rot) * k * 6, z: z + Math.sin(rot) * k * 6, r: 2.2, kind: 'pile' });
    occupied.push({ x, z, r: 10 });
  }

  // ── Landmarks ───────────────────────────────────────────────────────────
  // Rock arch spanning the channel between islands 8 and 9.
  {
    const a = (edgeA[8] + edgeA[9]) / 2;
    const x = Math.cos(a) * EDGE_R;
    const z = Math.sin(a) * EDGE_R;
    // Local X spans the arch; the channel runs radially, so X is tangential.
    props.push({ kind: 'arch', x, z, y: 0, rot: Math.PI / 2 - a, scale: 1, size: 40, variant: 0 });
  }
  // Lighthouse on its own rock at the mouth between islands 3 and 4.
  {
    const a = (edgeA[3] + edgeA[4]) / 2 + 0.13;
    const R = LAGOON_R + 6;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    props.push({ kind: 'lighthouse', x, z, y: 0, rot: 0, scale: 1.25, size: 9, variant: 0 });
    colliders.push({ x, z, r: 7, kind: 'pile' });
    occupied.push({ x, z, r: 9 });
  }

  // ── Outer wall: tall islands shoulder to shoulder ───────────────────────
  for (let i = 0; i < WALL_N; i++) {
    const a = (i / WALL_N) * Math.PI * 2 + rng.range(-0.02, 0.02);
    const r = rng.range(60, 66);
    const R = WALL_R + rng.range(-3, 6);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    island(x, z, r, i % 3 === 0 ? 2 : rng.int(0, 1));
    palms(x, z, r, 3 + rng.int(0, 3));
  }
  // Rocks in the moat for a bit of slalom.
  for (let tries = 0, n = 0; tries < 300 && n < 10; tries++) {
    const a = rng.range(0, 6.28);
    const R = rng.range(272, 296);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const r = rng.range(2.5, 4.5);
    if (!free(x, z, r)) continue;
    props.push({ kind: 'rock', x, z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant: rng.int(0, 3) });
    colliders.push({ x, z, r: r * 0.8, kind: 'rock' });
    occupied.push({ x, z, r });
    n++;
  }

  // ── Inside the lagoon ───────────────────────────────────────────────────
  // Floating platforms: cover to duck behind, between the ramps.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.52;
    const R = i % 2 ? 128 : 112;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    if (!free(x, z, 8)) continue;
    props.push({ kind: 'platform', x, z, y: 0, rot: -a, scale: 1, size: 7, variant: i % 3 });
    colliders.push({ x, z, r: 6.4, kind: 'pile' });
    occupied.push({ x, z, r: 8 });
  }
  // A few rocks.
  for (let tries = 0, n = 0; tries < 400 && n < 7; tries++) {
    const a = rng.range(0, 6.28);
    const R = rng.range(35, 165);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const r = rng.range(2.4, 4.2);
    if (!free(x, z, r + 6)) continue;
    props.push({ kind: 'rock', x, z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: r, variant: rng.int(0, 3) });
    colliders.push({ x, z, r: r * 0.8, kind: 'rock' });
    occupied.push({ x, z, r });
    n++;
  }
  // Drifting mines from the track generator.
  for (const h of track.hazards) {
    props.push({ kind: 'mine', x: h.x, z: h.z, y: 0, rot: rng.range(0, 6.28), scale: 1, size: h.r, variant: 0 });
    colliders.push({ x: h.x, z: h.z, r: h.r, kind: 'mine' });
  }

  // ── Colourful marker buoys round the lagoon, open at the channel mouths ──
  const buoys: Buoy[] = [];
  const BUOY_R = LAGOON_R - 4;
  const nB = 72;
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * Math.PI * 2;
    const x = Math.cos(a) * BUOY_R;
    const z = Math.sin(a) * BUOY_R;
    // Only in front of islands: channels stay open.
    let nearIsland = false;
    for (const ea of edgeA) {
      const d = Math.abs(Math.atan2(Math.sin(a - ea), Math.cos(a - ea)));
      if (d < 0.11) nearIsland = true;
    }
    if (!nearIsland) continue;
    if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2)) continue;
    buoys.push({ ax: x, az: z, x, z, vx: 0, vz: 0, side: i % 3, wobble: 0 });
  }

  // Stunt rings over the ramps (free ride).
  const rings: StuntRing[] = [];
  for (const r of track.ramps) {
    const d = r.length + 16;
    rings.push({ x: r.x + Math.sin(r.heading) * d, y: 7.5, z: r.z + Math.cos(r.heading) * d, heading: r.heading, radius: 4.2, taken: false, respawn: 0 });
  }

  const E = WALL_R + 420;
  return { theme: track.def.theme, props, colliders, buoys, signs: [], rings, bottles: [], islands, extent: { minX: -E, maxX: E, minZ: -E, maxZ: E } };
}
