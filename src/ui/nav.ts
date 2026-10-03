/**
 * Spatial menu navigation for keyboard and gamepad. Any element with
 * `data-nav` is focusable; arrows/WASD/D-pad move to the nearest element in
 * that direction, Enter/A activates, Escape/B goes back. Mouse hover moves the
 * focus so the two never fight.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

export class Nav {
  root: HTMLElement | null = null;
  current: HTMLElement | null = null;
  onBack: (() => void) | null = null;
  onMove: (() => void) | null = null;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || !this.root) return;
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      const k = e.code;
      let used = true;
      if (k === 'ArrowUp' || k === 'KeyW') this.move('up');
      else if (k === 'ArrowDown' || k === 'KeyS') this.move('down');
      else if (k === 'ArrowLeft' || k === 'KeyA') this.move('left');
      else if (k === 'ArrowRight' || k === 'KeyD') this.move('right');
      else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.activate();
      else if (k === 'Escape' || k === 'Backspace') this.back();
      else used = false;
      if (used) e.preventDefault();
    });
  }

  attach(root: HTMLElement, onBack: (() => void) | null, initial?: HTMLElement | null) {
    this.root = root;
    this.onBack = onBack;
    root.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
      if (t && t !== this.current && root.contains(t)) this.focus(t, false);
    });
    const first = initial ?? (root.querySelector('[data-nav].sel, [data-nav].on, [data-nav][data-default]') as HTMLElement | null) ?? (root.querySelector('[data-nav]') as HTMLElement | null);
    this.current = null;
    if (first) this.focus(first, false);
  }

  detach() {
    this.root = null;
    this.current = null;
  }

  focus(el: HTMLElement, sound = true) {
    if (this.current) this.current.classList.remove('focus');
    this.current = el;
    el.classList.add('focus');
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (sound) this.onMove?.();
  }

  private candidates() {
    return Array.from(this.root!.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => e.offsetParent !== null && !e.classList.contains('disabled'));
  }

  move(dir: Dir) {
    if (!this.root) return;
    const list = this.candidates();
    if (!list.length) return;
    if (!this.current || !this.root.contains(this.current)) {
      this.focus(list[0]);
      return;
    }
    // Sliders consume left/right.
    const range = this.current.querySelector('input[type=range]') as HTMLInputElement | null;
    if (range && (dir === 'left' || dir === 'right')) {
      const step = Number(range.step) || 1;
      range.value = String(Number(range.value) + (dir === 'right' ? step : -step));
      range.dispatchEvent(new Event('input', { bubbles: true }));
      this.onMove?.();
      return;
    }
    const a = this.current.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of list) {
      if (e === this.current) continue;
      const r = e.getBoundingClientRect();
      const bx = r.left + r.width / 2;
      const by = r.top + r.height / 2;
      const dx = bx - ax;
      const dy = by - ay;
      let primary: number;
      let secondary: number;
      switch (dir) {
        case 'up':
          primary = -dy;
          secondary = Math.abs(dx);
          break;
        case 'down':
          primary = dy;
          secondary = Math.abs(dx);
          break;
        case 'left':
          primary = -dx;
          secondary = Math.abs(dy);
          break;
        default:
          primary = dx;
          secondary = Math.abs(dy);
      }
      if (primary <= 2) continue;
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best && (dir === 'down' || dir === 'up')) {
      // Wrap vertically.
      const idx = list.indexOf(this.current);
      best = dir === 'down' ? list[(idx + 1) % list.length] : list[(idx - 1 + list.length) % list.length];
    }
    if (best) this.focus(best);
  }

  activate() {
    if (!this.current || !this.root?.contains(this.current)) return;
    const range = this.current.querySelector('input[type=range]');
    if (range) return;
    this.current.click();
  }

  back() {
    this.onBack?.();
  }
}
