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
  /** Point-to-point sprint: the fraction of the generated loop that is raced, start → finish. The rest is walled off. */
  sprint?: number;
  /** Battle arena: an open circular lagoon rather than a race course (the loop is only a navigation aid). */
  arena?: boolean;
  /** Visual style layered over the theme (e.g. the neon night ocean). */
  look?: 'neonnight';
  /** Sea-state multiplier on the weather preset (beginner courses run calmer water). */
  sea?: number;
  /** A run of consecutive ramps on the longest straight (teaches tricks). */
  rampRun?: number;
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
  {
    id: 'glacier',
    name: 'GLACIER BAY',
    theme: 'arctic',
    weather: 'night',
    blurb: 'Icebergs, drifting floes and the northern lights overhead. Cold water, hot laps.',
    laps: 3,
    unlockLevel: 6,
    seed: 7717,
    radius: 280,
    aspect: 1.2,
    harmonics: [
      [2, 0.16, 1.7],
      [3, 0.18, 0.6],
      [5, 0.06, 2.0],
    ],
    rotation: 0.2,
    width: 44,
    ramps: 3,
    pads: 4,
    swells: 1,
    hazards: 4,
    shortcuts: 1,
    medals: [60.5, 63.2, 67.2],
  },
  {
    id: 'jungle',
    name: 'JUNGLE RAPIDS',
    theme: 'jungle',
    weather: 'clear',
    blurb: 'Point-to-point down a jungle river: rapids, a lost temple and one shot at the finish.',
    laps: 1,
    unlockLevel: 4,
    seed: 8803,
    radius: 300,
    aspect: 1.3,
    harmonics: [
      [2, 0.18, 0.3],
      [3, 0.2, 1.4],
      [4, 0.06, 0.2],
    ],
    rotation: 0.9,
    width: 38,
    ramps: 3,
    pads: 3,
    swells: 3,
    hazards: 4,
    shortcuts: 1,
    medals: [57.8, 60.3, 64.2],
    sprint: 0.8,
  },
  {
    id: 'canal',
    name: 'CANAL CITY',
    theme: 'canal',
    weather: 'sunset',
    blurb: 'Tight right-angle turns between stone walls, under arch bridges, past the gondolas.',
    laps: 3,
    unlockLevel: 6,
    seed: 9907,
    radius: 230,
    aspect: 1.15,
    harmonics: [
      [4, 0.1, 0.0],
      [2, 0.07, 1.1],
      [8, 0.012, 0.0],
    ],
    rotation: 0.785,
    width: 32,
    ramps: 2,
    pads: 5,
    swells: 0,
    hazards: 0,
    shortcuts: 1,
    medals: [49.0, 51.1, 54.4],
  },
  {
    id: 'fjord',
    name: 'FJORD DASH',
    theme: 'arctic',
    weather: 'clear',
    blurb: 'A point-to-point sprint through an icy fjord. No second lap, no second chances.',
    laps: 1,
    unlockLevel: 7,
    seed: 10111,
    radius: 330,
    aspect: 1.4,
    harmonics: [
      [2, 0.16, 2.2],
      [3, 0.16, 0.4],
      [5, 0.05, 1.0],
    ],
    rotation: -0.6,
    width: 42,
    ramps: 3,
    pads: 4,
    swells: 2,
    hazards: 5,
    shortcuts: 1,
    medals: [60.7, 63.4, 67.4],
    sprint: 0.78,
  },
  {
    id: 'splash',
    name: 'PALM SHALLOWS',
    theme: 'tropical',
    weather: 'clear',
    blurb: 'Wide, calm and friendly: sweeping bends, glassy water and an easy reef shortcut. Learn the ropes here.',
    laps: 3,
    unlockLevel: 1,
    seed: 11213,
    radius: 235,
    aspect: 1.35,
    harmonics: [
      [2, 0.14, 0.6],
      [3, 0.08, 2.4],
    ],
    rotation: 0.2,
    width: 54,
    ramps: 2,
    pads: 5,
    swells: 0,
    hazards: 1,
    shortcuts: 1,
    medals: [51.1, 53.6, 58.9],
    sea: 0.55,
  },
  {
    id: 'hopscotch',
    name: 'HOPSCOTCH KEYS',
    theme: 'tropical',
    weather: 'sunset',
    blurb: 'A run of ramps down the back straight: hold DRIFT in the air to spin, land flat for a boost.',
    laps: 3,
    unlockLevel: 1,
    seed: 12329,
    radius: 245,
    aspect: 1.5,
    harmonics: [
      [2, 0.1, 1.6],
      [3, 0.1, 0.4],
      [4, 0.04, 1.0],
    ],
    rotation: -0.35,
    width: 50,
    ramps: 1,
    rampRun: 4,
    pads: 4,
    swells: 1,
    hazards: 1,
    shortcuts: 1,
    medals: [57.0, 59.8, 65.7],
    sea: 0.6,
  },
  {
    id: 'lighthouse',
    name: 'LIGHTHOUSE POINT',
    theme: 'storm',
    weather: 'clear',
    blurb: 'Blue skies on the cliffs: a chain of S-bends made for linking drifts, past the old lighthouse.',
    laps: 3,
    unlockLevel: 1,
    seed: 13441,
    radius: 250,
    aspect: 1.2,
    harmonics: [
      [4, 0.1, 0.5],
      [2, 0.12, 2.0],
      [5, 0.035, 1.2],
    ],
    rotation: 0.6,
    width: 50,
    ramps: 2,
    pads: 4,
    swells: 0,
    hazards: 2,
    shortcuts: 1,
    medals: [50.8, 53.2, 58.5],
    sea: 0.65,
  },
  {
    id: 'starfall',
    name: 'STARFALL CIRCUIT',
    theme: 'neon',
    weather: 'night',
    look: 'neonnight',
    blurb: 'A glowing night ocean under a giant moon: light-rail barriers, floating hoops and a city on the horizon.',
    laps: 3,
    unlockLevel: 8,
    seed: 14551,
    radius: 285,
    aspect: 1.3,
    harmonics: [
      [2, 0.15, 0.9],
      [3, 0.2, 2.6],
      [5, 0.06, 0.4],
    ],
    rotation: -0.2,
    width: 46,
    ramps: 3,
    pads: 6,
    swells: 1,
    hazards: 3,
    shortcuts: 1,
    medals: [65.1, 68.7, 73.7],
  },
];

