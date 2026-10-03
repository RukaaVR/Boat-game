/**
 * Wake ribbons and hull foam — what connects a boat to the water.
 *
 * Wake: each boat drops a trail point every few metres into a ring buffer. All
 * trails share ONE geometry (one draw call). The CPU writes only x/z plus
 * per-vertex age/edge/strength; the vertex shader puts every vertex onto the
 * water with `oceanAtWorld` — the same inverse-sampled height the hull floats
 * on — so the wake can never float above or sink into the swell.
 *
 * Hull collars: an instanced grid under each hull, displaced the same way,
 * drawing a foam ring with a speed-driven bow wave and stern churn.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { WAVE_GLSL, waveUniforms } from './waves';
import { foamTexture } from '../render/textures';
import { clamp01 } from '../core/mathx';
import type { Boat } from '../boat/boat';

const POINTS = 110;
const SPACING = 1.6; // metres between trail points

interface Trail {
  x: Float32Array;
  z: Float32Array;
  nx: Float32Array; // lateral unit at drop time
  nz: Float32Array;
  t: Float32Array; // drop time
  w: Float32Array; // initial half-width
  s: Float32Array; // strength
  head: number;
  count: number;
  lastX: number;
  lastZ: number;
  color: Color;
}

const wakeVert = /* glsl */ `
${WAVE_GLSL}
attribute vec4 aInfo; // age01, edge(-1..1), strength, _
attribute vec3 aColor;
varying vec4 vInfo;
varying vec3 vColor;
varying vec2 vXZ;
void main() {
  vec3 p = oceanAtWorld(position.xz, uTime);
  p.y += 0.06 + aInfo.x * 0.02;
  vInfo = aInfo;
  vColor = aColor;
  vXZ = position.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const wakeFrag = /* glsl */ `
