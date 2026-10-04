/**
 * Battle-mode visuals: spinning item boxes, torpedoes, oil slicks, wave-maker
 * shock rings and shield bubbles. Instanced throughout; reads BattleItems and
 * boat state, owns no gameplay.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { RaceSession } from '../race/session';
import type { BattleItems } from '../race/items';
import { oceanHeight } from '../water/waves';
import { addOutline, cel } from './cel';
import { GeoBuilder } from './geo';
import { itemBoxTexture } from './textures';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _ax = new Vector3(0.3, 1, 0.2).normalize();
const _fwd = new Vector3(0, 0, 1);
const _dir = new Vector3();

export class BattleVisuals {
  readonly group = new Group();
  private boxes: InstancedMesh;
  private torps: InstancedMesh;
  private slicks: InstancedMesh;
  private blasts: InstancedMesh;
  private shields: InstancedMesh;
  private missiles: InstancedMesh;
  private flames: InstancedMesh;
  private locks: InstancedMesh;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private session: RaceSession,
    private items: BattleItems,
  ) {
    const bg = new BoxGeometry(1.8, 1.8, 1.8);
    this.boxes = this.inst(bg, new MeshBasicMaterial({ map: itemBoxTexture(), transparent: true, opacity: 0.88, fog: true }), items.boxes.length);

    const tg = new GeoBuilder();
    tg.cyl(0.28, 0.28, 2.2, 0x2a2e38, { rx: Math.PI / 2 }, 10);
    tg.cone(0.28, 0.6, 0xff3b5c, { rx: Math.PI / 2, z: 1.4 }, 10);
    tg.box(0.9, 0.06, 0.4, 0xffd21e, { z: -0.95 });
    tg.box(0.06, 0.9, 0.4, 0xffd21e, { z: -0.95 });
    const torpGeo = tg.build();
    this.torps = this.inst(torpGeo, cel('torpedo', { vertexColors: true, gloss: 1 }), items.torpedoes.length);
    addOutline(this.torps, 1.4);

    const sg = new CircleGeometry(1, 28);
    sg.rotateX(-Math.PI / 2);
    const slickMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p) * 2.0;
          float edge = smoothstep(1.0, 0.82, r + 0.05 * sin(atan(p.y, p.x) * 7.0 + uTime));
          vec3 sheen = 0.5 + 0.5 * cos(6.2831 * (r * 1.6 + uTime * 0.15 + vec3(0.0, 0.33, 0.67)));
          vec3 col = mix(vec3(0.02, 0.02, 0.03), sheen * 0.55, 0.35 + 0.35 * r);
          gl_FragColor = vec4(col, edge * 0.88);
        }`,
    });
    this.slicks = this.inst(sg, slickMat, items.slicks.length);

    const rg = new RingGeometry(0.85, 1, 48);
    rg.rotateX(-Math.PI / 2);
    this.blasts = this.inst(rg, new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), 8);

    const shg = new IcosahedronGeometry(1, 2);
    const shMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(0x26e8ff) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5); float hex = 0.15 + 0.15 * sin(vN.y * 30.0 + uTime * 4.0); gl_FragColor = vec4(uColor * (f * 1.4 + hex), f * 0.9 + 0.08); }`,
    });
    this.shields = this.inst(shg, shMat, session.racers.length);

    // Seeker missile: white body, red nose and bands, yellow fins (points along +Z).
    const mg = new GeoBuilder();
    mg.cyl(0.32, 0.32, 2.4, 0xf4f7ff, { rx: Math.PI / 2 }, 12);
    mg.cone(0.32, 0.9, 0xff2d55, { rx: Math.PI / 2, z: 1.65 }, 12);
    mg.cyl(0.34, 0.34, 0.25, 0xff2d55, { rx: Math.PI / 2, z: 0.6 }, 12);
    mg.cyl(0.34, 0.34, 0.2, 0x12306e, { rx: Math.PI / 2, z: -1.05 }, 12);
    mg.box(1.5, 0.08, 0.55, 0xffd21e, { z: -0.9 });
    mg.box(0.08, 1.5, 0.55, 0xffd21e, { z: -0.9 });
    mg.box(0.9, 0.06, 0.35, 0xffd21e, { z: 0.9 });
    const missileGeo = mg.build();
    this.missiles = this.inst(missileGeo, cel('seeker', { vertexColors: true, gloss: 1 }), items.missiles.length);
    addOutline(this.missiles, 1.6);
    const fg = new GeoBuilder();
    fg.cone(0.3, 1.8, 0xffffff, { rx: -Math.PI / 2, z: -2.1 }, 10);
    this.flames = this.inst(fg.build(), new MeshBasicMaterial({ color: 0xffa21e, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }), items.missiles.length);
    // Red lock-on reticle ring on the water around the target.
    const lg = new RingGeometry(0.78, 1, 4, 1);
    lg.rotateX(-Math.PI / 2);
    this.locks = this.inst(lg, new MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), items.missiles.length);
  }

  private inst(geo: BufferGeometry, mat: MeshBasicMaterial | ShaderMaterial | ReturnType<typeof cel>, n: number) {
    const m = new InstancedMesh(geo, mat, Math.max(1, n));
    m.frustumCulled = false;
    this.group.add(m);
    this.disposables.push(geo, mat);
    return m;
  }

  update(time: number) {
    const it = this.items;
    // Boxes: bob and tumble; taken boxes regrow.
    it.boxes.forEach((b, i) => {
      const sc = b.respawn > 0 ? (b.respawn < 0.5 ? 1 - b.respawn * 2 : 0.0001) : 1;
      _q.setFromAxisAngle(_ax, time * 1.6 + i);
      _m.compose(_p.set(b.x, oceanHeight(b.x, b.z, time) + 1.3 + Math.sin(time * 2 + i) * 0.25, b.z), _q, _s.setScalar(Math.max(0.0001, sc)));
      this.boxes.setMatrixAt(i, _m);
    });
    this.boxes.instanceMatrix.needsUpdate = true;
    it.torpedoes.forEach((t, i) => {
      const sc = t.alive ? 1 : 0.0001;
      _q.setFromAxisAngle(_up, Math.atan2(t.vx, t.vz));
      _m.compose(_p.set(t.x, oceanHeight(t.x, t.z, time) + 0.15, t.z), _q, _s.setScalar(sc));
      this.torps.setMatrixAt(i, _m);
    });
    this.torps.instanceMatrix.needsUpdate = true;
    it.slicks.forEach((s, i) => {
      const sc = s.alive ? s.r : 0.0001;
      _m.compose(_p.set(s.x, oceanHeight(s.x, s.z, time) + 0.06, s.z), _q.identity(), _s.set(sc, 1, sc));
      this.slicks.setMatrixAt(i, _m);
    });
    this.slicks.instanceMatrix.needsUpdate = true;
    (this.slicks.material as ShaderMaterial).uniforms.uTime.value = time;
    for (let i = 0; i < 8; i++) {
      const b = it.blasts[i];
      const r = b ? 2 + b.t * 22 : 0.0001;
      _m.compose(_p.set(b?.x ?? 0, b ? oceanHeight(b.x, b.z, time) + 0.4 : -100, b?.z ?? 0), _q.identity(), _s.set(r, 1, r));
      this.blasts.setMatrixAt(i, _m);
    }
    this.blasts.instanceMatrix.needsUpdate = true;
    (this.blasts.material as MeshBasicMaterial).opacity = 0.7;
    this.session.racers.forEach((r, i) => {
      const b = r.boat;
      const on = b.shield > 0 && (b.shield > 1.5 || Math.floor(time * 10) % 2 === 0);
      const sc = on ? b.spec.length * 0.62 : 0.0001;
      _m.compose(_p.set(b.position.x, b.position.y + 0.6, b.position.z), _q.identity(), _s.setScalar(sc));
      this.shields.setMatrixAt(i, _m);
    });
    this.shields.instanceMatrix.needsUpdate = true;
    (this.shields.material as ShaderMaterial).uniforms.uTime.value = time;

    const racers = this.session.racers;
    for (let i = 0; i < it.missiles.length; i++) {
      const m = it.missiles[i];
      if (m.alive) {
        _dir.set(m.vx, m.vy, m.vz);
        if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
        _q.setFromUnitVectors(_fwd, _dir.normalize());
        _p.set(m.x, m.y, m.z);
        _m.compose(_p, _q, _s.setScalar(1));
        this.missiles.setMatrixAt(i, _m);
        _m.compose(_p, _q, _s.set(1, 1, 0.8 + 0.4 * Math.abs(Math.sin(time * 37 + i))));
        this.flames.setMatrixAt(i, _m);
        const tb = racers[m.target]?.boat;
        if (tb) {
          // Spinning diamond that tightens as the missile closes.
          const r = (tb.spec.length * 0.9 + 1.2) * (1.6 - m.urgency * 0.6) * (1 + 0.08 * Math.sin(time * (8 + m.urgency * 14)));
          _q.setFromAxisAngle(_up, time * (2 + m.urgency * 6));
          _m.compose(_p.set(tb.position.x, tb.surfaceY + 0.25, tb.position.z), _q, _s.set(r, 1, r));
        } else _m.compose(_p.set(0, -100, 0), _q.identity(), _s.setScalar(0.0001));
        this.locks.setMatrixAt(i, _m);
      } else {
        _m.compose(_p.set(0, -100, 0), _q.identity(), _s.setScalar(0.0001));
        this.missiles.setMatrixAt(i, _m);
        this.flames.setMatrixAt(i, _m);
        this.locks.setMatrixAt(i, _m);
      }
    }
    this.missiles.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.locks.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
