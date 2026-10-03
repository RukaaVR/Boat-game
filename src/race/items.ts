/**
 * BATTLE ITEMS — item boxes, projectiles and hazards for Battle mode.
 *
 * Rows of item boxes float across the course. Driving through one gives a
 * random item (weighted by race position: the back of the pack gets the
 * strong stuff). Every racer, AI included, fires items through the same
 * `Controls.item` button; AI decides when in `aiDecide`, from what it can see.
 *
 *   TORPEDO  fired forward at 55 m/s, homes gently on the boat ahead
 *   OIL      slick dropped behind; boats crossing it spin out
 *   SHIELD   bubble for 8 s that absorbs one hit (torpedo, oil, mine)
 *   WAVE     wave-maker: shoves every boat within 22 m up and away
 *   TURBO    instant long mini-turbo
 */

import type { EventQueue } from '../core/events';
import { Rng } from '../core/rng';
import type { Racer } from './racer';
import type { Track, TrackPoint } from './track';
import type { StaticWorld } from '../boat/collision';

export type ItemId = 'torpedo' | 'oil' | 'shield' | 'wave' | 'turbo';
export const ITEM_IDS: ItemId[] = ['torpedo', 'oil', 'shield', 'wave', 'turbo'];
export const ITEM_LABEL: Record<ItemId, string> = { torpedo: 'TORPEDO', oil: 'OIL SLICK', shield: 'SHIELD', wave: 'WAVE MAKER', turbo: 'TURBO' };

export interface ItemBox {
  x: number;
  z: number;
  /** Seconds until it reappears (0 = available). */
  respawn: number;
}
export interface Torpedo {
  x: number;
  z: number;
  vx: number;
  vz: number;
  owner: number;
  t: number;
  alive: boolean;
}
export interface Slick {
  x: number;
  z: number;
  r: number;
  owner: number;
  t: number;
  alive: boolean;
}

const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
const TORPEDO_SPEED = 55;
const SLICK_LIFE = 16;

export class BattleItems {
  readonly boxes: ItemBox[] = [];
  readonly torpedoes: Torpedo[] = [];
  readonly slicks: Slick[] = [];
  /** Wave-maker blasts for the renderer: x, z, age. */
  readonly blasts: { x: number; z: number; t: number }[] = [];
  private rng: Rng;
  private prevItem = new Map<number, boolean>();
  private aiHold = new Map<number, number>();

  constructor(
    track: Track,
    private statics: StaticWorld,
    private events: EventQueue,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    // Four rows of boxes per lap, staggered across the course.
    const L = track.length;
    for (let k = 0; k < 4; k++) {
      const s = L * ((k + 0.3) / 4);
      track.sample(s, _tp);
      const w = track.width * 0.7;
      for (let j = 0; j < 6; j++) {
        const lat = -w / 2 + (w * j) / 5 + track.lineAt(s) * 0.3;
        const x = _tp.x - _tp.tz * lat;
        const z = _tp.z + _tp.tx * lat;
        if (!statics.blocked(x, z, 2)) this.boxes.push({ x, z, respawn: 0 });
      }
    }
    for (let i = 0; i < 16; i++) this.torpedoes.push({ x: 0, z: 0, vx: 0, vz: 0, owner: -1, t: 0, alive: false });
    for (let i = 0; i < 16; i++) this.slicks.push({ x: 0, z: 0, r: 4.2, owner: -1, t: 0, alive: false });
  }

  /** Item roll weighted by place: leaders get defence, the back gets weapons. */
  private roll(place: number, n: number): ItemId {
    const back = (place - 1) / Math.max(1, n - 1);
    const w: Record<ItemId, number> = {
      torpedo: 0.8 + back * 1.4,
      oil: 1.2 - back * 0.6,
      shield: 1.1 - back * 0.5,
      wave: 0.5 + back * 0.6,
      turbo: 0.4 + back * 1.6,
    };
    let sum = 0;
    for (const k of ITEM_IDS) sum += w[k];
    let r = this.rng.next() * sum;
    for (const k of ITEM_IDS) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'turbo';
  }

