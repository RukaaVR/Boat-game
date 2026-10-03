/**
 * GPU ↔ CPU wave-field agreement check.
 *
 * Renders one fragment per sample point with a shader that calls the shared
 * `oceanAtWorld()` GLSL, writes the height into a float render target, reads it
 * back and compares with the CPU `oceanHeight()` at the same world points and
 * time. If the two implementations ever diverge, boats float or sink — this
 * turns that rule into a number.
 */

import { BufferAttribute, BufferGeometry, FloatType, NearestFilter, OrthographicCamera, Points, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { oceanHeight, WAVE_GLSL, waveUniforms } from '../water/waves';

export function waveAgreement(gl: WebGLRenderer, samples = 256, time = 12.34) {
  const W = 16;
  const H = Math.ceil(samples / W);
  const pos = new Float32Array(samples * 3);
  const world = new Float32Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    const px = ((i % W) + 0.5) / W;
    const py = (Math.floor(i / W) + 0.5) / H;
    pos[i * 3] = px * 2 - 1;
    pos[i * 3 + 1] = py * 2 - 1;
    // Spread sample points over a few hundred metres, including swell zones.
    world[i * 2] = Math.sin(i * 12.9898) * 400;
    world[i * 2 + 1] = Math.cos(i * 78.233) * 400;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aWorld', new BufferAttribute(world, 2));
  const mat = new ShaderMaterial({
    uniforms: { ...waveUniforms },
    vertexShader: `${WAVE_GLSL}
      attribute vec2 aWorld;
      varying float vH;
      void main() {
        vH = oceanAtWorld(aWorld, uTime).y;
        gl_Position = vec4(position.xy, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    fragmentShader: `varying float vH; void main() { gl_FragColor = vec4(vH, 0.0, 0.0, 1.0); }`,
  });
  const prevTime = waveUniforms.uTime.value;
  waveUniforms.uTime.value = time;
  const rt = new WebGLRenderTarget(W, H, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  const scene = new Scene();
  scene.add(new Points(geo, mat));
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.clear();
  gl.render(scene, cam);
  const buf = new Float32Array(W * H * 4);
  gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  gl.setRenderTarget(prev);
  waveUniforms.uTime.value = prevTime;
  let maxErr = 0;
  let sumErr = 0;
  let maxH = 0;
  for (let i = 0; i < samples; i++) {
    const cpu = oceanHeight(world[i * 2], world[i * 2 + 1], time);
    const gpu = buf[i * 4];
    const e = Math.abs(cpu - gpu);
    maxErr = Math.max(maxErr, e);
    sumErr += e;
    maxH = Math.max(maxH, Math.abs(cpu));
  }
  geo.dispose();
  mat.dispose();
  rt.dispose();
  return { samples, maxErr, meanErr: sumErr / samples, maxHeight: maxH };
}
