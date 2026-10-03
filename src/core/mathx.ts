/** Small, allocation-free math helpers shared by every subsystem. */

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const remap01 = (a: number, b: number, v: number) => clamp01(invLerp(a, b, v));
export const sign = (v: number) => (v < 0 ? -1 : 1);

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. `rate` is in 1/seconds. */
export function damp(current: number, target: number, rate: number, dt: number) {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference b - a. */
export const angleDelta = (a: number, b: number) => wrapAngle(b - a);

export function dampAngle(current: number, target: number, rate: number, dt: number) {
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}

/** Integer hash → [0,1). Deterministic, used for per-instance variation. */
export function hash01(n: number) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 1D smooth value noise in [-1,1], deterministic. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i * 7919 + seed * 104729) * 2 - 1;
  const b = hash01((i + 1) * 7919 + seed * 104729) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function formatTime(t: number, showMs = true) {
  if (!isFinite(t) || t < 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = Math.floor(s);
  const ms = Math.floor((s - ss) * 1000);
  return showMs
    ? `${m}:${ss.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
    : `${m}:${ss.toString().padStart(2, '0')}`;
}

export function ordinal(n: number) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
