/**
 * Procedural textures. Every image in the game is painted here with canvas 2D
 * or computed into a DataTexture — no image files exist in the project.
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import { Rng } from '../core/rng';
import type { Livery } from '../boat/livery';

const cache = new Map<string, Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

/** 4-step toon ramp. NearestFilter is what makes the bands hard. */
export function toonRamp(): Texture {
  const key = 'ramp';
  if (cache.has(key)) return cache.get(key)!;
  const data = new Uint8Array([90, 150, 210, 255]);
  const t = new DataTexture(data, 4, 1, RedFormat, UnsignedByteType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Tileable value-noise height field → RGBA normal map (for water micro ripples). */
export function waterNormalMap(): Texture {
  const key = 'wnormal';
  if (cache.has(key)) return cache.get(key)!;
  const N = 256;
  const h = new Float32Array(N * N);
  const rng = new Rng(77);
  // Sum of periodic sines in random directions = seamless, organic ripples.
  const comps: [number, number, number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const fx = Math.round(rng.range(-9, 9));
    const fy = Math.round(rng.range(-9, 9));
    if (fx === 0 && fy === 0) continue;
    const amp = 1 / Math.pow(Math.hypot(fx, fy), 1.2);
    comps.push([fx, fy, amp, rng.range(0, 6.28)]);
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [fx, fy, a, p] of comps) {
        const th = ((fx * x + fy * y) / N) * Math.PI * 2 + p;
        // Sharpened crests (1 - |sin|) read as capillary ripples.
        v += a * (1 - Math.abs(Math.sin(th))) ;
      }
      h[y * N + x] = v;
    }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x - 1 + N) % N)];
      const r = h[y * N + ((x + 1) % N)];
      const d = h[((y - 1 + N) % N) * N + x];
      const u = h[((y + 1) % N) * N + x];
      let nx = (l - r) * 1.6;
      let ny = (d - u) * 1.6;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * N + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Tileable cellular foam pattern (R) + soft noise (G). */
export function foamTexture(): Texture {
  const key = 'foam';
  if (cache.has(key)) return cache.get(key)!;
  const N = 256;
  const rng = new Rng(4242);
  const pts: [number, number][] = [];
  for (let i = 0; i < 70; i++) pts.push([rng.next() * N, rng.next() * N]);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        if (dx > N / 2) dx = N - dx;
        if (dy > N / 2) dy = N - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
      // Distance to the cell border: bright webbing between bubbles.
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const web = Math.max(0, 1 - edge / 9);
      const i = (y * N + x) * 4;
      data[i] = web * 255;
      data[i + 1] = (Math.sin(x * 0.11) * Math.sin(y * 0.13) * 0.5 + 0.5) * 255;
      data[i + 2] = Math.min(255, Math.sqrt(d1) * 6);
      data[i + 3] = 255;
    }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Soft round sprite with a hard-ish core, used by all particles. */
export function particleSprite(): Texture {
  const key = 'sprite';
  if (cache.has(key)) return cache.get(key)!;
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  cache.set(key, t);
  return t;
}

/** Lit-window facade for skyline towers. */
export function windowTexture(): Texture {
  const key = 'windows';
  if (cache.has(key)) return cache.get(key)!;
  const { c, ctx } = canvas(128, 256);
  const rng = new Rng(9);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 256);
  const cols = ['#ffd27a', '#7ff6ff', '#ff7ad9', '#ffffff', '#ffe9b0'];
  for (let y = 4; y < 256; y += 10)
    for (let x = 4; x < 128; x += 9) {
      if (rng.next() < 0.42) continue;
      ctx.fillStyle = rng.pick(cols);
      ctx.globalAlpha = rng.range(0.4, 1);
      ctx.fillRect(x, y, 5, 6);
    }
  ctx.globalAlpha = 1;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = NearestFilter;
  cache.set(key, t);
  return t;
}

