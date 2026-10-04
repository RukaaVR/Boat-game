/**
 * Renderer + post stack + adaptive resolution.
 *
 * Passes: scene → MSAA target; bright-pass (½) → down (¼) → blur H → blur V;
 * composite to screen. The composite does grading, vignette, boost radial
 * blur, chromatic aberration, manga speed lines, lens droplets, impact frame, flash and
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
import { A11Y } from '../core/a11y';

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
uniform float uImpact;
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

  // Impact frame: for a frame or two the image is crushed to two-tone ink
  // (cream highlights / navy shadows), like an anime hit frame.
  if (uImpact > 0.01) {
    float il = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 ink = mix(vec3(0.04, 0.06, 0.18), vec3(1.0, 0.97, 0.88), step(0.55, il));
    col = mix(col, ink, uImpact * 0.6);
  }

  // Manga speed lines: hard-edged white wedges converging on the frame
  // centre, clear in the middle, re-drawn on a stepped clock ("boiling").
  float sl = max(min(uSpeed, 1.3), uImpact * 1.1);
  if (sl > 0.01) {
    vec2 p = vec2(d.x * aspect, d.y);
    float r = length(p);
    float N = 120.0;
    float a = atan(p.y, p.x) / 6.2831853 * N;
    float seg = floor(a);
    float f = fract(a) - 0.5;
    float tick = floor(uTime * 15.0);
    float n = h11(seg + tick * 37.13);
    float n2 = h11(seg * 1.73 + tick * 11.9 + 3.1);
    float on = step(1.0 - (0.16 + 0.4 * clamp(sl, 0.0, 1.0)), n);
    float r0 = mix(0.7, 0.44, clamp(sl * 0.8, 0.0, 1.0)) + n2 * 0.18;
    float taper = sqrt(clamp((r - r0) / 0.4, 0.0, 1.0));
    float w = (0.1 + 0.32 * n2) * taper;
    float px = N / (6.2831853 * max(r, 1e-3) * uRes.y);
    float line = on * clamp((w - abs(f)) / px, 0.0, 1.0);
    col = mix(col, vec3(1.0), line * min(sl, 1.0) * 0.8);
  }

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
  /** 0..1 anime "impact frame" (two-tone ink flash + burst lines), ~2 frames long. */
  impact: number;
  flashColor: Color;
  drops: number;
  damage: number;
}

const _clear = new Color();
const _slate = new Color(0.02, 0.035, 0.09);

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly fx: ScreenFx = { radial: 0, chroma: 0, speed: 0, flash: 0, impact: 0, flashColor: new Color(1, 1, 1), drops: 0, damage: 0 };
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
    // High threshold: only true highlights glow, so flat white foam and clouds
    // stay crisp instead of haloing (toon look).
    this.bright = mk(brightFrag, { tIn: { value: null }, uThreshold: { value: 0.95 } });
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
        uImpact: { value: 0 },
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
    celShared.uOutlineScale.value = this.outlinesEnabled ? this.pixelRatio : 0;
  }
  private outlinesOn = true;
  /** Admin toggle; survives resizes and adaptive-resolution changes. */
  get outlinesEnabled() {
    return this.outlinesOn;
  }
  set outlinesEnabled(on: boolean) {
    this.outlinesOn = on;
    celShared.uOutlineScale.value = on ? this.pixelRatio : 0;
  }

  get drawingHeight() {
    return this.size.y;
  }

  /** True when the adaptive controller has no resolution left to give. */
  get atMinResolution() {
    return !this.adaptive || this.pixelRatio <= 0.61;
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
    if (ft.length < 60) return;
    const s = this.sorted;
    s.length = 0;
    for (let i = 0; i < ft.length; i++) s.push(ft[i]);
    s.sort(numeric);
    const med = s[s.length >> 1];
    this.stats.medianMs = med;
    if (!this.adaptive) return;
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
    this.postProcess(post);
  }

  /**
   * Split-screen: each camera renders into its own horizontal band of the
   * scene target (top band first), then one shared post pass. `prepare` runs
   * before each view (re-centre camera-following meshes like the ocean).
   */
  renderSplit(scene: Scene, cameras: Camera[], post: PostSettings, dt: number, prepare: (cam: Camera) => void) {
    this.clock += dt;
    const gl = this.gl;
    gl.info.reset();
    const W = this.size.x;
    const H = this.size.y;
    const n = cameras.length;
    const band = Math.floor(H / n);
    const rt = this.sceneRT;
    for (let i = 0; i < n; i++) {
      const y = H - band * (i + 1);
      rt.viewport.set(0, y, W, band);
      rt.scissor.set(0, y, W, band);
      rt.scissorTest = true;
      prepare(cameras[i]);
      celShared.uResolution.value.set(W, band);
      gl.setRenderTarget(rt);
      gl.render(scene, cameras[i]);
    }
    celShared.uResolution.value.set(W, H);
    rt.viewport.set(0, 0, W, H);
    rt.scissor.set(0, 0, W, H);
    rt.scissorTest = false;
    gl.setRenderTarget(rt);
    this.stats.calls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;
    this.postProcess(post);
  }

  /**
   * Split-screen grid (3–4 players): camera i renders into `rects[i]`
   * ([x, y, w, h] as fractions of the screen, origin top-left), then one shared
   * post pass. Extra rects without a camera (the 3-player spare quarter) are
   * cleared to a dark slate so the overview panel sits on a clean backdrop.
   */
  renderGrid(scene: Scene, cameras: Camera[], rects: readonly (readonly [number, number, number, number])[], post: PostSettings, dt: number, prepare: (cam: Camera) => void) {
    this.clock += dt;
    const gl = this.gl;
    gl.info.reset();
    const W = this.size.x;
    const H = this.size.y;
    const rt = this.sceneRT;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const x = Math.round(r[0] * W);
      const w = Math.round((r[0] + r[2]) * W) - x;
      const yTop = Math.round(r[1] * H);
      const h = Math.round((r[1] + r[3]) * H) - yTop;
      const y = H - yTop - h;
      rt.viewport.set(x, y, w, h);
      rt.scissor.set(x, y, w, h);
      rt.scissorTest = true;
      gl.setRenderTarget(rt);
      const cam = cameras[i];
      if (!cam) {
        gl.getClearColor(_clear);
        const a = gl.getClearAlpha();
        gl.setClearColor(_slate, 1);
        gl.clear(true, true, false);
        gl.setClearColor(_clear, a);
        continue;
      }
      prepare(cam);
      celShared.uResolution.value.set(w, h);
      gl.render(scene, cam);
    }
    celShared.uResolution.value.set(W, H);
    rt.viewport.set(0, 0, W, H);
    rt.scissor.set(0, 0, W, H);
    rt.scissorTest = false;
    gl.setRenderTarget(rt);
    this.stats.calls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;
    this.postProcess(post);
  }

  private postProcess(post: PostSettings) {
    const gl = this.gl;
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
    // Anime look: colour fringing and lens droplets are photographic effects,
    // so keep only a trace of each (speed lines carry the sense of speed).
    u.uChroma.value = fx.chroma * m * 0.15;
    u.uRadial.value = fx.radial * m;
    u.uSpeed.value = fx.speed * m;
    u.uFlash.value = fx.flash * A11Y.flash;
    // Reduced-motion setting also tones down the strobe-like impact frame.
    u.uImpact.value = fx.impact * m * A11Y.flash;
    u.uFlashColor.value.copy(fx.flashColor);
    u.uDrops.value = fx.drops * m * 0.25;
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

