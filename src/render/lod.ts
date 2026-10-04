/**
 * Distance LOD for instanced scenery.
 *
 * One logical set of instances is split each repartition between two
 * InstancedMeshes: `hi` (full geometry, plus its ink outline and any extra
 * meshes that share its matrices, e.g. buoy trim) for instances near the
 * camera, and `lo` (a cheaper geometry, or the same geometry without an
 * outline) for everything else. Outlines therefore only cost anything close
 * up, where they are actually visible.
 *
 * Repartitioning is O(n) with no allocation and is throttled by the caller
 * (a few times a second, or when the camera has moved far enough). Per-frame
 * matrix updates (bobbing buoys) go straight to whichever slot the instance
 * currently occupies.
 */

import { BufferGeometry, Color, Group, InstancedMesh, type Material, type Matrix4 } from 'three';
import { addOutline } from './cel';

/** Global LOD tuning, set by the graphics preset. Distances in metres. */
export const LOD = {
  /** Multiplier on every near/far distance. */
  scale: 1,
  /** 0 disables outlines on LOD-managed scenery entirely. */
  outlines: 1,
  /** Diagnostics: instances currently drawn at full detail / reduced. */
  hiCount: 0,
  loCount: 0,
};

export interface LodOptions {
  name: string;
  /** Cheaper geometry for far instances (defaults to the hi geometry, no outline). */
  loGeo?: BufferGeometry;
  loMat?: Material;
  /** Outline width in px for near instances (0 = none). */
  outline?: number;
  /** Whether per-instance colours are used. */
  colors?: boolean;
  /** Full detail inside this distance (metres, before LOD.scale). */
  near: number;
}

const _c = new Color();

export class LodInstances {
  readonly group = new Group();
  readonly hi: InstancedMesh;
  readonly lo: InstancedMesh;
  /** Extra meshes drawn only for near instances, sharing hi's matrices. */
  private followers: InstancedMesh[] = [];
  private mats: Float32Array;
  private cols: Float32Array | null;
  /** 0 = in hi, 1 = in lo; and the slot index inside that mesh. */
  private where: Uint8Array;
  private slot: Int32Array;
  readonly n: number;
  readonly near: number;
  private outlineShell: InstancedMesh | null = null;

  constructor(n: number, hiGeo: BufferGeometry, hiMat: Material, o: LodOptions) {
    this.n = n;
    this.near = o.near;
    this.mats = new Float32Array(n * 16);
    this.cols = o.colors ? new Float32Array(n * 3).fill(1) : null;
    this.where = new Uint8Array(n).fill(1);
    this.slot = new Int32Array(n);
    this.hi = new InstancedMesh(hiGeo, hiMat, Math.max(1, n));
    this.lo = new InstancedMesh(o.loGeo ?? hiGeo, o.loMat ?? hiMat, Math.max(1, n));
    for (const m of [this.hi, this.lo]) {
      m.frustumCulled = false;
      m.count = 0;
    }
    this.hi.name = o.name;
    this.lo.name = o.name + '_lo';
    if (o.outline && o.outline > 0) this.outlineShell = addOutline(this.hi, o.outline) as InstancedMesh;
    this.group.add(this.hi, this.lo);
    // Until the first partition, show everything at low detail.
    for (let i = 0; i < n; i++) this.slot[i] = i;
    this.lo.count = n;
  }

  /** A mesh drawn for near instances only (e.g. trim), sharing hi's matrices. */
  follow(geo: BufferGeometry, mat: Material, name: string) {
    const m = new InstancedMesh(geo, mat, Math.max(1, this.n));
    m.instanceMatrix = this.hi.instanceMatrix;
    m.frustumCulled = false;
    m.count = this.hi.count;
    m.name = name;
    this.followers.push(m);
    this.group.add(m);
    return m;
  }

  setMatrixAt(i: number, m: Matrix4) {
    m.toArray(this.mats, i * 16);
    const mesh = this.where[i] === 0 ? this.hi : this.lo;
    m.toArray(mesh.instanceMatrix.array as Float32Array, this.slot[i] * 16);
  }

  setColorAt(i: number, c: Color) {
    if (!this.cols) return;
    c.toArray(this.cols, i * 3);
    const mesh = this.where[i] === 0 ? this.hi : this.lo;
    mesh.setColorAt(this.slot[i], c);
  }

  /** Re-split instances by distance from (cx, cz). Cheap; call a few times a second. */
  partition(cx: number, cz: number, posX: ArrayLike<number>, posZ: ArrayLike<number>) {
    const near = this.near * LOD.scale;
    const n2 = near * near;
    const hiArr = this.hi.instanceMatrix.array as Float32Array;
    const loArr = this.lo.instanceMatrix.array as Float32Array;
    let h = 0;
    let l = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = posX[i] - cx;
      const dz = posZ[i] - cz;
      const isNear = dx * dx + dz * dz < n2;
      const src = i * 16;
      if (isNear) {
        hiArr.set(this.mats.subarray(src, src + 16), h * 16);
        if (this.cols) this.hi.setColorAt(h, _c.fromArray(this.cols, i * 3));
        this.where[i] = 0;
        this.slot[i] = h++;
      } else {
        loArr.set(this.mats.subarray(src, src + 16), l * 16);
        if (this.cols) this.lo.setColorAt(l, _c.fromArray(this.cols, i * 3));
        this.where[i] = 1;
        this.slot[i] = l++;
      }
    }
    this.hi.count = h;
    this.lo.count = l;
    for (const f of this.followers) f.count = h;
    if (this.outlineShell) {
      this.outlineShell.count = h;
      this.outlineShell.visible = LOD.outlines > 0;
    }
    this.markDirty();
    return h;
  }

  /** Flag GPU buffers for upload after matrix/colour writes. */
  markDirty() {
    this.hi.instanceMatrix.needsUpdate = true;
    this.lo.instanceMatrix.needsUpdate = true;
    if (this.cols) {
      if (this.hi.instanceColor) this.hi.instanceColor.needsUpdate = true;
      if (this.lo.instanceColor) this.lo.instanceColor.needsUpdate = true;
    }
  }

  /** Visible instance counts for diagnostics. */
  get counts() {
    return { hi: this.hi.count, lo: this.lo.count };
  }
}

/**
 * Throttle for repartitioning: true when the camera has moved more than
 * `step` metres or `maxAge` seconds have passed since the last partition.
 */
export class LodClock {
  private lx = Infinity;
  private lz = Infinity;
  private age = 0;
  constructor(
    private step = 12,
    private maxAge = 0.5,
  ) {}
  due(cx: number, cz: number, dt: number) {
    this.age += dt;
    if ((cx - this.lx) ** 2 + (cz - this.lz) ** 2 > this.step * this.step || this.age > this.maxAge) {
      this.lx = cx;
      this.lz = cz;
      this.age = 0;
      return true;
    }
    return false;
  }
  /** Force the next `due` to fire (e.g. after a preset change). */
  reset() {
    this.lx = Infinity;
  }
}
