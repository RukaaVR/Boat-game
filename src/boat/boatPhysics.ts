/**
 * Arcade watercraft physics.
 *
 * ── Shape of the model ───────────────────────────────────────────────────────
 * Horizontal motion is solved in the hull frame (surge `u` along the nose, sway
 * `w` to the right) and written back to world velocity. Lateral grip bleeds
 * sway away; when carving, most of the bled energy is handed back to surge so a
 * clean line keeps its speed — that is the "arcade" part. Drift lowers the grip
 * and swaps the yaw law, so the hull genuinely slides.
 *
 * Vertical motion is probe buoyancy: six probes on the hull bottom each read
 * their own depth below the shared wave field (water/waves.ts), producing one
 * heave force and two torques. Pitch and roll are second-order channels with
 * their own rates, so the hull pitches over crests, slams into troughs and
 * leaves the water when a crest falls away faster than gravity can follow.
 * Nothing scripts a wave jump.
 *
 * Ramps are rigid inclined planes; leaving the lip hands the hull an honest
 * vertical velocity of `speed × slope`.
 *
 * Every function is allocation-free: scratch vectors live at module scope.
 */

import { Euler, Quaternion, Vector3 } from 'three';
import { clamp, clamp01, damp, smoothstep, wrapAngle } from '../core/mathx';
import type { EventQueue } from '../core/events';
import type { BoostPad, Controls, Ramp } from '../core/types';
import { makeSample, oceanHeight, sampleOcean } from '../water/waves';
import { Boat, TRICK_NAMES, type TrickKind } from './boat';

const G = 9.81;
const BUOYANCY = 58; // m/s² per metre of mean probe depth
const MAX_DEPTH = 1.1;
const PROBE_Y = -0.22;
const PROBE_COUNT = 6;

/** Probe layout as fractions of (beam/2, length/2): [right, forward]. Σ = 0 both axes. */
const PROBE_LAYOUT: readonly [number, number][] = [
  [0, 0.92],
  [-0.85, 0.36],
  [0.85, 0.36],
  [-0.9, -0.6],
  [0.9, -0.6],
  [0, -0.48],
];

/**
 * Global live-tuning multipliers (admin panel). All 1 / false by default, so
 * the shipped handling is exactly the numbers in specs.ts.
 */
export const TUNE = {
  speed: 1,
  grip: 1,
  drift: 1,
  gravity: 1,
  buoyancy: 1,
  boost: 1,
  /** Power multiplier for every boat except the player (AI strength). */
  aiPower: 1,
  /** Player cheats. */
  infiniteNitro: false,
  godMode: false,
};

export function resetTune() {
  Object.assign(TUNE, { speed: 1, grip: 1, drift: 1, gravity: 1, buoyancy: 1, boost: 1, aiPower: 1, infiniteNitro: false, godMode: false });
}

export interface PhysicsEnv {
  time: number;
  ramps: readonly Ramp[];
  pads: readonly BoostPad[];
  events: EventQueue;
}

/** Per-boat integrator scratch that is not part of the public state. */
interface Internal {
  prevSurfaceY: number;
  outTime: number;
  vyAtContact: number;
  trickArmed: boolean;
  prevRoll: boolean;
  prevDrift: boolean;
  padCooldown: number;
  fromRamp: boolean;
  initialised: boolean;
}
const internals = new WeakMap<Boat, Internal>();
function internal(b: Boat): Internal {
  let g = internals.get(b);
  if (!g) {
    g = { prevSurfaceY: 0, outTime: 0, vyAtContact: 0, trickArmed: false, prevRoll: false, prevDrift: false, padCooldown: 0, fromRamp: false, initialised: false };
    internals.set(b, g);
  }
  return g;
}

/** Re-seat a boat on the water (after `place`). */
export function settleBoat(b: Boat, t: number) {
  const g = internal(b);
  const h = oceanHeight(b.position.x, b.position.z, t);
  b.position.y = h - PROBE_Y - 0.16;
  b.surfaceY = h;
  g.prevSurfaceY = h;
  g.outTime = 0;
  g.initialised = true;
  b.velocity.y = 0;
}

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _v = new Vector3();
const _sample = makeSample();
const _depths = new Float32Array(PROBE_COUNT);

