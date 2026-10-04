/**
 * Persistent save: settings, progression, records, ghosts, customisation.
 *
 * Every field is validated on load and replaced by its default if missing or
 * malformed, so a corrupted (or hand-edited) localStorage entry degrades to
 * defaults instead of crashing. Writes are debounced and failures (quota,
 * private mode) are reported once to the UI rather than thrown.
 */

import { DEFAULT_LOOK, sanitizeLook, type RiderLook } from '../boat/riderLook';
import { BOATS, type BoatId } from '../boat/specs';
import { DECALS, defaultLivery, sanitizeLivery, STRIPES, type Livery } from '../boat/livery';
import { ACTIONS, DEFAULT_BINDINGS, type Bindings } from '../input/input';
import type { Difficulty } from '../core/types';
import type { GhostData } from '../race/session';
import { CUPS, TRACKS } from '../race/trackDefs';
import { BOTTLES_PER_TRACK, emptyStats, emptyUpgrades, UPGRADE_KINDS, UPGRADE_MAX, ACHIEVEMENTS, CAREER, type LifetimeStats, type Upgrades } from './progress';
import { LANGS, type Lang } from '../ui/i18n';

export const SAVE_KEY = 'riptide.save.v1';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  shake: number;
  motion: number;
  /** Graphics preset; 'auto' resolves from the device at start-up. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  pixelRatio: number;
  autoRes: boolean;
  assist: number;
  sensitivity: number;
  racingLine: boolean;
  /** Item boxes and power-ups in normal races. */
  items: boolean;
  units: 'kmh' | 'mph';
  difficulty: Difficulty;
  laps: number;
  hudScale: number;
  bindings: Bindings;
  /** On-screen touch controls: auto-detect, always, never. */
  touch: 'auto' | 'on' | 'off';
  /** Steer by tilting the device (touch only). */
  tilt: boolean;
  lang: Lang;
  /** Shape symbols alongside colour cues (drift tiers, buoys, medals). */
  symbols: boolean;
  /** Boats cast shadows. */
  shadows: boolean;
  /** Weather may change during a race. */
  dynamicWeather: boolean;
  /** Ambient wildlife and traffic. */
  wildlife: boolean;
}

export interface Medals {
  race: number;
  tt: number;
  stunt: number;
}

export interface Records {
  race?: number;
  lap?: number;
  stunt?: number;
  endless?: number;
}

export interface ChampState {
  cupId: string;
  round: number;
  /** Points per racer slot (0 = player). */
  points: number[];
}

export interface SaveData {
  /** 2: adds the rider look. Older saves are migrated by sanitizeSave (missing fields → defaults). */
  version: 2;
  playerName: string;
  xp: number;
  credits: number;
  owned: BoatId[];
  selectedBoat: BoatId;
  liveries: Partial<Record<BoatId, Livery>>;
  medals: Record<string, Medals>;
  records: Record<string, Records>;
  ghosts: Record<string, GhostData>;
  cups: Record<string, number>;
  champ: ChampState | null;
  races: number;
  wins: number;
  settings: Settings;
  seenTutorial: boolean;
  tutorialDone: boolean;
  upgrades: Partial<Record<BoatId, Upgrades>>;
  /** Achievement id → unlock timestamp. */
  achievements: Record<string, number>;
  stats: LifetimeStats;
  /** Completed challenge keys (daily `YYYY-MM-DD`, weekly `YYYY-Www`). */
  challengesDone: string[];
  career: { stage: number };
  /** The player's rider (character creator). */
  rider: RiderLook;
  /** Ghosts imported from friends' codes (kept apart from your own best). */
  rivalGhosts: Record<string, GhostData>;
  /** Bitmask of message bottles found per track. */
  bottles: Record<string, number>;
}

export function defaultSettings(): Settings {
  return {
    master: 0.8,
    music: 0.6,
    sfx: 0.85,
    shake: 1,
    motion: 1,
    quality: 'auto',
    pixelRatio: 2,
    autoRes: true,
    assist: 0,
    sensitivity: 1,
    racingLine: false,
    items: true,
    units: 'kmh',
    difficulty: 'normal',
    laps: 3,
    hudScale: 1,
    bindings: structuredClone(DEFAULT_BINDINGS),
    touch: 'auto',
    tilt: false,
    lang: 'en',
    symbols: false,
    shadows: true,
    dynamicWeather: false,
    wildlife: true,
  };
}

