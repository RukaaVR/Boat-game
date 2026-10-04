/**
 * Drift energy flares: camera-facing star sprites at a boat's stern corners
 * while a drift is charging, coloured by tier (blue → orange → purple) and
 * growing with it. One instanced draw call for the whole field; billboarding
 * happens in the vertex shader, so the CPU only writes positions.
 */

import { AdditiveBlending, Color, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { sparkleTexture } from './textures';

const vert = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
uniform float uTime;
void main() {
  vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  float a = uTime * 3.0 + float(gl_InstanceID) * 1.7;
  float c = cos(a), s = sin(a);
  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  mv.xy += p * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = instanceColor;
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  // White-hot core, tier colour on the points: crisp, toon-like.
  vec3 col = mix(vColor, vec3(1.0), smoothstep(0.55, 0.9, t.r) * 0.8);
  gl_FragColor = vec4(col * t.a, t.a);
}`;

const _m = new Matrix4();
const _v = new Vector3();

export class DriftGlow {
  readonly mesh: InstancedMesh;
  private mat: ShaderMaterial;
  private n = 0;

  constructor(max: number) {
    this.mat = new ShaderMaterial({
      uniforms: { uMap: { value: sparkleTexture() }, uTime: { value: 0 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.mat, Math.max(1, max));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    // Allocate the colour buffer up front.
    this.mesh.setColorAt(0, new Color(1, 1, 1));
  }

  begin(time: number) {
    this.n = 0;
    this.mat.uniforms.uTime.value = time;
  }

  add(x: number, y: number, z: number, size: number, color: Color) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    _m.makeScale(size, size, size);
    _m.setPosition(_v.set(x, y, z));
    this.mesh.setMatrixAt(this.n, _m);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
