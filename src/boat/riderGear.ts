/**
 * Rider gear catalogue: weight classes (BUILD), headwear, outfits and an
 * accessory slot. Pure data — the meshes live in riderWear.ts, the save keeps
 * the chosen ids in RiderLook (sanitised in riderLook.ts), and unlock rules are
 * checked against a small view of the save so this file imports nothing.
 */

export type Build = 'light' | 'medium' | 'heavy';
export type Headwear = 'none' | 'cap' | 'bandana' | 'phones' | 'helmet' | 'captain';
export type Outfit = 'team' | 'wetsuit' | 'jacket' | 'storm' | 'neon';
export type Accessory = 'none' | 'goggles' | 'scarf' | 'bands';

/** How an item is earned. Everything without a rule is available from the start. */
export type UnlockRule =
  | { kind: 'level'; level: number }
  | { kind: 'cup'; cup: string; cupName: string; trophy: 1 | 3 }
  | { kind: 'ach'; id: string; achName: string };

export interface GearItem<T extends string> {
  id: T;
  name: string;
  blurb: string;
  unlock?: UnlockRule;
}

export const BUILDS: (GearItem<Build> & { body: [number, number, number] })[] = [
  // body = [width, height, limb thickness] scale of the rider's proportions.
  { id: 'light', name: 'LIGHT', blurb: 'Quicker off the line and sharper to turn, a touch lower top speed. Gets shoved around in contact.', body: [0.9, 0.97, 0.88] },
  { id: 'medium', name: 'MEDIUM', blurb: 'The boat exactly as designed.', body: [1, 1, 1] },
  { id: 'heavy', name: 'HEAVY', blurb: 'Higher top speed and steadier in swell, wins the shoving matches. Slower to get going.', body: [1.13, 1.03, 1.16] },
];

export const HEADWEAR: GearItem<Headwear>[] = [
  { id: 'none', name: 'NONE', blurb: 'Hair to the wind.' },
  { id: 'cap', name: 'VISOR CAP', blurb: 'Two-tone peaked cap; the bangs and side spikes stay out.', unlock: { kind: 'level', level: 2 } },
  { id: 'bandana', name: 'BANDANA', blurb: 'Knotted headband with trailing tails.', unlock: { kind: 'ach', id: 'win', achName: 'FIRST PAST THE POST' } },
  { id: 'phones', name: 'HEADPHONES', blurb: 'Chunky studio cans over the spikes.', unlock: { kind: 'level', level: 6 } },
  { id: 'helmet', name: 'RACE HELMET', blurb: 'Open-face shell with a flip-up visor and fin.', unlock: { kind: 'cup', cup: 'surf', cupName: 'SURF CUP', trophy: 1 } },
  { id: 'captain', name: "SKIPPER'S HAT", blurb: 'Tall-crowned captain hat with a gold anchor badge.', unlock: { kind: 'cup', cup: 'grand', cupName: 'RIPTIDE GRAND PRIX', trophy: 3 } },
];

export interface OutfitDef extends GearItem<Outfit> {
  /** null = take the colour from the boat livery (team kit). */
  main: string | null;
  trim: string | null;
  trousers: string | null;
  /** Torso pattern drawn into the vertex colours. */
  pattern: 'none' | 'panels' | 'jacket' | 'sash' | 'hem';
  /** Upper arms in the suit colour (otherwise bare). */
  sleeves: boolean;
}

export const OUTFITS: OutfitDef[] = [
  { id: 'team', name: 'TEAM KIT', blurb: 'Matches the boat you ride.', main: null, trim: null, trousers: null, pattern: 'none', sleeves: false },
  { id: 'wetsuit', name: 'REEF WETSUIT', blurb: 'Black neoprene with teal side panels.', main: '#1c2230', trim: '#1fc8c0', trousers: '#1c2230', pattern: 'panels', sleeves: true, unlock: { kind: 'level', level: 3 } },
  { id: 'jacket', name: 'PADDOCK JACKET', blurb: 'White race jacket, red hem band, stand-up collar and zip.', main: '#f4f2ec', trim: '#e2283c', trousers: '#2b2e3a', pattern: 'jacket', sleeves: true, unlock: { kind: 'cup', cup: 'splash', cupName: 'SPLASH CUP', trophy: 1 } },
  { id: 'storm', name: 'STORM SHELL', blurb: 'Sou’wester-yellow rain shell with a navy hem.', main: '#ffcc2e', trim: '#203058', trousers: '#203058', pattern: 'hem', sleeves: true, unlock: { kind: 'ach', id: 'weather', achName: 'ALL WEATHER' } },
  { id: 'neon', name: 'NIGHT RUNNER', blurb: 'Deep violet suit split by a glowing cyan bolt.', main: '#2a1d4a', trim: '#38f0ff', trousers: '#1a1430', pattern: 'sash', sleeves: false, unlock: { kind: 'level', level: 10 } },
];

export const ACCESSORIES: GearItem<Accessory>[] = [
  { id: 'none', name: 'NONE', blurb: '' },
  { id: 'goggles', name: 'GOGGLES', blurb: 'Pushed up on the forehead, anime style.', unlock: { kind: 'level', level: 4 } },
  { id: 'scarf', name: 'SCARF', blurb: 'A long scarf that trails off the shoulders.', unlock: { kind: 'ach', id: 'air', achName: 'FREQUENT FLYER' } },
  { id: 'bands', name: 'WRISTBANDS', blurb: 'Terry sweatbands in your boat’s accent colour.', unlock: { kind: 'ach', id: 'start', achName: 'HOLESHOT' } },
];

export interface UnlockView {
  level: number;
  cups: Record<string, number>;
  achievements: Record<string, number>;
}

export function gearUnlocked(rule: UnlockRule | undefined, v: UnlockView) {
  if (!rule) return true;
  if (rule.kind === 'level') return v.level >= rule.level;
  if (rule.kind === 'cup') return (v.cups[rule.cup] ?? 0) >= rule.trophy;
  return v.achievements[rule.id] !== undefined;
}

export function unlockText(rule: UnlockRule | undefined) {
  if (!rule) return '';
  if (rule.kind === 'level') return `REACH LEVEL ${rule.level}`;
  if (rule.kind === 'cup') return rule.trophy >= 3 ? `WIN THE ${rule.cupName}` : `PODIUM IN THE ${rule.cupName}`;
  return `ACHIEVEMENT: ${rule.achName}`;
}

/**
 * Handling multipliers of a weight class, applied to a copy of the player's
 * spec at race start. Small on purpose: a feel, not a different boat.
 */
export const BUILD_TUNING: Record<Build, { thrust: number; topSpeed: number; turn: number; yaw: number; stability: number; mass: number; toughness: number }> = {
  light: { thrust: 1.035, topSpeed: 0.985, turn: 1.035, yaw: 1.06, stability: -0.05, mass: 0.84, toughness: 1.1 },
  medium: { thrust: 1, topSpeed: 1, turn: 1, yaw: 1, stability: 0, mass: 1, toughness: 1 },
  heavy: { thrust: 0.965, topSpeed: 1.015, turn: 0.98, yaw: 0.95, stability: 0.06, mass: 1.2, toughness: 0.9 },
};
