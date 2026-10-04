/**
 * RACE SESSION — the complete headless simulation of one event.
 *
 * Owns the track, the environment colliders, every racer, the AI and the mode
 * rules. Runs without a renderer (the harness and tests drive it directly).
 * Presentation reads its state and drains `events`.
 */

import type { RiderLook } from '../boat/riderLook';
import { EventQueue } from '../core/events';
import { clamp, clamp01, damp } from '../core/mathx';
import { Rng } from '../core/rng';
import type { Buoy, Difficulty, ModeId, Ramp, StuntRing, WeatherId } from '../core/types';
import { settleBoat, stepBoat, type PhysicsEnv } from '../boat/boatPhysics';
import { resolveCollisions, StaticWorld, type CollisionHost } from '../boat/collision';
import { boatSpec, BOATS, type BoatId } from '../boat/specs';
import { upgradedSpec, type Upgrades } from '../save/progress';
import { defaultLivery, type Livery } from '../boat/livery';
import { AIDriver, type AIRaceView, type Style } from '../ai/aiDriver';
import { buildLayout, type Layout } from '../environment/layout';
import { WEATHER } from '../environment/weatherDefs';
import { setSeaState, setSwellZones, setWaveTime, type SwellZone } from '../water/waves';
import { Track, type Projection, type TrackPoint } from './track';
import { trackDef } from './trackDefs';
import { Racer } from './racer';
import { BattleItems, SHRINK_POWER, SLOW_POWER } from './items';
import { Traffic } from './traffic';
import type { Boat } from '../boat/boat';

export type Phase = 'intro' | 'countdown' | 'racing' | 'finished' | 'results';

export interface GhostData {
  trackId: string;
  boatId: string;
  time: number;
  /** x, y, z, heading, pitch, roll per sample at GHOST_HZ. */
  samples: number[];
  /** Set on ghosts imported from a friend's code. */
  name?: string;
}
export const GHOST_HZ = 10;

export interface SessionConfig {
  mode: ModeId;
  trackId: string;
  weather: WeatherId;
  laps: number;
  difficulty: Difficulty;
  playerBoat: BoatId;
  playerLivery: Livery;
  playerName: string;
  opponents: number;
  ghost: GhostData | null;
  /** Existing championship points per opponent slot (championship mode). */
  champPoints?: number[];
  /** Player boat upgrades (garage). */
  playerUpgrades?: Upgrades;
  /** Explicit rival line-up (indices into RIVALS); default = the first `opponents`. */
  field?: number[];
  /** Career boss (index into RIVALS) and its engine power multiplier. */
  boss?: number;
  bossPower?: number;
  /** Message bottles already found on this course (bitmask). */
  bottlesFound?: number;
  /** Weather may change mid-race. */
  dynamicWeather?: boolean;
  /** Fishing-boat traffic crossing the course. */
  traffic?: boolean;
  /** Item boxes and power-ups (always on in battle). */
  items?: boolean;
  /** Split-screen second player. */
  player2?: { name: string; boat: BoatId; livery: Livery; look?: RiderLook };
  /** The player's chosen rider look. */
  playerLook?: RiderLook;
}

/** Per-event player counters (achievements, challenges). */
export interface EventStats {
  tier3: number;
  clean: number;
  perfectStart: boolean;
  itemHits: number;
  /** Bottles newly found this event (bitmask). */
  bottles: number;
}

interface Rival {
  name: string;
  style: Style;
  boat: BoatId;
  hull: string;
  accent: string;
  number: number;
}

export const RIVALS: Rival[] = [
  { name: 'VEGA', style: 'aggressive', boat: 'drifter', hull: '#ff4fd8', accent: '#1b1b2f', number: 13 },
  { name: 'MORI', style: 'technical', boat: 'aero', hull: '#00e0a4', accent: '#ffffff', number: 4 },
  { name: 'BLITZ', style: 'speed', boat: 'bullet', hull: '#ffe14d', accent: '#e8233a', number: 88 },
  { name: 'SOL', style: 'balanced', boat: 'breaker', hull: '#ff8a1e', accent: '#16324f', number: 21 },
  { name: 'RUCKUS', style: 'reckless', boat: 'tank', hull: '#7b5cff', accent: '#a6ff3d', number: 66 },
  { name: 'KAI', style: 'balanced', boat: 'speedster', hull: '#2ad4ff', accent: '#ffe14d', number: 9 },
  { name: 'NOVA', style: 'technical', boat: 'speedster', hull: '#c0c8d8', accent: '#ff3b5c', number: 31 },
  { name: 'MAELSTROM', style: 'aggressive', boat: 'breaker', hull: '#101418', accent: '#26e8ff', number: 1 },
];
/** Rivals used by ordinary races (the career boss MAELSTROM only appears in Career). */
export const RACE_RIVALS = 7;

export interface ResultRow {
  id: number;
  name: string;
  boat: string;
  place: number;
  time: number;
  bestLap: number;
  finished: boolean;
  isPlayer: boolean;
}

const INTRO_TIME = 3.2;

function byStanding(a: Racer, b: Racer) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished) return a.finishTime - b.finishTime;
  return b.raceDist - a.raceDist;
}
const COUNT_TIME = 3.0;