export function defaultSave(): SaveData {
  const liveries: SaveData['liveries'] = {};
  for (const b of BOATS) liveries[b.id] = defaultLivery(b.hullColor, b.accentColor, 7);
  return {
    version: 2,
    playerName: 'YOU',
    xp: 0,
    credits: 500,
    owned: BOATS.filter((b) => b.price === 0).map((b) => b.id),
    selectedBoat: 'speedster',
    liveries,
    medals: {},
    records: {},
    ghosts: {},
    cups: {},
    champ: null,
    races: 0,
    wins: 0,
    settings: defaultSettings(),
    seenTutorial: false,
    tutorialDone: false,
    upgrades: {},
    achievements: {},
    stats: emptyStats(),
    challengesDone: [],
    career: { stage: 0 },
    rider: { ...DEFAULT_LOOK },
    rivalGhosts: {},
    bottles: {},
  };
}

// ── Validation helpers ───────────────────────────────────────────────────────
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string, max = 40) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function sanitizeSettings(v: unknown): Settings {
  const d = defaultSettings();
  const o = obj(v);
  const b = obj(o.bindings);
  const bindings = structuredClone(DEFAULT_BINDINGS);
  for (const a of ACTIONS) {
    const list = b[a];
    if (Array.isArray(list) && list.length > 0 && list.every((k) => typeof k === 'string' && k.length < 30)) bindings[a] = list.slice(0, 4) as string[];
  }
  return {
    master: num(o.master, d.master, 0, 1),
    music: num(o.music, d.music, 0, 1),
    sfx: num(o.sfx, d.sfx, 0, 1),
    shake: num(o.shake, d.shake, 0, 1),
    motion: num(o.motion, d.motion, 0, 1),
    quality: oneOf(o.quality, ['auto', 'low', 'medium', 'high'] as const, d.quality),
    pixelRatio: num(o.pixelRatio, d.pixelRatio, 0.5, 3),
    autoRes: bool(o.autoRes, d.autoRes),
    assist: Math.round(num(o.assist, d.assist, 0, 3)),
    sensitivity: num(o.sensitivity, d.sensitivity, 0.4, 1.8),
    racingLine: bool(o.racingLine, d.racingLine),
    items: bool(o.items, d.items),
    units: oneOf(o.units, ['kmh', 'mph'] as const, d.units),
    difficulty: oneOf(o.difficulty, ['easy', 'normal', 'hard'] as const, d.difficulty),
    laps: Math.round(num(o.laps, d.laps, 1, 9)),
    hudScale: num(o.hudScale, d.hudScale, 0.75, 1.3),
    bindings,
    touch: oneOf(o.touch, ['auto', 'on', 'off'] as const, d.touch),
    tilt: bool(o.tilt, d.tilt),
    lang: oneOf(o.lang, LANGS, d.lang),
    symbols: bool(o.symbols, d.symbols),
    shadows: bool(o.shadows, d.shadows),
    dynamicWeather: bool(o.dynamicWeather, d.dynamicWeather),
    wildlife: bool(o.wildlife, d.wildlife),
  };
}

function sanitizeGhost(v: unknown): GhostData | null {
  const o = obj(v);
  if (typeof o.trackId !== 'string' || typeof o.boatId !== 'string' || typeof o.time !== 'number' || !Array.isArray(o.samples)) return null;
  if (o.samples.length % 6 !== 0 || o.samples.length > 6 * 10 * 600) return null;
  if (!o.samples.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const out: GhostData = { trackId: o.trackId, boatId: o.boatId, time: o.time, samples: o.samples as number[], ...(typeof o.name === 'string' ? { name: o.name.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) } : {}) };
  if (o.look && typeof o.look === 'object') out.look = sanitizeLook(o.look);
  if (o.upgrades && typeof o.upgrades === 'object') {
    const up = emptyUpgrades();
    const u = obj(o.upgrades);
    for (const k of UPGRADE_KINDS) up[k] = Math.round(num(u[k], 0, 0, UPGRADE_MAX));
    out.upgrades = up;
  }
  return out;
}

