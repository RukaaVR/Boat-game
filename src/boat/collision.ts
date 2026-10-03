/**
 * Collision resolution in the XZ plane.
 *
 * Hulls are two-circle capsules (bow + stern) so a side swipe and a nose-in hit
 * behave differently. Statics are circles in a uniform spatial hash. Every
 * response is a positional separation plus an impulse capped in magnitude, so
 * nothing can be launched to infinity — "no physics explosions" is enforced by
 * construction, not by tuning.
 */

import { clamp, clamp01 } from '../core/mathx';
import type { EventQueue } from '../core/events';
import type { Buoy, Collider } from '../core/types';
import type { Boat } from './boat';

const CELL = 32;

export class StaticWorld {
  private cells = new Map<number, Collider[]>();
  readonly all: Collider[] = [];

  private key(cx: number, cz: number) {
    return ((cx + 4096) << 13) | (cz + 4096);
  }

  add(c: Collider) {
    this.all.push(c);
    const x0 = Math.floor((c.x - c.r) / CELL);
    const x1 = Math.floor((c.x + c.r) / CELL);
    const z0 = Math.floor((c.z - c.r) / CELL);
    const z1 = Math.floor((c.z + c.r) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
  }

  /** Visit colliders whose cells overlap the circle. May visit one twice; callers are idempotent. */
  query(x: number, z: number, r: number, visit: (c: Collider) => void) {
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (list) for (let i = 0; i < list.length; i++) visit(list[i]);
      }
  }

  /** True if a circle overlaps any static collider. */
  blocked(x: number, z: number, r: number) {
    let hit = false;
    this.query(x, z, r, (c) => {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r) hit = true;
    });
    return hit;
  }
}

/** Hull capsule circle centres for a boat (bow at +0.27L, stern at −0.27L). */
function capsule(b: Boat, which: number) {
  const off = (which === 0 ? 0.27 : -0.27) * b.spec.length;
  _cx = b.position.x + Math.sin(b.heading) * off;
  _cz = b.position.z + Math.cos(b.heading) * off;
}
let _cx = 0;
let _cz = 0;
const hullR = (b: Boat) => b.spec.beam * 0.62;

export interface CollisionHost {
  events: EventQueue;
  boats: readonly Boat[];
  statics: StaticWorld;
  buoys: Buoy[];
  /** Index of the boat in `boats` → racer id for events. */
  ids: readonly number[];
}

let _hitStrength = 0;
let _hitX = 0;
let _hitZ = 0;
let _hitKind = '';