export function orientation(b: Boat, out: Quaternion) {
  _e.set(-b.pitch, b.heading, b.roll, 'YXZ');
  return out.setFromEuler(_e);
}

/** Drift mini-turbo per tier: [duration s, strength]. */
const TIER_BOOST: readonly [number, number][] = [
  [0, 0],
  [0.65, 0.6],
  [1.15, 0.82],
  [1.85, 1.0],
];
export const DRIFT_TIER_AT = [0.9, 1.9, 3.0];
/** Length of the drift hop (s) and how long after it a direction can be picked. */
export const HOP_TIME = 0.3;
const DRIFT_PICK = 0.32;
/** Drift path turn rate (rad/s) for a spec at a given into-the-turn input (-1 wide … +1 tight). */
export function driftTurnRate(spec: { turnRate: number; driftYaw: number }, into: number) {
  return spec.turnRate * spec.driftYaw * TUNE.drift * 0.7 * (0.15 + 0.85 * (into + 1) * 0.5);
}

const TRICK_VALUE: Record<TrickKind, number> = { none: 0, frontflip: 600, backflip: 600, spin: 400, roll: 500 };

function startWipeout(b: Boat, id: number, env: PhysicsEnv) {
  if (b.wipeout > 0) return;
  if (id === 0 && TUNE.godMode) {
    // Admin god mode: shrug it off and right the hull.
    b.pitch *= 0.3;
    b.roll *= 0.3;
    b.pitchRate = b.rollRate = 0;
    b.trick = 'none';
    b.trickT = 0;
    b.visPitch = b.visYaw = b.visRoll = 0;
    return;
  }
  b.wipeout = 1.5;
  b.drifting = false;
  b.driftCharge = 0;
  b.driftTier = 0;
  b.trick = 'none';
  b.trickT = 0;
  b.boostTime = 0;
  b.nitroActive = false;
  b.jumpScore = 0;
  b.tricksThisJump = 0;
  env.events.push('wipeout', id, b.position.x, b.position.y, b.position.z, 1);
}

