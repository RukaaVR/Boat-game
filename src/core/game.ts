/**
 * GAME — top-level orchestrator.
 *
 * Owns the renderer, input, audio, save and UI, and the lifetime of the
 * current RaceSession (simulation) + World (visuals) + Hud. Menus run over a
 * live "attract mode" session so the ocean is always moving behind the UI.
 *
 * Frame order: input → simulation → camera → world visuals → HUD → audio →
 * render. Simulation events are drained once per frame by every consumer and
 * then cleared.
 */

import { Vector3 } from 'three';
import { EventQueue } from './events';
import type { Difficulty, ModeId, WeatherId } from './types';
import { clamp, clamp01 } from './mathx';
import { Renderer } from '../render/renderer';
import { World } from '../render/world';
import { CameraRig, type CamMode } from '../camera/cameraRig';
import { Input } from '../input/input';
import { AudioEngine, type Listener } from '../audio/audio';
import { Music } from '../audio/music';
import { SaveStore } from '../save/save';
import { applyRewards, finishChampionship, type RewardSummary } from '../save/rewards';
import { RaceSession, type SessionConfig } from '../race/session';
import { CUPS, trackDef } from '../race/trackDefs';
import { BoatVisual } from '../boat/boatMesh';
import { boatSpec, type BoatId } from '../boat/specs';
import type { Livery } from '../boat/livery';
import { Hud } from '../ui/hud';
import { Nav } from '../ui/nav';
import { Screens } from '../ui/screens';
import { DebugOverlay } from '../debug/debug';
import { waveAgreement } from '../debug/waveCheck';
import { settleBoat } from '../boat/boatPhysics';
import { getSeaState, oceanHeight } from '../water/waves';
import type { Boat } from '../boat/boat';

export interface EventRequest {
  mode: ModeId;
  trackId: string;
  weather: WeatherId | 'default';
  laps: number;
  difficulty: Difficulty;
  boat: BoatId;
}

type State = 'boot' | 'title' | 'menu' | 'race';

const _listener: Listener = { x: 0, z: 0, rx: 1, rz: 0 };
const _right = new Vector3();
const _nearest: Boat[] = [];