export function resolveCollisions(host: CollisionHost, dt: number) {
  const { boats, events, statics, ids } = host;

  // ── Boat vs boat ─────────────────────────────────────────────────────────
  for (let i = 0; i < boats.length; i++) {
    const a = boats[i];
    for (let j = i + 1; j < boats.length; j++) {
      const b = boats[j];
      if (a.ghostTime > 0 || b.ghostTime > 0) continue;
      const dxc = a.position.x - b.position.x;
      const dzc = a.position.z - b.position.z;
      const reach = (a.spec.length + b.spec.length) * 0.5 + 1;
      if (dxc * dxc + dzc * dzc > reach * reach) continue;
      // Vertical separation (one airborne over the other) — let them pass.
      if (Math.abs(a.position.y - b.position.y) > 1.6) continue;
      let worst = 0;
      let nx = 0;
      let nz = 0;
      for (let ca = 0; ca < 2; ca++) {
        capsule(a, ca);
        const ax = _cx;
        const az = _cz;
        for (let cb = 0; cb < 2; cb++) {
          capsule(b, cb);
          const dx = ax - _cx;
          const dz = az - _cz;
          const d = Math.hypot(dx, dz);
          const pen = hullR(a) + hullR(b) - d;
          if (pen > worst) {
            worst = pen;
            nx = d > 1e-4 ? dx / d : 1;
            nz = d > 1e-4 ? dz / d : 0;
          }
        }
      }
      if (worst <= 0) continue;
      const ma = a.spec.mass;
      const mb = b.spec.mass;
      const inv = 1 / (ma + mb);
      // Positional separation weighted by mass.
      a.position.x += nx * worst * mb * inv;
      a.position.z += nz * worst * mb * inv;
      b.position.x -= nx * worst * ma * inv;
      b.position.z -= nz * worst * ma * inv;
      const rvx = a.velocity.x - b.velocity.x;
      const rvz = a.velocity.z - b.velocity.z;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const jImp = clamp((-(1 + 0.35) * vn) / (1 / ma + 1 / mb), 0, 40);
        a.velocity.x += (nx * jImp) / ma;
        a.velocity.z += (nz * jImp) / ma;
        b.velocity.x -= (nx * jImp) / mb;
        b.velocity.z -= (nz * jImp) / mb;
        // Glancing blows twist the hulls.
        const tx = -nz;
        const tz = nx;
        const vt = rvx * tx + rvz * tz;
        a.yawRate += clamp(vt * 0.04, -1.2, 1.2) / ma;
        b.yawRate -= clamp(vt * 0.04, -1.2, 1.2) / mb;
        const s = clamp01(-vn / 14);
        a.impact = Math.max(a.impact, s);
        b.impact = Math.max(b.impact, s);
        a.rollRate += nz * s * 2;
        b.rollRate -= nz * s * 2;
        if (s > 0.08 && (a.hitCooldown <= 0 || b.hitCooldown <= 0)) {
          a.hitCooldown = b.hitCooldown = 0.25;
          events.push('collide', ids[i], (a.position.x + b.position.x) / 2, a.position.y, (a.position.z + b.position.z) / 2, s, String(ids[j]));
        }
      }
    }
  }

  // ── Boat vs statics ──────────────────────────────────────────────────────
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i];
    _hitStrength = 0;
    for (let c = 0; c < 2; c++) {
      capsule(b, c);
      const px = _cx;
      const pz = _cz;
      const r = hullR(b);
      statics.query(px, pz, r, (col) => {
        // Airborne boats clear low rocks and mines.
        if (b.airborne && b.clearance > 1.5 && col.kind !== 'island' && col.kind !== 'hull') return;
        const dx = px - col.x;
        const dz = pz - col.z;
        const d = Math.hypot(dx, dz);
        const pen = col.r + r - d;
        if (pen <= 0) return;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        b.position.x += nx * pen;
        b.position.z += nz * pen;
        const vn = b.velocity.x * nx + b.velocity.z * nz;
        if (vn < 0) {
          const restitution = col.kind === 'mine' ? 1.2 : 0.4;
          b.velocity.x -= nx * vn * (1 + restitution);
          b.velocity.z -= nz * vn * (1 + restitution);
          // Scrub tangential speed, and turn the nose away from the wall.
          const fric = col.kind === 'island' ? 0.86 : 0.8;
          b.velocity.x *= fric;
          b.velocity.z *= fric;
          const fx = Math.sin(b.heading);
          const fz = Math.cos(b.heading);
          const side = fx * -nz + fz * nx;
          b.yawRate += clamp(side * -vn * 0.08, -2, 2);
          const s = clamp01(-vn / 16) + (col.kind === 'mine' ? 0.6 : 0);
          if (s > _hitStrength) {
            _hitStrength = s;
            _hitX = col.x + nx * col.r;
            _hitZ = col.z + nz * col.r;
            _hitKind = col.kind;
          }
          if (col.kind === 'mine') {
            b.velocity.y += 7;
            b.pitchRate += 2.5;
          }
        }
      });
    }
    if (_hitStrength > 0.06) {
      b.impact = Math.max(b.impact, clamp01(_hitStrength));
      b.rollRate += (((b.position.x * 12.9898 + b.position.z * 78.233) % 1) - 0.5) * _hitStrength * 3;
      if (b.hitCooldown <= 0) {
        b.hitCooldown = 0.3;
        events.push('collide', ids[i], _hitX, b.position.y, _hitZ, clamp01(_hitStrength), _hitKind);
      }
      if (b.drifting && _hitStrength > 0.3) {
        b.drifting = false;
        b.driftCharge = 0;
        b.driftTier = 0;
      }
    }
  }

  // ── Buoys: light floating bodies pushed aside, springing back to anchor ───
  const buoys = host.buoys;
  for (let k = 0; k < buoys.length; k++) {
    const by = buoys[k];
    // Spring + damping back to the anchor.
    by.vx += ((by.ax - by.x) * 3 - by.vx * 1.8) * dt;
    by.vz += ((by.az - by.z) * 3 - by.vz * 1.8) * dt;
    by.x += by.vx * dt;
    by.z += by.vz * dt;
    by.wobble = Math.max(0, by.wobble - dt * 1.5);
  }
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i];
    if (b.airborne && b.clearance > 1.2) continue;
    const bx = b.position.x;
    const bz = b.position.z;
    const R = b.spec.length * 0.5 + 0.8;
    for (let k = 0; k < buoys.length; k++) {
      const by = buoys[k];
      const dx = by.x - bx;
      const dz = by.z - bz;
      if (dx * dx + dz * dz > R * R) continue;
      for (let c = 0; c < 2; c++) {
        capsule(b, c);
        const ddx = by.x - _cx;
        const ddz = by.z - _cz;
        const d = Math.hypot(ddx, ddz);
        const pen = hullR(b) + 0.55 - d;
        if (pen <= 0) continue;
        const nx = d > 1e-4 ? ddx / d : 1;
        const nz = d > 1e-4 ? ddz / d : 0;
        by.x += nx * pen;
        by.z += nz * pen;
        const vn = (b.velocity.x - by.vx) * nx + (b.velocity.z - by.vz) * nz;
        if (vn > 0) {
          by.vx += nx * vn * 1.4;
          by.vz += nz * vn * 1.4;
          // A buoy is light: the boat only loses a little.
          b.velocity.x *= 0.985;
          b.velocity.z *= 0.985;
          if (by.wobble < 0.5 && vn > 4) {
            by.wobble = 1;
            events.push('buoyHit', host.ids[i], by.x, b.surfaceY, by.z, clamp01(vn / 25));
          }
        }
      }
    }
  }
}
