/**
 * Input: keyboard + gamepad, merged into one `Controls` for the player and a
 * set of edge-triggered UI actions. Bindings are configurable and saved.
 */

import { clamp } from '../core/mathx';
import type { Controls } from '../core/types';
import type { TouchControls } from './touch';

export type Action = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'boost' | 'roll' | 'item' | 'camera' | 'pause' | 'restart' | 'respawn' | 'confirm' | 'back';

export const ACTIONS: Action[] = ['throttle', 'brake', 'left', 'right', 'drift', 'boost', 'roll', 'item', 'camera', 'pause', 'restart', 'respawn', 'confirm'];

export const ACTION_LABEL: Record<Action, string> = {
  throttle: 'Throttle',
  brake: 'Brake / Reverse',
  left: 'Steer Left',
  right: 'Steer Right',
  drift: 'Drift / Trick',
  boost: 'Nitro Boost',
  roll: 'Barrel Roll (air)',
  item: 'Use Item (Battle)',
  camera: 'Cycle Camera',
  pause: 'Pause',
  restart: 'Restart',
  respawn: 'Respawn on Course',
  confirm: 'Confirm',
  back: 'Back',
};

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['ShiftLeft', 'ShiftRight', 'Space'],
  boost: ['KeyE', 'ControlLeft'],
  roll: ['KeyQ'],
  item: ['KeyF'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  respawn: ['KeyT'],
  confirm: ['Enter', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
};

/** Standard-mapping gamepad buttons per action. */
const PAD: Partial<Record<Action, number[]>> = {
  drift: [0, 5], // A, RB
  boost: [2], // X
  roll: [4], // LB
  item: [1], // B
  camera: [3], // Y
  pause: [9], // Start
  restart: [8], // Back/Select
  respawn: [11], // R3
  confirm: [0],
  back: [1],
};

/** Split-screen keyboard layouts: player 1 on the left of the keyboard, player 2 on the right. */
export type SplitAction = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'boost' | 'roll' | 'item' | 'camera' | 'respawn';
export const SPLIT_KEYS: Record<SplitAction, string[]>[] = [
  { throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drift: ['ShiftLeft', 'Space'], boost: ['KeyE'], roll: ['KeyQ'], item: ['KeyF'], camera: ['KeyC'], respawn: ['KeyT'] },
  { throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['ShiftRight', 'Numpad0'], boost: ['ControlRight', 'Numpad1'], roll: ['Period', 'Numpad2'], item: ['Slash', 'Numpad3'], camera: ['KeyM', 'Numpad5'], respawn: ['Backslash', 'Numpad6'] },
];

export function keyLabel(code: string) {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Arrow', '')
    .replace('Left', ' L')
    .replace('Right', ' R')
    .replace('Control', 'Ctrl')
    .replace('Space', 'Space')
    .trim();
}

export class Input {
  bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  sensitivity = 1;
  private down = new Set<string>();
  private pressedQ = new Set<Action>();
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  private padAxes = [0, 0, 0, 0];
  private padTriggers = [0, 0];
  padConnected = false;
  padName = '';
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  private steerSmooth = 0;
  /** Menu navigation intents from the gamepad only (keyboard is handled by Nav directly). */
  private padRightX = 0;
  /** Turntable / camera turn from the pad: shoulders (LB −, RB +) or right stick. */
  padTurn() {
    return (this.padNow[5] ? 1 : 0) - (this.padNow[4] ? 1 : 0) + this.padRightX;
  }
  readonly padNav: ('up' | 'down' | 'left' | 'right' | 'ok' | 'back')[] = [];
  private stickRepeat = 0;
  private stickDir = '';
  /** Every connected pad this frame (split-screen). */
  private pads: Gamepad[] = [];
  private padPrevById = new Map<number, boolean[]>();
  private codesPressed = new Set<string>();
  private splitSteer = [0, 0];
  /** On-screen touch controls, when active. */
  touch: TouchControls | null = null;
  /** When set, the next key press is captured for rebinding instead of acting. */
  captureNext: ((code: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.captureNext) {
        e.preventDefault();
        // Keep menus from also acting on the key being bound (e.g. Esc = back).
        e.stopImmediatePropagation();
        const f = this.captureNext;
        this.captureNext = null;
        f(e.code);
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) {
        this.codesPressed.add(e.code);
        for (const a of ACTIONS) if (this.bindings[a].includes(e.code)) this.pressedQ.add(a);
        if (DEFAULT_BINDINGS.back.includes(e.code)) this.pressedQ.add('back');
      }
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.padConnected = true;
      this.padName = (e as GamepadEvent).gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.padConnected = false;
    });
  }

  private held(a: Action) {
    const keys = this.bindings[a];
    for (let i = 0; i < keys.length; i++) if (this.down.has(keys[i])) return true;
    const pad = PAD[a];
    if (pad) for (const b of pad) if (this.padNow[b]) return true;
    return false;
  }

  /** Poll the gamepad; call once per frame before reading. */
  poll() {
    let gp: Gamepad | null = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    // Remember last frame's buttons per pad for split-screen edges.
    for (const p of this.pads) this.padPrevById.set(p.index, p.buttons.map((b) => b.pressed));
    this.pads.length = 0;
    for (const p of pads) if (p && p.connected) this.pads.push(p);
    for (const p of pads) if (p && p.connected) {
      gp = p;
      break;
    }
    this.padPrev.length = 0;
    for (let i = 0; i < this.padNow.length; i++) this.padPrev.push(this.padNow[i]);
    if (!gp) {
      this.padNow.length = 0;
      this.padTriggers[0] = this.padTriggers[1] = 0;
      this.padAxes[0] = this.padAxes[1] = 0;
      return;
    }
    this.padConnected = true;
    this.padNow.length = gp.buttons.length;
    let any = false;
    for (let i = 0; i < gp.buttons.length; i++) {
      this.padNow[i] = gp.buttons[i].pressed;
      if (this.padNow[i] && !this.padPrev[i]) any = true;
    }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.padAxes[0] = dz(gp.axes[0] ?? 0);
    this.padAxes[1] = dz(gp.axes[1] ?? 0);
    this.padRightX = dz(gp.axes[2] ?? 0);
    this.padTriggers[0] = gp.buttons[6]?.value ?? 0;
    this.padTriggers[1] = gp.buttons[7]?.value ?? 0;
    if (any || Math.abs(this.padAxes[0]) > 0.3 || this.padTriggers[1] > 0.2) this.lastDevice = 'gamepad';
    // Edge-triggered pad actions.
    for (const a of Object.keys(PAD) as Action[]) {
      for (const b of PAD[a]!) if (this.padNow[b] && !this.padPrev[b]) this.pressedQ.add(a);
    }
    // Menu navigation: D-pad edges, left stick with auto-repeat, A / B.
    const edge = (i: number) => !!gp!.buttons[i]?.pressed && !this.padPrev[i];
    if (edge(12)) this.padNav.push('up');
    if (edge(13)) this.padNav.push('down');
    if (edge(14)) this.padNav.push('left');
    if (edge(15)) this.padNav.push('right');
    if (edge(0)) this.padNav.push('ok');
    if (edge(1)) this.padNav.push('back');
    const ax = this.padAxes[0];
    const ay = this.padAxes[1];
    const dir = Math.abs(ay) > 0.6 ? (ay < 0 ? 'up' : 'down') : Math.abs(ax) > 0.6 ? (ax < 0 ? 'left' : 'right') : '';
    const now = performance.now();
    if (dir && (dir !== this.stickDir || now > this.stickRepeat)) {
      this.padNav.push(dir as 'up');
      this.stickRepeat = now + (dir !== this.stickDir ? 380 : 140);
    }
    this.stickDir = dir;
    if (this.padNav.length > 8) this.padNav.splice(0, this.padNav.length - 8);
  }

  /** Edge-triggered: true once per press. */
  pressed(a: Action) {
    if (this.touch && (a === 'pause' || a === 'camera') && this.touch.take(a)) return true;
    if (this.pressedQ.has(a)) {
      this.pressedQ.delete(a);
      return true;
    }
    return false;
  }

  /** Drop queued presses (screen changes). */
  flush() {
    this.pressedQ.clear();
    this.codesPressed.clear();
    this.touch?.pressed.clear();
  }

  /** Fill the player's controls. */
  read(c: Controls, dt: number) {
    const kbSteer = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    // Keyboard steering ramps in rather than snapping — keeps small corrections possible.
    const target = kbSteer;
    const rate = (target === 0 ? 10 : 6) * this.sensitivity;
    this.steerSmooth += clamp(target - this.steerSmooth, -rate * dt, rate * dt);
    const padSteer = clamp(this.padAxes[0] * this.sensitivity, -1, 1);
    c.steer = Math.abs(padSteer) > Math.abs(this.steerSmooth) ? padSteer : this.steerSmooth;
    c.throttle = Math.max(this.held('throttle') ? 1 : 0, this.padTriggers[1]);
    c.brake = Math.max(this.held('brake') ? 1 : 0, this.padTriggers[0]);
    // Air pitch: throttle pushes the nose down, brake pulls up; stick Y too.
    c.pitch = clamp((this.held('throttle') ? 1 : 0) - (this.held('brake') ? 1 : 0) - this.padAxes[1], -1, 1);
    c.drift = this.held('drift');
    c.boost = this.held('boost');
    c.roll = this.held('roll');
    c.item = this.held('item');
    const t = this.touch;
    if (t) {
      const ts = clamp(t.steerValue * this.sensitivity, -1, 1);
      if (Math.abs(ts) > Math.abs(c.steer)) c.steer = ts;
      if (t.held.gas) c.throttle = 1;
      if (t.held.brake) c.brake = 1;
      if (t.held.drift) c.drift = true;
      if (t.held.boost) c.boost = true;
      if (t.held.roll) c.roll = true;
      if (t.held.item) c.item = true;
      if (Math.abs(t.pitch) > 0.2) c.pitch = clamp(-t.pitch, -1, 1);
      else if (t.held.gas && c.pitch === 0) c.pitch = 1;
    }
  }

  rumble(strong: number, weak: number, ms: number) {
    if (ms <= 0) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      const act = p?.vibrationActuator as (GamepadHapticActuator & { playEffect?: (t: string, o: object) => Promise<unknown> }) | undefined;
      if (act?.playEffect) {
        act.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {
          /* Haptics are best-effort: unsupported actuators reject and that is fine. */
        });
      }
    }
  }

  /** Pad assigned to a split-screen player: two pads → one each; one pad → player 2. */
  private splitPad(which: number): Gamepad | null {
    if (this.pads.length >= 2) return this.pads[which] ?? null;
    if (this.pads.length === 1) return which === 1 ? this.pads[0] : null;
    return null;
  }

  /** Split-screen: fill one player's controls from their keys and pad. */
  readSplit(which: number, c: Controls, dt: number) {
    const map = SPLIT_KEYS[which];
    const k = (a: SplitAction) => map[a].some((code) => this.down.has(code));
    const pad = this.splitPad(which);
    const pb = (i: number) => !!pad?.buttons[i]?.pressed;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const kb = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    const rate = (kb === 0 ? 10 : 6) * this.sensitivity;
    this.splitSteer[which] += clamp(kb - this.splitSteer[which], -rate * dt, rate * dt);
    const ps = clamp(dz(pad?.axes[0] ?? 0) * this.sensitivity, -1, 1);
    c.steer = Math.abs(ps) > Math.abs(this.splitSteer[which]) ? ps : this.splitSteer[which];
    c.throttle = Math.max(k('throttle') ? 1 : 0, pad?.buttons[7]?.value ?? 0);
    c.brake = Math.max(k('brake') ? 1 : 0, pad?.buttons[6]?.value ?? 0);
    c.pitch = clamp((k('throttle') ? 1 : 0) - (k('brake') ? 1 : 0) - dz(pad?.axes[1] ?? 0), -1, 1);
    c.drift = k('drift') || pb(0) || pb(5);
    c.boost = k('boost') || pb(2);
    c.roll = k('roll') || pb(4);
    c.item = k('item') || pb(1);
  }

  /** Split-screen edge-triggered action for one player. */
  pressedSplit(which: number, a: 'camera' | 'respawn') {
    let hit = false;
    for (const code of SPLIT_KEYS[which][a]) if (this.codesPressed.delete(code)) hit = true;
    const pad = this.splitPad(which);
    const btn = a === 'camera' ? 3 : 11;
    if (pad && pad.buttons[btn]?.pressed && !this.padPrevById.get(pad.index)?.[btn]) hit = true;
    return hit;
  }

  /** Any pad's Start button this frame (split-screen pause). */
  anyStart() {
    for (const p of this.pads) if (p.buttons[9]?.pressed && !this.padPrevById.get(p.index)?.[9]) return true;
    return false;
  }

  /** Raw key state (free camera, photo mode). */
  isDown(code: string) {
    return this.down.has(code);
  }

  /** Testing hook: inject a key state. */
  simulateKey(code: string, isDown: boolean) {
    if (isDown) {
      if (!this.down.has(code)) for (const a of ACTIONS) if (this.bindings[a].includes(code)) this.pressedQ.add(a);
      this.down.add(code);
    } else this.down.delete(code);
  }
}
