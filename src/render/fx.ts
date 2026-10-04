/**
 * FX director — every visual "juice" response lives here. Reads boat state and
 * drains sim events; writes particles, camera trauma, screen effects and
 * gamepad rumble requests. Holds no gameplay state.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
} from 'three';
import { impactBurstTexture, impactRingTexture, sparkleTexture } from './textures';
import { clamp01, damp, smoothstep } from '../core/mathx';
import type { EventQueue } from '../core/events';
import type { Particles } from '../particles/particles';
import type { CameraRig } from '../camera/cameraRig';
import type { Renderer } from './renderer';
import type { RaceSession } from '../race/session';
import type { Emitter } from '../environment/scenery';
import type { BoatVisual } from '../boat/boatMesh';
import { oceanHeight } from '../water/waves';
import { DriftGlow } from './driftGlow';

const WHITE = new Color(1, 1, 1);
const MIST = new Color(0.92, 0.96, 1);
const SPARK = new Color(1, 0.75, 0.3);
const SMOKE = new Color(0.22, 0.2, 0.22);
const STEAM = new Color(0.9, 0.92, 0.95);
const EMBER = new Color(1, 0.45, 0.1);
const DUST = new Color(1, 0.9, 0.6);
const ASH = new Color(0.35, 0.32, 0.33);
const SNOW = new Color(0.95, 0.97, 1);
const POLLEN = new Color(0.85, 1, 0.55);
/** Drift tiers: white, then BLUE → ORANGE → PURPLE (mini-turbo charge). */
const TIER = [new Color(1, 1, 1), new Color(0.25, 0.7, 1), new Color(1, 0.55, 0.12), new Color(0.72, 0.32, 1)];
const CONFETTI = [new Color(1, 0.23, 0.36), new Color(0.16, 0.83, 1), new Color(1, 0.88, 0.3), new Color(0.65, 1, 0.24), new Color(0.48, 0.36, 1)];
const GOLD = new Color(1, 0.8, 0.15);
const GOLD_HOT = new Color(1, 0.95, 0.6);
const DIZZY = new Color(1, 0.92, 0.3);
const STORM = new Color(0.65, 0.85, 1);
const MISSILE_FIRE = new Color(1, 0.6, 0.15);
const _c = new Color();
const _nz = new Vector3();

// ── Anime pops ────────────────────────────────────────────────────────────────
// Short-lived hand-drawn-looking accents: impact star bursts, flat shock rings
// on the water, splash crowns and boost sparkles. Small fixed pools; nothing is
// allocated after construction. Geometry is shared by every world.