  update(dt: number, racers: readonly Racer[], racing: boolean) {
    // ── Boxes ────────────────────────────────────────────────────────────
    for (const box of this.boxes) {
      if (box.respawn > 0) {
        box.respawn = Math.max(0, box.respawn - dt);
        continue;
      }
      for (const r of racers) {
        const b = r.boat;
        if (r.item || b.airborne && b.clearance > 2) continue;
        if ((b.position.x - box.x) ** 2 + (b.position.z - box.z) ** 2 < 3.3 * 3.3) {
          box.respawn = 3;
          r.item = this.roll(r.place, racers.length);
          this.aiHold.set(r.id, this.rng.range(0.6, 2.5));
          this.events.push('itemPickup', r.id, box.x, b.position.y, box.z, 0, r.item);
          break;
        }
      }
    }

    // ── Use ──────────────────────────────────────────────────────────────
    for (const r of racers) {
      const pressed = r.controls.item && !this.prevItem.get(r.id);
      this.prevItem.set(r.id, r.controls.item);
      if (pressed && r.item && racing && r.boat.wipeout <= 0) this.use(r, racers);
    }

    // ── Torpedoes ────────────────────────────────────────────────────────
    for (const t of this.torpedoes) {
      if (!t.alive) continue;
      t.t += dt;
      // Gentle homing on the nearest boat in a forward cone.
      let best: Racer | null = null;
      let bestD = 60;
      const sp = Math.hypot(t.vx, t.vz) || 1;
      for (const r of racers) {
        if (r.id === t.owner && t.t < 1.5) continue;
        const dx = r.boat.position.x - t.x;
        const dz = r.boat.position.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < bestD && (dx * t.vx + dz * t.vz) / (d * sp) > 0.55) {
          best = r;
          bestD = d;
        }
      }
      if (best) {
        const dx = best.boat.position.x - t.x;
        const dz = best.boat.position.z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.min(1, dt * 2.2);
        t.vx += (dx / d * TORPEDO_SPEED - t.vx) * k;
        t.vz += (dz / d * TORPEDO_SPEED - t.vz) * k;
        const s2 = Math.hypot(t.vx, t.vz) || 1;
        t.vx *= TORPEDO_SPEED / s2;
        t.vz *= TORPEDO_SPEED / s2;
      }
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      if (t.t > 4 || this.statics.blocked(t.x, t.z, 0.6)) {
        t.alive = false;
        this.events.push('itemHit', -1, t.x, 0.5, t.z, 0, 'splash');
        continue;
      }
      for (const r of racers) {
        if (r.id === t.owner && t.t < 1.5) continue;
        const b = r.boat;
        if ((b.position.x - t.x) ** 2 + (b.position.z - t.z) ** 2 < 2.5 * 2.5 && !(b.airborne && b.clearance > 1.6)) {
          t.alive = false;
          this.hit(r, t.owner, 'torpedo', racers, 1);
          break;
        }
      }
    }

    // ── Oil slicks ───────────────────────────────────────────────────────
    for (const s of this.slicks) {
      if (!s.alive) continue;
      s.t += dt;
      s.r = Math.min(5.5, 2.5 + s.t * 3);
      if (s.t > SLICK_LIFE) {
        s.alive = false;
        continue;
      }
      for (const r of racers) {
        if (r.id === s.owner && s.t < 1.2) continue;
        const b = r.boat;
        if (b.airborne || b.wipeout > 0 || b.ghostTime > 0) continue;
        if ((b.position.x - s.x) ** 2 + (b.position.z - s.z) ** 2 < s.r * s.r) {
          s.alive = false;
          this.hit(r, s.owner, 'oil', racers, 0.6);
          break;
        }
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      this.blasts[i].t += dt;
      if (this.blasts[i].t > 1.2) this.blasts.splice(i, 1);
    }
  }

