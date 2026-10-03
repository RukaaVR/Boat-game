/**
 * Boat shadows: a soft dark footprint per boat, cast along the sun direction
 * onto whatever is underneath (water surface or ramp deck). It stretches and
 * fades with height, so jumps read clearly — the key depth cue in the air.
 * One instanced draw call for every boat.
 */

import { CanvasTexture, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Texture } from 'three';
import type { RaceSession } from '../race/session';
import { makeSample, sampleOcean } from '../water/waves';

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const _up = new Vector3(0, 1, 0);
const _sample = makeSample();

function shadowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 64, 4, 32, 64, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.setTransform(1, 0, 0, 2, 0, -64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  return new CanvasTexture(c);
}

export class BoatShadows {
  readonly mesh: InstancedMesh;
  private tex: Texture;
  private mat: MeshBasicMaterial;
  strength = 0.45;

  constructor(private session: RaceSession) {
    const g = new PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.tex = shadowTexture();
    this.mat = new MeshBasicMaterial({ color: 0x000814, alphaMap: this.tex, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: true });
    this.mesh = new InstancedMesh(g, this.mat, session.racers.length);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** `sun` points toward the light; night/storm soften the shadow. */
  update(time: number, sun: Vector3, soft: number) {
    const s = this.session;
    this.mat.opacity = this.strength * (1 - soft * 0.6);
    const sy = Math.max(0.25, sun.y);
    for (let i = 0; i < s.racers.length; i++) {
      const b = s.racers[i].boat;
      sampleOcean(b.position.x, b.position.z, time, _sample);
      let ground = _sample.height;
      // Ramps are solid ground too.
      for (const r of s.track.ramps) {
        const sh = Math.sin(r.heading);
        const ch = Math.cos(r.heading);
        const dx = b.position.x - r.x;
        const dz = b.position.z - r.z;
        const along = dx * sh + dz * ch;
        const across = dx * ch - dz * sh;
        if (along > 0 && along < r.length && Math.abs(across) < r.width * 0.5) ground = Math.max(ground, -0.38 + along * (r.height / r.length));
      }
      const h = Math.max(0, b.position.y - 0.3 - ground);
      // Cast along the sun direction.
      const k = h / sy;
      const x = b.position.x - sun.x * k;
      const z = b.position.z - sun.z * k;
      const spread = 1 + h * 0.08;
      const fade = Math.max(0.15, 1 - h / 22);
      _n.copy(_sample.normal);
      _q2.setFromUnitVectors(_up, _n);
      _q.setFromAxisAngle(_up, b.heading).premultiply(_q2);
      _m.compose(_p.set(x, ground + 0.06, z), _q, _s.set(b.spec.beam * 1.25 * spread * fade, 1, b.spec.length * 1.1 * spread * fade));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
