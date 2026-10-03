/**
 * THE WAVE FIELD — the single source of truth for ocean mathematics.
 *
 * Everything that touches the water reads this file:
 *   • GPU: the ocean, the wake ribbons, hull foam and anything else floating
 *     includes `WAVE_GLSL` and binds `waveUniforms` (shared uniform objects, so
 *     one update reaches every material at once).
 *   • CPU: buoyancy, buoys, the camera, the AI and the harness call
 *     `sampleOcean()` / `oceanHeight()`.
 *
 * The model is a sum of Gerstner waves in four tiers (swell, medium, cross,
 * chop) plus a spatial amplitude envelope ("swell zones") that lets a track
 * mark out rough sections where the sea builds. The envelope is evaluated at
 * the undisplaced grid point on both sides, so the CPU and GPU agree exactly.
 *
 * Gerstner displaces horizontally, so the grid point that ends up above world
 * (x, z) is not (x, z). Both sides recover it with the same fixed-point
 * inverse: three iterations converge to < 1 cm at our steepness budget.
 */

import { Vector3 } from 'three';

export const GRAVITY = 9.81;

interface WaveDef {
  /** Direction, degrees in the XZ plane (0 = +X, 90 = +Z). */
  deg: number;
  wavelength: number;
  amplitude: number;
  steepness: number;
  speed: number;
  phase: number;
}

/**
 * Wavelength ratios are deliberately non-harmonic (≈1.5–1.9) and directions
 * are spread over >200° so the sum never resolves into a visible lattice.
 */
const BASE_WAVES: WaveDef[] = [
  // Long rolling swells — the ones you ride and launch off.
  { deg: 12, wavelength: 78, amplitude: 1.25, steepness: 0.9, speed: 1.0, phase: 0.0 },
  { deg: 61, wavelength: 49, amplitude: 0.78, steepness: 0.85, speed: 0.96, phase: 1.9 },
  // Medium waves.
  { deg: -31, wavelength: 27.5, amplitude: 0.3, steepness: 0.8, speed: 1.03, phase: 3.3 },
  { deg: 104, wavelength: 17.1, amplitude: 0.17, steepness: 0.72, speed: 1.08, phase: 0.7 },
  // Directional cross waves.
  { deg: -78, wavelength: 10.3, amplitude: 0.1, steepness: 0.62, speed: 1.12, phase: 4.6 },
  { deg: 153, wavelength: 6.7, amplitude: 0.085, steepness: 0.55, speed: 1.18, phase: 2.4 },
  // High-frequency chop.
  { deg: 37, wavelength: 3.9, amplitude: 0.045, steepness: 0.45, speed: 1.24, phase: 5.2 },
  { deg: -121, wavelength: 2.45, amplitude: 0.028, steepness: 0.4, speed: 1.3, phase: 1.1 },
];

export const WAVE_COUNT = BASE_WAVES.length;
export const ZONE_COUNT = 4;

interface Compiled {
  dx: number;
  dz: number;
  k: number;
  a: number;
  qa: number;
  w: number;
  phase: number;
}

const compiled: Compiled[] = BASE_WAVES.map(() => ({ dx: 0, dz: 0, k: 0, a: 0, qa: 0, w: 0, phase: 0 }));

/** Global energy multiplier (weather). 1 = calm-ish tuned default. */
let seaState = 1;
/** Choppiness multiplier — storm makes crests sharper as well as taller. */
let chop = 1;
/** Swell zones: x, z, radius, gain. gain 0 = disabled. */
const zones = new Float32Array(ZONE_COUNT * 4);

/** Shared uniform objects. Materials reference these directly. */
export const waveUniforms = {
  uWaveA: { value: new Float32Array(WAVE_COUNT * 4) }, // dirX, dirZ, k, amp
  uWaveB: { value: new Float32Array(WAVE_COUNT * 4) }, // omega, Q*A, phase, -
  uZones: { value: zones },
  uTime: { value: 0 },
};

