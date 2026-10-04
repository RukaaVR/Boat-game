/**
 * Procedural rider gear (see riderGear.ts for the catalogue): headwear and
 * goggles merged into the head mesh, collar / scarf / hood merged into the
 * torso, wristbands into the forearms, and outfit colours painted into the
 * torso's vertex colours. Nothing here adds a draw call; everything inherits
 * the rider's cel material and ink outline.
 *
 * Head-space coordinates: origin at the neck joint, +Y up, +Z forward (face),
 * `ctr` the head centre and `ext` its half-extents (from rider.ts).
 */

import { BufferAttribute, type BufferGeometry, Color, CylinderGeometry, SphereGeometry, Vector3 } from 'three';
import type { GeoBuilder } from '../render/geo';
import type { Livery } from './livery';
import { OUTFITS, type Headwear, type OutfitDef } from './riderGear';
import type { RiderLook } from './riderLook';

const INK = 0x1d2030;
const GOLD = 0xf2c230;
const LENS = 0x8fe6ff;

export function outfitOf(look: RiderLook): OutfitDef {
  return OUTFITS.find((o) => o.id === look.outfit) ?? OUTFITS[0];
}

/** Suit colours for a look on a livery (team kit = the boat's colours). */
export function wearColors(look: RiderLook, liv: Livery) {
  const o = outfitOf(look);
  return { main: o.main ?? liv.hull, trim: o.trim ?? liv.accent, trousers: o.trousers, sleeves: o.sleeves };
}

/**
 * Paint the outfit pattern into the torso's vertex colours. `g` is the built
 * (non-indexed) torso in pelvis-relative space before the forward lean.
 */
export function paintTorso(g: BufferGeometry, look: RiderLook, liv: Livery) {
  const o = outfitOf(look);
  if (o.pattern === 'none') return;
  const { main, trim } = wearColors(look, liv);
  const cm = new Color(main);
  const ct = new Color(trim);
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color') as BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    let t = false;
    if (o.pattern === 'panels') t = Math.abs(x) > 0.165 || y > 0.45;
    else if (o.pattern === 'jacket') t = y < 0.05;
    else if (o.pattern === 'hem') t = y < 0.08;
    else if (o.pattern === 'sash') t = Math.abs(x * 0.9 + y - 0.24) < 0.065;
    const c = t ? ct : cm;
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

/** Collar / hood / zip and the scarf, in pelvis-relative torso space. `neck` = neck joint. */
export function addTorsoWear(gb: GeoBuilder, look: RiderLook, liv: Livery, neck: Vector3) {
  const o = outfitOf(look);
  const { main, trim } = wearColors(look, liv);
  if (o.pattern === 'jacket') {
    // Stand-up collar (open ring) and a dark zip down the chest.
    gb.add(new CylinderGeometry(0.135, 0.15, 0.07, 14, 1, true), trim, { x: neck.x, y: neck.y - 0.03, z: neck.z + 0.005, sz: 0.92 });
    gb.box(0.022, 0.4, 0.02, INK, { y: 0.27, z: 0.148, rx: 0.06 });
  } else if (o.pattern === 'hem') {
    // Rolled hood lying behind the neck, and toggle buttons.
    gb.torus(0.13, 0.055, main, { x: neck.x, y: neck.y - 0.05, z: neck.z - 0.07, rx: Math.PI / 2 + 0.5, sx: 1.05 });
    for (const y of [0.34, 0.24, 0.14]) gb.box(0.05, 0.02, 0.02, trim, { y, z: 0.15 });
  } else if (o.pattern === 'panels') {
    gb.add(new CylinderGeometry(0.125, 0.14, 0.05, 14, 1, true), trim, { x: neck.x, y: neck.y - 0.035, z: neck.z, sz: 0.92 });
  }
  if (look.accessory === 'scarf') {
    const red = '#e4343f';
    gb.torus(0.13, 0.05, red, { x: neck.x, y: neck.y - 0.05, z: neck.z + 0.005, rx: Math.PI / 2 + 0.08, sz: 0.9 }, Math.PI * 2);
    gb.torus(0.12, 0.04, new Color(red).multiplyScalar(0.82), { x: neck.x, y: neck.y - 0.1, z: neck.z, rx: Math.PI / 2 - 0.1, sz: 0.92 }, Math.PI * 2);
    // Knot and two tails streaming off the back of the shoulder.
    gb.sphere(0.05, red, { x: neck.x + 0.07, y: neck.y - 0.08, z: neck.z - 0.13 }, 8, 6);
    gb.box(0.09, 0.3, 0.025, red, { x: neck.x + 0.09, y: neck.y - 0.2, z: neck.z - 0.2, rx: -0.55, rz: 0.15 });
    gb.box(0.08, 0.24, 0.025, new Color(red).multiplyScalar(0.82), { x: neck.x + 0.02, y: neck.y - 0.18, z: neck.z - 0.19, rx: -0.4, rz: -0.12 });
  }
}

/** Sweatband round the wrist, in forearm space (origin elbow, +Z along the arm). */
export function addWristband(gb: GeoBuilder, look: RiderLook, liv: Livery, wristZ: number, centreY: number) {
  if (look.accessory !== 'bands') return;
  gb.cyl(0.07, 0.07, 0.075, liv.accent, { y: centreY, z: wristZ, rx: Math.PI / 2 }, 10);
  gb.cyl(0.072, 0.072, 0.018, 0xffffff, { y: centreY, z: wristZ, rx: Math.PI / 2 }, 10);
}

/** Upper hemisphere (or a cap of it) as a geometry, for domes. */
function dome(seg = 14, rings = 6, theta = Math.PI / 2) {
  return new SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, theta);
}
/** Half-disc pointing +Z (cap peaks). */
function peak(r: number, thick: number) {
  return new CylinderGeometry(r, r, thick, 12, 1, false, -Math.PI / 2, Math.PI);
}

