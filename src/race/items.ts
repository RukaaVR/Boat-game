/**
 * BATTLE ITEMS — item boxes, projectiles and hazards for Battle mode (and
 * normal races with items on).
 *
 * Rows of item boxes float across the course. Driving through one gives a
 * random item (weighted by race position: the back of the pack gets the
 * strong stuff). Every racer, AI included, fires items through the same
 * `Controls.item` button; AI decides when in `aiDecide`, from what it can see.
 *
 *   TORPEDO     fired forward at 55 m/s, homes gently on the boat ahead
 *   TORPEDO ×3  three torpedoes, one per press
 *   OIL         slick dropped behind; boats crossing it spin out
 *   SHIELD      bubble for 8 s that absorbs one hit (torpedo, oil, mine, seeker)
 *   WAVE        wave-maker: shoves every boat within 22 m up and away
 *   TURBO       instant long mini-turbo
 *   SEEKER      sea-skimming missile that locks on the race leader (2nd if the
 *               leader fires it). Follows the course, climbs and dives on the
 *               target. Dodge by being airborne (> 1.5 m) at impact, or shield.
 *   GOLDEN SURGE  6 s window: every press is a strong short boost
 *   STORM CALL  lightning strikes every other racer: shrunk + 25 % slower for 5 s
 *
 * HOLD TO TRAIL: a TORPEDO (single), OIL SLICK or SHIELD can be held behind the
 * boat by keeping the item button down (≥ HOLD_DELAY s). While it trails off the
 * stern it absorbs one torpedo or seeker strike from behind and is spent.
 * Releasing deploys it: oil drops where it trails, the shield goes up, and a
 * torpedo fires forward — or BACKWARD if brake is held at the moment of release.
 * A quick tap (released before HOLD_DELAY) deploys exactly as a press always did,
 * on the release. Taking a hit while trailing knocks the item loose (a trailed
 * oil slick spills where it was).
 */

import type { EventQueue } from '../core/events';
import { Rng } from '../core/rng';
import type { Racer } from './racer';
import type { Projection, Track, TrackPoint } from './track';
import type { StaticWorld } from '../boat/collision';
import type { Collider } from '../core/types';

export type ItemId = 'torpedo' | 'oil' | 'shield' | 'wave' | 'turbo' | 'torpedo3' | 'homer' | 'surge' | 'storm';
export const ITEM_IDS: ItemId[] = ['torpedo', 'oil', 'shield', 'wave', 'turbo', 'torpedo3', 'homer', 'surge', 'storm'];
export const ITEM_LABEL: Record<ItemId, string> = {
  torpedo: 'TORPEDO',
  oil: 'OIL SLICK',
  shield: 'SHIELD',
  wave: 'WAVE MAKER',
  turbo: 'TURBO',
  torpedo3: 'TORPEDO',
  homer: 'SEEKER',
  surge: 'GOLDEN SURGE',
  storm: 'STORM CALL',
};
/** Uses granted by one pickup. */
export const ITEM_USES: Partial<Record<ItemId, number>> = { torpedo3: 3 };

/** Roulette time before a picked-up item can be used. */
export const ITEM_ROLL = 1.1;
export const SURGE_TIME = 6;
export const SHRINK_TIME = 5;
/** Shrunk racers keep this fraction of their engine power (top speed scales with it). */
export const SHRINK_POWER = 0.75;
export const SLOW_POWER = 0.7;
const STORM_COOLDOWN = 30;
/** Items that can be held behind the boat as a blocker. */
export const HOLDABLE: ReadonlySet<string> = new Set<ItemId>(['torpedo', 'oil', 'shield']);
/** Button-down time after which a holdable item starts trailing instead of deploying. */
export const HOLD_DELAY = 0.2;
/** Where a trailed item sits: this far behind the boat centre (plus half the hull). */
export const HOLD_BACK = 2.4;
/** A trailed item intercepts shots within this radius of itself. */
const HOLD_R = 1.7;

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
export type MissilePhase = 'launch' | 'track' | 'home';
export interface Missile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Arc length along the course while tracking, and lateral offset. */
  s: number;
  lat: number;
  speed: number;
  owner: number;
  target: number;
  t: number;
  phase: MissilePhase;
  /** Seconds to the next lock beep. */
  beep: number;
  /** 0..1 how close impact is (HUD / audio urgency). */
  urgency: number;
  alive: boolean;
}