function compile() {
  // Normalise steepness so Σ Q·A·k (at the largest possible zone gain) stays < 0.9,
  // otherwise crests fold through themselves.
  let maxGain = 1;
  for (let i = 0; i < ZONE_COUNT; i++) maxGain = Math.max(maxGain, 1 + zones[i * 4 + 3]);
  let total = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const d = BASE_WAVES[i];
    const k = (Math.PI * 2) / d.wavelength;
    total += Math.min(1, d.steepness * chop) * d.amplitude * seaState * maxGain * k;
  }
  const norm = total > 0.88 ? 0.88 / total : 1;

  const A = waveUniforms.uWaveA.value;
  const B = waveUniforms.uWaveB.value;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const d = BASE_WAVES[i];
    const c = compiled[i];
    const r = (d.deg * Math.PI) / 180;
    c.dx = Math.cos(r);
    c.dz = Math.sin(r);
    c.k = (Math.PI * 2) / d.wavelength;
    c.a = d.amplitude * seaState;
    c.qa = Math.min(1, d.steepness * chop) * norm * c.a;
    // Deep-water dispersion: long waves travel faster, which is what makes it read as water.
    c.w = Math.sqrt(GRAVITY * c.k) * d.speed;
    c.phase = d.phase;
    A[i * 4] = c.dx;
    A[i * 4 + 1] = c.dz;
    A[i * 4 + 2] = c.k;
    A[i * 4 + 3] = c.a;
    B[i * 4] = c.w;
    B[i * 4 + 1] = c.qa;
    B[i * 4 + 2] = c.phase;
    B[i * 4 + 3] = 0;
  }
}
compile();

export function setSeaState(energy: number, choppiness = 1) {
  seaState = energy;
  chop = choppiness;
  compile();
}
export function getSeaState() {
  return seaState;
}
export function getChop() {
  return chop;
}

export interface SwellZone {
  x: number;
  z: number;
  radius: number;
  gain: number;
}

export function setSwellZones(list: readonly SwellZone[]) {
  zones.fill(0);
  for (let i = 0; i < Math.min(ZONE_COUNT, list.length); i++) {
    zones[i * 4] = list[i].x;
    zones[i * 4 + 1] = list[i].z;
    zones[i * 4 + 2] = Math.max(1, list[i].radius);
    zones[i * 4 + 3] = list[i].gain;
  }
  compile();
}

export function setWaveTime(t: number) {
  waveUniforms.uTime.value = t;
}

/** Largest possible crest height, for culling and camera clamping. */
export function maxWaveHeight() {
  let s = 0;
  let g = 1;
  for (let i = 0; i < ZONE_COUNT; i++) g = Math.max(g, 1 + zones[i * 4 + 3]);
  for (const c of compiled) s += c.a;
  return s * g;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exposes:
 *   float waveGain(vec2 p)
 *   void  oceanSurface(vec2 p, float t, float fadeDist, out vec3 pos, out vec3 nrm, out float jac)
 *   vec3  oceanAtWorld(vec2 xz, float t)   — inverse sample: displaced surface point over xz
 *
 * `fadeDist` band-limits short waves far from the camera (pass 0 to disable).
 * The CPU never fades: the omitted energy at distance is centimetres, far below
 * anything visible on a hull 100 m away.
 */
export const WAVE_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
#define ZONE_COUNT ${ZONE_COUNT}
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec4 uWaveB[WAVE_COUNT];
uniform vec4 uZones[ZONE_COUNT];
uniform float uTime;

float waveGain(vec2 p) {
  float g = 1.0;
  for (int i = 0; i < ZONE_COUNT; i++) {
    vec4 z = uZones[i];
    vec2 d = p - z.xy;
    g += z.w * exp(-dot(d, d) / (z.z * z.z));
  }
  return g;
}

void oceanSurface(vec2 p, float t, float fadeDist, out vec3 pos, out vec3 nrm, out float jac) {
  float g = waveGain(p);
  vec3 acc = vec3(0.0);
  float jxx = 0.0, jxz = 0.0, jzz = 0.0, dxy = 0.0, dzy = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float wl = 6.2831853 / A.z;
    float fade = fadeDist > 0.0 ? clamp(1.6 - fadeDist / (wl * 9.0), 0.0, 1.0) : 1.0;
    float amp = A.w * g * fade;
    float qa = B.y * g * fade;
    float th = A.z * dot(A.xy, p) - B.x * t + B.z;
    float s = sin(th), c = cos(th);
    acc.xz += qa * A.xy * c;
    acc.y += amp * s;
    float qak = qa * A.z * s;
    jxx -= qak * A.x * A.x;
    jxz -= qak * A.x * A.y;
    jzz -= qak * A.y * A.y;
    float akc = amp * A.z * c;
    dxy += akc * A.x;
    dzy += akc * A.y;
  }
  pos = vec3(p.x + acc.x, acc.y, p.y + acc.z);
  vec3 dPdx = vec3(1.0 + jxx, dxy, jxz);
  vec3 dPdz = vec3(jxz, dzy, 1.0 + jzz);
  nrm = normalize(cross(dPdz, dPdx));
  jac = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
}

