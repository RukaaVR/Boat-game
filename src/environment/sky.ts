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
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { Rng } from '../core/rng';
import { cel } from '../render/cel';
import { GeoBuilder, lumpify } from '../render/geo';

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
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.75, y), 0.8));
  col = mix(col, uBottom, smoothstep(0.0, -0.2, y));
  // Theme horizon glow (lava, city light) hugging the horizon.
  col += uGlow * uGlowAmt * exp(-max(y, 0.0) * 9.0) * 0.8;

  // Sun / moon.
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.9993 - uSunSize * 0.0009, 0.9995 - uSunSize * 0.0009, sd);
  float halo = pow(max(sd, 0.0), 160.0) * 0.6 + pow(max(sd, 0.0), 12.0) * 0.18;
  // Moon crescent shadow.
  vec3 off = normalize(uSunDir + vec3(0.012, 0.006, 0.0));
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
    col += mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.75), big) * star * uStars * 1.6 * smoothstep(0.03, 0.3, y);
  }

  // Stylised banded clouds on a plane above the sea.
  if (y > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (y + 0.08) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv);
    float n2 = fbm(uv + uSunDir.xz * 0.12);
    float cover = smoothstep(1.0 - uCloud * 0.85, 1.05 - uCloud * 0.55, n);
    float lit = clamp((n - n2) * 6.0 + 0.55, 0.0, 1.0);
    lit = floor(lit * 3.0 + 0.5) / 3.0; // cel bands
    vec3 cc = mix(uCloudShade, uCloudColor, lit);
    cc += uSunColor * pow(max(sd, 0.0), 8.0) * 0.35 * (1.0 - cover * 0.5);
    float fade = smoothstep(0.0, 0.12, y);
    col = mix(col, cc, cover * fade * 0.95);
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

    // Cumulus clusters: merged lumpy spheres, instanced around the horizon.
    const gb = new GeoBuilder();
    const rng = new Rng(seed);
    for (let i = 0; i < 7; i++) {
      const g = new IcosahedronGeometry(1, 2);
      lumpify(g, 0.12, i * 2.3);
      gb.add(g, 0xffffff, { x: rng.range(-1.6, 1.6), y: rng.range(0, 0.5), z: rng.range(-0.6, 0.6), sx: rng.range(0.9, 1.4), sy: rng.range(0.7, 1.0), sz: rng.range(0.9, 1.3) });
    }
    const cg = gb.build();
    cg.translate(0, 0.3, 0);
    // Flatten the base.
    const pos = cg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.25);
    cg.computeVertexNormals();
    const n = 26;
    this.clouds = new InstancedMesh(cg, cel('cloud', { color: 0xffffff, rim: 1.5, fog: false }), n);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    for (let i = 0; i < n; i++) {
      this.cloudData.push({ a: rng.range(0, Math.PI * 2), r: rng.range(1100, 1900), h: rng.range(170, 380), s: rng.range(55, 130), sp: rng.range(0.002, 0.006) });
    }
    this.group.add(this.clouds);
  }

  setCloudColor(c: Color, cover: number) {
    (this.clouds.material as import('three').MeshToonMaterial).color.copy(c);
    this.clouds.count = Math.round(this.cloudData.length * Math.min(1, cover * 1.6));
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
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.clouds.geometry.dispose();
  }
}