const _proj: Projection = { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 };
const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

export class RaceSession {
  readonly cfg: SessionConfig;
  readonly track: Track;
  readonly layout: Layout;
  readonly statics = new StaticWorld();
  readonly buoys: Buoy[];
  readonly rings: StuntRing[];
  readonly racers: Racer[] = [];
  readonly player: Racer;
  readonly events: EventQueue;
  readonly order: Racer[] = [];
  readonly mode: ModeId;
  readonly totalLaps: number;
  readonly mines: { x: number; z: number; active: boolean; t: number }[] = [];

  phase: Phase = 'intro';
  phaseT = 0;
  /** Simulation time (drives the waves). */
  time = 0;
  /** Race clock since GO. */
  raceTime = 0;
  countdownValue = 3;
  /** Time scale (finish slow-mo). */
  timeScale = 1;
  /** Player throttle discipline at the start. */
  startState: 'none' | 'false' | 'perfect' = 'none';
  playerAutopilot = false;
  /** Human racers (1, or 2 in split-screen). */
  readonly humans: Racer[] = [];
  private p2Driver: AIDriver;
  /** Admin: rivals cut their engines. */
  aiFrozen = false;
  playerDriver: AIDriver;

  // Mode state
  stuntScore = 0;
  stuntTimeLeft = 120;
  endlessTimeLeft = 40;
  endlessDistance = 0;
  endlessLevel = 1;
  ringsTaken = 0;
  results: ResultRow[] = [];
  /** Item boxes and power-ups (battle mode, or races with items on). */
  readonly items: BattleItems | null;
  readonly traffic: Traffic | null;
  /** Obstacles the AI steers around (rebuilt each step, no allocation). */
  private obstacles: { x: number; z: number; r: number }[] = [];
  /** Planned mid-race weather change. */
  weatherPlan: { at: number; to: WeatherId; done: boolean } | null = null;
  private seaBlend: { from: number; fromChop: number; to: number; toChop: number; t: number } | null = null;
  readonly stats: EventStats = { tier3: 0, clean: 0, perfectStart: false, itemHits: 0, bottles: 0 };
  /** Bottles on this course: position + found (this or an earlier event). */
  readonly bottles: { x: number; y: number; z: number; found: boolean }[];
  newGhost: GhostData | null = null;
  readonly ghost: GhostData | null;
  private ghostRec: number[] = [];
  private ghostAcc = 0;
  private rng: Rng;
  private physEnv: PhysicsEnv;
  private collHost: CollisionHost;
  private boats: Boat[];
  private ids: number[];
  private view: AIRaceView;
  private finishedAt = -1;
  private nextMineAt = 8;
  private baseSea: number;
  private lastPlace = 0;
  private finalLapAnnounced = false;

  constructor(cfg: SessionConfig, events: EventQueue) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.events = events;
    this.ghost = cfg.ghost;
    const def = trackDef(cfg.trackId);
    this.track = new Track(def);
    this.layout = buildLayout(this.track);
    for (const c of this.layout.colliders) this.statics.add(c);
    // Gate pylons are solid.
    const half = this.track.width * 0.5 + 2.5;
    for (const g of this.track.gates)
      for (const side of [-1, 1]) this.statics.add({ x: g.x - Math.cos(g.heading) * half * side, z: g.z + Math.sin(g.heading) * half * side, r: 1.8, kind: 'pile' });
    this.buoys = this.layout.buoys;
    this.bottles = this.layout.bottles.map((b, i) => ({ ...b, found: !!((cfg.bottlesFound ?? 0) & (1 << i)) }));
    this.rings = this.layout.rings;
    this.rng = new Rng(def.seed + 99);

    const racing = cfg.mode === 'quick' || cfg.mode === 'championship' || cfg.mode === 'battle' || cfg.mode === 'career';
    this.totalLaps = cfg.mode === 'timetrial' ? cfg.laps : cfg.mode === 'freeride' || cfg.mode === 'stunt' || cfg.mode === 'endless' || cfg.mode === 'tutorial' ? 0 : cfg.laps;

    // Weather → sea.
    const w = WEATHER[cfg.weather];
    this.baseSea = w.sea;
    setSeaState(w.sea, w.chop);
    // A point-to-point sprint is always exactly one run.
    if (this.track.sprint && this.totalLaps > 0) (this as { totalLaps: number }).totalLaps = 1;
    const zones: SwellZone[] = this.track.swells.map((z) => ({ ...z, gain: z.gain * (cfg.weather === 'storm' ? 1.0 : 0.85) }));
    setSwellZones(zones);
    if (cfg.mode === 'tutorial') {
      // Lessons happen on calm water: no swell launching the boat before the ramp.
      this.baseSea = 0.45;
      setSeaState(0.45, 0.7);
      setSwellZones([]);
    }

