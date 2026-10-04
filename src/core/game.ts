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
import { applyRewards, finishChampionship, noRewards, type RewardSummary } from '../save/rewards';
import { CAREER, type Challenge } from '../save/progress';
import { RaceSession, type SessionConfig } from '../race/session';
import { CUPS, trackDef } from '../race/trackDefs';
import { BoatVisual } from '../boat/boatMesh';
import { CharacterStage } from '../render/characterStage';
import { Loader } from '../ui/loading';
import { applyPreset, AutoDowngrade, PRESETS, resolveQuality } from '../render/graphics';
import type { Quality } from '../render/renderer';
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
import { AdminPanel } from '../admin/admin';
import { getLang, setLang } from '../ui/i18n';
import { TouchControls, isTouchDevice } from '../input/touch';
import { Tutorial } from '../race/tutorial';
import { ReplayPlayer, ReplayRecorder, type ReplayData } from '../race/replay';
import { PhotoPanel, ReplayBar, type PhotoHost, type ReplayHost } from '../ui/overlays';
import { CAM_LABEL, CAM_MODES } from '../camera/cameraRig';
import { checkAchievements } from '../save/rewards';
import { decodeGhost, encodeGhost, ghostFingerprint } from '../save/ghostCode';

export interface EventRequest {
  mode: ModeId;
  trackId: string;
  weather: WeatherId | 'default';
  laps: number;
  difficulty: Difficulty;
  boat: BoatId;
  /** A daily/weekly challenge attempt. */
  challenge?: Challenge | null;
  /** Career stage index. */
  careerStage?: number;
  /** Split-screen: player 2's boat (presence turns split-screen on). */
  p2Boat?: BoatId;
  /** Number of AI rivals (default 5). */
  opponents?: number;
  /** Time trial: race your own best ghost or an imported friend's ghost. */
  ghost?: 'mine' | 'rival';
}

type State = 'boot' | 'title' | 'menu' | 'race';

const _listener: Listener = { x: 0, z: 0, rx: 1, rz: 0 };
const _right = new Vector3();
const _nearest: Boat[] = [];

/** Post settings for the character stage when no world exists yet. */
const STAGE_POST = { bloom: 0.25, exposure: 1, saturation: 1.1, contrast: 1, vignette: 0.15 };

export class Game implements ReplayHost, PhotoHost {
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly audio = new AudioEngine();
  readonly music: Music;
  readonly save = new SaveStore();
  readonly nav = new Nav();
  readonly screens: Screens;
  readonly events = new EventQueue();
  readonly rig: CameraRig;
  /** Split-screen: player 2's camera and HUD. */
  rig2: CameraRig | null = null;
  hud2: Hud | null = null;
  private splitWraps: HTMLElement[] = [];
  get split() {
    return !!this.session?.cfg.player2;
  }
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
  /** Smoothed music pressure. */
  private pressure = 0;
  /** How tight the fight around the player is: 0 calm … 1 wheel-to-wheel or leading. */
  private racePressure(s: RaceSession) {
    if (!s.isRace || s.phase !== 'racing') return 0;
    const p = s.player;
    const i = s.order.indexOf(p);
    const pace = Math.max(12, p.boat.speed);
    const ahead = i > 0 ? (s.order[i - 1].raceDist - p.raceDist) / pace : Infinity;
    const behind = i < s.order.length - 1 ? (p.raceDist - s.order[i + 1].raceDist) / pace : Infinity;
    const close = Math.max(clamp01(1 - ahead / 2.5), clamp01(1 - behind / 1.8));
    const lead = p.place === 1 ? 0.55 : 0;
    const finale = s.hasLaps && p.lap >= s.totalLaps ? 0.25 : 0;
    return clamp01(Math.max(close, lead) + finale);
  }