function sanitizeStats(v: unknown): LifetimeStats {
  const d = emptyStats();
  const o = obj(v);
  const out = { ...d };
  for (const k of Object.keys(d) as (keyof LifetimeStats)[]) {
    if (k === 'weathers') continue;
    (out as unknown as Record<string, number>)[k] = num(o[k], 0, 0, 1e9);
  }
  out.weathers = Array.isArray(o.weathers) ? (o.weathers.filter((w) => ['clear', 'sunset', 'storm', 'night'].includes(w as string)) as LifetimeStats['weathers']).slice(0, 4) : [];
  return out;
}

export function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  const o = obj(raw);
  const boatIds = BOATS.map((b) => b.id);
  const owned = Array.isArray(o.owned) ? (o.owned.filter((x) => boatIds.includes(x as BoatId)) as BoatId[]) : d.owned;
  for (const b of d.owned) if (!owned.includes(b)) owned.push(b);
  const liveries: SaveData['liveries'] = {};
  const lv = obj(o.liveries);
  for (const b of BOATS) liveries[b.id] = sanitizeLivery(lv[b.id], d.liveries[b.id]!);
  const medals: SaveData['medals'] = {};
  const md = obj(o.medals);
  const records: SaveData['records'] = {};
  const rc = obj(o.records);
  const ghosts: SaveData['ghosts'] = {};
  const gh = obj(o.ghosts);
  const rivalGhosts: SaveData['ghosts'] = {};
  const rgh = obj(o.rivalGhosts);
  for (const t of TRACKS) {
    const m = obj(md[t.id]);
    medals[t.id] = { race: Math.round(num(m.race, 0, 0, 3)), tt: Math.round(num(m.tt, 0, 0, 3)), stunt: Math.round(num(m.stunt, 0, 0, 3)) };
    const r = obj(rc[t.id]);
    const rec: Records = {};
    for (const k of ['race', 'lap', 'stunt', 'endless'] as const) if (typeof r[k] === 'number' && Number.isFinite(r[k]) && (r[k] as number) > 0) rec[k] = r[k] as number;
    records[t.id] = rec;
    const g = sanitizeGhost(gh[t.id]);
    if (g && g.trackId === t.id) ghosts[t.id] = g;
    const rg = sanitizeGhost(rgh[t.id]);
    if (rg && rg.trackId === t.id) rivalGhosts[t.id] = rg;
  }
  const cups: SaveData['cups'] = {};
  const cp = obj(o.cups);
  for (const c of CUPS) cups[c.id] = Math.round(num(cp[c.id], 0, 0, 3));
  let champ: ChampState | null = null;
  const ch = obj(o.champ);
  if (typeof ch.cupId === 'string' && CUPS.some((c) => c.id === ch.cupId) && Array.isArray(ch.points)) {
    const cup = CUPS.find((c) => c.id === ch.cupId)!;
    const round = Math.round(num(ch.round, 0, 0, cup.tracks.length - 1));
    champ = { cupId: cup.id, round, points: ch.points.slice(0, 8).map((p) => num(p, 0, 0, 999)) };
  }
  return {
    version: 2,
    playerName: str(o.playerName, d.playerName, 12).toUpperCase().replace(/[^A-Z0-9 _-]/g, '') || 'YOU',
    xp: num(o.xp, 0, 0, 1e7),
    credits: Math.round(num(o.credits, d.credits, 0, 1e8)),
    owned,
    selectedBoat: oneOf(o.selectedBoat, boatIds, d.selectedBoat),
    liveries,
    medals,
    records,
    ghosts,
    cups,
    champ,
    races: Math.round(num(o.races, 0, 0, 1e7)),
    wins: Math.round(num(o.wins, 0, 0, 1e7)),
    settings: sanitizeSettings(o.settings),
    seenTutorial: bool(o.seenTutorial, false),
    tutorialDone: bool(o.tutorialDone, false),
    upgrades: sanitizeUpgrades(o.upgrades),
    achievements: sanitizeAchievements(o.achievements),
    stats: sanitizeStats(o.stats),
    challengesDone: Array.isArray(o.challengesDone) ? (o.challengesDone.filter((k) => typeof k === 'string' && /^\d{4}-(W\d{2}|\d{2}-\d{2})$/.test(k)) as string[]).slice(-60) : [],
    career: { stage: Math.round(num(obj(o.career).stage, 0, 0, CAREER.length)) },
    rider: sanitizeLook(o.rider),
    rivalGhosts,
    bottles: sanitizeBottles(o.bottles),
  };
}

