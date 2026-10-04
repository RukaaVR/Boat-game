/**
 * Sky dome + cumulus clusters.
 *
 * The dome's lowest band resolves to exactly the fog colour the ocean fades to,
 * so the horizon line is seamless. The sun is placed low enough (per preset) to
 * actually appear in chase-camera compositions, with a hard cel disc and a soft
 * halo; at night it becomes a moon and stars appear.
 */

import {
  BackSide,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { Rng } from '../core/rng';
import { GeoBuilder } from '../render/geo';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uCloud;
uniform vec3 uCloudColor;
uniform vec3 uCloudShade;
uniform float uStars;
uniform float uTime;
uniform float uFlash;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uMoon;
uniform float uStarHue;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  // Clean pastel gradient: a wide pale band at the horizon, flat blue overhead.
  vec3 col = mix(uHorizon, uTop, smoothstep(0.02, 0.6, y));
  col = mix(col, uBottom, smoothstep(0.0, -0.2, y));
  // Theme horizon glow (lava, city light) hugging the horizon.
  col += uGlow * uGlowAmt * exp(-max(y, 0.0) * 9.0) * 0.8;

  // Sun / moon.
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.9993 - uSunSize * 0.0009, 0.9995 - uSunSize * 0.0009, sd);
  // Halo as two flat rings rather than a photographic bloom.
  float halo = step(0.9965, sd) * 0.35 + step(0.985, sd) * 0.12 + pow(max(sd, 0.0), 12.0) * 0.08;
  // Moon crescent shadow.
  vec3 off = normalize(uSunDir + vec3(0.012, 0.006, 0.0) * max(1.0, uSunSize * 0.8));
  float bite = uMoon * smoothstep(0.9994 - uSunSize * 0.0009, 0.9996 - uSunSize * 0.0009, dot(d, off));
  col += uSunColor * (disc * (1.0 - bite) * 2.2 + halo * (1.0 - uMoon * 0.6));

  // Stars.
  if (uStars > 0.0 && y > 0.0) {
    vec2 g = d.xz / (y + 0.35) * 70.0;
    vec2 cell = floor(g);
    float h = hash(cell);
    vec2 f = fract(g) - 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
    float big = step(0.996, h);
    float star = step(0.975, h) * smoothstep(0.16 + big * 0.12, 0.0, length(f));
    star *= 0.75 + 0.25 * sin(uTime * 2.0 + h * 50.0);
    vec3 sc = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.75), big);
    // Neon night: candy-coloured stars.
    sc = mix(sc, 0.6 + 0.4 * cos(6.2831 * (hash(cell + 11.3) + vec3(0.0, 0.33, 0.67))), uStarHue);
    col += sc * star * uStars * 1.6 * smoothstep(0.03, 0.3, y);
  }

  // Stylised banded clouds on a plane above the sea.
  if (y > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (y + 0.08) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv);
    float n2 = fbm(uv + uSunDir.xz * 0.12);
    // Flat cartoon cloud shapes: hard edge, lit top / tinted underside.
    float t0 = 1.0 - uCloud * 0.7;
    float cover = smoothstep(t0, t0 + 0.015, n);
    float lit = step(0.0, (n - n2) * 6.0 + 0.1);
    vec3 cc = mix(uCloudShade, uCloudColor, 0.35 + 0.65 * lit);
    cc += uSunColor * pow(max(sd, 0.0), 8.0) * 0.2;
    float fade = smoothstep(0.0, 0.12, y);
    col = mix(col, cc, cover * fade);
  }

  // Seamless hand-off to the ocean's fog at the horizon.
  col = mix(col, uFog, 1.0 - smoothstep(-0.01, 0.06, y));
  col += vec3(0.6, 0.65, 0.9) * uFlash * 0.45;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

export class Sky {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private clouds: InstancedMesh;
  private cloudData: { a: number; r: number; h: number; s: number; sp: number }[] = [];
  private towers: InstancedMesh;
  private cloudMat: MeshBasicMaterial;
  private towerData: { a: number; r: number; h: number; s: number; sp: number }[] = [];
  private center = new Vector3();

