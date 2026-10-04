/**
 * Split-screen overview panel (3 players: fills the spare fourth quarter).
 * A north-up map of the whole course with every boat on it, and live
 * standings. The course outline is a prebuilt Path2D; each frame only the
 * dots are drawn, and the standings list is rewritten only when it changes.
 */

import type { RaceSession } from '../race/session';
import { formatTime } from '../core/mathx';

/** Player colours used by every split-screen HUD tag (P1 … P4). */
export const PLAYER_COLORS = ['#ff4fd8', '#26e8ff', '#a6ff3d', '#ffd21e'];

export class Overview {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private list: HTMLElement;
  private head: HTMLElement;
  private course = new Path2D();
  private bounds = { x0: 0, x1: 1, z0: 0, z1: 1 };
  private dpr = 1;
  private w = 1;
  private h = 1;
  private lastKey = '';
  private acc = 0;

  constructor(
    private session: RaceSession,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ovpanel';
    this.root.innerHTML = `<div class="ov-head"></div><div class="ov-body"><canvas class="ov-map"></canvas><div class="ov-list"></div></div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.list = this.root.querySelector('.ov-list')!;
    this.head = this.root.querySelector('.ov-head')!;
    const t = session.track;
    const first = t.sprint ? -Math.round(60 / 2.5) : 0;
    const last = t.sprint ? Math.round(t.lapLength / 2.5) : t.n;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = first; i <= last; i += 2) {
      const k = ((i % t.n) + t.n) % t.n;
      const x = t.px[k];
      const z = t.pz[k];
      if (i === first) this.course.moveTo(x, z);
      else this.course.lineTo(x, z);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    if (!t.sprint) this.course.closePath();
    if (t.arena) {
      x0 = z0 = -200;
      x1 = z1 = 200;
    }
    const pad = t.width;
    this.bounds = { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
    requestAnimationFrame(() => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, this.canvas.clientWidth);
    this.h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  update(dt: number) {
    const s = this.session;
    this.draw();
    this.acc -= dt;
    if (this.acc > 0) return;
    this.acc = 0.25;
    // Standings.
    const leader = s.order[0];
    let key = '';
    for (const r of s.order) key += `${r.id}:${r.lap}:${r.finished ? 1 : 0}:${r.eliminated ? 1 : 0}:${r.lives}:${r.battleScore},`;
    key += Math.floor(s.raceTime * 2);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const head = s.hasLaps ? `LAP ${Math.min(Math.max(1, leader?.lap ?? 1), s.totalLaps)} / ${s.totalLaps} · ${formatTime(s.raceTime, false)}` : formatTime(s.raceTime, false);
    this.head.textContent = head;
    let h = '';
    for (const r of s.order) {
      const human = s.humans.indexOf(r);
      const col = human >= 0 ? PLAYER_COLORS[human] : r.livery.hull;
      const gap = s.battleRule
        ? r.eliminated
          ? 'OUT'
          : `${r.battleScore} HIT${r.battleScore === 1 ? '' : 'S'}`
        : r === leader
          ? r.finished
            ? 'FIN'
            : ''
          : r.finished
            ? 'FIN'
            : `+${Math.max(0, (leader.raceDist - r.raceDist) / Math.max(10, leader.boat.speed || 25)).toFixed(1)}`;
      h += `<div class="${human >= 0 ? 'me' : ''}"><span class="p">${r.place}</span><i style="background:${col}"></i><span class="n">${r.name}</span><span class="g">${gap}</span></div>`;
    }
    this.list.innerHTML = h;
  }

  private draw() {
    const c = this.ctx;
    const s = this.session;
    const W = this.w * this.dpr;
    const H = this.h * this.dpr;
    const b = this.bounds;
    const sc = Math.min(W / (b.x1 - b.x0), H / (b.z1 - b.z0));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    // World → map, north-up (world +Z is up on the map), mirrored so the map
    // matches the minimaps' left/right.
    const ox = W / 2 + ((b.x0 + b.x1) / 2) * sc;
    const oy = H / 2 + ((b.z0 + b.z1) / 2) * sc;
    c.setTransform(-sc, 0, 0, -sc, ox, oy);
    const lw = 1 / sc;
    c.lineJoin = 'round';
    if (s.track.arena) {
      c.beginPath();
      c.arc(0, 0, 182, 0, Math.PI * 2);
      c.fillStyle = 'rgba(120,230,255,0.14)';
      c.fill();
      c.strokeStyle = 'rgba(38,232,255,0.8)';
      c.lineWidth = 3 * lw * this.dpr;
      c.stroke();
    } else {
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = s.track.width;
      c.stroke(this.course);
      c.strokeStyle = 'rgba(38,232,255,0.9)';
      c.lineWidth = 2.5 * lw * this.dpr;
      c.stroke(this.course);
      // Start / finish line.
      const g = s.track.gates[s.track.sprint ? s.track.gates.length - 1 : 0];
      const half = s.track.width * 0.6;
      const rx = -Math.cos(g.heading);
      const rz = Math.sin(g.heading);
      c.beginPath();
      c.moveTo(g.x - rx * half, g.z - rz * half);
      c.lineTo(g.x + rx * half, g.z + rz * half);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4 * lw * this.dpr;
      c.stroke();
    }
    // Rivals first, humans on top.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = s.racers.length - 1; i >= 0; i--) {
        const r = s.racers[i];
        const human = s.humans.indexOf(r);
        if ((human >= 0) !== (pass === 1) || r.eliminated) continue;
        const p = r.boat.position;
        c.beginPath();
        c.arc(p.x, p.z, (human >= 0 ? 7.5 : 5) * lw * this.dpr, 0, Math.PI * 2);
        c.fillStyle = human >= 0 ? PLAYER_COLORS[human] : r.livery.hull;
        c.fill();
        c.lineWidth = 1.6 * lw * this.dpr;
        c.strokeStyle = '#0a0f22';
        c.stroke();
      }
    }
    // Player labels in screen space.
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.font = `800 ${Math.round(11 * this.dpr)}px "Barlow Condensed", sans-serif`;
    c.textAlign = 'center';
    for (let h = 0; h < s.humans.length; h++) {
      const p = s.humans[h].boat.position;
      const x = ox - p.x * sc;
      const y = oy - p.z * sc - 11 * this.dpr;
      c.lineWidth = 3 * this.dpr;
      c.strokeStyle = '#0a0f22';
      c.strokeText(`P${h + 1}`, x, y);
      c.fillStyle = PLAYER_COLORS[h];
      c.fillText(`P${h + 1}`, x, y);
    }
  }

  destroy() {
    this.root.remove();
  }
}