vec3 oceanDisplaceOnly(vec2 p, float t) {
  float g = waveGain(p);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float th = A.z * dot(A.xy, p) - B.x * t + B.z;
    acc.xz += B.y * g * A.xy * cos(th);
    acc.y += A.w * g * sin(th);
  }
  return acc;
}

vec3 oceanAtWorld(vec2 xz, float t) {
  vec2 g = xz;
  for (int k = 0; k < 3; k++) {
    vec3 d = oceanDisplaceOnly(g, t);
    g += xz - (g + d.xz);
  }
  vec3 d = oceanDisplaceOnly(g, t);
  return vec3(xz.x, d.y, xz.y);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// CPU — exact mirror of the GLSL above
// ─────────────────────────────────────────────────────────────────────────────

export interface OceanSample {
  height: number;
  normal: Vector3;
  jacobian: number;
  /** Vertical surface velocity at this point (m/s), analytic. */
  vy: number;
}

export function makeSample(): OceanSample {
  return { height: 0, normal: new Vector3(0, 1, 0), jacobian: 1, vy: 0 };
}

export function waveGain(px: number, pz: number) {
  let g = 1;
  for (let i = 0; i < ZONE_COUNT; i++) {
    const gain = zones[i * 4 + 3];
    if (gain === 0) continue;
    const dx = px - zones[i * 4];
    const dz = pz - zones[i * 4 + 1];
    const r = zones[i * 4 + 2];
    g += gain * Math.exp(-(dx * dx + dz * dz) / (r * r));
  }
  return g;
}

let _dx = 0;
let _dz = 0;
let _dy = 0;
function displace(px: number, pz: number, t: number) {
  const g = waveGain(px, pz);
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = compiled[i];
    const th = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.phase;
    const c = Math.cos(th);
    ax += w.qa * g * w.dx * c;
    az += w.qa * g * w.dz * c;
    ay += w.a * g * Math.sin(th);
  }
  _dx = ax;
  _dy = ay;
  _dz = az;
}

function invert(x: number, z: number, t: number) {
  let gx = x;
  let gz = z;
  for (let k = 0; k < 3; k++) {
    displace(gx, gz, t);
    gx += x - (gx + _dx);
    gz += z - (gz + _dz);
  }
  return [gx, gz] as const;
}

/** Surface height at world (x, z). Hot path — no allocation. */
export function oceanHeight(x: number, z: number, t: number) {
  let gx = x;
  let gz = z;
  for (let k = 0; k < 3; k++) {
    displace(gx, gz, t);
    gx += x - (gx + _dx);
    gz += z - (gz + _dz);
  }
  displace(gx, gz, t);
  return _dy;
}

/** Full sample at world (x, z): height, normal, Jacobian and vertical velocity. */
export function sampleOcean(x: number, z: number, t: number, out: OceanSample): OceanSample {
  let gx = x;
  let gz = z;
  for (let k = 0; k < 3; k++) {
    displace(gx, gz, t);
    gx += x - (gx + _dx);
    gz += z - (gz + _dz);
  }
  const g = waveGain(gx, gz);
  let ay = 0;
  let vy = 0;
  let jxx = 0;
  let jxz = 0;
  let jzz = 0;
  let dxy = 0;
  let dzy = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = compiled[i];
    const amp = w.a * g;
    const qa = w.qa * g;
    const th = w.k * (w.dx * gx + w.dz * gz) - w.w * t + w.phase;
    const s = Math.sin(th);
    const c = Math.cos(th);
    ay += amp * s;
    vy -= amp * w.w * c;
    const qak = qa * w.k * s;
    jxx -= qak * w.dx * w.dx;
    jxz -= qak * w.dx * w.dz;
    jzz -= qak * w.dz * w.dz;
    const akc = amp * w.k * c;
    dxy += akc * w.dx;
    dzy += akc * w.dz;
  }
  // n = normalize(cross(dPdz, dPdx)) with dPdx=(1+jxx, dxy, jxz), dPdz=(jxz, dzy, 1+jzz)
  const ax = 1 + jxx;
  const az = 1 + jzz;
  const nx = dzy * jxz - az * dxy;
  const ny = az * ax - jxz * jxz;
  const nz = jxz * dxy - dzy * ax;
  out.normal.set(nx, ny, nz).normalize();
  out.height = ay;
  out.vy = vy;
  out.jacobian = ax * az - jxz * jxz;
  return out;
}

/** Exposed for the harness so CPU/GPU agreement can be checked numerically. */
export const _debugInvert = invert;
