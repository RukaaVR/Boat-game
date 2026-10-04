/**
 * Course-variant layouts: the normal course's dressing, transformed.
 *
 * MIRROR reflects every position across x = 0 (x → −x) and every facing
 * (rot → −rot, which mirrors a direction vector for rotation.y = rot). No mesh
 * is ever negatively scaled, so text on signs and decals still reads the right
 * way round — only the placement data is mirrored.
 *
 * REVERSE keeps every position; only direction-dependent things change:
 * buoy edge colours swap so left/right still match the driver's left/right,
 * chevron signs are re-placed for the new corner directions, ramp stunt rings
 * and the air bottle move past the new ramp lips.
 */

import type { Collider } from '../core/types';
import type { Track } from '../race/track';
import { VARIANTS } from '../race/variants';
import { placeSigns, type Layout } from './layout';

export function variantLayout(base: Layout, track: Track): Layout {
  const baseTrack = track.base!;
  const { mirror, reverse } = VARIANTS[track.variant];
  const mx = mirror ? -1 : 1;
  const rot = (r: number) => (mirror ? -r : r);
  const head = (h: number) => (mirror ? -h : h) + (reverse ? Math.PI : 0);
  // Edge colour coding is relative to the driving direction: one flip swaps it, two cancel.
  const swapSides = mirror !== reverse;

  // The base layout's sign posts are the last colliders; drop them and re-place
  // signs for this variant's corners.
  const baseCols = base.colliders.slice(0, base.colliders.length - base.signs.length);
  const colliders: Collider[] = baseCols.map((c) => ({ ...c, x: c.x * mx }));
  const props = base.props.map((p) => ({ ...p, x: p.x * mx, rot: rot(p.rot) }));
  const buoys = base.buoys.map((b) => ({ ...b, ax: b.ax * mx, x: b.x * mx, side: swapSides && b.side < 2 ? 1 - b.side : b.side }));
  const islands = base.islands.map((i) => ({ ...i, x: i.x * mx }));
  const e = base.extent;
  const extent = mirror ? { minX: -e.maxX, maxX: -e.minX, minZ: e.minZ, maxZ: e.maxZ } : { ...e };
  const signs = placeSigns(track, colliders);

  // Stunt rings: the first ones sit past each ramp lip (re-derived from the
  // transformed ramps); the rest float over straights.
  const nr = baseTrack.ramps.length;
  const rings = base.rings.map((r, i) => {
    if (i < nr && i < track.ramps.length) {
      const rp = track.ramps[i];
      const d = rp.length + 16;
      return { ...r, x: rp.x + Math.sin(rp.heading) * d, z: rp.z + Math.cos(rp.heading) * d, heading: rp.heading };
    }
    return { ...r, x: r.x * mx, heading: head(r.heading) };
  });

  // Bottles keep their index (the found-bitmask is shared by every variant).
  // The airborne one past a ramp is re-anchored to that ramp's new lip.
  const bottles = base.bottles.map((b) => {
    if (b.y < 3) return { ...b, x: b.x * mx };
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < baseTrack.ramps.length; i++) {
      const r = baseTrack.ramps[i];
      const d = r.length + 22;
      const ex = r.x + Math.sin(r.heading) * d + Math.cos(r.heading) * 3;
      const ez = r.z + Math.cos(r.heading) * d - Math.sin(r.heading) * 3;
      const dd = Math.hypot(ex - b.x, ez - b.z);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    if (best < 0 || bestD > 1) return { ...b, x: b.x * mx };
    const r = track.ramps[best];
    const d = r.length + 22;
    return { x: r.x + Math.sin(r.heading) * d + Math.cos(r.heading) * 3, y: b.y, z: r.z + Math.cos(r.heading) * d - Math.sin(r.heading) * 3 };
  });

  return { theme: base.theme, props, colliders, buoys, signs, rings, bottles, islands, extent };
}