/** Helmet shell: a sphere with the face opening and the neck cut away. */
function helmetShell() {
  const g = new SphereGeometry(1, 16, 12).toNonIndexed();
  const p = g.getAttribute('position');
  const keep: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (y < -0.45) continue;
    if (z > 0.42 && y < 0.42) continue;
    if (y < 0.05 && z > 0.05) continue;
    for (let k = 0; k < 3; k++) keep.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(keep), 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Headwear (and goggles) in head space. Rendered with the head's material. */
export function addHeadwear(gb: GeoBuilder, look: RiderLook, liv: Livery, ctr: Vector3, ext: Vector3) {
  const hw = look.headwear;
  const main = liv.hull;
  const acc = liv.accent;
  if (hw === 'cap') {
    // Six-panel cap: dome over the crown, accent button and front patch, dark peak.
    const cy = ctr.y + 0.05;
    gb.add(dome(), main, { x: ctr.x, y: cy, z: ctr.z - 0.01, sx: ext.x * 1.24, sy: ext.y * 1.2, sz: ext.z * 1.32, rx: -0.12 });
    gb.sphere(0.03, acc, { y: cy + ext.y * 1.2 - 0.005, z: ctr.z - 0.04 }, 8, 6);
    gb.box(0.13, 0.08, 0.02, acc, { y: cy + 0.11, z: ctr.z + ext.z * 1.22, rx: -0.55 });
    gb.add(peak(ext.x * 1.12, 0.022), INK, { y: cy + 0.015, z: ctr.z + 0.02, sz: 1.55, rx: 0.16 });
  } else if (hw === 'captain') {
    // Skipper's hat: black band, white flared crown, glossy peak, gold cord and badge.
    const by = ctr.y + 0.06;
    const rx = ext.x * 1.2;
    gb.add(new CylinderGeometry(rx, rx * 0.98, 0.1, 16, 1, true), INK, { y: by + 0.02, z: ctr.z - 0.01, sz: 0.88 });
    gb.add(new CylinderGeometry(rx * 1.22, rx * 1.02, 0.12, 16, 1, false), 0xf6f6f2, { y: by + 0.13, z: ctr.z - 0.02, sz: 0.9, rx: -0.12 });
    gb.add(dome(14, 3, 0.5), 0xf6f6f2, { y: by + 0.185, z: ctr.z - 0.03, sx: rx * 1.22, sy: 0.06, sz: rx * 1.1, rx: -0.12 });
    gb.add(peak(rx * 0.86, 0.02), 0x111318, { y: by + 0.005, z: ctr.z + 0.05, sz: 1.15, rx: 0.14 });
    gb.cyl(0.006, 0.006, rx * 1.3, GOLD, { y: by + 0.02, z: ctr.z + ext.z * 1.06, rz: Math.PI / 2 }, 5);
    gb.cyl(0.045, 0.045, 0.02, GOLD, { y: by + 0.1, z: ctr.z + ext.z * 1.18, rx: Math.PI / 2 - 0.15 }, 10);
    gb.box(0.012, 0.06, 0.012, INK, { y: by + 0.1, z: ctr.z + ext.z * 1.18 + 0.012, rx: -0.15 });
    gb.box(0.04, 0.01, 0.012, INK, { y: by + 0.085, z: ctr.z + ext.z * 1.18 + 0.012, rx: -0.15 });
  } else if (hw === 'bandana') {
    // Headband over the brow; the spiky hair bursts out above it.
    const by = ctr.y + 0.085;
    gb.add(new CylinderGeometry(ext.x * 1.17, ext.x * 1.2, 0.075, 18, 1, true), main, { y: by, z: ctr.z, sz: (ext.z / ext.x) * 1.12 });
    gb.box(0.12, 0.05, 0.015, acc, { y: by, z: ctr.z + ext.z * 1.2 + 0.006 });
    gb.sphere(0.04, main, { y: by, z: ctr.z - ext.z * 1.2 }, 8, 6);
    gb.box(0.06, 0.2, 0.015, main, { x: 0.035, y: by - 0.09, z: ctr.z - ext.z * 1.3, rx: -0.5, rz: 0.25 });
    gb.box(0.055, 0.17, 0.015, new Color(main).multiplyScalar(0.8), { x: -0.03, y: by - 0.08, z: ctr.z - ext.z * 1.28, rx: -0.35, rz: -0.3 });
  } else if (hw === 'phones') {
    // Over-ear headphones: a padded band arched over the hair, chunky cups.
    gb.torus(ext.x * 1.2, 0.028, INK, { y: ctr.y + 0.01, z: ctr.z - 0.02, sy: 1.22 }, Math.PI);
    gb.box(0.1, 0.03, 0.065, acc, { y: ctr.y + 0.01 + ext.x * 1.2 * 1.22, z: ctr.z - 0.02 });
    for (const s of [-1, 1]) {
      const x = s * (ext.x + 0.035);
      gb.cyl(0.1, 0.1, 0.07, main, { x, y: ctr.y - 0.01, z: ctr.z + 0.01, rz: Math.PI / 2 }, 14);
      gb.cyl(0.07, 0.07, 0.02, acc, { x: x + s * 0.04, y: ctr.y - 0.01, z: ctr.z + 0.01, rz: Math.PI / 2 }, 12);
      gb.cyl(0.085, 0.085, 0.03, 0x3a3e4a, { x: x - s * 0.04, y: ctr.y - 0.01, z: ctr.z + 0.01, rz: Math.PI / 2 }, 12);
    }
  } else if (hw === 'helmet') {
    // Open-face race helmet: shell, accent centre stripe and fin, flip-up visor.
    const hc = new Vector3(ctr.x, ctr.y + 0.04, ctr.z - 0.01);
    const sx = ext.x * 1.24;
    const sy = ext.y * 1.28;
    const sz = ext.z * 1.32;
    gb.add(helmetShell(), main, { x: hc.x, y: hc.y, z: hc.z, sx, sy, sz });
    gb.add(dome(4, 8, Math.PI * 0.62), acc, { x: hc.x, y: hc.y + 0.004, z: hc.z, sx: 0.07, sy: sy * 1.01, sz: sz * 1.01, rx: -0.35 });
    gb.add(new CylinderGeometry(0.004, 0.02, 0.26, 4, 1), acc, { y: hc.y + sy - 0.005, z: hc.z - 0.07, rx: Math.PI / 2 + 0.25, sx: 1, sz: 3.5 });
    // Visor flipped up over the brow: a curved strip of the shell's front.
    gb.add(new CylinderGeometry(sx * 0.9, sx * 0.97, 0.085, 14, 1, false, -0.95, 1.9), 0x2b4f86, { y: hc.y + 0.13, z: hc.z, sz: sz / sx });
    for (const s of [-1, 1]) gb.cyl(0.03, 0.03, 0.02, INK, { x: s * sx * 1.02, y: hc.y + 0.06, z: hc.z + 0.02, rz: Math.PI / 2 }, 8);
  }
  if (look.accessory === 'goggles' && hw === 'captain') {
    // No room under a skipper's hat: the goggles hang round the neck.
    gb.add(new CylinderGeometry(0.15, 0.15, 0.03, 16, 1, true), INK, { y: 0.0, z: -0.0, rx: 0.35 });
    for (const s of [-1, 1]) {
      gb.cyl(0.055, 0.055, 0.045, acc, { x: s * 0.075, y: -0.05, z: 0.15, rx: Math.PI / 2 + 0.5 }, 12);
      gb.cyl(0.044, 0.044, 0.02, LENS, { x: s * 0.075, y: -0.06, z: 0.17, rx: Math.PI / 2 + 0.5 }, 12);
    }
  } else if (look.accessory === 'goggles') {
    // Pushed up on the forehead, sitting on whatever is on the head.
    const big = hw === 'helmet' || hw === 'cap' || hw === 'captain';
    const k = big ? 1.4 : hw === 'bandana' ? 1.26 : 1.2;
    const gy = ctr.y + (big ? 0.14 : 0.15);
    const fz = ctr.z + ext.z * k;
    gb.add(new CylinderGeometry(ext.x * k * 0.98, ext.x * k * 0.98, 0.035, 18, 1, true), INK, { y: gy, z: ctr.z, sz: ext.z / ext.x });
    for (const s of [-1, 1]) {
      gb.cyl(0.062, 0.062, 0.05, acc, { x: s * 0.085, y: gy + 0.01, z: fz - 0.005, rx: Math.PI / 2 - 0.35, ry: s * 0.25 }, 12);
      gb.cyl(0.05, 0.05, 0.02, LENS, { x: s * 0.09, y: gy + 0.019, z: fz + 0.018, rx: Math.PI / 2 - 0.35, ry: s * 0.25 }, 12);
    }
    gb.box(0.05, 0.025, 0.03, INK, { y: gy + 0.01, z: fz + 0.012 });
  }
}

/**
 * Which hair locks survive under the headwear. `u` = lock root in normalised
 * head coordinates (unit ellipsoid), `dir` = its growth direction.
 */
export function hairFilter(hw: Headwear): ((u: Vector3, dir: Vector3) => boolean) | null {
  if (hw === 'cap' || hw === 'captain') return (u, d) => u.y < 0.25 || (d.y < -0.3 && u.y < 0.85 && u.z > 0.2);
  if (hw === 'helmet') return (u, d) => d.y < -0.3 && u.z > 0.45 && u.y > 0.2;
  if (hw === 'phones') return (u) => !(Math.abs(u.x) > 0.72 && u.y < 0.62 && u.y > -0.35 && u.z < 0.42);
  return null;
}

/** Whether the puffed hair volume under the locks is hidden (helmet only). */
export const hideHairVolume = (hw: Headwear) => hw === 'helmet';
/** Hair spring sway allowed under the headwear (hats keep the hair still). */
export const hairSwayOf = (hw: Headwear) => (hw === 'helmet' ? 0 : hw === 'cap' || hw === 'captain' ? 0.25 : hw === 'phones' ? 0.6 : 1);