const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
const _proj: Projection = { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 };
const _hp = { x: 0, z: 0 };
/** Seeker obstacle-avoidance scratch. */
const _av = { x: 0, z: 0, ux: 0, uz: 1, best: 0, push: 0, nx: 0, nz: 0, sx: 0, sz: 0, sr: 0, hit: false };
const TORPEDO_SPEED = 55;
const SLICK_LIFE = 16;
const MISSILE_SPEED = 72;
/** A missile can't strike before this, so the target always gets the warning. */
const MISSILE_ARM = 1.5;
const MISSILE_LIFE = 16;
const SKIM = 1.3;

export class BattleItems {
  readonly boxes: ItemBox[] = [];
  readonly torpedoes: Torpedo[] = [];
  readonly slicks: Slick[] = [];
  readonly missiles: Missile[] = [];
  /** Wave-maker blasts for the renderer: x, z, age. */
  readonly blasts: { x: number; z: number; t: number }[] = [];
  /** Seconds until another Storm Call can be rolled (no chaining). */
  stormCooldown = 0;
  private rng: Rng;
  private prevItem = new Map<number, boolean>();
  private aiHold = new Map<number, number>();
  /** AI intends to keep the current press down (trail the item). */
  private aiTrail = new Map<number, boolean>();
  private weights: Record<ItemId, number> = { torpedo: 0, oil: 0, shield: 0, wave: 0, turbo: 0, torpedo3: 0, homer: 0, surge: 0, storm: 0 };

