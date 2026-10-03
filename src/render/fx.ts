/**
 * FX director — every visual "juice" response lives here. Reads boat state and
 * drains sim events; writes particles, camera trauma, screen effects and
 * gamepad rumble requests. Holds no gameplay state.
 */

import { Color, Vector3 } from 'three';
import { clamp01, damp, smoothstep } from '../core/mathx';
import type { EventQueue } from '../core/events';
import type { Particles } from '../particles/particles';
import type { CameraRig } from '../camera/cameraRig';
import type { Renderer } from './renderer';
import type { RaceSession } from '../race/session';
import type { Emitter } from '../environment/scenery';
import type { BoatVisual } from '../boat/boatMesh';
import { oceanHeight } from '../water/waves';

const WHITE = new Color(1, 1, 1);
const MIST = new Color(0.92, 0.96, 1);
const SPARK = new Color(1, 0.75, 0.3);
const SMOKE = new Color(0.22, 0.2, 0.22);
const STEAM = new Color(0.9, 0.92, 0.95);
const EMBER = new Color(1, 0.45, 0.1);
const DUST = new Color(1, 0.9, 0.6);
const ASH = new Color(0.35, 0.32, 0.33);
const TIER = [new Color(1, 1, 1), new Color(0.3, 0.75, 1), new Color(1, 0.55, 0.15), new Color(1, 0.3, 0.85)];
const CONFETTI = [new Color(1, 0.23, 0.36), new Color(0.16, 0.83, 1), new Color(1, 0.88, 0.3), new Color(0.65, 1, 0.24), new Color(0.48, 0.36, 1)];
const _c = new Color();
const _nz = new Vector3();

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
  private boostColors: Color[];

  constructor(
    private session: RaceSession,
    private particles: Particles,
    private visuals: BoatVisual[],
    private emitters: Emitter[],
  ) {
    this.boostColors = session.racers.map((r) => new Color(r.livery.boost));
  }

  update(dt: number, time: number, rig: CameraRig, renderer: Renderer, events: EventQueue, weatherRain: number) {
    const P = this.particles;
    const cam = rig.camera.position;
    this.rumble.strong = this.rumble.weak = this.rumble.ms = 0;

    // ── Continuous per-boat emission ──────────────────────────────────────────
    const racers = this.session.racers;
    for (let i = 0; i < racers.length; i++) {
      const b = racers[i].boat;
      const isPlayer = i === 0;
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
          P.emit('spray', nx, b.surfaceY + 0.1, nz, b.velocity.x - fx * back + rx * spread, up, b.velocity.z - fz * back + rz * spread, WHITE, 1, 0.7 + sp * 0.5, floor);
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
            P.emit('spray', sx, b.surfaceY + 0.2, sz, b.velocity.x * 0.35 + outX * out, 3 + Math.random() * 4, b.velocity.z * 0.35 + outZ * out, _c, 1, 0.8 + sp * 0.6, floor);
          }
          if (b.driftTier > 0) {
            n = P.count(28 * lod, dt);
            for (let k = 0; k < n; k++) {
              P.emit('spark', b.position.x - fx * L * 0.5 + outX * 0.6, b.surfaceY + 0.4, b.position.z - fz * L * 0.5 + outZ * 0.6, outX * 4 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, outZ * 4 + (Math.random() - 0.5) * 4, TIER[b.driftTier], 1, 1.4);
            }
          }
        }
      }
      // Boost exhaust.
      if (b.boostLevel > 0.05) {
        const n = P.count(70 * b.boostLevel * lod, dt);
        const ex = b.position.x - fx * (L * 0.5 + 0.4);
        const ez = b.position.z - fz * (L * 0.5 + 0.4);
        for (let k = 0; k < n; k++) {
          P.emit('boost', ex, b.position.y + 0.1, ez, b.velocity.x * 0.6 - fx * 8 + (Math.random() - 0.5) * 2, (Math.random() - 0.3) * 2, b.velocity.z * 0.6 - fz * 8 + (Math.random() - 0.5) * 2, this.boostColors[i], 1, 1 + b.boostLevel);
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
    const list = events.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mine = e.racer === 0;
      const near = (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2 < 140 * 140;
      switch (e.type) {
        case 'land': {
          if (!near && !mine) break;
          const n = Math.round((20 + 70 * e.value) * this.particles.density);
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const out = 3 + Math.random() * 5 * (0.5 + e.value);
            P.emit('splash', e.x + Math.cos(a) * 1.2, e.y + 0.2, e.z + Math.sin(a) * 1.2, Math.cos(a) * out, 3 + e.value * 9 * Math.random(), Math.sin(a) * out, WHITE, 1, 1 + e.value, e.y - 0.3);
          }
          for (let k = 0; k < 3; k++) P.emit('mist', e.x, e.y + 1, e.z, (Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4, MIST, 1, 2);
          if (mine) {
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
          if (involvesPlayer) {
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
          }
          if (mine) this.addRumble(0.1, 0.4, 80);
          break;
        case 'boostStart':
        case 'nitro':
        case 'boostPad':
        case 'perfectStart':
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
    fx.flash = this.flash;
    fx.speed = damp(fx.speed, smoothstep(34, 46, pb.speed) * 0.6 + pb.boostLevel * 0.7, 5, dt);
    fx.radial = Math.max(pb.boostLevel * 0.5, this.radialPulse * 0.6);
    fx.chroma = Math.max(pb.boostLevel * 0.7, this.chromaPulse);
    fx.drops = this.drops + (weatherRain > 0 ? 0.25 : 0);
    fx.damage = this.damage;
    void _nz;
  }

  private addRumble(strong: number, weak: number, ms: number) {
    this.rumble.strong = Math.max(this.rumble.strong, strong);
    this.rumble.weak = Math.max(this.rumble.weak, weak);
    this.rumble.ms = Math.max(this.rumble.ms, ms);
  }
}
