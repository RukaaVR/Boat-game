/**
 * 3–4 player split-screen (2×2 grid).
 *
 * Players 1 and 2 keep the game's existing camera / HUD (`rig`, `rig2`,
 * `hud`, `hud2`); this module owns everything added for players 3 and 4:
 * their camera rigs, HUDs and HUD wrappers, the overview panel that fills the
 * spare quarter with three players, the grid layout, per-player input and
 * haptics, and the temporary graphics step-down while four views render.
 *
 * Two-player split-screen never creates one of these, so it is unchanged.
 */

import type { Camera } from 'three';
import { CameraRig } from '../camera/cameraRig';
import { Hud } from '../ui/hud';
import { Overview } from '../ui/overview';
import type { RaceSession } from '../race/session';
import type { Racer } from '../race/racer';
import type { Input } from '../input/input';
import type { GameEvent } from './events';
import type { Bindings } from '../input/input';
import type { Renderer, Quality } from '../render/renderer';
import { LOD } from '../render/lod';
import { A11Y } from './a11y';

export type Rect = readonly [number, number, number, number];
/** Quarter viewports, origin top-left: P1 TL, P2 TR, P3 BL, P4 / overview BR. */
export const QUAD_RECTS: readonly Rect[] = [
  [0, 0, 0.5, 0.5],
  [0.5, 0, 0.5, 0.5],
  [0, 0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.5],
];

interface View {
  racer: Racer;
  which: number;
  rig: CameraRig;
  hud: Hud;
  wrap: HTMLElement;
}

const STEP_DOWN: Record<Quality, Quality> = { high: 'medium', medium: 'low', low: 'low' };

/**
 * Lower the render load for 3–4 views. Must run before the race world is
 * built (ocean, particle and rain budgets are taken from the renderer quality
 * at build time). The game restores its own settings afterwards.
 */
export function enterSplitPerf(renderer: Renderer, players: number) {
  const four = players >= 4;
  renderer.setQuality(STEP_DOWN[renderer.quality]);
  renderer.setMaxPixelRatio(Math.min(renderer.maxPixelRatio, four ? 0.85 : 1));
  LOD.scale *= four ? 0.6 : 0.72;
  if (four) LOD.outlines = 0;
  A11Y.particles *= four ? 0.6 : 0.75;
}

export class MoreViews {
  readonly views: View[] = [];
  readonly overview: Overview | null;
  readonly rects: readonly Rect[] = QUAD_RECTS;
  private cams: Camera[] = [];
  private hudsOn = true;

  constructor(
    private session: RaceSession,
    ui: HTMLElement,
    base: CameraRig,
    ground: (x: number, z: number) => number,
    units: 'kmh' | 'mph',
    bindings: Bindings,
  ) {
    const s = session;
    for (let which = 2; which < s.humans.length; which++) {
      const wrap = document.createElement('div');
      wrap.className = `splitwrap quad q${which}`;
      ui.appendChild(wrap);
      const hud = new Hud(s, wrap, units, bindings, false, s.humans[which]);
      const rig = new CameraRig(1);
      rig.ramps = s.track.ramps;
      rig.boats = s.racers.map((r) => r.boat);
      rig.ground = ground;
      rig.seaLift = base.seaLift;
      rig.shakeScale = base.shakeScale;
      rig.motionScale = base.motionScale;
      rig.startIntro();
      this.views.push({ racer: s.humans[which], which, rig, hud, wrap });
    }
    if (s.humans.length === 3) {
      const wrap = document.createElement('div');
      wrap.className = 'splitwrap quad q3 ovwrap';
      ui.appendChild(wrap);
      this.overview = new Overview(s, wrap);
      this.ovWrap = wrap;
    } else this.overview = null;
    this.resize();
  }
  private ovWrap: HTMLElement | null = null;

  /** Cameras for players 3 (and 4), in grid order after players 1–2. */
  get cameras(): Camera[] {
    this.cams.length = 0;
    for (const v of this.views) this.cams.push(v.rig.camera);
    return this.cams;
  }

