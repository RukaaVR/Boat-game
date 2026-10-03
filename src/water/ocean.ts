/**
 * The ocean surface.
 *
 * Geometry: one radial disc re-centred (snapped) under the camera every frame.
 * Rings are spaced exponentially, so detail is where the camera is with no LOD
 * levels to pop between, and because the wave field is evaluated in absolute
 * world space, moving the disc never moves the water.
 *
 * Displacement: `WAVE_GLSL` from waves.ts — the same field the boats float on.
 *
 * Shading (stylized, not photoreal): deep→mid colour by height and facing,
 * subsurface glow through crests toward the sun, shallows and surf around
 * islands from a generated distance map, Jacobian whitecaps broken up by a
 * cellular foam texture, sky reflection by Fresnel, hard-edged sun glints,
 * up to eight coloured light reflections (neon / lighthouses / lava) and fog
 * that resolves to the sky's horizon colour so the seam disappears.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  type Camera,
} from 'three';
import { WAVE_GLSL, waveUniforms } from './waves';
import { foamTexture, waterNormalMap } from '../render/textures';
import type { Layout } from '../environment/layout';
import { hash01 } from '../core/mathx';

export const MAX_WATER_LIGHTS = 8;

function buildRadialGrid(rings: number, segs: number, radius: number, k: number) {
  const count = 1 + rings * segs;
  const pos = new Float32Array(count * 3);
  const denom = Math.exp(k) - 1;
  const step = (Math.PI * 2) / segs;
  let p = 3;
  for (let i = 0; i < rings; i++) {
    const f = (i + 1) / rings;
    const r = (radius * (Math.exp(k * f) - 1)) / denom;
    // Per-ring rotation kills the radial "spokes" the eye otherwise picks up.
    const off = (hash01(i * 31 + 7) - 0.5) * step;
    for (let a = 0; a < segs; a++) {
      const th = a * step + off;
      pos[p++] = Math.cos(th) * r;
      pos[p++] = 0;
      pos[p++] = Math.sin(th) * r;
    }
  }
  const tris = segs + (rings - 1) * segs * 2;
  const idx = new Uint32Array(tris * 3);
  let n = 0;
  for (let a = 0; a < segs; a++) {
    idx[n++] = 0;
    idx[n++] = 1 + ((a + 1) % segs);
    idx[n++] = 1 + a;
  }
  for (let i = 0; i < rings - 1; i++) {
    const b0 = 1 + i * segs;
    const b1 = b0 + segs;
    for (let a = 0; a < segs; a++) {
      const a1 = (a + 1) % segs;
      idx[n++] = b0 + a;
      idx[n++] = b1 + a1;
      idx[n++] = b1 + a;
      idx[n++] = b0 + a;
      idx[n++] = b0 + a1;
      idx[n++] = b1 + a1;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

const vert = /* glsl */ `
${WAVE_GLSL}
varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying float vDist;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - cameraPosition.xz);
  vec3 pos; vec3 nrm; float jac;
  oceanSurface(wp.xz, uTime, dist, pos, nrm, jac);
  vWorld = pos;
  vNrm = nrm;
  vJac = jac;
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uCrest;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlint;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAmp;
uniform float uFlash;
uniform float uFoamAmount;
uniform sampler2D uNormalMap;
uniform sampler2D uFoamMap;
uniform sampler2D uShore;
uniform vec4 uShoreRect; // minX, minZ, 1/sizeX, 1/sizeZ
uniform vec4 uLightPos[${MAX_WATER_LIGHTS}]; // xyz, intensity
uniform vec3 uLightCol[${MAX_WATER_LIGHTS}];
uniform float uMicro;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying float vDist;

void main() {
  vec3 N = normalize(vNrm);
  float near = 1.0 - smoothstep(40.0, 420.0, vDist);
  vec2 uv1 = vWorld.xz * 0.043 + uTime * vec2(0.021, 0.012);
  vec2 uv2 = vWorld.xz * 0.117 + uTime * vec2(-0.016, 0.024);
  vec3 m1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
  vec3 m2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
  vec2 micro = (m1.xy * 0.6 + m2.xy * 0.4) * uMicro * (0.25 + 0.75 * near);
  N = normalize(N + vec3(micro.x, 0.0, micro.y));

  vec3 toCam = cameraPosition - vWorld;
  vec3 V = normalize(toCam);
  float ndv = max(dot(N, V), 0.0);

  // ── Body colour ───────────────────────────────────────────────────────────
  float h = clamp(vWorld.y / max(uAmp, 0.2), -1.0, 1.0);
  float facing = clamp(N.y, 0.0, 1.0);
  vec3 body = mix(uDeep, uMid, smoothstep(-0.6, 0.9, h) * 0.8 + (1.0 - facing) * 0.6);

  // Stylised banded light (cel water): three soft steps.
  float ndl = dot(N, uSunDir);
  float band = 0.82 + 0.1 * smoothstep(0.1, 0.25, ndl) + 0.08 * smoothstep(0.55, 0.7, ndl);
  body *= band;

  // Subsurface glow: light through thin crests, strongest looking toward the sun.
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  float thin = smoothstep(0.0, 0.9, h) * (1.0 - facing * 0.6);
  body += uCrest * thin * (0.35 + 0.9 * sss);

  // ── Shallows and surf around islands ──────────────────────────────────────
  vec2 suv = (vWorld.xz - uShoreRect.xy) * uShoreRect.zw;
  vec4 shore = texture2D(uShore, suv);
  float shallow = shore.r;
  float sd = shore.g * 80.0; // metres from the island edge
  body = mix(body, uShallow, shallow * 0.85);

  // ── Reflection ───────────────────────────────────────────────────────────
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.55, R.y));
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  fres = smoothstep(0.0, 0.9, fres) * 0.85;
  vec3 col = mix(body, sky, fres);

  // ── Sun glints: hard-edged, stylised ────────────────────────────────────────
  float sp = max(dot(R, uSunDir), 0.0);
  float glint = smoothstep(0.985, 0.992, sp) * 1.4 + pow(sp, 300.0) * 2.0;
  col += uSunColor * glint * uSunGlint * (0.4 + 0.6 * near);

  // ── Coloured light reflections (neon, lighthouses, lava) ──────────────────
  for (int i = 0; i < ${MAX_WATER_LIGHTS}; i++) {
    vec4 L = uLightPos[i];
    if (L.w <= 0.0) continue;
    vec3 Ld = L.xyz - vWorld;
    float d = length(Ld);
    float rs = max(dot(R, Ld / d), 0.0);
    // Stretch vertically by weighting the horizontal mismatch more: reads as a streak.
    float streak = pow(rs, 90.0) * 2.4 + pow(rs, 12.0) * 0.12;
    col += uLightCol[i] * streak * L.w * (220.0 / (d + 220.0));
  }

  // ── Foam ────────────────────────────────────────────────────────────────
  vec4 fm = texture2D(uFoamMap, vWorld.xz * 0.17 + vec2(uTime * 0.01, 0.0));
  vec4 fm2 = texture2D(uFoamMap, vWorld.xz * 0.031 - vec2(0.0, uTime * 0.008));
  float cap = smoothstep(0.9, 0.5, vJac) * uFoamAmount;
  // Soft noise sets where foam survives; the fine bubble web only adds texture inside it.
  float capMask = cap * smoothstep(0.42, 0.7, fm2.g + cap * 0.35) * (0.55 + 0.45 * fm.r);
  // Surf lines rolling toward each shore.
  float surf = 0.0;
  if (sd < 28.0) {
    float wave = fract(sd / 9.0 + uTime * 0.18);
    surf = smoothstep(0.82, 0.92, wave) * (1.0 - sd / 28.0);
    surf += (1.0 - smoothstep(0.0, 3.5, sd)) * 0.9;
    surf *= smoothstep(0.2, 0.55, fm2.g + 0.25);
  }
  float foam = clamp(capMask + surf, 0.0, 1.0);
  col = mix(col, uFoam * (0.85 + 0.15 * band), foam * 0.92);

  // Lightning.
  col += vec3(0.55, 0.62, 0.8) * uFlash * (0.3 + 0.7 * fres);

  // ── Fog: resolves to the sky horizon so the seam vanishes ───────────────
  float fd = uFogDensity * vDist;
  float fog = 1.0 - exp(-fd * fd);
  float sunward = pow(max(dot(normalize(-toCam), uSunDir), 0.0), 6.0);
  vec3 fogCol = uFogColor + uSunColor * sunward * 0.25;
  col = mix(col, fogCol, fog);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Ocean {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private shoreTex: DataTexture | null = null;

  constructor(quality: 'low' | 'medium' | 'high') {
    const [rings, segs] = quality === 'high' ? [240, 300] : quality === 'medium' ? [190, 240] : [140, 176];
    const geo = buildRadialGrid(rings, segs, 3200, 5.6);
    const lp: Vector4[] = [];
    const lc: Color[] = [];
    for (let i = 0; i < MAX_WATER_LIGHTS; i++) {
      lp.push(new Vector4(0, 0, 0, 0));
      lc.push(new Color(0));
    }
    // 1×1 neutral shore map until a layout arrives.
    const blank = new DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    blank.needsUpdate = true;
    this.material = new ShaderMaterial({
      uniforms: {
        ...waveUniforms,
        uDeep: { value: new Color() },
        uMid: { value: new Color() },
        uShallow: { value: new Color() },
        uFoam: { value: new Color() },
        uCrest: { value: new Color() },
        uSkyTop: { value: new Color() },
        uSkyHorizon: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uSunGlint: { value: 1 },
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0.001 },
        uAmp: { value: 2 },
        uFlash: { value: 0 },
        uFoamAmount: { value: 1 },
        uMicro: { value: 0.35 },
        uNormalMap: { value: waterNormalMap() },
        uFoamMap: { value: foamTexture() },
        uShore: { value: blank },
        uShoreRect: { value: new Vector4(0, 0, 1, 1) },
        uLightPos: { value: lp },
        uLightCol: { value: lc },
      },
      vertexShader: vert,
      fragmentShader: frag,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = -1;
  }

  /** Bake a shallow-water / shoreline distance map from the island layout. */
  setShore(layout: Layout) {
    const N = 256;
    const ex = layout.extent;
    const sx = ex.maxX - ex.minX;
    const sz = ex.maxZ - ex.minZ;
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = ex.minX + ((i + 0.5) / N) * sx;
        const z = ex.minZ + ((j + 0.5) / N) * sz;
        let d = 1e9;
        for (const is of layout.islands) d = Math.min(d, Math.hypot(x - is.x, z - is.z) - is.r);
        const k = (j * N + i) * 4;
        data[k] = Math.max(0, Math.min(255, (1 - d / 55) * 255)) * (d < 55 ? 1 : 0);
        data[k + 1] = Math.max(0, Math.min(255, (d / 80) * 255));
        data[k + 2] = 0;
        data[k + 3] = 255;
      }
    this.shoreTex?.dispose();
    const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.needsUpdate = true;
    this.shoreTex = t;
    const u = this.material.uniforms;
    u.uShore.value = t;
    (u.uShoreRect.value as Vector4).set(ex.minX, ex.minZ, 1 / sx, 1 / sz);
  }

  update(camera: Camera) {
    const snap = 2;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shoreTex?.dispose();
  }
}