  constructor(
    private track: Track,
    private statics: StaticWorld,
    private events: EventQueue,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    // Four rows of boxes per lap, staggered across the course (arenas scatter them instead).
    const L = track.length;
    if (track.arena) placeArenaBoxes(track, statics, this.boxes);
    else for (let k = 0; k < 4; k++) {
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
    for (let i = 0; i < 24; i++) this.torpedoes.push({ x: 0, z: 0, vx: 0, vz: 0, owner: -1, t: 0, alive: false });
    for (let i = 0; i < 16; i++) this.slicks.push({ x: 0, z: 0, r: 4.2, owner: -1, t: 0, alive: false });
    for (let i = 0; i < 4; i++) this.missiles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, lat: 0, speed: 0, owner: -1, target: -1, t: 0, phase: 'launch', beep: 0, urgency: 0, alive: false });
  }

  /**
   * Item odds for a racer in `place` of `n`. Leaders get defence and skill
   * items; the back half gets the comeback weapons. SEEKER never rolls in the
   * top 3, STORM CALL only for the last two places and never while one is held,
   * flying or on cooldown. Exposed for the balancing table / tests.
   */
  odds(place: number, n: number, racers: readonly Racer[] | null = null): Record<ItemId, number> {
    const back = (place - 1) / Math.max(1, n - 1);
    const w = this.weights;
    w.torpedo = 0.8 + back * 0.9;
    w.oil = 1.3 - back * 0.9;
    w.shield = 1.1 - back * 0.7 + (place === 1 ? 0.3 : 0);
    w.wave = 0.4 + back * 0.4;
    w.turbo = 0.3 + back * 1.0;
    w.torpedo3 = place <= 2 ? 0 : 0.1 + back * 0.7;
    w.homer = place <= 3 || n < 4 ? 0 : 0.05 + back * 0.45;
    w.surge = back < 0.5 ? 0 : (back - 0.5) * 1.4;
    let stormOk = place >= n - 1 && n >= 4 && this.stormCooldown <= 0;
    let homers = 0;
    for (const m of this.missiles) if (m.alive) homers++;
    if (racers)
      for (const r of racers) {
        if (r.item === 'storm') stormOk = false;
        if (r.item === 'homer') homers++;
      }
    w.storm = stormOk ? 0.3 : 0;
    // At most two seekers in play (held or flying) so the leader is never buried.
    if (homers >= 2) w.homer = 0;
    return w;
  }

  /** Item roll weighted by place: leaders get defence, the back gets weapons. */
  private roll(place: number, racers: readonly Racer[]): ItemId {
    const w = this.odds(place, racers.length, racers);
    let sum = 0;
    for (const k of ITEM_IDS) sum += Math.max(0, w[k]);
    let r = this.rng.next() * sum;
    for (const k of ITEM_IDS) {
      r -= Math.max(0, w[k]);
      if (r <= 0) return k;
    }
    return 'turbo';
  }

  update(dt: number, racers: readonly Racer[], racing: boolean) {
    if (this.stormCooldown > 0) this.stormCooldown = Math.max(0, this.stormCooldown - dt);
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
          const it = this.roll(r.place, racers);
          r.item = it;
          r.itemCount = ITEM_USES[it] ?? 1;
          r.itemRoll = ITEM_ROLL;
          this.aiHold.set(r.id, this.rng.range(0.6, 2.5));
          this.events.push('itemPickup', r.id, box.x, b.position.y, box.z, 0, r.item);
          break;
        }
      }
    }

    // ── Timers + use ─────────────────────────────────────────────────────
    for (const r of racers) {
      const b = r.boat;
      if (r.itemRoll > 0) {
        r.itemRoll = Math.max(0, r.itemRoll - dt);
        if (r.itemRoll === 0 && r.item) this.events.push('itemReady', r.id, b.position.x, b.position.y, b.position.z, 0, r.item);
      }
      if (r.itemCooldown > 0) r.itemCooldown = Math.max(0, r.itemCooldown - dt);
      if (b.shrink > 0) b.shrink = Math.max(0, b.shrink - dt);
      if (b.itemSlow > 0) b.itemSlow = Math.max(0, b.itemSlow - dt);
      if (b.surge > 0) {
        b.surge = Math.max(0, b.surge - dt);
        if (b.surge === 0 && r.item === 'surge') {
          r.item = null;
          r.itemCount = 0;
        }
      }
      const down = r.controls.item;
      const pressed = down && !this.prevItem.get(r.id);
      this.prevItem.set(r.id, down);
      if (!r.item || !HOLDABLE.has(r.item)) r.itemHeld = r.itemPending = false;
      if (r.itemHeld) {
        // Trailing: releasing the button deploys it (if the boat is in a state to).
        if (!down) {
          r.itemHeld = false;
          if (racing && b.wipeout <= 0) this.use(r, racers, true);
        }
        continue;
      }
      if (r.itemPending) {
        if (!down) {
          // A tap: deploy on release, exactly what a press used to do.
          r.itemPending = false;
          if (racing && b.wipeout <= 0) this.use(r, racers);
        } else if ((r.itemHoldT += dt) >= HOLD_DELAY) {
          r.itemPending = false;
          r.itemHeld = true;
          this.heldPos(r);
          this.events.push('itemHold', r.id, _hp.x, b.position.y, _hp.z, 0, r.item ?? '');
        }
        continue;
      }
      if (!pressed || !racing) continue;
      if (r.item && b.wipeout <= 0 && r.itemRoll <= 0 && r.itemCooldown <= 0) {
        if (HOLDABLE.has(r.item)) {
          r.itemPending = true;
          r.itemHoldT = 0;
        } else this.use(r, racers);
      } else if (r.isPlayer && !(r.item === 'surge' && r.itemCooldown > 0)) this.events.push('itemDenied', r.id, b.position.x, b.position.y, b.position.z, 0, r.item ?? '');
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
        this.events.push('itemMiss', t.owner, t.x, 0.5, t.z, 0, 'miss');
        continue;
      }
      for (const r of racers) {
        if (r.id === t.owner && t.t < 1.5) continue;
        const b = r.boat;
        if (r.itemHeld && !(b.airborne && b.clearance > 1.6)) {
          // A trailed item soaks up a shot that reaches it first, or one striking the stern.
          this.heldPos(r);
          const toItem = (_hp.x - t.x) ** 2 + (_hp.z - t.z) ** 2 < HOLD_R * HOLD_R;
          const astern = (b.position.x - t.x) ** 2 + (b.position.z - t.z) ** 2 < 2.5 * 2.5 && this.fromBehind(r, t.x, t.z);
          if (toItem || astern) {
            t.alive = false;
            this.block(r, t.owner, 'torpedo');
            break;
          }
        }
        if ((b.position.x - t.x) ** 2 + (b.position.z - t.z) ** 2 < 2.5 * 2.5 && !(b.airborne && b.clearance > 1.6)) {
          t.alive = false;
          this.hit(r, t.owner, 'torpedo', racers, 1);
          break;
        }
      }
    }

    // ── Seeker missiles ──────────────────────────────────────────────────
    for (const m of this.missiles) if (m.alive) this.updateMissile(m, dt, racers);

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

  /** The racer leading the race other than `not` (unfinished), or null. */
  private leader(racers: readonly Racer[], not: number): Racer | null {
    let best: Racer | null = null;
    for (const r of racers) {
      if (r.id === not || r.finished) continue;
      if (!best || r.place < best.place) best = r;
    }
    return best;
  }

  private updateMissile(m: Missile, dt: number, racers: readonly Racer[]) {
    m.t += dt;
    let tgt: Racer | undefined = racers[m.target];
    if (!tgt || tgt.id !== m.target || tgt.finished) {
      // Target crossed the line: re-acquire the new leader, or fizzle.
      const nl = this.leader(racers, m.owner);
      if (!nl) {
        this.detonate(m, -1);
        return;
      }
      m.target = nl.id;
      tgt = nl;
      this.events.push('itemLock', tgt.id, tgt.boat.position.x, tgt.boat.position.y, tgt.boat.position.z, 0, 'start');
    }
    const tb = tgt.boat;
    const L = this.track.length;
    const px = m.x;
    const py = m.y;
    const pz = m.z;
    const tSpeed = tb.speed;
    m.speed = Math.max(MISSILE_SPEED + m.t * 3, tSpeed + 22);
    let along = tgt.s - m.s;
    if (along > L / 2) along -= L;
    if (along < -L / 2) along += L;
    const dxT = tb.position.x - m.x;
    const dzT = tb.position.z - m.z;
    const dd = Math.hypot(dxT, dzT);

    if (m.phase !== 'home') {
      // Follow the course centreline at a lateral offset that eases onto the target's line.
      m.s = this.track.wrapS(m.s + m.speed * dt * (m.phase === 'launch' ? 0.7 : 1));
      const weave = Math.sin(m.t * 3.1) * 2.2 * Math.max(0, 1 - m.t / 6);
      m.lat += (tgt.lateral - m.lat) * Math.min(1, dt * 1.6);
      this.track.sample(m.s, _tp);
      const lat = m.lat + weave;
      m.x = _tp.x - _tp.tz * lat;
      m.z = _tp.z + _tp.tx * lat;
      const surf = tb.surfaceY;
      const lift = m.phase === 'launch' ? Math.sin(Math.min(1, m.t / 0.6) * Math.PI * 0.5) * 4.5 * (1 - Math.max(0, (m.t - 0.4) / 0.4)) : 0;
      m.y = surf + SKIM + Math.max(0, lift) + Math.sin(m.t * 14) * 0.12;
      if (m.phase === 'launch' && m.t > 0.8) m.phase = 'track';
      // Close along the course (or the target is behind us): switch to direct homing.
      if (m.phase === 'track' && ((along < 34 && along > -12) || dd < 30 || along < -12)) m.phase = 'home';
    } else {
      // Direct pursuit with a turn rate that tightens as it closes: a curving run-in.
      const sp = Math.hypot(m.vx, m.vz) || 1;
      const k = Math.min(1, dt * (2.5 + 9 * Math.max(0, 1 - dd / 40)));
      let vx = m.vx / sp;
      let vz = m.vz / sp;
      const d = dd || 1;
      vx += (dxT / d - vx) * k;
      vz += (dzT / d - vz) * k;
      let n = Math.hypot(vx, vz) || 1;
      vx /= n;
      vz /= n;
      // Islands and rocks: veer round anything in the flight path ahead.
      this.avoid(m.x, m.z, vx, vz, Math.max(0, Math.min(26, dd - 1)));
      if (_av.push > 0) {
        const kk = Math.min(1, dt * 9 * _av.push);
        vx += (_av.nx - vx) * kk;
        vz += (_av.nz - vz) * kk;
        n = Math.hypot(vx, vz) || 1;
        vx /= n;
        vz /= n;
      }
      m.x += vx * m.speed * dt;
      m.z += vz * m.speed * dt;
      // Still flew into one: it bursts on the rocks, harmlessly.
      if (this.solidAt(m.x, m.z, 0.5)) {
        m.vx = vx;
        m.vz = vz;
        this.detonate(m, m.owner);
        return;
      }
      // Climb then dive onto the target over the last 24 m.
      const arc = Math.max(0, Math.min(1, (24 - dd) / 24));
      m.y = tb.surfaceY + SKIM + Math.sin(arc * Math.PI) * 5.5 * (m.t > MISSILE_ARM - 0.3 ? 1 : 0.4);
    }
    const idt = 1 / Math.max(1e-4, dt);
    m.vx = (m.x - px) * idt;
    m.vy = (m.y - py) * idt;
    m.vz = (m.z - pz) * idt;

    // Lock-on beeps speed up as impact nears.
    const close = Math.max(5, m.speed - tSpeed);
    const eta = (m.phase === 'home' ? dd : Math.max(dd, along)) / close;
    m.urgency = Math.max(0, Math.min(1, 1 - eta / 4));
    m.beep -= dt;
    if (m.beep <= 0) {
      m.beep = Math.max(0.07, Math.min(0.55, 0.06 + eta * 0.13));
      this.events.push('itemLock', tgt.id, m.x, m.y, m.z, m.urgency);
    }

    if (m.phase === 'home' && dd < 3.2 && m.t > MISSILE_ARM) {
      if (tb.airborne && tb.clearance > 1.5) {
        // Jumped clean over it: the missile ploughs into the sea underneath.
        m.alive = false;
        this.events.push('itemHit', -1, m.x, tb.surfaceY, m.z, 0.6, 'homer-miss');
        this.events.push('itemMiss', tgt.id, tb.position.x, tb.position.y, tb.position.z, 1, 'dodge');
        this.events.push('itemMiss', m.owner, m.x, m.y, m.z, 0, 'miss');
        return;
      }
      m.alive = false;
      if (tgt.itemHeld && this.fromBehind(tgt, m.x - m.vx * 0.05, m.z - m.vz * 0.05)) {
        // The trailed item takes the dive: the seeker bursts on it, harmlessly.
        this.heldPos(tgt);
        this.events.push('itemHit', -1, _hp.x, tb.surfaceY + SKIM, _hp.z, 0.6, 'homer-miss');
        this.block(tgt, m.owner, 'homer');
        return;
      }
      this.hit(tgt, m.owner, 'homer', racers, 1);
      return;
    }
    if (m.t > MISSILE_LIFE) this.detonate(m, m.owner);
  }

  /**
   * Seeker obstacle sense: the static nearest along the ray (x,z)+(ux,uz)·t,
   * t < look, whose circle (plus margin) the ray would pass through. Writes
   * the sidestep direction and urgency into `_av` (push 0 = clear path).
   */
  private avoid(x: number, z: number, ux: number, uz: number, look: number) {
    _av.push = 0;
    _av.best = look;
    _av.x = x;
    _av.z = z;
    _av.ux = ux;
    _av.uz = uz;
    this.statics.query(x + ux * look * 0.5, z + uz * look * 0.5, look * 0.5 + 4, this.avoidVisit);
  }
  private avoidVisit = (c: Collider) => {
    const rx = c.x - _av.x;
    const rz = c.z - _av.z;
    const along = rx * _av.ux + rz * _av.uz;
    if (along <= 0 || along - c.r > _av.best) return;
    const side = rx * -_av.uz + rz * _av.ux;
    const clear = c.r + 2.2;
    if (Math.abs(side) >= clear) return;
    _av.best = Math.max(0, along - c.r);
    // Sidestep away from the centre of the obstacle (left if it is to the right).
    const sgn = side >= 0 ? -1 : 1;
    const px = -_av.uz * sgn;
    const pz = _av.ux * sgn;
    const urg = 1 - _av.best / Math.max(1, along + c.r);
    _av.push = Math.max(_av.push, 0.4 + urg * 1.6) * (1 - Math.abs(side) / clear * 0.5);
    _av.nx = _av.ux * 0.35 + px;
    _av.nz = _av.uz * 0.35 + pz;
    const l = Math.hypot(_av.nx, _av.nz) || 1;
    _av.nx /= l;
    _av.nz /= l;
  };
  private solidVisit = (c: Collider) => {
    if ((_av.sx - c.x) ** 2 + (_av.sz - c.z) ** 2 < (c.r + _av.sr) ** 2) _av.hit = true;
  };
  /** Allocation-free `StaticWorld.blocked`. */
  private solidAt(x: number, z: number, r: number) {
    _av.sx = x;
    _av.sz = z;
    _av.sr = r;
    _av.hit = false;
    this.statics.query(x, z, r, this.solidVisit);
    return _av.hit;
  }

  private detonate(m: Missile, owner: number) {
    m.alive = false;
    this.events.push('itemHit', -1, m.x, m.y - SKIM, m.z, 0.6, 'homer-miss');
    if (owner >= 0) this.events.push('itemMiss', owner, m.x, m.y, m.z, 0, 'miss');
  }

  private fireTorpedo(r: Racer, backward = false) {
    const b = r.boat;
    const fx = Math.sin(b.heading) * (backward ? -1 : 1);
    const fz = Math.cos(b.heading) * (backward ? -1 : 1);
    let t: Torpedo | null = null;
    for (const x of this.torpedoes) if (!x.alive) { t = x; break; }
    if (!t) return;
    const off = b.spec.length * 0.6 + 1.5;
    t.x = b.position.x + fx * off;
    t.z = b.position.z + fz * off;
    t.vx = fx * TORPEDO_SPEED + b.velocity.x * 0.3;
    t.vz = fz * TORPEDO_SPEED + b.velocity.z * 0.3;
    t.owner = r.id;
    t.t = 0;
    t.alive = true;
  }

  /** World position of a racer's trailed item (into `_hp`). */
  heldPos(r: Racer, out: { x: number; z: number } = _hp) {
    const b = r.boat;
    const back = b.spec.length * 0.5 + HOLD_BACK;
    out.x = b.position.x - Math.sin(b.heading) * back;
    out.z = b.position.z - Math.cos(b.heading) * back;
    return out;
  }

  /** Is (x, z) behind racer r's beam (the side a trailed item covers)? */
  private fromBehind(r: Racer, x: number, z: number) {
    const b = r.boat;
    return (x - b.position.x) * Math.sin(b.heading) + (z - b.position.z) * Math.cos(b.heading) < 0.6;
  }

  /** A trailed item absorbed a shot: it is spent, the racer is untouched. */
  private block(r: Racer, from: number, kind: string) {
    this.heldPos(r);
    const held = r.item ?? '';
    r.item = null;
    r.itemCount = 0;
    r.itemHeld = false;
    this.events.push('itemBlock', r.id, _hp.x, r.boat.surfaceY + 0.4, _hp.z, kind === 'homer' ? 1 : 0.6, held);
    if (kind === 'torpedo') this.events.push('itemHit', -1, _hp.x, r.boat.surfaceY + 0.4, _hp.z, 0, 'splash');
    if (from >= 0 && from !== r.id) this.events.push('itemMiss', from, _hp.x, r.boat.surfaceY, _hp.z, 0, 'miss');
  }

  /** A hit knocks a trailed item loose: a trailed oil slick spills where it was. */
  private dropHeld(r: Racer) {
    if (!r.itemHeld || !r.item) return;
    if (r.item === 'oil') {
      this.heldPos(r);
      const s = this.freeSlick();
      s.x = _hp.x;
      s.z = _hp.z;
      s.r = 2.5;
      s.owner = r.id;
      s.t = 0;
      s.alive = true;
    }
    r.item = null;
    r.itemCount = 0;
    r.itemHeld = false;
  }

  private freeSlick() {
    let best = this.slicks[0];
    for (const x of this.slicks) {
      if (!x.alive) return x;
      if (x.t > best.t) best = x;
    }
    return best;
  }

  private use(r: Racer, racers: readonly Racer[], fromHold = false) {
    const item = r.item as ItemId;
    const b = r.boat;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    // Multi-use items stay in hand until spent.
    r.itemCount = Math.max(0, r.itemCount - 1);
    if (item !== 'surge' && r.itemCount <= 0) r.item = null;
    this.events.push('itemUse', r.id, b.position.x, b.position.y, b.position.z, r.itemCount, item);
    switch (item) {
      case 'torpedo':
        // Released from a hold with brake down: fire it backward at the chaser.
        this.fireTorpedo(r, fromHold && r.controls.brake > 0.5);
        break;
      case 'torpedo3':
        this.fireTorpedo(r);
        r.itemCooldown = 0.18;
        if (r.ai) this.aiHold.set(r.id, this.rng.range(0.5, 1.4));
        break;
      case 'oil': {
        const s = this.freeSlick();
        s.x = b.position.x - fx * (b.spec.length * 0.6 + 3);
        s.z = b.position.z - fz * (b.spec.length * 0.6 + 3);
        s.r = 2.5;
        s.owner = r.id;
        s.t = 0;
        s.alive = true;
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
      case 'surge':
        // First press opens the window; every press inside it is a strong short boost.
        if (b.surge <= 0) b.surge = SURGE_TIME;
        r.item = 'surge';
        r.itemCount = 1;
        r.itemCooldown = 0.22;
        b.boostTime = Math.max(b.boostTime, 0.95);
        b.boostStrength = Math.max(b.boostStrength, 1.15);
        if (r.ai) this.aiHold.set(r.id, this.rng.range(0.7, 1.1));
        break;
      case 'homer': {
        const tgt = this.leader(racers, r.id);
        const m = this.missiles.find((x) => !x.alive);
        if (!tgt || !m) break;
        this.track.project(b.position.x, b.position.z, r.hint, _proj);
        m.s = _proj.s;
        m.lat = _proj.lateral;
        m.x = b.position.x;
        m.y = b.position.y + 1;
        m.z = b.position.z;
        m.vx = fx * MISSILE_SPEED;
        m.vy = 6;
        m.vz = fz * MISSILE_SPEED;
        m.speed = MISSILE_SPEED;
        m.owner = r.id;
        m.target = tgt.id;
        m.t = 0;
        m.phase = 'launch';
        m.beep = 0.3;
        m.urgency = 0;
        m.alive = true;
        this.events.push('itemLock', tgt.id, tgt.boat.position.x, tgt.boat.position.y, tgt.boat.position.z, 0, 'start');
        break;
      }
      case 'storm': {
        this.stormCooldown = STORM_COOLDOWN;
        for (const o of racers) {
          if (o === r || o.finished) continue;
          const ob = o.boat;
          if (ob.shield > 0) {
            ob.shield = 0;
            this.events.push('shieldHit', o.id, ob.position.x, ob.position.y, ob.position.z, 1, 'storm');
            continue;
          }
          ob.shrink = SHRINK_TIME;
          ob.velocity.x *= 0.8;
          ob.velocity.z *= 0.8;
          ob.yawRate += (this.rng.chance(0.5) ? 1 : -1) * 2.5;
          ob.impact = Math.max(ob.impact, 0.6);
          ob.drifting = false;
          this.events.push('itemHit', o.id, ob.position.x, ob.position.y, ob.position.z, 0.5, 'storm');
        }
        // The caller rides the confusion: a short kick of speed.
        b.boostTime = Math.max(b.boostTime, 0.8);
        b.boostStrength = Math.max(b.boostStrength, 0.8);
        break;
      }
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
    this.dropHeld(r);
    if (kind === 'wave') {
      b.velocity.y += 6 * strength;
      b.velocity.x += nx * 12 * strength;
      b.velocity.z += nz * 12 * strength;
      b.rollRate += 3 * strength;
    } else if (kind === 'homer') {
      // A direct hit from above: thrown up, spun round, engine sputtering.
      b.wipeout = Math.max(b.wipeout, 1.8);
      b.yawRate += (this.rng.chance(0.5) ? 1 : -1) * 9;
      b.rollRate += (this.rng.chance(0.5) ? 1 : -1) * 4;
      b.velocity.x *= 0.25;
      b.velocity.z *= 0.25;
      b.velocity.y += 8;
      b.drifting = false;
      b.boostTime = 0;
      b.itemSlow = 2.5;
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
    b.damage = Math.min(1, b.damage + (kind === 'homer' ? 0.3 : kind === 'torpedo' ? 0.22 : 0.1) * b.toughness);
    if (from !== r.id) {
      const shooter = racers[from];
      if (shooter && shooter.id === from) shooter.itemHits++;
    }
    this.events.push('itemHit', r.id, b.position.x, b.position.y, b.position.z, strength, kind);
  }

  /** Is a seeker currently locked on racer `id`? Returns the most urgent one. */
  missileOn(id: number): Missile | null {
    let best: Missile | null = null;
    for (const m of this.missiles) if (m.alive && m.target === id && (!best || m.urgency > best.urgency)) best = m;
    return best;
  }

  /** AI: decide whether to fire the held item this frame. */
  aiDecide(r: Racer, racers: readonly Racer[], dt: number) {
    r.controls.item = false;
    if (!r.item || r.itemRoll > 0) return;
    const hold = (this.aiHold.get(r.id) ?? 0) - dt;
    this.aiHold.set(r.id, hold);
    const b = r.boat;
    const threat = this.missileOn(r.id);
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
    // Hold to trail: leaders drag a defensive item behind them as seeker/torpedo cover.
    if (r.itemHeld) {
      // In an arena fight a trailed item is let go sooner (fresh boxes are everywhere).
      let release = hold < (this.track.arena ? -10 : -28) || r.place > 3;
      if (r.item === 'torpedo') release ||= ahead < 45;
      else if (r.item === 'oil') release ||= behind < 9;
      else if (r.item === 'shield') release ||= near < 6 && !threat;
      r.controls.item = !release;
      return;
    }
    if (r.itemPending) {
      r.controls.item = this.aiTrail.get(r.id) === true;
      return;
    }
    const trail = HOLDABLE.has(r.item) && (r.item === 'torpedo' ? r.place === 1 && ahead > 60 : r.place <= 2) && racers.length > 2;
    if (trail && !threat) {
      // Trailing starts as a press that is simply never let go.
      this.aiTrail.set(r.id, true);
      r.controls.item = !this.prevItem.get(r.id);
      return;
    }
    this.aiTrail.set(r.id, false);
    // A seeker inbound and a shield in hand: put it up before the dive.
    if (threat && r.item === 'shield' && b.shield <= 0 && threat.urgency > 0.45) {
      r.controls.item = !this.prevItem.get(r.id);
      return;
    }
    if (hold > 0) return;
    const straight = !b.airborne && b.forwardSpeed > 15 && Math.abs(b.yawRate) < 0.4;
    let fire = false;
    switch (r.item as ItemId) {
      case 'torpedo':
        fire = ahead < 55 || hold < -6;
        break;
      case 'torpedo3':
        fire = ahead < 50 || hold < -7;
        break;
      case 'oil':
        fire = behind < 30 || hold < -8;
        break;
      case 'shield':
        // The leader keeps a shield in hand as seeker insurance.
        fire = r.place === 1 ? hold < -14 : near < 18 || hold < -4;
        break;
      case 'wave':
        fire = near < 14 || hold < -10;
        break;
      case 'turbo':
        fire = straight;
        break;
      case 'surge':
        fire = straight || (b.surge > 0 && b.surge < 1.2);
        break;
      case 'homer':
        fire = r.place > 1 || hold < -8;
        break;
      case 'storm':
        fire = true;
        break;
    }
    // Item is edge-triggered: release between presses.
    if (fire && this.prevItem.get(r.id)) fire = false;
    r.controls.item = fire;
  }
}

/** Battle arena: concentric rings of boxes across the whole lagoon, plus a ring out in the moat. */
function placeArenaBoxes(track: Track, statics: StaticWorld, out: ItemBox[]) {
  const rings: [number, number][] = [
    [0, 1],
    [30, 6],
    [70, 10],
    [116, 14],
    [160, 16],
    [284, 14],
  ];
  for (const [R, n] of rings) {
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + R * 0.013;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      if (statics.blocked(x, z, 3)) continue;
      if (track.ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 20)) continue;
      if (track.whirlpools.some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 3)) continue;
      out.push({ x, z, respawn: 0 });
    }
  }
}
