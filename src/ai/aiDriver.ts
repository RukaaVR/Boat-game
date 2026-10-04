/**
 * AI DRIVERS.
 *
 * The AI writes the same `Controls` the player's input writes. No AI-only
 * forces, no path snapping: if an AI boat does something, the player's boat
 * could too.
 *
 * Each driver steers at a look-ahead point on (racing line + personal lane +
 * wander + traffic avoidance), takes target speed from the track's curvature
 * profile scaled by personality, decides per corner whether to drift and how
 * long, spends nitro by strategy, occasionally makes a *legible* mistake
 * (wide entry, overcooked corner, lift, over-held drift) and recovers when stuck.
 */

import { Rng } from '../core/rng';
import { angleDelta, clamp, clamp01, damp, noise1 } from '../core/mathx';
import type { Controls, Difficulty } from '../core/types';
import type { Boat } from '../boat/boat';
import { DRIFT_TIER_AT, driftTurnRate, TUNE } from '../boat/boatPhysics';
import { projectOnShortcut, shortcutPoint, Track, type Projection, type TrackPoint } from '../race/track';

export type Style = 'aggressive' | 'technical' | 'speed' | 'balanced' | 'reckless';

export interface Personality {
  style: Style;
  /** Fraction of the corner speed profile used. */
  pace: number;
  /** Lane bias from the racing line, metres. */
  lane: number;
  /** Lane wander amplitude, metres. */
  wander: number;
  /** Probability of drifting a qualifying corner. */
  driftSkill: number;
  /** Drift tier the driver tries to hold for. */
  driftGreed: number;
  shortcutChance: number;
  rampChance: number;
  /** Mistakes per minute (approx). */
  mistakes: number;
  /** 0 = yields in traffic, 1 = leans on rivals. */
  aggression: number;
  /** Probability of attempting a trick when airborne. */
  stunt: number;
}

export const PERSONALITIES: Record<Style, Personality> = {
  aggressive: { style: 'aggressive', pace: 1.02, lane: -2.5, wander: 2, driftSkill: 0.75, driftGreed: 2, shortcutChance: 0.85, rampChance: 0.7, mistakes: 1.1, aggression: 0.9, stunt: 0.5 },
  technical: { style: 'technical', pace: 1.0, lane: 0, wander: 0.8, driftSkill: 0.95, driftGreed: 3, shortcutChance: 0.35, rampChance: 0.2, mistakes: 0.35, aggression: 0.2, stunt: 0.15 },
  speed: { style: 'speed', pace: 0.97, lane: 3, wander: 1.5, driftSkill: 0.45, driftGreed: 1, shortcutChance: 0.2, rampChance: 0.35, mistakes: 0.7, aggression: 0.45, stunt: 0.2 },
  balanced: { style: 'balanced', pace: 0.99, lane: 1.2, wander: 1.5, driftSkill: 0.65, driftGreed: 2, shortcutChance: 0.5, rampChance: 0.5, mistakes: 0.6, aggression: 0.4, stunt: 0.35 },
  reckless: { style: 'reckless', pace: 1.04, lane: -4, wander: 4, driftSkill: 0.8, driftGreed: 3, shortcutChance: 0.7, rampChance: 0.9, mistakes: 1.8, aggression: 1.0, stunt: 0.8 },
};

const DIFF: Record<Difficulty, { pace: number; straight: number; band: number; nitro: number }> = {
  easy: { pace: 0.86, straight: 0.9, band: 0.06, nitro: 0.5 },
  normal: { pace: 0.94, straight: 0.965, band: 0.07, nitro: 0.8 },
  hard: { pace: 1.0, straight: 1.0, band: 0.05, nitro: 1.0 },
};

type Mistake = 'none' | 'wide' | 'overshoot' | 'lift' | 'longdrift';

export interface AIRaceView {
  /** Total race distance of the player (laps*L + s). */
  playerDistance: number;
  /** This racer's total race distance. */
  myDistance: number;
  lap: number;
  totalLaps: number;
  racing: boolean;
  /** Other boats for avoidance. */
  others: readonly Boat[];
  /** Moving obstacles to steer around (fishing boats, mines, oil). */
  obstacles?: readonly { x: number; z: number; r: number }[];
  /** Battle: a point the driver wants to reach (item box, rival). */
  seek?: { x: number; z: number } | null;
  /** Open water (battle arena): steer straight at `seek` instead of along the course. */
  free?: boolean;
}

const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
const _sp = { x: 0, z: 0, tx: 0, tz: 1 };
const _proj: Projection = { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 };
const _rp: Projection = { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 };