    // Racers: player + rivals.
    this.player = new Racer(0, cfg.playerName, upgradedSpec(boatSpec(cfg.playerBoat), cfg.playerUpgrades), cfg.playerLivery, true, null);
    this.player.look = cfg.playerLook ?? null;
    this.racers.push(this.player);
    this.humans.push(this.player);
    if (cfg.player2) {
      const p2 = new Racer(1, cfg.player2.name, boatSpec(cfg.player2.boat), cfg.player2.livery, true, null);
      p2.look = cfg.player2.look ?? null;
      this.racers.push(p2);
      this.humans.push(p2);
    }
    const idBase = this.racers.length;
    const field = cfg.field ?? Array.from({ length: clamp(cfg.opponents, 0, RACE_RIVALS) }, (_, i) => i);
    const nOpp = racing ? field.length : 0;
    for (let i = 0; i < nOpp; i++) {
      const r = RIVALS[field[i]];
      const ai = new AIDriver(r.style, cfg.difficulty, def.seed * 31 + i * 977);
      const liv = defaultLivery(r.hull, r.accent, r.number);
      liv.stripe = (['racing', 'twin', 'chevron', 'flame', 'split', 'digital', 'single'] as const)[i % 7];
      liv.decal = (['star', 'eye', 'bolt', 'wave', 'skull', 'crown', 'flame'] as const)[i % 7];
      const racer = new Racer(i + idBase, r.name, BOATS.find((b) => b.id === r.boat)!, liv, false, ai);
      racer.reaction = this.rng.range(0.0, 0.35);
      racer.points = cfg.champPoints?.[i + idBase] ?? 0;
      racer.rivalIndex = field[i];
      if (cfg.boss === field[i]) racer.boat.basePower = racer.boat.powerScale = cfg.bossPower ?? 1;
      this.racers.push(racer);
    }
    this.player.points = cfg.champPoints?.[0] ?? 0;
    this.player.boat.toughness = 1 - 0.15 * (cfg.playerUpgrades?.hull ?? 0);
    this.items = cfg.mode === 'battle' || (cfg.items && racing) ? new BattleItems(this.track, this.statics, events, def.seed + 7) : null;
    this.traffic = cfg.traffic ? new Traffic(this.track, this.statics, events, def.seed + 3, 2) : null;
    if (cfg.dynamicWeather) {
      const next: Record<WeatherId, WeatherId[]> = { clear: ['storm', 'sunset'], sunset: ['night', 'storm'], storm: ['clear', 'sunset'], night: ['storm', 'clear'] };
      const opts = next[cfg.weather];
      this.weatherPlan = { at: this.rng.range(30, 60), to: opts[this.rng.int(0, opts.length - 1)], done: false };
    }
    this.playerDriver = new AIDriver('technical', 'hard', 4242);
    this.p2Driver = new AIDriver('technical', 'hard', 4343);
    this.boats = this.racers.map((r) => r.boat);
    this.ids = this.racers.map((r) => r.id);
    this.order.push(...this.racers);

    this.physEnv = { time: 0, ramps: this.track.ramps, pads: this.track.pads, events };
    this.collHost = { events, boats: this.boats, statics: this.statics, buoys: this.buoys, ids: this.ids };
    this.view = { playerDistance: 0, myDistance: 0, lap: 0, totalLaps: this.totalLaps, racing: false, others: this.boats, obstacles: this.obstacles };

