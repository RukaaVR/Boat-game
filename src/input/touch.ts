/**
 * On-screen touch controls for phones and tablets.
 *
 * Left half of the screen: a floating thumbstick that appears wherever the
 * thumb lands (steer on X, air pitch on Y). Right side: GAS (big), BRAKE,
 * DRIFT, NITRO and TRICK buttons, plus small PAUSE / CAMERA buttons at the
 * top. Optional tilt steering reads device orientation instead of the stick.
 * Multi-touch: each pointer is tracked independently, so you can hold GAS and
 * DRIFT while steering.
 */

import { clamp } from '../core/mathx';

type Btn = 'gas' | 'brake' | 'drift' | 'boost' | 'roll' | 'item' | 'pause' | 'camera';

export class TouchControls {
  readonly root: HTMLElement;
  steer = 0;
  pitch = 0;
  readonly held: Record<Btn, boolean> = { gas: false, brake: false, drift: false, boost: false, roll: false, item: false, pause: false, camera: false };
  /** Edge-triggered buttons consumed by the game. */
  readonly pressed = new Set<Btn>();
  tilt = false;
  private tiltSteer = 0;
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private knob: HTMLElement;
  private base: HTMLElement;
  private btnFor = new Map<number, Btn>();
  private onOrient = (e: DeviceOrientationEvent) => {
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let v = 0;
    if (angle === 90) v = (e.beta ?? 0) / 28;
    else if (angle === -90 || angle === 270) v = -(e.beta ?? 0) / 28;
    else v = (e.gamma ?? 0) / 28;
    this.tiltSteer = clamp(v, -1, 1);
  };

  constructor(parent: HTMLElement) {
    const r = (this.root = document.createElement('div'));
    r.className = 'touch';
    r.innerHTML = `
      <div class="t-stick"><div class="t-base"></div><div class="t-knob"></div></div>
      <button class="t-btn t-gas" data-b="gas">GAS</button>
      <button class="t-btn t-brake" data-b="brake">BRAKE</button>
      <button class="t-btn t-drift" data-b="drift">DRIFT</button>
      <button class="t-btn t-boost" data-b="boost">NITRO</button>
      <button class="t-btn t-roll" data-b="roll">TRICK</button>
      <button class="t-btn t-item" data-b="item" style="display:none">ITEM</button>
      <button class="t-btn t-small t-pause" data-b="pause">❚❚</button>
      <button class="t-btn t-small t-cam" data-b="camera">CAM</button>`;
    parent.appendChild(r);
    this.base = r.querySelector('.t-base')!;
    this.knob = r.querySelector('.t-knob')!;
    const stickZone = r.querySelector('.t-stick') as HTMLElement;
    r.addEventListener('contextmenu', (e) => e.preventDefault());

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.base.style.transform = this.knob.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.base.style.opacity = this.knob.style.opacity = '1';
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const R = 60;
      let dx = e.clientX - this.stickX;
      let dy = e.clientY - this.stickY;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      this.knob.style.transform = `translate(${this.stickX + dx}px, ${this.stickY + dy}px)`;
      // Small dead zone, then a gentle curve so small corrections are possible.
      const sx = dx / R;
      const sy = dy / R;
      const curve = (v: number) => Math.sign(v) * Math.max(0, (Math.abs(v) - 0.08) / 0.92) ** 1.3;
      this.steer = curve(sx);
      this.pitch = curve(sy);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.steer = this.pitch = 0;
      this.base.style.opacity = this.knob.style.opacity = '0';
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);

    r.querySelectorAll<HTMLElement>('.t-btn').forEach((btn) => {
      const b = btn.dataset.b as Btn;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        this.btnFor.set(e.pointerId, b);
        this.held[b] = true;
        this.pressed.add(b);
        btn.classList.add('on');
        navigator.vibrate?.(8);
      });
      const up = (e: PointerEvent) => {
        if (this.btnFor.get(e.pointerId) !== b) return;
        this.btnFor.delete(e.pointerId);
        this.held[b] = false;
        btn.classList.remove('on');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
  }

  /** Effective steer (tilt or stick). */
  get steerValue() {
    return this.tilt && this.stickId === -1 ? this.tiltSteer : this.steer;
  }

  setTilt(on: boolean) {
    if (on === this.tilt) return;
    this.tilt = on;
    if (on) {
      // iOS needs an explicit permission request from a user gesture.
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DOE.requestPermission === 'function') DOE.requestPermission().catch(() => undefined);
      window.addEventListener('deviceorientation', this.onOrient);
    } else window.removeEventListener('deviceorientation', this.onOrient);
  }

  /** Show the ITEM button (battle mode only). */
  setItemButton(on: boolean) {
    (this.root.querySelector('.t-item') as HTMLElement).style.display = on ? '' : 'none';
  }

  show(on: boolean) {
    this.root.style.display = on ? '' : 'none';
    if (!on) this.release();
  }

  release() {
    for (const k of Object.keys(this.held) as Btn[]) this.held[k] = false;
    this.steer = this.pitch = 0;
    this.stickId = -1;
    this.root.querySelectorAll('.t-btn.on').forEach((b) => b.classList.remove('on'));
  }

  take(b: Btn) {
    if (!this.pressed.has(b)) return false;
    this.pressed.delete(b);
    return true;
  }

  dispose() {
    this.setTilt(false);
    this.root.remove();
  }
}

/** True on devices whose primary pointer is a finger. */
export function isTouchDevice() {
  return matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}
