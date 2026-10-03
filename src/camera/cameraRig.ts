/**
 * Camera rig.
 *
 * Player modes: close chase, far chase, bow, cinematic (trackside), aerial.
 * Scripted modes: intro fly-by, finish orbit, menu/garage orbit.
 *
 * The chase cam is a spring on position and look target, both computed from a
 * blend of heading and velocity (so drifts are framed into the slide), with
 * speed/boost-driven FOV, lift in the air, a dip on landing, a small lean into
 * turns, and trauma-based shake. Every motion term is scaled by the comfort
 * settings, and the camera is clamped above the shared wave surface.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, clamp01, damp, lerp, noise1, smoothstep } from '../core/mathx';
import type { Boat } from '../boat/boat';
import type { Track, TrackPoint } from '../race/track';
import type { Ramp } from '../core/types';
import { oceanHeight } from '../water/waves';

export type CamMode = 'chase' | 'far' | 'bow' | 'cinematic' | 'aerial';
export const CAM_MODES: CamMode[] = ['chase', 'far', 'bow', 'cinematic', 'aerial'];
export const CAM_LABEL: Record<CamMode, string> = { chase: 'CLOSE CHASE', far: 'FAR CHASE', bow: 'BOW CAM', cinematic: 'CINEMATIC', aerial: 'AERIAL' };

type Scripted = 'none' | 'intro' | 'finish' | 'orbit';

const _fwd = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _right = new Vector3();
const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };

export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CamMode = 'chase';
  scripted: Scripted = 'none';
  /** Comfort settings. */
  shakeScale = 1;
  motionScale = 1;
  private pos = new Vector3(0, 5, -10);
  private look = new Vector3();
  private fov = 64;
  private roll = 0;
  private trauma = 0;
  private lift = 0;
  private dip = 0;
  private side = 0;
  private t = 0;
  private cineT = 0;
  private cinePos = new Vector3();
  private cineHas = false;
  private introT = 0;
  private orbitAngle = 0;
  orbitTarget = new Vector3();
  orbitRadius = 9;
  orbitHeight = 3;
  private snap = true;
  /** Solid ramps the camera must stay above. */
  ramps: readonly Ramp[] | null = null;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(64, aspect, 0.3, 5000);
  }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.cineHas = false;
    this.snap = this.mode === 'bow' || this.mode === 'aerial';
    return this.mode;
  }

  /** Teleport next frame instead of springing (race start, respawn). */
  cut() {
    this.snap = true;
    this.cineHas = false;
  }

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  startIntro() {
    this.scripted = 'intro';
    this.introT = 0;
    this.snap = true;
  }
  startFinish() {
    this.scripted = 'finish';
    this.orbitAngle = 0;
  }
  startOrbit(target: Vector3, radius: number, height: number) {
    this.scripted = 'orbit';
    this.orbitTarget.copy(target);
    this.orbitRadius = radius;
    this.orbitHeight = height;
  }
  endScripted() {
    if (this.scripted !== 'none') this.snap = true;
    this.scripted = 'none';
  }

  update(dt: number, boat: Boat, track: Track | null, time: number) {
    this.t += dt;
    const b = boat;
    const speed = b.speed;
    const sp01 = clamp01(speed / 34);
    const hx = Math.sin(b.heading);
    const hz = Math.cos(b.heading);
    // Look direction: heading blended toward velocity during slides.
    if (speed > 3) {
      const vx = b.velocity.x / speed;
      const vz = b.velocity.z / speed;
      const k = b.drifting ? 0.45 : 0.25;
      _fwd.set(lerp(hx, vx, k), 0, lerp(hz, vz, k)).normalize();
    } else _fwd.set(hx, 0, hz);
    _right.set(-_fwd.z, 0, _fwd.x);

    let fovT = 62 + sp01 * 9 * this.motionScale + b.boostLevel * 9 * this.motionScale;
    let rollT = 0;
    const posRate = 7;
    let lookRate = 12;

    // Shared dynamic offsets.
    this.lift = damp(this.lift, b.airborne ? clamp(b.clearance * 0.35, 0, 2.5) + 0.8 : 0, b.airborne ? 2.5 : 4, dt);
    const landK = b.sinceLand < 0.6 ? (1 - b.sinceLand / 0.6) * b.landStrength : 0;
    this.dip = damp(this.dip, -landK * 0.9, 14, dt);
    this.side = damp(this.side, b.drifting ? -b.driftDir * 1.3 : clamp(b.yawRate * 0.6, -1, 1), 3, dt);

    if (this.scripted === 'intro' && track) {
      // Sweeping fly-by from ahead of the grid to behind the player.
      this.introT += dt;
      const k = smoothstep(0, 3.2, this.introT);
      track.sample(30 - 60 * k, _tp);
      const lat = lerp(28, 6, k);
      _want.set(_tp.x - _tp.tz * lat, lerp(14, 4, k), _tp.z + _tp.tx * lat);
      _look.set(b.position.x, b.position.y + 1, b.position.z);
      fovT = lerp(50, 62, k);
      this.applyDirect(_want, _look, fovT, 0, dt, 3);
      return;
    }
    if (this.scripted === 'finish' || this.scripted === 'orbit') {
      const target = this.scripted === 'finish' ? b.position : this.orbitTarget;
      this.orbitAngle += dt * (this.scripted === 'finish' ? 0.35 : 0.18);
      const R = this.scripted === 'finish' ? 9 : this.orbitRadius;
      const H = this.scripted === 'finish' ? 3.2 : this.orbitHeight;
      const a = this.orbitAngle + (this.scripted === 'finish' ? b.heading + Math.PI * 0.75 : 0);
      _want.set(target.x + Math.sin(a) * R, target.y + H, target.z + Math.cos(a) * R);
      _look.set(target.x, target.y + 1.0, target.z);
      this.applyDirect(_want, _look, 52, 0, dt, this.scripted === 'finish' ? 3 : 2);
      return;
    }

    switch (this.mode) {
      case 'chase':
      case 'far': {
        const far = this.mode === 'far';
        const dist = (far ? 12.5 : 7.4) + sp01 * 1.4 + b.boostLevel * 1.1 * this.motionScale;
        const height = (far ? 4.6 : 2.5) + this.lift + this.dip;
        _want.set(b.position.x - _fwd.x * dist + _right.x * this.side, b.surfaceY + height + Math.max(0, b.position.y - b.surfaceY) * 0.6, b.position.z - _fwd.z * dist + _right.z * this.side);
        const ahead = far ? 9 : 7 + sp01 * 4;
        _look.set(b.position.x + _fwd.x * ahead, b.position.y + (far ? 0.6 : 1.1) + this.lift * 0.3, b.position.z + _fwd.z * ahead);
        rollT = clamp(-b.yawRate * 0.05, -0.06, 0.06) * this.motionScale;
        break;
      }
      case 'bow': {
        const L = b.spec.length;
        _want.set(b.position.x + hx * L * 0.15, b.position.y + 1.75, b.position.z + hz * L * 0.15);
        _look.set(b.position.x + hx * 30, b.position.y + 1.2 + b.pitch * 8, b.position.z + hz * 30);
        rollT = b.roll * 0.4 * this.motionScale;
        fovT += 6;
        lookRate = 20;
        this.applyDirect(_want, _look, fovT, rollT, dt, 30);
        this.applyShake(dt, time);
        return;
      }
      case 'aerial': {
        _want.set(b.position.x - _fwd.x * 16, b.surfaceY + 34, b.position.z - _fwd.z * 16);
        _look.set(b.position.x + _fwd.x * 12, b.position.y, b.position.z + _fwd.z * 12);
        fovT = 55;
        break;
      }
      case 'cinematic': {
        if (track) {
          this.cineT -= dt;
          const dx = this.cinePos.x - b.position.x;
          const dz = this.cinePos.z - b.position.z;
          const behind = dx * hx + dz * hz < -25;
          if (!this.cineHas || this.cineT <= 0 || behind) {
            // Pick a trackside spot ahead.
            const proj = track.project(b.position.x, b.position.z, -1, { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 });
            const ahead = 70 + Math.min(60, speed * 2);
            track.sample(proj.s + ahead, _tp);
            const side = noise1(time * 0.37, 3) > 0 ? 1 : -1;
            const lat = side * (track.width * 0.5 + 10);
            this.cinePos.set(_tp.x - _tp.tz * lat, 3.5 + Math.abs(noise1(time, 9)) * 9, _tp.z + _tp.tx * lat);
            this.cineHas = true;
            this.cineT = 7;
            this.snap = true;
          }
          _want.copy(this.cinePos);
          _look.set(b.position.x, b.position.y + 0.8, b.position.z);
          const d = Math.hypot(dx, dz);
          fovT = clamp(38 * (60 / Math.max(15, d)), 22, 60);
          this.applyDirect(_want, _look, fovT, 0, dt, 40);
          this.applyShake(dt, time);
          return;
        }
        break;
      }
    }

    if (this.snap) {
      this.pos.copy(_want);
      this.look.copy(_look);
      this.fov = fovT;
      this.snap = false;
    } else {
      this.pos.x = damp(this.pos.x, _want.x, posRate, dt);
      this.pos.y = damp(this.pos.y, _want.y, posRate * 0.8, dt);
      this.pos.z = damp(this.pos.z, _want.z, posRate, dt);
      this.look.x = damp(this.look.x, _look.x, lookRate, dt);
      this.look.y = damp(this.look.y, _look.y, lookRate * 0.7, dt);
      this.look.z = damp(this.look.z, _look.z, lookRate, dt);
      this.fov = damp(this.fov, fovT, 3, dt);
    }
    this.roll = damp(this.roll, rollT, 4, dt);
    this.commit(time);
    this.applyShake(dt, time);
  }

  private applyDirect(want: Vector3, look: Vector3, fov: number, roll: number, dt: number, rate: number) {
    if (this.snap) {
      this.pos.copy(want);
      this.look.copy(look);
      this.fov = fov;
      this.snap = false;
    } else {
      this.pos.x = damp(this.pos.x, want.x, rate, dt);
      this.pos.y = damp(this.pos.y, want.y, rate, dt);
      this.pos.z = damp(this.pos.z, want.z, rate, dt);
      this.look.x = damp(this.look.x, look.x, rate * 1.5, dt);
      this.look.y = damp(this.look.y, look.y, rate * 1.5, dt);
      this.look.z = damp(this.look.z, look.z, rate * 1.5, dt);
      this.fov = damp(this.fov, fov, 3, dt);
    }
    this.roll = damp(this.roll, roll, 5, dt);
    this.commit(this.t);
  }

  private commit(time: number) {
    const cam = this.camera;
    // Never below the water.
    let h = oceanHeight(this.pos.x, this.pos.z, time);
    // Ramps are solid: keep the lens above their deck too.
    if (this.ramps) {
      for (const r of this.ramps) {
        const sh = Math.sin(r.heading);
        const ch = Math.cos(r.heading);
        const dx = this.pos.x - r.x;
        const dz = this.pos.z - r.z;
        const along = dx * sh + dz * ch;
        const across = dx * ch - dz * sh;
        if (along > -2 && along < r.length + 2 && Math.abs(across) < r.width * 0.5 + 2) h = Math.max(h, -0.4 + Math.max(0, Math.min(r.length, along)) * (r.height / r.length));
      }
    }
    if (this.pos.y < h + 0.9) this.pos.y = h + 0.9;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    cam.rotateZ(this.roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  private applyShake(dt: number, time: number) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma * this.shakeScale;
    if (s < 1e-4) return;
    const cam = this.camera;
    cam.rotateX(noise1(time * 23, 1) * 0.035 * s);
    cam.rotateY(noise1(time * 23, 2) * 0.035 * s);
    cam.rotateZ(noise1(time * 19, 3) * 0.05 * s);
    cam.position.y += noise1(time * 17, 4) * 0.25 * s;
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