export class AIDriver {
  readonly p: Personality;
  private rng: Rng;
  private hint = -1;
  private seed: number;
  private mistake: Mistake = 'none';
  private mistakeT = 0;
  private nextMistakeIn: number;
  private cornerDecided = -1;
  private wantDrift = false;
  private lastDrift = false;
  /** Time the line has wanted a hard counter-steer during the current drift. */
  private counterT = 0;
  private driftTargetTier = 1;
  private shortcut = -1;
  private shortcutDecidedFor = -1;
  private rampTarget = -1;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private band = 1;
  private trickPlanned = false;
  /** Wave flips: decided once per qualifying jump. */
  private waveDecided = false;
  private wavePlanned = false;
  private boosting = false;
  private t = 0;

  constructor(style: Style, private difficulty: Difficulty, seed: number) {
    this.p = PERSONALITIES[style];
    this.rng = new Rng(seed);
    this.seed = seed;
    this.nextMistakeIn = this.rollMistakeGap();
  }

  private rollMistakeGap() {
    return (60 / Math.max(0.05, this.p.mistakes)) * this.rng.range(0.5, 1.5);
  }

  reset() {
    this.hint = -1;
    this.mistake = 'none';
    this.shortcut = -1;
    this.stuckT = 0;
    this.reverseT = 0;
    this.wantDrift = false;
  }

  update(boat: Boat, c: Controls, track: Track, view: AIRaceView, dt: number) {
    this.t += dt;
    const d = DIFF[this.difficulty];
    const p = this.p;
    const pos = boat.position;
    const speed = boat.forwardSpeed;

    track.project(pos.x, pos.z, this.hint, _proj);
    this.hint = _proj.index;
    const s = _proj.s;

    // ── Rubber band (gentle, damped, capped) ──────────────────────────────────
    const gap = view.playerDistance - view.myDistance; // + = AI is behind
    const bandTarget = 1 + clamp(gap / 250, -0.7, 1) * d.band;
    this.band = damp(this.band, bandTarget, 0.5, dt);

    // ── Mistake scheduler ─────────────────────────────────────────────────────
    if (view.racing) {
      if (this.mistake !== 'none') {
        this.mistakeT -= dt;
        if (this.mistakeT <= 0) this.mistake = 'none';
      } else {
        this.nextMistakeIn -= dt;
        if (this.nextMistakeIn <= 0) {
          this.nextMistakeIn = this.rollMistakeGap();
          const r = this.rng.next();
          this.mistake = r < 0.35 ? 'wide' : r < 0.6 ? 'overshoot' : r < 0.82 ? 'lift' : 'longdrift';
          this.mistakeT = this.mistake === 'lift' ? 0.7 : 2.2;
        }
      }
    }

    // ── Shortcut decision, once per approach ─────────────────────────────────
    for (let i = 0; i < track.shortcuts.length; i++) {
      const sc = track.shortcuts[i];
      const toEntry = track.wrapS(sc.s1 - s);
      if (toEntry < 160 && toEntry > 20 && this.shortcutDecidedFor !== i) {
        this.shortcutDecidedFor = i;
        const behind = gap < -30 ? 0.15 : 0; // trailing drivers gamble more
        this.shortcut = this.rng.next() < p.shortcutChance + behind ? i : -1;
      }
    }
    if (this.shortcut >= 0) {
      const sc = track.shortcuts[this.shortcut];
      const past = track.wrapS(s - sc.s2);
      if (past < track.length * 0.5 && past > 5 && _proj.shortcut < 0) this.shortcut = -1;
    }

    // ── Aim point ────────────────────────────────────────────────────────────
    const look = 10 + Math.max(0, speed) * 0.55;
    let ax = 0;
    let az = 0;
    let usingShortcut = false;
    if (this.shortcut >= 0) {
      const sc = track.shortcuts[this.shortcut];
      const toEntry = track.wrapS(sc.s1 - s);
      const onIt = _proj.shortcut === this.shortcut;
      if (onIt || toEntry < look + 10) {
        // Steer into / along the channel.
        const l = onIt ? projectOnShortcut(sc, pos.x, pos.z).l + look : Math.max(0, look - toEntry);
        if (l < sc.length) {
          shortcutPoint(sc, l, _sp);
          ax = _sp.x;
          az = _sp.z;
          usingShortcut = true;
        }
      }
    }
    // Ramp seeking.
    if (!usingShortcut) {
      this.rampTarget = -1;
      for (let i = 0; i < track.ramps.length; i++) {
        const r = track.ramps[i];
        const dx = r.x - pos.x;
        const dz = r.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const ahead = dx * Math.sin(boat.heading) + dz * Math.cos(boat.heading);
        if (dist < 110 && ahead > 8) {
          // Deterministic per-driver-per-ramp choice.
          const pick = noise1(i * 31.7, this.seed) * 0.5 + 0.5;
          if (pick < p.rampChance) this.rampTarget = i;
        }
      }
    }

    track.sample(s + look, _tp);
    let lateral = track.lineAt(s + look) + p.lane + noise1(this.t * 0.15, this.seed) * p.wander;
    if (this.mistake === 'wide') lateral += -Math.sign(track.curvAt(s + look) || 1) * 9;
    if (this.rampTarget >= 0) {
      const r = track.ramps[this.rampTarget];
      // Lateral of the ramp relative to the centreline at its position.
      const rp = track.project(r.x, r.z, track.indexAt(s + look), _rp);
      lateral = rp.lateral;
    }

    // Battle on a course: drift across the lane toward a box / rival ahead.
    const fx = Math.sin(boat.heading);
    const fz = Math.cos(boat.heading);
    const seek = view.seek;
    if (seek && !view.free && !usingShortcut) {
      const dx = seek.x - pos.x;
      const dz = seek.z - pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead > 8 && ahead < 90) lateral = track.project(seek.x, seek.z, track.indexAt(s + Math.min(ahead, look)), _rp).lateral;
    }

