/**
 * Replay transport bar and photo-mode panel. Both are thin DOM overlays that
 * call back into the game; neither touches the simulation directly.
 */

import { formatTime } from '../core/mathx';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface ReplayHost {
  replayToggle(): void;
  replaySpeed(v: number): void;
  replayRestart(): void;
  replayCamera(): string;
  replayTarget(dir: number): string;
  replayExit(): void;
  photoMode(): void;
}

export class ReplayBar {
  readonly el: HTMLElement;
  private time: HTMLElement;
  private fill: HTMLElement;
  private play: HTMLElement;
  private label: HTMLElement;
  private info: HTMLElement;
  private infoText = '';

  constructor(
    parent: HTMLElement,
    host: ReplayHost,
    target: string,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'replaybar';
    el.innerHTML = `<div class="rb-top"><span class="rb-rec">● REPLAY</span><span class="rb-label">${esc(target)}</span><span class="rb-info"></span><span class="rb-time">0:00</span></div>
      <div class="rb-track"><div class="rb-fill"></div></div>
      <div class="rb-btns">
        <button data-r="restart" title="Restart">⏮</button>
        <button data-r="play" title="Play / pause (Space)">❚❚</button>
        <button data-r="speed" data-v="0.25">¼×</button><button data-r="speed" data-v="0.5">½×</button><button data-r="speed" data-v="1" class="on">1×</button><button data-r="speed" data-v="2">2×</button>
        <button data-r="prev" title="Previous boat">◀ BOAT</button><button data-r="next" title="Next boat (Tab)">BOAT ▶</button>
        <button data-r="cam" title="Camera (C)">CAMERA</button>
        <button data-r="photo" title="Photo mode">PHOTO</button>
        <button data-r="exit" title="Back to results (Esc)">EXIT</button>
      </div>`;
    parent.appendChild(el);
    this.time = el.querySelector('.rb-time')!;
    this.fill = el.querySelector('.rb-fill')!;
    this.play = el.querySelector('[data-r=play]')!;
    this.label = el.querySelector('.rb-label')!;
    this.info = el.querySelector('.rb-info')!;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-r]') as HTMLElement | null;
      if (!b) return;
      switch (b.dataset.r) {
        case 'play':
          host.replayToggle();
          break;
        case 'restart':
          host.replayRestart();
          break;
        case 'speed':
          host.replaySpeed(Number(b.dataset.v));
          el.querySelectorAll('[data-r=speed]').forEach((x) => x.classList.toggle('on', x === b));
          break;
        case 'prev':
          this.label.textContent = host.replayTarget(-1);
          break;
        case 'next':
          this.label.textContent = host.replayTarget(1);
          break;
        case 'cam':
          b.textContent = host.replayCamera();
          break;
        case 'photo':
          host.photoMode();
          break;
        case 'exit':
          host.replayExit();
          break;
      }
    });
  }

  setTarget(name: string) {
    this.label.textContent = name;
  }

  /** Small status next to the followed boat's name (pearls carried, trailed item). */
  setInfo(text: string) {
    if (text === this.infoText) return;
    this.infoText = text;
    this.info.textContent = text;
  }

  update(t: number, duration: number, playing: boolean) {
    this.time.textContent = `${formatTime(t, false)} / ${formatTime(duration, false)}`;
    this.fill.style.transform = `scaleX(${duration > 0 ? (t / duration).toFixed(4) : 0})`;
    this.play.textContent = playing ? '❚❚' : '▶';
  }

  show(on: boolean) {
    this.el.style.display = on ? '' : 'none';
  }

  dispose() {
    this.el.remove();
  }
}

export const PHOTO_FILTERS: Record<string, string> = {
  NONE: '',
  VIVID: 'saturate(1.6) contrast(1.1)',
  NOIR: 'grayscale(1) contrast(1.35) brightness(1.05)',
  SEPIA: 'sepia(0.85) contrast(1.05) brightness(1.05)',
  RETRO: 'contrast(1.25) saturate(1.35) hue-rotate(-14deg)',
  DREAM: 'brightness(1.12) saturate(1.25) blur(0.6px)',
};

export interface PhotoHost {
  photoFov(v: number): void;
  photoRoll(v: number): void;
  photoSnap(filter: string): void;
  photoExit(): void;
  photoHideBoats(hide: boolean): void;
}

export class PhotoPanel {
  readonly el: HTMLElement;
  filter = '';
  private hide = false;

  constructor(
    parent: HTMLElement,
    private host: PhotoHost,
    private canvas: HTMLCanvasElement,
    fov: number,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'photopanel';
    el.innerHTML = `<div class="pp-row"><b>PHOTO MODE</b><span class="pp-hint">WASD move · arrows look · Q/E down/up · Shift fast · Enter snap · Esc exit</span></div>
      <div class="pp-row"><label>FOV <input type="range" min="15" max="100" step="1" value="${fov.toFixed(0)}" data-p="fov"></label>
      <label>TILT <input type="range" min="-0.6" max="0.6" step="0.01" value="0" data-p="roll"></label>
      <button data-p="boats">HIDE BOATS</button></div>
      <div class="pp-row">${Object.keys(PHOTO_FILTERS).map((f) => `<button data-p="filter" data-v="${f}" class="${f === 'NONE' ? 'on' : ''}">${f}</button>`).join('')}
      <span style="flex:1"></span><button class="pp-snap" data-p="snap">📸 SNAP</button><button data-p="exit">EXIT</button></div>`;
    parent.appendChild(el);
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.p === 'fov') host.photoFov(Number(t.value));
      if (t.dataset.p === 'roll') host.photoRoll(Number(t.value));
    });
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.p === 'filter') {
        this.filter = PHOTO_FILTERS[b.dataset.v!] ?? '';
        this.canvas.style.filter = this.filter;
        el.querySelectorAll('[data-p=filter]').forEach((x) => x.classList.toggle('on', x === b));
      } else if (b.dataset.p === 'snap') this.snap();
      else if (b.dataset.p === 'exit') host.photoExit();
      else if (b.dataset.p === 'boats') {
        this.hide = !this.hide;
        b.classList.toggle('on', this.hide);
        host.photoHideBoats(this.hide);
      }
    });
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  snap() {
    this.host.photoSnap(this.filter);
    this.el.classList.add('flash');
    setTimeout(() => this.el.classList.remove('flash'), 300);
  }

  dispose() {
    this.canvas.style.filter = '';
    this.el.remove();
  }
}
