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
 * Shading (toon / cel, "Wind Waker" style): one flat sea colour with a crisp
 * shadow tone on wave backs and a crisp lit tone on crests; a drifting web of
 * thin wobbly white cell lines (animated Voronoi edges, anti-aliased with
 * fwidth and faded out before they alias); flat white whitecaps and distant
 * crest squiggles with hard edges; banded lagoon shallows and stepped surf
 * lines around islands from a generated distance map; a single lighter sky
 * band at grazing angles instead of a mirror reflection; star-like sun
 * sparkles; up to eight coloured light reflections (neon / lighthouses /
 * lava) and fog that resolves to the sky's horizon colour so the seam
 * disappears.
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
uniform float uCells;
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

vec2 cellHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Distance to the nearest Voronoi cell border (two-pass, 3x3 each). The
// feature points orbit slowly, so the web of lines drifts and re-forms.
float cellEdge(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * cellHash(n + g));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  md = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = 0.5 + 0.42 * sin(t + 6.2831 * cellHash(n + g));
      vec2 r = g + o - f;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
    }
  return md;
}

void main() {
  vec3 N = normalize(vNrm);
  float near = 1.0 - smoothstep(40.0, 420.0, vDist);
  vec2 uv1 = vWorld.xz * 0.043 + uTime * vec2(0.021, 0.012);
  vec3 m1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
  // Micro ripples only perturb the glint normal; the body stays flat-coloured.
  vec3 Ng = normalize(N + vec3(m1.x, 0.0, m1.y) * uMicro * 0.6 * (0.25 + 0.75 * near));

  vec3 toCam = cameraPosition - vWorld;
  vec3 V = normalize(toCam);
  float ndv = max(dot(N, V), 0.0);

  // Low-frequency breakup shared by several layers.
  vec4 fm2 = texture2D(uFoamMap, vWorld.xz * 0.021 - vec2(0.0, uTime * 0.006));
  vec4 fm = texture2D(uFoamMap, vWorld.xz * 0.09 + vec2(uTime * 0.01, 0.0));

  // ── Toon body: one flat colour, a crisp shadow tone, a crisp lit tone ─────
  float h = clamp(vWorld.y / max(uAmp, 0.2), -1.0, 1.0);
  float ndl = dot(N, uSunDir);
  // Wave backs turned from the sun drop to the shadow tone (hard edge).
  float shade = smoothstep(0.02, 0.07, ndl + h * 0.18 + 0.1);
  vec3 body = mix(uDeep, uMid, 0.35 + 0.65 * shade);
  // Lit wave tops step up to the bright crest tone.
  float lift = smoothstep(0.5, 0.56, h + (fm2.g - 0.5) * 0.35) * shade;
  body = mix(body, uCrest, lift * 0.6);

  // ── Shallows around islands ───────────────────────────────────────────────
  vec2 suv = (vWorld.xz - uShoreRect.xy) * uShoreRect.zw;
  vec4 shore = texture2D(uShore, suv);
  float shallow = shore.r;
  float sd = shore.g * 80.0; // metres from the island edge
  // Banded rather than graded: a lagoon ring, then the open-sea colour.
  float shelf = smoothstep(0.32, 0.38, shallow) * 0.55 + smoothstep(0.68, 0.74, shallow) * 0.4;
  body = mix(body, uShallow, shelf);

  // ── Sky: one flat, lighter band toward grazing angles (no mirror) ────────
  float fres = pow(1.0 - ndv, 4.0);
  vec3 skyTint = mix(uSkyHorizon, uSkyTop, 0.25);
  vec3 col = mix(body, mix(body, skyTint, 0.5), smoothstep(0.55, 0.62, fres) * 0.6);

  // ── Cell lines: wobbly white web drifting over the surface ───────────────
  vec2 cp = vWorld.xz * 0.12;
  cp += 0.28 * vec2(sin(cp.y * 1.7 + uTime * 0.6), sin(cp.x * 1.9 - uTime * 0.5));
  cp += vec2(uTime * 0.035, uTime * 0.02);
  float edge = cellEdge(cp, uTime * 0.35);
  float px = length(fwidth(cp));
  float lw = 0.03 + px * 0.3;
  float line = 1.0 - smoothstep(lw - px * 0.6, lw + px * 0.6, edge);
  // Patchy, and gone before the web gets finer than a few pixels (no moire).
  float patchy = smoothstep(0.15, 0.4, fm2.r * 0.6 + fm2.g * 0.6);
  float cellFade = 1.0 - smoothstep(0.07, 0.2, px);
  col = mix(col, uFoam, line * patchy * cellFade * uCells * 0.9);

  // ── Sun glints: little star sparkles ─────────────────────────────────────
  vec3 R = reflect(-V, Ng);
  float sp = max(dot(R, uSunDir), 0.0);
  float glint = step(0.993, sp) * step(0.55, fm.r);
  col = mix(col, uSunColor * 1.3 + 0.2, clamp(glint * uSunGlint * (0.4 + 0.6 * near), 0.0, 1.0));

  // ── Coloured light reflections (neon, lighthouses, lava) ──────────────────
  vec3 Rl = reflect(-V, N);
  for (int i = 0; i < ${MAX_WATER_LIGHTS}; i++) {
    vec4 L = uLightPos[i];
    if (L.w <= 0.0) continue;
    vec3 Ld = L.xyz - vWorld;
    float d = length(Ld);
    float rs = max(dot(Rl, Ld / d), 0.0);
    float streak = smoothstep(0.994, 0.996, rs) * 1.2 + pow(rs, 12.0) * 0.1;
    col += uLightCol[i] * streak * L.w * (220.0 / (d + 220.0));
  }

  // ── Foam: flat white caps with crisp edges ───────────────────────────────
  float cap = smoothstep(0.92, 0.55, vJac) * uFoamAmount;
  float capMask = smoothstep(0.9, 0.94, cap * 0.7 + fm2.g * 0.4 + fm.r * 0.2);
  // Distant crests: curly white squiggles riding the swell tops.
  float far = smoothstep(70.0, 200.0, vDist);
  float curl = sin(vWorld.x * 0.11 + vWorld.z * 0.05 + fm2.g * 6.0) * 0.5 + 0.5;
  float squig = smoothstep(0.8, 0.83, h * 0.7 + curl * 0.3 + fm2.r * 0.25) * far;
  // Surf lines rolling toward each shore.
  float surf = 0.0;
  if (sd < 28.0) {
    float wave = fract(sd / 9.0 + uTime * 0.18);
    surf = step(0.9, wave) * step(sd, 14.0) * step(0.5, fm.g);
    surf += 1.0 - smoothstep(1.6, 2.0, sd + fm.r * 1.5);
    surf *= step(0.42, fm2.g + 0.25);
  }
  float foam = clamp(capMask + squig + surf, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.95);

  // Lightning.
  col += vec3(0.45, 0.52, 0.7) * uFlash * (0.15 + 0.5 * fres);

  // ── Fog: resolves to the sky horizon so the seam vanishes ───────────────
  float fd = uFogDensity * vDist;
  float fog = 1.0 - exp(-fd * fd);
  float sunward = pow(max(dot(normalize(-toCam), uSunDir), 0.0), 6.0);
  vec3 fogCol = uFogColor + uSunColor * sunward * 0.15;
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
        uCells: { value: 1 },
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