  /** Quarter-sized aspect and HUD view sizes for every view (P1/P2 included). */
  resize(rig1?: CameraRig, rig2?: CameraRig | null, hud1?: Hud | null, hud2?: Hud | null) {
    const w = window.innerWidth / 2;
    const h = window.innerHeight / 2;
    const aspect = w / Math.max(1, h);
    rig1?.setAspect(aspect);
    rig2?.setAspect(aspect);
    for (const hd of [hud1, hud2]) {
      if (!hd) continue;
      hd.viewW = w;
      hd.viewH = h;
      hd.resize();
    }
    for (const v of this.views) {
      v.rig.setAspect(aspect);
      v.hud.viewW = w;
      v.hud.viewH = h;
      v.hud.resize();
    }
    this.overview?.resize();
  }

  /** Read players 3–4's pads: controls, camera cycle and respawn. */
  readInput(input: Input, dt: number) {
    const s = this.session;
    for (const v of this.views) {
      if (!v.racer.finished) input.readSplit(v.which, v.racer.controls, dt);
      if (input.pressedSplit(v.which, 'camera')) v.hud.showCamera(v.rig.cycle());
      if (s.phase === 'racing' && input.pressedSplit(v.which, 'respawn')) s.respawn(v.racer);
    }
  }

  update(simDt: number, realDt: number) {
    const s = this.session;
    for (const v of this.views) {
      const r = v.rig;
      if (s.phase !== 'intro' && r.scripted === 'intro') r.endScripted();
      if ((s.phase === 'finished' || s.phase === 'results') && r.scripted !== 'finish') r.startFinish();
      if (simDt > 0) r.update(simDt, v.racer.boat, s.track, s.time);
      if (this.hudsOn) {
        v.hud.camera = r.camera;
        v.hud.update(simDt);
      }
    }
    this.overview?.update(realDt);
  }

  onEvent(e: GameEvent) {
    if (!this.hudsOn) return;
    for (const v of this.views) v.hud.onEvent(e);
  }

  /** Results: the race HUDs go (the overview stays until teardown). */
  destroyHuds() {
    if (!this.hudsOn) return;
    this.hudsOn = false;
    for (const v of this.views) v.hud.destroy();
    this.overview?.destroy();
  }

  destroy() {
    this.destroyHuds();
    for (const v of this.views) v.wrap.remove();
    this.ovWrap?.remove();
  }
}

/**
 * Per-player haptics in split-screen: each player's own pad pulses on their
 * drift spark tiers (harder each tier), the hull snapping into a slide, the
 * mini-turbo release and a landed wave flip. Player 1's single-player rumble
 * stays with the FX director.
 */
export function splitHaptics(e: GameEvent, session: RaceSession, input: Input, skipFirst: boolean) {
  if (e.racer < 0) return;
  const which = session.humans.indexOf(session.racers[e.racer]);
  if (which < 0 || (skipFirst && which === 0)) return;
  switch (e.type) {
    case 'driftTier':
      input.rumbleSplit(which, 0.08 + 0.12 * e.value, 0.3 + 0.15 * e.value, 60 + 30 * e.value);
      break;
    case 'driftStart':
      input.rumbleSplit(which, 0.12, 0.3, 60);
      break;
    case 'boostStart':
      if (e.value >= 1) input.rumbleSplit(which, 0.25 + 0.15 * e.value, 0.6, 140 + 60 * e.value);
      break;
    case 'waveLand':
      input.rumbleSplit(which, 0.15, 0.5, 120);
      break;
    case 'land':
      if (e.value > 0.3) input.rumbleSplit(which, 0.3 + 0.6 * e.value, 0.4, 180);
      break;
    case 'wipeout':
      input.rumbleSplit(which, 1, 1, 350);
      break;
    case 'collide':
      if (e.value > 0.4) input.rumbleSplit(which, 0.5 + 0.5 * e.value, 0.6, 220);
      break;
  }
}