function sanitizeUpgrades(v: unknown): SaveData['upgrades'] {
  const o = obj(v);
  const out: SaveData['upgrades'] = {};
  for (const b of BOATS) {
    const u = obj(o[b.id]);
    if (!Object.keys(u).length) continue;
    const up = emptyUpgrades();
    for (const k of UPGRADE_KINDS) up[k] = Math.round(num(u[k], 0, 0, UPGRADE_MAX));
    out[b.id] = up;
  }
  return out;
}
function sanitizeAchievements(v: unknown): Record<string, number> {
  const o = obj(v);
  const out: Record<string, number> = {};
  for (const a of ACHIEVEMENTS) if (typeof o[a.id] === 'number' && Number.isFinite(o[a.id])) out[a.id] = o[a.id] as number;
  return out;
}
function sanitizeBottles(v: unknown): Record<string, number> {
  const o = obj(v);
  const out: Record<string, number> = {};
  for (const t of TRACKS) {
    const m = Math.round(num(o[t.id], 0, 0, (1 << BOTTLES_PER_TRACK) - 1));
    if (m) out[t.id] = m;
  }
  return out;
}

// ── Progression ─────────────────────────────────────────────────────────────
export const MAX_LEVEL = 20;
export function xpToNext(level: number) {
  return 300 + 220 * (level - 1);
}
export function levelFromXp(xp: number) {
  let lvl = 1;
  let rem = xp;
  while (lvl < MAX_LEVEL && rem >= xpToNext(lvl)) {
    rem -= xpToNext(lvl);
    lvl++;
  }
  return { level: lvl, into: rem, need: lvl >= MAX_LEVEL ? 1 : xpToNext(lvl) };
}

/** Cosmetic unlock counts at a level. */
export function cosmeticUnlocks(level: number) {
  return {
    paints: Math.min(16, 8 + (level - 1)),
    stripes: Math.min(STRIPES.length, 4 + Math.floor((level - 1) / 2)),
    decals: Math.min(DECALS.length, 4 + Math.floor((level - 1) / 2)),
    trails: Math.min(8, 3 + Math.floor((level - 1) / 1.5)),
    boosts: Math.min(8, 3 + Math.floor((level - 1) / 1.5)),
  };
}

export class SaveStore {
  data: SaveData;
  error: string | null = null;
  private timer = 0;
  /** True if the stored save was unreadable and was reset. */
  recovered = false;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
      // Storage blocked (privacy mode / sandbox): run with defaults, and say so in the UI.
      this.error = 'Saving is unavailable in this browser session — progress will not persist.';
      void e;
      return defaultSave();
    }
    if (!raw) return defaultSave();
    try {
      return sanitizeSave(JSON.parse(raw));
    } catch {
      // Unparseable JSON: keep a copy for debugging, start fresh.
      this.recovered = true;
      try {
        localStorage.setItem(SAVE_KEY + '.corrupt', raw.slice(0, 200000));
      } catch {
        /* the backup is best-effort */
      }
      return defaultSave();
    }
  }

  /** Debounced write. */
  save(immediate = false) {
    window.clearTimeout(this.timer);
    const write = () => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      } catch (e) {
        // Quota: ghosts are the bulk — drop them and retry once.
        if (Object.keys(this.data.ghosts).length) {
          this.data.ghosts = {};
          try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
            return;
          } catch {
            /* fall through to reporting */
          }
        }
        this.error = 'Could not save progress (' + (e instanceof Error ? e.name : 'storage error') + ').';
      }
    };
    if (immediate) write();
    else this.timer = window.setTimeout(write, 250);
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save(true);
  }

  get level() {
    return levelFromXp(this.data.xp).level;
  }

  livery(id: BoatId): Livery {
    return this.data.liveries[id] ?? defaultLivery();
  }

  upgrades(id: BoatId): Upgrades {
    return this.data.upgrades[id] ?? emptyUpgrades();
  }
}