/** Arrow chevrons for course signs and boost pads. */
export function chevronTexture(fg: string, bg: string, key: string): Texture {
  if (cache.has(key)) return cache.get(key)!;
  const { c, ctx } = canvas(256, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = fg;
  for (let i = 0; i < 3; i++) {
    const x = 30 + i * 70;
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x + 46, 64);
    ctx.lineTo(x, 112);
    ctx.lineTo(x + 22, 112);
    ctx.lineTo(x + 68, 64);
    ctx.lineTo(x + 22, 16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = RepeatWrapping;
  cache.set(key, t);
  return t;
}

/** Checkered start/finish banner with lettering. */
export function bannerTexture(text: string, accent: string, key: string): Texture {
  if (cache.has(key)) return cache.get(key)!;
  const { c, ctx } = canvas(1024, 128);
  ctx.fillStyle = '#111522';
  ctx.fillRect(0, 0, 1024, 128);
  const sq = 16;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 1024 / sq; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#111522';
      ctx.fillRect(x * sq, y * sq, sq, sq);
      ctx.fillRect(x * sq, 128 - (2 - y) * sq, sq, sq);
    }
  ctx.fillStyle = accent;
  ctx.font = 'italic 900 64px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 66);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** Rain-on-lens droplet normal-ish map used by the post pass. */
export function dropletTexture(): Texture {
  const key = 'droplets';
  if (cache.has(key)) return cache.get(key)!;
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = 'rgb(128,128,0)';
  ctx.fillRect(0, 0, 512, 512);
  const rng = new Rng(31);
  for (let i = 0; i < 140; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const r = rng.range(3, 16);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    // R,G encode refraction offset direction; B encodes droplet mask.
    g.addColorStop(0, 'rgb(90,90,255)');
    g.addColorStop(0.7, 'rgb(160,160,200)');
    g.addColorStop(1, 'rgba(128,128,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.9, 1.3), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  cache.set(key, t);
  return t;
}

/**
 * The hull livery: a 1024×512 sheet mapped around the hull (u along the length
 * stern→bow, v from keel on one side, over the deck, to the keel on the other).
 */
export function paintLivery(l: Livery, target?: CanvasTexture): CanvasTexture {
  const W = 1024;
  const H = 512;
  const cv = (target?.image as HTMLCanvasElement | undefined) ?? canvas(W, H).c;
  const ctx = cv.getContext('2d')!;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = l.hull;
  ctx.fillRect(0, 0, W, H);
  // Darker underbody below the chine on both sides (v 0..0.18 and 0.82..1).
  ctx.fillStyle = shade(l.hull, -0.45);
  ctx.fillRect(0, 0, W, H * 0.17);
  ctx.fillRect(0, H * 0.83, W, H * 0.17);
  // Boot stripe at the chine.
  ctx.fillStyle = l.accent;
  ctx.fillRect(0, H * 0.17, W, H * 0.025);
  ctx.fillRect(0, H * 0.805, W, H * 0.025);

  ctx.fillStyle = l.accent;
  ctx.strokeStyle = l.accent;
  const side = (fn: (y0: number, h: number, flip: boolean) => void) => {
    // v runs keel → port side → deck → starboard side → keel. Viewed from
    // outside, the port band appears rotated 180°, so it is drawn flipped.
    fn(H * 0.2, H * 0.25, true); // port band
    fn(H * 0.55, H * 0.25, false); // starboard band
  };
  switch (l.stripe) {
    case 'single':
      ctx.fillRect(0, H * 0.47, W, H * 0.06);
      break;
    case 'twin':
      ctx.fillRect(0, H * 0.43, W, H * 0.04);
      ctx.fillRect(0, H * 0.53, W, H * 0.04);
      break;
    case 'racing':
      ctx.fillRect(0, H * 0.44, W, H * 0.12);
      ctx.fillStyle = l.hull;
      ctx.fillRect(0, H * 0.485, W, H * 0.03);
      ctx.fillStyle = l.accent;
      side((y, h) => ctx.fillRect(W * 0.1, y + h * 0.45, W * 0.8, h * 0.1));
      break;
    case 'chevron':
      for (let i = 0; i < 6; i++) {
        const x = W * 0.15 + i * 120;
        ctx.beginPath();
        ctx.moveTo(x, H * 0.2);
        ctx.lineTo(x + 70, H * 0.5);
        ctx.lineTo(x, H * 0.8);
        ctx.lineTo(x + 34, H * 0.8);
        ctx.lineTo(x + 104, H * 0.5);
        ctx.lineTo(x + 34, H * 0.2);
        ctx.fill();
      }
      break;
    case 'flame':
      side((y, h, flip) => {
        for (let i = 0; i < 7; i++) {
          ctx.beginPath();
          const yy = y + h * (0.15 + i * 0.1);
          ctx.moveTo(W * 0.98, yy);
          ctx.quadraticCurveTo(W * (0.55 - i * 0.03), yy + (flip ? -1 : 1) * h * 0.1, W * (0.3 + (i % 3) * 0.08), yy + h * 0.04);
          ctx.quadraticCurveTo(W * 0.6, yy + h * 0.12, W * 0.98, yy + h * 0.1);
          ctx.fill();
        }
      });
      break;
    case 'split':
      ctx.fillRect(W * 0.55, 0, W * 0.45, H);
      ctx.fillStyle = l.hull;
      ctx.fillRect(W * 0.55, H * 0.47, W * 0.45, H * 0.06);
      break;
    case 'digital': {
      const rng = new Rng(l.number * 13 + 5);
      for (let i = 0; i < 260; i++) {
        const x = Math.floor(rng.next() * 64) * 16;
        const y = H * 0.2 + Math.floor(rng.next() * 18) * 16;
        if (rng.next() < x / W) {
          ctx.globalAlpha = rng.range(0.5, 1);
          ctx.fillRect(x, y, 16, 16);
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
  }

  // Decal near the bow on both sides.
  side((y, h, flip) => drawDecal(ctx, l.decal, W * 0.72, y + h * 0.5, h * 0.36, l.accent, l.hull, flip));
  // Race number on both sides and on the deck.
  side((y, h, flip) => drawNumber(ctx, l.number, W * 0.38, y + h * 0.5, h * 0.42, l.accent, l.hull, flip));
  ctx.restore();

  if (target) {
    target.needsUpdate = true;
    return target;
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}

function drawNumber(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, r: number, fg: string, bg: string, flip: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, -1);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.25, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = fg === '#ffffff' ? bg : fg;
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = `italic 900 ${Math.round(r * 1.3)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 0, r * 0.06);
  ctx.restore();
}

function drawDecal(ctx: CanvasRenderingContext2D, kind: Livery['decal'], x: number, y: number, r: number, fg: string, bg: string, flip: boolean) {
  if (kind === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, -1);
  ctx.fillStyle = fg;
  ctx.strokeStyle = shade(bg, -0.6);
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  switch (kind) {
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.45 : r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      break;
    case 'bolt':
      ctx.moveTo(-r * 0.3, -r);
      ctx.lineTo(r * 0.5, -r);
      ctx.lineTo(0, -r * 0.1);
      ctx.lineTo(r * 0.55, -r * 0.1);
      ctx.lineTo(-r * 0.45, r);
      ctx.lineTo(-r * 0.05, r * 0.1);
      ctx.lineTo(-r * 0.6, r * 0.1);
      break;
    case 'wave':
      ctx.moveTo(-r * 1.2, r * 0.5);
      ctx.bezierCurveTo(-r * 0.6, -r * 1.4, r * 0.9, -r * 1.2, r * 0.6, r * 0.1);
      ctx.bezierCurveTo(r * 0.3, -r * 0.5, -r * 0.3, -r * 0.2, -r * 0.1, r * 0.5);
      break;
    case 'skull':
      ctx.arc(0, -r * 0.15, r * 0.75, 0, Math.PI * 2);
      ctx.rect(-r * 0.4, r * 0.35, r * 0.8, r * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(-r * 0.28, -r * 0.15, r * 0.2, 0, Math.PI * 2);
      ctx.arc(r * 0.28, -r * 0.15, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    case 'flame':
      ctx.moveTo(0, r);
      ctx.bezierCurveTo(-r, r * 0.6, -r * 0.6, -r * 0.2, -r * 0.2, -r);
      ctx.bezierCurveTo(-r * 0.1, -r * 0.3, r * 0.3, -r * 0.6, r * 0.35, -r * 0.2);
      ctx.bezierCurveTo(r * 0.9, r * 0.1, r * 0.7, r * 0.8, 0, r);
      break;
    case 'eye':
      ctx.ellipse(0, 0, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    case 'crown':
      ctx.moveTo(-r, r * 0.6);
      ctx.lineTo(-r, -r * 0.5);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(r, -r * 0.5);
      ctx.lineTo(r, r * 0.6);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Lighten (+) or darken (−) a hex colour. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt < 0) {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  } else {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
