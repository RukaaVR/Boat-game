import { Vector3 } from 'three';
import type { BoatSpec } from './specs';

export type TrickKind = 'none' | 'frontflip' | 'backflip' | 'spin' | 'roll';

export const TRICK_NAMES: Record<TrickKind, string> = {
  none: '',
  frontflip: 'FRONT FLIP',
  backflip: 'BACK FLIP',
  spin: '360 SPIN',
  roll: 'BARREL ROLL',
};

/**
 * Complete simulation state for one watercraft. The physics writes it, the
 * renderer, camera, audio, AI and HUD read it. Nothing in here is visual-only
 * except the `vis*` trick offsets, which are applied on top of the physical
 * orientation by the boat visual.
 */
export class Boat {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  heading = 0;
  yawRate = 0;
  /** Nose-up positive, radians. */
  pitch = 0;
  pitchRate = 0;
  /** Right-side-down positive, radians. */
  roll = 0;
  rollRate = 0;

  /** Signed speed along the hull, m/s. */
  forwardSpeed = 0;
  lateralSpeed = 0;
  /** Spooled engine output 0..1. */
  engine = 0;
  /** 0..1 visual/audio RPM (engine load + speed). */
  rpm = 0;

  /** Fraction of buoyancy probes in the water, 0..1. */
  wet = 1;
  airborne = false;
  airTime = 0;
  /** Height of hull bottom above the water, m (0 when in contact). */
  clearance = 0;
  /** Peak height above water during this jump. */
  airPeak = 0;
  /** Water surface height under the boat. */
  surfaceY = 0;
  /** Set by the race system: unit course tangent at the boat, for landing grading. */
  readonly courseDir = new Vector3(0, 0, 1);

  // Drift
  drifting = false;
  driftDir = 0;
  driftCharge = 0;
  driftTier = 0;
  driftTime = 0;
  /** Smoothed slip angle (rad) between hull and velocity. */
  slip = 0;

  // Boost
  /** Remaining mini-turbo time (drift release, landings, pads). */
  boostTime = 0;
  /** Strength of the current mini-turbo, 0..1. */
  boostStrength = 0;
  /** Nitro reserve 0..1, spent by holding boost. */
  nitro = 0.35;
  nitroActive = false;
  /** 0..1 combined visible boost intensity (for FX/camera). */
  boostLevel = 0;
  /** Drafting (slipstream) intensity 0..1. */
  draft = 0;

  // Tricks
  trick: TrickKind = 'none';
  trickDir = 1;
  trickT = 0;
  trickDuration = 0.8;
  tricksThisJump = 0;
  visPitch = 0;
  visYaw = 0;
  visRoll = 0;
  /** Accumulated stunt points this jump. */
  jumpScore = 0;

  // Wipeout / recovery
  wipeout = 0;
  /** Seconds of controlled immunity after a reset. */
  ghostTime = 0;
  /** Last impact strength (0..1) and time since, for camera shake / rider. */
  impact = 0;
  /** Seconds since last landing (for recovery dip, rider crouch). */
  sinceLand = 10;
  landStrength = 0;
  /** Ramp contact this step. */
  onRamp = false;
  /** Contact cooldowns to keep audio/FX from machine-gunning. */
  hitCooldown = 0;
  splashCooldown = 0;
  /** Penalty hold (false start). */
  holdTime = 0;
  /** Engine power multiplier (damage, battle items); 1 = healthy. */
  powerScale = 1;
  /** Power before damage (career bosses run hotter engines). */
  basePower = 1;
  /** Hull damage 0..1 (cosmetic scuffs + smoke; slight power loss). */
  damage = 0;
  /** Battle-mode shield seconds remaining. */
  shield = 0;
  /** Golden Surge: seconds of repeat-boost window left (gold trail + aura). */
  surge = 0;
  /** Storm Call: seconds left shrunk (visual 0.6 scale, -25% top speed). */
  shrink = 0;
  /** Seconds of post-hit engine sputter (Seeker missile impact). */
  itemSlow = 0;
  /** Damage taken multiplier (hull upgrades lower it). */
  toughness = 1;
  /** Stunt score accumulated in the session. */
  stuntScore = 0;

  constructor(public spec: BoatSpec) {}

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  forwardX() {
    return Math.sin(this.heading);
  }
  forwardZ() {
    return Math.cos(this.heading);
  }

  /** Put the boat at rest at a pose (race start, respawn). */
  place(x: number, z: number, heading: number, y = 0) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this.yawRate = 0;
    this.pitch = this.pitchRate = 0;
    this.roll = this.rollRate = 0;
    this.forwardSpeed = this.lateralSpeed = 0;
    this.engine = 0;
    this.airborne = false;
    this.airTime = 0;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.boostTime = 0;
    this.nitroActive = false;
    this.trick = 'none';
    this.trickT = 0;
    this.visPitch = this.visYaw = this.visRoll = 0;
    this.wipeout = 0;
    this.slip = 0;
  }
}
