/**
 * Player-up rotating minimap. The course outline, shortcut channels, gates and
 * finish line are prebuilt Path2Ds in world space; each frame only the canvas
 * transform changes, plus a handful of dots.
 */

import type { RaceSession } from '../race/session';

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private course: Path2D;
  private shortcuts: Path2D;
  private colors: string[];
  private size = 200;
  private dpr = 1;
  /** Visible radius in metres. */
  range = 330;

  constructor(private session: RaceSession) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
    const t = session.track;
    this.course = new Path2D();
    for (let i = 0; i <= t.n; i += 2) {
      const k = i % t.n;
      if (i === 0) this.course.moveTo(t.px[k], t.pz[k]);
      else this.course.lineTo(t.px[k], t.pz[k]);
    }
    this.course.closePath();
    this.shortcuts = new Path2D();
    for (const sc of t.shortcuts) {
      for (let i = 0; i < sc.pts.length; i += 2) {
        if (i === 0) this.shortcuts.moveTo(sc.pts[0], sc.pts[1]);
        else this.shortcuts.lineTo(sc.pts[i], sc.pts[i + 1]);
      }
    }
    this.colors = session.racers.map((r) => r.livery.hull);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = this.canvas.clientWidth || 200;
    this.size = css;
    this.canvas.width = Math.round(css * this.dpr);
    this.canvas.height = Math.round(css * this.dpr);
  }

  draw(nextGate: number) {
    const c = this.ctx;
    const s = this.session;
    const p = s.player.boat;
    const S = this.size * this.dpr;
    const R = S / 2;
    const scale = (R * 0.92) / this.range;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    // Disc background.
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.fillStyle = 'rgba(5,10,30,0.55)';
    c.fill();
    c.save();
    c.clip();
    // World → map: translate player to centre, rotate so heading points up.
    // World +Z forward with heading h; screen up is −Y.
    c.translate(R, R);
    c.scale(scale, scale);
    // Forward (sin h, cos h) → screen up, boat-right → screen right.
    c.rotate(p.heading - Math.PI);
    c.translate(-p.position.x, -p.position.z);
    const lw = 1 / scale;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = s.track.width;
    c.stroke(this.course);
    c.strokeStyle = 'rgba(38,232,255,0.9)';
    c.lineWidth = 3 * lw * this.dpr;
    c.stroke(this.course);
    if (s.track.shortcuts.length) {
      c.setLineDash([6 * lw * this.dpr, 5 * lw * this.dpr]);
      c.strokeStyle = 'rgba(255,210,30,0.9)';
      c.lineWidth = 2.5 * lw * this.dpr;
      c.stroke(this.shortcuts);
      c.setLineDash([]);
    }
    // Islands as soft blobs.
    c.fillStyle = 'rgba(120,180,120,0.35)';
    for (const is of s.layout.islands) {
      c.beginPath();
      c.arc(is.x, is.z, is.r, 0, Math.PI * 2);
      c.fill();
    }
    // Finish line + next checkpoint.
    const gates = s.track.gates;
    const half = s.track.width * 0.6;
    for (const g of gates) {
      const isNext = s.hasLaps && g.index === nextGate % gates.length;
      if (g.index !== 0 && !isNext) continue;
      const rx = -Math.cos(g.heading);
      const rz = Math.sin(g.heading);
      c.beginPath();
      c.moveTo(g.x - rx * half, g.z - rz * half);
      c.lineTo(g.x + rx * half, g.z + rz * half);
      c.strokeStyle = g.index === 0 ? '#ffffff' : '#ffd21e';
      c.lineWidth = (isNext ? 5 : 4) * lw * this.dpr;
      c.stroke();
    }
    // Rivals.
    for (let i = s.racers.length - 1; i >= 1; i--) {
      const b = s.racers[i].boat;
      c.beginPath();
      c.arc(b.position.x, b.position.z, 5.5 * lw * this.dpr, 0, Math.PI * 2);
      c.fillStyle = this.colors[i];
      c.fill();
      c.lineWidth = 1.5 * lw * this.dpr;
      c.strokeStyle = '#0a0f22';
      c.stroke();
    }
    c.restore();
    // Player arrow (always centre, pointing up).
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const r = this.size / 2;
    c.beginPath();
    c.moveTo(r, r - 9);
    c.lineTo(r + 6, r + 7);
    c.lineTo(r, r + 3);
    c.lineTo(r - 6, r + 7);
    c.closePath();
    c.fillStyle = '#ff3b5c';
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.stroke();
    // Ring.
    c.beginPath();
    c.arc(r, r, r - 2, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(38,232,255,0.6)';
    c.lineWidth = 2;
    c.stroke();
  }
}

/** Static full-course preview for track cards. */
export function drawTrackPreview(canvas: HTMLCanvasElement, px: Float32Array, pz: Float32Array, color = '#26e8ff') {
  const ctx = canvas.getContext('2d')!;
  const W = (canvas.width = canvas.clientWidth * 2 || 400);
  const H = (canvas.height = canvas.clientHeight * 2 || 240);
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (let i = 0; i < px.length; i++) {
    a = Math.min(a, px[i]);
    b = Math.max(b, px[i]);
    c = Math.min(c, pz[i]);
    d = Math.max(d, pz[i]);
  }
  const s = Math.min((W * 0.84) / (b - a), (H * 0.84) / (d - c));
  const ox = W / 2 - ((a + b) / 2) * s;
  const oy = H / 2 - ((c + d) / 2) * s;
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  for (const [w, col] of [
    [10, 'rgba(0,0,0,0.35)'],
    [5, color],
  ] as const) {
    ctx.beginPath();
    for (let i = 0; i < px.length; i += 3) {
      const x = ox + px[i] * s;
      const y = oy + pz[i] * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = w;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(ox + px[0] * s - 5, oy + pz[0] * s - 5, 10, 10);
}
