/**
 * Long-term progression content: boat upgrades, achievements, daily/weekly
 * challenges and the career ladder. Pure data + pure functions; the save layer
 * stores the player's state and rewards.ts applies results.
 */

import type { BoatId, BoatSpec } from '../boat/specs';
import { BOATS } from '../boat/specs';
import type { ModeId, WeatherId } from '../core/types';
import { TRACKS } from '../race/trackDefs';

// ── Upgrades ───────────────────────────────────────────────────────────────
export type UpgradeKind = 'engine' | 'hull' | 'nitro' | 'handling';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'hull', 'nitro', 'handling'];
export type Upgrades = Record<UpgradeKind, number>;
export const UPGRADE_MAX = 3;

export const UPGRADE_INFO: Record<UpgradeKind, { name: string; blurb: string; base: number }> = {
  engine: { name: 'ENGINE', blurb: '+4% thrust and +2.5% top speed per stage', base: 700 },
  hull: { name: 'HULL', blurb: 'Steadier in swell, heavier in contact, shrugs off damage', base: 500 },
  nitro: { name: 'NITRO TANK', blurb: '+6% boost power, faster nitro refill', base: 600 },
  handling: { name: 'HANDLING', blurb: '+4% turn and grip, quicker drift charge', base: 550 },
};

export function emptyUpgrades(): Upgrades {
  return { engine: 0, hull: 0, nitro: 0, handling: 0 };
}
export function maxUpgrades(): Upgrades {
  return { engine: UPGRADE_MAX, hull: UPGRADE_MAX, nitro: UPGRADE_MAX, handling: UPGRADE_MAX };
}
/** Credits for the next stage of an upgrade (stage = current level). */
export function upgradeCost(kind: UpgradeKind, stage: number) {
  return Math.round(UPGRADE_INFO[kind].base * ([1, 2.2, 4][stage] ?? 0));
}

/** A copy of the spec with upgrades applied. */
export function upgradedSpec(spec: BoatSpec, u: Upgrades | undefined): BoatSpec {
  if (!u) return spec;
  const e = u.engine;
  const h = u.hull;
  const n = u.nitro;
  const k = u.handling;
  return {
    ...spec,
    thrust: spec.thrust * (1 + 0.04 * e),
    topSpeed: spec.topSpeed * (1 + 0.025 * e),
    boostTopSpeed: spec.boostTopSpeed * (1 + 0.025 * e),
    stability: Math.min(1, spec.stability + 0.06 * h),
    mass: spec.mass * (1 + 0.05 * h),
    boostPower: spec.boostPower * (1 + 0.06 * n),
    turnRate: spec.turnRate * (1 + 0.04 * k),
    grip: spec.grip * (1 + 0.04 * k),
    driftCharge: spec.driftCharge * (1 + 0.05 * k),
  };
}

// ── Lifetime stats ─────────────────────────────────────────────────────────
export interface LifetimeStats {
  tricks: number;
  tier3: number;
  cleanLandings: number;
  perfectStarts: number;
  bestAir: number;
  topSpeed: number;
  distance: number;
  itemHits: number;
  battleWins: number;
  photos: number;
  dailies: number;
  weeklies: number;
  weathers: WeatherId[];
  bestCleanInEvent: number;
}
export function emptyStats(): LifetimeStats {
  return { tricks: 0, tier3: 0, cleanLandings: 0, perfectStarts: 0, bestAir: 0, topSpeed: 0, distance: 0, itemHits: 0, battleWins: 0, photos: 0, dailies: 0, weeklies: 0, weathers: [], bestCleanInEvent: 0 };
}

/** What the progression systems need to know about the save. */
export interface ProgressView {
  races: number;
  wins: number;
  owned: string[];
  medals: Record<string, { race: number; tt: number; stunt: number }>;
  records: Record<string, { endless?: number }>;
  cups: Record<string, number>;
  upgrades: Partial<Record<BoatId, Upgrades>>;
  bottles: Record<string, number>;
  career: { stage: number };
  stats: LifetimeStats;
}

// ── Collectibles ───────────────────────────────────────────────────────────
export const BOTTLES_PER_TRACK = 5;
export const bottleCount = (mask: number) => {
  let n = 0;
  for (let i = 0; i < BOTTLES_PER_TRACK; i++) if (mask & (1 << i)) n++;
  return n;
};