export function stepBoat(b: Boat, c: Controls, env: PhysicsEnv, id: number, dt: number) {
  if (dt <= 0) return;
  const s = b.spec;
  const g = internal(b);
  const pos = b.position;
  const t = env.time;
  if (!g.initialised) settleBoat(b, t);

  b.hitCooldown = Math.max(0, b.hitCooldown - dt);
  b.splashCooldown = Math.max(0, b.splashCooldown - dt);
  g.padCooldown = Math.max(0, g.padCooldown - dt);
  b.ghostTime = Math.max(0, b.ghostTime - dt);
  b.sinceLand += dt;
  b.impact = Math.max(0, b.impact - dt * 2.5);
  if (id === 0 && TUNE.infiniteNitro) b.nitro = 1;
  b.shield = Math.max(0, b.shield - dt);

  // ── Effective controls (wipeout and penalty hold take them away) ───────────
  const locked = b.wipeout > 0 || b.holdTime > 0;
  b.holdTime = Math.max(0, b.holdTime - dt);
  const throttle = locked ? 0 : clamp01(c.throttle);
  const brake = locked ? 0 : clamp01(c.brake);
  const steer = locked ? 0 : clamp(c.steer, -1, 1);

  // ── Buoyancy probes ──────────────────────────────────────────────────────
  orientation(b, _q);
  const hl = s.length * 0.5;
  const hb = s.beam * 0.5;
  let sumDepth = 0;
  let pitchT = 0;
  let rollT = 0;
  let wetCount = 0;
  let minClear = Infinity;
  for (let i = 0; i < PROBE_COUNT; i++) {
    const [rf, ff] = PROBE_LAYOUT[i];
    _v.set(-rf * hb, PROBE_Y, ff * hl).applyQuaternion(_q).add(pos);
    const h = oceanHeight(_v.x, _v.z, t);
    const d = h - _v.y;
    _depths[i] = d;
    if (d > 0) {
      const dd = Math.min(d, MAX_DEPTH);
      wetCount++;
      sumDepth += dd;
      pitchT += dd * ff;
      rollT += dd * rf;
    } else if (-d < minClear) minClear = -d;
  }
  sampleOcean(pos.x, pos.z, t, _sample);
  const surfaceY = _sample.height;
  b.surfaceY = surfaceY;
  const pathVy = clamp((surfaceY - g.prevSurfaceY) / dt, -20, 20);
  g.prevSurfaceY = surfaceY;
  const wet = wetCount / PROBE_COUNT;
  b.wet = wet;
  b.clearance = wetCount > 0 ? 0 : minClear;

  // ── Ramps ────────────────────────────────────────────────────────────────
  b.onRamp = false;
  for (let i = 0; i < env.ramps.length; i++) {
    const r = env.ramps[i];
    const sh = Math.sin(r.heading);
    const ch = Math.cos(r.heading);
    const dx = pos.x - r.x;
    const dz = pos.z - r.z;
    const along = dx * sh + dz * ch;
    const across = dx * ch - dz * sh;
    if (along < 0 || along > r.length || Math.abs(across) > r.width * 0.5 + 0.3) continue;
    const vAlong = b.velocity.x * sh + b.velocity.z * ch;
    if (vAlong < 3) continue;
    const slope = r.height / r.length;
    const rampY = -0.5 + along * slope + 0.12;
    const bottom = pos.y + PROBE_Y;
    if (bottom > rampY + 0.45) continue;
    b.onRamp = true;
    g.fromRamp = true;
    pos.y = rampY - PROBE_Y;
    b.velocity.y = vAlong * slope;
    b.pitch = damp(b.pitch, Math.atan(slope), 18, dt);
    b.pitchRate = 0;
    b.roll = damp(b.roll, 0, 12, dt);
    b.rollRate = 0;
    if (b.airborne) {
      b.airborne = false;
      b.airTime = 0;
    }
    g.outTime = 0;
    break;
  }

  // ── Boost pads ───────────────────────────────────────────────────────────
  if (g.padCooldown <= 0) {
    for (let i = 0; i < env.pads.length; i++) {
      const p = env.pads[i];
      const sh = Math.sin(p.heading);
      const ch = Math.cos(p.heading);
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const along = dx * sh + dz * ch;
      const across = dx * ch - dz * sh;
      if (Math.abs(along) < p.length * 0.5 && Math.abs(across) < p.width * 0.5 && pos.y < surfaceY + 2.5) {
        b.boostTime = Math.max(b.boostTime, 1.1 * s.boostPower);
        b.boostStrength = Math.max(b.boostStrength, 0.9);
        b.nitro = Math.min(1, b.nitro + 0.06);
        g.padCooldown = 0.8;
        env.events.push('boostPad', id, pos.x, pos.y, pos.z, 1);
        break;
      }
    }
  }

  // ── Air / contact state machine ─────────────────────────────────────────
  const inWater = wetCount > 0 || b.onRamp;
  const vyBefore = b.velocity.y;
  if (!inWater) {
    g.outTime += dt;
    if (!b.airborne && g.outTime > 0.14 && b.clearance > 0.3) {
      b.airborne = true;
      b.airTime = g.outTime;
      b.airPeak = b.clearance;
      b.tricksThisJump = 0;
      b.jumpScore = 0;
      g.trickArmed = !c.drift;
      if (b.forwardSpeed > 14) env.events.push('launch', id, pos.x, pos.y, pos.z, clamp01(b.velocity.y / 8));
      // A ramp launch ends the slide (keeping what was earned); skipping off a
      // wave crest does not — the drift carries through small hops.
      if (b.drifting && g.fromRamp) releaseDrift(b, id, env);
    }
    if (b.airborne) {
      b.airTime += dt;
      b.airPeak = Math.max(b.airPeak, b.clearance);
      if (b.drifting && b.airTime > 0.7) releaseDrift(b, id, env);
    }
  } else {
    g.outTime = 0;
    if (wetCount > 0) g.fromRamp = false;
    if (b.airborne) {
      g.vyAtContact = vyBefore;
      land(b, id, env, g.vyAtContact);
    }
    b.airborne = false;
  }

  // ── Vertical integration ────────────────────────────────────────────────
  if (!b.onRamp) {
    let ay = -G * TUNE.gravity;
    if (wetCount > 0) {
      ay += (BUOYANCY * TUNE.buoyancy * sumDepth) / PROBE_COUNT;
      // Damp heave relative to the surface the hull is riding along.
      ay -= (3.2 + 2.4 * s.stability) * (b.velocity.y - pathVy) * wet;
    } else {
      ay -= b.velocity.y * 0.05;
      // Hull suction: a planing hull skims small crests instead of hopping.
      // Ramps and genuine swell launches (fast climb) are exempt.
      if (!g.fromRamp && b.clearance < 1.2 && b.velocity.y < 5) ay -= 13 * (1 - b.clearance / 1.2);
    }
    b.velocity.y += ay * dt;
    // Never let the hull be shot out of the water faster than the wave face could carry it.
    if (wetCount > 0) b.velocity.y = Math.min(b.velocity.y, Math.max(pathVy, 0) * 0.8 + 1.2);
    pos.y += b.velocity.y * dt;
    // Hard floor: a hull cannot submarine.
    if (pos.y < surfaceY - 0.9) {
      pos.y = surfaceY - 0.9;
      if (b.velocity.y < 0) b.velocity.y = 0;
    }
  }

  // ── Hull-frame planar dynamics ──────────────────────────────────────────
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const rx = -fz;
  const rz = fx;
  let u = b.velocity.x * fx + b.velocity.z * fz;
  let w = b.velocity.x * rx + b.velocity.z * rz;

  const wantEngine = throttle;
  b.engine = damp(b.engine, wantEngine, wantEngine > b.engine ? 3.2 : 5, dt);
  const bite = b.airborne ? 0 : b.onRamp ? 0.6 : 0.3 + 0.7 * clamp01(wet * 1.4);

  // Boost bookkeeping.
  if (b.boostTime > 0) {
    b.boostTime -= dt;
    if (b.boostTime <= 0) {
      b.boostTime = 0;
      b.boostStrength = 0;
    }
  }
  if (!locked && c.boost && (b.nitroActive ? b.nitro > 0 : b.nitro > 0.12)) {
    if (!b.nitroActive) env.events.push('nitro', id, pos.x, pos.y, pos.z, 1);
    b.nitroActive = true;
    b.nitro = Math.max(0, b.nitro - 0.3 * dt);
  } else b.nitroActive = false;
  const boostRaw = Math.max(b.boostTime > 0 ? b.boostStrength : 0, b.nitroActive ? 1 : 0);
  b.boostLevel = damp(b.boostLevel, boostRaw, boostRaw > b.boostLevel ? 10 : 3, dt);

  const power = TUNE.speed * (id === 0 ? 1 : TUNE.aiPower) * b.powerScale;
  const T = s.thrust * power;
  const top = s.topSpeed * power;
  const k1 = (0.12 * T) / top;
  const k2 = (0.88 * T) / (top * top);
  const bt = s.boostTopSpeed * power;
  const boostThrust = (k1 * bt + k2 * bt * bt - T) * s.boostPower * TUNE.boost;
  // Drafting adds a little free thrust.
  const draftThrust = b.draft * 1.6;

  // During a drift the hull is turned away from its path, so thrust and drag
  // act on the path speed rather than on the hull-axis speed.
  const driftNow = b.drifting && !b.airborne;
  const vSpd = Math.hypot(b.velocity.x, b.velocity.z);
  const sv = driftNow ? vSpd : u;
  let au = T * b.engine * bite;
  au += boostThrust * boostRaw * (b.airborne ? 0.25 : Math.max(bite, 0.5));
  au += draftThrust * bite;
  const dragScale = b.airborne ? 0.12 : 0.55 + 0.45 * wet;
  au -= (k1 * sv + k2 * sv * Math.abs(sv)) * dragScale;
  if (!b.airborne) {
    if (brake > 0) {
      if (sv > 0.5) au -= 15 * brake;
      else if (sv > -7) au -= 6 * brake;
    }
    if (throttle < 0.05 && brake < 0.05) au -= Math.sign(sv) * Math.min(Math.abs(sv) * 0.35, 1.2);
    // Bow ploughing into the water costs speed — the slam.
    if (b.pitch < -0.12 && wet > 0.5) au -= (-b.pitch - 0.12) * 22 * clamp01(sv / 10);
  }
  if (b.wipeout > 0) au -= sv * 2.2;

  if (driftNow) {
    // ── Kart-style drift: the direction is locked for the whole slide; steering
    // only sets the radius, from a wide arc (counter-steer) to a tight one (into
    // the turn) — it never straightens out. The hull swings out and holds an
    // angle into the corner, and the slide keeps nearly all its speed.
    const into = steer * b.driftDir; // -1 counter-steer … +1 full into the turn
    b.driftSteer = damp(b.driftSteer, into, 7, dt);
    const entry = 0.6 + 0.4 * smoothstep(0, 0.2, b.driftTime);
    const omega = -b.driftDir * driftTurnRate(s, b.driftSteer) * entry;
    let phi = Math.atan2(b.velocity.x, b.velocity.z) + omega * dt;
    const spd = Math.max(0, vSpd + au * dt - vSpd * 0.04 * dt);
    b.velocity.x = Math.sin(phi) * spd;
    b.velocity.z = Math.cos(phi) * spd;
    const slide = 0.6 * (s.driftYaw / 1.35) * (0.7 + 0.3 * (b.driftSteer + 1) * 0.5);
    const target = phi - b.driftDir * slide;
    const prev = b.heading;
    // Snap out fast on entry, then hold steady.
    const follow = b.driftTime < 0.25 ? 14 : 8;
    b.heading = wrapAngle(b.heading + wrapAngle(target - b.heading) * (1 - Math.exp(-follow * dt)));
    b.yawRate = wrapAngle(b.heading - prev) / dt;
    phi = b.heading;
    const nfx = Math.sin(phi);
    const nfz = Math.cos(phi);
    u = b.velocity.x * nfx + b.velocity.z * nfz;
    w = b.velocity.x * -nfz + b.velocity.z * nfx;
  } else {
    u += au * dt;
    u = clamp(u, -9, bt * 1.2);
    // Lateral grip; when carving most of the bled energy returns to surge.
    const grip = b.airborne ? 0.25 : s.grip * TUNE.grip * (0.6 + 0.4 * wet);
    const dw = w * (1 - Math.exp(-grip * dt));
    w -= dw;
    if (!b.airborne) u += Math.abs(dw) * 0.6 * Math.sign(u || 1);
    b.velocity.x = fx * u + rx * w;
    b.velocity.z = fz * u + rz * w;
  }
  pos.x += b.velocity.x * dt;
  pos.z += b.velocity.z * dt;
  b.forwardSpeed = u;
  b.lateralSpeed = w;
  const slipNow = Math.abs(u) > 2 ? Math.atan2(w, Math.abs(u)) : 0;
  b.slip = damp(b.slip, slipNow, 8, dt);

  // ── Drift ───────────────────────────────────────────────────────────────
  // Press drift → a little hop; steer during the hop (or land a jump holding
  // drift) to start sliding that way. Holding the button without a fresh hop
  // does nothing, so drifts are always a deliberate input.
  const canDrift = !b.airborne && u > 9 && b.wipeout <= 0 && !locked;
  const pressed = c.drift && !g.prevDrift;
  g.prevDrift = c.drift;
  b.hop = Math.max(0, b.hop - dt);
  b.driftWindow = Math.max(0, b.driftWindow - dt);
  if (pressed && !b.airborne && !b.drifting && b.wipeout <= 0 && !locked) {
    b.hop = HOP_TIME;
    b.driftWindow = DRIFT_PICK;
    env.events.push('splash', id, pos.x, b.surfaceY, pos.z, 0.18);
  }
  if (!b.drifting && canDrift && c.drift && b.driftWindow > 0 && Math.abs(steer) > 0.3) {
    b.drifting = true;
    b.driftDir = Math.sign(steer);
    b.driftCharge = 0;
    b.driftTier = 0;
    b.driftTime = 0;
    b.driftSteer = 0;
    b.driftWindow = 0;
  }
  if (b.drifting) {
    if (!c.drift || locked) releaseDrift(b, id, env);
    else if (u < 6) {
      b.drifting = false;
      b.driftCharge = 0;
      b.driftTier = 0;
    } else {
      b.driftTime += dt;
      // Sparks charge faster the tighter you hold the line; they pause while a
      // wave skip has the hull out of the water.
      if (!b.airborne) {
        const into = clamp01((b.driftSteer + 1) * 0.5);
        b.driftCharge += dt * s.driftCharge * (0.75 + 0.4 * into) * (0.35 + 0.65 * smoothstep(6, 18, u));
        b.nitro = Math.min(1, b.nitro + dt * 0.045 * s.driftCharge);
        while (b.driftTier < 3 && b.driftCharge >= DRIFT_TIER_AT[b.driftTier]) {
          b.driftTier++;
          env.events.push('driftTier', id, pos.x, pos.y, pos.z, b.driftTier);
        }
      }
    }
  }

  // ── Yaw ──────────────────────────────────────────────────────────────────
  if (b.airborne) {
    // A drift carried over a wave skip holds its angle in the air.
    const target = b.drifting ? 0 : -steer * 0.75 * (0.4 + 0.6 * s.air);
    b.yawRate = damp(b.yawRate, b.trick === 'spin' ? 0 : target, b.drifting ? 8 : 3, dt);
  } else if (b.wipeout > 0) {
    b.yawRate = damp(b.yawRate, 0, 2.5, dt);
  } else if (b.drifting) {
    // Heading is driven by the drift model above.
  } else {
    const au_ = Math.abs(u);
    const low = smoothstep(0, 7, au_);
    const high = 1 - 0.32 * smoothstep(top * 0.5, top * 1.25, au_);
    const dirSign = u < -0.5 ? -1 : 1;
    const target = -steer * s.turnRate * (0.22 + 0.78 * low) * high * dirSign;
    b.yawRate = damp(b.yawRate, target, s.yawResponse * (0.4 + 0.6 * wet), dt);
  }
  if (!b.drifting || b.airborne) b.heading = wrapAngle(b.heading + b.yawRate * dt);

  // ── Pitch & roll ────────────────────────────────────────────────────────
  const stab = s.stability;
  if (b.onRamp) {
    // handled above
  } else if (!b.airborne && wetCount > 0) {
    const n = PROBE_COUNT;
    const planing = 0.06 * smoothstep(6, top, u) + 0.05 * b.engine * (1 - smoothstep(0, 16, u));
    const pitchAcc = (34 * pitchT) / n - (2.6 + 3.2 * stab) * b.pitchRate + (planing - b.pitch) * 6 * wet;
    b.pitchRate += pitchAcc * dt;
    const lean = steer * (0.12 + 0.12 * smoothstep(6, top, u)) + (b.drifting ? b.driftDir * 0.18 : 0);
    const rollAcc = (-40 * rollT) / n - (3 + 4 * stab) * b.rollRate + (lean - b.roll) * (7 + 6 * stab);
    b.rollRate += rollAcc * dt;
  } else {
    // Airborne: ballistic attitude with player trim.
    const air = s.air;
    const ballistic = Math.atan2(b.velocity.y, Math.max(6, Math.abs(u))) * 0.55;
    const pitchInput = locked ? 0 : -c.pitch;
    if (Math.abs(pitchInput) > 0.1) b.pitchRate = damp(b.pitchRate, pitchInput * (1.4 + 1.6 * air), 6, dt);
    else b.pitchRate = damp(b.pitchRate, (ballistic - b.pitch) * 1.6, 2.5, dt);
    b.rollRate = damp(b.rollRate, (steer * 0.25 - b.roll) * 2.2, 3, dt);
  }
  if (b.wipeout > 0) {
    b.wipeout -= dt;
    // Thrash, then right itself in the last half second.
    const settle = smoothstep(0.7, 0.0, b.wipeout);
    b.pitchRate = damp(b.pitchRate, 0, 3, dt);
    b.rollRate = damp(b.rollRate, 0, 3, dt);
    b.pitch = damp(b.pitch, 0, 1 + settle * 10, dt);
    b.roll = damp(b.roll, Math.sin(b.wipeout * 9) * 0.5 * (1 - settle), 4 + settle * 10, dt);
    if (b.wipeout <= 0) {
      b.wipeout = 0;
      b.ghostTime = 1.0;
    }
  }
  b.pitch += b.pitchRate * dt;
  b.roll += b.rollRate * dt;
  b.pitch = clamp(b.pitch, -1.25, 1.25);
  b.roll = clamp(b.roll, -1.45, 1.45);
  if (!b.airborne && b.wipeout <= 0 && (Math.abs(b.roll) > 1.2 || Math.abs(b.pitch) > 1.05)) startWipeout(b, id, env);

  // Bow slam into a wall of water.
  if (!b.airborne && u > 16 && _depths[0] > 0.8 && b.splashCooldown <= 0) {
    b.splashCooldown = 0.9;
    env.events.push('splash', id, pos.x + fx * hl, surfaceY, pos.z + fz * hl, clamp01((_depths[0] - 0.4) * 1.5));
  }

  // ── Tricks ──────────────────────────────────────────────────────────────
  if (b.airborne && b.wipeout <= 0) {
    if (!c.drift) g.trickArmed = true;
    const rollEdge = c.roll && !g.prevRoll;
    if (b.trick === 'none' && b.airTime > 0.12 && b.clearance > 0.7) {
      let kind: TrickKind = 'none';
      let dir = 1;
      if (rollEdge) {
        kind = 'roll';
        dir = steer < -0.2 ? -1 : 1;
      } else if (g.trickArmed && c.drift) {
        if (c.pitch > 0.5) kind = 'frontflip';
        else if (c.pitch < -0.5) kind = 'backflip';
        else if (Math.abs(steer) > 0.5) {
          kind = 'spin';
          dir = Math.sign(steer);
        }
      }
      if (kind !== 'none') {
        b.trick = kind;
        b.trickDir = dir;
        b.trickT = 0;
        b.trickDuration = (kind === 'spin' ? 0.62 : 0.82) - 0.22 * s.air;
        g.trickArmed = false;
      }
    }
  }
  g.prevRoll = c.roll;
  if (b.trick !== 'none') {
    b.trickT += dt / b.trickDuration;
    const p = clamp01(b.trickT);
    const e = p * p * (3 - 2 * p);
    const ang = e * Math.PI * 2;
    b.visPitch = b.trick === 'frontflip' ? -ang : b.trick === 'backflip' ? ang : 0;
    b.visYaw = b.trick === 'spin' ? -ang * b.trickDir : 0;
    b.visRoll = b.trick === 'roll' ? ang * b.trickDir : 0;
    if (b.trickT >= 1) completeTrick(b, id, env);
  } else {
    b.visPitch = b.visYaw = b.visRoll = 0;
  }

  // ── RPM for audio/visuals ───────────────────────────────────────────────
  const spd = clamp01(Math.abs(u) / top);
  const freeRev = b.airborne ? 0.35 : 0;
  b.rpm = damp(b.rpm, clamp01(0.18 + 0.5 * spd + 0.3 * b.engine + freeRev * b.engine + 0.15 * boostRaw), 6, dt);
}

