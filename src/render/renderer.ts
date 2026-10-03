/**
 * Renderer + post stack + adaptive resolution.
 *
 * Passes: scene → MSAA target; bright-pass (½) → down (¼) → blur H → blur V;
 * composite to screen. The composite does grading, vignette, boost radial
 * blur, chromatic aberration, speed lines, lens droplets, impact flash and
 * colour-assist daltonisation in one fullscreen draw.
 *
 * The adaptive controller owns pixel ratio. It reacts to the *median* frame
 * time (one GC hiccup cannot drop resolution), backs off fast and climbs back
 * slowly, because an oscillating resolution is worse than a slightly soft one.
 */

import {
  type Camera,
  Color,
  HalfFloatType,
  LinearFilter,
  NoToneMapping,
  type Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { dropletTexture } from './textures';
import { celShared } from './cel';
import type { PostSettings } from '../environment/atmosphere';

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const brightFrag = /* glsl */ `
uniform sampler2D tIn;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tIn, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.35, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;
const downFrag = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;
const blurFrag = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tIn, vUv).rgb * 0.227;
  c += texture2D(tIn, vUv + uDir * 1.38).rgb * 0.316;
  c += texture2D(tIn, vUv - uDir * 1.38).rgb * 0.316;
  c += texture2D(tIn, vUv + uDir * 3.23).rgb * 0.07;
  c += texture2D(tIn, vUv - uDir * 3.23).rgb * 0.07;
  gl_FragColor = vec4(c, 1.0);
}
`;

const compFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDrops;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloom;
uniform float uExposure;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uChroma;
uniform float uRadial;
uniform float uSpeed;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDrops;
uniform float uDamage;
uniform int uAssist;
varying vec2 vUv;

float h11(float n) { return fract(sin(n * 91.345) * 47453.5453); }

vec3 daltonize(vec3 c, int mode) {
  // Simulate the deficiency (LMS), take the error and shift it into visible channels.
  mat3 rgb2lms = mat3(17.8824, 3.45565, 0.0299566, 43.5161, 27.1554, 0.184309, 4.11935, 3.86714, 1.46709);
  mat3 lms2rgb = mat3(0.0809444479, -0.0102485335, -0.000365296938, -0.130504409, 0.0540193266, -0.00412161469, 0.116721066, -0.113614708, 0.693511405);
  vec3 lms = rgb2lms * c;
  vec3 s = lms;
  if (mode == 1) s = vec3(2.02344 * lms.y - 2.52581 * lms.z, lms.y, lms.z);            // protan
  else if (mode == 2) s = vec3(lms.x, 0.494207 * lms.x + 1.24827 * lms.z, lms.z);       // deutan
  else if (mode == 3) s = vec3(lms.x, lms.y, -0.395913 * lms.x + 0.801109 * lms.y);     // tritan
  vec3 sim = lms2rgb * s;
  vec3 err = c - sim;
  vec3 corr = vec3(0.0, err.r * 0.7 + err.g, err.r * 0.7 + err.b);
  return clamp(c + corr, 0.0, 4.0);
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float aspect = uRes.x / uRes.y;

  // Lens droplets refract the image.
  if (uDrops > 0.01) {
    vec4 dr = texture2D(tDrops, vec2(uv.x * aspect, uv.y) * 0.9 + vec2(0.0, uTime * 0.015));
    uv += (dr.rg - 0.5) * 0.09 * dr.b * uDrops;
  }

  float dropMask = 0.0;
  if (uDrops > 0.01) dropMask = texture2D(tDrops, vec2(vUv.x * aspect, vUv.y) * 0.9 + vec2(0.0, uTime * 0.015)).b * uDrops;
  vec3 col;
  if (uRadial > 0.005) {
    col = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float f = float(i) / 5.0;
      col += texture2D(tScene, uv - d * uRadial * 0.07 * f).rgb;
    }
    col /= 6.0;
  } else {
    col = texture2D(tScene, uv).rgb;
  }
  if (uChroma > 0.005) {
    float k = uChroma * 0.007 * dot(d, d) * 4.0;
    col.r = mix(col.r, texture2D(tScene, uv + d * k).r, 0.85);
    col.b = mix(col.b, texture2D(tScene, uv - d * k).b, 0.85);
  }
  col += texture2D(tBloom, uv).rgb * uBloom;

  // Speed lines: sparse radial streaks at the frame edge.
  if (uSpeed > 0.01) {
    float ang = atan(d.y, d.x * aspect);
    float seg = floor(ang * 160.0);
    float n = h11(seg);
    float r = length(vec2(d.x * aspect, d.y));
    float on = step(1.0 - 0.16 * uSpeed, n) * step(0.55, fract(n * 17.0 + uTime * (3.0 + n * 4.0)));
    float edge = smoothstep(0.42, 0.8, r);
    col = mix(col, vec3(1.0), on * edge * 0.22 * min(uSpeed, 1.0));
  }

  // Grade (linear): exposure, saturation, contrast around mid-grey, soft shoulder.
  col *= uExposure;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);
  col = pow(max(col, 0.0) / 0.18, vec3(uContrast)) * 0.18;
  col = mix(col, 0.8 + 0.2 * (1.0 - exp(-(col - 0.8) * 5.0)), step(0.8, col));

  // Vignette (+ red damage pulse).
  float v = smoothstep(0.85, 0.25, length(d * vec2(aspect * 0.8, 1.0)));
  col *= mix(1.0 - uVignette, 1.0, v);
  col = mix(col, vec3(0.9, 0.05, 0.05), uDamage * (1.0 - v) * 0.5);

  col += uFlashColor * uFlash;
  // Droplets catch a little light so they read as water on the lens.
  col += vec3(0.75, 0.85, 1.0) * dropMask * 0.025;
  if (uAssist > 0) col = daltonize(col, uAssist);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export type Quality = 'low' | 'medium' | 'high';

