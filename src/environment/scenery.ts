/**
 * Builds and animates the visual world from a Layout: islands (merged), every
 * repeated prop (instanced, with outlines), skyline, set pieces, ambient life
 * (birds, distant boats, lighthouse beams) and glow sprites for lamps.
 *
 * Exposes `waterLights` (for ocean reflections) and `emitters` (for the
 * particle system: steam vents, volcano smoke, waterfall mist).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  BoxGeometry,
} from 'three';
import type { Layout, Prop, PropKind } from './layout';
import { THEME_STYLE, type ThemeStyle } from './weatherDefs';
import * as P from './props';
import { LOD, LodClock, LodInstances } from '../render/lod';
import { addOutline, cel } from '../render/cel';
import { GeoBuilder } from '../render/geo';
import { Rng } from '../core/rng';
import { oceanHeight } from '../water/waves';
import type { Track } from '../race/track';

export interface WaterLight {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
}

export interface Emitter {
  kind: 'steam' | 'smoke' | 'mist' | 'embers';
  x: number;
  y: number;
  z: number;
  rate: number;
  radius: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

const towerVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const towerFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uBase;
uniform vec3 uTop;
uniform vec3 uNeon;
uniform vec3 uNeon2;
uniform float uNight;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 col = mix(uBase, uTop, clamp(vW.y / 160.0, 0.0, 1.0));
  float side = abs(vN.y) < 0.5 ? 1.0 : 0.0;
  // Light from above for a little form.
  col *= 0.75 + 0.25 * clamp(dot(vN, normalize(vec3(0.4, 1.0, 0.3))), 0.0, 1.0);
  vec2 g = vec2(abs(vN.x) > 0.5 ? vW.z : vW.x, vW.y);
  vec2 cell = floor(g / vec2(3.2, 3.6));
  vec2 f = fract(g / vec2(3.2, 3.6));
  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
  float lit = step(0.45, h21(cell + vSeed));
  vec3 wc = mix(vec3(1.0, 0.82, 0.5), vec3(0.6, 0.95, 1.0), h21(cell * 1.7 + vSeed));
  col += wc * win * lit * side * (0.08 + 0.9 * uNight);
  // Neon bands on some towers.
  float roof = step(0.5, fract(vSeed * 3.1)) * side * smoothstep(0.92, 1.0, fract(vW.y / 40.0 + vSeed));
  col += mix(uNeon, uNeon2, step(0.5, fract(vSeed * 7.3))) * roof * (0.4 + 1.6 * uNight) * (0.8 + 0.2 * sin(uTime * 3.0 + vSeed));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const glowVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uScale;
uniform float uTime;
varying vec3 vC;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = aPhase < 0.0 ? 1.0 : 0.55 + 0.45 * step(0.0, sin(uTime * 2.6 + aPhase));
  vA = blink;
  vC = aColor;
  gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 90.0);
}
`;
const glowFrag = /* glsl */ `
uniform float uIntensity;
varying vec3 vC;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, r));
  a = a * a + (1.0 - smoothstep(0.0, 0.25, r)) * 0.8;
  gl_FragColor = vec4(vC * a * vA * uIntensity, 1.0);
}
`;

const fallVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fallFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float s = sin(vUv.x * 40.0 + sin(vUv.x * 7.0) * 2.0) * 0.5 + 0.5;
  float flow = fract(vUv.y * 6.0 - uTime * 1.6 + s * 0.3);
  float streak = smoothstep(0.6, 1.0, flow) * (0.6 + 0.4 * s);
  vec3 col = mix(vec3(0.55, 0.85, 0.95), vec3(1.0), streak);
  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  gl_FragColor = vec4(col, (0.75 + 0.25 * streak) * edge);
  #include <colorspace_fragment>
}
`;

interface Mover {
  obj: Object3D;
  cx: number;
  cz: number;
  r: number;
  speed: number;
  phase: number;
}

/** Props inside this distance get full geometry and ink (metres, × LOD.scale). */
const PROP_NEAR = 150;

export class Scenery {
  private lods: { lod: LodInstances; xs: Float32Array; zs: Float32Array }[] = [];
  private lodClock = new LodClock(14, 0.6);
  readonly group = new Group();
  readonly waterLights: WaterLight[] = [];
  readonly emitters: Emitter[] = [];
  readonly style: ThemeStyle;
  private beams: Mesh[] = [];
  private birds: InstancedMesh | null = null;
  private birdState: { cx: number; cz: number; r: number; h: number; sp: number; ph: number }[] = [];
  private movers: Mover[] = [];
  private mines: { mesh: InstancedMesh; list: Prop[] } | null = null;
  private towerMat: ShaderMaterial | null = null;
  private fallMat: ShaderMaterial | null = null;
  private glow: Points | null = null;
  private glowMat: ShaderMaterial | null = null;
  private disposables: { dispose(): void }[] = [];
  private islandH: { x: number; z: number; r: number; rot: number; h: (lx: number, lz: number) => number }[] = [];

  /** Exact island ground height at a world point (0 over open water). */
  ground(x: number, z: number) {
    for (const is of this.islandH) {
      const dx = x - is.x;
      const dz = z - is.z;
      if (dx * dx + dz * dz > is.r * is.r) continue;
      // Undo the island's rotateY(rot).
      const c = Math.cos(is.rot);
      const s = Math.sin(is.rot);
      return Math.max(0, is.h(dx * c - dz * s, dx * s + dz * c));
    }
    return 0;
  }

  constructor(
    readonly layout: Layout,
    track: Track,
    quality: 'low' | 'medium' | 'high',
  ) {
    const theme = layout.theme;
    const style = (this.style = THEME_STYLE[theme]);
    const rng = new Rng(track.def.seed + 5);
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const glowPts: { x: number; y: number; z: number; c: number; s: number; blink: boolean }[] = [];

    // ── Islands: one merged mesh ─────────────────────────────────────────────
    const isl = layout.props.filter((p) => p.kind === 'island');
    this.islandH = [];
    if (isl.length) {
      const geos = isl.map((p, i) => {
        const m = P.islandGeometry(p.size, style, theme, track.def.seed + i * 13, p.variant);
        const g = m.geo;
        g.rotateY(p.rot);
        g.translate(p.x, 0, p.z);
        this.islandH.push({ x: p.x, z: p.z, r: p.size * 1.2, rot: p.rot, h: m.heightAt });
        return g;
      });
      const merged = mergeColored(geos);
      const m = new Mesh(merged, cel('island', { vertexColors: true, rim: 0.3 }));
      m.name = 'islands';
      addOutline(m, 1.6);
      this.add(m, merged);
    }

    // ── Instanced props ──────────────────────────────────────────────────────
    const byKind = new Map<string, Prop[]>();
    for (const p of layout.props) {
      if (p.kind === 'island' || p.kind === 'bridge' || p.kind === 'volcano' || p.kind === 'waterfall' || p.kind === 'vent' || p.kind === 'ruin' || p.kind === 'barrier') continue;
      const variants = VARIANTS[p.kind] ?? 1;
      const key = `${p.kind}:${p.variant % variants}`;
      if (!byKind.has(key)) byKind.set(key, []);
      byKind.get(key)!.push(p);
    }
    for (const [key, list] of byKind) {
      const [kind, vs] = key.split(':') as [PropKind, string];
      const v = Number(vs);
      if (kind === 'palm') {
        const { trunk, fronds } = P.palmGeometry(v);
        const low = P.palmGeometry(v, true);
        this.instance(trunk, cel('palmTrunk', { vertexColors: true, wind: 0.0015 }), list, (p) => [p.x, this.ground(p.x, p.z) - 0.3, p.z, p.rot, p.scale], 1.4, low.trunk);
        // Fronds are thin closed shells with hand-made outline normals, so they take clean ink.
        this.instance(fronds, cel('palmFronds', { vertexColors: true, wind: 0.0015, rim: 0.6 }), list, (p) => [p.x, this.ground(p.x, p.z) - 0.3, p.z, p.rot, p.scale], 1.3, low.fronds);
        continue;
      }
      if (kind === 'mine') {
        const im = this.instanceRaw(P.mineGeometry(), cel('mine', { vertexColors: true, gloss: 0.8 }), list, (p) => [p.x, 0, p.z, p.rot, 1.3], 1.6);
        this.mines = { mesh: im, list };
        for (const p of list) glowPts.push({ x: p.x, y: 1.5, z: p.z, c: 0xff2a2a, s: 30, blink: true });
        continue;
      }
      const geo = buildProp(kind, v, style);
      if (!geo) continue;
      const scaleOf = (p: Prop) => {
        switch (kind) {
          case 'rock':
          case 'lavarock':
          case 'iceberg':
          case 'floe':
            return p.size;
          case 'seastack':
            return p.size * 0.9;
          case 'tower':
            return 1;
          default:
            return p.scale;
        }
      };
      if (kind === 'tower') {
        this.buildTowers(list, style);
        continue;
      }
      const mat = cel(`prop_${kind}`, { vertexColors: true, gloss: kind === 'container' || kind === 'crane' ? 0.4 : 0 });
      const yOf = (p: Prop) => {
        switch (kind) {
          case 'rock':
          case 'lavarock':
            return -0.4;
          case 'iceberg':
            return -p.size * 0.35;
          case 'floe':
            return 0.12;
          case 'hut':
          case 'pine':
          case 'jungletree':
            return this.ground(p.x, p.z) - 0.3;
          case 'lamp':
            return p.y;
          default:
            return 0;
        }
      };
      const thin = kind === 'lamp' || kind === 'canalwall';
      this.instance(geo, mat, list, (p) => [p.x, yOf(p), p.z, p.rot, scaleOf(p)], kind === 'rock' ? 1.8 : thin ? 1.2 : 1.6);

      // Lamps and lights that belong to props.
      for (const p of list) {
        if (kind === 'lighthouse') {
          glowPts.push({ x: p.x, y: 21 * p.scale, z: p.z, c: style.glow, s: 160, blink: false });
          this.waterLights.push({ x: p.x, y: 21, z: p.z, color: 0xfff0b0, intensity: 1.2 });
          this.addBeam(p.x, 21 * p.scale, p.z);
        }
        if (kind === 'crane') {
          glowPts.push({ x: p.x, y: 26 * p.scale, z: p.z, c: 0xff3030, s: 60, blink: true });
          glowPts.push({ x: p.x + Math.sin(p.rot) * -28, y: 25 * p.scale, z: p.z + Math.cos(p.rot) * -28, c: 0xff3030, s: 50, blink: true });
        }
        if (kind === 'quay') {
          for (let i = -1; i <= 1; i++) {
            const lx = p.x + Math.cos(p.rot) * i * 14 + Math.sin(p.rot) * 3.3;
            const lz = p.z - Math.sin(p.rot) * i * 14 + Math.cos(p.rot) * 3.3;
            glowPts.push({ x: lx, y: 9.2, z: lz, c: 0xffd27a, s: 40, blink: false });
          }
        }
        if (kind === 'dock') glowPts.push({ x: p.x + Math.sin(p.rot) * 8.5, y: 4.5, z: p.z + Math.cos(p.rot) * 8.5, c: 0xffd27a, s: 40, blink: false });
        if (kind === 'lavarock') this.emitters.push({ kind: 'embers', x: p.x, y: 0.5, z: p.z, rate: 1.5, radius: p.size });
        if (kind === 'lamp') {
          const lx = p.x + Math.sin(p.rot) * 0.7;
          const lz = p.z + Math.cos(p.rot) * 0.7;
          glowPts.push({ x: lx, y: p.y + 4.2, z: lz, c: 0xffc46a, s: 34, blink: false });
          if (this.waterLights.length < 6 && list.indexOf(p) % 7 === 0) this.waterLights.push({ x: lx, y: p.y + 4.2, z: lz, color: 0xffc46a, intensity: 0.8 });
        }
      }
    }

    // ── Set pieces ─────────────────────────────────────────────────────────
    for (const p of layout.props) {
      if (p.kind === 'bridge') this.buildBridge(p, style, glowPts);
      if (p.kind === 'volcano') {
        const g = P.volcanoGeometry(style);
        const m = new Mesh(g, cel('volcano', { vertexColors: true }));
        m.position.set(p.x, -4, p.z);
        m.scale.set(p.size * 2.2, p.size * 1.5, p.size * 2.2);
        this.add(m, g);
        glowPts.push({ x: p.x, y: p.size * 0.78, z: p.z, c: style.glow, s: 3000, blink: false });
        this.emitters.push({ kind: 'smoke', x: p.x, y: p.size * 0.8, z: p.z, rate: 6, radius: p.size * 0.25 });
        this.waterLights.push({ x: p.x, y: p.size * 0.8, z: p.z, color: style.glow, intensity: 2.0 });
      }
      if (p.kind === 'vent') this.emitters.push({ kind: 'steam', x: p.x, y: 2, z: p.z, rate: 5, radius: p.size * 0.3 });
      if (p.kind === 'waterfall') this.buildWaterfall(p);
      if (p.kind === 'ruin') {
        const g = P.ruinGeometry();
        const m = new Mesh(g, cel('ruin', { vertexColors: true }));
        m.position.set(p.x, Math.min(0, this.ground(p.x, p.z)) - 1.5, p.z);
        m.rotation.y = p.rot;
        addOutline(m, 1.6);
        this.add(m, g);
      }
      if (p.kind === 'barrier') {
        const g = P.barrierGeometry(p.variant);
        const m = new Mesh(g, cel(`barrier${p.variant}`, { vertexColors: true }));
        m.position.set(p.x, -0.6, p.z);
        // Local X spans the course; scale it to the full width, keep it a few metres tall.
        m.rotation.y = p.rot;
        m.scale.set(p.size * 1.05, p.variant === 1 ? 3.2 : 2.6, 7);
        addOutline(m, 1.6);
        this.add(m, g);
      }
    }

    // ── Distant range ───────────────────────────────────────────────────────
    if (theme !== 'neon') {
      const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 900;
      const g = P.distantRangeGeometry(cx, cz, R, style, theme, track.def.seed);
      // Unlit: distant hills read as flat pastel silhouettes, like a painted anime backdrop.
      const dm = new MeshBasicMaterial({ vertexColors: true, fog: true });
      const m = new Mesh(g, dm);
      this.disposables.push(dm);
      m.name = 'distantRange';
      this.add(m, g);
    }

    // ── Birds ──────────────────────────────────────────────────────────────
    if (theme === 'tropical' || theme === 'storm' || (theme === 'neon' && quality !== 'low')) {
      const n = quality === 'low' ? 10 : 24;
      const g = P.birdGeometry();
      const im = new InstancedMesh(g, new MeshBasicMaterial({ color: theme === 'storm' ? 0xdfe6ee : 0xffffff, side: DoubleSide, fog: true }), n);
      im.frustumCulled = false;
      for (let i = 0; i < n; i++) {
        const flock = i % 3;
        this.birdState.push({
          cx: cx + Math.cos(flock * 2.1) * 180 + rng.range(-20, 20),
          cz: cz + Math.sin(flock * 2.1) * 180 + rng.range(-20, 20),
          r: rng.range(25, 60),
          h: rng.range(22, 45),
          sp: rng.range(0.25, 0.4) * (rng.next() < 0.5 ? -1 : 1),
          ph: rng.range(0, 6.28),
        });
      }
      this.birds = im;
      this.add(im, g);
    }

    // ── Distant moving boats ───────────────────────────────────────────────
    const moverCount = theme === 'volcanic' ? 1 : 4;
    for (let i = 0; i < moverCount; i++) {
      const variant = i === 0 ? 1 : 0;
      const g = P.sailboatGeometry(variant);
      const m = new Mesh(g, cel(`sail${variant}`, { vertexColors: true }));
      addOutline(m, 1.4);
      const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + (variant ? 520 : rng.range(260, 420));
      this.movers.push({ obj: m, cx, cz, r: R, speed: (variant ? 3 : 5) / R, phase: rng.range(0, 6.28) });
      this.add(m, g);
    }

    // ── Neon / lava water lights for the ocean shader ───────────────────────
    if (theme === 'neon') {
      for (let i = 0; i < 6; i++) {
        const t = layout.props.filter((p) => p.kind === 'tower');
        const p = t[Math.floor((i / 6) * t.length)];
        if (p) this.waterLights.push({ x: p.x, y: 30, z: p.z, color: i % 2 ? style.glow : style.glow2, intensity: 1.4 });
      }
    }
    if (theme === 'volcanic') {
      for (const p of layout.props.filter((q) => q.kind === 'lavarock').slice(0, 5)) {
        this.waterLights.push({ x: p.x, y: 1.5, z: p.z, color: style.glow, intensity: 0.8 });
      }
    }

    // ── Glow sprites ───────────────────────────────────────────────────────
    const gp = glowPts.filter((g) => g.s > 0);
    if (gp.length) {
      const pos = new Float32Array(gp.length * 3);
      const col = new Float32Array(gp.length * 3);
      const size = new Float32Array(gp.length);
      const phase = new Float32Array(gp.length);
      const c = new Color();
      gp.forEach((g, i) => {
        pos.set([g.x, g.y, g.z], i * 3);
        c.setHex(g.c);
        col.set([c.r, c.g, c.b], i * 3);
        size[i] = g.s;
        phase[i] = g.blink ? i * 1.7 : -1;
      });
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new BufferAttribute(col, 3));
      geo.setAttribute('aSize', new BufferAttribute(size, 1));
      geo.setAttribute('aPhase', new BufferAttribute(phase, 1));
      this.glowMat = new ShaderMaterial({
        uniforms: { uScale: { value: 400 }, uIntensity: { value: 1 }, uTime: { value: 0 } },
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      this.glow = new Points(geo, this.glowMat);
      this.glow.frustumCulled = false;
      this.glow.renderOrder = 5;
      this.add(this.glow, geo);
      this.disposables.push(this.glowMat);
    }
  }

  private add(o: Object3D, ...d: { dispose(): void }[]) {
    this.group.add(o);
    this.disposables.push(...d);
  }

  /**
   * Static instanced props under distance LOD: full geometry + ink outline
   * near the camera, `loGeo` (or the same geometry without ink) further out.
   */
  private instance(geo: BufferGeometry, mat: import('three').Material, list: Prop[], tf: (p: Prop) => number[], outline: number, loGeo?: BufferGeometry) {
    const lod = new LodInstances(list.length, geo, mat, { name: 'props', loGeo, outline, near: PROP_NEAR });
    const xs = new Float32Array(list.length);
    const zs = new Float32Array(list.length);
    list.forEach((p, i) => {
      const [x, y, z, rot, s] = tf(p);
      _q.setFromAxisAngle(_up, rot);
      _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
      lod.setMatrixAt(i, _m);
      xs[i] = x;
      zs[i] = z;
    });
    lod.markDirty();
    this.lods.push({ lod, xs, zs });
    this.add(lod.group, geo);
    if (loGeo) this.disposables.push(loGeo);
    return lod;
  }

  /** Re-split LOD props around the camera (throttled internally). */
  updateLod(camX: number, camZ: number, dt: number) {
    if (!this.lodClock.due(camX, camZ, dt)) return;
    let hi = 0;
    let lo = 0;
    for (const l of this.lods) {
      l.lod.partition(camX, camZ, l.xs, l.zs);
      hi += l.lod.counts.hi;
      lo += l.lod.counts.lo;
    }
    LOD.hiCount = hi;
    LOD.loCount = lo;
  }
  /** Force a repartition next frame (graphics preset changed). */
  refreshLod() {
    this.lodClock.reset();
  }

  /** Plain instancing (no LOD) for props that animate per instance. */
  private instanceRaw(geo: BufferGeometry, mat: import('three').Material, list: Prop[], tf: (p: Prop) => number[], outline: number) {
    const im = new InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      const [x, y, z, rot, s] = tf(p);
      _q.setFromAxisAngle(_up, rot);
      _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'props';
    if (outline > 0) addOutline(im, outline);
    this.add(im, geo);
    return im;
  }

  private buildTowers(list: Prop[], style: ThemeStyle) {
    const g = new BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    this.towerMat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uBase: { value: new Color(0x1a1d2a) },
          uTop: { value: new Color(0x2a3045) },
          uNeon: { value: new Color(style.glow) },
          uNeon2: { value: new Color(style.glow2) },
          uNight: { value: 1 },
          uTime: { value: 0 },
        },
      ]),
      vertexShader: towerVert,
      fragmentShader: towerFrag,
      fog: true,
    });
    const im = new InstancedMesh(g, this.towerMat, list.length);
    list.forEach((p, i) => {
      _q.setFromAxisAngle(_up, -p.rot);
      const w = 18 + (p.variant % 3) * 8;
      _m.compose(_p.set(p.x, -2, p.z), _q, _s.set(w, p.size, w * 0.8));
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    this.add(im, g, this.towerMat);
  }

  private buildBridge(p: Prop, style: ThemeStyle, glow: { x: number; y: number; z: number; c: number; s: number; blink: boolean }[]) {
    if (p.variant === 2) return this.buildArchBridge(p, glow);
    const gb = new GeoBuilder();
    const span = p.size;
    const deckY = 15;
    const neon = p.variant === 0;
    const col = neon ? 0x3a3e4e : 0x6a5a4e;
    // Pylons at ±span across the course (local X), deck spanning them.
    for (const s of [-1, 1]) {
      gb.box(4, deckY + 18, 4, col, { x: s * span, y: (deckY + 18) / 2 - 3 });
      gb.box(5, 1.2, 5, neon ? style.glow2 : 0xd8cfc0, { x: s * span, y: deckY + 15.5 });
    }
    gb.box(span * 2 + 8, 2.2, 10, col, { y: deckY });
    gb.box(span * 2 + 8, 1, 0.5, neon ? style.glow : 0xd8302a, { y: deckY - 1.2, z: 5 });
    gb.box(span * 2 + 8, 1, 0.5, neon ? style.glow : 0xd8302a, { y: deckY - 1.2, z: -5 });
    for (let i = -6; i <= 6; i++) {
      const x = (i / 6) * span;
      const h = deckY + 15 - Math.abs(i / 6) * 1 - (1 - Math.pow(Math.abs(i / 6), 2)) * 12;
      gb.cyl(0.12, 0.12, Math.max(0.5, h - deckY), 0xcccccc, { x, y: (h + deckY) / 2, z: 4.5 }, 4);
      gb.cyl(0.12, 0.12, Math.max(0.5, h - deckY), 0xcccccc, { x, y: (h + deckY) / 2, z: -4.5 }, 4);
    }
    const g = gb.build();
    const m = new Mesh(g, cel('bridge', { vertexColors: true }));
    m.position.set(p.x, 0, p.z);
    m.rotation.y = p.rot;
    addOutline(m, 1.8);
    this.add(m, g);
    const cosR = Math.cos(p.rot);
    const sinR = Math.sin(p.rot);
    for (let i = -4; i <= 4; i++) {
      const lx = (i / 4) * span;
      glow.push({ x: p.x + cosR * lx, y: deckY - 1.6, z: p.z - sinR * lx, c: neon ? (i % 2 ? style.glow : style.glow2) : 0xffd27a, s: 28, blink: false });
    }
    this.waterLights.push({ x: p.x, y: deckY, z: p.z, color: neon ? style.glow2 : 0xffd27a, intensity: 1.2 });
  }

  /** Canal: a stone arch bridge with balustrades and lamps, springing from the embankments. */
  private buildArchBridge(p: Prop, glow: { x: number; y: number; z: number; c: number; s: number; blink: boolean }[]) {
    const gb = new GeoBuilder();
    const span = p.size + 1;
    const rise = 6.5;
    const stone = 0xd8cdb8;
    const N = 18;
    for (let i = 0; i < N; i++) {
      // Voussoirs around a segmental arch (local X across the canal).
      const a0 = Math.PI * (i / N);
      const a1 = Math.PI * ((i + 1) / N);
      const am = (a0 + a1) / 2;
      const x = -Math.cos(am) * span;
      const y = Math.sin(am) * rise + 0.5;
      const len = Math.hypot(Math.cos(a0) - Math.cos(a1), (Math.sin(a0) - Math.sin(a1)) * (rise / span)) * span + 0.2;
      gb.box(len, 1.1, 6, i % 2 ? stone : 0xcabfa8, { x, y, rz: Math.atan2(Math.cos(am) * rise, Math.sin(am) * span) });
    }
    // Deck and spandrel walls on top of the arch.
    gb.box(span * 2 + 6, 0.8, 6.4, 0xb8ab94, { y: rise + 1.6 });
    for (const z of [-3, 3]) {
      gb.box(span * 2 + 6, 1.1, 0.4, stone, { y: rise + 2.5, z });
      for (let i = -5; i <= 5; i++) gb.cyl(0.14, 0.18, 1.0, 0xe8e0d0, { x: (i / 5) * (span + 2), y: rise + 2.4, z: z * 0.98 }, 5);
    }
    for (const s of [-1, 1]) gb.box(5, rise + 4, 7, 0xa89a82, { x: s * (span + 3), y: (rise + 4) / 2 - 2 });
    const g = gb.build();
    const m = new Mesh(g, cel('archbridge', { vertexColors: true }));
    m.position.set(p.x, 0, p.z);
    m.rotation.y = p.rot;
    addOutline(m, 1.6);
    this.add(m, g);
    const cosR = Math.cos(p.rot);
    const sinR = Math.sin(p.rot);
    for (const s of [-1, 1]) {
      const lx = s * (span + 2);
      glow.push({ x: p.x + cosR * lx, y: rise + 4.6, z: p.z - sinR * lx, c: 0xffc46a, s: 40, blink: false });
    }
    this.waterLights.push({ x: p.x, y: rise, z: p.z, color: 0xffc46a, intensity: 1.0 });
  }

  private addBeam(x: number, y: number, z: number) {
    const g = new ConeGeometry(6, 70, 16, 6, true);
    g.rotateZ(Math.PI / 2);
    g.translate(35, 0, 0);
    // Fade along the beam: bright at the lamp, gone at the tip.
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.pow(1 - Math.min(1, pos.getX(i) / 70), 1.6);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    const m = new Mesh(
      g,
      new MeshBasicMaterial({ color: 0xfff2c0, vertexColors: true, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    m.position.set(x, y, z);
    this.beams.push(m);
    this.add(m, g, m.material as MeshBasicMaterial);
  }

  /** A cascading ribbon that follows the island's real slope from near the summit to the surf. */
  private buildWaterfall(p: Prop) {
    const r = p.size;
    const a = p.rot;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const N = 18;
    const W = 3.5;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const d = r * (0.22 + 0.9 * t);
      const cx = p.x + ca * d;
      const cz = p.z + sa * d;
      const y = Math.max(-0.4, this.ground(cx, cz)) + 0.6;
      for (const side of [-1, 1]) {
        const w = W * (0.6 + 0.6 * t) * side;
        pos.push(cx - sa * w, y, cz + ca * w);
        uv.push(side < 0 ? 0 : 1, t);
      }
      if (i < N) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    this.fallMat = new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: fallVert, fragmentShader: fallFrag, transparent: true, depthWrite: false, side: DoubleSide });
    const m = new Mesh(g, this.fallMat);
    m.renderOrder = 4;
    this.add(m, g, this.fallMat);
    this.emitters.push({ kind: 'mist', x: p.x + ca * r * 1.08, y: 0.5, z: p.z + sa * r * 1.08, rate: 10, radius: 4 });
  }

  /** Night factor drives window/lamp intensity. */
  setNight(night: number) {
    if (this.towerMat) this.towerMat.uniforms.uNight.value = night;
    if (this.glowMat) this.glowMat.uniforms.uIntensity.value = 0.25 + 0.95 * night;
    for (const b of this.beams) (b.material as MeshBasicMaterial).opacity = 0.04 + 0.14 * night;
  }

  setPixelScale(heightPx: number) {
    if (this.glowMat) this.glowMat.uniforms.uScale.value = heightPx * 0.5;
  }

  update(time: number, dt: number) {
    void dt;
    for (let i = 0; i < this.beams.length; i++) this.beams[i].rotation.y = time * 0.9 + i * 2;
    if (this.towerMat) this.towerMat.uniforms.uTime.value = time;
    if (this.fallMat) this.fallMat.uniforms.uTime.value = time;
    if (this.glowMat) this.glowMat.uniforms.uTime.value = time;
    if (this.birds) {
      const im = this.birds;
      for (let i = 0; i < this.birdState.length; i++) {
        const b = this.birdState[i];
        const a = b.ph + time * b.sp;
        const flap = Math.sin(time * 9 + i * 1.3);
        _p.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(time * 0.7 + i) * 2, b.cz + Math.sin(a) * b.r);
        _q.setFromAxisAngle(_up, -a + (b.sp > 0 ? Math.PI : 0));
        _m.compose(_p, _q, _s.set(1.1, 1 + flap * 0.6, 1.1));
        im.setMatrixAt(i, _m);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    for (const mv of this.movers) {
      const a = mv.phase + time * mv.speed;
      const x = mv.cx + Math.cos(a) * mv.r;
      const z = mv.cz + Math.sin(a) * mv.r;
      mv.obj.position.set(x, oceanHeight(x, z, time) * 0.6, z);
      mv.obj.rotation.set(Math.sin(time * 0.8 + mv.phase) * 0.04, -a, Math.sin(time * 0.6 + mv.phase) * 0.05);
    }
    if (this.mines) {
      const { mesh, list } = this.mines;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        _q.setFromAxisAngle(_up, p.rot + time * 0.2);
        _m.compose(_p.set(p.x, oceanHeight(p.x, p.z, time) + 0.2, p.z), _q, _s.set(1.3, 1.3, 1.3));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

const VARIANTS: Partial<Record<PropKind, number>> = { rock: 4, lavarock: 3, seastack: 3, palm: 3, container: 4, iceberg: 3, floe: 3, jungletree: 3, townhouse: 6 };

function buildProp(kind: PropKind, v: number, style: ThemeStyle): BufferGeometry | null {
  switch (kind) {
    case 'rock':
      return P.rockGeometry(v, style);
    case 'lavarock':
      return P.lavarockGeometry(v, style);
    case 'seastack':
      return P.seastackGeometry(v, style);
    case 'pine':
      return P.pineGeometry();
    case 'hut':
      return P.hutGeometry();
    case 'dock':
      return P.dockGeometry();
    case 'lighthouse':
      return P.lighthouseGeometry();
    case 'wreck':
      return P.wreckGeometry();
    case 'container':
      return P.containerGeometry(v);
    case 'crane':
      return P.craneGeometry();
    case 'quay':
      return P.quayGeometry();
    case 'tower':
      return new BoxGeometry(1, 1, 1);
    case 'iceberg':
      return P.icebergGeometry(v);
    case 'floe':
      return P.floeGeometry(v);
    case 'jungletree':
      return P.jungleTreeGeometry(v);
    case 'townhouse':
      return P.townhouseGeometry(v);
    case 'canalwall':
      return P.canalWallGeometry();
    case 'gondola':
      return P.gondolaGeometry();
    case 'lamp':
      return P.lampGeometry();
    default:
      return null;
  }
}

function mergeColored(geos: BufferGeometry[]) {
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += c;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
