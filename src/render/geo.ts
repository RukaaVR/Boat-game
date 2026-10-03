/**
 * Tiny procedural modelling kit: primitives with per-part vertex colours,
 * transformed and merged into a single geometry (one draw call per model).
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  type ColorRepresentation,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

export interface Xf {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  s?: number;
}

export class GeoBuilder {
  private parts: BufferGeometry[] = [];

  add(g: BufferGeometry, color: ColorRepresentation, xf: Xf = {}) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    _e.set(xf.rx ?? 0, xf.ry ?? 0, xf.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(xf.x ?? 0, xf.y ?? 0, xf.z ?? 0);
    const s = xf.s ?? 1;
    _s.set((xf.sx ?? 1) * s, (xf.sy ?? 1) * s, (xf.sz ?? 1) * s);
    _m.compose(_p, _q, _s);
    geo.applyMatrix4(_m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    this.parts.push(geo);
    return this;
  }

  box(w: number, h: number, d: number, color: ColorRepresentation, xf?: Xf) {
    return this.add(new BoxGeometry(w, h, d), color, xf);
  }
  cyl(rt: number, rb: number, h: number, color: ColorRepresentation, xf?: Xf, seg = 10) {
    return this.add(new CylinderGeometry(rt, rb, h, seg), color, xf);
  }
  cone(r: number, h: number, color: ColorRepresentation, xf?: Xf, seg = 8) {
    return this.add(new ConeGeometry(r, h, seg), color, xf);
  }
  sphere(r: number, color: ColorRepresentation, xf?: Xf, w = 12, h = 8) {
    return this.add(new SphereGeometry(r, w, h), color, xf);
  }
  capsule(r: number, len: number, color: ColorRepresentation, xf?: Xf) {
    return this.add(new CapsuleGeometry(r, len, 3, 8), color, xf);
  }
  rock(r: number, color: ColorRepresentation, xf?: Xf, detail = 0) {
    return this.add(new DodecahedronGeometry(r, detail), color, xf);
  }
  ico(r: number, color: ColorRepresentation, xf?: Xf, detail = 1) {
    return this.add(new IcosahedronGeometry(r, detail), color, xf);
  }
  torus(r: number, tube: number, color: ColorRepresentation, xf?: Xf, arc = Math.PI * 2) {
    return this.add(new TorusGeometry(r, tube, 6, 16, arc), color, xf);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(smooth = false): BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (smooth) {
      g.deleteAttribute('normal');
      const m = mergeVertices(g, 1e-3);
      m.computeVertexNormals();
      return m;
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Displace a geometry's vertices with smooth noise — turns spheres into rocks. */
export function lumpify(g: BufferGeometry, amount: number, seed: number, flattenBelow = -Infinity) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 1.7 + seed) * Math.cos(z * 1.3 - seed * 0.7) * 0.5 +
      Math.sin(y * 2.3 + seed * 1.3) * 0.3 +
      Math.cos((x + z) * 3.1 + seed * 2.1) * 0.2;
    const k = 1 + n * amount;
    pos.setXYZ(i, x * k, Math.max(flattenBelow, y * k), z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
