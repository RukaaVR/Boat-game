/**
 * PEARLS — glowing collectibles strung across the course in lines and arcs
 * whenever items are on (and always in Battle).
 *
 * Each pearl carried (max PEARL_MAX) adds +1 % engine power — so top speed and
 * thrust rise together, through the same `powerScale` multiplier the item
 * effects use; specs are never touched — and every pickup gives a tiny kick.
 * A torpedo / seeker / oil / wave / storm hit, a mine or a wipeout knocks
 * PEARL_DROP pearls loose: they scatter on the water for anyone to grab.
 *
 * Pure simulation: no allocation per step. The first `course` slots are the
 * placed pearls (they regrow some seconds after being taken); the rest are a
 * pool for scattered ones.
 */

import type { EventQueue } from '../core/events';
import { Rng } from '../core/rng';
import type { StaticWorld } from '../boat/collision';
import type { Racer } from './racer';
import type { Track, TrackPoint } from './track';

export const PEARL_MAX = 10;
/** Engine power per pearl carried. */
export const PEARL_POWER = 0.01;
export const PEARL_DROP = 3;
/** Placed pearls are capped so a replay can store which are up as a 72-bit mask. */
export const PEARL_COURSE_MAX = 72;
const LOOSE = 30;
const PICK_R = 2.6;
const REGROW = 12;
const LOOSE_LIFE = 11;
/** A racer can't drop pearls again this soon (one crash = one spill). */
const DROP_CD = 1.2;

const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

export class Pearls {
  /** Number of placed (course) pearls; slots [course, n) are scattered pearls. */
  readonly course: number;
  readonly n: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  /** 1 = on the water and collectable. */
  readonly up: Uint8Array;
  /** Course: seconds until it regrows. Loose: seconds of life left. */
  readonly timer: Float32Array;
  /** Loose pearls: the racer who spilled it (can't re-collect for a moment) and its age. */
  private owner: Int8Array;
  private age: Float32Array;
  private dropCd: Float32Array;
  private rng: Rng;

