/**
 * Course furniture visuals. Everything that floats samples the shared wave
 * field (CPU for instanced props, `WAVE_GLSL` in-shader for ribbons/pads).
 */

import type { Ramp } from '../core/types';
import {
  AdditiveBlending,
  ConeGeometry,
  BoxGeometry,
  OctahedronGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  Euler,
} from 'three';
import type { RaceSession } from '../race/session';
import { THEME_STYLE } from '../environment/weatherDefs';
import { LodClock, LodInstances } from './lod';
import { addOutline, cel, makeCel } from './cel';
import { GeoBuilder } from './geo';
import { bannerTexture, chevronTexture } from './textures';
import { makeSample, oceanHeight, sampleOcean, WAVE_GLSL, waveUniforms } from '../water/waves';
import type { TrackPoint } from '../race/track';
import { rampFloat, type RampFloat } from '../water/rampFloat';

const _rampF: RampFloat = { heave: 0, tilt: 0 };

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _n = new Vector3();
const _up = new Vector3(0, 1, 0);
const _e = new Euler();
const _sample = makeSample();
const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

const padVert = /* glsl */ `
${WAVE_GLSL}
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  vec3 p = oceanAtWorld(position.xz, uTime);
  p.y += 0.12 + length(p.xz - cameraPosition.xz) * 0.006;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const padFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // Chevrons scrolling forward.
  // Centre leads, edges trail: the chevron tip points the way to go.
  float y = vUv.y * 4.0 - uTime * 2.2 + abs(vUv.x - 0.5) * 2.0;
  float chev = smoothstep(0.45, 0.55, fract(y)) * (1.0 - smoothstep(0.75, 0.85, fract(y)));
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
  float border = 1.0 - smoothstep(0.0, 0.07, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  vec3 c = uColor * (chev * 1.6 + 0.25 + border * 1.2);
  gl_FragColor = vec4(c * edge + uColor * border, 1.0);
}
`;

const lineVert = /* glsl */ `
${WAVE_GLSL}
attribute float aS;
attribute float aEdge;
varying float vS;
varying float vEdge;
varying float vDist;
void main() {
  vS = aS;
  vEdge = aEdge;
  vec3 p = oceanAtWorld(position.xz, uTime);
  vDist = length(p.xz - cameraPosition.xz);
  // Lift with distance so the overlay clears the coarser far ocean mesh.
  p.y += 0.09 + vDist * 0.006;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const lineFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
varying float vS;
varying float vEdge;
varying float vDist;
void main() {
  // Chevrons flowing along the line, with a dark rim so they read on any water.
  // Centre leads, edges trail: the chevron tip points along the race direction.
  float arrow = fract(vS / 7.0 - uTime * 0.6 + abs(vEdge) * 0.35);
  float body = smoothstep(0.02, 0.1, arrow) * (1.0 - smoothstep(0.32, 0.4, arrow));
  float rim = smoothstep(0.0, 0.04, arrow) * (1.0 - smoothstep(0.4, 0.46, arrow));
  float side = 1.0 - smoothstep(0.75, 1.0, abs(vEdge));
  float fade = (1.0 - smoothstep(70.0, 170.0, vDist)) * smoothstep(5.0, 14.0, vDist);
  float a = max(body, rim * 0.6) * side * fade * uOpacity;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.02, 0.08, 0.15), uColor, body);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const swirlVert = /* glsl */ `
