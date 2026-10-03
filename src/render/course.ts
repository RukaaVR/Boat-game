/**
 * Course furniture visuals. Everything that floats samples the shared wave
 * field (CPU for instanced props, `WAVE_GLSL` in-shader for ribbons/pads).
 */

import {
  AdditiveBlending,
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
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  Euler,
} from 'three';
import type { RaceSession } from '../race/session';
import { THEME_STYLE } from '../environment/weatherDefs';
import { addOutline, cel, makeCel } from './cel';
import { GeoBuilder } from './geo';
import { bannerTexture, chevronTexture } from './textures';
import { makeSample, oceanHeight, sampleOcean, WAVE_GLSL, waveUniforms } from '../water/waves';
import type { TrackPoint } from '../race/track';

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
  p.y += 0.12;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const padFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // Chevrons scrolling forward.
  float y = vUv.y * 4.0 - uTime * 2.2 - abs(vUv.x - 0.5) * 2.0;
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
  p.y += 0.09;
  vDist = length(p.xz - cameraPosition.xz);
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
  float arrow = fract(vS / 7.0 - uTime * 0.6 - abs(vEdge) * 0.35);
  float a = smoothstep(0.0, 0.12, arrow) * (1.0 - smoothstep(0.35, 0.5, arrow));
  a *= 1.0 - smoothstep(0.6, 1.0, abs(vEdge));
  a *= (1.0 - smoothstep(60.0, 160.0, vDist)) * smoothstep(4.0, 12.0, vDist);
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}
`;

export class CourseVisuals {
  readonly group = new Group();
  private buoyMesh: InstancedMesh;
  private buoyLights: InstancedMesh;
  private gateHighlight: Mesh;
  private ringMesh: InstancedMesh | null = null;
  private mineMesh: InstancedMesh | null = null;
  private padMat: ShaderMaterial | null = null;
  private lineMat: ShaderMaterial | null = null;
  private lineMesh: Mesh | null = null;
  private disposables: { dispose(): void }[] = [];
  private frame = 0;

  constructor(private session: RaceSession) {
    const track = session.track;
    const style = THEME_STYLE[track.def.theme];

    // ── Buoys ────────────────────────────────────────────────────────────────
    const bb = new GeoBuilder();
    bb.cyl(0.55, 0.7, 1.3, 0xffffff, { y: 0.15 }, 10);
    bb.cone(0.55, 1.1, 0xffffff, { y: 1.35 }, 10);
    bb.cyl(0.72, 0.72, 0.18, 0x23262e, { y: -0.35 }, 10);
    bb.cyl(0.58, 0.58, 0.16, 0x23262e, { y: 0.75 }, 10);
    const bgeo = bb.build();
    const buoys = session.buoys;
    this.buoyMesh = new InstancedMesh(bgeo, cel('buoy', { vertexColors: true, gloss: 0.5 }), buoys.length);
    const col = new Color();
    for (let i = 0; i < buoys.length; i++) {
      const side = buoys[i].side;
      col.setHex(side === 0 ? style.buoyLeft : side === 1 ? style.buoyRight : 0xffd21e);
      this.buoyMesh.setColorAt(i, col);
    }
    this.buoyMesh.frustumCulled = false;
    this.buoyMesh.name = 'buoys';
    addOutline(this.buoyMesh, 1.6);
    this.add(this.buoyMesh, bgeo);
    // Little lamp on each buoy top (bright at night).
    const lg = new CylinderGeometry(0.16, 0.16, 0.3, 6);
    this.buoyLights = new InstancedMesh(lg, new MeshBasicMaterial({ color: 0xffffff, fog: true }), buoys.length);
    for (let i = 0; i < buoys.length; i++) {
      const side = buoys[i].side;
      col.setHex(side === 0 ? style.buoyLeft : side === 1 ? style.buoyRight : 0xffd21e).multiplyScalar(1.6);
      this.buoyLights.setColorAt(i, col);
    }
    this.buoyLights.frustumCulled = false;
    this.add(this.buoyLights, lg);

    // ── Gates (merged pylons + banners) ───────────────────────────────────
    const gp = new GeoBuilder();
    const half = track.width * 0.5 + 2.5;
    for (const g of track.gates) {
      const start = g.index === 0;
      for (const s of [-1, 1]) {
        const x = g.x - Math.cos(g.heading) * half * s;
        const z = g.z + Math.sin(g.heading) * half * s;
        const pyl = start ? 0xf4f1e8 : 0x2b2f3b;
        gp.cyl(1.2, 1.7, 13, pyl, { x, y: 4.5, z }, 8);
        gp.cyl(1.9, 1.9, 0.6, start ? 0xff3b5c : style.glow2, { x, y: 11.2, z }, 8);
        gp.cyl(2.3, 2.6, 1.6, 0x23262e, { x, y: -1.2, z }, 8);
      }
    }
    const gGeo = gp.build();
    const gates = new Mesh(gGeo, cel('gates', { vertexColors: true, gloss: 0.4 }));
    gates.name = 'gates';
    addOutline(gates, 1.8);
    this.add(gates, gGeo);
    for (const startOnly of [true, false]) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (const g of track.gates) {
        if ((g.index === 0) !== startOnly) continue;
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
      const tex = startOnly ? bannerTexture('RIPTIDE  •  START / FINISH', '#ff3b5c', 'banner_start') : bannerTexture('CHECKPOINT', '#26e8ff', 'banner_cp');
      const m = new Mesh(geo, cel(startOnly ? 'bannerStart' : 'bannerCp', { map: tex, emissive: 0x333333 }));
      this.add(m, geo);
    }
    // Next-checkpoint highlight arch.
    const hg = new GeoBuilder();
    hg.box(half * 2, 0.5, 0.5, 0xffffff, { y: 13.6 });
    for (const s of [-1, 1]) hg.box(0.5, 14, 0.5, 0xffffff, { x: s * half, y: 6.5 });
    const hGeo = hg.build();
    this.gateHighlight = new Mesh(hGeo, new MeshBasicMaterial({ color: 0x26e8ff, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, fog: false }));
    this.add(this.gateHighlight, hGeo);

    // ── Ramps ────────────────────────────────────────────────────────────────
    if (track.ramps.length) {
      const rampTex = chevronTexture('#ffffff', '#ff8a1e', 'ramp_chev');
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const side = new GeoBuilder();
      for (const r of track.ramps) {
        const sh = Math.sin(r.heading);
        const ch = Math.cos(r.heading);
        const W2 = r.width / 2;
        const toW = (along: number, across: number, y: number): [number, number, number] => [r.x + sh * along + ch * across, y, r.z + ch * along - sh * across];
        const y0 = -0.5 + 0.12;
        const y1 = -0.5 + r.height + 0.12;
        const base = pos.length / 3;
        for (const [al, ac, y, u, v] of [
          [0, -W2, y0, 1, 0],
          [0, W2, y0, 0, 0],
          [r.length, -W2, y1, 1, 1],
          [r.length, W2, y1, 0, 1],
        ] as const) {
          pos.push(...toW(al, ac, y));
          uv.push(v * 3, u);
        }
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        // Side skirts and the lip, as boxes oriented along the ramp.
        const ang = Math.atan2(r.height, r.length);
        const mid = r.length / 2;
        const cy = (y0 + y1) / 2 - 0.9;
        for (const s of [-1, 1]) {
          const [x, , z] = toW(mid, s * (W2 + 0.25), 0);
          side.box(0.5, 2.2, Math.hypot(r.length, r.height), 0x23262e, { x, y: cy + 0.75, z, ry: r.heading, rx: -ang });
          const [x2, , z2] = toW(mid, s * (W2 + 0.3), 0);
          side.box(0.35, 0.35, Math.hypot(r.length, r.height), 0xffd21e, { x: x2, y: cy + 1.95, z: z2, ry: r.heading, rx: -ang });
        }
        const [lx, , lz] = toW(r.length - 0.2, 0, 0);
        side.box(r.width + 1, r.height + 0.6, 0.5, 0x23262e, { x: lx, y: y1 / 2 - 0.5, z: lz, ry: r.heading });
        const [fx, , fz] = toW(r.length * 0.5, 0, 0);
        side.box(r.width + 1.4, 1.2, r.length + 1, 0x3a3e48, { x: fx, y: -0.9, z: fz, ry: r.heading });
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const top = new Mesh(geo, cel('rampTop', { map: rampTex, emissive: 0x221100 }));
      addOutline(top, 1.8);
      const sGeo = side.build();
      const sides = new Mesh(sGeo, cel('rampSide', { vertexColors: true }));
      addOutline(sides, 1.8);
      this.add(top, geo);
      this.add(sides, sGeo);
    }

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
        for (const o of [-2.6, 2.6]) posts.cyl(0.18, 0.22, 7, 0x2b2f3b, { x: s.x + ch * o, y: 1.5, z: s.z - sh * o }, 6);
        posts.cyl(1.4, 1.6, 1.2, 0x2b2f3b, { x: s.x, y: -0.2, z: s.z }, 8);
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
      for (const a of [-1, 1]) pg.cyl(0.2, 0.25, 9, 0x2b2f3b, { x: cx + ch * a * W, y: 3.6, z: cz - sh * a * W }, 6);
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
      mg.sphere(1, 0x5a1e1e, {}, 12, 9);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        mg.cyl(0.08, 0.12, 0.7, 0x2a2a2a, { x: Math.cos(a) * 1.05, z: Math.sin(a) * 1.05, rz: -a + Math.PI / 2, ry: 0 }, 5);
      }
      mg.cyl(0.08, 0.12, 0.7, 0x2a2a2a, { y: 1.05 }, 5);
      mg.sphere(0.18, 0xff2020, { y: 1.35 }, 6, 4);
      const geo = mg.build();
      this.mineMesh = new InstancedMesh(geo, cel('endlessMine', { vertexColors: true, gloss: 0.8 }), session.mines.length);
      this.mineMesh.frustumCulled = false;
      addOutline(this.mineMesh, 1.6);
      this.add(this.mineMesh, geo);
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
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('aS', new BufferAttribute(new Float32Array(aS), 1));
      geo.setAttribute('aEdge', new BufferAttribute(new Float32Array(aE), 1));
      geo.setIndex(idx);
      this.lineMat = new ShaderMaterial({
        uniforms: { ...waveUniforms, uColor: { value: new Color(0x7ff6ff) }, uOpacity: { value: 0.55 } },
        vertexShader: lineVert,
        fragmentShader: lineFrag,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      this.lineMesh = new Mesh(geo, this.lineMat);
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
      this.buoyMesh.setMatrixAt(i, _m);
      _p.set(0, 2.0, 0).applyQuaternion(_q);
      _p.x += b.x;
      _p.y += _sample.height - 0.1;
      _p.z += b.z;
      _m.compose(_p, _q, _s);
      this.buoyLights.setMatrixAt(i, _m);
    }
    this.buoyMesh.instanceMatrix.needsUpdate = true;
    this.buoyLights.instanceMatrix.needsUpdate = true;

    // Next gate highlight.
    const g = s.track.gates[nextGate % s.track.gates.length];
    this.gateHighlight.visible = showGate && !!g;
    if (g) {
      this.gateHighlight.position.set(g.x, 0, g.z);
      this.gateHighlight.rotation.y = g.heading;
      (this.gateHighlight.material as MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(time * 6);
    }

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