  /** Global sim speed (admin slow-motion). */
  timeScale = 1;
  readonly admin: AdminPanel;
  readonly touch: TouchControls;
  tutorial: Tutorial | null = null;
  /** A finger has touched the screen this session (auto touch mode). */
  private touchSeen = false;
  private touchShown = false;
  /** Harness-scripted player controls (merged over live input). */
  controlOverride: Record<string, number | boolean> | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    const params = new URLSearchParams(location.search);
    this.harness = params.has('harness');
    const s = this.save.data.settings;
    const q0 = resolveQuality(s.quality);
    applyPreset(q0);
    this.renderer = new Renderer(canvas, q0, Math.min(s.pixelRatio, PRESETS[q0].maxPixelRatio));
    this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.music = new Music(this.audio);
    this.screens = new Screens(this, ui);
    this.touch = new TouchControls(ui);
    this.touch.show(false);
    this.nav.onMove = () => this.audio.click('move');
    this.applySettings();
    if (params.has('debug')) this.debug = new DebugOverlay(this, ui);
    this.admin = new AdminPanel(this);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.touchSeen) {
        this.touchSeen = true;
        this.applySettings();
      }
    });
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
    const L = this.loader;
    const trackId = this.save.data.champ ? trackDef(CUPS.find((c) => c.id === this.save.data.champ!.cupId)!.tracks[0]).id : 'coral';
    L.begin();
    L.setPlace(trackDef(trackId).name);
    L.set(0.15, 'LOADING FONTS');
    // Real steps only: fonts (capped so a slow font never blocks play), the
    // course build, then the first rendered frame (shader compile).
    const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
    void fonts.then(() => {
      L.set(0.4, 'BUILDING ' + trackDef(trackId).name);
      // Let the boot screen paint before the heavy first build.
      setTimeout(() => {
        this.buildBackdrop(trackId, 'clear');
        L.set(0.85, 'WARMING UP SHADERS');
        this.state = 'title';
        this.screens.title();
        this.last = performance.now();
        requestAnimationFrame((t) => this.loop(t));
        requestAnimationFrame(() => requestAnimationFrame(() => L.hide()));
        if (this.harness) this.installHarness();
      }, 30);
    });
  }

  get touchEnabled() {
    const m = this.save.data.settings.touch;
    return m === 'on' || (m === 'auto' && (this.touchSeen || (isTouchDevice() && !this.harness)));
  }

  get debugOn() {
    return !!this.debug;
  }
  toggleDebug() {
    if (this.debug) {
      this.debug.dispose();
      this.debug = null;
    } else this.debug = new DebugOverlay(this, this.ui);
  }

  /** Fly the free camera from raw keys (admin free cam / photo mode). */
  private driveFreeCam(dt: number) {
    const k = (c: string) => (this.input.isDown(c) ? 1 : 0);
    const fast = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 4 : 1;
    const v = 18 * fast * dt;
    this.rig.freeMove((k('KeyW') - k('KeyS')) * v, (k('KeyD') - k('KeyA')) * v, (k('KeyE') - k('KeyQ')) * v, (k('ArrowLeft') - k('ArrowRight')) * 1.6 * dt, (k('ArrowUp') - k('ArrowDown')) * 1.2 * dt);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  // ── Character creator stage ─────────────────────────────────────────────
  stage: CharacterStage | null = null;
  openStage() {
    if (!this.stage) this.stage = new CharacterStage();
    this.stage.setLook(this.save.data.rider, this.save.livery(this.save.data.selectedBoat), false);
  }
  /** Rebuild the stage rider after a look change (plays the happy reaction). */
  refreshStage() {
    this.stage?.setLook(this.save.data.rider, this.save.livery(this.save.data.selectedBoat), true);
  }
  closeStage() {
    if (!this.stage) return;
    this.stage.dispose();
    this.stage = null;
    // The menu backdrop's player boat picks up the new look.
    if (this.state === 'menu' && this.session && this.world) this.previewBoat(this.save.data.selectedBoat, false);
  }

  /** Apply a concrete graphics preset everywhere it matters. */
  private setGraphics(q: Quality) {
    const s = this.save.data.settings;
    applyPreset(q);
    const cap = Math.min(s.pixelRatio, PRESETS[q].maxPixelRatio);
    if (Math.abs(this.renderer.maxPixelRatio - cap) > 1e-3) this.renderer.setMaxPixelRatio(cap);
    this.world?.scenery.refreshLod();
    this.world?.setShadows(s.shadows && PRESETS[q].shadows);
    if (this.renderer.quality !== q) {
      this.renderer.setQuality(q);
      // Geometry density depends on quality: rebuild the menu backdrop now; races pick it up next start.
      if (this.state === 'menu') this.rebuildBackdrop();
    }
  }
  private autoQuality: Quality | null = null;
  private autoDown = new AutoDowngrade();

  applySettings() {
    const s = this.save.data.settings;
    if (getLang() !== s.lang) {
      setLang(s.lang);
      // Re-render the visible menu in the new language.
      if (this.screens.current === 'settings') this.screens.settings(this.screens.settingsReturn);
    }
    this.audio.setVolumes(s.master, s.music, s.sfx);
    this.renderer.adaptive = s.autoRes;
    // AUTO keeps any runtime step-down until the player picks another setting.
    const q = s.quality === 'auto' && this.autoQuality ? this.autoQuality : resolveQuality(s.quality);
    if (s.quality !== 'auto') this.autoQuality = null;
    this.setGraphics(q);
    this.renderer.assist = s.assist;
    this.renderer.motionFx = s.motion;
    this.rig.motionScale = 0.35 + 0.65 * s.motion;
    this.rig.shakeScale = s.shake;
    this.input.bindings = structuredClone(s.bindings);
    this.input.touch = this.touchEnabled ? this.touch : null;
    this.touch.setTilt(s.tilt && this.touchEnabled);
    document.body.classList.toggle('touchmode', this.touchEnabled);
    document.body.classList.toggle('symbols', s.symbols);
    this.input.sensitivity = s.sensitivity;
    this.applyHudScale();
    this.world?.course.setRacingLine(s.racingLine && this.state === 'race');
    if (this.world) this.world.shadows.mesh.visible = s.shadows;
  }

  /** HUD scale = user setting × automatic fit to the viewport (designed at 1440×810). */
  private applyHudScale() {
    const fit = clamp(Math.min(window.innerWidth / 1440, window.innerHeight / 810), 0.72, 1.15);
    document.documentElement.style.setProperty('--hud', (this.save.data.settings.hudScale * fit).toFixed(3));
  }

  private onResize() {
    this.applyHudScale();
    this.renderer.resize();
    const splitH = this.rig2 ? 2 : 1;
    this.rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight / splitH));
    this.rig2?.setAspect(window.innerWidth / Math.max(1, window.innerHeight / 2));
    for (const h of [this.hud, this.hud2]) {
      if (!h) continue;
      h.viewW = window.innerWidth;
      h.viewH = window.innerHeight / splitH;
    }
    this.hud?.resize();
    this.hud2?.resize();
  }

  // ── Session/world lifetime ────────────────────────────────────────────────
  private teardown() {
    this.tutorial = null;
    this.hud2?.destroy();
    this.hud2 = null;
    this.rig2 = null;
    for (const w of this.splitWraps) w.remove();
    this.splitWraps.length = 0;
    this.rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    this.replay = null;
    this.replayData = null;
    this.recorder = null;
    this.replayBar?.dispose();
    this.replayBar = null;
    this.photo?.dispose();
    this.photo = null;
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
    this.world = new World(this.session, this.renderer, this.events, this.renderer.quality, weather, { wildlife: this.save.data.settings.wildlife, shadows: this.save.data.settings.shadows && PRESETS[this.renderer.quality].shadows, symbols: this.save.data.settings.symbols });
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
      playerLook: d.rider,
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
    this.champPendingFinal = false;
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
    w.swapPlayerVisual(new BoatVisual(spec, liv, { look: this.save.data.rider }));
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
  // ── Garage previews (boost flame, wake, rider) ─────────────────────────
  private garageFx: { kind: 'boost' | 'wake' | 'rider'; t: number } | null = null;
  garagePreview(kind: 'boost' | 'wake' | 'rider') {
    const s = this.session;
    if (!s || !this.garage) return;
    this.garageFx = { kind, t: kind === 'wake' ? 3.2 : 2 };
    if (kind === 'wake') {
      // Release the parking brake and cruise a few lengths so the wake shows.
      s.player.boat.holdTime = 0;
      s.player.controls.throttle = 0.55;
    }
    if (kind === 'rider') this.world?.visuals[0].rider.react('trick');
  }
  private updateGarageFx(dt: number) {
    const fx = this.garageFx;
    const s = this.session;
    if (!fx || !s) return;
    fx.t -= dt;
    const b = s.player.boat;
    if (fx.kind === 'boost') b.boostLevel = Math.max(b.boostLevel, Math.min(1, fx.t * 1.5));
    if (fx.kind === 'rider' && this.world) this.world.visuals[0].celebrate = fx.t > 0.4;
    if (fx.t <= 0) {
      this.garageFx = null;
      if (fx.kind === 'wake') this.previewBoat(this.save.data.selectedBoat === b.spec.id ? b.spec.id : (b.spec.id as BoatId));
      if (this.world) this.world.visuals[0].celebrate = false;
    }
  }

  previewLivery(l: Livery) {
    const s = this.session;
    if (!s || !this.world) return;
    (s.player as { livery: Livery }).livery = l;
    this.world.repaintPlayer();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  /** Start an event behind the loading screen (the course build is synchronous). */
  startEvent(req: EventRequest) {
    if (this.harness) {
      this.buildEvent(req);
      return;
    }
    if (this.loadingEvent) return;
    this.loadingEvent = true;
    void this.loader.show(trackDef(req.trackId).name).then(() => {
      this.loader.set(0.35, 'BUILDING ' + trackDef(req.trackId).name);
      try {
        this.buildEvent(req);
      } finally {
        this.loadingEvent = false;
      }
      this.loader.set(0.85, 'WARMING UP SHADERS');
      requestAnimationFrame(() => requestAnimationFrame(() => this.loader.hide()));
    });
  }
  private loadingEvent = false;
  private loader = new Loader();

  private buildEvent(req: EventRequest) {
    this.lastReq = { ...req };
    const d = this.save.data;
    const def = trackDef(req.trackId);
    const weather: WeatherId = req.weather === 'default' ? def.weather : req.weather;
    const champ = req.mode === 'championship' ? d.champ : null;
    const stage = req.mode === 'career' && req.careerStage !== undefined ? CAREER[req.careerStage] : null;
    const cfg: SessionConfig = {
      mode: req.mode,
      trackId: req.trackId,
      weather,
      laps: req.mode === 'timetrial' ? req.laps : req.mode === 'championship' ? def.laps : stage ? stage.laps : req.laps,
      difficulty: stage ? stage.difficulty : req.difficulty,
      playerBoat: req.boat,
      playerLivery: this.save.livery(req.boat),
      playerLook: this.save.data.rider,
      playerName: req.p2Boat ? 'P1' : d.playerName,
      opponents: req.opponents ?? 5,
      player2: req.p2Boat ? { name: 'P2', boat: req.p2Boat, livery: this.save.livery(req.p2Boat) } : undefined,
      ghost: req.mode === 'timetrial' ? ((req.ghost === 'rival' ? d.rivalGhosts[req.trackId] : d.ghosts[req.trackId]) ?? null) : null,
      champPoints: champ?.points,
      // Split-screen is a fair fight: neither player brings garage upgrades.
      playerUpgrades: req.p2Boat ? undefined : this.save.upgrades(req.boat),
      field: stage ? [stage.boss, ...stage.field] : undefined,
      boss: stage?.boss,
      bossPower: stage?.bossPower,
      bottlesFound: d.bottles[req.trackId] ?? 0,
      dynamicWeather: d.settings.dynamicWeather && (req.mode === 'quick' || req.mode === 'championship' || req.mode === 'battle' || req.mode === 'freeride'),
      traffic: d.settings.wildlife && req.mode !== 'timetrial' && req.mode !== 'tutorial' && req.mode !== 'stunt',
      items: d.settings.items && (req.mode === 'quick' || req.mode === 'championship' || req.mode === 'career'),
    };
    this.screens.loading();
    this.state = 'race';
    // Yield a frame so "LOADING" paints before the build.
    setTimeout(() => {
      this.build(cfg, weather);
      const s = this.session!;
      if (s.cfg.player2) {
        // Two stacked half-screen HUDs and a second camera.
        for (let i = 0; i < 2; i++) {
          const w = document.createElement('div');
          w.className = 'splitwrap ' + (i ? 'bottom' : 'top');
          this.ui.appendChild(w);
          this.splitWraps.push(w);
        }
        this.hud = new Hud(s, this.splitWraps[0], d.settings.units, d.settings.bindings, false);
        this.hud2 = new Hud(s, this.splitWraps[1], d.settings.units, d.settings.bindings, false, s.racers[1]);
        for (const h of [this.hud, this.hud2]) {
          h.viewW = window.innerWidth;
          h.viewH = window.innerHeight / 2;
        }
        this.rig2 = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight / 2));
        this.rig2.ramps = s.track.ramps;
        this.rig2.boats = s.racers.map((r) => r.boat);
        const sc = this.world!.scenery;
        this.rig2.ground = (x, z) => sc.ground(x, z);
        this.rig2.seaLift = this.rig.seaLift;
        this.rig2.shakeScale = this.rig.shakeScale;
        this.rig2.motionScale = this.rig.motionScale;
        this.rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight / 2));
        this.rig2.startIntro();
      } else this.hud = new Hud(s, this.ui, d.settings.units, d.settings.bindings, this.touchEnabled);
      this.tutorial = req.mode === 'tutorial' ? new Tutorial(s) : null;
      this.recorder = req.mode === 'tutorial' || req.p2Boat ? null : new ReplayRecorder(s);
      this.replayData = null;
      this.hud.guide = this.tutorial;
      this.hud.showTutorial = !req.p2Boat && !d.seenTutorial && (req.mode === 'quick' || req.mode === 'championship' || req.mode === 'freeride');
      if (this.hud.showTutorial) {
        d.seenTutorial = true;
        this.save.save();
      }
      this.world!.course.setRacingLine(d.settings.racingLine);
      this.touch.setItemButton(!!s.items);
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

  // ── Replay / photo ──────────────────────────────────────────────────────
  private recorder: ReplayRecorder | null = null;
  private replayData: ReplayData | null = null;
  replay: ReplayPlayer | null = null;
  private replayBar: ReplayBar | null = null;
  private replayTargetIdx = 0;
  private photo: PhotoPanel | null = null;
  private photoFrom: 'pause' | 'replay' = 'pause';
  get replayAvailable() {
    return !!this.replayData && this.replayData.samples > 10;
  }
  startTutorial() {
    this.startEvent({ mode: 'tutorial', trackId: 'coral', weather: 'clear', laps: 0, difficulty: 'easy', boat: this.save.data.owned.includes(this.save.data.selectedBoat) ? this.save.data.selectedBoat : 'speedster' });
  }
  watchReplay() {
    const s = this.session;
    if (!s || !this.replayData || !this.world) return;
    this.screens.clear();
    this.replay = new ReplayPlayer(this.replayData, s);
    this.replayTargetIdx = 0;
    this.world.particles.clear();
    this.rig.endScripted();
    this.camBeforeReplay = this.rig.mode;
    this.rig.mode = 'cinematic';
    this.rig.cut();
    this.replayBar = new ReplayBar(this.ui, this, s.racers[0].name);
    this.music.setMood('garage');
    // Presses that chose WATCH REPLAY must not also pause/exit/cycle it.
    this.input.flush();
  }
  private camBeforeReplay: CamMode | null = null;
  replayToggle() {
    if (!this.replay) return;
    if (!this.replay.playing && this.replay.t >= this.replay.duration) this.replayRestart();
    this.replay.playing = !this.replay.playing;
  }
  replaySpeed(v: number) {
    if (this.replay) this.replay.speed = v;
  }
  replayRestart() {
    if (!this.replay) return;
    this.replay.restart();
    this.replay.playing = true;
    this.world?.particles.clear();
    this.rig.cut();
  }
  replayCamera() {
    const i = CAM_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.rig.cut();
    return CAM_LABEL[this.rig.mode];
  }
  replayTarget(dir: number) {
    const s = this.session;
    if (!s) return '';
    this.replayTargetIdx = (this.replayTargetIdx + dir + s.racers.length) % s.racers.length;
    this.rig.cut();
    return s.racers[this.replayTargetIdx].name;
  }
  replayExit() {
    this.replay = null;
    if (this.camBeforeReplay) this.rig.mode = this.camBeforeReplay;
    this.camBeforeReplay = null;
    this.replayBar?.dispose();
    this.replayBar = null;
    this.rig.endScripted();
    this.rig.startFinish();
    this.music.setMood('results');
    if (this.rewards) this.screens.results(this.rewards, true);
  }

  photoMode() {
    if (this.state !== 'race' || !this.session || this.photo) return;
    this.photoFrom = this.replay ? 'replay' : 'pause';
    if (this.replay) {
      this.replay.playing = false;
      this.replayBar?.show(false);
    } else if (!this.paused) this.pauseGame();
    this.screens.clear();
    if (this.hud) this.hud.root.style.display = 'none';
    if (this.hud2) this.hud2.root.style.display = 'none';
    this.rig.startFree();
    this.photo = new PhotoPanel(this.ui, this, this.canvas, this.rig.freeFov);
    // The key that opened photo mode must not also take the first snap.
    this.input.flush();
  }
  photoFov(v: number) {
    this.rig.freeFov = v;
  }
  photoRoll(v: number) {
    this.rig.freeRoll = v;
  }
  photoHideBoats(hide: boolean) {
    if (this.world) this.world.hideBoats = hide;
  }
  photoSnap(filter: string) {
    this.render(0);
    const src = this.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    if (filter) ctx.filter = filter;
    ctx.drawImage(src, 0, 0);
    const url = out.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `riptide-photo-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.click();
    this.save.data.stats.photos++;
    const ach = checkAchievements(this.save);
    this.save.save();
    this.audio.click('select');
    this.screens.toast('Saved to your downloads', 'PHOTO');
    ach.forEach((n, i) => setTimeout(() => this.screens.toast(n, 'ACHIEVEMENT'), 600 + i * 700));
  }
  photoExit() {
    if (!this.photo) return;
    this.photo.dispose();
    this.photo = null;
    if (this.world) this.world.hideBoats = false;
    this.rig.endScripted();
    this.rig.cut();
    if (this.hud) this.hud.root.style.display = '';
    if (this.photoFrom === 'replay' && this.replay) this.replayBar?.show(true);
    else this.screens.pause();
    this.input.flush();
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
    if (this.save.data.settings.quality === 'auto' && this.state === 'race') {
      const down = this.autoDown.update(realMs / 1000, this.renderer.stats.medianMs, this.renderer.atMinResolution, this.renderer.quality);
      if (down) {
        this.autoQuality = down;
        this.setGraphics(down);
        this.screens.toast(`DETAIL LOWERED TO ${down.toUpperCase()}`, 'GRAPHICS · AUTO');
      }
    }
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
    if (this.stage) {
      // Character creator: only the stage runs (the backdrop race is hidden).
      const turn = (this.input.isDown('KeyE') || this.input.isDown('BracketRight') ? 1 : 0) - (this.input.isDown('KeyQ') || this.input.isDown('BracketLeft') ? 1 : 0) + this.input.padTurn();
      if (turn) this.stage.nudge(turn, dt);
      this.stage.update(dt, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
      return;
    }
    const s = this.session;
    const w = this.world;
    if (!s || !w) return;
    const racing = this.state === 'race';

    if (racing && !this.paused) {
      if (this.input.pressed('pause') && s.phase !== 'results' && !this.nav.root) {
        this.pauseGame();
        return;
      }
      if (!this.split && this.input.pressed('camera') && s.phase !== 'results') this.cycleCamera();
      if (this.input.pressed('restart') && s.phase !== 'results' && s.mode !== 'championship') {
        this.restartRace();
        return;
      }
      if (!this.split && this.input.pressed('respawn') && s.phase === 'racing') s.respawn(s.player);
      if (s.phase === 'intro' && (this.input.pressed('confirm') || this.input.pressed('drift'))) s.skipIntro();
      if (this.rig.scripted === 'free') {
        const c = s.player.controls;
        c.throttle = c.brake = c.steer = c.pitch = 0;
        c.drift = c.boost = c.roll = false;
      } else if (this.split) {
        if (!s.player.finished) this.input.readSplit(0, s.player.controls, dt);
        const p2 = s.racers[1];
        if (!p2.finished) this.input.readSplit(1, p2.controls, dt);
        if (this.input.pressedSplit(1, 'camera') && this.rig2) {
          this.rig2.cycle();
          this.hud2?.showCamera(this.rig2.mode);
        }
        if (this.input.pressedSplit(0, 'camera')) this.cycleCamera();
        if (s.phase === 'racing' && this.input.pressedSplit(1, 'respawn')) s.respawn(p2);
        if (s.phase === 'racing' && this.input.pressedSplit(0, 'respawn')) s.respawn(s.player);
        if (this.input.anyStart() && s.phase !== 'results') {
          this.pauseGame();
          return;
        }
      } else if (!s.playerAutopilot && !s.player.finished) {
        this.input.read(s.player.controls, dt);
        if (this.controlOverride) Object.assign(s.player.controls, this.controlOverride);
      }
    } else if (racing && this.paused && !this.replay) {
      if (this.input.pressed('pause') && this.photo) {
        this.photoExit();
        return;
      }
      // Pause-menu hotkeys shown next to the buttons.
      if (!this.photo && this.nav.root && this.screens.current === 'pause') {
        if (this.input.pressed('restart') && s.mode !== 'championship' && s.mode !== 'tutorial') {
          this.restartRace();
          return;
        }
        if (this.input.isDown('KeyF') && !this.split) {
          this.photoMode();
          return;
        }
        if (this.input.pressed('camera')) this.cycleCamera();
      }
    }
    if (racing && !this.replay && s.phase === 'results' && this.screens.current === 'results' && s.mode !== 'championship' && this.input.pressed('restart')) {
      this.restartRace();
      return;
    }

    if (this.replay && this.photo && this.input.pressed('pause')) {
      this.photoExit();
      return;
    }
    const rp = this.replay;
    const simDt = rp ? (rp.playing ? dt * rp.speed : 0) : racing && this.paused ? 0 : dt * this.timeScale;
    if (rp) {
      if (!this.photo) {
        if (this.input.pressed('pause')) {
          this.replayExit();
          return;
        }
        if (this.input.pressed('drift')) this.replayToggle();
        if (this.input.pressed('camera')) this.replayCamera();
        if (this.input.pressed('restart')) this.replayRestart();
        if (this.input.pressed('right')) this.replayBar?.setTarget(this.replayTarget(1));
        if (this.input.pressed('left')) this.replayBar?.setTarget(this.replayTarget(-1));
      }
      rp.update(dt, this.events);
      this.replayBar?.update(rp.t, rp.duration, rp.playing);
    } else if (simDt > 0) {
      s.step(simDt);
      if (this.recorder && racing) this.recorder.record(simDt, this.events);
    }
    if (this.photo) {
      if (this.input.pressed('confirm')) this.photo.snap();
    }
    if (racing && this.tutorial && simDt > 0 && s.phase !== 'finished' && s.phase !== 'results') this.tutorial.update(simDt, this.events.list);
    // Touch overlay only while actually racing with no menu up.
    const showTouch = racing && !this.paused && !this.nav.root && this.touchEnabled && s.phase !== 'results' && this.rig.scripted !== 'free';
    if (showTouch !== this.touchShown) {
      this.touchShown = showTouch;
      this.touch.show(showTouch);
    }

    // Camera state machine.
    if (racing) {
      if (s.phase === 'intro') {
        if (this.rig.scripted !== 'intro') this.rig.startIntro();
      } else if (s.phase === 'countdown' || s.phase === 'racing') {
        if (this.rig.scripted === 'intro') this.rig.endScripted();
      } else if ((s.phase === 'finished' || s.phase === 'results') && !this.finishCamStarted && !rp) {
        this.finishCamStarted = true;
        this.rig.startFinish();
      }
    } else if (!this.garage && this.rig.scripted !== 'free') {
      this.rig.endScripted();
      this.rig.mode = 'cinematic';
    }
    const target = this.replay ? (s.racers[this.replayTargetIdx] ?? s.player).boat : s.player.boat;
    if (this.rig.scripted === 'free') this.driveFreeCam(dt);
    if (this.garage) this.updateGarageFx(dt);
    if (simDt > 0 || this.garage || this.rig.scripted === 'free' || rp) this.rig.update(simDt || dt, target, s.track, s.time);
    const r2 = this.rig2;
    if (r2 && racing) {
      if (s.phase !== 'intro' && r2.scripted === 'intro') r2.endScripted();
      if ((s.phase === 'finished' || s.phase === 'results') && r2.scripted !== 'finish') r2.startFinish();
      if (simDt > 0) r2.update(simDt, s.racers[1].boat, s.track, s.time);
    }

    w.update(simDt, s.time, this.rig, this.events);
    if (this.hud) this.hud.camera = this.rig.camera;
    if (!racing || this.replay || this.photo) {
      // No screen-space race FX behind menus, replays or photos.
      const fx = this.renderer.fx;
      fx.speed = fx.radial = fx.chroma = fx.flash = fx.impact = fx.drops = fx.damage = 0;
    }
    if (this.hud) this.hud.update(simDt);
    if (this.hud2) {
      this.hud2.camera = this.rig2?.camera ?? null;
      this.hud2.update(simDt);
    }

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
        this.hud2?.onEvent(e);
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
      this.music.setPressure((this.pressure = this.pressure + (this.racePressure(s) - this.pressure) * Math.min(1, dt * 0.8)));
      const r = w.fx.rumble;
      if (r.ms > 0 && this.input.lastDevice === 'gamepad') this.input.rumble(r.strong, r.weak, r.ms);
    }

    // Results.
    if (racing && s.phase === 'results' && !this.resultsShown) {
      this.resultsShown = true;
      this.replayData = this.recorder?.finish() ?? null;
      this.recorder = null;
      this.rewards = this.split ? noRewards(this.save.level) : applyRewards(s, this.save, { challenge: this.lastReq?.challenge, careerStage: this.lastReq?.careerStage });
      this.hud?.destroy();
      this.hud = null;
      this.hud2?.destroy();
      this.hud2 = null;
      this.screens.results(this.rewards);
    }
    this.debug?.update(dt);
    this.admin.update(dt);
  }

  private render(dt: number) {
    const w = this.world;
    if (this.stage) {
      this.renderer.render(this.stage.scene, this.stage.camera, w?.atmosphere.post ?? STAGE_POST, dt);
      return;
    }
    if (!w) return;
    this.renderTime += dt;
    if (this.rig2 && this.state === 'race') {
      const t = this.session?.time ?? 0;
      this.renderer.renderSplit(w.scene, [this.rig.camera, this.rig2.camera], w.atmosphere.post, dt, (cam) => w.prepareView(cam, t));
      return;
    }
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
      rider() {
        g.screens.rider();
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
      /** Direct access for ad-hoc debugging from harness scripts. */
      get game() {
        return g;
      },
      ghostCode: { encode: encodeGhost, decode: decodeGhost, fingerprint: ghostFingerprint },
      tutorialJump(i: number) {
        if (g.tutorial) g.tutorial.index = i;
      },
      tutorialStep() {
        return g.tutorial ? { step: g.tutorial.step, feedback: g.tutorial.feedback } : null;
      },
      startTutorial() {
        const prev = g.session;
        g.startTutorial();
        return new Promise<void>((res) => {
          const wait = () => (g.session && g.session !== prev && g.hud ? res() : setTimeout(wait, 20));
          wait();
        });
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
      /** Shallow-merge fields into the save (test setup). */
      patchSave(patch: Record<string, unknown>) {
        Object.assign(g.save.data, patch);
        g.save.save(true);
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
        const pr = ss?.layout.props.filter((p) => p.kind === kind).sort((a, b) => (g.world?.scenery.ground(a.x, a.z) ?? 0) - (g.world?.scenery.ground(b.x, b.z) ?? 0))[0];
        if (!ss || !pr) return false;
        g.garage = true; // keeps the rig in scripted orbit
        const off = kind === 'waterfall' ? pr.size * 0.75 : 0;
        const tx = pr.x + Math.cos(pr.rot) * off;
        const tz = pr.z + Math.sin(pr.rot) * off;
        const ty = kind === 'volcano' ? 120 : (g.world?.scenery.ground(tx, tz) ?? 0) + 6;
        g.rig.startOrbit(new Vector3(tx, ty, tz), radius, height);
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