// ── Achievements ───────────────────────────────────────────────────────────
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  credits: number;
  test: (v: ProgressView) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', name: 'WET FEET', desc: 'Finish your first race', credits: 200, test: (v) => v.races >= 1 },
  { id: 'win', name: 'FIRST PAST THE POST', desc: 'Win a race', credits: 300, test: (v) => v.wins >= 1 },
  { id: 'hattrick', name: 'HAT TRICK', desc: 'Win 3 races', credits: 500, test: (v) => v.wins >= 3 },
  { id: 'veteran', name: 'SEA LEGS', desc: 'Start 25 races', credits: 800, test: (v) => v.races >= 25 },
  { id: 'cup', name: 'SILVERWARE', desc: 'Win any championship cup', credits: 600, test: (v) => Object.values(v.cups).some((c) => c >= 3) },
  { id: 'grand', name: 'GRAND PRIX KING', desc: 'Win the RIPTIDE GRAND PRIX', credits: 1500, test: (v) => (v.cups.grand ?? 0) >= 3 },
  { id: 'flips', name: 'ACROBAT', desc: 'Land 50 tricks', credits: 500, test: (v) => v.stats.tricks >= 50 },
  { id: 'air', name: 'FREQUENT FLYER', desc: 'Stay airborne for 3 seconds', credits: 400, test: (v) => v.stats.bestAir >= 3 },
  { id: 'drift', name: 'DRIFT KING', desc: 'Reach the pink drift tier 25 times', credits: 500, test: (v) => v.stats.tier3 >= 25 },
  { id: 'start', name: 'HOLESHOT', desc: 'Get a PERFECT START', credits: 200, test: (v) => v.stats.perfectStarts >= 1 },
  { id: 'clean', name: 'BUTTER', desc: '10 clean landings in one event', credits: 400, test: (v) => v.stats.bestCleanInEvent >= 10 },
  { id: 'speed', name: 'SPEED DEMON', desc: 'Hit 160 km/h', credits: 400, test: (v) => v.stats.topSpeed >= 160 / 3.6 },
  { id: 'bottles1', name: 'BEACHCOMBER', desc: 'Find every message bottle on one course', credits: 500, test: (v) => TRACKS.some((t) => bottleCount(v.bottles[t.id] ?? 0) >= BOTTLES_PER_TRACK) },
  { id: 'bottles', name: 'TREASURE HUNTER', desc: 'Find every message bottle in the game', credits: 2500, test: (v) => TRACKS.every((t) => bottleCount(v.bottles[t.id] ?? 0) >= BOTTLES_PER_TRACK) },
  { id: 'ttgold', name: 'CHRONOMETER', desc: 'Time trial gold on every course', credits: 2000, test: (v) => TRACKS.every((t) => (v.medals[t.id]?.tt ?? 0) >= 3) },
  { id: 'stunt', name: 'SHOWBOAT', desc: 'Gold medal in a stunt run', credits: 500, test: (v) => Object.values(v.medals).some((m) => m.stunt >= 3) },
  { id: 'endless', name: 'SURVIVOR', desc: 'Ride 5,000 m in Endless Wave', credits: 600, test: (v) => Object.values(v.records).some((r) => (r.endless ?? 0) >= 5000) },
  { id: 'fleet', name: 'ADMIRAL', desc: 'Own every boat', credits: 1500, test: (v) => BOATS.every((b) => v.owned.includes(b.id)) },
  { id: 'tuner', name: 'GREASE MONKEY', desc: 'Fully upgrade a boat', credits: 800, test: (v) => Object.values(v.upgrades).some((u) => !!u && UPGRADE_KINDS.every((k) => u[k] >= UPGRADE_MAX)) },
  { id: 'daily', name: 'DAILY DRIVER', desc: 'Complete a daily challenge', credits: 300, test: (v) => v.stats.dailies >= 1 },
  { id: 'weekly', name: 'WEEKEND WARRIOR', desc: 'Complete a weekly challenge', credits: 700, test: (v) => v.stats.weeklies >= 1 },
  { id: 'career', name: 'LEGEND OF THE TIDE', desc: 'Beat every rival in Career', credits: 3000, test: (v) => v.career.stage >= CAREER.length },
  { id: 'battle', name: 'LAST BOAT FLOATING', desc: 'Win a Battle race', credits: 500, test: (v) => v.stats.battleWins >= 1 },
  { id: 'sniper', name: 'TORPEDO TOM', desc: 'Hit rivals with items 15 times', credits: 600, test: (v) => v.stats.itemHits >= 15 },
  { id: 'photo', name: 'SHUTTERBUG', desc: 'Save a photo in Photo Mode', credits: 150, test: (v) => v.stats.photos >= 1 },
  { id: 'weather', name: 'ALL WEATHER', desc: 'Race in clear, sunset, storm and night', credits: 400, test: (v) => (['clear', 'sunset', 'storm', 'night'] as const).every((w) => v.stats.weathers.includes(w)) },
  { id: 'distance', name: 'OCEAN CROSSING', desc: 'Travel 100 km in total', credits: 1200, test: (v) => v.stats.distance >= 100000 },
];

