/**
 * Trailed (held) items: a torpedo, an oil canister or a shield orb bobbing on
 * the water just behind the stern while its racer holds the item button.
 * One instanced mesh per kind (one slot per racer); reads racer state, owns no
 * gameplay. No allocation per frame.
 */

import { AdditiveBlending, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, ShaderMaterial, Vector3, type BufferGeometry, type Material } from 'three';
import type { RaceSession } from '../race/session';
import type { BattleItems } from '../race/items';
import { oceanHeight } from '../water/waves';
import { addOutline, cel } from './cel';
import { GeoBuilder } from './geo';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _e = new Vector3(0, 1, 0);
const _hp = { x: 0, z: 0 };
const HIDE = new Matrix4().makeScale(0.0001, 0.0001, 0.0001).setPosition(0, -100, 0);

export class HeldItemVisuals {
  readonly group = new Group();
  private torps: InstancedMesh;
  private oils: InstancedMesh;
  private orbs: InstancedMesh;
  private glows: InstancedMesh;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private session: RaceSession,
    private items: BattleItems,
  ) {
    const n = Math.max(1, session.racers.length);
    const tg = new GeoBuilder();
    tg.cyl(0.28, 0.28, 2.2, 0x2a2e38, { rx: Math.PI / 2 }, 10);
    tg.cone(0.28, 0.6, 0xff3b5c, { rx: Math.PI / 2, z: 1.4 }, 10);
    tg.box(0.9, 0.06, 0.4, 0xffd21e, { z: -0.95 });
    tg.box(0.06, 0.9, 0.4, 0xffd21e, { z: -0.95 });
    this.torps = this.inst(tg.build(), cel('torpedo', { vertexColors: true, gloss: 1 }), n);
    addOutline(this.torps, 1.4);
    // Oil canister: a squat black drum with a rainbow-sheen band and a yellow cap.
    const og = new GeoBuilder();
    og.cyl(0.55, 0.55, 1.1, 0x15161c, {}, 14);
    og.cyl(0.57, 0.57, 0.22, 0x7b5cff, { y: 0.18 }, 14);
    og.cyl(0.57, 0.57, 0.12, 0x00e0a4, { y: -0.12 }, 14);
    og.cyl(0.18, 0.18, 0.16, 0xffd21e, { y: 0.62 }, 10);
    this.oils = this.inst(og.build(), cel('heldoil', { vertexColors: true, gloss: 1 }), n);
    addOutline(this.oils, 1.4);
    // Shield orb: a small glassy core plus an additive fresnel glow.
    const core = new IcosahedronGeometry(0.42, 2);
    this.orbs = this.inst(core, new MeshBasicMaterial({ color: 0xbff8ff }), n);
    const glow = new IcosahedronGeometry(1, 2);
    const gm = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(0x26e8ff) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float hex = 0.2 + 0.2 * sin(vN.y * 24.0 + uTime * 5.0); gl_FragColor = vec4(uColor * (f * 1.6 + hex), f + 0.1); }`,
    });
    this.glows = this.inst(glow, gm, n);
  }

  private inst(geo: BufferGeometry, mat: Material, n: number) {
    const m = new InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    for (let i = 0; i < n; i++) m.setMatrixAt(i, HIDE);
    this.group.add(m);
    this.disposables.push(geo, mat);
    return m;
  }

  update(time: number) {
    const racers = this.session.racers;
    for (let i = 0; i < racers.length; i++) {
      const r = racers[i];
      const kind = r.itemHeld && !r.eliminated ? r.item : null;
      this.torps.setMatrixAt(i, HIDE);
      this.oils.setMatrixAt(i, HIDE);
      this.orbs.setMatrixAt(i, HIDE);
      this.glows.setMatrixAt(i, HIDE);
      if (!kind) continue;
      const b = r.boat;
      this.items.heldPos(r, _hp);
      // Sways a little on its tow, rides the swell.
      const sway = Math.sin(time * 3.1 + i) * 0.35;
      const x = _hp.x + Math.cos(b.heading) * sway;
      const z = _hp.z - Math.sin(b.heading) * sway;
      const y = oceanHeight(x, z, time);
      const sc = r.boat.shrink > 0 ? 0.7 : 1;
      if (kind === 'torpedo') {
        _q.setFromAxisAngle(_e, b.heading + Math.sin(time * 2.3 + i) * 0.12);
        _m.compose(_p.set(x, y + 0.2, z), _q, _s.setScalar(sc));
        this.torps.setMatrixAt(i, _m);
      } else if (kind === 'oil') {
        _q.setFromAxisAngle(_e, time * 0.8 + i);
        _m.compose(_p.set(x, y + 0.35 + Math.sin(time * 4 + i) * 0.08, z), _q, _s.setScalar(sc));
        this.oils.setMatrixAt(i, _m);
      } else if (kind === 'shield') {
        _q.identity();
        const hy = y + 0.9 + Math.sin(time * 3.4 + i) * 0.15;
        _m.compose(_p.set(x, hy, z), _q, _s.setScalar(sc));
        this.orbs.setMatrixAt(i, _m);
        _m.compose(_p, _q, _s.setScalar(sc * (0.95 + 0.08 * Math.sin(time * 9 + i))));
        this.glows.setMatrixAt(i, _m);
      }
    }
    this.torps.instanceMatrix.needsUpdate = true;
    this.oils.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    (this.glows.material as ShaderMaterial).uniforms.uTime.value = time;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
