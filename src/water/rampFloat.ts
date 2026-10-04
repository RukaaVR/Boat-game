/**
 * Floating ramps: each ramp is a rigid platform that rides the swell — it
 * heaves with the water under it and tilts a little toward the slope of the
 * sea along its length. Physics (boatPhysics) and visuals (course.ts) both call
 * this, so the surface a boat drives up is exactly the one that is drawn.
 */

import type { Ramp } from '../core/types';
import { oceanHeight } from './waves';

export interface RampFloat {
  /** Vertical offset of the whole ramp, metres. */
  heave: number;
  /** Extra slope along the ramp (rise per metre), from the swell. */
  tilt: number;
}

/** How much of the water's rise the platform follows (it is heavy and damped). */
const HEAVE = 0.8;
const TILT = 0.5;
const MAX_TILT = 0.08;

export function rampFloat(r: Ramp, t: number, out: RampFloat): RampFloat {
  const sh = Math.sin(r.heading);
  const ch = Math.cos(r.heading);
  const L = r.length;
  const hToe = oceanHeight(r.x, r.z, t);
  const hMid = oceanHeight(r.x + sh * L * 0.5, r.z + ch * L * 0.5, t);
  const hLip = oceanHeight(r.x + sh * L, r.z + ch * L, t);
  out.heave = (hToe + 2 * hMid + hLip) * 0.25 * HEAVE;
  out.tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, ((hLip - hToe) / L) * TILT));
  return out;
}

/** Height of the ramp's driving surface at `along` metres from the toe. */
export function rampSurfaceY(r: Ramp, along: number, f: RampFloat) {
  return -0.5 + 0.12 + along * (r.height / r.length) + f.heave + (along - r.length * 0.5) * f.tilt;
}