// ── Challenges ─────────────────────────────────────────────────────────────
export interface ChallengeResult {
  mode: ModeId;
  trackId: string;
  weather: WeatherId;
  boat: string;
  place: number;
  finished: boolean;
  bestLap: number;
  stuntScore: number;
  endlessDist: number;
  tricks: number;
  tier3: number;
  cleanLandings: number;
  itemHits: number;
}

export interface Challenge {
  key: string;
  weekly: boolean;
  text: string;
  mode: ModeId;
  trackId: string;
  weather: WeatherId;
  /** Required boat (lent if not owned). */
  boat: BoatId | null;
  laps: number;
  credits: number;
  xp: number;
  /** Serializable goal so a challenge can be re-checked after reload. */
  goal: { kind: 'place' | 'lap' | 'stunt' | 'endless' | 'tricks' | 'tier3' | 'clean' | 'hits'; value: number };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function pick<T>(list: readonly T[], h: number, salt: number) {
  return list[(Math.imul(h ^ (salt * 2654435761), 2246822507) >>> 0) % list.length];
}

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

const WEATHERS: WeatherId[] = ['clear', 'sunset', 'storm', 'night'];

/** The challenge for a day (or week). Deterministic from the date key. */
export function makeChallenge(key: string, weekly: boolean, maxLevelTracks: string[]): Challenge {
  const h = hashStr(key + (weekly ? '#w' : '#d'));
  const trackId = pick(maxLevelTracks.length ? maxLevelTracks : ['coral'], h, 1);
  const tname = TRACKS.find((t) => t.id === trackId)!.name;
  const weather = pick(WEATHERS, h, 2);
  const boat = pick(BOATS, h, 3).id;
  const bname = BOATS.find((b) => b.id === boat)!.name;
  const kind = pick(weekly ? (['win', 'lap', 'stunt', 'tier3', 'battle'] as const) : (['podium', 'win', 'lap', 'stunt', 'endless', 'tricks', 'tier3', 'clean', 'battle'] as const), h, 4);
  const base = { key, weekly, trackId, weather, boat: null as BoatId | null, laps: 3, credits: weekly ? 2500 : 700, xp: weekly ? 900 : 300 };
  const def = TRACKS.find((t) => t.id === trackId)!;
  switch (kind) {
    case 'podium':
      return { ...base, boat, mode: 'quick', text: `Finish on the podium at ${tname} (${weather.toUpperCase()}) in the ${bname}`, goal: { kind: 'place', value: 3 } };
    case 'win':
      return { ...base, boat: weekly ? boat : null, mode: 'quick', laps: weekly ? 4 : 3, text: `Win at ${tname} in ${weather.toUpperCase()}${weekly ? ` — ${bname}, 4 laps, HARD rivals` : ''}`, goal: { kind: 'place', value: 1 } };
    case 'lap': {
      const target = weekly ? def.medals[0] : def.medals[1];
      return { ...base, mode: 'timetrial', laps: 3, text: `Lap ${tname} in under ${target.toFixed(1)} s (${weather.toUpperCase()})`, goal: { kind: 'lap', value: target } };
    }
    case 'stunt': {
      const i = TRACKS.indexOf(def);
      const target = Math.round((weekly ? 1.1 : 0.7) * (12000 + i * 800) / 500) * 500;
      return { ...base, mode: 'stunt', text: `Score ${target.toLocaleString()} in a Stunt Run at ${tname}`, goal: { kind: 'stunt', value: target } };
    }
    case 'endless':
      return { ...base, mode: 'endless', text: `Ride 3,000 m in Endless Wave at ${tname}`, goal: { kind: 'endless', value: 3000 } };
    case 'tricks':
      return { ...base, mode: 'quick', text: `Land 8 tricks in one race at ${tname}`, goal: { kind: 'tricks', value: 8 } };
    case 'tier3':
      return { ...base, mode: 'quick', text: `Hit the pink drift tier ${weekly ? 10 : 5} times in one race at ${tname}`, goal: { kind: 'tier3', value: weekly ? 10 : 5 } };
    case 'clean':
      return { ...base, mode: 'freeride', text: `Make 6 clean landings in Free Ride at ${tname}`, goal: { kind: 'clean', value: 6 } };
    case 'battle':
      return { ...base, mode: 'battle', text: `Hit rivals with items ${weekly ? 8 : 4} times in a Battle race at ${tname}`, goal: { kind: 'hits', value: weekly ? 8 : 4 } };
  }
}

export function challengeMet(c: Challenge, r: ChallengeResult): boolean {
  if (r.mode !== c.mode || r.trackId !== c.trackId) return false;
  if (c.boat && r.boat !== c.boat) return false;
  if (c.mode !== 'timetrial' && c.mode !== 'stunt' && c.mode !== 'endless' && r.weather !== c.weather) return false;
  const g = c.goal;
  switch (g.kind) {
    case 'place':
      return r.finished && r.place <= g.value;
    case 'lap':
      return isFinite(r.bestLap) && r.bestLap <= g.value;
    case 'stunt':
      return r.stuntScore >= g.value;
    case 'endless':
      return r.endlessDist >= g.value;
    case 'tricks':
      return r.tricks >= g.value;
    case 'tier3':
      return r.tier3 >= g.value;
    case 'clean':
      return r.cleanLandings >= g.value;
    case 'hits':
      return r.itemHits >= g.value;
  }
}

// ── Career ─────────────────────────────────────────────────────────────────
export interface CareerStage {
  /** Index into RIVALS of the boss for this stage. */
  boss: number;
  title: string;
  intro: string;
  trackId: string;
  weather: WeatherId;
  laps: number;
  /** Other rivals in the field (indices into RIVALS). */
  field: number[];
  difficulty: 'easy' | 'normal' | 'hard';
  /** Engine power multiplier for the boss. */
  bossPower: number;
  credits: number;
  xp: number;
}

export const CAREER: CareerStage[] = [
  { boss: 5, title: 'THE ROOKIE', intro: 'KAI: "New in town? Coral Cove is my backyard. Try to keep up."', trackId: 'coral', weather: 'clear', laps: 2, field: [3, 6], difficulty: 'easy', bossPower: 1.0, credits: 500, xp: 250 },
  { boss: 3, title: 'THE STEADY HAND', intro: 'SOL: "Sunsets are for the patient. You look like you rush."', trackId: 'atoll', weather: 'sunset', laps: 3, field: [5, 6], difficulty: 'normal', bossPower: 1.0, credits: 700, xp: 320 },
  { boss: 2, title: 'THE BULLET', intro: 'BLITZ: "Corners are a suggestion. The docks are a drag strip."', trackId: 'shipyard', weather: 'clear', laps: 3, field: [3, 5, 6], difficulty: 'normal', bossPower: 1.02, credits: 900, xp: 380 },
  { boss: 1, title: 'THE TECHNICIAN', intro: 'MORI: "I have studied every gantry in this harbour. You have not."', trackId: 'neon', weather: 'night', laps: 3, field: [2, 5, 6], difficulty: 'normal', bossPower: 1.03, credits: 1100, xp: 440 },
  { boss: 4, title: 'THE WRECKING BALL', intro: 'RUCKUS: "Storm\'s up. I don\'t brake for weather OR for you."', trackId: 'thunder', weather: 'storm', laps: 3, field: [0, 3, 5], difficulty: 'hard', bossPower: 1.03, credits: 1300, xp: 500 },
  { boss: 6, title: 'THE ICE QUEEN', intro: 'NOVA: "The ice doesn\'t forgive. Neither do I."', trackId: 'glacier', weather: 'clear', laps: 3, field: [1, 2, 4], difficulty: 'hard', bossPower: 1.04, credits: 1500, xp: 560 },
  { boss: 0, title: 'THE FIREBRAND', intro: 'VEGA: "Lava, mines and me. Pick which one ends your run."', trackId: 'cinder', weather: 'sunset', laps: 3, field: [1, 2, 4, 6], difficulty: 'hard', bossPower: 1.05, credits: 1800, xp: 640 },
  { boss: 7, title: 'THE MAELSTROM', intro: 'MAELSTROM: "Nobody has beaten me in eleven seasons. Make it interesting."', trackId: 'canal', weather: 'night', laps: 3, field: [0, 1, 2, 4, 6], difficulty: 'hard', bossPower: 1.07, credits: 3000, xp: 1000 },
];