${WAVE_GLSL}
attribute vec2 aLocal;
varying vec2 vL;
void main() {
  vL = aLocal;
  vec3 p = oceanAtWorld(position.xz, uTime);
  // Dish the surface toward the eye.
  p.y += 0.14 - (1.0 - smoothstep(0.0, 1.0, length(aLocal))) * 1.1;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const swirlFrag = /* glsl */ `
uniform float uTime;
varying vec2 vL;
void main() {
  float r = length(vL);
  float a = atan(vL.y, vL.x);
  // Four spiral arms winding in, turning counter-clockwise.
  float arm = sin(a * 4.0 + log(r + 0.05) * 7.0 + uTime * 3.2);
  float foam = smoothstep(0.55, 0.95, arm) * (1.0 - smoothstep(0.75, 1.0, r));
  vec3 deep = vec3(0.02, 0.18, 0.38);
  vec3 col = mix(deep, vec3(0.75, 0.95, 1.0), foam);
  col = mix(vec3(0.0, 0.05, 0.14), col, smoothstep(0.0, 0.25, r));
  float edge = 1.0 - smoothstep(0.8, 1.0, r);
  gl_FragColor = vec4(col, edge * (0.55 + 0.4 * foam));
  #include <colorspace_fragment>
}
`;

const railVert = /* glsl */ `
${WAVE_GLSL}
attribute float aS;
attribute float aH;
attribute float aSide;
varying float vS;
varying float vH;
varying float vSide;
varying float vDist;
void main() {
  vS = aS;
  vH = aH;
  vSide = aSide;
  vec3 p = oceanAtWorld(position.xz, uTime);
  vDist = length(p.xz - cameraPosition.xz);
  p.y += 0.25 + aH * 1.3;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const railFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
varying float vS;
varying float vH;
varying float vSide;
varying float vDist;
void main() {
  vec3 base = mix(uColA, uColB, vSide);
  // A bright core line with soft fringes, and light pulses racing along it.
  float core = exp(-pow((vH - 0.55) * 7.0, 2.0));
  float fringe = exp(-pow((vH - 0.55) * 2.6, 2.0)) * 0.35;
  float pulse = pow(0.5 + 0.5 * sin(vS * 0.12 - uTime * 9.0), 8.0);
  float seg = step(0.12, fract(vS / 6.0));
  float fade = 1.0 - smoothstep(260.0, 520.0, vDist);
  vec3 col = base * (core * (1.4 + pulse * 2.0) * seg + fringe) + vec3(1.0) * core * pulse * 0.6;
  gl_FragColor = vec4(col * fade, 1.0);
}
`;
const sheenVert = /* glsl */ `
${WAVE_GLSL}
attribute float aS;
attribute float aU;
attribute float aSide;
varying float vS;
varying float vU;
varying float vSide;
varying float vDist;
void main() {
  vS = aS;
  vU = aU;
  vSide = aSide;
  vec3 p = oceanAtWorld(position.xz, uTime);
  vDist = length(p.xz - cameraPosition.xz);
  p.y += 0.1 + vDist * 0.006;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const sheenFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
varying float vS;
varying float vU;
varying float vSide;
varying float vDist;
void main() {
  // Rail light reflected in the water: a glow band that shimmers with the swell.
  vec3 base = mix(uColA, uColB, vSide);
  float glow = exp(-vU * vU * 3.0);
  float shimmer = 0.55 + 0.45 * sin(vS * 0.9 + vU * 6.0 - uTime * 2.4) * sin(vS * 0.37 + uTime * 1.3);
  float fade = 1.0 - smoothstep(200.0, 420.0, vDist);
  gl_FragColor = vec4(base * glow * shimmer * 0.55 * fade, 1.0);
}
`;

export class CourseVisuals {
  readonly group = new Group();
  private buoyLod: LodInstances;
  private buoyX: Float32Array;
  private buoyZ: Float32Array;
  private buoyClock = new LodClock(10, 0.4);
  private buoyLights: InstancedMesh;
  private gateHighlight: Mesh;
  private ringMesh: InstancedMesh | null = null;
  private mineMesh: InstancedMesh | null = null;
  private bottleMesh: InstancedMesh | null = null;
  private bottleGlow: InstancedMesh | null = null;
  private padMat: ShaderMaterial | null = null;
  private lineMat: ShaderMaterial | null = null;
  private lineMesh: Mesh | null = null;
  private disposables: { dispose(): void }[] = [];
  private frame = 0;
  private swirlMat: ShaderMaterial | null = null;
  private railMats: ShaderMaterial[] = [];
  private hoopMat: MeshBasicMaterial | null = null;

  /** Colour-blind mode: a shape on top of each buoy (▲ left, ■ right, ◆ shortcut). */
  private marks: { mesh: InstancedMesh; slot: Int32Array }[] = [];
  private markOf: Int8Array;
  private markSlot: Int32Array;

  constructor(
    private session: RaceSession,
    symbols = false,
  ) {
    const track = session.track;
    const style = THEME_STYLE[track.def.theme];

    // ── Buoys ────────────────────────────────────────────────────────────────
    // Chubby cartoon buoy: a round belly, a soft cone hat and a ball on top.
    // The body takes the per-buoy colour; the white trim is a second mesh
    // sharing the same instance matrices (instance colour would tint it).
    const bb = new GeoBuilder();
    bb.sphere(0.82, 0xffffff, { y: 0.2, sy: 0.85 }, 12, 7);
    bb.cone(0.62, 1.15, 0xffffff, { y: 1.15 }, 12);
    bb.sphere(0.24, 0xffffff, { y: 1.78 }, 8, 4);
    const bgeo = bb.build();
    const tb = new GeoBuilder();
    tb.cyl(0.86, 0.86, 0.22, 0xffffff, { y: 0.32 }, 12);
    tb.cyl(0.5, 0.56, 0.2, 0xffffff, { y: 0.98 }, 12);
    tb.cyl(0.9, 0.9, 0.16, 0x2c3a5a, { y: -0.28 }, 12);
    const tgeo = tb.build();
    const buoys = session.buoys;
    // Far buoys: a low-poly silhouette with no trim and no outline.
    const lb = new GeoBuilder();
    lb.sphere(0.82, 0xffffff, { y: 0.2, sy: 0.85 }, 6, 4);
    lb.cone(0.62, 1.15, 0xffffff, { y: 1.15 }, 6);
    const lgeo = lb.build();
    this.buoyLod = new LodInstances(buoys.length, bgeo, cel('buoy', { vertexColors: true, gloss: 0.5 }), { name: 'buoys', loGeo: lgeo, outline: 1.6, colors: true, near: 95 });
    this.buoyLod.follow(tgeo, cel('buoyTrim', { vertexColors: true, gloss: 0.3 }), 'buoyTrim');
    this.buoyX = new Float32Array(buoys.length);
    this.buoyZ = new Float32Array(buoys.length);
    const col = new Color();
    const arena = track.arena;
    const neonNight = track.def.look === 'neonnight';
    const ARENA_BUOYS = [0xff3b5c, 0xffd21e, 0x26c6ff, 0x5cd24a, 0xff8a1e, 0xb36bff];
    const buoyHex = (i: number, side: number) => (arena ? ARENA_BUOYS[i % ARENA_BUOYS.length] : side === 0 ? style.buoyLeft : side === 1 ? style.buoyRight : 0xffd21e);
    for (let i = 0; i < buoys.length; i++) {
      const side = buoys[i].side;
      col.setHex(buoyHex(i, side));
      this.buoyLod.setColorAt(i, col);
      this.buoyX[i] = buoys[i].x;
      this.buoyZ[i] = buoys[i].z;
    }
    this.add(this.buoyLod.group, bgeo, tgeo, lgeo);
    // Little lamp on each buoy top (bright at night).
    const lg = new CylinderGeometry(0.16, 0.16, 0.3, 6);
    this.buoyLights = new InstancedMesh(lg, new MeshBasicMaterial({ color: 0xffffff, fog: true }), buoys.length);
    for (let i = 0; i < buoys.length; i++) {
      const side = buoys[i].side;
      col.setHex(buoyHex(i, side)).multiplyScalar(1.6);
      this.buoyLights.setColorAt(i, col);
    }
    this.buoyLights.frustumCulled = false;
    this.add(this.buoyLights, lg);
    this.markOf = new Int8Array(buoys.length).fill(-1);
    this.markSlot = new Int32Array(buoys.length);
    if (symbols) {
      const shapes = [new ConeGeometry(0.55, 0.9, 3), new BoxGeometry(0.75, 0.75, 0.75), new OctahedronGeometry(0.55)];
      const mat = new MeshBasicMaterial({ color: 0x0a0f22, fog: true });
      for (let k = 0; k < 3; k++) {
        const n = buoys.filter((b) => Math.min(2, b.side) === k).length;
        const m = new InstancedMesh(shapes[k], mat, Math.max(1, n));
        m.frustumCulled = false;
        addOutline(m, 1.4);
        this.add(m, shapes[k]);
        this.marks.push({ mesh: m, slot: new Int32Array(0) });
      }
      const counts = [0, 0, 0];
      buoys.forEach((b, i) => {
        const k = Math.min(2, b.side);
        this.markOf[i] = k;
        this.markSlot[i] = counts[k]++;
      });
      this.disposables.push(mat);
    }

    // ── Gates (merged pylons + banners) ───────────────────────────────────
    const gp = new GeoBuilder();
    const half = track.width * 0.5 + 2.5;
    const lastGate = track.gates.length - 1;
    const gateKind = (i: number) => (i === 0 ? (track.sprint ? 'start' : 'startfinish') : track.sprint && i === lastGate ? 'finish' : 'cp');
    // Arenas have no gates; the neon night course swaps checkpoint pylons for light hoops.
    const gateList = arena ? [] : neonNight ? track.gates.filter((g) => gateKind(g.index) !== 'cp') : track.gates;
    for (const g of gateList) {
      const start = gateKind(g.index) !== 'cp';
      for (const s of [-1, 1]) {
        const x = g.x - Math.cos(g.heading) * half * s;
        const z = g.z + Math.sin(g.heading) * half * s;
        // Friendly pylons: rounded, banded, with a ball cap and a float collar.
        const pyl = start ? 0xfffaf0 : 0x3a8fe0;
        const band = start ? 0xff3b5c : 0xffffff;
        gp.cyl(1.25, 1.6, 13, pyl, { x, y: 4.5, z }, 14);
        for (const by of [2.2, 5.6]) gp.cyl(1.52 - by * 0.022, 1.58 - by * 0.022, 0.9, band, { x, y: by, z }, 14);
        gp.cyl(1.95, 1.95, 0.7, start ? 0xff3b5c : style.glow2, { x, y: 11.2, z }, 14);
        gp.sphere(1.0, start ? 0xffd21e : 0xffffff, { x, y: 12.2, z }, 12, 8);
        gp.cyl(2.4, 2.6, 1.6, 0xffd21e, { x, y: -1.0, z }, 14);
        gp.torus(2.45, 0.28, 0xffffff, { x, y: -0.2, z, rx: Math.PI / 2 });
      }
    }
    if (!gp.empty) {
      const gGeo = gp.build();
      const gates = new Mesh(gGeo, cel('gates', { vertexColors: true, gloss: 0.4 }));
      gates.name = 'gates';
      addOutline(gates, 1.8);
      this.add(gates, gGeo);
    }
    for (const kind of ['startfinish', 'start', 'finish', 'cp'] as const) {
      const startOnly = kind !== 'cp';
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (const g of gateList) {
        if (gateKind(g.index) !== kind) continue;
        const base = pos.length / 3;
        const h0 = 10.2;
        const h1 = startOnly ? 13.4 : 12.4;
        for (const [a, y, u, v] of [
          [-1, h0, 0, 0],
          [1, h0, 1, 0],
          [-1, h1, 0, 1],
          [1, h1, 1, 1],
        ] as const) {
          const lx = a * half;
          pos.push(g.x - Math.cos(g.heading) * lx, y, g.z + Math.sin(g.heading) * lx);
          uv.push(u, v);
        }
        idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        // Back face with mirrored U so the lettering reads correctly from behind too.
        const back = pos.length / 3;
        for (const [a, y, u, v] of [
          [-1, h0, 1, 0],
          [1, h0, 0, 0],
          [-1, h1, 1, 1],
          [1, h1, 0, 1],
        ] as const) {
          const lx = a * half;
          pos.push(g.x - Math.cos(g.heading) * lx, y, g.z + Math.sin(g.heading) * lx);
          uv.push(u, v);
        }
        idx.push(back, back + 2, back + 1, back + 2, back + 3, back + 1);
      }
      if (!pos.length) continue;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const tex =
        kind === 'startfinish'
          ? bannerTexture('RIPTIDE  •  START / FINISH', '#ff3b5c', 'banner_start')
          : kind === 'start'
            ? bannerTexture('RIPTIDE  •  START', '#ff3b5c', 'banner_s')
            : kind === 'finish'
              ? bannerTexture('FINISH  •  FINISH', '#ffd21e', 'banner_f')
              : bannerTexture('CHECKPOINT', '#26e8ff', 'banner_cp');
      const m = new Mesh(geo, cel(`banner_${kind}`, { map: tex, emissive: 0x333333 }));
      this.add(m, geo);
    }
    // Next-checkpoint highlight arch.
    const hg = new GeoBuilder();
    hg.box(half * 2, 0.5, 0.5, 0xffffff, { y: 13.6 });
    for (const s of [-1, 1]) hg.box(0.5, 14, 0.5, 0xffffff, { x: s * half, y: 6.5 });
    const hGeo = hg.build();
    this.gateHighlight = new Mesh(hGeo, new MeshBasicMaterial({ color: 0x26e8ff, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, fog: false }));
    this.add(this.gateHighlight, hGeo);

    if (track.whirlpools.length) this.buildWhirlpools();
    if (neonNight) this.buildNeon();

    // ── Ramps ────────────────────────────────────────────────────────────────
    if (track.ramps.length) this.addRamps(track.ramps);

    // ── Boost pads ───────────────────────────────────────────────────────────
    if (track.pads.length) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const NX = 4;
      const NZ = 8;
      for (const p of track.pads) {
        const sh = Math.sin(p.heading);
        const ch = Math.cos(p.heading);
        const base = pos.length / 3;
        for (let j = 0; j <= NZ; j++)
          for (let i = 0; i <= NX; i++) {
            const al = (j / NZ - 0.5) * p.length;
            const ac = (i / NX - 0.5) * p.width;
            pos.push(p.x + sh * al + ch * ac, 0, p.z + ch * al - sh * ac);
            uv.push(i / NX, j / NZ);
          }
        for (let j = 0; j < NZ; j++)
          for (let i = 0; i < NX; i++) {
            const a = base + j * (NX + 1) + i;
            const b = a + 1;
            const c = a + NX + 1;
            const d = c + 1;
            idx.push(a, c, b, b, c, d);
          }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('aUv', new BufferAttribute(new Float32Array(uv), 2));
      geo.setIndex(idx);
      this.padMat = new ShaderMaterial({
        uniforms: { ...waveUniforms, uColor: { value: new Color(0x26e8ff) } },
        vertexShader: padVert,
        fragmentShader: padFrag,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const m = new Mesh(geo, this.padMat);
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.add(m, geo, this.padMat);
    }

    // ── Chevron signs ──────────────────────────────────────────────────────
    const signs = session.layout.signs;
    if (signs.length) {
      const posts = new GeoBuilder();
      const bpos: number[] = [];
      const buv: number[] = [];
      const bidx: number[] = [];
      for (const s of signs) {
        const ch = Math.cos(s.heading);
        const sh = Math.sin(s.heading);
        for (const o of [-2.6, 2.6]) {
          posts.cyl(0.2, 0.24, 7, 0x2c3a5a, { x: s.x + ch * o, y: 1.5, z: s.z - sh * o }, 8);
          posts.sphere(0.3, 0xffffff, { x: s.x + ch * o, y: 5.1, z: s.z - sh * o }, 8, 6);
        }
        posts.cyl(1.4, 1.6, 1.2, 0xffd21e, { x: s.x, y: -0.2, z: s.z }, 12);
        posts.torus(1.5, 0.18, 0xffffff, { x: s.x, y: 0.35, z: s.z, rx: Math.PI / 2 });
        // Board quad, facing along `heading` (toward the approaching racer).
        const base = bpos.length / 3;
        const W = 3.4;
        const yb = 2.6;
        const yt = 5.0;
        for (const [a, y, u, v] of [
          [-1, yb, 0, 0],
          [1, yb, 1, 0],
          [-1, yt, 0, 1],
          [1, yt, 1, 1],
        ] as const) {
          const lx = a * W;
          // The racer looks along heading+π, so the board's "right" is −right(heading).
          const uu = s.dir > 0 ? 1 - u : u;
          bpos.push(s.x + ch * lx + sh * 0.25, y, s.z - sh * lx + ch * 0.25);
          buv.push(uu, v);
        }
        bidx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
      const pGeo = posts.build();
      const pm = new Mesh(pGeo, cel('signPosts', { vertexColors: true }));
      addOutline(pm, 1.5);
      this.add(pm, pGeo);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(bpos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(buv), 2));
      geo.setIndex(bidx);
      geo.computeVertexNormals();
      const tex = chevronTexture('#111522', '#ffd21e', 'sign_chev');
      const bm = new Mesh(geo, cel('signBoard', { map: tex, side: DoubleSide, emissive: 0x332a00 }));
      this.add(bm, geo);
    }

    // ── Shortcut entrance signs ─────────────────────────────────────────────
    for (const sc of track.shortcuts) {
      const x = sc.pts[0];
      const z = sc.pts[1];
      track.sample(sc.s1 - 30, _tp);
      const geo = new BufferGeometry();
      const hd = Math.atan2(x - _tp.x, z - _tp.z);
      const ch = Math.cos(hd);
      const sh = Math.sin(hd);
      const cx = x + Math.sin(hd) * 4;
      const cz = z + Math.cos(hd) * 4;
      const W = 6;
      const pos = [
        [-1, 6, 0, 0],
        [1, 6, 1, 0],
        [-1, 8.4, 0, 1],
        [1, 8.4, 1, 1],
      ].flatMap(([a, y]) => [cx + ch * a * W, y, cz - sh * a * W]);
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 1, 0, 1]), 2));
      geo.setIndex([0, 1, 2, 2, 1, 3]);
      geo.computeVertexNormals();
      const m = new Mesh(geo, makeCel({ map: bannerTexture('SHORTCUT ›', '#ffd21e', 'banner_sc'), side: DoubleSide, emissive: 0x332a00 }));
      this.add(m, geo, m.material as { dispose(): void });
      const pg = new GeoBuilder();
      for (const a of [-1, 1]) pg.cyl(0.2, 0.25, 9, 0x2c3a5a, { x: cx + ch * a * W, y: 3.6, z: cz - sh * a * W }, 8);
      const pgeo = pg.build();
      const pm = new Mesh(pgeo, cel('signPosts', { vertexColors: true }));
      this.add(pm, pgeo);
    }

    // ── Stunt rings ─────────────────────────────────────────────────────────
    if (session.mode === 'stunt' || session.mode === 'freeride') {
      const tg = new TorusGeometry(1, 0.12, 8, 28);
      this.ringMesh = new InstancedMesh(tg, new MeshBasicMaterial({ color: 0xffd21e, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }), session.rings.length);
      this.ringMesh.frustumCulled = false;
      this.add(this.ringMesh, tg);
    }

    // ── Endless mines ────────────────────────────────────────────────────────
    if (session.mines.length) {
      const mg = new GeoBuilder();
      mg.sphere(1, 0x3a3456, {}, 14, 10);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        mg.cyl(0.1, 0.14, 0.55, 0x6a6488, { x: Math.cos(a) * 1.05, z: Math.sin(a) * 1.05, rz: -a + Math.PI / 2, ry: 0 }, 6);
        mg.sphere(0.14, 0xff3a3a, { x: Math.cos(a) * 1.35, z: Math.sin(a) * 1.35 }, 6, 4);
      }
      mg.cyl(0.1, 0.14, 0.6, 0x6a6488, { y: 1.05 }, 6);
      mg.sphere(0.2, 0xff2020, { y: 1.38 }, 8, 6);
      mg.sphere(0.22, 0xeae6ff, { x: -0.45, y: 0.55, z: 0.55 }, 6, 4);
      const geo = mg.build();
      this.mineMesh = new InstancedMesh(geo, cel('endlessMine', { vertexColors: true, gloss: 0.8 }), session.mines.length);
      this.mineMesh.frustumCulled = false;
      addOutline(this.mineMesh, 1.6);
      this.add(this.mineMesh, geo);
    }
    this.buildBottles();
  }

  /** Arena whirlpools: a dished, spiralling disc riding the waves. */
  private buildWhirlpools() {
    const pos: number[] = [];
    const loc: number[] = [];
    const idx: number[] = [];
    const NR = 10;
    const NA = 48;
    for (const w of this.session.track.whirlpools) {
      const base = pos.length / 3;
      for (let i = 0; i <= NR; i++)
        for (let j = 0; j <= NA; j++) {
          const r = (i / NR) * 1.15;
          const a = (j / NA) * Math.PI * 2;
          const lx = Math.cos(a) * r;
          const lz = Math.sin(a) * r;
          pos.push(w.x + lx * w.r, 0, w.z + lz * w.r);
          loc.push(lx, lz);
        }
      for (let i = 0; i < NR; i++)
        for (let j = 0; j < NA; j++) {
          const a = base + i * (NA + 1) + j;
          const b = a + NA + 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aLocal', new BufferAttribute(new Float32Array(loc), 2));
    geo.setIndex(idx);
    this.swirlMat = new ShaderMaterial({ uniforms: { ...waveUniforms }, vertexShader: swirlVert, fragmentShader: swirlFrag, transparent: true, depthWrite: false, side: DoubleSide });
    const m = new Mesh(geo, this.swirlMat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.name = 'whirlpools';
    this.add(m, geo, this.swirlMat);
  }

  /**
   * Neon night: glowing light rails just outside both buoy lines (with their
   * reflection shimmering on the water) and a floating light hoop at every
   * checkpoint.
   */
  private buildNeon() {
    const track = this.session.track;
    const W = track.width;
    const shortcutMouths: { x: number; z: number }[] = [];
    for (const sc of track.shortcuts) shortcutMouths.push({ x: sc.pts[0], z: sc.pts[1] }, { x: sc.pts[sc.pts.length - 2], z: sc.pts[sc.pts.length - 1] });
    const rail = { pos: [] as number[], s: [] as number[], h: [] as number[], side: [] as number[], idx: [] as number[] };
    const sheen = { pos: [] as number[], s: [] as number[], u: [] as number[], side: [] as number[], idx: [] as number[] };
    const step = 3;
    for (const side of [-1, 1]) {
      let run = -1;
      for (let s = 0; s <= track.length; s += step) {
        track.sample(s, _tp);
        const lat = side * (W * 0.5 + 3);
        const x = _tp.x - _tp.tz * lat;
        const z = _tp.z + _tp.tx * lat;
        const gap = shortcutMouths.some((m) => Math.hypot(m.x - x, m.z - z) < 26) || this.session.statics.blocked(x, z, 0.5);
        if (gap) {
          run = -1;
          continue;
        }
        const sideF = side < 0 ? 0 : 1;
        const rb = rail.pos.length / 3;
        for (const hh of [0, 1]) {
          rail.pos.push(x, 0, z);
          rail.s.push(s);
          rail.h.push(hh);
          rail.side.push(sideF);
        }
        const sb = sheen.pos.length / 3;
        for (const u of [-1, 1]) {
          const l = lat + u * 5;
          sheen.pos.push(_tp.x - _tp.tz * l, 0, _tp.z + _tp.tx * l);
          sheen.s.push(s);
          sheen.u.push(u);
          sheen.side.push(sideF);
        }
        if (run >= 0) {
          rail.idx.push(rb - 2, rb, rb - 1, rb - 1, rb, rb + 1);
          sheen.idx.push(sb - 2, sb - 1, sb, sb - 1, sb + 1, sb);
        }
        run = rb;
      }
    }
    const uniforms = () => ({ ...waveUniforms, uColA: { value: new Color(0xff2fa8) }, uColB: { value: new Color(0x26e8ff) } });
    const mk = (d: typeof rail | typeof sheen, vs: string, fs: string, name: string, extra: [string, number[]][]) => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(d.pos), 3));
      geo.setAttribute('aS', new BufferAttribute(new Float32Array(d.s), 1));
      geo.setAttribute('aSide', new BufferAttribute(new Float32Array(d.side), 1));
      for (const [k, v] of extra) geo.setAttribute(k, new BufferAttribute(new Float32Array(v), 1));
      geo.setIndex(d.idx);
      const mat = new ShaderMaterial({ uniforms: uniforms(), vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      const m = new Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.name = name;
      this.railMats.push(mat);
      this.add(m, geo, mat);
    };
    mk(rail, railVert, railFrag, 'neonRails', [['aH', rail.h]]);
    mk(sheen, sheenVert, sheenFrag, 'neonSheen', [['aU', sheen.u]]);

    // Checkpoint hoops: a bright tube ring with a soft halo, half above the sea.
    const hb = new GeoBuilder();
    const R = W * 0.5 + 2;
    const HOOP = [0xff2fa8, 0x26e8ff, 0xb36bff, 0xffd21e];
    for (const g of track.gates) {
      if (g.index === 0) continue;
      const c = HOOP[g.index % HOOP.length];
      hb.add(new TorusGeometry(R, 0.55, 8, 112), c, { x: g.x, y: -R * 0.25, z: g.z, ry: g.heading });
      hb.add(new TorusGeometry(R + 1.6, 0.2, 6, 112), 0xffffff, { x: g.x, y: -R * 0.25, z: g.z, ry: g.heading });
    }
    if (!hb.empty) {
      const geo = hb.build();
      this.hoopMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, fog: false });
      const m = new Mesh(geo, this.hoopMat);
      m.name = 'neonHoops';
      this.add(m, geo, this.hoopMat);
    }
  }

  private buildBottles() {
    const n = this.session.bottles.length;
    if (!n) return;
    const g = new GeoBuilder();
    g.cyl(0.32, 0.36, 0.95, 0x3fae6a, { y: 0 }, 10);
    g.sphere(0.33, 0x3fae6a, { y: 0.47 }, 10, 6);
    g.cyl(0.12, 0.16, 0.42, 0x3fae6a, { y: 0.9 }, 8);
    g.cyl(0.13, 0.13, 0.16, 0xb07a44, { y: 1.15 }, 8);
    g.box(0.36, 0.42, 0.02, 0xf4ead0, { y: 0.05, z: 0.33 });
    const geo = g.build();
    this.bottleMesh = new InstancedMesh(geo, cel('bottle', { vertexColors: true, gloss: 1, rim: 1 }), n);
    this.bottleMesh.frustumCulled = false;
    addOutline(this.bottleMesh, 1.4);
    this.add(this.bottleMesh, geo);
    const rg = new RingGeometry(0.9, 1.5, 24);
    rg.rotateX(-Math.PI / 2);
    this.bottleGlow = new InstancedMesh(rg, new MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), n);
    this.bottleGlow.frustumCulled = false;
    this.add(this.bottleGlow, rg);
  }

  /** Floating ramps: one pivot per ramp, moved every frame by rampFloat(). */
  private floatRamps: { r: Ramp; pivot: Group; axis: Vector3 }[] = [];
  private rampMats: [import('three').Material, import('three').Material] | null = null;

  /** Build ramp meshes (course ramps at construction, admin-spawned ramps later). */
  addRamps(ramps: readonly Ramp[]) {
    if (!this.rampMats) {
      const rampTex = chevronTexture('#ffffff', '#ff8a1e', 'ramp_chev');
      this.rampMats = [cel('rampTop', { map: rampTex, emissive: 0x221100 }), cel('rampSide', { vertexColors: true })];
    }
    const [topMat, sideMat] = this.rampMats;
    for (const r of ramps) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const side = new GeoBuilder();
      const sh = Math.sin(r.heading);
      const ch = Math.cos(r.heading);
      const W2 = r.width / 2;
      // Geometry is built around the ramp's centre so the pivot can heave and tilt it.
      const cx = r.x + sh * r.length * 0.5;
      const cz = r.z + ch * r.length * 0.5;
      const toW = (along: number, across: number, y: number): [number, number, number] => [r.x + sh * along + ch * across - cx, y, r.z + ch * along - sh * across - cz];
      const y0 = -0.5 + 0.12;
      const y1 = -0.5 + r.height + 0.12;
      for (const [al, ac, y, u, v] of [
        [0, -W2, y0, 1, 0],
        [0, W2, y0, 0, 0],
        [r.length, -W2, y1, 1, 1],
        [r.length, W2, y1, 0, 1],
      ] as const) {
        pos.push(...toW(al, ac, y));
        uv.push(v * 3, u);
      }
      idx.push(0, 2, 1, 1, 2, 3);
      // Side skirts and the lip, as boxes oriented along the ramp.
      const ang = Math.atan2(r.height, r.length);
      const mid = r.length / 2;
      const cy = (y0 + y1) / 2 - 0.9;
      for (const sg of [-1, 1]) {
        const [x, , z] = toW(mid, sg * (W2 + 0.25), 0);
        side.box(0.5, 2.2, Math.hypot(r.length, r.height), 0x3a8fe0, { x, y: cy + 0.75, z, ry: r.heading, rx: -ang });
        const [x2, , z2] = toW(mid, sg * (W2 + 0.3), 0);
        side.box(0.45, 0.4, Math.hypot(r.length, r.height), 0xffffff, { x: x2, y: cy + 1.95, z: z2, ry: r.heading, rx: -ang });
      }
      const [lx, , lz] = toW(r.length - 0.2, 0, 0);
      side.box(r.width + 1, r.height + 0.6, 0.5, 0x3a8fe0, { x: lx, y: y1 / 2 - 0.5, z: lz, ry: r.heading });
      const [lx2, , lz2] = toW(r.length + 0.05, 0, 0);
      side.box(r.width + 1.1, 0.4, 0.6, 0xffffff, { x: lx2, y: y1 + 0.05, z: lz2, ry: r.heading });
      const [fx, , fz] = toW(r.length * 0.5, 0, 0);
      // Buoyant base: deeper than before so a heaving ramp never shows its underside.
      side.box(r.width + 1.4, 1.8, r.length + 1, 0xffd21e, { x: fx, y: -1.2, z: fz, ry: r.heading });
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const top = new Mesh(geo, topMat);
      addOutline(top, 1.8);
      const sGeo = side.build();
      const sides = new Mesh(sGeo, sideMat);
      addOutline(sides, 1.8);
      const pivot = new Group();
      pivot.position.set(cx, 0, cz);
      pivot.add(top, sides);
      pivot.name = 'ramp';
      this.add(pivot, geo, sGeo);
      // Tilt axis: horizontal, across the ramp. Negative angle lifts the lip.
      this.floatRamps.push({ r, pivot, axis: new Vector3(ch, 0, -sh) });
    }
    this.updateRamps(this.session.time);
  }

  private updateRamps(time: number) {
    for (const fr of this.floatRamps) {
      rampFloat(fr.r, time, _rampF);
      fr.pivot.position.y = _rampF.heave;
      fr.pivot.quaternion.setFromAxisAngle(fr.axis, -Math.atan(_rampF.tilt));
    }
  }

  /** Optional racing-line assist ribbon. */
  setRacingLine(on: boolean) {
    if (on && !this.lineMesh) {
      const track = this.session.track;
      const pos: number[] = [];
      const aS: number[] = [];
      const aE: number[] = [];
      const idx: number[] = [];
      const step = 2;
      const n = Math.floor(track.length / step);
      for (let i = 0; i <= n; i++) {
        const s = i * step;
        track.sample(s, _tp);
        const lat = track.lineAt(s);
        for (const e of [-1, 1]) {
          const l = lat + e * 1.1;
          pos.push(_tp.x - _tp.tz * l, 0, _tp.z + _tp.tx * l);
          aS.push(s);
          aE.push(e);
        }
        if (i < n) {
          // Counter-clockwise seen from above, so the faces point up (+Y).
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('aS', new BufferAttribute(new Float32Array(aS), 1));
      geo.setAttribute('aEdge', new BufferAttribute(new Float32Array(aE), 1));
      geo.setIndex(idx);
      this.lineMat = new ShaderMaterial({
        uniforms: { ...waveUniforms, uColor: { value: new Color(0x8ffcff) }, uOpacity: { value: 0.8 } },
        vertexShader: lineVert,
        fragmentShader: lineFrag,
        transparent: true,
        depthWrite: false,
      });
      this.lineMesh = new Mesh(geo, this.lineMat);
      this.lineMesh.name = 'racingLine';
      this.lineMesh.frustumCulled = false;
      this.lineMesh.renderOrder = 2;
      this.add(this.lineMesh, geo, this.lineMat);
    }
    if (this.lineMesh) this.lineMesh.visible = on;
  }

  private add(o: import('three').Object3D, ...d: { dispose(): void }[]) {
    this.group.add(o);
    this.disposables.push(...d);
  }

  update(time: number, camX: number, camZ: number, nextGate: number, showGate: boolean) {
    this.frame++;
    this.updateRamps(time);
    const s = this.session;
    // Buoys: near ones every frame, far ones every 4th.
    const buoys = s.buoys;
    for (let i = 0; i < buoys.length; i++) {
      const b = buoys[i];
      const far = Math.abs(b.x - camX) + Math.abs(b.z - camZ) > 260;
      if (far && (i + this.frame) % 4 !== 0) continue;
      sampleOcean(b.x, b.z, time, _sample);
      _n.copy(_sample.normal);
      _q.setFromUnitVectors(_up, _n);
      if (b.wobble > 0) {
        _e.set(Math.sin(time * 14 + i) * b.wobble * 0.5, 0, Math.cos(time * 11 + i) * b.wobble * 0.5);
        _q2.setFromEuler(_e);
        _q.multiply(_q2);
      }
      _p.set(b.x, _sample.height - 0.1, b.z);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.buoyLod.setMatrixAt(i, _m);
      _p.set(0, 2.05, 0).applyQuaternion(_q);
      _p.x += b.x;
      _p.y += _sample.height - 0.1;
      _p.z += b.z;
      _m.compose(_p, _q, _s);
      this.buoyLights.setMatrixAt(i, _m);
      const mk = this.markOf[i];
      if (mk >= 0) {
        _p.y += 0.75;
        _m.compose(_p, _q, _s);
        this.marks[mk].mesh.setMatrixAt(this.markSlot[i], _m);
      }
    }
    if (this.buoyClock.due(camX, camZ, 1 / 60)) this.buoyLod.partition(camX, camZ, this.buoyX, this.buoyZ);
    else this.buoyLod.markDirty();
    this.buoyLights.instanceMatrix.needsUpdate = true;
    for (const m of this.marks) m.mesh.instanceMatrix.needsUpdate = true;

    // Next gate highlight.
    const g = s.track.gates[nextGate % s.track.gates.length];
    this.gateHighlight.visible = showGate && !!g;
    if (g) {
      this.gateHighlight.position.set(g.x, 0, g.z);
      this.gateHighlight.rotation.y = g.heading;
      (this.gateHighlight.material as MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(time * 6);
    }

    if (this.hoopMat) this.hoopMat.opacity = 0.75 + 0.25 * Math.sin(time * 3.1);

    if (this.ringMesh) {
      const rings = s.rings;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        const sc = r.taken ? 0.0001 : r.radius;
        _q.setFromAxisAngle(_up, r.heading);
        _m.compose(_p.set(r.x, r.y + Math.sin(time * 2 + i) * 0.3, r.z), _q, _s.set(sc, sc, sc));
        this.ringMesh.setMatrixAt(i, _m);
      }
      this.ringMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bottleMesh && this.bottleGlow) {
      const bs = s.bottles;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        const sc = b.found ? 0.0001 : 1;
        const floating = b.y < 2;
        const y = floating ? oceanHeight(b.x, b.z, time) + 0.1 : b.y + Math.sin(time * 1.7 + i) * 0.25;
        _e.set(floating ? 1.2 + Math.sin(time * 1.3 + i) * 0.25 : 0, time * 0.9 + i, floating ? Math.sin(time * 0.9 + i) * 0.2 : 0);
        _q.setFromEuler(_e);
        _m.compose(_p.set(b.x, y, b.z), _q, _s.set(sc, sc, sc));
        this.bottleMesh.setMatrixAt(i, _m);
        const pulse = (1 + 0.35 * Math.sin(time * 4 + i)) * sc;
        _m.compose(_p.set(b.x, (floating ? y : b.y) + (floating ? 0.05 : -0.6), b.z), _q.identity(), _s.set(pulse, pulse, pulse));
        this.bottleGlow.setMatrixAt(i, _m);
      }
      this.bottleMesh.instanceMatrix.needsUpdate = true;
      this.bottleGlow.instanceMatrix.needsUpdate = true;
    }
    if (this.mineMesh) {
      const mines = s.mines;
      for (let i = 0; i < mines.length; i++) {
        const mi = mines[i];
        const sc = mi.active ? 1.25 : 0.0001;
        _q.setFromAxisAngle(_up, time * 0.3 + i);
        _m.compose(_p.set(mi.x, oceanHeight(mi.x, mi.z, time) + 0.25, mi.z), _q, _s.set(sc, sc, sc));
        this.mineMesh.setMatrixAt(i, _m);
      }
      this.mineMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