    // Traffic avoidance.
    let avoid = 0;
    let speedCap = Infinity;
    for (const o of view.others) {
      if (o === boat) continue;
      const dx = o.position.x - pos.x;
      const dz = o.position.z - pos.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      if (ahead > -3 && ahead < 22 && Math.abs(side) < 5.5) {
        const push = (5.5 - Math.abs(side)) * (1 - p.aggression * 0.7);
        avoid += side > 0 ? -push : push;
        if (ahead > 0 && ahead < 10 && Math.abs(side) < 2.8 && p.aggression < 0.6) speedCap = Math.min(speedCap, o.forwardSpeed + 2);
      }
    }
    if (view.obstacles) {
      for (const o of view.obstacles) {
        const dx = o.x - pos.x;
        const dz = o.z - pos.z;
        const ahead = dx * fx + dz * fz;
        const side = dx * -fz + dz * fx;
        const w = o.r + 3;
        if (ahead > -2 && ahead < 40 && Math.abs(side) < w) avoid += (side > 0 ? -1 : 1) * (w - Math.abs(side)) * 1.4;
      }
    }
    lateral += clamp(avoid, -12, 12);
    lateral = clamp(lateral, -track.width * 0.46, track.width * 0.46);

    if (!usingShortcut) {
      ax = _tp.x - _tp.tz * lateral;
      az = _tp.z + _tp.tx * lateral;
    }
    if (seek && view.free) {
      // Open water: head straight for the target, sidestepping whatever is in the way.
      const dodge = clamp(avoid, -12, 12);
      ax = seek.x - fz * dodge;
      az = seek.z + fx * dodge;
    }

    // ── Steering ──────────────────────────────────────────────────────────────
    const desired = Math.atan2(ax - pos.x, az - pos.z);
    // While sliding, the hull is deliberately offset: steer the path, not the nose.
    const ref = boat.drifting && boat.speed > 3 ? Math.atan2(boat.velocity.x, boat.velocity.z) : boat.heading;
    const err = angleDelta(ref, desired);
    let steer: number;
    if (boat.drifting) {
      // Kart drift: pick the radius the corner needs (feed-forward from the
      // course curvature ahead), then correct for heading error.
      const need = Math.abs(speed * track.curvAt(s + speed * 0.35));
      const lo = driftTurnRate(boat.spec, -1);
      const hi = driftTurnRate(boat.spec, 1);
      const ff = ((need - lo) / Math.max(1e-3, hi - lo)) * 2 - 1;
      steer = clamp(ff - err * 2.6 * boat.driftDir, -1, 1) * boat.driftDir;
    } else steer = clamp(-err * 2.4 + boat.yawRate * 0.22, -1, 1);

    // ── Speed ─────────────────────────────────────────────────────────────────
    const boatScale = 0.55 + 0.45 * (boat.spec.turnRate / 1.75);
    let corner = Infinity;
    for (let o = 0; o <= 60; o += 10) corner = Math.min(corner, track.speedAt(s + o + speed * 0.3));
    let pace = p.pace * d.pace * this.band;
    if (this.mistake === 'overshoot') pace *= 1.18;
    let target = Math.min(corner * pace * boatScale * Math.min(1.15, TUNE.aiPower), boat.spec.topSpeed * TUNE.speed * TUNE.aiPower * boat.powerScale * d.straight * this.band);
    if (usingShortcut) target = Math.min(target, boat.spec.topSpeed * 0.92);
    target = Math.min(target, speedCap);
    // Big heading error = slow down to make the turn.
    if (Math.abs(err) > 0.6) target = Math.min(target, 14);

    let throttle = speed < target + 0.5 ? 1 : speed < target + 3 ? 0.4 : 0;
    let brake = speed > target + 5 ? clamp01((speed - target - 5) / 6) : 0;
    if (this.mistake === 'lift') {
      throttle = 0;
      brake = 0;
    }

