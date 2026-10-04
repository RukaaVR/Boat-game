/**
 * Pooled particle systems. Two `Points` objects (alpha-blended and additive),
 * each backed by fixed Float32Arrays. Emission writes into free slots, dead
 * particles are swap-removed, and only the live range is uploaded. Nothing is
 * allocated after construction.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, NormalBlending, Points, ShaderMaterial } from 'three';
import { particleSprite } from '../render/textures';

export type ParticleKind = 'spray' | 'mist' | 'boost' | 'spark' | 'smoke' | 'steam' | 'ember' | 'drop' | 'confetti' | 'splash' | 'ripple' | 'dust' | 'ash' | 'spindrift';

interface KindDef {
  additive: boolean;
  life: [number, number];
  size: [number, number]; // start, end
  alpha: number;
  gravity: number;
  drag: number;
  /** Dies when it falls back below its spawn water level. */
  water: boolean;
}

const KINDS: Record<ParticleKind, KindDef> = {
  spray: { additive: false, life: [0.35, 0.75], size: [0.14, 0.55], alpha: 0.85, gravity: 11, drag: 0.6, water: true },
  splash: { additive: false, life: [0.5, 1.1], size: [0.25, 1.0], alpha: 0.85, gravity: 12, drag: 0.4, water: true },
  drop: { additive: false, life: [0.4, 0.8], size: [0.15, 0.1], alpha: 0.9, gravity: 14, drag: 0.2, water: true },
  mist: { additive: false, life: [0.8, 1.6], size: [1.0, 3.2], alpha: 0.06, gravity: -0.4, drag: 1.4, water: false },
  ripple: { additive: false, life: [0.2, 0.35], size: [0.2, 0.7], alpha: 0.5, gravity: 0, drag: 0, water: false },
  boost: { additive: true, life: [0.18, 0.4], size: [0.7, 0.1], alpha: 1, gravity: 0, drag: 3, water: false },
  spark: { additive: true, life: [0.3, 0.6], size: [0.25, 0.05], alpha: 1, gravity: 9.8, drag: 0.8, water: false },
  smoke: { additive: false, life: [5, 9], size: [8, 30], alpha: 0.4, gravity: -1.6, drag: 0.15, water: false },
  steam: { additive: false, life: [2.5, 4], size: [2, 9], alpha: 0.32, gravity: -1.8, drag: 0.6, water: false },
  ember: { additive: true, life: [1.5, 3.5], size: [0.35, 0.1], alpha: 1, gravity: -1.2, drag: 0.5, water: false },
  confetti: { additive: false, life: [2.5, 4], size: [0.35, 0.3], alpha: 1, gravity: 3, drag: 1.2, water: false },
  dust: { additive: true, life: [3, 6], size: [0.18, 0.12], alpha: 0.55, gravity: -0.05, drag: 0.3, water: false },
  ash: { additive: false, life: [4, 7], size: [0.16, 0.12], alpha: 0.7, gravity: 0.35, drag: 0.6, water: false },
  spindrift: { additive: false, life: [1.2, 2.2], size: [1.4, 4.5], alpha: 0.1, gravity: -0.2, drag: 0.4, water: false },
};

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
uniform float uFogDensity;
varying float vAlpha;
varying vec3 vColor;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.5), 0.0, 96.0);
  // Fade out particles right in front of the lens so they never white-out the frame.
  vAlpha = aAlpha * smoothstep(3.0, 12.0, -mv.z);
  vColor = aColor;
  float fd = uFogDensity * -mv.z;
  vFog = 1.0 - exp(-fd * fd);
}
`;
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uAdditive;
varying float vAlpha;
varying vec3 vColor;
varying float vFog;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  vec3 c = mix(vColor, uFogColor, vFog * (1.0 - uAdditive));
  a *= 1.0 - vFog * uAdditive;
  gl_FragColor = vec4(c * mix(1.0, a, uAdditive), mix(a, 1.0, uAdditive));
  #include <colorspace_fragment>
}
`;