    // Grid. Player starts at the back in a race (more overtaking), front otherwise.
    const slots = this.racers.map((_, i) => i);
    if (racing && this.racers.length > this.humans.length) {
      // Humans start at the back (more overtaking).
      for (let h = 0; h < this.humans.length; h++) slots.push(slots.shift()!);
    }
    this.racers.forEach((r, i) => {
      this.track.gridSlot(slots[i], _tp);
      r.boat.place(_tp.x, _tp.z, _tp.heading);
      settleBoat(r.boat, 0);
      this.track.project(_tp.x, _tp.z, -1, _proj);
      r.hint = _proj.index;
      r.s = _proj.s;
      r.raceDist = _proj.s > this.track.length / 2 ? _proj.s - this.track.length : _proj.s;
      r.maxRaceDist = r.raceDist;
    });
    // Mine pool: endless spawns them; the admin panel can drop them in any mode.
    for (let i = 0; i < 14; i++) this.mines.push({ x: 0, z: 0, active: false, t: 0 });
    setWaveTime(0);
  }

  get isRace() {
    return this.mode === 'quick' || this.mode === 'championship' || this.mode === 'battle' || this.mode === 'career';
  }
  get hasLaps() {
    return this.totalLaps > 0;
  }
  get gateCount() {
    return this.track.checkpointCount;
  }

  skipIntro() {
    if (this.phase === 'intro') this.setPhase(this.mode === 'freeride' || this.mode === 'tutorial' ? 'racing' : 'countdown');
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'countdown') {
      this.countdownValue = 3;
      this.events.push('countdown', -1, 0, 0, 0, 3);
    }
    if (p === 'racing') {
      this.raceTime = 0;
      for (const r of this.racers) r.lapStart = 0;
    }
  }

  /** Advance the simulation by dt seconds of real time. */
  step(dtReal: number) {
    const dt = dtReal * this.timeScale;
    this.time += dt;
    this.phaseT += dtReal;
    this.physEnv.time = this.time;
    setWaveTime(this.time);

    // ── Phase machine ───────────────────────────────────────────────────────
    if (this.phase === 'intro' && this.phaseT >= INTRO_TIME) this.skipIntro();
    if (this.phase === 'countdown') this.updateCountdown();
    if (this.phase === 'racing' || this.phase === 'finished') this.raceTime += dt;
    if (this.phase === 'finished') {
      this.timeScale = damp(this.timeScale, this.phaseT < 1.6 ? 0.3 : 1, 3, dtReal);
      if (this.phaseT > 3.6) {
        this.timeScale = 1;
        this.buildResults();
        this.setPhase('results');
      }
    }

    // ── AI obstacle list ────────────────────────────────────────────────────
    let no = 0;
    const ob = this.obstacles;
    const put = (x: number, z: number, r: number) => {
      if (no < ob.length) {
        ob[no].x = x;
        ob[no].z = z;
        ob[no].r = r;
      } else ob.push({ x, z, r });
      no++;
    };
    if (this.traffic) for (const t of this.traffic.boats) put(t.x, t.z, t.r + 1.5);
    for (const m of this.mines) if (m.active) put(m.x, m.z, 2.4);
    if (this.items) for (const sl of this.items.slicks) if (sl.alive) put(sl.x, sl.z, sl.r);
    ob.length = no;

    // ── Controls ────────────────────────────────────────────────────────────
    const moving = this.phase === 'racing' || this.phase === 'finished' || this.phase === 'results';
    this.view.racing = moving;
    this.view.playerDistance = this.player.raceDist;
    this.view.totalLaps = this.totalLaps;
    for (const r of this.racers) {
      const b = r.boat;
      if (!moving) {
        b.holdTime = Math.max(b.holdTime, 0.05);
        if (r.ai) {
          r.controls.throttle = this.phase === 'countdown' && this.countdownValue <= 1 ? 1 : 0;
        }
        continue;
      }
      const drive = r.ai ?? (r === this.player ? (this.playerAutopilot || r.finished ? this.playerDriver : null) : r.finished ? this.p2Driver : null);
      if (drive && !(r.ai && this.raceTime < r.reaction && this.phase === 'racing')) {
        this.view.myDistance = r.raceDist;
        this.view.lap = r.lap;
        drive.update(b, r.controls, this.track, this.view, dt);
        if (r.finished && r.ai) r.controls.boost = false;
        if (r.finished && this.track.sprint) {
          // Past a sprint finish: coast to a stop before the barrier.
          r.controls.throttle = 0;
          r.controls.brake = 0.7;
          r.controls.boost = false;
          r.controls.drift = false;
        }
        if (r.ai && this.items) this.items.aiDecide(r, this.racers, dt);
        if (r.ai && this.aiFrozen) {
          r.controls.throttle = 0;
          r.controls.boost = false;
          r.controls.drift = false;
        }
      } else if (r.ai) {
        r.controls.throttle = 0;
      }
    }

    // ── Physics (substepped) ────────────────────────────────────────────────
    const sub = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (let i = 0; i < this.racers.length; i++) {
        const r = this.racers[i];
        stepBoat(r.boat, r.controls, this.physEnv, r.id, h);
      }
      resolveCollisions(this.collHost, h);
    }

    if (this.items) this.items.update(dt, this.racers, this.phase === 'racing');
    if (this.traffic) this.traffic.update(dt, this.racers);
    for (const r of this.racers) {
      const b = r.boat;
      // Item effects are multipliers on top of the healthy engine, never stored stats.
      b.powerScale = b.basePower * (1 - 0.12 * b.damage) * (b.shrink > 0 ? SHRINK_POWER : 1) * (b.itemSlow > 0 ? SLOW_POWER : 1);
    }
    this.stats.itemHits = this.player.itemHits;
    this.updateWeather(dt);
    this.updateDrafting(dt);
    this.updateProgress(dt);
    this.updateModes(dt);
    this.scoreEvents();
  }

  private updateCountdown() {
    const t = this.phaseT;
    const v = t < 1 ? 3 : t < 2 ? 2 : t < 3 ? 1 : 0;
    const p = this.player;
    if (v !== this.countdownValue) {
      // Throttle already pinned when "2" shows → flooded engine.
      if (v === 2 && p.controls.throttle > 0.5 && this.startState === 'none') {
        this.startState = 'false';
        this.events.push('falseStart', p.id);
      }
      this.countdownValue = v;
      this.events.push('countdown', -1, 0, 0, 0, v);
    }
    if (v === 1 && this.startState === 'none' && p.controls.throttle > 0.5 && t > 2.45) this.startState = 'perfect';
    if (v === 1 && this.startState === 'perfect' && p.controls.throttle < 0.5) this.startState = 'none';
    if (t >= COUNT_TIME) {
      this.setPhase('racing');
      for (const r of this.racers) r.boat.holdTime = 0;
      if (this.startState === 'false') p.boat.holdTime = 1.2;
      if (this.startState === 'perfect') {
        p.boat.boostTime = 1.4;
        p.boat.boostStrength = 1;
        this.events.push('perfectStart', p.id);
        this.stats.perfectStart = true;
      }
      // Some AI nail the start too.
      for (const r of this.racers) {
        if (r.ai && r.reaction < 0.06) {
          r.boat.boostTime = 1.0;
          r.boat.boostStrength = 0.8;
        }
      }
    }
  }

  private updateDrafting(dt: number) {
    for (const a of this.boats) {
      let best = 0;
      const fx = Math.sin(a.heading);
      const fz = Math.cos(a.heading);
      if (a.forwardSpeed > 14) {
        for (const b of this.boats) {
          if (a === b) continue;
          const dx = b.position.x - a.position.x;
          const dz = b.position.z - a.position.z;
          const ahead = dx * fx + dz * fz;
          const side = Math.abs(dx * -fz + dz * fx);
          if (ahead > 5 && ahead < 30 && side < 2.6 + ahead * 0.06) best = Math.max(best, 1 - (ahead - 5) / 25);
        }
      }
      a.draft = damp(a.draft, best, best > a.draft ? 2.5 : 4, dt);
      if (a.draft > 0.3) a.nitro = Math.min(1, a.nitro + a.draft * 0.04 * dt);
    }
  }

  private updateProgress(dt: number) {
    const L = this.track.length;
    const G = this.gateCount;
    const gateLen = this.track.lapLength / G;
    const counting = this.phase === 'racing' || this.phase === 'finished' || this.phase === 'results';
    for (const r of this.racers) {
      const b = r.boat;
      this.track.project(b.position.x, b.position.z, r.hint, _proj);
      let ds = _proj.s - r.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (Math.abs(ds) > 60) {
        // A jump across the infield (or a respawn) — re-anchor without crediting distance.
        ds = 0;
      }
      r.hint = _proj.index;
      r.s = _proj.s;
      r.lateral = _proj.lateral;
      r.onShortcut = _proj.shortcut;
      r.raceDist += ds;
      r.maxRaceDist = Math.max(r.maxRaceDist, r.raceDist);
      this.track.sample(r.s, _tp);
      b.courseDir.set(_tp.tx, 0, _tp.tz);
      r.topSpeed = Math.max(r.topSpeed, b.speed);
      if (b.airborne) r.bestAir = Math.max(r.bestAir, b.airTime);

      if (!counting) continue;

      // Checkpoints: strictly sequential, by unwrapped distance.
      if (this.hasLaps && !r.finished) {
        while (r.raceDist >= r.checkpoints * gateLen) {
          const k = r.checkpoints;
          r.checkpoints++;
          r.respawnS = this.track.wrapS(k * gateLen);
          if (k === 0) {
            r.lap = 1;
            r.lapStart = this.raceTime;
          } else {
            this.events.push('checkpoint', r.id, b.position.x, b.position.y, b.position.z, k % G);
            if (k % G === 0) {
              const lapTime = this.raceTime - r.lapStart;
              r.lapTimes.push(lapTime);
              r.bestLap = Math.min(r.bestLap, lapTime);
              r.lapStart = this.raceTime;
              if (r.isPlayer) this.onPlayerLap(lapTime);
              if (r.lap >= this.totalLaps) {
                r.finished = true;
                r.finishTime = this.raceTime;
                this.events.push('finish', r.id, b.position.x, b.position.y, b.position.z, r.place);
                if (r.isPlayer && this.humans.every((h) => h.finished)) this.onPlayerFinish();
                break;
              }
              r.lap++;
              this.events.push('lap', r.id, b.position.x, b.position.y, b.position.z, r.lap);
              if (r.isPlayer && r.lap === this.totalLaps && !this.finalLapAnnounced && this.totalLaps > 1) {
                this.finalLapAnnounced = true;
                this.events.push('finalLap', r.id);
              }
            }
          }
        }
      } else if (!this.hasLaps) {
        // Lapless modes still credit checkpoints (endless time extensions, respawn points).
        while (r.raceDist >= r.checkpoints * gateLen) {
          const k = r.checkpoints++;
          r.respawnS = this.track.wrapS(k * gateLen);
          if (k > 0) {
            this.events.push('checkpoint', r.id, b.position.x, b.position.y, b.position.z, k % G);
            if (r.isPlayer && this.mode === 'endless' && this.phase === 'racing') {
              // Early gates pay a little more than they cost; later ones less, so the run always ends.
              this.endlessTimeLeft += Math.max(3, 8.4 - this.endlessLevel * 0.75);
            }
          }
        }
      }

      // Wrong way: facing against the course while moving, or losing ground.
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const facing = fx * _tp.tx + fz * _tp.tz;
      const against = (facing < -0.35 && b.speed > 3) || r.maxRaceDist - r.raceDist > 25;
      r.wrongT = against ? r.wrongT + dt : Math.max(0, r.wrongT - dt * 2);
      const wasWrong = r.wrongWay;
      r.wrongWay = r.wrongT > 0.9 && _proj.shortcut < 0;
      if (r.wrongWay && !wasWrong && r.isPlayer) this.events.push('wrongWay', r.id);
      if (!r.wrongWay && r.maxRaceDist - r.raceDist > 25 && facing > 0.5) {
        // Turned around and heading the right way again: forgive the deficit gradually.
        r.maxRaceDist = Math.max(r.raceDist, r.maxRaceDist - dt * 30);
      }

      // Off course → respawn.
      const off = _proj.shortcut < 0 && Math.abs(_proj.lateral) > this.track.width * 1.9;
      r.offCourseT = off ? r.offCourseT + dt : 0;
      const stuckAI = r.ai && (r.wrongT > 5 || r.offCourseT > 3);
      if (r.offCourseT > 5 || _proj.dist > this.track.width * 5 || stuckAI) this.respawn(r);
    }

    // Standings.
    const order = this.order;
    order.sort(byStanding);
    for (let i = 0; i < order.length; i++) order[i].place = i + 1;
    const pp = this.player.place;
    if (this.isRace && this.phase === 'racing' && this.lastPlace > 0 && pp < this.lastPlace) this.events.push('overtake', 0, 0, 0, 0, pp);
    this.lastPlace = pp;

    // Ghost recording (time trial).
    if (this.mode === 'timetrial' && this.phase === 'racing' && this.player.lap >= 1) {
      this.ghostAcc += dt;
      while (this.ghostAcc >= 1 / GHOST_HZ) {
        this.ghostAcc -= 1 / GHOST_HZ;
        const b = this.player.boat;
        this.ghostRec.push(+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2), +b.heading.toFixed(3), +b.pitch.toFixed(3), +b.roll.toFixed(3));
      }
    }
  }

  private onPlayerLap(lapTime: number) {
    if (this.mode !== 'timetrial') return;
    const best = this.ghost?.time ?? Infinity;
    const prev = this.newGhost?.time ?? Infinity;
    if (lapTime < Math.min(best, prev) && this.ghostRec.length > 30) {
      this.newGhost = { trackId: this.cfg.trackId, boatId: this.cfg.playerBoat, time: lapTime, samples: this.ghostRec.slice() };
    }
    this.ghostRec.length = 0;
    this.ghostAcc = 0;
  }

  /** End the event now (tutorial completion). */
  forceFinish() {
    this.onPlayerFinish();
  }

  private onPlayerFinish() {
    if (this.finishedAt < 0) {
      this.finishedAt = this.raceTime;
      this.setPhase('finished');
    }
  }

  respawn(r: Racer) {
    const b = r.boat;
    const s = this.track.wrapS(r.s - 8);
    this.track.sample(s, _tp);
    const lat = this.track.lineAt(s) * 0.5;
    b.place(_tp.x - _tp.tz * lat, _tp.z + _tp.tx * lat, _tp.heading);
    settleBoat(b, this.time);
    b.velocity.set(_tp.tx * 10, 0, _tp.tz * 10);
    b.ghostTime = 2.0;
    r.offCourseT = 0;
    r.wrongT = 0;
    r.wrongWay = false;
    r.hint = -1;
    this.track.project(b.position.x, b.position.z, -1, _proj);
    r.hint = _proj.index;
    // Keep raceDist consistent with the new position without crediting skipped distance.
    let ds = _proj.s - r.s;
    if (ds > this.track.length / 2) ds -= this.track.length;
    if (ds < -this.track.length / 2) ds += this.track.length;
    r.raceDist += Math.min(ds, 0);
    r.s = _proj.s;
    r.maxRaceDist = r.raceDist;
    r.ai?.reset();
    this.events.push('reset', r.id, b.position.x, b.position.y, b.position.z);
  }

  private updateModes(dt: number) {
    const p = this.player;
    const b = p.boat;
    // Stunt rings (stunt + free ride).
    if (this.mode === 'stunt' || this.mode === 'freeride') {
      for (const ring of this.rings) {
        if (ring.taken) {
          ring.respawn -= dt;
          if (ring.respawn <= 0) ring.taken = false;
          continue;
        }
        const dx = b.position.x - ring.x;
        const dy = b.position.y - ring.y;
        const dz = b.position.z - ring.z;
        if (dx * dx + dy * dy + dz * dz < ring.radius * ring.radius) {
          ring.taken = true;
          ring.respawn = this.mode === 'stunt' ? 25 : 8;
          this.ringsTaken++;
          const pts = 250 + Math.round(clamp01(b.position.y / 8) * 250);
          if (this.phase === 'racing') this.stuntScore += pts;
          b.nitro = Math.min(1, b.nitro + 0.2);
          this.events.push('ring', p.id, ring.x, ring.y, ring.z, pts);
        }
      }
    }
    this.updateMines(dt);
    // Message bottles (any mode).
    for (let i = 0; i < this.bottles.length; i++) {
      const bt = this.bottles[i];
      if (bt.found) continue;
      const dx = b.position.x - bt.x;
      const dz = b.position.z - bt.z;
      const dy = b.position.y - (bt.y < 2 ? b.surfaceY : bt.y);
      if (dx * dx + dz * dz < 3.2 * 3.2 && Math.abs(dy) < 2.8) {
        bt.found = true;
        this.stats.bottles |= 1 << i;
        this.events.push('collectible', p.id, bt.x, b.position.y, bt.z, i);
      }
    }
    if (this.phase !== 'racing') return;
    if (this.mode === 'stunt') {
      this.stuntTimeLeft -= dt;
      if (this.stuntTimeLeft <= 0) {
        this.stuntTimeLeft = 0;
        p.finished = true;
        p.finishTime = this.raceTime;
        this.onPlayerFinish();
      }
    }
    if (this.mode === 'endless') {
      this.endlessTimeLeft -= dt;
      this.endlessDistance = Math.max(this.endlessDistance, p.raceDist);
      const level = 1 + Math.floor(this.raceTime / 30);
      if (level !== this.endlessLevel) {
        this.endlessLevel = level;
        setSeaState(Math.min(2.8, this.baseSea + (level - 1) * 0.28), 1 + (level - 1) * 0.08);
      }
      // Mines drift into the course ahead of the player.
      this.nextMineAt -= dt;
      if (this.nextMineAt <= 0) {
        this.nextMineAt = Math.max(1.2, 4.5 - this.endlessLevel * 0.4);
        this.spawnMine(140, 240);
      }
      if (this.endlessTimeLeft <= 0) {
        this.endlessTimeLeft = 0;
        p.finished = true;
        p.finishTime = this.raceTime;
        this.onPlayerFinish();
      }
    }
  }

  /** Re-derive the sea from a weather preset (mid-race weather change). */
  applyWeatherSea(w: WeatherId) {
    const p = WEATHER[w];
    this.baseSea = p.sea;
    setSeaState(p.sea, p.chop);
    const zones: SwellZone[] = this.track.swells.map((z) => ({ ...z, gain: z.gain * (w === 'storm' ? 1.0 : 0.85) }));
    setSwellZones(zones);
  }

  /** Admin: drop a launch ramp on the course `ahead` metres in front of the player. */
  spawnRamp(ahead: number): Ramp | null {
    const s = this.player.s + ahead;
    this.track.sample(s, _tp);
    const r: Ramp = { x: _tp.x, z: _tp.z, heading: _tp.heading, length: 11, width: 9, height: 2.6 };
    if (this.statics.blocked(r.x, r.z, 10)) return null;
    this.track.ramps.push(r);
    return r;
  }

  // ── Admin helpers ─────────────────────────────────────────────────────────
  /** Credit the player k extra laps (never past the final lap). */
  adminSkipLaps(k: number) {
    const p = this.player;
    if (!this.hasLaps || p.finished || p.lap < 1) return;
    k = Math.min(k, this.totalLaps - p.lap);
    if (k <= 0) return;
    const L = this.track.lapLength;
    p.raceDist += L * k;
    p.maxRaceDist += L * k;
    p.checkpoints += this.gateCount * k;
    p.lap += k;
    this.events.push('lap', p.id, p.boat.position.x, p.boat.position.y, p.boat.position.z, p.lap);
  }

  /** Teleport the player to the next checkpoint gate. */
  adminNextCheckpoint() {
    const p = this.player;
    const gateLen = this.track.lapLength / this.gateCount;
    const target = Math.max(p.raceDist + 5, p.checkpoints * gateLen + 6);
    const ds = target - p.raceDist;
    const s = this.track.wrapS(p.s + ds);
    this.track.sample(s, _tp);
    const b = p.boat;
    const spd = Math.max(15, b.speed);
    b.place(_tp.x, _tp.z, _tp.heading);
    settleBoat(b, this.time);
    b.velocity.set(_tp.tx * spd, 0, _tp.tz * spd);
    b.forwardSpeed = spd;
    b.engine = 1;
    p.s = s;
    p.raceDist += ds;
    p.maxRaceDist = Math.max(p.maxRaceDist, p.raceDist);
    this.track.project(b.position.x, b.position.z, -1, _proj);
    p.hint = _proj.index;
  }

  /** End the event now with the player in `place` (races) or just finished (other modes). */
  adminFinish(place = 1) {
    if (this.phase !== 'racing') return;
    const p = this.player;
    if (this.isRace) {
      place = clamp(Math.round(place), 1, this.racers.length);
      const rivals = this.order.filter((r) => !r.isPlayer);
      rivals.slice(0, place - 1).forEach((r, i) => {
        if (!r.finished) {
          r.finished = true;
          r.finishTime = this.raceTime - (place - 1 - i) * 0.8;
        }
      });
      for (const r of rivals.slice(place - 1)) r.raceDist = Math.min(r.raceDist, p.raceDist - 1);
      p.lap = this.totalLaps;
      if (!isFinite(p.bestLap)) p.bestLap = this.raceTime / Math.max(1, this.totalLaps);
    }
    p.finished = true;
    p.finishTime = this.raceTime;
    this.order.sort(byStanding);
    for (let i = 0; i < this.order.length; i++) this.order[i].place = i + 1;
    this.events.push('finish', p.id, p.boat.position.x, p.boat.position.y, p.boat.position.z, p.place);
    this.onPlayerFinish();
  }

  /** Drop a mine on the course between `min` and `max` metres ahead of the player. */
  spawnMine(min: number, max: number) {
    const m = this.mines.find((x) => !x.active);
    if (!m) return false;
    const s = this.player.s + this.rng.range(min, max);
    this.track.sample(s, _tp);
    const lat = this.rng.range(-0.42, 0.42) * this.track.width;
    m.x = _tp.x - _tp.tz * lat;
    m.z = _tp.z + _tp.tx * lat;
    m.active = true;
    m.t = 0;
    return true;
  }

  private updateMines(dt: number) {
    for (const m of this.mines) {
      if (!m.active) continue;
      m.t += dt;
      for (const r of this.racers) {
        const b = r.boat;
        const d = Math.hypot(b.position.x - m.x, b.position.z - m.z);
        if (d < 2.6 && !(b.airborne && b.clearance > 1.5) && b.ghostTime <= 0) {
          m.active = false;
          if (b.shield > 0) {
            b.shield = 0;
            this.events.push('shieldHit', r.id, m.x, b.surfaceY, m.z, 1);
          } else {
            b.velocity.y += 8;
            b.velocity.x *= 0.5;
            b.velocity.z *= 0.5;
            b.pitchRate += 3;
            b.impact = 1;
            b.damage = Math.min(1, b.damage + 0.25 * b.toughness);
            if (r.isPlayer && this.mode === 'endless') this.endlessTimeLeft = Math.max(0, this.endlessTimeLeft - 3);
          }
          this.events.push('collide', r.id, m.x, b.surfaceY, m.z, 1, 'mine');
          break;
        }
      }
      if (m.active && m.t > 40) m.active = false;
    }
  }

  private updateWeather(dt: number) {
    const wp = this.weatherPlan;
    if (wp && !wp.done && this.phase === 'racing' && this.raceTime >= wp.at) {
      wp.done = true;
      const from = WEATHER[this.cfg.weather];
      const to = WEATHER[wp.to];
      this.seaBlend = { from: from.sea, fromChop: from.chop, to: to.sea, toChop: to.chop, t: 0 };
      this.cfg.weather = wp.to;
      this.events.push('weatherShift', -1, 0, 0, 0, 0, wp.to);
    }
    const sb = this.seaBlend;
    if (sb) {
      sb.t = Math.min(1, sb.t + dt / 14);
      const k = sb.t * sb.t * (3 - 2 * sb.t);
      this.baseSea = sb.from + (sb.to - sb.from) * k;
      setSeaState(this.baseSea, sb.fromChop + (sb.toChop - sb.fromChop) * k);
      if (sb.t >= 1) {
        this.seaBlend = null;
        this.applyWeatherSea(this.cfg.weather);
      }
    }
  }

  /** Session-level scoring from physics events (drift, tricks). */
  private scoreEvents() {
    const list = this.events.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // Hull damage from hard hits (any racer).
      if (e.type === 'collide' && e.racer >= 0 && e.value > 0.3 && e.text !== 'mine') {
        const r = this.racers[e.racer];
        if (r) r.boat.damage = Math.min(1, r.boat.damage + (e.value - 0.2) * 0.1 * r.boat.toughness);
      }

      if (e.racer !== 0) continue;
      if (e.type === 'driftTier') {
        this.player.driftScore += e.value * 100;
        if (e.value === 3) this.stats.tier3++;
        if (this.mode === 'stunt' && this.phase === 'racing') this.stuntScore += e.value * 100;
      }
      if (e.type === 'trick') {
        this.player.tricks++;
        if (this.mode === 'stunt' && this.phase === 'racing') this.stuntScore += e.value;
      }
      if (e.type === 'land' && e.text === 'clean') {
        this.stats.clean++;
        if (this.mode === 'stunt' && this.phase === 'racing') this.stuntScore += 150;
      }
    }
  }

  buildResults() {
    // Unfinished racers are ranked by distance and given an estimated time.
    const avgSpeed = (r: Racer) => Math.max(8, r.raceDist / Math.max(1, this.raceTime));
    const totalDist = this.totalLaps * this.track.lapLength;
    this.results = this.order.map((r) => ({
      id: r.id,
      name: r.name,
      boat: r.boat.spec.name,
      place: r.place,
      time: r.finished ? r.finishTime : this.raceTime + Math.max(0, totalDist - r.raceDist) / avgSpeed(r),
      bestLap: r.bestLap,
      finished: r.finished,
      isPlayer: r.isPlayer,
    }));
  }

  /** Ghost pose at race-lap time t (for time trial). Returns false if out of range. */
  ghostPose(t: number, out: { x: number; y: number; z: number; heading: number; pitch: number; roll: number }) {
    const g = this.ghost;
    if (!g) return false;
    const f = t * GHOST_HZ;
    const i = Math.floor(f);
    const n = g.samples.length / 6;
    if (i < 0 || i >= n - 1) return false;
    const a = i * 6;
    const k = f - i;
    const S = g.samples;
    const lerpAng = (x: number, y: number) => {
      let d = y - x;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return x + d * k;
    };
    out.x = S[a] + (S[a + 6] - S[a]) * k;
    out.y = S[a + 1] + (S[a + 7] - S[a + 1]) * k;
    out.z = S[a + 2] + (S[a + 8] - S[a + 2]) * k;
    out.heading = lerpAng(S[a + 3], S[a + 9]);
    out.pitch = S[a + 4] + (S[a + 10] - S[a + 4]) * k;
    out.roll = S[a + 5] + (S[a + 11] - S[a + 5]) * k;
    return true;
  }

  /** Current lap time of the player. */
  playerLapTime() {
    return this.player.lap >= 1 ? this.raceTime - this.player.lapStart : 0;
  }
}