    // ── Drift: decide per corner ──────────────────────────────────────────────
    let kAhead = 0;
    for (let o = 5; o <= 45; o += 5) kAhead = Math.max(kAhead, Math.abs(track.curvAt(s + o)));
    const cornerId = Math.floor(s / 60);
    if (kAhead > 0.0085 && speed > 15 && this.cornerDecided !== cornerId && !boat.drifting) {
      this.cornerDecided = cornerId;
      this.wantDrift = this.rng.next() < p.driftSkill;
      this.driftTargetTier = Math.max(1, Math.min(3, Math.round(p.driftGreed + this.rng.range(-0.6, 0.6))));
    }
    let drift = false;
    if (this.wantDrift) {
      const kNow = Math.abs(track.curvAt(s + 8));
      if (boat.drifting) {
        const reached = boat.driftCharge >= DRIFT_TIER_AT[this.driftTargetTier - 1];
        const overHold = this.mistake === 'longdrift';
        drift = !(kNow < 0.004 && (reached || boat.driftCharge >= DRIFT_TIER_AT[0] || kNow < 0.0015)) || (overHold && boat.driftTime < 3.2);
        if (Math.abs(err) > 0.9) drift = false;
        // A kart-style drift can't straighten out: if the line wants a hard
        // counter-steer, the corner is over — cash in instead of fighting it.
        this.counterT = steer * boat.driftDir < -0.95 ? this.counterT + dt : Math.max(0, this.counterT - dt * 2);
        if (this.counterT > 0.25 && boat.driftTime > 0.35) drift = false;
        if (!drift) this.wantDrift = false;
      } else if (kNow > 0.0075 && Math.abs(steer) > 0.3) {
        // Drifts start from a hop: if the last press didn't catch, let go for a
        // frame so the next one is a fresh press.
        drift = !(this.lastDrift && boat.driftWindow <= 0);
      }
    }

    // ── Nitro strategy ────────────────────────────────────────────────────────
    const straightAhead = kAhead < 0.004;
    if (this.boosting) {
      // Committed: burn until empty or a corner arrives.
      if (boat.nitro <= 0.01 || kAhead > 0.008 || Math.abs(err) > 0.35 || !view.racing) this.boosting = false;
    } else if (boat.nitro > 0.2 && straightAhead && Math.abs(err) < 0.2 && view.racing && this.rng.next() < d.nitro * dt * 3) {
      const finalLap = view.lap >= view.totalLaps;
      switch (p.style) {
        case 'technical':
          this.boosting = finalLap || boat.nitro > 0.85;
          break;
        case 'speed':
          this.boosting = true;
          break;
        case 'aggressive':
          this.boosting = gap < 40 || boat.nitro > 0.6;
          break;
        default:
          this.boosting = boat.nitro > 0.5 || finalLap;
      }
    }
    let boost = this.boosting;

    // ── Air tricks ────────────────────────────────────────────────────────────
    let pitch = 0;
    let roll = false;
    if (boat.airborne) {
      if (boat.airTime < 0.15) this.trickPlanned = this.rng.next() < p.stunt && boat.velocity.y > 2.5;
      // Occasionally flip off a natural wave crest (a light trick with a small boost).
      if (boat.waveTrickReady && !this.waveDecided) {
        this.waveDecided = true;
        this.wavePlanned = this.rng.next() < 0.15 + 0.5 * p.stunt;
      }
    } else this.waveDecided = this.wavePlanned = false;
    if (boat.airborne) {
      if (this.wavePlanned && boat.waveTrickReady && !this.lastDrift) {
        drift = true;
        this.wavePlanned = false;
      } else if (this.trickPlanned && boat.trick === 'none' && boat.clearance > 1.4 && boat.velocity.y > 0) {
        drift = true;
        steer = this.seed % 2 ? 1 : -1;
        this.trickPlanned = false;
      } else if (boat.trick === 'none') {
        drift = false;
        // Level out for landing.
        pitch = clamp(boat.pitch * 2, -1, 1);
      }
    }

    // ── Stuck recovery ────────────────────────────────────────────────────────
    if (view.racing && boat.wipeout <= 0) {
      if (this.reverseT > 0) {
        this.reverseT -= dt;
        throttle = 0;
        brake = 1;
        steer = this.reverseSteer;
        drift = false;
        boost = false;
      } else if (Math.abs(speed) < 2.5 && boat.holdTime <= 0) {
        this.stuckT += dt;
        if (this.stuckT > 1.4) {
          this.stuckT = 0;
          this.reverseT = 1.1;
          this.reverseSteer = err > 0 ? 1 : -1;
        }
      } else this.stuckT = 0;
    }

    c.throttle = throttle;
    c.brake = brake;
    c.steer = steer;
    c.drift = drift;
    this.lastDrift = drift;
    c.boost = boost;
    c.pitch = pitch;
    c.roll = roll;
  }
}
