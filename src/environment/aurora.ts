/**
 * Northern lights for the arctic courses: an open cylinder of animated light
 * curtains high around the horizon, following the camera like the sky dome.
 * Strength follows the darkness of the sky (bright at night, faint by day).
 */

import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, type Vector3 } from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float x = vUv.x * 40.0;
  // Folded curtains: a slowly moving ribbon with fine vertical rays.
  float fold = noise(x * 0.35 + uTime * 0.05) * 0.6 + noise(x * 0.9 - uTime * 0.08) * 0.4;
  float base = 0.18 + fold * 0.35;
  float h = vUv.y - base;
  float band = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.05, 0.55, h));
  float rays = 0.55 + 0.45 * noise(x * 7.0 + uTime * 0.6);
  float flicker = 0.75 + 0.25 * noise(x * 2.0 + uTime * 1.3);
  float a = band * rays * flicker * uStrength;
  vec3 green = vec3(0.25, 1.0, 0.55);
  vec3 violet = vec3(0.65, 0.3, 1.0);
  vec3 col = mix(green, violet, smoothstep(0.08, 0.5, h));
  gl_FragColor = vec4(col * a, a);
}`;

export class Aurora {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor() {
    const g = new CylinderGeometry(2600, 2600, 1100, 96, 1, true);
    g.translate(0, 900, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(cam: Vector3, time: number, night: number) {
    this.mesh.position.set(cam.x, 0, cam.z);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uStrength.value = 0.12 + 0.9 * night;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