const numeric = (a: number, b: number) => a - b;

export interface ScreenFx {
  radial: number;
  chroma: number;
  speed: number;
  flash: number;
  flashColor: Color;
  drops: number;
  damage: number;
}

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly fx: ScreenFx = { radial: 0, chroma: 0, speed: 0, flash: 0, flashColor: new Color(1, 1, 1), drops: 0, damage: 0 };
  /** 0 off, 1 protan, 2 deutan, 3 tritan. */
  assist = 0;
  quality: Quality;
  /** User cap on pixel ratio; the adaptive controller works below it. */
  maxPixelRatio: number;
  pixelRatio: number;
  adaptive = true;
  motionFx = 1;

  private sceneRT!: WebGLRenderTarget;
  private brightRT!: WebGLRenderTarget;
  private downRT!: WebGLRenderTarget;
  private blurRT!: WebGLRenderTarget;
  private bright: FullScreenQuad;
  private down: FullScreenQuad;
  private blur: FullScreenQuad;
  private comp: FullScreenQuad;
  private compMat: ShaderMaterial;
  private size = new Vector2();
  private frameTimes: number[] = [];
  private sorted: number[] = [];
  private lastAdjust = 0;
  private clock = 0;
  bloomEnabled = true;
  readonly stats = { calls: 0, triangles: 0, frameMs: 16.7, fps: 60, medianMs: 16.7 };

  constructor(canvas: HTMLCanvasElement, quality: Quality, maxPixelRatio: number) {
    this.canvas = canvas;
    this.quality = quality;
    this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NoToneMapping;
    this.gl.autoClear = true;
    this.gl.info.autoReset = false;
    this.maxPixelRatio = maxPixelRatio;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

    const mk = (frag: string, uniforms: Record<string, { value: unknown }>) =>
      new FullScreenQuad(new ShaderMaterial({ uniforms, vertexShader: quadVert, fragmentShader: frag, depthTest: false, depthWrite: false }));
    this.bright = mk(brightFrag, { tIn: { value: null }, uThreshold: { value: 0.78 } });
    this.down = mk(downFrag, { tIn: { value: null }, uTexel: { value: new Vector2() } });
    this.blur = mk(blurFrag, { tIn: { value: null }, uDir: { value: new Vector2() } });
    this.compMat = new ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tDrops: { value: dropletTexture() },
        uRes: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uBloom: { value: 0.4 },
        uExposure: { value: 1 },
        uSat: { value: 1.1 },
        uContrast: { value: 1.05 },
        uVignette: { value: 0.3 },
        uChroma: { value: 0 },
        uRadial: { value: 0 },
        uSpeed: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new Color(1, 1, 1) },
        uDrops: { value: 0 },
        uDamage: { value: 0 },
        uAssist: { value: 0 },
      },
      vertexShader: quadVert,
      fragmentShader: compFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.comp = new FullScreenQuad(this.compMat);
    this.allocTargets();
    this.resize();
  }

  private allocTargets() {
    this.sceneRT?.dispose();
    this.brightRT?.dispose();
    this.downRT?.dispose();
    this.blurRT?.dispose();
    const samples = this.quality === 'low' ? 0 : 4;
    this.sceneRT = new WebGLRenderTarget(1, 1, { samples, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
    const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.brightRT = new WebGLRenderTarget(1, 1, opts);
    this.downRT = new WebGLRenderTarget(1, 1, opts);
    this.blurRT = new WebGLRenderTarget(1, 1, opts);
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.allocTargets();
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, true);
    this.gl.getDrawingBufferSize(this.size);
    const W = this.size.x;
    const H = this.size.y;
    this.sceneRT.setSize(W, H);
    this.brightRT.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.downRT.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.blurRT.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.compMat.uniforms.uRes.value.set(W, H);
    celShared.uResolution.value.set(W, H);
    // Outlines are specified in CSS pixels; scale with DPR so they look the same everywhere.
    celShared.uOutlineScale.value = this.pixelRatio;
  }

  get drawingHeight() {
    return this.size.y;
  }

  setMaxPixelRatio(v: number) {
    this.maxPixelRatio = v;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, v);
    this.resize();
  }

  /** Feed the real frame interval; adjusts pixel ratio when sustained. */
  sample(frameMs: number, now: number) {
    this.stats.frameMs = this.stats.frameMs * 0.9 + frameMs * 0.1;
    this.stats.fps = 1000 / Math.max(1, this.stats.frameMs);
    const ft = this.frameTimes;
    ft.push(frameMs);
    if (ft.length > 90) ft.shift();
    if (ft.length < 60 || !this.adaptive) return;
    const s = this.sorted;
    s.length = 0;
    for (let i = 0; i < ft.length; i++) s.push(ft[i]);
    s.sort(numeric);
    const med = s[s.length >> 1];
    this.stats.medianMs = med;
    const cap = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    if (now - this.lastAdjust < 1500) return;
    if (med > 19 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio * 0.88);
      this.lastAdjust = now;
      this.frameTimes.length = 0;
      this.resize();
    } else if (med < 12.5 && this.pixelRatio < cap - 0.01 && now - this.lastAdjust > 4000) {
      this.pixelRatio = Math.min(cap, this.pixelRatio * 1.06);
      this.lastAdjust = now;
      this.frameTimes.length = 0;
      this.resize();
    }
  }

  render(scene: Scene, camera: Camera, post: PostSettings, dt: number) {
    this.clock += dt;
    const gl = this.gl;
    gl.info.reset();
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);
    this.stats.calls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;

    const bloomOn = this.bloomEnabled && this.quality !== 'low' && post.bloom > 0.01;
    if (bloomOn) {
      const W = this.size.x;
      const H = this.size.y;
      (this.bright.material as ShaderMaterial).uniforms.tIn.value = this.sceneRT.texture;
      gl.setRenderTarget(this.brightRT);
      this.bright.render(gl);
      const dm = this.down.material as ShaderMaterial;
      dm.uniforms.tIn.value = this.brightRT.texture;
      dm.uniforms.uTexel.value.set(1 / Math.max(1, W >> 1), 1 / Math.max(1, H >> 1));
      gl.setRenderTarget(this.downRT);
      this.down.render(gl);
      const bm = this.blur.material as ShaderMaterial;
      bm.uniforms.tIn.value = this.downRT.texture;
      bm.uniforms.uDir.value.set(1.5 / Math.max(1, W >> 2), 0);
      gl.setRenderTarget(this.blurRT);
      this.blur.render(gl);
      bm.uniforms.tIn.value = this.blurRT.texture;
      bm.uniforms.uDir.value.set(0, 1.5 / Math.max(1, H >> 2));
      gl.setRenderTarget(this.downRT);
      this.blur.render(gl);
    }

    const u = this.compMat.uniforms;
    const fx = this.fx;
    const m = this.motionFx;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.downRT.texture;
    u.uBloom.value = bloomOn ? post.bloom : 0;
    u.uTime.value = this.clock;
    u.uExposure.value = post.exposure;
    u.uSat.value = post.saturation;
    u.uContrast.value = post.contrast;
    u.uVignette.value = post.vignette;
    u.uChroma.value = fx.chroma * m;
    u.uRadial.value = fx.radial * m;
    u.uSpeed.value = fx.speed * m;
    u.uFlash.value = fx.flash;
    u.uFlashColor.value.copy(fx.flashColor);
    u.uDrops.value = fx.drops * m;
    u.uDamage.value = fx.damage;
    u.uAssist.value = this.assist;
    gl.setRenderTarget(null);
    this.comp.render(gl);
    this.stats.calls = gl.info.render.calls;
  }

  dispose() {
    this.sceneRT.dispose();
    this.brightRT.dispose();
    this.downRT.dispose();
    this.blurRT.dispose();
    this.gl.dispose();
  }
}

