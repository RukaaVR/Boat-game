/**
 * The six watercraft. Handling numbers are real physics inputs (see
 * boatPhysics.ts); the 1–10 `stats` are derived for the UI from the same values
 * so the garage bars can never disagree with how the boat actually drives.
 */

export type BoatId = 'speedster' | 'bullet' | 'drifter' | 'tank' | 'aero' | 'breaker';

export type HullStyle = 'runabout' | 'needle' | 'skiff' | 'catamaran' | 'wing' | 'deepv';

export interface BoatSpec {
  id: BoatId;
  name: string;
  tagline: string;
  hull: HullStyle;
  /** Metres. */
  length: number;
  beam: number;
  /** Equilibrium top speed on flat water at full throttle, m/s. */
  topSpeed: number;
  /** Equilibrium top speed under full boost, m/s. */
  boostTopSpeed: number;
  /** Peak thrust acceleration at zero speed, m/s². */
  thrust: number;
  /** Peak yaw rate, rad/s. */
  turnRate: number;
  /** How fast yaw rate follows the stick, 1/s. */
  yawResponse: number;
  /** Lateral grip (1/s) when carving and when drifting. */
  grip: number;
  driftGrip: number;
  /** Yaw rate multiplier while drifting. */
  driftYaw: number;
  /** Multiplier on drift charge rate. */
  driftCharge: number;
  /** Multiplier on boost thrust/duration. */
  boostPower: number;
  /** 0..1 — damping of wave-induced pitch/roll; higher = more planted. */
  stability: number;
  /** 0..1 — air control authority and trick speed. */
  air: number;
  /** Mass-ish factor for collisions (1 = average). */
  mass: number;
  /** Credits to buy once unlocked; 0 = owned from start. */
  price: number;
  unlockLevel: number;
  /** Default livery. */
  hullColor: string;
  accentColor: string;
}

export const BOATS: BoatSpec[] = [
  {
    id: 'speedster',
    name: 'SPEEDSTER',
    tagline: 'Balanced all-rounder. Forgiving, quick, honest.',
    hull: 'runabout',
    length: 4.4,
    beam: 1.7,
    topSpeed: 31,
    boostTopSpeed: 42,
    thrust: 15,
    turnRate: 1.75,
    yawResponse: 7,
    grip: 5.2,
    driftGrip: 1.15,
    driftYaw: 1.35,
    driftCharge: 1.0,
    boostPower: 1.0,
    stability: 0.6,
    air: 0.6,
    mass: 1.0,
    price: 0,
    unlockLevel: 1,
    hullColor: '#ff3b5c',
    accentColor: '#ffffff',
  },
  {
    id: 'drifter',
    name: 'DRIFTER',
    tagline: 'Short, loose and twitchy. Lives sideways.',
    hull: 'skiff',
    length: 3.9,
    beam: 1.9,
    topSpeed: 29.5,
    boostTopSpeed: 41,
    thrust: 15.5,
    turnRate: 2.05,
    yawResponse: 9,
    grip: 4.6,
    driftGrip: 0.95,
    driftYaw: 1.55,
    driftCharge: 1.3,
    boostPower: 1.05,
    stability: 0.45,
    air: 0.55,
    mass: 0.9,
    price: 0,
    unlockLevel: 1,
    hullColor: '#2ad4ff',
    accentColor: '#ffe14d',
  },
  {
    id: 'bullet',
    name: 'BULLET',
    tagline: 'Needle hull. Brutal top end, wide turning arc.',
    hull: 'needle',
    length: 5.4,
    beam: 1.5,
    topSpeed: 34,
    boostTopSpeed: 44.5,
    thrust: 13,
    turnRate: 1.45,
    yawResponse: 5.5,
    grip: 5.6,
    driftGrip: 1.35,
    driftYaw: 1.25,
    driftCharge: 0.85,
    boostPower: 1.1,
    stability: 0.55,
    air: 0.45,
    mass: 1.05,
    price: 1200,
    unlockLevel: 2,
    hullColor: '#ffb21e',
    accentColor: '#1b1b2f',
  },
  {
    id: 'aero',
    name: 'AERO',
    tagline: 'Winged hydroplane. Hangs in the air, flips on a thought.',
    hull: 'wing',
    length: 4.6,
    beam: 2.2,
    topSpeed: 31.5,
    boostTopSpeed: 43,
    thrust: 14.5,
    turnRate: 1.7,
    yawResponse: 7,
    grip: 4.9,
    driftGrip: 1.1,
    driftYaw: 1.35,
    driftCharge: 1.0,
    boostPower: 1.0,
    stability: 0.5,
    air: 1.0,
    mass: 0.85,
    price: 1800,
    unlockLevel: 3,
    hullColor: '#a6ff3d',
    accentColor: '#16324f',
  },
  {
    id: 'tank',
    name: 'TANK',
    tagline: 'Twin-hull bruiser. Shrugs off waves and rivals.',
    hull: 'catamaran',
    length: 5.0,
    beam: 2.5,
    topSpeed: 30,
    boostTopSpeed: 40,
    thrust: 13,
    turnRate: 1.55,
    yawResponse: 5.5,
    grip: 6.2,
    driftGrip: 1.4,
    driftYaw: 1.25,
    driftCharge: 0.9,
    boostPower: 0.95,
    stability: 0.95,
    air: 0.3,
    mass: 1.6,
    price: 2400,
    unlockLevel: 4,
    hullColor: '#7b5cff',
    accentColor: '#ff8a1e',
  },
  {
    id: 'breaker',
    name: 'WAVE BREAKER',
    tagline: 'Deep-V offshore racer. Eats storm swell for breakfast.',
    hull: 'deepv',
    length: 5.1,
    beam: 1.9,
    topSpeed: 33,
    boostTopSpeed: 44,
    thrust: 14.5,
    turnRate: 1.6,
    yawResponse: 6.5,
    grip: 5.4,
    driftGrip: 1.2,
    driftYaw: 1.3,
    driftCharge: 1.05,
    boostPower: 1.05,
    stability: 0.85,
    air: 0.65,
    mass: 1.2,
    price: 3600,
    unlockLevel: 6,
    hullColor: '#f4f1e8',
    accentColor: '#e8233a',
  },
];

export function boatSpec(id: string): BoatSpec {
  return BOATS.find((b) => b.id === id) ?? BOATS[0];
}

/** 1–10 bars for the garage, computed from the physics values. */
export function boatStats(s: BoatSpec) {
  const raw = boatStatsRaw(s);
  const r = (v: number) => Math.max(1, Math.min(10, Math.round(v)));
  return { speed: r(raw.speed), accel: r(raw.accel), handling: r(raw.handling), drift: r(raw.drift), stability: r(raw.stability), air: r(raw.air) };
}

/** Unrounded bar values (0.5–10.5), for showing small part / build trade-offs. */
export function boatStatsRaw(s: BoatSpec) {
  const r = (v: number, lo: number, hi: number) => Math.max(0.5, Math.min(10.5, 1 + ((v - lo) / (hi - lo)) * 9));
  return {
    speed: r(s.topSpeed, 28, 35.5),
    accel: r(s.thrust, 12.5, 16),
    handling: r(s.turnRate * 0.7 + s.yawResponse * 0.08, 1.4, 2.2),
    drift: r(s.driftCharge * 0.6 + s.driftYaw * 0.8, 1.45, 2.05),
    stability: r(s.stability, 0.3, 1),
    air: r(s.air, 0.25, 1),
  };
}