/**
 * Battle arenas. Not race courses: they never appear in race, time-trial or
 * championship lists. The generated loop is a wide ring that only serves AI
 * navigation, respawn and the minimap; the arena layout fills the lagoon.
 */
export const ARENAS: TrackDef[] = [
  {
    id: 'lagoon',
    name: 'LAGOON ARENA',
    theme: 'tropical',
    weather: 'clear',
    arena: true,
    blurb: 'A ring of palm islands around an open lagoon: item boxes everywhere, ramps, whirlpools and channels to sneak through.',
    laps: 0,
    unlockLevel: 1,
    seed: 15661,
    radius: 150,
    aspect: 1,
    harmonics: [],
    rotation: 0,
    width: 330,
    ramps: 4,
    pads: 6,
    swells: 0,
    hazards: 6,
    shortcuts: 0,
    medals: [0, 0, 0],
    sea: 0.7,
  },
];

export function trackDef(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? ARENAS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Championship cups: ordered track lists. */
export interface Cup {
  id: string;
  name: string;
  tracks: string[];
  unlockLevel: number;
}

export const CUPS: Cup[] = [
  { id: 'splash', name: 'SPLASH CUP', tracks: ['splash', 'hopscotch', 'lighthouse'], unlockLevel: 1 },
  { id: 'surf', name: 'SURF CUP', tracks: ['coral', 'atoll', 'shipyard'], unlockLevel: 1 },
  { id: 'storm', name: 'STORM CUP', tracks: ['thunder', 'neon', 'cinder'], unlockLevel: 3 },
  { id: 'grand', name: 'RIPTIDE GRAND PRIX', tracks: ['coral', 'thunder', 'neon', 'atoll', 'cinder', 'shipyard'], unlockLevel: 5 },
  { id: 'frontier', name: 'FRONTIER CUP', tracks: ['jungle', 'glacier', 'canal', 'fjord'], unlockLevel: 7 },
  { id: 'midnight', name: 'MIDNIGHT CUP', tracks: ['neon', 'glacier', 'starfall'], unlockLevel: 8 },
];

/** Championship points by finishing position (1st..6th). */
export const CHAMP_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
