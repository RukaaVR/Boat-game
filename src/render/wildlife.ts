/**
 * Ambient life: dolphin pods leaping beside the course, gull flocks wheeling
 * overhead, a whale breaching out on open water, and the fishing trawlers of
 * the traffic system. Pure presentation (the trawlers' motion and collisions
 * live in race/traffic.ts); every animal is procedural geometry, instanced.
 */

import { Euler, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { RaceSession } from '../race/session';
import type { Particles } from '../particles/particles';
import { Color } from 'three';
import { oceanHeight } from '../water/waves';
import { addOutline, cel } from './cel';
import { GeoBuilder } from './geo';
import type { TrackPoint } from '../race/track';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _tp: TrackPoint = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
const WHITE = new Color(1, 1, 1);

function dolphinGeo() {
  const g = new GeoBuilder();
  // Body along +Z (nose forward), grey back, pale belly.
  g.sphere(0.42, 0x5a9ad8, { sx: 0.85, sy: 0.8, sz: 2.6 }, 12, 8);
  g.sphere(0.36, 0xf2f8ff, { y: -0.12, sx: 0.8, sy: 0.55, sz: 2.2 }, 10, 6);
  g.cone(0.14, 0.55, 0x5a9ad8, { z: 1.25, rx: Math.PI / 2, sx: 1, sz: 0.8 }, 8);
  g.cone(0.32, 0.6, 0x4a86c8, { y: 0.4, z: -0.1, rx: -0.5, sx: 0.25 }, 6);
  g.box(1.0, 0.06, 0.35, 0x4a86c8, { z: -1.2 });
  g.box(0.75, 0.05, 0.3, 0x4a86c8, { y: -0.2, z: 0.4, rx: 0.2 });
  return g.build();
}

function gullGeo(part: 'body' | 'wing') {
  const g = new GeoBuilder();
  if (part === 'body') {
    g.sphere(0.16, 0xf4f4f0, { sz: 2.4 }, 8, 6);
    g.cone(0.05, 0.16, 0xffb21e, { z: 0.44, rx: Math.PI / 2 }, 5);
    g.box(0.18, 0.03, 0.2, 0xf4f4f0, { z: -0.4 });
  } else {
    // One wing extending to +X from the shoulder; mirrored by scale.x = -1.
    g.box(0.75, 0.03, 0.26, 0xe8ecef, { x: 0.38 });
    g.box(0.3, 0.032, 0.2, 0x2a2e38, { x: 0.85, z: -0.02 });
  }
  return g.build();
}

function whaleGeo() {
  const g = new GeoBuilder();
  g.sphere(2.2, 0x3a5a9a, { sx: 1.0, sy: 0.85, sz: 4.2 }, 16, 10);
  g.sphere(1.9, 0xeef4ff, { y: -0.7, z: 0.6, sx: 0.85, sy: 0.5, sz: 3.6 }, 14, 8);
  g.box(5.2, 0.25, 1.8, 0x2e4c88, { z: -9.4 });
  g.box(2.6, 0.2, 1.2, 0x2e4c88, { x: 2.4, y: -0.6, z: 3.4, rz: -0.4, ry: 0.4 });
  g.box(2.6, 0.2, 1.2, 0x2e4c88, { x: -2.4, y: -0.6, z: 3.4, rz: 0.4, ry: -0.4 });
  g.cyl(0.9, 1.6, 4.0, 0x3a5a9a, { z: -6.5, rx: Math.PI / 2 }, 10);
  return g.build();
}

function trawlerGeo() {
  const g = new GeoBuilder();
  g.box(3.4, 1.4, 9, 0x2f5f8a, { y: 0.2 });
  g.cone(1.7, 2.6, 0x2f5f8a, { z: 5.8, rx: Math.PI / 2, sx: 1, sz: 0.55 }, 4);
  g.box(3.5, 0.25, 9.2, 0xe8e2d0, { y: 0.95 });
  g.box(2.4, 1.8, 2.6, 0xf2efe6, { y: 2.0, z: 1.6 });
  g.box(2.5, 0.25, 2.8, 0xd23a2a, { y: 3.0, z: 1.6 });
  g.box(2.2, 0.5, 0.06, 0x223344, { y: 2.3, z: 2.92 });
  g.cyl(0.18, 0.18, 6, 0x8a8a8a, { y: 4.2, z: -1.2 }, 6);
  g.cyl(0.08, 0.08, 4.6, 0x8a8a8a, { y: 4.5, z: -2.6, rx: 0.9 }, 5);
  g.cyl(0.28, 0.32, 1.2, 0x333333, { y: 3.2, z: 0.2 }, 8);
  g.box(2.8, 0.9, 1.6, 0x4a6a3a, { y: 1.3, z: -3.6 });
  return g.build();
}

interface Pod {
  /** Leap timeline (s); < 0 means waiting. */
  t: number;
  wait: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export class Wildlife {
  readonly group = new Group();
  private dolphins: InstancedMesh;
  private gullBody: InstancedMesh;
  private gullWingL: InstancedMesh;
  private gullWingR: InstancedMesh;
  private whale: Mesh;
  private trawlers: Mesh[] = [];
  private pod: Pod = { t: -1, wait: 6, x: 0, z: 0, dx: 0, dz: 1 };
  private flocks: { x: number; z: number; y: number; r: number; speed: number }[] = [];
  private whaleSpot = { x: 0, z: 0, heading: 0, t: -1, wait: 18 };
  private disposables: { dispose(): void }[] = [];
  private night = false;

  constructor(
    private session: RaceSession,
    private particles: Particles,
    enabled: boolean,
  ) {
    const track = session.track;
    const dg = dolphinGeo();
    this.dolphins = new InstancedMesh(dg, cel('dolphin', { vertexColors: true, gloss: 1, rim: 1 }), 3);
    this.dolphins.frustumCulled = false;
    addOutline(this.dolphins, 1.4);
    const gb = gullGeo('body');
    const gw = gullGeo('wing');
    const gmat = cel('gull', { vertexColors: true });
    const N = 18;
    this.gullBody = new InstancedMesh(gb, gmat, N);
    this.gullWingL = new InstancedMesh(gw, gmat, N);
    this.gullWingR = new InstancedMesh(gw, gmat, N);
    for (const m of [this.gullBody, this.gullWingL, this.gullWingR]) m.frustumCulled = false;
    const wg = whaleGeo();
    this.whale = new Mesh(wg, cel('whale', { vertexColors: true, gloss: 0.8, rim: 1 }));
    addOutline(this.whale, 2);
    this.whale.visible = false;
    this.disposables.push(dg, gb, gw, wg);
    this.group.add(this.dolphins, this.gullBody, this.gullWingL, this.gullWingR, this.whale);

    if (session.traffic) {
      const tg = trawlerGeo();
      this.disposables.push(tg);
      const mat = cel('trawler', { vertexColors: true, gloss: 0.4 });
      for (let i = 0; i < session.traffic.boats.length; i++) {
        const m = new Mesh(tg, mat);
        addOutline(m, 1.8);
        this.trawlers.push(m);
        this.group.add(m);
      }
    }

    // Gull flocks circle over islands near the course (or the course itself).
    const isl = session.layout.islands.slice().sort((a, b) => a.r - b.r);
    for (let i = 0; i < 3; i++) {
      const is = isl[i];
      if (is) this.flocks.push({ x: is.x, z: is.z, y: 18 + i * 6, r: 22 + i * 8, speed: 0.35 + i * 0.07 });
      else {
        track.sample((track.length * (i + 0.5)) / 3, _tp);
        this.flocks.push({ x: _tp.x, z: _tp.z, y: 20, r: 30, speed: 0.3 });
      }
    }
    // The whale lives out on open water well clear of the course.
    for (let k = 0; k < 30; k++) {
      track.sample(track.length * (k / 30), _tp);
      const side = k % 2 ? 1 : -1;
      const lat = side * (track.width * 0.5 + 150);
      const x = _tp.x - _tp.tz * lat;
      const z = _tp.z + _tp.tx * lat;
      if (!session.statics.blocked(x, z, 30) && track.distToCentre(x, z) > 120) {
        Object.assign(this.whaleSpot, { x, z, heading: _tp.heading + side * 0.8 });
        break;
      }
    }
    this.group.visible = enabled;
  }

  setNight(n: number) {
    this.night = n > 0.8;
  }

  update(dt: number, time: number, cam: Vector3) {
    if (!this.group.visible) return;
    const s = this.session;
    const track = s.track;
    const P = this.particles;
    const player = s.player.boat;

    // ── Trawlers ─────────────────────────────────────────────────────────
    if (s.traffic) {
      s.traffic.boats.forEach((t, i) => {
        const m = this.trawlers[i];
        const h = oceanHeight(t.x, t.z, time);
        m.position.set(t.x, h + 0.45, t.z);
        m.rotation.set(Math.sin(time * 0.9 + i) * 0.04, t.heading, Math.sin(time * 0.7 + i * 2) * 0.06, 'YXZ');
        if (t.wait <= 0 && (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 < 150 * 150) {
          const n = P.count(10, dt);
          const fx = Math.sin(t.heading);
          const fz = Math.cos(t.heading);
          for (let k = 0; k < n; k++) P.emit('spray', t.x + fx * 6, h + 0.2, t.z + fz * 6, fx * 2 + (Math.random() - 0.5) * 2, 1 + Math.random(), fz * 2 + (Math.random() - 0.5) * 2, WHITE, 0.6, 0.6, h - 0.3);
        }
      });
    }

    // ── Dolphins: a pod surfaces beside the course ahead of the player ───
    const pod = this.pod;
    if (pod.t < 0) {
      pod.wait -= dt;
      if (pod.wait <= 0) {
        const proj = s.player;
        track.sample(proj.s + 60 + Math.random() * 40, _tp);
        const side = Math.random() < 0.5 ? 1 : -1;
        const lat = side * (track.width * 0.5 + 10 + Math.random() * 12);
        pod.x = _tp.x - _tp.tz * lat;
        pod.z = _tp.z + _tp.tx * lat;
        if (s.statics.blocked(pod.x, pod.z, 8)) pod.wait = 2;
        else {
          pod.dx = _tp.tx;
          pod.dz = _tp.tz;
          pod.t = 0;
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      let sc = 0.0001;
      if (pod.t >= 0) {
        // Each dolphin does three leaps of 1.3 s with a 0.5 s dive between, offset in time and lane.
        const lt = pod.t - i * 0.35;
        const cycle = 1.8;
        const k = Math.floor(lt / cycle);
        const f = (lt - k * cycle) / 1.3;
        if (lt >= 0 && k < 3 && f <= 1) {
          const along = (k * cycle + f * 1.3) * 11 + i * 2;
          const side = (i - 1) * 2.2;
          const x = pod.x + pod.dx * along - pod.dz * side;
          const z = pod.z + pod.dz * along + pod.dx * side;
          const h = oceanHeight(x, z, time);
          const y = h - 0.8 + Math.sin(f * Math.PI) * 3.1;
          const pitch = Math.cos(f * Math.PI) * 0.9;
          _e.set(pitch, Math.atan2(pod.dx, pod.dz), 0, 'YXZ');
          _q.setFromEuler(_e);
          _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
          sc = 1;
          if ((f < 0.06 || f > 0.94) && Math.random() < 0.5) {
            for (let q = 0; q < 6; q++) P.emit('splash', x, h + 0.1, z, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, WHITE, 0.7, 0.7, h - 0.3);
          }
        }
      }
      if (sc < 1) _m.compose(_p.set(0, -50, 0), _q.identity(), _s.setScalar(0.0001));
      this.dolphins.setMatrixAt(i, _m);
    }
    this.dolphins.instanceMatrix.needsUpdate = true;
    if (pod.t >= 0) {
      pod.t += dt;
      if (pod.t > 3 * 1.8 + 1) {
        pod.t = -1;
        pod.wait = 14 + Math.random() * 16;
      }
    }

    // ── Gulls ────────────────────────────────────────────────────────────
    const showGulls = !this.night && s.cfg.weather !== 'storm';
    for (let i = 0; i < 18; i++) {
      const fl = this.flocks[i % 3];
      const j = Math.floor(i / 3);
      const a = time * fl.speed + j * 1.05 + (i % 3) * 2;
      const r = fl.r + Math.sin(j * 1.7) * 6;
      const x = fl.x + Math.cos(a) * r;
      const z = fl.z + Math.sin(a) * r;
      const y = fl.y + Math.sin(time * 0.7 + j) * 2.5;
      const head = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2;
      const flap = Math.sin(time * (6 + (j % 3)) + i) * 0.55;
      const sc = showGulls ? 1.3 : 0.0001;
      _e.set(0, head, -0.25, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(sc));
      this.gullBody.setMatrixAt(i, _m);
      _e.set(0, head, -0.25 + flap, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s.set(sc, sc, sc));
      this.gullWingR.setMatrixAt(i, _m);
      _e.set(0, head, -0.25 - flap, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s.set(-sc, sc, sc));
      this.gullWingL.setMatrixAt(i, _m);
    }
    this.gullBody.instanceMatrix.needsUpdate = this.gullWingL.instanceMatrix.needsUpdate = this.gullWingR.instanceMatrix.needsUpdate = true;

    // ── Whale breach ─────────────────────────────────────────────────────
    const w = this.whaleSpot;
    const wd = Math.hypot(w.x - cam.x, w.z - cam.z);
    if (w.t < 0) {
      w.wait -= dt;
      if (w.wait <= 0 && wd < 700) w.t = 0;
      this.whale.visible = false;
    } else {
      w.t += dt;
      const D = 3.6;
      const f = w.t / D;
      if (f >= 1) {
        w.t = -1;
        w.wait = 35 + Math.random() * 25;
        this.whale.visible = false;
      } else {
        // Burst up nose-first, twist, and crash down on its back.
        const h = oceanHeight(w.x, w.z, time);
        const rise = Math.sin(f * Math.PI);
        const fx = Math.sin(w.heading);
        const fz = Math.cos(w.heading);
        this.whale.position.set(w.x + fx * f * 10, h - 7 + rise * 12, w.z + fz * f * 10);
        this.whale.rotation.set(-1.2 + f * 2.0, w.heading, f * 1.6, 'YXZ');
        this.whale.visible = true;
        if (f > 0.03 && f < 0.12 && wd < 500) for (let q = 0; q < 8; q++) P.emit('splash', w.x, h, w.z, (Math.random() - 0.5) * 8, 6 + Math.random() * 8, (Math.random() - 0.5) * 8, WHITE, 1.4, 2.4, h - 1);
        if (f > 0.82 && f < 0.92 && wd < 500) {
          const ex = w.x + fx * 9;
          const ez = w.z + fz * 9;
          for (let q = 0; q < 26; q++) P.emit('splash', ex, h, ez, (Math.random() - 0.5) * 18, 8 + Math.random() * 14, (Math.random() - 0.5) * 18, WHITE, 1.6, 3, h - 1);
          for (let q = 0; q < 4; q++) P.emit('mist', ex, h + 3, ez, (Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6, WHITE, 2, 4);
        }
      }
    }
    void player;
  }

  dispose() {
    for (const d of this.disposables) (d as BufferGeometry).dispose();
    this.group.removeFromParent();
  }
}