  constructor(
    track: Track,
    statics: StaticWorld,
    private events: EventQueue,
    racers: number,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    const px: number[] = [];
    const pz: number[] = [];
    const ok = (x: number, z: number) => {
      if (statics.blocked(x, z, 1.6)) return false;
      for (const r of track.ramps) if ((r.x - x) ** 2 + (r.z - z) ** 2 < (r.length * 0.8 + 3) ** 2) return false;
      for (const w of track.whirlpools) if ((w.x - x) ** 2 + (w.z - z) ** 2 < (w.r + 2) ** 2) return false;
      for (const p of track.pads) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 16) return false;
      return true;
    };
    const push = (x: number, z: number) => {
      if (px.length < PEARL_COURSE_MAX && ok(x, z)) {
        px.push(x);
        pz.push(z);
      }
    };
    if (track.arena) {
      // Arena: arcs of seven on three rings, between the item-box spokes.
      const rings: [number, number][] = [
        [48, 3],
        [94, 4],
        [138, 4],
      ];
      for (const [R, arcs] of rings)
        for (let a = 0; a < arcs; a++) {
          const mid = ((a + 0.5) / arcs) * Math.PI * 2 + R * 0.021;
          for (let j = 0; j < 7; j++) {
            const ang = mid + (j - 3) * (5.5 / R);
            push(Math.cos(ang) * R, Math.sin(ang) * R);
          }
        }
    } else {
      // Races: eight strings per lap, alternating a line on the racing line
      // with an arc that sweeps across the course (worth a detour).
      const L = track.lapLength;
      const w = track.width;
      for (let k = 0; k < 8; k++) {
        const s0 = L * ((k + 0.62) / 8);
        const arc = k % 2 === 1;
        const side = k % 4 === 1 ? 1 : -1;
        for (let j = 0; j < 7; j++) {
          const s = s0 + j * 5;
          track.sample(s, _tp);
          const lat = arc ? side * w * 0.32 * Math.sin((j / 6) * Math.PI) : track.lineAt(s);
          push(_tp.x - _tp.tz * lat, _tp.z + _tp.tx * lat);
        }
      }
    }
    this.course = px.length;
    this.n = this.course + LOOSE;
    this.x = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vz = new Float32Array(this.n);
    this.up = new Uint8Array(this.n);
    this.timer = new Float32Array(this.n);
    this.owner = new Int8Array(this.n).fill(-1);
    this.age = new Float32Array(this.n);
    this.dropCd = new Float32Array(Math.max(1, racers));
    for (let i = 0; i < this.course; i++) {
      this.x[i] = px[i];
      this.z[i] = pz[i];
      this.up[i] = 1;
    }
  }

  /** Power multiplier for a racer carrying `pearls`. */
  static power(pearls: number) {
    return 1 + PEARL_POWER * Math.min(PEARL_MAX, Math.max(0, pearls));
  }

  /**
   * Advance one step. `mark` is where this step's events start in the queue:
   * hits, mines and wipeouts in that range make racers spill pearls.
   */
  update(dt: number, racers: readonly Racer[], mark: number, racing: boolean) {
    for (let i = 0; i < this.dropCd.length; i++) if (this.dropCd[i] > 0) this.dropCd[i] = Math.max(0, this.dropCd[i] - dt);
    // ── Spills ─────────────────────────────────────────────────────────────
    const list = this.events.list;
    const end = list.length;
    for (let i = mark; i < end; i++) {
      const e = list[i];
      if (e.racer < 0) continue;
      let spill = false;
      if (e.type === 'itemHit' || e.type === 'wipeout') spill = true;
      else if (e.type === 'collide' && e.text === 'mine') {
        // A shield that ate the mine pushes a shieldHit for the same racer just before.
        const prev = i > 0 ? list[i - 1] : null;
        spill = !(prev && prev.type === 'shieldHit' && prev.racer === e.racer);
      }
      if (spill) {
        const r = racers[e.racer]?.id === e.racer ? racers[e.racer] : this.find(racers, e.racer);
        if (r) this.spill(r);
      }
    }
    // ── Placed pearls regrow; loose ones drift, settle and fade ────────────
    const drag = Math.exp(-2.6 * dt);
    for (let i = 0; i < this.n; i++) {
      if (i < this.course) {
        if (!this.up[i]) {
          this.timer[i] -= dt;
          if (this.timer[i] <= 0) this.up[i] = 1;
        }
        continue;
      }
      if (!this.up[i]) continue;
      this.age[i] += dt;
      this.timer[i] -= dt;
      if (this.timer[i] <= 0) {
        this.up[i] = 0;
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.vx[i] *= drag;
      this.vz[i] *= drag;
    }
    if (!racing) return;
    // ── Pickups ────────────────────────────────────────────────────────────
    for (let k = 0; k < racers.length; k++) {
      const r = racers[k];
      if (r.eliminated || r.finished) continue;
      const b = r.boat;
      if (b.airborne && b.clearance > 2.2) continue;
      const bx = b.position.x;
      const bz = b.position.z;
      for (let i = 0; i < this.n; i++) {
        if (!this.up[i]) continue;
        const dx = this.x[i] - bx;
        const dz = this.z[i] - bz;
        if (dx * dx + dz * dz > PICK_R * PICK_R) continue;
        if (i >= this.course && this.owner[i] === r.id && this.age[i] < 0.9) continue;
        this.up[i] = 0;
        this.timer[i] = REGROW;
        r.pearls = Math.min(PEARL_MAX, r.pearls + 1);
        // A tiny kick on every pickup.
        b.boostTime = Math.max(b.boostTime, 0.3);
        b.boostStrength = Math.max(b.boostStrength, 0.35);
        this.events.push('pearl', r.id, this.x[i], b.surfaceY + 0.8, this.z[i], r.pearls);
      }
    }
  }

  private find(racers: readonly Racer[], id: number) {
    for (const r of racers) if (r.id === id) return r;
    return null;
  }

  /** Knock up to PEARL_DROP pearls off racer r; they scatter round the boat. */
  spill(r: Racer) {
    if (r.pearls <= 0 || this.dropCd[r.id] > 0) return;
    this.dropCd[r.id] = DROP_CD;
    const k = Math.min(PEARL_DROP, r.pearls);
    r.pearls -= k;
    const b = r.boat;
    const a0 = this.rng.range(0, Math.PI * 2);
    let placed = 0;
    for (let i = this.course; i < this.n && placed < k; i++) {
      if (this.up[i]) continue;
      const a = a0 + (placed / k) * Math.PI * 2;
      const sp = this.rng.range(7, 11);
      this.x[i] = b.position.x + Math.cos(a) * 1.5;
      this.z[i] = b.position.z + Math.sin(a) * 1.5;
      this.vx[i] = Math.cos(a) * sp + b.velocity.x * 0.3;
      this.vz[i] = Math.sin(a) * sp + b.velocity.z * 0.3;
      this.up[i] = 1;
      this.timer[i] = LOOSE_LIFE;
      this.age[i] = 0;
      this.owner[i] = r.id;
      placed++;
    }
    this.events.push('pearlDrop', r.id, b.position.x, b.position.y, b.position.z, k);
  }

  /** Is pearl i in its last seconds (loose pearls blink before vanishing)? */
  fading(i: number) {
    return i >= this.course && this.timer[i] < 2;
  }

  /** Replay: 24 placed pearls per float (exact in a Float32). */
  mask(word: number) {
    let m = 0;
    for (let j = 0; j < 24; j++) {
      const i = word * 24 + j;
      if (i < this.course && this.up[i]) m |= 1 << j;
    }
    return m;
  }

  /** Replay playback: restore which placed pearls are up; scattered ones are not recorded. */
  applyMask(word: number, m: number) {
    for (let j = 0; j < 24; j++) {
      const i = word * 24 + j;
      if (i < this.course) this.up[i] = m & (1 << j) ? 1 : 0;
    }
    if (word === 0) for (let i = this.course; i < this.n; i++) this.up[i] = 0;
  }
}