  constructor(seed: number) {
    this.material = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uBottom: { value: new Color() },
        uFog: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uSunSize: { value: 1 },
        uCloud: { value: 0.4 },
        uCloudColor: { value: new Color() },
        uCloudShade: { value: new Color() },
        uStars: { value: 0 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uGlow: { value: new Color() },
        uGlowAmt: { value: 0 },
        uMoon: { value: 0 },
        uStarHue: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(new SphereGeometry(100, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
    this.group.add(this.mesh);

    // Anime cumulus: a flat-bottomed stack of smooth puffs. Vertex colour does
    // the crisp white top / pale blue-grey underside; the toon ramp adds the
    // sun-side split.
    const rng = new Rng(seed);
    const cg = cumulusGeometry(rng, false);
    const n = 26;
    // Unlit: the painted two-tone lives in the vertex colours, like a cel background.
    const cloudMat = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: false });
    this.cloudMat = cloudMat;
    this.clouds = new InstancedMesh(cg, cloudMat, n);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    for (let i = 0; i < n; i++) {
      this.cloudData.push({ a: rng.range(0, Math.PI * 2), r: rng.range(1100, 1900), h: rng.range(170, 380), s: rng.range(60, 135), sp: rng.range(0.002, 0.006) });
    }
    // A few tall cloud towers sitting on the horizon.
    const tg = cumulusGeometry(rng, true);
    const nt = 5;
    this.towers = new InstancedMesh(tg, cloudMat, nt);
    this.towers.frustumCulled = false;
    this.towers.renderOrder = -9;
    for (let i = 0; i < nt; i++) {
      this.towerData.push({ a: (i / nt) * Math.PI * 2 + rng.range(-0.4, 0.4), r: rng.range(1900, 2150), h: rng.range(-30, 0), s: rng.range(85, 120), sp: rng.range(0.0008, 0.0016) });
    }
    this.group.add(this.towers);
    this.group.add(this.clouds);
  }

  setCloudColor(c: Color, cover: number) {
    this.cloudMat.color.copy(c);
    this.clouds.count = Math.round(this.cloudData.length * Math.min(1, cover * 1.6));
    // Towers belong to fair-weather skies; heavy overcast hides them.
    const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    this.towers.count = cover > 0.8 || lum < 0.25 ? 0 : Math.max(2, Math.round(this.towerData.length * Math.min(1, cover * 2.2)));
  }

  update(cameraPos: Vector3, time: number) {
    this.mesh.position.copy(cameraPos);
    this.material.uniforms.uTime.value = time;
    // Clouds orbit slowly around a point that lags the camera (parallax).
    this.center.set(cameraPos.x * 0.85, 0, cameraPos.z * 0.85);
    for (let i = 0; i < this.clouds.count; i++) {
      const c = this.cloudData[i];
      const a = c.a + time * c.sp;
      _p.set(this.center.x + Math.cos(a) * c.r, c.h, this.center.z + Math.sin(a) * c.r);
      _q.identity();
      _m.compose(_p, _q, _s.set(c.s, c.s * 0.55, c.s));
      this.clouds.setMatrixAt(i, _m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.towers.count; i++) {
      const c = this.towerData[i];
      const a = c.a + time * c.sp;
      _p.set(this.center.x + Math.cos(a) * c.r, c.h, this.center.z + Math.sin(a) * c.r);
      _q.identity();
      _m.compose(_p, _q, _s.set(c.s, c.s, c.s));
      this.towers.setMatrixAt(i, _m);
    }
    this.towers.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.clouds.geometry.dispose();
    this.towers.geometry.dispose();
    this.cloudMat.dispose();
  }
}

/**
 * One cumulus cluster: a wide row of base puffs, bigger domes stacked on top,
 * a flattened base. `tower` builds a tall cumulonimbus-style stack instead.
 */
function cumulusGeometry(rng: Rng, tower: boolean) {
  const gb = new GeoBuilder();
  const puff = (r: number, x: number, y: number, z: number) => gb.add(new SphereGeometry(1, 9, 6), 0xffffff, { x, y, z, s: r });
  if (!tower) {
    for (let i = 0; i < 5; i++) puff(rng.range(0.6, 0.8), -1.7 + i * 0.85, rng.range(0, 0.1), rng.range(-0.3, 0.3));
    for (let i = 0; i < 3; i++) puff(rng.range(0.85, 1.05), -0.9 + i * 0.9, rng.range(0.45, 0.7), rng.range(-0.2, 0.2));
    puff(rng.range(0.8, 0.95), rng.range(-0.3, 0.3), 1.15, 0);
  } else {
    // A broad, lumpy mass that narrows as it climbs (towering cumulus).
    const rows: [number, number, number, number][] = [
      // count, y, puff radius, half-width
      [6, 0.0, 0.8, 2.1],
      [4, 0.85, 0.95, 1.45],
      [3, 1.75, 0.88, 0.95],
      [2, 2.55, 0.78, 0.5],
      [1, 3.25, 0.8, 0],
    ];
    for (const [cnt, y, r, hw] of rows)
      for (let i = 0; i < cnt; i++) {
        const x = cnt === 1 ? rng.range(-0.15, 0.15) : -hw + (2 * hw * i) / (cnt - 1);
        puff(r * rng.range(0.9, 1.1), x + rng.range(-0.12, 0.12), y + rng.range(-0.1, 0.1), rng.range(-0.4, 0.4));
      }
  }
  const g = gb.build();
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const top = new Color(0xffffff);
  const mid = new Color(0xe6eef9);
  const under = new Color(0xb4c8e4);
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    // Flatten the base.
    if (y < 0) {
      y *= 0.25;
      pos.setY(i, y);
      nrm.setXYZ(i, nrm.getX(i) * 0.5, -1, nrm.getZ(i) * 0.5);
    }
    // Crisp two-tone: blue-grey belly, white everywhere the light reaches.
    const ny = nrm.getY(i);
    const sx = nrm.getX(i) * 0.6 + nrm.getZ(i) * 0.3;
    const c = ny < -0.3 || y < 0.12 ? under : ny + sx * 0.5 > 0.1 ? top : mid;
    col.setXYZ(i, c.r, c.g, c.b);
  }
  g.translate(0, 0.3, 0);
  return g;
}