export class Game {
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly audio = new AudioEngine();
  readonly music: Music;
  readonly save = new SaveStore();
  readonly nav = new Nav();
  readonly screens: Screens;
  readonly events = new EventQueue();
  readonly rig: CameraRig;
  session: RaceSession | null = null;
  world: World | null = null;
  hud: Hud | null = null;
  state: State = 'boot';
  paused = false;
  lastReq: EventRequest | null = null;
  private backdropKey = '';
  private backdropTimer = 0;
  private garage = false;
  private garagePos = new Vector3();
  private rewards: RewardSummary | null = null;
  private resultsShown = false;
  private last = 0;
  private renderTime = 0;
  private debug: DebugOverlay | null = null;
  readonly harness: boolean;
  /** When true, the rAF loop only renders; the harness advances the clock. */
  scripted = false;
  private finishCamStarted = false;
  private champPendingFinal = false;
  /** Smoothed CPU cost of simulation + scene update per frame (excludes GPU work). */
  cpuMs = 0;
  /** Harness-scripted player controls (merged over live input). */
  controlOverride: Record<string, number | boolean> | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    const params = new URLSearchParams(location.search);
    this.harness = params.has('harness');
    const s = this.save.data.settings;
    this.renderer = new Renderer(canvas, s.quality, s.pixelRatio);
    this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.music = new Music(this.audio);
    this.screens = new Screens(this, ui);
    this.nav.onMove = () => this.audio.click('move');
    this.applySettings();
    if (params.has('debug')) this.debug = new DebugOverlay(this, ui);
    window.addEventListener('resize', () => this.onResize());
    // Device pixel ratio changes (moving between monitors, zoom).
    const watchDpr = () => {
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => {
        this.applySettings();
        this.onResize();
        watchDpr();
      }, { once: true });
    };
    watchDpr();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && this.session && this.session.phase === 'racing' && !this.paused) this.pauseGame();
    });
    // Any first gesture unlocks audio (autoplay policy).
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  start() {
    const bar = document.querySelector('#boot .boot-bar div') as HTMLElement | null;
    if (bar) bar.style.width = '40%';
    // Let the boot screen paint before the heavy first build.
    setTimeout(() => {
      this.buildBackdrop(this.save.data.champ ? trackDef(CUPS.find((c) => c.id === this.save.data.champ!.cupId)!.tracks[0]).id : 'coral', 'clear');
      if (bar) bar.style.width = '100%';
      this.state = 'title';
      this.screens.title();
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
      setTimeout(() => document.getElementById('boot')?.classList.add('gone'), 200);
      if (this.harness) this.installHarness();
    }, 30);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  applySettings() {
    const s = this.save.data.settings;
    this.audio.setVolumes(s.master, s.music, s.sfx);
    this.renderer.adaptive = s.autoRes;
    if (Math.abs(this.renderer.maxPixelRatio - s.pixelRatio) > 1e-3) this.renderer.setMaxPixelRatio(s.pixelRatio);
    if (this.renderer.quality !== s.quality) {
      this.renderer.setQuality(s.quality);
      // Geometry density depends on quality: rebuild the menu backdrop now; races pick it up next start.
      if (this.state === 'menu') this.rebuildBackdrop();
    }
    this.renderer.assist = s.assist;
    this.renderer.motionFx = s.motion;
    this.rig.motionScale = 0.35 + 0.65 * s.motion;
    this.rig.shakeScale = s.shake;
    this.input.bindings = structuredClone(s.bindings);
    this.input.sensitivity = s.sensitivity;
    this.applyHudScale();
    this.world?.course.setRacingLine(s.racingLine && this.state === 'race');
  }

  /** HUD scale = user setting × automatic fit to the viewport (designed at 1440×810). */
  private applyHudScale() {
    const fit = clamp(Math.min(window.innerWidth / 1440, window.innerHeight / 810), 0.72, 1.15);
    document.documentElement.style.setProperty('--hud', (this.save.data.settings.hudScale * fit).toFixed(3));
  }

  private onResize() {
    this.applyHudScale();
    this.renderer.resize();
    this.rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    this.hud?.resize();
  }

  // ── Session/world lifetime ────────────────────────────────────────────────
  private teardown() {
    this.hud?.destroy();
    this.hud = null;
    this.world?.dispose();
    this.world = null;
    this.session = null;
    this.events.clear();
    this.audio.stopRace();
  }

  private build(cfg: SessionConfig, weather: WeatherId) {
    this.teardown();
    this.session = new RaceSession(cfg, this.events);
    this.world = new World(this.session, this.renderer, this.events, this.renderer.quality, weather);
    this.rig.ramps = this.session.track.ramps;
    this.rig.boats = this.session.racers.map((r) => r.boat);
    const scenery = this.world.scenery;
    this.rig.ground = (x, z) => scenery.ground(x, z);
    this.rig.seaLift = Math.max(0, (getSeaState() - 1) * 2.2);
    this.renderTime = 0;
  }

  private buildBackdrop(trackId: string, weather: WeatherId) {
    const d = this.save.data;
    const cfg: SessionConfig = {
      mode: 'quick',
      trackId,
      weather,
      laps: 99,
      difficulty: 'normal',
      playerBoat: d.selectedBoat,
      playerLivery: this.save.livery(d.selectedBoat),
      playerName: d.playerName,
      opponents: 5,
      ghost: null,
    };
    this.build(cfg, weather);
    const s = this.session!;
    s.playerAutopilot = true;
    s.setPhase('racing');
    for (const r of s.racers) r.boat.holdTime = 0;
    // Pre-roll so the pack is strung out and moving when the menu appears.
    for (let i = 0; i < 240; i++) s.step(1 / 30);
    this.events.clear();
    this.world!.particles.clear();
    this.backdropKey = `${trackId}|${weather}|${d.selectedBoat}`;
    this.rig.endScripted();
    this.rig.mode = 'cinematic';
    this.rig.cut();
    this.music.seed(trackDef(trackId).seed);
  }

  private rebuildBackdrop() {
    const s = this.session;
    if (!s) return;
    this.backdropKey = '';
    this.buildBackdrop(s.cfg.trackId, this.world?.weather ?? 'clear');
    if (this.garage) this.beginGarage(this.save.data.selectedBoat);
  }

  /** Menu preview: swap the backdrop course/weather (debounced). */
  setBackdrop(trackId: string, weather: WeatherId) {
    const key = `${trackId}|${weather}|${this.save.data.selectedBoat}`;
    if (key === this.backdropKey) return;
    window.clearTimeout(this.backdropTimer);
    this.backdropTimer = window.setTimeout(() => {
      if (this.state !== 'menu') return;
      if (this.session && this.session.cfg.trackId === trackId && this.world) {
        this.world.applyWeather(weather);
        this.session.cfg.weather = weather;
        this.backdropKey = key;
      } else this.buildBackdrop(trackId, weather);
    }, 180);
  }

  enterMenu() {
    this.state = 'menu';
    this.paused = false;
    this.garage = false;
    this.audio.stopRace();
    this.audio.muffle(false);
    this.music.setMood('menu');
    if (!this.session || this.session.cfg.laps !== 99) {
      const tid = this.session?.cfg.trackId ?? 'coral';
      this.buildBackdrop(tid, (this.session?.cfg.weather as WeatherId) ?? 'clear');
    }
    this.rig.endScripted();
    this.rig.mode = 'cinematic';
    this.screens.mainMenu();
    this.input.flush();
  }

  // ── Garage preview ────────────────────────────────────────────────────────
  beginGarage(boat: BoatId) {
    this.garage = true;
    this.music.setMood('garage');
    const s = this.session;
    if (!s) return;
    this.previewBoat(boat);
  }
  endGarage() {
    this.garage = false;
    const s = this.session;
    if (s) {
      s.playerAutopilot = true;
      s.player.boat.holdTime = 0;
      // Restore the selected boat in the backdrop.
      this.previewBoat(this.save.data.selectedBoat, false);
    }
  }
  previewBoat(id: BoatId, park = true) {
    const s = this.session;
    const w = this.world;
    if (!s || !w) return;
    const spec = boatSpec(id);
    const liv = this.save.livery(id);
    const p = s.player;
    p.boat.spec = spec;
    (p as { livery: Livery }).livery = liv;
    w.swapPlayerVisual(new BoatVisual(spec, liv));
    w.wake.setTrailColor(0, liv.trail);
    if (park) {
      // Park the boat on clear open water near the start, away from statics.
      const g = s.track.gates[0];
      let found = false;
      for (let off = s.track.width * 0.5 + 28; off < 220 && !found; off += 12) {
        for (const side of [1, -1]) {
          const x = g.x - Math.cos(g.heading) * off * side;
          const z = g.z + Math.sin(g.heading) * off * side;
          if (!s.statics.blocked(x, z, 12) && s.track.distToCentre(x, z) > s.track.width * 0.5 + 14) {
            this.garagePos.set(x, 0, z);
            found = true;
            break;
          }
        }
      }
      if (!found) this.garagePos.set(g.x, 0, g.z);
      p.boat.place(this.garagePos.x, this.garagePos.z, g.heading);
      settleBoat(p.boat, s.time);
      p.boat.holdTime = 1e9;
      s.playerAutopilot = false;
      p.controls.throttle = 0;
      p.controls.steer = 0;
      p.controls.drift = false;
      this.rig.startOrbit(p.boat.position, 7.5, 2.2, true);
      this.rig.cut();
    }
  }
  previewLivery(l: Livery) {
    const s = this.session;
    if (!s || !this.world) return;
    (s.player as { livery: Livery }).livery = l;
    this.world.repaintPlayer();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  startEvent(req: EventRequest) {
    this.lastReq = { ...req };
    const d = this.save.data;
    const def = trackDef(req.trackId);
    const weather: WeatherId = req.weather === 'default' ? def.weather : req.weather;
    const champ = req.mode === 'championship' ? d.champ : null;
    const cfg: SessionConfig = {
      mode: req.mode,
      trackId: req.trackId,
      weather,
      laps: req.mode === 'timetrial' ? req.laps : req.mode === 'championship' ? def.laps : req.laps,
      difficulty: req.difficulty,
      playerBoat: req.boat,
      playerLivery: this.save.livery(req.boat),
      playerName: d.playerName,
      opponents: 5,
      ghost: req.mode === 'timetrial' ? (d.ghosts[req.trackId] ?? null) : null,
      champPoints: champ?.points,
    };
    this.screens.loading();
    this.state = 'race';
    // Yield a frame so "LOADING" paints before the build.
    setTimeout(() => {
      this.build(cfg, weather);
      const s = this.session!;
      this.hud = new Hud(s, this.ui, d.settings.units, d.settings.bindings);
      this.hud.showTutorial = !d.seenTutorial && (req.mode === 'quick' || req.mode === 'championship' || req.mode === 'freeride');
      if (this.hud.showTutorial) {
        d.seenTutorial = true;
        this.save.save();
      }
      this.world!.course.setRacingLine(d.settings.racingLine);
      this.screens.clear();
      this.paused = false;
      this.rewards = null;
      this.resultsShown = false;
      this.finishCamStarted = false;
      this.rig.mode = this.rig.mode === 'cinematic' ? 'chase' : this.rig.mode;
      this.rig.startIntro();
      this.audio.unlock();
      this.audio.startRace(def.theme);
      this.music.seed(def.seed);
      this.music.setMood('race');
      this.audio.muffle(false);
      this.input.flush();
    }, 20);
  }

  startChampRound() {
    const ch = this.save.data.champ;
    if (!ch) return this.screens.champ();
    if (ch.round === 0 && this.screens.current !== 'setup') return this.screens.champSetup();
    const cup = CUPS.find((c) => c.id === ch.cupId)!;
    this.startEvent({ mode: 'championship', trackId: cup.tracks[ch.round], weather: 'default', laps: 3, difficulty: this.save.data.settings.difficulty, boat: this.save.data.selectedBoat });
  }

  pauseGame() {
    if (this.state !== 'race' || !this.session || this.paused) return;
    if (this.session.phase === 'results') return;
    this.paused = true;
    this.audio.muffle(true);
    this.screens.pause();
  }
  resumeRace() {
    this.paused = false;
    this.audio.muffle(false);
    this.screens.clear();
    this.input.flush();
    this.last = performance.now();
  }
  restartRace() {
    if (this.lastReq) this.startEvent(this.lastReq);
  }
  quitRace() {
    this.paused = false;
    this.teardown();
    this.enterMenu();
  }
  cycleCamera() {
    const m = this.rig.cycle();
    this.hud?.showCamera(m);
  }
  setCamera(m: CamMode) {
    this.rig.mode = m;
    this.rig.cut();
  }

  afterResults() {
    const s = this.session;
    if (this.champPendingFinal) {
      this.champPendingFinal = false;
      this.quitRace();
      return;
    }
    if (s?.mode === 'championship' && this.save.data.champ) {
      const ch = this.save.data.champ;
      const cup = CUPS.find((c) => c.id === ch.cupId)!;
      ch.round++;
      if (ch.round >= cup.tracks.length) {
        // Final round done: show the final table, then the trophy screen.
        const points = ch.points.slice();
        const fin = finishChampionship(this.save);
        this.champPendingFinal = true;
        this.screens.champFinalStandings(cup.id, points, () => {
          this.screens.champFinal(fin.place, fin.xp, fin.credits, cup.name);
          fin.unlocks.forEach((u, i) => setTimeout(() => this.screens.toast(u.split(': ').pop()!, u.split(':')[0]), 600 + i * 700));
        });
        return;
      }
      this.save.save();
      this.screens.champStandings();
      return;
    }
    this.quitRace();
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  private loop(now: number) {
    requestAnimationFrame((t) => this.loop(t));
    const realMs = now - this.last;
    this.last = now;
    if (!this.scripted) {
      const dt = clamp(realMs / 1000, 0, 1 / 20);
      const t0 = performance.now();
      this.frame(dt);
      this.cpuMs = this.cpuMs * 0.95 + (performance.now() - t0) * 0.05;
    }
    this.renderer.sample(realMs, now);
    this.render(clamp(realMs / 1000, 0, 0.05));
  }

  /** Advance everything except rendering by dt. */
  frame(dt: number) {
    this.input.poll();
    // Gamepad drives the menu navigator whenever a screen is up.
    const pn = this.input.padNav;
    if (this.nav.root) {
      for (const a of pn) {
        if (a === 'ok') this.nav.activate();
        else if (a === 'back') this.nav.back();
        else this.nav.move(a);
      }
    }
    pn.length = 0;
    const s = this.session;
    const w = this.world;
    if (!s || !w) return;
    const racing = this.state === 'race';

    if (racing && !this.paused) {
      if (this.input.pressed('pause') && s.phase !== 'results' && !this.nav.root) {
        this.pauseGame();
        return;
      }
      if (this.input.pressed('camera') && s.phase !== 'results') this.cycleCamera();
      if (this.input.pressed('restart') && s.phase !== 'results' && s.mode !== 'championship') {
        this.restartRace();
        return;
      }
      if (this.input.pressed('respawn') && s.phase === 'racing') s.respawn(s.player);
      if (s.phase === 'intro' && (this.input.pressed('confirm') || this.input.pressed('drift'))) s.skipIntro();
      if (!s.playerAutopilot && !s.player.finished) {
        this.input.read(s.player.controls, dt);
        if (this.controlOverride) Object.assign(s.player.controls, this.controlOverride);
      }
    } else if (racing && this.paused) {
      this.input.pressed('pause'); // consumed by the pause screen's ESC handler
    }

    const simDt = racing && this.paused ? 0 : dt;
    if (simDt > 0) s.step(simDt);

    // Camera state machine.
    if (racing) {
      if (s.phase === 'intro') {
        if (this.rig.scripted !== 'intro') this.rig.startIntro();
      } else if (s.phase === 'countdown' || s.phase === 'racing') {
        if (this.rig.scripted === 'intro') this.rig.endScripted();
      } else if ((s.phase === 'finished' || s.phase === 'results') && !this.finishCamStarted) {
        this.finishCamStarted = true;
        this.rig.startFinish();
      }
    } else if (!this.garage) {
      this.rig.endScripted();
      this.rig.mode = 'cinematic';
    }
    const target = s.player.boat;
    if (simDt > 0 || this.garage) this.rig.update(simDt || dt, target, s.track, s.time);

    w.update(simDt, s.time, this.rig, this.events);
    if (!racing) {
      // No screen-space race FX behind menus.
      const fx = this.renderer.fx;
      fx.speed = fx.radial = fx.chroma = fx.flash = fx.drops = fx.damage = 0;
    }
    if (this.hud) this.hud.update(simDt);

    // Events → audio + HUD.
    const cam = this.rig.camera;
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _listener.x = cam.position.x;
    _listener.z = cam.position.z;
    const rl = Math.hypot(_right.x, _right.z) || 1;
    _listener.rx = _right.x / rl;
    _listener.rz = _right.z / rl;
    const list = this.events.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (racing) {
        this.audio.onEvent(e, _listener, e.racer === 0 || e.racer === -1);
        this.hud?.onEvent(e);
      } else if (e.type === 'lightning') this.audio.onEvent(e, _listener, true);
      this.debug?.onEvent(e);
    }
    this.events.clear();

    // Continuous audio.
    if (racing) {
      _nearest.length = 0;
      for (let i = 1; i < s.racers.length; i++) _nearest.push(s.racers[i].boat);
      const px = s.player.boat.position.x;
      const pz = s.player.boat.position.z;
      _nearest.sort((a, b) => (a.position.x - px) ** 2 + (a.position.z - pz) ** 2 - ((b.position.x - px) ** 2 + (b.position.z - pz) ** 2));
      const revving = s.phase === 'countdown' ? s.player.controls.throttle * 0.8 : 0;
      this.audio.updateRace(dt, s.player.boat, s.player.boat.engine, _nearest, _listener, w.atmosphere.preset.rain, this.paused, revving);
      const final = s.hasLaps && s.player.lap >= s.totalLaps && s.totalLaps > 1 && s.phase === 'racing';
      if (s.phase === 'results' || s.phase === 'finished') this.music.setMood('results');
      else this.music.setMood(final || (s.mode === 'endless' && s.endlessLevel >= 3) || (s.mode === 'stunt' && s.stuntTimeLeft < 20) ? 'final' : 'race');
      this.music.setIntensity(clamp01(s.player.boat.boostLevel));
      const r = w.fx.rumble;
      if (r.ms > 0 && this.input.lastDevice === 'gamepad') this.input.rumble(r.strong, r.weak, r.ms);
    }

    // Results.
    if (racing && s.phase === 'results' && !this.resultsShown) {
      this.resultsShown = true;
      this.rewards = applyRewards(s, this.save);
      this.hud?.destroy();
      this.hud = null;
      this.screens.results(this.rewards);
    }
    this.debug?.update(dt);
  }

  private render(dt: number) {
    const w = this.world;
    if (!w) return;
    this.renderTime += dt;
    this.renderer.render(w.scene, this.rig.camera, w.atmosphere.post, dt);
  }

  // ── Harness ───────────────────────────────────────────────────────────────
  private installHarness() {
    const g = this;
    const api = {
      ready: true,
      get state() {
        return { state: g.state, screen: g.screens.current, phase: g.session?.phase, paused: g.paused, mode: g.session?.mode };
      },
      startRace(req: Partial<EventRequest> = {}) {
        const prev = g.session;
        g.controlOverride = null;
        g.startEvent({ mode: 'quick', trackId: 'coral', weather: 'default', laps: 3, difficulty: 'normal', boat: g.save.data.selectedBoat, ...req });
        return new Promise<void>((res) => {
          const wait = () => (g.session && g.session !== prev && g.hud ? res() : setTimeout(wait, 20));
          wait();
        });
      },
      /** Deterministic fixed-step advance; suspends the real-time clock. */
      simulate(seconds: number, dt = 1 / 60) {
        g.scripted = true;
        const n = Math.round(seconds / dt);
        for (let i = 0; i < n; i++) g.frame(dt);
        return api.stats();
      },
      release() {
        g.scripted = false;
        g.last = performance.now();
      },
      /** Process exactly one frame (handles queued key presses deterministically). */
      tick(dt = 1 / 60) {
        g.frame(dt);
        return api.stats();
      },
      autopilot(on: boolean) {
        if (g.session) g.session.playerAutopilot = on;
        if (on) g.controlOverride = null;
      },
      setControls(c: Record<string, number | boolean>) {
        if (g.session) g.session.playerAutopilot = false;
        g.controlOverride = { ...(g.controlOverride ?? {}), ...c };
      },
      clearControls() {
        g.controlOverride = null;
      },
      skipIntro() {
        g.session?.skipIntro();
      },
      setPhase(p: 'racing' | 'countdown') {
        g.session?.setPhase(p);
        if (p === 'racing') for (const r of g.session!.racers) r.boat.holdTime = 0;
      },
      camera(m: CamMode) {
        g.setCamera(m);
      },
      weather(wid: WeatherId) {
        g.world?.applyWeather(wid);
      },
      key(code: string, down: boolean) {
        if (down) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        else window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      },
      menu() {
        g.enterMenu();
      },
      garage() {
        g.screens.garage();
      },
      settings() {
        g.screens.settings('menu');
      },
      setup(mode: ModeId) {
        if (mode === 'championship') g.screens.champ();
        else g.screens.eventSetup(mode);
      },
      pause() {
        g.pauseGame();
      },
      respawnPlayer() {
        if (g.session) g.session.respawn(g.session.player);
      },
      stats() {
        const s = g.session;
        const p = s?.player;
        const b = p?.boat;
        const r = g.renderer.stats;
        return {
          fps: r.fps,
          frameMs: r.frameMs,
          cpuMs: g.cpuMs,
          calls: r.calls,
          triangles: r.triangles,
          pixelRatio: g.renderer.pixelRatio,
          particles: g.world?.particles.active ?? 0,
          phase: s?.phase,
          time: s?.raceTime,
          lap: p?.lap,
          checkpoints: p?.checkpoints,
          place: p?.place,
          finished: p?.finished,
          wrongWay: p?.wrongWay,
          speed: b?.speed,
          airborne: b?.airborne,
          drifting: b?.drifting,
          driftTier: b?.driftTier,
          boost: b?.boostLevel,
          nitro: b?.nitro,
          y: b?.position.y,
          surface: b ? oceanHeight(b.position.x, b.position.z, s!.time) : 0,
          wipeout: b?.wipeout,
          clearance: b?.clearance,
          trick: b?.trick,
          sinceLand: b?.sinceLand,
          screen: g.screens.current,
          flash: g.world?.atmosphere.flash ?? 0,
          drops: g.renderer.fx.drops,
          ghostVisible: !!g.world?.ghost?.root.visible,
          ghostDist: g.world?.ghost && b ? g.world.ghost.root.position.distanceTo(b.position) : -1,
          state: g.state,
          save: { xp: g.save.data.xp, credits: g.save.data.credits, races: g.save.data.races },
        };
      },
      probe() {
        const s = g.session;
        if (!s) return [];
        return s.racers.map((r) => ({ id: r.id, name: r.name, lap: r.lap, cp: r.checkpoints, place: r.place, dist: +r.raceDist.toFixed(1), lat: +r.lateral.toFixed(1), speed: +r.boat.speed.toFixed(1), finished: r.finished, wrong: r.wrongWay }));
      },
      /** Rotate the player to face backwards along the course (wrong-way test). */
      turnPlayerAround() {
        const b = g.session?.player.boat;
        if (!b) return;
        b.heading += Math.PI;
        b.velocity.set(0, 0, 0);
      },
      afterResults() {
        g.afterResults();
      },
      /** Put the player on the course at arc length s, moving at `speed`. */
      placeOnTrack(sArc: number, speed = 28, lateral = 0) {
        const ss = g.session;
        if (!ss) return;
        const tp = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
        ss.track.sample(sArc, tp);
        const b = ss.player.boat;
        b.place(tp.x - tp.tz * lateral, tp.z + tp.tx * lateral, tp.heading);
        settleBoat(b, ss.time);
        b.velocity.set(tp.tx * speed, 0, tp.tz * speed);
        b.forwardSpeed = speed;
        b.engine = 1;
        ss.player.hint = -1;
        g.rig.cut();
      },
      /** Line the player up 45 m before ramp i at speed. Returns false if the track has none. */
      placeAtRamp(i = 0, speed = 32) {
        const ss = g.session;
        const r = ss?.track.ramps[i];
        if (!ss || !r) return false;
        const b = ss.player.boat;
        const fx = Math.sin(r.heading);
        const fz = Math.cos(r.heading);
        b.place(r.x - fx * 45, r.z - fz * 45, r.heading);
        settleBoat(b, ss.time);
        b.velocity.set(fx * speed, 0, fz * speed);
        b.forwardSpeed = speed;
        b.engine = 1;
        ss.player.hint = -1;
        g.rig.cut();
        return true;
      },
      /** Advance until a predicate over stats() holds (max seconds). */
      simulateUntil(pred: string, maxSeconds = 20, dt = 1 / 60) {
        g.scripted = true;
        const f = new Function('s', `return (${pred});`) as (x: unknown) => boolean;
        const n = Math.round(maxSeconds / dt);
        for (let i = 0; i < n; i++) {
          g.frame(dt);
          if (f(api.stats())) return { ok: true, t: i * dt, stats: api.stats() };
        }
        return { ok: false, t: maxSeconds, stats: api.stats() };
      },
      saveData() {
        return JSON.parse(JSON.stringify(g.save.data));
      },
      hideUi(h: boolean) {
        g.ui.style.display = h ? 'none' : '';
      },
      render() {
        g.render(0);
      },
      /** Redraw HUD canvases inside a real animation frame so the compositor commits them. */
      redrawHud() {
        return new Promise<void>((res) =>
          requestAnimationFrame(() => {
            g.hud?.update(0);
            g.render(0);
            res();
          }),
        );
      },
      /** Orbit the camera around the first prop of a kind (visual verification). */
      orbitProp(kind: string, radius = 60, height = 20) {
        const ss = g.session;
        const pr = ss?.layout.props.find((p) => p.kind === kind);
        if (!ss || !pr) return false;
        g.garage = true; // keeps the rig in scripted orbit
        const off = kind === 'waterfall' ? pr.size * 0.75 : 0;
        g.rig.startOrbit(new Vector3(pr.x + Math.cos(pr.rot) * off, kind === 'volcano' ? 120 : 6, pr.z + Math.sin(pr.rot) * off), radius, height);
        g.rig.cut();
        return true;
      },
      /** Test hook: jump the active championship to a round. */
      /** Scene inspection for debugging: meshes with their visibility and size. */
      sceneInfo(filter = '') {
        const out: { name: string; type: string; visible: boolean; verts: number; draw: number; renderOrder: number }[] = [];
        g.world?.scene.traverse((o) => {
          const m = o as import('three').Mesh;
          if (!m.geometry || (filter && !o.name.includes(filter))) return;
          const pos = m.geometry.getAttribute('position');
          out.push({ name: o.name, type: o.type, visible: o.visible, verts: pos ? pos.count : 0, draw: m.geometry.drawRange.count, renderOrder: o.renderOrder });
        });
        return out;
      },
      racingLine(on: boolean) {
        g.world?.course.setRacingLine(on);
      },
      wipeoutPlayer() {
        const b = g.session?.player.boat;
        if (b) {
          b.wipeout = 1.5;
          g.events.push('wipeout', 0, b.position.x, b.position.y, b.position.z, 1);
        }
      },
      setChampRound(n: number) {
        if (g.save.data.champ) g.save.data.champ.round = n;
      },
      audioMeter() {
        return g.audio.meter();
      },
      musicMood() {
        return g.music.mood;
      },
      gpuMemory() {
        const info = g.renderer.gl.info;
        return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
      },
      waveCheck() {
        return waveAgreement(g.renderer.gl);
      },
    };
    (window as unknown as { __RIPTIDE__: typeof api }).__RIPTIDE__ = api;
  }
}