class Pool {
  readonly points: Points;
  readonly mat: ShaderMaterial;
  readonly max: number;
  count = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private kind: Uint8Array;
  private floor: Float32Array;
  private smul: Float32Array;
  private geo: BufferGeometry;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.floor = new Float32Array(max);
    this.smul = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aColor', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new ShaderMaterial({
      uniforms: {
        uMap: { value: particleSprite() },
        uScale: { value: 500 },
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0.001 },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
  }

  emit(k: number, def: KindDef, x: number, y: number, z: number, vx: number, vy: number, vz: number, c: Color, lifeMul: number, sizeMul: number, floor: number) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    const l = (def.life[0] + Math.random() * (def.life[1] - def.life[0])) * lifeMul;
    this.life[i] = l;
    this.maxLife[i] = l;
    this.kind[i] = k;
    this.size[i] = def.size[0] * sizeMul;
    this.smul[i] = sizeMul;
    this.alpha[i] = def.alpha;
    this.floor[i] = floor;
  }

  update(dt: number, defs: KindDef[]) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      const d = defs[this.kind[i]];
      const p = i * 3;
      if (this.life[i] <= 0 || (d.water && this.pos[p + 1] < this.floor[i] && this.vel[p + 1] < 0)) {
        this.kill(i);
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const drag = Math.exp(-d.drag * dt);
      this.vel[p] *= drag;
      this.vel[p + 1] = this.vel[p + 1] * drag - d.gravity * dt;
      this.vel[p + 2] *= drag;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      const sz = (d.size[0] + (d.size[1] - d.size[0]) * t) * this.smul[i];
      if (d.water) {
        // Cartoon water stays solid white and shrinks away instead of fading
        // (overlapping translucent discs read as soap bubbles).
        const k = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
        this.size[i] = sz * k * k;
        this.alpha[i] = 1;
      } else {
        this.size[i] = sz;
        this.alpha[i] = d.alpha * (t < 0.1 ? t / 0.1 : 1 - Math.pow((t - 0.1) / 0.9, 1.5));
      }
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.count);
    if (this.count > 0) {
      for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
        const a = g.getAttribute(name) as BufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.count * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[last * 3 + k];
      this.vel[i * 3 + k] = this.vel[last * 3 + k];
      this.col[i * 3 + k] = this.col[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.kind[i] = this.kind[last];
    this.size[i] = this.size[last];
    this.alpha[i] = this.alpha[last];
    this.floor[i] = this.floor[last];
    this.smul[i] = this.smul[last];
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}

const KIND_LIST = Object.keys(KINDS) as ParticleKind[];
const DEF_LIST = KIND_LIST.map((k) => KINDS[k]);
const KIND_INDEX = Object.fromEntries(KIND_LIST.map((k, i) => [k, i])) as Record<ParticleKind, number>;

export class Particles {
  private normal: Pool;
  private additive: Pool;
  readonly objects: Points[];
  /** Global emission multiplier from graphics quality. */
  density = 1;

  constructor(quality: 'low' | 'medium' | 'high') {
    const n = quality === 'high' ? 9000 : quality === 'medium' ? 6000 : 3000;
    this.density = quality === 'high' ? 1 : quality === 'medium' ? 0.75 : 0.45;
    this.normal = new Pool(n, false);
    this.additive = new Pool(Math.round(n * 0.45), true);
    this.objects = [this.normal.points, this.additive.points];
  }

  get active() {
    return this.normal.count + this.additive.count;
  }

  setFog(color: Color, density: number) {
    for (const p of [this.normal, this.additive]) {
      p.mat.uniforms.uFogColor.value.copy(color);
      p.mat.uniforms.uFogDensity.value = density;
    }
  }

  setScale(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.normal.mat.uniforms.uScale.value = s;
    this.additive.mat.uniforms.uScale.value = s;
  }

  /** Emit one particle. `floor` = water height for kinds that die on re-entry. */
  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color, lifeMul = 1, sizeMul = 1, floor = -1e9) {
    const k = KIND_INDEX[kind];
    const d = DEF_LIST[k];
    (d.additive ? this.additive : this.normal).emit(k, d, x, y, z, vx, vy, vz, color, lifeMul, sizeMul, floor);
  }

  /** How many particles a `rate`/s stream should emit this frame (stochastic rounding). */
  count(rate: number, dt: number) {
    return Math.floor(rate * dt * this.density + Math.random());
  }

  update(dt: number) {
    this.normal.update(dt, DEF_LIST);
    this.additive.update(dt, DEF_LIST);
  }

  clear() {
    this.normal.clear();
    this.additive.clear();
  }

  dispose() {
    for (const p of [this.normal, this.additive]) {
      p.points.geometry.dispose();
      p.mat.dispose();
    }
  }
}