function completeTrick(b: Boat, id: number, env: PhysicsEnv) {
  const kind = b.trick;
  b.tricksThisJump++;
  const value = TRICK_VALUE[kind] * (1 + 0.5 * (b.tricksThisJump - 1));
  b.jumpScore += value;
  b.nitro = Math.min(1, b.nitro + 0.16);
  env.events.push('trick', id, b.position.x, b.position.y, b.position.z, value, TRICK_NAMES[kind]);
  b.trick = 'none';
  b.trickT = 0;
  b.visPitch = b.visYaw = b.visRoll = 0;
}

function releaseDrift(b: Boat, id: number, env: PhysicsEnv) {
  const tier = b.driftTier;
  b.drifting = false;
  b.driftCharge = 0;
  b.driftTier = 0;
  if (tier > 0) {
    const [dur, str] = TIER_BOOST[tier];
    b.boostTime = Math.max(b.boostTime, dur * b.spec.boostPower);
    b.boostStrength = Math.max(b.boostStrength, str);
    env.events.push('boostStart', id, b.position.x, b.position.y, b.position.z, tier);
  }
}

function land(b: Boat, id: number, env: PhysicsEnv, vy: number) {
  const pos = b.position;
  // Landing a real jump with drift held and a direction picks up a slide
  // straight away (tiny wave skips don't count).
  if (b.airTime >= 0.3) b.driftWindow = DRIFT_PICK;
  const strength = clamp01(-vy / 13);
  b.sinceLand = 0;
  b.landStrength = strength;
  // Finishing a trick that is nearly done counts; anything less is a bail.
  if (b.trick !== 'none') {
    if (b.trickT > 0.8) completeTrick(b, id, env);
    else {
      startWipeout(b, id, env);
      return;
    }
  }
  const airTime = b.airTime;
  b.airTime = 0;
  if (airTime < 0.3) {
    if (strength > 0.25) env.events.push('splash', id, pos.x, b.surfaceY, pos.z, strength * 0.6);
    return;
  }
  // Grade the touchdown against the local surface and the course direction.
  const surfPitch = Math.asin(clamp(-(_sample.normal.x * Math.sin(b.heading) + _sample.normal.z * Math.cos(b.heading)), -1, 1));
  const pitchErr = Math.abs(b.pitch - surfPitch);
  const rollErr = Math.abs(b.roll);
  const slip = Math.abs(b.slip);
  const align = Math.sin(b.heading) * b.courseDir.x + Math.cos(b.heading) * b.courseDir.z;
  if (pitchErr > 1.0 || rollErr > 0.95) {
    startWipeout(b, id, env);
    return;
  }
  const clean = pitchErr < 0.32 && rollErr < 0.3 && slip < 0.4 && align > 0.75;
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  if (clean) {
    const big = clamp01((airTime - 0.4) / 1.4);
    b.boostTime = Math.max(b.boostTime, 0.5 + 0.6 * big + 0.25 * b.tricksThisJump);
    b.boostStrength = Math.max(b.boostStrength, 0.65 + 0.2 * big);
    b.nitro = Math.min(1, b.nitro + 0.05 + 0.06 * big + 0.08 * b.tricksThisJump);
    b.jumpScore += Math.round(100 + 300 * big);
  } else {
    // Sloppy landing scrubs speed in proportion to how sloppy.
    const loss = clamp(0.1 + pitchErr * 0.35 + rollErr * 0.3 + slip * 0.25, 0.05, 0.5);
    b.velocity.x -= fx * b.forwardSpeed * loss;
    b.velocity.z -= fz * b.forwardSpeed * loss;
  }
  b.stuntScore += b.jumpScore;
  env.events.push('land', id, pos.x, b.surfaceY, pos.z, Math.max(strength, 0.25), clean ? 'clean' : '');
  b.tricksThisJump = 0;
  b.jumpScore = 0;
}