let crownGeo: BufferGeometry | null = null;
/** Open jagged cylinder (radius 1, height 1): the classic cartoon splash crown. */
function crownGeometry() {
  if (crownGeo) return crownGeo;
  const spikes = 11;
  const cols = spikes * 2;
  const pos = new Float32Array((cols + 1) * 2 * 3);
  const idx: number[] = [];
  for (let j = 0; j <= cols; j++) {
    const a = (j / cols) * Math.PI * 2;
    const tip = j % 2 === 0;
    const rt = tip ? 1.32 : 1.1;
    const h = tip ? 1 : 0.42;
    const o = j * 6;
    pos[o] = Math.cos(a);
    pos[o + 1] = 0;
    pos[o + 2] = Math.sin(a);
    pos[o + 3] = Math.cos(a) * rt;
    pos[o + 4] = h;
    pos[o + 5] = Math.sin(a) * rt;
    if (j < cols) {
      const b0 = j * 2;
      idx.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  crownGeo = g;
  return g;
}
let ringGeo: PlaneGeometry | null = null;
function ringGeometry() {
  if (!ringGeo) ringGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return ringGeo;
}

const crownVert = /* glsl */ `
varying float vH;
void main() {
  vH = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
// Front faces white, back faces pale aqua with a hard band at the rim: two flat
// tones and no gradients, like a cel-painted splash.
const crownFrag = /* glsl */ `
uniform float uOpacity;
varying float vH;
void main() {
  vec3 c = gl_FrontFacing ? vec3(1.0) : mix(vec3(0.55, 0.85, 1.0), vec3(0.85, 0.96, 1.0), step(0.55, vH));
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}
`;

type SpriteKind = 'burst' | 'sparkle';
interface SpritePop {
  s: Sprite;
  m: SpriteMaterial;
  kind: SpriteKind;
  age: number;
  life: number;
  size: number;
  spin: number;
  /** Racer to follow (-1 = static), with offset from the boat. */
  follow: number;
  ox: number;
  oy: number;
  oz: number;
}
interface MeshPop {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
  height: number;
}

class AnimePops {
  readonly group = new Group();
  private sprites: SpritePop[] = [];
  private rings: MeshPop[] = [];
  private crowns: MeshPop[] = [];
  private nextSprite = 0;
  private nextRing = 0;
  private nextCrown = 0;
  private burstTex: Texture;
  private sparkleTex: Texture;

  constructor() {
    this.group.name = 'animePops';
    this.burstTex = impactBurstTexture();
    this.sparkleTex = sparkleTexture();
    for (let i = 0; i < 32; i++) {
      const m = new SpriteMaterial({ map: this.sparkleTex, transparent: true, depthWrite: false, fog: true });
      const s = new Sprite(m);
      s.visible = false;
      s.renderOrder = 9;
      this.group.add(s);
      this.sprites.push({ s, m, kind: 'sparkle', age: 0, life: 0, size: 1, spin: 0, follow: -1, ox: 0, oy: 0, oz: 0 });
    }
    const ringTex = impactRingTexture();
    for (let i = 0; i < 8; i++) {
      const m = new MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new Mesh(ringGeometry(), m);
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, age: 0, life: 0, size: 1, height: 0 });
    }
    for (let i = 0; i < 8; i++) {
      const m = new ShaderMaterial({ uniforms: { uOpacity: { value: 1 } }, vertexShader: crownVert, fragmentShader: crownFrag, transparent: true, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(crownGeometry(), m);
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.crowns.push({ mesh, age: 0, life: 0, size: 1, height: 1 });
    }
  }

  private sprite(kind: SpriteKind, x: number, y: number, z: number, size: number, life: number, color: Color) {
    const p = this.sprites[this.nextSprite];
    this.nextSprite = (this.nextSprite + 1) % this.sprites.length;
    p.kind = kind;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.follow = -1;
    p.spin = (Math.random() - 0.5) * (kind === 'burst' ? 2 : 8);
    p.m.map = kind === 'burst' ? this.burstTex : this.sparkleTex;
    // Bursts sit on top of everything for their few frames, like a drawn-over accent.
    p.m.depthTest = kind !== 'burst';
    p.m.rotation = Math.random() * Math.PI * 2;
    p.m.color.copy(color);
    p.m.opacity = 1;
    p.s.position.set(x, y, z);
    p.s.scale.setScalar(0.001);
    p.s.visible = true;
    return p;
  }

  burst(x: number, y: number, z: number, size: number) {
    this.sprite('burst', x, y, z, size, 0.26, WHITE);
  }

  /** Sparkle stars scattered around (and riding with) a racer. */
  sparkles(racer: number, x: number, y: number, z: number, count: number, radius: number, color: Color) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.8;
      const r = radius * (0.6 + Math.random() * 0.6);
      const ox = Math.cos(a) * r;
      const oz = Math.sin(a) * r;
      const oy = 0.5 + Math.random() * 1.8;
      const c = k % 3 === 0 ? WHITE : color;
      const p = this.sprite('sparkle', x + ox, y + oy, z + oz, 1.5 + Math.random() * 1.4, 0.4 + Math.random() * 0.3, c);
      p.age = -k * 0.025; // pop in one after another
      p.follow = racer;
      p.ox = ox;
      p.oy = oy;
      p.oz = oz;
    }
  }

  ring(x: number, y: number, z: number, size: number) {
    const p = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    p.age = 0;
    p.life = 0.45;
    p.size = size;
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = Math.random() * Math.PI;
    p.mesh.scale.setScalar(0.001);
    p.mesh.visible = true;
  }

  crown(x: number, y: number, z: number, radius: number, height: number) {
    const p = this.crowns[this.nextCrown];
    this.nextCrown = (this.nextCrown + 1) % this.crowns.length;
    p.age = 0;
    p.life = 0.5 + height * 0.06;
    p.size = radius;
    p.height = height;
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = Math.random() * Math.PI;
    p.mesh.scale.setScalar(0.001);
    p.mesh.visible = true;
  }

  update(dt: number, session: RaceSession, cam: Vector3) {
    const racers = session.racers;
    for (const p of this.sprites) {
      if (!p.s.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.s.visible = false;
        continue;
      }
      if (p.age < 0) {
        p.s.scale.setScalar(0.001);
        continue;
      }
      const t = p.age / p.life;
      let sc: number;
      if (p.kind === 'burst') {
        // Snap open in ~2 frames, overshoot, then shrink away.
        sc = t < 0.15 ? 0.5 + (t / 0.15) * 0.7 : 1.2 - (t - 0.15) * 0.75;
        p.m.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      } else {
        // Twinkle: pop up, hold, pinch shut.
        sc = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (t < 0.5 ? 1 : 0.85 + 0.15 * Math.cos(p.age * 50));
        p.m.opacity = 1;
      }
      p.m.rotation += p.spin * dt;
      p.s.scale.setScalar(Math.max(0.001, sc * p.size));
      if (p.follow >= 0) {
        const b = racers[p.follow]?.boat;
        if (b) p.s.position.set(b.position.x + p.ox, b.position.y + p.oy + t * 0.6, b.position.z + p.oz);
      }
    }
    for (const p of this.rings) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.mesh.visible = false;
        continue;
      }
      const t = p.age / p.life;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      p.mesh.scale.setScalar(Math.max(0.001, p.size * (0.25 + 0.75 * e)));
      (p.mesh.material as MeshBasicMaterial).opacity = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    }
    for (const p of this.crowns) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.mesh.visible = false;
        continue;
      }
      const t = p.age / p.life;
      const e = 1 - (1 - t) * (1 - t);
      const r = p.size * (0.55 + 0.75 * e);
      const h = p.height * Math.max(0.02, Math.sin(Math.PI * Math.min(1, t * 1.1)));
      p.mesh.scale.set(r, h, r);
      // The chase camera drives through the player's own landing spot: fade the
      // crown out before the lens ends up inside it.
      const dc = Math.hypot(p.mesh.position.x - cam.x, p.mesh.position.z - cam.z);
      const near = smoothstep(r * 1.3 + 1, r * 1.3 + 7, dc);
      (p.mesh.material as ShaderMaterial).uniforms.uOpacity.value = (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3) * near;
    }
  }

  dispose() {
    for (const p of this.sprites) p.m.dispose();
    for (const p of this.rings) (p.mesh.material as MeshBasicMaterial).dispose();
    for (const p of this.crowns) (p.mesh.material as ShaderMaterial).dispose();
    this.group.removeFromParent();
  }
}

export interface Rumble {
  strong: number;
  weak: number;
  ms: number;
}

export class FxDirector {
  /** Rumble request for this frame (consumed by input). */
  rumble: Rumble = { strong: 0, weak: 0, ms: 0 };
  private flash = 0;
  private chromaPulse = 0;
  private radialPulse = 0;
  private drops = 0;
  private damage = 0;
  private impact = 0;
  /** Golden Surge camera punch (decays). */
  private surgeKick = 0;
  private boostColors: Color[];
  private pops = new AnimePops();
  private glow = new DriftGlow(16);
  /** 3–4 player split-screen: treat every human's boat like the player's for emission. */
  splitHumans = false;

  constructor(
    private session: RaceSession,
    private particles: Particles,
    private visuals: BoatVisual[],
    private emitters: Emitter[],
  ) {
    this.boostColors = session.racers.map((r) => new Color(r.livery.boost));
  }

  /** Energy flares at the stern corners while a drift charges. */
  private driftGlow(i: number, b: { position: { x: number; z: number }; surfaceY: number; spec: { beam: number } }, tier: number, fx: number, fz: number, rx: number, rz: number, L: number) {
    void i;
    const flick = 0.85 + Math.random() * 0.3;
    const size = (0.5 + tier * 0.35) * flick;
    for (const side of [-1, 1]) {
      this.glow.add(b.position.x - fx * L * 0.5 + rx * side * b.spec.beam * 0.5, b.surfaceY + 0.45, b.position.z - fz * L * 0.5 + rz * side * b.spec.beam * 0.5, size, TIER[tier]);
    }
  }

  update(dt: number, time: number, rig: CameraRig, renderer: Renderer, events: EventQueue, weatherRain: number) {
    const P = this.particles;
    const cam = rig.camera.position;
    // The pops group rides along with the particles (the world owns the scene).
    if (!this.pops.group.parent) this.particles.objects[0].parent?.add(this.pops.group);
    if (!this.glow.mesh.parent) this.particles.objects[0].parent?.add(this.glow.mesh);
    this.glow.begin(time);
    this.pops.update(dt, this.session, cam);
    this.rumble.strong = this.rumble.weak = this.rumble.ms = 0;

    // ── Continuous per-boat emission ──────────────────────────────────────────
    const racers = this.session.racers;
    for (let i = 0; i < racers.length; i++) {
      const b = racers[i].boat;
      // Every human's own boat keeps full effects (split-screen views follow them).
      const isPlayer = i === 0 || (this.splitHumans && racers[i].isPlayer);
      const dx = b.position.x - cam.x;
      const dz = b.position.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (!isPlayer && d2 > 170 * 170) continue;
      const lod = isPlayer ? 1 : d2 > 80 * 80 ? 0.35 : 0.7;
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const rx = -fz;
      const rz = fx;
      const speed = b.speed;
      const sp = clamp01(speed / 32);
      const L = b.spec.length;
      const floor = b.surfaceY - 0.2;
      const inWater = !b.airborne && b.wet > 0.2;

      if (inWater && speed > 6) {
        // Rooster tail.
        const tailRate = (14 + 44 * sp * sp + 34 * b.boostLevel) * lod;
        let n = P.count(tailRate, dt);
        const nx = b.position.x - fx * L * 0.52;
        const nz = b.position.z - fz * L * 0.52;
        for (let k = 0; k < n; k++) {
          const up = 3 + speed * 0.28 + Math.random() * 3;
          const back = speed * (0.35 + Math.random() * 0.2);
          const spread = (Math.random() - 0.5) * 2.4;
          P.emit('spray', nx, b.surfaceY + 0.1, nz, b.velocity.x - fx * back + rx * spread, up, b.velocity.z - fz * back + rz * spread, WHITE, 1, 0.85 + sp * 0.6, floor);
        }
        // Bow spray, both sides.
        n = P.count((6 + 18 * sp) * lod, dt);
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 1 : -1;
          const bx = b.position.x + fx * L * 0.3 + rx * side * b.spec.beam * 0.5;
          const bz = b.position.z + fz * L * 0.3 + rz * side * b.spec.beam * 0.5;
          const out = 2 + speed * 0.13;
          P.emit('spray', bx, b.surfaceY + 0.15, bz, b.velocity.x * 0.55 + rx * side * out, 1.8 + speed * 0.09 + Math.random() * 1.5, b.velocity.z * 0.55 + rz * side * out, WHITE, 0.8, 0.6 + sp * 0.5, floor);
        }
        // High-speed mist hanging behind.
        if (speed > 20) {
          n = P.count(3 * lod * sp, dt);
          for (let k = 0; k < n; k++) P.emit('mist', b.position.x - fx * L, b.surfaceY + 0.8, b.position.z - fz * L, b.velocity.x * 0.2, 0.5, b.velocity.z * 0.2, MIST, 1, 1 + sp);
        }
        // Drift: a wall of spray off the outside of the slide, tinted by tier.
        if (b.drifting) {
          const outX = -rx * b.driftDir;
          const outZ = -rz * b.driftDir;
          n = P.count((30 + 15 * b.driftTier) * lod, dt);
          _c.copy(WHITE).lerp(TIER[b.driftTier], b.driftTier ? 0.45 : 0);
          for (let k = 0; k < n; k++) {
            const along = (Math.random() - 0.3) * L * 0.8;
            const sx = b.position.x + fx * along + outX * b.spec.beam * 0.55;
            const sz = b.position.z + fz * along + outZ * b.spec.beam * 0.55;
            const out = 4 + speed * 0.22 + Math.random() * 3;
            P.emit('spray', sx, b.surfaceY + 0.2, sz, b.velocity.x * 0.35 + outX * out, 3 + Math.random() * 4, b.velocity.z * 0.35 + outZ * out, _c, 1, 0.95 + sp * 0.6, floor);
          }
          if (b.driftTier > 0) {
            // Sparks grow with the tier: small blue → bigger orange → large purple,
            // thrown from both stern corners and scaled by speed.
            const tierK = b.driftTier;
            n = P.count((16 + 18 * tierK) * lod * (0.6 + sp * 0.6), dt);
            const size = 1.3 + 0.55 * tierK;
            for (let k = 0; k < n; k++) {
              const side = k & 1 ? 1 : -1;
              const cx = b.position.x - fx * L * 0.5 + rx * side * b.spec.beam * 0.45 + outX * 0.3;
              const cz = b.position.z - fz * L * 0.5 + rz * side * b.spec.beam * 0.45 + outZ * 0.3;
              const spd = 3 + tierK * 1.6;
              P.emit('spark', cx, b.surfaceY + 0.35, cz, outX * spd + (Math.random() - 0.5) * spd - fx * 2, 1.5 + Math.random() * (2 + tierK), outZ * spd + (Math.random() - 0.5) * spd - fz * 2, TIER[tierK], 1, size);
            }
            this.driftGlow(i, b, tierK, fx, fz, rx, rz, L);
          }
        }
      }
      // Boost exhaust.
      if (b.boostLevel > 0.05) {
        const n = P.count(70 * b.boostLevel * lod, dt);
        const ex = b.position.x - fx * (L * 0.5 + 0.4);
        const ez = b.position.z - fz * (L * 0.5 + 0.4);
        for (let k = 0; k < n; k++) {
          // Two flat tones, cel style: a tight white-hot core inside a fat livery-coloured flame.
          const core = k % 3 === 0;
          const sprd = core ? 0.8 : 2.4;
          P.emit('boost', ex, b.position.y + 0.1, ez, b.velocity.x * 0.6 - fx * (core ? 6 : 8) + (Math.random() - 0.5) * sprd, (Math.random() - 0.3) * sprd, b.velocity.z * 0.6 - fz * (core ? 6 : 8) + (Math.random() - 0.5) * sprd, core ? WHITE : b.surge > 0 ? GOLD : this.boostColors[i], core ? 0.7 : 1, core ? 0.7 + 0.5 * b.boostLevel : 1.3 + b.boostLevel);
        }
      }
      // Golden Surge: a halo of gold sparks streaming off the hull.
      if (b.surge > 0) {
        const n = P.count(46 * lod, dt);
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const rr = b.spec.beam * 0.6 + Math.random() * 0.8;
          P.emit('spark', b.position.x + Math.cos(a) * rr, b.position.y + 0.3 + Math.random() * 1.6, b.position.z + Math.sin(a) * rr, b.velocity.x * 0.7 + Math.cos(a) * 1.5, 1.5 + Math.random() * 2.5, b.velocity.z * 0.7 + Math.sin(a) * 1.5, k % 3 === 0 ? GOLD_HOT : GOLD, 1.1, 1.4);
        }
      }
      // Storm Call shrink: dizzy stars circling over the rider.
      if (b.shrink > 0) {
        const n = P.count(22 * lod, dt);
        for (let k = 0; k < n; k++) {
          const a = time * 7 + k * 2.1 + i;
          P.emit('spark', b.position.x + Math.cos(a) * 0.9, b.position.y + 1.7 + Math.sin(time * 9 + k) * 0.15, b.position.z + Math.sin(a) * 0.9, b.velocity.x, 9.8 * 0.35, b.velocity.z, k % 2 ? DIZZY : STORM, 0.6, 1.6);
        }
      }
      // Water streaming off the hull right after take-off.
      if (b.airborne && b.airTime < 0.6) {
        const n = P.count(40 * lod, dt);
        for (let k = 0; k < n; k++) {
          P.emit('drop', b.position.x + (Math.random() - 0.5) * b.spec.beam, b.position.y - 0.2, b.position.z + (Math.random() - 0.5) * L, b.velocity.x * 0.9, b.velocity.y * 0.7, b.velocity.z * 0.9, WHITE, 1, 1, b.surfaceY - 0.3);
        }
      }
      // Wipeout tumble spray.
      if (b.wipeout > 0 && inWater) {
        const n = P.count(60 * lod, dt);
        for (let k = 0; k < n; k++) P.emit('splash', b.position.x, b.surfaceY + 0.2, b.position.z, (Math.random() - 0.5) * 8, 3 + Math.random() * 4, (Math.random() - 0.5) * 8, WHITE, 1, 1, floor);
      }
      // Damaged hulls trail smoke from the engine.
      if (b.damage > 0.35) {
        const n = P.count((b.damage - 0.3) * 14 * lod, dt);
        for (let k = 0; k < n; k++) P.emit('smoke', b.position.x - fx * L * 0.45, b.position.y + 0.6, b.position.z - fz * L * 0.45, b.velocity.x * 0.3 + (Math.random() - 0.5), 1.5 + Math.random(), b.velocity.z * 0.3 + (Math.random() - 0.5), SMOKE, 0.6, 0.5 + b.damage * 0.5);
      }
      // Celebrate / ghost visuals.
      if (this.visuals[i]) this.visuals[i].celebrate = racers[i].finished && this.session.phase !== 'racing';
    }

    // ── Item projectiles: torpedo wakes, seeker smoke + skim spray ───────────
    const items = this.session.items;
    if (items) {
      for (const t of items.torpedoes) {
        if (!t.alive) continue;
        if ((t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 > 150 * 150) continue;
        const sy = oceanHeight(t.x, t.z, time);
        const sp = Math.hypot(t.vx, t.vz) || 1;
        const n = P.count(50, dt);
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 1 : -1;
          P.emit('spray', t.x - (t.vx / sp) * 1.2, sy + 0.1, t.z - (t.vz / sp) * 1.2, -t.vx * 0.08 + (t.vz / sp) * side * 2.5, 1.5 + Math.random() * 2, -t.vz * 0.08 - (t.vx / sp) * side * 2.5, WHITE, 0.7, 0.6, sy - 0.2);
        }
        if (P.count(6, dt)) P.emit('ripple', t.x, sy + 0.05, t.z, 0, 1.2, 0, MIST, 1, 1.2);
      }
      for (const m of items.missiles) {
        if (!m.alive) continue;
        const sp = Math.hypot(m.vx, m.vy, m.vz) || 1;
        const bx = m.x - (m.vx / sp) * 2;
        const by = m.y - (m.vy / sp) * 2;
        const bz = m.z - (m.vz / sp) * 2;
        let n = P.count(40, dt);
        for (let k = 0; k < n; k++) P.emit('smoke', bx, by, bz, (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2, k % 3 === 0 ? MISSILE_FIRE : MIST, 0.35, 0.45);
        n = P.count(30, dt);
        for (let k = 0; k < n; k++) P.emit('boost', bx, by, bz, -m.vx * 0.05 + (Math.random() - 0.5), Math.random() - 0.5, -m.vz * 0.05 + (Math.random() - 0.5), MISSILE_FIRE, 0.4, 0.8);
        // Skimming low: it tears a spray line out of the sea.
        const sy = oceanHeight(m.x, m.z, time);
        if (m.y - sy < 2.2) {
          n = P.count(60, dt);
          for (let k = 0; k < n; k++) {
            const side = k % 2 ? 1 : -1;
            P.emit('spray', bx, sy + 0.1, bz, (m.vz / sp) * side * 4, 2 + Math.random() * 3, -(m.vx / sp) * side * 4, WHITE, 0.6, 0.7, sy - 0.2);
          }
        }
      }
    }

    // ── Ambient world emitters near the camera ──────────────────────────────
    for (const e of this.emitters) {
      const far = Math.hypot(e.x - cam.x, e.z - cam.z);
      if (e.kind !== 'smoke' && far > 500) continue;
      const n = P.count(e.rate, dt);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * e.radius;
        const x = e.x + Math.cos(a) * r;
        const z = e.z + Math.sin(a) * r;
        if (e.kind === 'smoke') P.emit('smoke', x, e.y, z, 2 + Math.random() * 2, 3 + Math.random() * 3, 1 + Math.random(), SMOKE, 1, 2.5);
        else if (e.kind === 'steam') P.emit('steam', x, e.y, z, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5, STEAM);
        else if (e.kind === 'mist') P.emit('mist', x, e.y + Math.random() * 2, z, (Math.random() - 0.5) * 3, 0.8 + Math.random(), (Math.random() - 0.5) * 3, MIST, 1.4, 1.5);
        else P.emit('ember', x, e.y + Math.random(), z, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5, EMBER);
      }
    }
    // Theme ambience around the lens.
    const theme = this.session.track.def.theme;
    if (theme === 'tropical' && weatherRain === 0) {
      // Sunlit motes near islands.
      let nearIsland = false;
      for (const is of this.session.layout.islands) if (Math.hypot(is.x - cam.x, is.z - cam.z) < is.r + 90) nearIsland = true;
      if (nearIsland) {
        const n = P.count(14, dt);
        for (let k = 0; k < n; k++) P.emit('dust', cam.x + (Math.random() - 0.5) * 40, cam.y + (Math.random() - 0.3) * 8, cam.z + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6, DUST);
      }
    } else if (theme === 'arctic') {
      // Snow drifting past the lens.
      const n = P.count(40, dt);
      for (let k = 0; k < n; k++) P.emit('ash', cam.x + (Math.random() - 0.5) * 60, cam.y + Math.random() * 16 - 2, cam.z + (Math.random() - 0.5) * 60, 0.6 + Math.random() * 0.6, -1.2, 0.3, SNOW, 1.4, 1.1);
    } else if (theme === 'jungle' && weatherRain === 0) {
      const n = P.count(10, dt);
      for (let k = 0; k < n; k++) P.emit('dust', cam.x + (Math.random() - 0.5) * 40, cam.y + (Math.random() - 0.3) * 8, cam.z + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4, POLLEN);
    } else if (theme === 'volcanic') {
      const n = P.count(30, dt);
      for (let k = 0; k < n; k++) {
        const ember = Math.random() < 0.25;
        P.emit(ember ? 'ember' : 'ash', cam.x + (Math.random() - 0.5) * 50, cam.y + Math.random() * 14 - 2, cam.z + (Math.random() - 0.5) * 50, 0.8 + Math.random(), ember ? 0.5 : -0.2, 0.4, ember ? EMBER : ASH, ember ? 0.7 : 1, ember ? 0.6 : 1);
      }
    }
    if (weatherRain > 0) {
      // Spindrift: spray torn off crests blowing across the water.
      const n = P.count(10, dt);
      for (let k = 0; k < n; k++) {
        const x = cam.x + (Math.random() - 0.5) * 70;
        const z = cam.z + (Math.random() - 0.5) * 70;
        P.emit('spindrift', x, oceanHeight(x, z, time) + 0.6, z, 6 + Math.random() * 3, 0.4, 3 + Math.random() * 2, MIST);
      }
    }
    // Rain hitting the water around the camera.
    if (weatherRain > 0) {
      const n = P.count(160 * weatherRain, dt);
      for (let k = 0; k < n; k++) {
        const x = cam.x + (Math.random() - 0.5) * 50;
        const z = cam.z + (Math.random() - 0.5) * 50;
        P.emit('ripple', x, oceanHeight(x, z, time) + 0.05, z, 0, 1.2, 0, MIST, 1, 1);
      }
    }

    // ── Events ──────────────────────────────────────────────────────────────
    this.glow.end();
    const list = events.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mine = e.racer === 0;
      const near = (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2 < 140 * 140 || (this.splitHumans && e.racer > 0 && !!this.session.racers[e.racer]?.isPlayer);
      switch (e.type) {
        case 'land': {
          if (!near && !mine) break;
          const n = Math.round((16 + 56 * e.value) * this.particles.density);
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const out = 3 + Math.random() * 5 * (0.5 + e.value);
            P.emit('splash', e.x + Math.cos(a) * 1.2, e.y + 0.2, e.z + Math.sin(a) * 1.2, Math.cos(a) * out, 3 + e.value * 9 * Math.random(), Math.sin(a) * out, WHITE, 1, 1 + e.value, e.y - 0.3);
          }
          // Cartoon splash crown, with droplets flicked off its spike tips.
          const cr = 1.3 + e.value * 1.4;
          const ch = 1.2 + e.value * 3.4;
          // Wave hops land constantly: only real landings get a crown, and never one
          // wrapped around the lens.
          const camD2 = (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2;
          const tips = e.value > 0.15 && camD2 > (cr * 1.5 + 3) ** 2 ? Math.round(10 + 8 * e.value) : 0;
          if (tips) this.pops.crown(e.x, e.y - 0.15, e.z, cr, ch);
          for (let k = 0; k < tips; k++) {
            const a = (k / tips) * Math.PI * 2;
            const out = 2.5 + e.value * 3;
            P.emit('drop', e.x + Math.cos(a) * cr * 1.3, e.y + ch * 0.6, e.z + Math.sin(a) * cr * 1.3, Math.cos(a) * out, 4 + e.value * 6, Math.sin(a) * out, WHITE, 1.2, 2.2 + e.value * 1.5, e.y - 0.3);
          }
          // Flat white puffs.
          for (let k = 0; k < 4; k++) P.emit('steam', e.x + (Math.random() - 0.5) * 2, e.y + 0.6, e.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, 1.5, (Math.random() - 0.5) * 4, WHITE, 0.28, 0.3 + e.value * 0.25);
          if (e.value > 0.2) this.pops.ring(e.x, e.y + 0.12, e.z, 6 + e.value * 9);
          if (e.value > 0.35 && (mine || e.value > 0.6)) this.pops.burst(e.x, e.y + 0.7, e.z, 1.6 + e.value * 2.2);
          if (mine) {
            if (e.value > 0.55) this.impact = 1;
            rig.addTrauma(0.15 + 0.45 * e.value);
            if (e.value > 0.35) this.drops = Math.max(this.drops, 0.6 + e.value * 0.4);
            this.addRumble(0.3 + 0.6 * e.value, 0.4, 180);
            if (e.text === 'clean') {
              this.flash = Math.max(this.flash, 0.12);
              this.chromaPulse = Math.max(this.chromaPulse, 0.6);
            }
          }
          break;
        }
        case 'splash': {
          if (!near && !mine) break;
          if (e.text === 'hop') {
            // Drift hop: a light lift-off spritz, no camera hit.
            for (let k = 0; k < 10; k++) P.emit('splash', e.x, e.y + 0.2, e.z, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 4, WHITE, 0.6, 0.7, e.y - 0.3);
            if (mine) this.addRumble(0.04, 0.22, 50);
            break;
          }
          const n = Math.round(24 * this.particles.density * (0.5 + e.value));
          for (let k = 0; k < n; k++) P.emit('splash', e.x, e.y + 0.3, e.z, (Math.random() - 0.5) * 6, 3 + Math.random() * 6 * e.value, (Math.random() - 0.5) * 6, WHITE, 1, 1 + e.value, e.y - 0.3);
          if (mine) {
            rig.addTrauma(0.12 * e.value + 0.05);
            this.drops = Math.max(this.drops, 0.5 * e.value + 0.2);
            this.addRumble(0.25, 0.5, 120);
          }
          break;
        }
        case 'collide': {
          if (!near && !mine && e.text !== '0') break;
          const hard = e.text === 'rock' || e.text === 'pile' || e.text === 'island' || e.text === 'mine';
          const n = Math.round(30 * (0.4 + e.value) * this.particles.density);
          for (let k = 0; k < n; k++) P.emit('splash', e.x, e.y + 0.3, e.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8, WHITE, 1, 1, e.y - 1);
          if (hard) for (let k = 0; k < 16; k++) P.emit('spark', e.x, e.y + 0.6, e.z, (Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10, SPARK);
          if (e.text === 'mine') {
            for (let k = 0; k < 40; k++) P.emit('ember', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 14, Math.random() * 12, (Math.random() - 0.5) * 14, EMBER, 0.5, 2.5);
            for (let k = 0; k < 10; k++) P.emit('smoke', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4, SMOKE, 0.3, 0.4);
          }
          const involvesPlayer = mine || e.text === '0';
          if (e.value > 0.3 && (involvesPlayer || e.value > 0.5 || hard)) this.pops.burst(e.x, e.y + 1, e.z, 2 + e.value * 2.5);
          if (involvesPlayer) {
            if (e.value > 0.6 || (hard && e.value > 0.35)) this.impact = 1;
            rig.addTrauma(0.25 + 0.6 * e.value);
            this.damage = Math.max(this.damage, e.value * 0.8);
            if (e.text === 'mine') {
              this.flash = Math.max(this.flash, 0.5);
              renderer.fx.flashColor.setRGB(1, 0.55, 0.25);
            }
            this.addRumble(0.5 + 0.5 * e.value, 0.6, 220);
          }
          break;
        }
        case 'wipeout':
          if (mine) {
            rig.addTrauma(0.7);
            this.drops = 1;
            this.addRumble(1, 1, 350);
          }
          break;
        case 'driftTier':
          if (near || mine) {
            for (let k = 0; k < 26; k++) P.emit('spark', e.x, e.y + 0.6, e.z, (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, TIER[e.value], 1, 1.6);
            this.pops.sparkles(e.racer, e.x, e.y, e.z, 3, 1.8, TIER[e.value]);
          }
          // Each new tier pulses harder than the last.
          if (mine) this.addRumble(0.08 + 0.12 * e.value, 0.3 + 0.15 * e.value, 60 + 30 * e.value);
          break;
        case 'driftStart': {
          // The hull snaps into the slide: a short white spark pop off the stern.
          if (!near && !mine) break;
          const b = this.session.racers[e.racer]?.boat;
          if (!b) break;
          const fx = Math.sin(b.heading);
          const fz = Math.cos(b.heading);
          const ox = Math.cos(b.heading) * e.value; // outside of the slide
          const oz = -Math.sin(b.heading) * e.value;
          const sx = b.position.x - fx * b.spec.length * 0.45;
          const sz = b.position.z - fz * b.spec.length * 0.45;
          for (let k = 0; k < 16; k++) {
            const sp2 = 4 + Math.random() * 4;
            P.emit('spark', sx, e.y + 0.4, sz, ox * sp2 + (Math.random() - 0.5) * 4 - fx * 2, 1 + Math.random() * 3, oz * sp2 + (Math.random() - 0.5) * 4 - fz * 2, WHITE, 0.45, 1.3);
          }
          this.pops.burst(sx + ox * 0.6, e.y + 0.55, sz + oz * 0.6, mine ? 1.1 : 0.9);
          if (mine) this.addRumble(0.12, 0.3, 60);
          break;
        }
        case 'waveLand':
          if ((near || mine) && e.racer >= 0) this.pops.sparkles(e.racer, e.x, e.y, e.z, mine ? 6 : 3, 2, TIER[1]);
          if (mine) {
            rig.kickFov(2);
            this.addRumble(0.15, 0.5, 120);
          }
          break;
        case 'boostStart':
        case 'nitro':
        case 'boostPad':
        case 'perfectStart':
          // Mini-turbo release: a burst that scales with the drift tier.
          if (e.type === 'boostStart' && e.value >= 1 && (mine || near)) {
            const tc = TIER[Math.min(3, e.value)];
            const cnt = 18 + e.value * 14;
            for (let k = 0; k < cnt; k++) {
              const a = (k / cnt) * Math.PI * 2;
              const sp2 = 5 + e.value * 2 + Math.random() * 3;
              P.emit('spark', e.x, e.y + 0.5, e.z, Math.cos(a) * sp2, 1.5 + Math.random() * 3, Math.sin(a) * sp2, tc, 1, 1.4 + e.value * 0.4);
            }
            for (let k = 0; k < 10 + e.value * 6; k++) {
              const a = Math.random() * Math.PI * 2;
              P.emit('splash', e.x, e.y + 0.2, e.z, Math.cos(a) * 4, 3 + Math.random() * 3, Math.sin(a) * 4, WHITE, 1, 0.8 + e.value * 0.15, e.y - 0.3);
            }
            if (mine) {
              rig.addTrauma(0.08 + 0.05 * e.value);
              rig.kickFov(2.5 + 2.2 * e.value);
              this.addRumble(0.25 + 0.15 * e.value, 0.6, 140 + 60 * e.value);
            }
          }
          if ((mine || near) && e.racer >= 0) {
            const c = _c.copy(this.boostColors[e.racer] ?? WHITE).lerp(WHITE, 0.35);
            this.pops.sparkles(e.racer, e.x, e.y, e.z, mine ? 8 : 4, mine ? 2.4 : 2, c);
          }
          if (mine) {
            this.flash = Math.max(this.flash, e.type === 'boostStart' ? 0.08 + 0.05 * e.value : 0.14);
            renderer.fx.flashColor.copy(this.boostColors[0]);
            this.chromaPulse = Math.max(this.chromaPulse, 1);
            this.radialPulse = Math.max(this.radialPulse, 0.8);
            rig.addTrauma(0.12);
            this.addRumble(0.2, 0.7, 200);
          }
          break;
        case 'trick':
          if (near || mine) {
            for (let k = 0; k < 30; k++) P.emit('spark', e.x, e.y, e.z, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, CONFETTI[k % CONFETTI.length], 1, 1.5);
          }
          break;
        case 'ring':
          for (let k = 0; k < 40; k++) {
            const a = (k / 40) * Math.PI * 2;
            P.emit('spark', e.x + Math.cos(a) * 3.5, e.y + Math.sin(a) * 3.5, e.z, Math.cos(a) * 6, Math.sin(a) * 6, 0, CONFETTI[2], 1, 1.4);
          }
          if (mine) this.addRumble(0.1, 0.5, 100);
          break;
        case 'buoyHit':
          if (near) for (let k = 0; k < 10; k++) P.emit('splash', e.x, e.y + 0.3, e.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, WHITE, 0.7, 0.7, e.y - 0.3);
          break;
        case 'finish':
          if (mine) {
            for (let k = 0; k < 220; k++) {
              const c = CONFETTI[k % CONFETTI.length];
              P.emit('confetti', e.x + (Math.random() - 0.5) * 6, e.y + 4 + Math.random() * 3, e.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12, 4 + Math.random() * 8, (Math.random() - 0.5) * 12, c, 1, 1);
            }
            this.flash = 0.3;
            renderer.fx.flashColor.setRGB(1, 1, 1);
          }
          break;
        case 'reset':
          if (mine) this.flash = Math.max(this.flash, 0.2);
          break;
        case 'itemPickup':
          if (near || mine) for (let k = 0; k < 24; k++) P.emit('spark', e.x, e.y + 1.2, e.z, (Math.random() - 0.5) * 7, Math.random() * 6, (Math.random() - 0.5) * 7, CONFETTI[k % CONFETTI.length], 1, 1.3);
          if (mine) this.addRumble(0.1, 0.4, 80);
          break;
        case 'itemUse':
          if (e.text === 'storm') {
            // The whole sky cracks: a brief cold flash for everyone (toned down by reduced motion).
            this.flash = Math.max(this.flash, 0.55 * (0.3 + 0.7 * renderer.motionFx));
            renderer.fx.flashColor.setRGB(0.75, 0.88, 1);
            if (mine) this.pops.sparkles(e.racer, e.x, e.y, e.z, 8, 2.4, STORM);
          }
          if (e.text === 'surge' && e.racer >= 0 && (mine || near)) {
            this.pops.sparkles(e.racer, e.x, e.y, e.z, mine ? 9 : 5, 2.6, GOLD);
            for (let k = 0; k < 30; k++) P.emit('spark', e.x, e.y + 0.6, e.z, (Math.random() - 0.5) * 9, 1 + Math.random() * 5, (Math.random() - 0.5) * 9, k % 2 ? GOLD : GOLD_HOT, 1, 1.8);
            if (mine) {
              this.surgeKick = 1;
              this.flash = Math.max(this.flash, 0.16);
              renderer.fx.flashColor.copy(GOLD);
              this.chromaPulse = Math.max(this.chromaPulse, 1);
              this.radialPulse = Math.max(this.radialPulse, 1);
              rig.addTrauma(0.22);
              this.addRumble(0.35, 0.8, 180);
            }
          }
          if (e.text === 'homer' && (mine || near)) {
            for (let k = 0; k < 40; k++) P.emit('splash', e.x, e.y + 0.3, e.z, (Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8, WHITE, 1, 1.2, e.y - 1);
            for (let k = 0; k < 16; k++) P.emit('smoke', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4, MIST, 0.6, 0.8);
            if (mine) rig.addTrauma(0.25);
          }
          if ((e.text === 'torpedo' || e.text === 'torpedo3') && mine) {
            rig.addTrauma(0.1);
            this.addRumble(0.2, 0.5, 100);
          }
          if (mine && e.text === 'wave') {
            rig.addTrauma(0.35);
            this.radialPulse = 1;
          }
          if ((near || mine) && e.text === 'wave') for (let k = 0; k < 90; k++) {
            const a = (k / 90) * Math.PI * 2;
            P.emit('splash', e.x + Math.cos(a) * 3, e.y, e.z + Math.sin(a) * 3, Math.cos(a) * 16, 4 + Math.random() * 5, Math.sin(a) * 16, WHITE, 1, 1.4, e.y - 1);
          }
          break;
        case 'itemHit': {
          if (!near && !mine) break;
          if (e.text === 'storm') {
            // Zapped and shrunk: a pop, a ring of static, dizzy sparkles.
            this.pops.burst(e.x, e.y + 1.4, e.z, 2.6);
            if (e.racer >= 0) this.pops.sparkles(e.racer, e.x, e.y, e.z, 6, 1.6, DIZZY);
            for (let k = 0; k < 26; k++) P.emit('spark', e.x, e.y + 1.5, e.z, (Math.random() - 0.5) * 10, 2 + Math.random() * 6, (Math.random() - 0.5) * 10, STORM, 1, 1.6);
            if (mine) {
              rig.addTrauma(0.35);
              this.chromaPulse = Math.max(this.chromaPulse, 1);
              this.addRumble(0.5, 0.9, 260);
            }
            break;
          }
          if (e.text === 'homer' || e.text === 'homer-miss') {
            // Seeker detonation: a tall column of sea, a fireball and a shock ring.
            const hitBoat = e.text === 'homer';
            const sy = e.racer >= 0 ? this.session.racers[e.racer].boat.surfaceY : e.y;
            const n = Math.round((hitBoat ? 140 : 80) * this.particles.density);
            for (let k = 0; k < n; k++) {
              const a = (k / n) * Math.PI * 2;
              const out = 3 + Math.random() * 8;
              P.emit('splash', e.x + Math.cos(a), sy + 0.3, e.z + Math.sin(a), Math.cos(a) * out, 8 + Math.random() * 14, Math.sin(a) * out, WHITE, 1.2, 1.6, sy - 1);
            }
            for (let k = 0; k < (hitBoat ? 46 : 20); k++) P.emit('ember', e.x, sy + 1.5, e.z, (Math.random() - 0.5) * 16, Math.random() * 14, (Math.random() - 0.5) * 16, EMBER, 0.7, 2.6);
            for (let k = 0; k < 14; k++) P.emit('smoke', e.x, sy + 2, e.z, (Math.random() - 0.5) * 5, 3 + Math.random() * 2, (Math.random() - 0.5) * 5, SMOKE, 0.5, 0.7);
            this.pops.crown(e.x, sy - 0.15, e.z, hitBoat ? 3.2 : 2.4, hitBoat ? 7.5 : 5);
            this.pops.ring(e.x, sy + 0.12, e.z, hitBoat ? 22 : 15);
            this.pops.burst(e.x, sy + 2, e.z, hitBoat ? 5.5 : 3.5);
            if (mine) {
              this.impact = 1;
              rig.addTrauma(0.95);
              this.damage = Math.max(this.damage, 1);
              this.drops = 1;
              this.flash = Math.max(this.flash, 0.45 * (0.4 + 0.6 * renderer.motionFx));
              renderer.fx.flashColor.setRGB(1, 0.6, 0.3);
              this.addRumble(1, 1, 450);
            } else if ((e.x - cam.x) ** 2 + (e.z - cam.z) ** 2 < 60 * 60) rig.addTrauma(0.3);
            break;
          }
          const big = e.text === 'torpedo' || e.text === 'splash';
          for (let k = 0; k < (big ? 60 : 24); k++) P.emit('splash', e.x, e.y + 0.3, e.z, (Math.random() - 0.5) * 10, 3 + Math.random() * (big ? 10 : 4), (Math.random() - 0.5) * 10, WHITE, 1, 1.3, e.y - 1);
          if (big) for (let k = 0; k < 24; k++) P.emit('ember', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 12, Math.random() * 10, (Math.random() - 0.5) * 12, EMBER, 0.5, 2);
          if (mine) {
            rig.addTrauma(0.6);
            this.damage = Math.max(this.damage, 0.7);
            this.addRumble(0.9, 0.8, 300);
          }
          break;
        }
        case 'itemMiss':
          if (e.text === 'dodge' && e.racer >= 0 && (near || mine)) this.pops.sparkles(e.racer, e.x, e.y, e.z, 6, 2.2, TIER[1]);
          break;
        case 'shieldHit':
          if (near || mine) for (let k = 0; k < 40; k++) P.emit('spark', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 12, Math.random() * 8, (Math.random() - 0.5) * 12, TIER[1], 1, 1.5);
          if (mine) {
            this.flash = Math.max(this.flash, 0.25);
            renderer.fx.flashColor.setRGB(0.4, 0.9, 1);
          }
          break;
        case 'collectible':
          for (let k = 0; k < 60; k++) P.emit('spark', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 8, (Math.random() - 0.5) * 8, CONFETTI[3], 1, 1.6);
          if (mine) {
            this.flash = Math.max(this.flash, 0.2);
            renderer.fx.flashColor.setRGB(0.5, 1, 0.7);
            this.addRumble(0.2, 0.6, 150);
          }
          break;
      }
    }

    // ── Screen FX ─────────────────────────────────────────────────────────────
    const pb = this.session.player.boat;
    const fx = renderer.fx;
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.chromaPulse = Math.max(0, this.chromaPulse - dt * 2.5);
    this.radialPulse = Math.max(0, this.radialPulse - dt * 2);
    this.drops = Math.max(0, this.drops - dt * 0.45);
    this.damage = Math.max(0, this.damage - dt * 1.6);
    fx.impact = this.impact;
    // Held for ~2 frames at 60 Hz, then gone: an impact frame, not a fade.
    this.impact = Math.max(0, this.impact - dt * 14);
    fx.flash = this.flash;
    const surging = pb.surge > 0 ? 1 : 0;
    this.surgeKick = Math.max(0, this.surgeKick - dt * 3);
    rig.fovKick = surging * 0.35 + this.surgeKick * 0.65;
    fx.speed = damp(fx.speed, Math.max(smoothstep(34, 46, pb.speed) * 0.6 + pb.boostLevel * 0.7, surging * 0.9), 5, dt);
    // Crisp image + speed lines reads more anime than heavy blur: keep blur/fringe light.
    fx.radial = Math.max(pb.boostLevel * 0.28, this.radialPulse * 0.4);
    fx.chroma = Math.max(pb.boostLevel * 0.35, this.chromaPulse * 0.6);
    fx.drops = this.drops + (weatherRain > 0 ? 0.25 : 0);
    fx.damage = this.damage;
    void _nz;
  }

  /** Releases the pop materials (geometry/textures are shared and cached). */
  dispose() {
    this.pops.dispose();
  }

  private addRumble(strong: number, weak: number, ms: number) {
    this.rumble.strong = Math.max(this.rumble.strong, strong);
    this.rumble.weak = Math.max(this.rumble.weak, weak);
    this.rumble.ms = Math.max(this.rumble.ms, ms);
  }
}