uniform sampler2D uFoamMap;
uniform vec3 uFoam;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec4 vInfo;
varying vec3 vColor;
varying vec2 vXZ;
void main() {
  float age = vInfo.x;
  float e = abs(vInfo.y);
  float str = vInfo.z;
  // Soft fbm breakup in world space + streaks running along the trail.
  float n = texture2D(uFoamMap, vXZ * 0.07).g;
  float n2 = texture2D(uFoamMap, vXZ * 0.21 + vec2(uTime * 0.03, 0.0)).g;
  float streak = texture2D(uFoamMap, vec2(vInfo.y * 0.35 + 0.5, age * 3.0)).b;
  float bub = texture2D(uFoamMap, vXZ * 0.35).r;
  float arms = smoothstep(0.7, 0.92, e) * (1.0 - smoothstep(0.92, 1.0, e));
  float centre = (1.0 - smoothstep(0.0, 0.32, e)) * (1.0 - smoothstep(0.0, 0.3, age));
  float body = (1.0 - smoothstep(0.3, 0.95, e)) * (1.0 - smoothstep(0.1, 0.6, age)) * 0.3;
  float breakup = smoothstep(0.3, 0.78, n * 0.6 + n2 * 0.4 + (1.0 - age) * 0.2);
  // Churned centre is broken into streaks so it never reads as a solid band.
  float churn = centre * smoothstep(0.35, 0.7, streak * 0.7 + n2 * 0.5) * (0.45 + 0.55 * bub);
  float a = (arms * 0.75 + body * streak) * breakup + churn * 0.55;
  a *= str * pow(1.0 - age, 1.6) * 0.7;
  if (a < 0.02) discard;
  vec3 col = mix(uFoam, vColor, 0.18 * (1.0 - age));
  float d = length(cameraPosition.xz - vXZ) * uFogDensity;
  col = mix(col, uFogColor, 1.0 - exp(-d * d));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.7));
  #include <colorspace_fragment>
}
`;

const collarVert = /* glsl */ `
${WAVE_GLSL}
attribute vec4 aParams; // speed01, wet, boost, drift
varying vec2 vLocal;
varying vec4 vParams;
varying vec2 vXZ;
void main() {
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  wp = modelMatrix * wp;
  vec3 p = oceanAtWorld(wp.xz, uTime);
  p.y += 0.07;
  vLocal = position.xz; // x = across (-1..1), z = along (-1..1)
  vParams = aParams;
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const collarFrag = /* glsl */ `
uniform sampler2D uFoamMap;
uniform vec3 uFoam;
uniform float uTime;
varying vec2 vLocal;
varying vec4 vParams;
varying vec2 vXZ;
void main() {
  float speed = vParams.x;
  float wet = vParams.y;
  // Elliptical ring hugging the hull outline (hull occupies |r| < 0.62).
  vec2 q = vLocal;
  float r = length(vec2(q.x, q.y * 0.92));
  float ring = smoothstep(0.5, 0.64, r) * (1.0 - smoothstep(0.68, 1.0, r));
  // Bow wave: pushed forward and outward, grows with speed.
  float bow = smoothstep(0.1, 0.95, q.y) * (1.0 - smoothstep(0.55, 1.0, abs(q.x) + (1.0 - q.y) * 0.3));
  // Stern churn.
  float stern = smoothstep(-0.2, -0.95, q.y) * (1.0 - smoothstep(0.0, 0.7, abs(q.x)));
  vec4 f = texture2D(uFoamMap, vXZ * 0.16 + vec2(uTime * 0.25, uTime * 0.1));
  float a = ring * (0.55 + 0.45 * speed) + bow * speed * 0.9 + stern * (0.4 + speed) + vParams.w * ring * 0.6;
  a *= smoothstep(0.1, 0.55, f.r + 0.25) * wet;
  a *= 1.0 - smoothstep(0.85, 1.0, r);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uFoam, clamp(a, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;

const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _s = new Vector3();
const _p = new Vector3();

export class WakeSystem {
  readonly wakeMesh: Mesh;
  readonly collarMesh: InstancedMesh;
  readonly wakeMat: ShaderMaterial;
  readonly collarMat: ShaderMaterial;
  private trails: Trail[] = [];
  private pos: Float32Array;
  private info: Float32Array;
  private col: Float32Array;
  private params: Float32Array;
  private geo: BufferGeometry;
  private boats: Boat[];

  constructor(boats: Boat[], colors: string[]) {
    this.boats = boats;
    const nb = boats.length;
    for (let i = 0; i < nb; i++) {
      this.trails.push({
        x: new Float32Array(POINTS),
        z: new Float32Array(POINTS),
        nx: new Float32Array(POINTS),
        nz: new Float32Array(POINTS),
        t: new Float32Array(POINTS),
        w: new Float32Array(POINTS),
        s: new Float32Array(POINTS),
        head: 0,
        count: 0,
        lastX: boats[i].position.x,
        lastZ: boats[i].position.z,
        color: new Color(colors[i] ?? '#ffffff'),
      });
    }
    const verts = nb * POINTS * 2;
    this.pos = new Float32Array(verts * 3);
    this.info = new Float32Array(verts * 4);
    this.col = new Float32Array(verts * 3);
    const idx = new Uint32Array(nb * (POINTS - 1) * 6);
    let n = 0;
    for (let b = 0; b < nb; b++) {
      const base = b * POINTS * 2;
      for (let i = 0; i < POINTS - 1; i++) {
        const a = base + i * 2;
        idx[n++] = a;
        idx[n++] = a + 1;
        idx[n++] = a + 2;
        idx[n++] = a + 1;
        idx[n++] = a + 3;
        idx[n++] = a + 2;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aInfo', new BufferAttribute(this.info, 4).setUsage(DynamicDrawUsage));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    geo.setIndex(new BufferAttribute(idx, 1));
    this.geo = geo;
    this.wakeMat = new ShaderMaterial({
      uniforms: {
        ...waveUniforms,
        uFoamMap: { value: foamTexture() },
        uFoam: { value: new Color(0xffffff) },
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0.001 },
      },
      vertexShader: wakeVert,
      fragmentShader: wakeFrag,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.wakeMesh = new Mesh(geo, this.wakeMat);
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.renderOrder = 1;
    this.wakeMesh.name = 'wakes';

    const plane = new PlaneGeometry(2, 2, 10, 14);
    plane.rotateX(-Math.PI / 2);
    // PlaneGeometry after rotateX(-90°) maps v→ -z; flip so +z is the bow.
    plane.scale(1, 1, -1);
    this.params = new Float32Array(nb * 4);
    plane.setAttribute('aParams', new InstancedBufferAttribute(this.params, 4).setUsage(DynamicDrawUsage));
    this.collarMat = new ShaderMaterial({
      uniforms: { ...waveUniforms, uFoamMap: { value: foamTexture() }, uFoam: { value: new Color(0xffffff) } },
      vertexShader: collarVert,
      fragmentShader: collarFrag,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.collarMesh = new InstancedMesh(plane, this.collarMat, nb);
    this.collarMesh.frustumCulled = false;
    this.collarMesh.renderOrder = 2;
    this.collarMesh.name = 'hullFoam';
    void AdditiveBlending;
  }

  setTrailColor(i: number, hex: string) {
    this.trails[i]?.color.set(hex);
  }

  update(time: number) {
    const nb = this.boats.length;
    for (let b = 0; b < nb; b++) {
      const boat = this.boats[b];
      const tr = this.trails[b];
      const px = boat.position.x;
      const pz = boat.position.z;
      const fx = Math.sin(boat.heading);
      const fz = Math.cos(boat.heading);
      // Trail anchor: transom.
      const sx = px - fx * boat.spec.length * 0.45;
      const sz = pz - fz * boat.spec.length * 0.45;
      const moved = Math.hypot(sx - tr.lastX, sz - tr.lastZ);
      if (moved > 30) {
        // Teleport (respawn): break the trail.
        tr.count = 0;
        tr.lastX = sx;
        tr.lastZ = sz;
      } else if (moved >= SPACING) {
        const h = tr.head;
        tr.x[h] = sx;
        tr.z[h] = sz;
        tr.nx[h] = fz;
        tr.nz[h] = -fx;
        tr.t[h] = time;
        tr.w[h] = boat.spec.beam * 0.45;
        const spd = clamp01(boat.speed / 30);
        const inWater = boat.airborne ? 0 : clamp01(boat.wet * 1.5);
        tr.s[h] = inWater * (0.25 + 0.75 * spd) * (1 + boat.boostLevel * 0.3 + (boat.drifting ? 0.4 : 0));
        tr.head = (h + 1) % POINTS;
        tr.count = Math.min(POINTS, tr.count + 1);
        tr.lastX = sx;
        tr.lastZ = sz;
      }
      // Write vertices newest → oldest. The newest vertex is pinned to the transom.
      const base = b * POINTS * 2;
      for (let i = 0; i < POINTS; i++) {
        const v = base + i * 2;
        if (i >= tr.count) {
          // Collapse unused segments onto the oldest point with zero strength.
          for (let e = 0; e < 2; e++) {
            this.pos[(v + e) * 3] = sx;
            this.pos[(v + e) * 3 + 1] = 0;
            this.pos[(v + e) * 3 + 2] = sz;
            this.info[(v + e) * 4 + 2] = 0;
          }
          continue;
        }
        const k = (tr.head - 1 - i + POINTS * 2) % POINTS;
        const age = time - tr.t[k];
        const age01 = Math.min(1, age / 5.5);
        // V-shaped spread: width grows with age (Kelvin wedge ~ 19.5°).
        const half = tr.w[k] + age * 1.7;
        const x = i === 0 ? sx : tr.x[k];
        const z = i === 0 ? sz : tr.z[k];
        for (let e = 0; e < 2; e++) {
          const side = e === 0 ? -1 : 1;
          const o = (v + e) * 3;
          this.pos[o] = x + tr.nx[k] * half * side;
          this.pos[o + 1] = 0;
          this.pos[o + 2] = z + tr.nz[k] * half * side;
          const q = (v + e) * 4;
          this.info[q] = age01;
          this.info[q + 1] = side;
          this.info[q + 2] = tr.s[k] * (i === 0 ? 0.6 : 1);
          this.info[q + 3] = 0;
          this.col[o] = tr.color.r;
          this.col[o + 1] = tr.color.g;
          this.col[o + 2] = tr.color.b;
        }
      }

      // Collar instance.
      _p.set(px, 0, pz);
      _s.set(boat.spec.beam * 1.25, 1, boat.spec.length * 0.95);
      _m.makeRotationAxis(_up, boat.heading);
      _m.scale(_s);
      _m.setPosition(_p);
      this.collarMesh.setMatrixAt(b, _m);
      const near = boat.airborne ? 0 : clamp01(1 - (boat.position.y - boat.surfaceY - 0.2) / 1.0);
      this.params[b * 4] = clamp01(boat.speed / 32);
      this.params[b * 4 + 1] = near * clamp01(boat.wet * 2);
      this.params[b * 4 + 2] = boat.boostLevel;
      this.params[b * 4 + 3] = boat.drifting ? 1 : 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.aInfo as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as BufferAttribute).needsUpdate = true;
    this.collarMesh.instanceMatrix.needsUpdate = true;
    (this.collarMesh.geometry.attributes.aParams as InstancedBufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.collarMesh.geometry.dispose();
    this.wakeMat.dispose();
    this.collarMat.dispose();
  }
}
