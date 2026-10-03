/**
 * Fishing-boat traffic: slow trawlers that motor back and forth across the
 * course on fixed lanes. They are real obstacles — boats bounce off them and
 * take hull damage — but they move predictably, so a racer who watches can
 * thread past. Simulation only; the renderer draws them from this state.
 */

import type { EventQueue } from '../core/events';
import { Rng } from '../core/rng';
import type { Racer } from './racer';
import type { Track, TrackPoint } from './track';
import type { StaticWorld } from '../boat/collision';

export interface Trawler {
  /** Lane end points. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 0..1 along the lane, direction ±1. */
  u: number;
  dir: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
  /** Pause at each lane end (s). */
  wait: number;
  r: number;
}

const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

export class Traffic {
  readonly boats: Trawler[] = [];

  constructor(
    private track: Track,
    statics: StaticWorld,
    private events: EventQueue,
    seed: number,
    count = 2,
  ) {
    const rng = new Rng(seed);
    for (let tries = 0; this.boats.length < count && tries < 40; tries++) {
      // Cross the course somewhere on a straight-ish section away from the start.
      const s = track.length * rng.range(0.2, 0.9);
      if (Math.abs(track.curvAt(s)) > 0.006) continue;
      track.sample(s, _tp);
      const half = track.width * 0.5 + 26;
      const ang = rng.range(-0.5, 0.5);
      const nx = -_tp.tz * Math.cos(ang) + _tp.tx * Math.sin(ang);
      const nz = _tp.tx * Math.cos(ang) + _tp.tz * Math.sin(ang);
      const ax = _tp.x + nx * half;
      const az = _tp.z + nz * half;
      const bx = _tp.x - nx * half;
      const bz = _tp.z - nz * half;
      // Lane must be clear of rocks and islands along its length.
      let ok = true;
      for (let k = 0; k <= 10 && ok; k++) if (statics.blocked(ax + (bx - ax) * (k / 10), az + (bz - az) * (k / 10), 5)) ok = false;
      if (!ok || this.boats.some((o) => Math.hypot(o.ax - ax, o.az - az) < 150)) continue;
      this.boats.push({ ax, az, bx, bz, u: rng.next(), dir: rng.chance(0.5) ? 1 : -1, speed: rng.range(3.2, 4.6), x: ax, z: az, heading: 0, wait: 0, r: 3.6 });
    }
    void this.track;
  }

  update(dt: number, racers: readonly Racer[]) {
    for (const t of this.boats) {
      const len = Math.hypot(t.bx - t.ax, t.bz - t.az) || 1;
      if (t.wait > 0) t.wait -= dt;
      else {
        t.u += (t.dir * t.speed * dt) / len;
        if (t.u >= 1 || t.u <= 0) {
          t.u = Math.min(1, Math.max(0, t.u));
          t.dir *= -1;
          t.wait = 2.5;
        }
      }
      t.x = t.ax + (t.bx - t.ax) * t.u;
      t.z = t.az + (t.bz - t.az) * t.u;
      const want = Math.atan2((t.bx - t.ax) * t.dir, (t.bz - t.az) * t.dir);
      let dh = want - t.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      t.heading += dh * Math.min(1, dt * 0.8);

      // Collisions: push racers out of the hull circle, bounce, scuff.
      for (const r of racers) {
        const b = r.boat;
        if (b.airborne && b.clearance > 2.2) continue;
        const dx = b.position.x - t.x;
        const dz = b.position.z - t.z;
        const d = Math.hypot(dx, dz);
        const min = t.r + b.spec.beam * 0.6;
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        b.position.x += nx * (min - d);
        b.position.z += nz * (min - d);
        const vn = b.velocity.x * nx + b.velocity.z * nz;
        if (vn < 0) {
          b.velocity.x -= nx * vn * 1.6;
          b.velocity.z -= nz * vn * 1.6;
          b.velocity.x *= 0.75;
          b.velocity.z *= 0.75;
          const strength = Math.min(1, -vn / 22);
          b.impact = Math.max(b.impact, strength);
          if (b.hitCooldown <= 0) {
            b.hitCooldown = 0.4;
            this.events.push('collide', r.id, b.position.x - nx * b.spec.beam * 0.5, b.position.y, b.position.z - nz * b.spec.beam * 0.5, strength, 'hull');
          }
        }
      }
    }
  }
}
