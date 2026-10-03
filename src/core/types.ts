/** Cross-subsystem data contracts. Pure data — no behaviour, no imports of systems. */

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  /** Air pitch input: +1 = nose down (push), -1 = nose up (pull). */
  pitch: number;
  drift: boolean;
  boost: boolean;
  /** Barrel-roll trick button. */
  roll: boolean;
}

export function makeControls(): Controls {
  return { throttle: 0, brake: 0, steer: 0, pitch: 0, drift: false, boost: false, roll: false };
}

/** A launch ramp floating on the course. Local frame: `along` 0 at foot → length at lip. */
export interface Ramp {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  height: number;
}

export interface BoostPad {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
}

export type ColliderKind = 'rock' | 'island' | 'pile' | 'hull' | 'mine';

/** Static circular obstacle in the XZ plane. */
export interface Collider {
  x: number;
  z: number;
  r: number;
  kind: ColliderKind;
}

/** Dynamic floating marker buoy — pushed by boats, springs back to its anchor. */
export interface Buoy {
  ax: number;
  az: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 0 = left course edge, 1 = right edge, 2 = shortcut marker, 3 = hazard. */
  side: number;
  /** Visual knock wobble, decays. */
  wobble: number;
}

export interface StuntRing {
  x: number;
  y: number;
  z: number;
  heading: number;
  radius: number;
  taken: boolean;
  respawn: number;
}

export type WeatherId = 'clear' | 'sunset' | 'storm' | 'night';
export type ThemeId = 'tropical' | 'storm' | 'neon' | 'volcanic';
export type ModeId = 'quick' | 'championship' | 'timetrial' | 'freeride' | 'stunt' | 'endless';
export type Difficulty = 'easy' | 'normal' | 'hard';
