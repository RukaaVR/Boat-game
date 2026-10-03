import type { ThemeId, WeatherId } from '../core/types';

/**
 * Course definitions. A course is a closed loop whose radius varies with angle
 * as a sum of harmonics — that family can produce kidneys, hairpins, chicanes
 * and long sweepers but can never self-intersect (it is star-shaped), so every
 * seed is a valid track. Everything else — buoys, gates, ramps, pads, swell
 * zones, shortcuts, scenery — is derived from the centreline by the generator.
 */
export interface TrackDef {
  id: string;
  name: string;
  theme: ThemeId;
  weather: WeatherId;
  blurb: string;
  laps: number;
  unlockLevel: number;
  seed: number;
  /** Mean radius, metres. */
  radius: number;
  /** X stretch. */
  aspect: number;
  /** [harmonic n, amplitude (fraction of radius), phase]. */
  harmonics: [number, number, number][];
  rotation: number;
  width: number;
  ramps: number;
  pads: number;
  swells: number;
  hazards: number;
  shortcuts: number;
  /** Time-trial best-lap medal targets (s): gold, silver, bronze. Derived from measured autopilot laps: bronze ≈ steady clean pace, gold ≈ 10% faster. */
  medals: [number, number, number];
}

export const TRACKS: TrackDef[] = [
  {
    id: 'coral',
    name: 'CORAL COVE',
    theme: 'tropical',
    weather: 'clear',
    blurb: 'Turquoise shallows, palm islands and a ramp-lined back straight. The perfect first race.',
    laps: 3,
    unlockLevel: 1,
    seed: 1101,
    radius: 270,
    aspect: 1.25,
    harmonics: [
      [2, 0.2, 0.4],
      [3, 0.17, 1.9],
      [5, 0.06, 0.7],
    ],
    rotation: 0.3,
    width: 46,
    ramps: 3,
    pads: 4,
    swells: 1,
    hazards: 2,
    shortcuts: 1,
    medals: [60.0, 63.4, 68.0],
  },
  {
    id: 'atoll',
    name: 'SUNSET ATOLL',
    theme: 'tropical',
    weather: 'sunset',
    blurb: 'A technical ring around a reef with a sneaky channel through the rocks.',
    laps: 3,
    unlockLevel: 1,
    seed: 2207,
    radius: 255,
    aspect: 1.0,
    harmonics: [
      [3, 0.22, 0.2],
      [5, 0.08, 2.4],
      [2, 0.08, 1.0],
    ],
    rotation: 1.1,
    width: 42,
    ramps: 3,
    pads: 3,
    swells: 1,
    hazards: 3,
    shortcuts: 1,
    medals: [52.8, 55.8, 59.9],
  },
  {
    id: 'thunder',
    name: 'THUNDERHEAD COAST',
    theme: 'storm',
    weather: 'storm',
    blurb: 'Black cliffs, lighthouse beams and swell big enough to launch you over the pack.',
    laps: 3,
    unlockLevel: 2,
    seed: 3313,
    radius: 300,
    aspect: 1.35,
    harmonics: [
      [2, 0.2, 2.6],
      [3, 0.19, 0.3],
      [4, 0.07, 0.5],
    ],
    rotation: -0.4,
    width: 48,
    ramps: 2,
    pads: 3,
    swells: 3,
    hazards: 3,
    shortcuts: 1,
    medals: [67.7, 71.4, 76.7],
  },
  {
    id: 'neon',
    name: 'NEON HARBOR',
    theme: 'neon',
    weather: 'night',
    blurb: 'Container canyons, crane gantries and a skyline that never sleeps.',
    laps: 3,
    unlockLevel: 3,
    seed: 4421,
    radius: 265,
    aspect: 1.45,
    harmonics: [
      [2, 0.12, 1.2],
      [3, 0.22, 0.1],
      [6, 0.04, 1.0],
    ],
    rotation: 0.0,
    width: 44,
    ramps: 3,
    pads: 5,
    swells: 1,
    hazards: 2,
    shortcuts: 1,
    medals: [64.9, 68.5, 73.5],
  },
  {
    id: 'cinder',
    name: 'CINDER STRAIT',
    theme: 'volcanic',
    weather: 'sunset',
    blurb: 'Lava-lit basalt, drifting mines and steam vents. Fast, mean, unforgiving.',
    laps: 3,
    unlockLevel: 5,
    seed: 5531,
    radius: 285,
    aspect: 1.15,
    harmonics: [
      [2, 0.12, 0.9],
      [3, 0.2, 2.2],
      [5, 0.07, 0.3],
    ],
    rotation: 0.8,
    width: 44,
    ramps: 3,
    pads: 4,
    swells: 2,
    hazards: 6,
    shortcuts: 1,
    medals: [59.9, 63.2, 67.8],
  },
  {
    id: 'shipyard',
    name: 'SHIPYARD SPRINT',
    theme: 'neon',
    weather: 'clear',
    blurb: 'A short, flat-out blast through the working docks in broad daylight.',
    laps: 4,
    unlockLevel: 4,
    seed: 6619,
    radius: 225,
    aspect: 1.6,
    harmonics: [
      [2, 0.1, 0.0],
      [3, 0.14, 2.0],
      [4, 0.1, 1.4],
    ],
    rotation: 0.5,
    width: 42,
    ramps: 2,
    pads: 4,
    swells: 0,
    hazards: 2,
    shortcuts: 1,
    medals: [58.3, 61.6, 66.1],
  },
];

export function trackDef(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Championship cups: ordered track lists. */
export interface Cup {
  id: string;
  name: string;
  tracks: string[];
  unlockLevel: number;
}

export const CUPS: Cup[] = [
  { id: 'surf', name: 'SURF CUP', tracks: ['coral', 'atoll', 'shipyard'], unlockLevel: 1 },
  { id: 'storm', name: 'STORM CUP', tracks: ['thunder', 'neon', 'cinder'], unlockLevel: 3 },
  { id: 'grand', name: 'RIPTIDE GRAND PRIX', tracks: ['coral', 'thunder', 'neon', 'atoll', 'cinder', 'shipyard'], unlockLevel: 5 },
];

/** Championship points by finishing position (1st..6th). */
export const CHAMP_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