  private use(r: Racer, racers: readonly Racer[]) {
    const item = r.item as ItemId;
    r.item = null;
    const b = r.boat;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    this.events.push('itemUse', r.id, b.position.x, b.position.y, b.position.z, 0, item);
    switch (item) {
      case 'torpedo': {
        const t = this.torpedoes.find((x) => !x.alive);
        if (!t) return;
        const v = TORPEDO_SPEED;
        Object.assign(t, { x: b.position.x + fx * (b.spec.length * 0.6 + 1.5), z: b.position.z + fz * (b.spec.length * 0.6 + 1.5), vx: fx * v + b.velocity.x * 0.3, vz: fz * v + b.velocity.z * 0.3, owner: r.id, t: 0, alive: true });
        break;
      }
      case 'oil': {
        const s = this.slicks.find((x) => !x.alive) ?? this.slicks.reduce((a, x) => (x.t > a.t ? x : a));
        Object.assign(s, { x: b.position.x - fx * (b.spec.length * 0.6 + 3), z: b.position.z - fz * (b.spec.length * 0.6 + 3), r: 2.5, owner: r.id, t: 0, alive: true });
        break;
      }
      case 'shield':
        b.shield = 8;
        break;
      case 'turbo':
        b.boostTime = Math.max(b.boostTime, 2.2);
        b.boostStrength = 1;
        this.events.push('boostStart', r.id, b.position.x, b.position.y, b.position.z, 3);
        break;
      case 'wave': {
        this.blasts.push({ x: b.position.x, z: b.position.z, t: 0 });
        for (const o of racers) {
          if (o === r) continue;
          const ob = o.boat;
          const dx = ob.position.x - b.position.x;
          const dz = ob.position.z - b.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 22) this.hit(o, r.id, 'wave', racers, 1 - d / 22, dx / (d || 1), dz / (d || 1));
        }
        break;
      }
    }
  }

  /** Apply a battle hit to `r` (shield absorbs it). */
  private hit(r: Racer, from: number, kind: string, racers: readonly Racer[], strength: number, nx = 0, nz = 0) {
    const b = r.boat;
    if (b.shield > 0) {
      b.shield = 0;
      this.events.push('shieldHit', r.id, b.position.x, b.position.y, b.position.z, 1, kind);
      return;
    }
    if (kind === 'wave') {
      b.velocity.y += 6 * strength;
      b.velocity.x += nx * 12 * strength;
      b.velocity.z += nz * 12 * strength;
      b.rollRate += 3 * strength;
    } else {
      // Spin out: a short wipeout plus a yaw kick.
      b.wipeout = Math.max(b.wipeout, kind === 'torpedo' ? 1.3 : 0.9);
      b.yawRate += (this.rng.chance(0.5) ? 1 : -1) * (kind === 'torpedo' ? 7 : 5);
      b.velocity.x *= 0.45;
      b.velocity.z *= 0.45;
      if (kind === 'torpedo') b.velocity.y += 5;
      b.drifting = false;
      b.boostTime = 0;
    }
    b.impact = 1;
    b.damage = Math.min(1, b.damage + (kind === 'torpedo' ? 0.22 : 0.1) * b.toughness);
    const shooter = racers.find((x) => x.id === from);
    if (shooter && shooter !== r) shooter.itemHits++;
    this.events.push('itemHit', r.id, b.position.x, b.position.y, b.position.z, strength, kind);
  }

  /** AI: decide whether to fire the held item this frame. */
  aiDecide(r: Racer, racers: readonly Racer[], dt: number) {
    r.controls.item = false;
    if (!r.item) return;
    const hold = (this.aiHold.get(r.id) ?? 0) - dt;
    this.aiHold.set(r.id, hold);
    if (hold > 0) return;
    const b = r.boat;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    let ahead = Infinity;
    let behind = Infinity;
    let near = Infinity;
    for (const o of racers) {
      if (o === r) continue;
      const dx = o.boat.position.x - b.position.x;
      const dz = o.boat.position.z - b.position.z;
      const d = Math.hypot(dx, dz);
      const along = (dx * fx + dz * fz) / (d || 1);
      if (along > 0.85) ahead = Math.min(ahead, d);
      if (along < -0.6) behind = Math.min(behind, d);
      near = Math.min(near, d);
    }
    let fire = false;
    switch (r.item as ItemId) {
      case 'torpedo':
        fire = ahead < 55 || hold < -6;
        break;
      case 'oil':
        fire = behind < 30 || hold < -8;
        break;
      case 'shield':
        fire = near < 18 || hold < -4;
        break;
      case 'wave':
        fire = near < 14 || hold < -10;
        break;
      case 'turbo':
        fire = !b.airborne && b.forwardSpeed > 15 && Math.abs(b.yawRate) < 0.4;
        break;
    }
    r.controls.item = fire;
  }
}
