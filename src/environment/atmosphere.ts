/**
 * Atmosphere: applies a weather preset (+ theme accents) to every system that
 * cares — lights, fog, sky, ocean, wakes, cel uniforms, post grading — and runs
 * the live weather effects: GPU rain streaks and lightning (flash + bolt +
 * thunder event).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Scene,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import { Rng } from '../core/rng';
import type { EventQueue } from '../core/events';
import type { ThemeId, WeatherId } from '../core/types';
import { celShared } from '../render/cel';
import { THEME_STYLE, WEATHER, type WeatherPreset } from './weatherDefs';
import type { Sky } from './sky';
import type { Ocean } from '../water/ocean';
import type { WakeSystem } from '../water/wake';
import { MAX_WATER_LIGHTS } from '../water/ocean';
import type { WaterLight } from './scenery';
import { maxWaveHeight } from '../water/waves';

const rainVert = /* glsl */ `
attribute float aSeed;
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
uniform vec2 uWind;
varying float vA;
void main() {
  float s = aSeed;
  vec3 box = vec3(70.0, 46.0, 70.0);
  vec3 p = vec3(fract(s * 0.6180339) , fract(s * 0.4142135 + 0.3), fract(s * 0.7320508 + 0.7)) * box;
  float fall = 32.0 + fract(s * 3.17) * 10.0;
  p.y -= uTime * fall;
  p.xz += uWind * uTime * 0.8;
  // Wrap around the camera.
  p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
  p.y = max(p.y, uCam.y - 23.0);
  vec3 tail = vec3(uWind.x, -fall, uWind.y) * 0.035;
  p += tail * aEnd;
  vA = 0.12 + 0.2 * fract(s * 5.3);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const rainFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA * uAmount);
}
`;

export interface PostSettings {
  bloom: number;
  exposure: number;
  saturation: number;
  contrast: number;
  vignette: number;
}

const _sunDir = new Vector3();
const _c = new Color();

export class Atmosphere {
  readonly sun = new DirectionalLight(0xffffff, 2);
  readonly hemi = new HemisphereLight(0xffffff, 0x223344, 1);
  readonly fog = new FogExp2(0xffffff, 0.001);
  readonly post: PostSettings = { bloom: 0.4, exposure: 1, saturation: 1.1, contrast: 1.05, vignette: 0.3 };
  preset: WeatherPreset = WEATHER.clear;
  theme: ThemeId = 'tropical';
  /** 0..1 lightning flash for this frame. */
  flash = 0;
  night = 0;
  readonly sunDir = new Vector3(0, 1, 0);
  private rain: LineSegments;
  private rainMat: ShaderMaterial;
  private bolt: LineSegments;
  private boltT = 0;
  private nextStrike = 6;
  private flashT = 10;
  private rng = new Rng(1234);
  private time = 0;
  rainScale = 1;

  constructor(
    readonly scene: Scene,
    readonly sky: Sky,
    readonly events: EventQueue,
    quality: 'low' | 'medium' | 'high',
  ) {
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;

    const N = quality === 'high' ? 6000 : quality === 'medium' ? 3500 : 1500;
    const seeds = new Float32Array(N * 2);
    const ends = new Float32Array(N * 2);
    const pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      seeds[i * 2] = seeds[i * 2 + 1] = i + 0.5;
      ends[i * 2] = 0;
      ends[i * 2 + 1] = 1;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    g.setAttribute('aEnd', new BufferAttribute(ends, 1));
    this.rainMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uWind: { value: { x: 4, y: 2 } },
        uColor: { value: new Color(0xc8d8e8) },
        uAmount: { value: 1 },
      },
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    this.rain.visible = false;
    scene.add(this.rain);

    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(new Float32Array(64 * 3), 3));
    this.bolt = new LineSegments(bg, new LineBasicMaterial({ color: 0xe8f0ff, transparent: true, blending: AdditiveBlending, fog: false, depthWrite: false }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    scene.add(this.bolt);
  }

  apply(weather: WeatherId, theme: ThemeId, ocean: Ocean | null, wake: WakeSystem | null, lights: WaterLight[], override?: WeatherPreset) {
    const w = (this.preset = override ?? WEATHER[weather]);
    this.theme = theme;
    const ts = THEME_STYLE[theme];
    this.night = weather === 'night' ? 1 : weather === 'storm' ? 0.35 : weather === 'sunset' ? 0.3 : 0;

    _sunDir.set(Math.cos(w.sunElev) * Math.cos(w.sunAzim), Math.sin(w.sunElev), Math.cos(w.sunElev) * Math.sin(w.sunAzim)).normalize();
    this.sunDir.copy(_sunDir);
    this.sun.color.setHex(w.sunColor);
    this.sun.intensity = w.sunIntensity;
    this.hemi.color.setHex(w.hemiSky);
    this.hemi.groundColor.setHex(w.hemiGround);
    this.hemi.intensity = w.hemiIntensity;
    this.fog.color.setHex(w.fogColor);
    this.fog.density = w.fogDensity;

    const su = this.sky.material.uniforms;
    su.uTop.value.setHex(w.skyTop);
    su.uHorizon.value.setHex(w.skyHorizon);
    su.uBottom.value.setHex(w.skyBottom);
    su.uFog.value.setHex(w.fogColor);
    su.uSunDir.value.copy(_sunDir);
    su.uSunColor.value.setHex(w.sunColor);
    su.uSunSize.value = w.sunSize;
    su.uCloud.value = w.cloudCover;
    su.uCloudColor.value.setHex(w.cloudColor);
    su.uCloudShade.value.setHex(w.cloudShade);
    su.uStars.value = w.stars;
    su.uGlow.value.setHex(ts.horizonGlow);
    su.uGlowAmt.value = ts.horizonGlowAmt * (0.5 + this.night);
    su.uMoon.value = weather === 'night' ? 1 : 0;
    this.sky.setCloudColor(_c.setHex(w.cloudColor), w.cloudCover);

    if (ocean) {
      const ou = ocean.material.uniforms;
      ou.uDeep.value.setHex(w.waterDeep);
      ou.uMid.value.setHex(w.waterMid);
      ou.uShallow.value.setHex(theme === 'volcanic' ? 0x2a4a4a : w.waterShallow);
      ou.uFoam.value.setHex(w.waterFoam);
      ou.uCrest.value.setHex(w.waterCrest);
      ou.uSkyTop.value.setHex(w.skyTop);
      ou.uSkyHorizon.value.setHex(w.skyHorizon);
      ou.uSunDir.value.copy(_sunDir);
      ou.uSunColor.value.setHex(w.sunColor);
      ou.uSunGlint.value = weather === 'storm' ? 0.15 : weather === 'night' ? 0.6 : 1;
      ou.uFogColor.value.setHex(w.fogColor);
      ou.uFogDensity.value = w.fogDensity;
      ou.uAmp.value = maxWaveHeight() * 0.45;
      ou.uFoamAmount.value = weather === 'storm' ? 1.6 : 1;
      ou.uMicro.value = weather === 'storm' ? 0.5 : 0.32;
      const lp = ou.uLightPos.value as import('three').Vector4[];
      const lc = ou.uLightCol.value as Color[];
      for (let i = 0; i < MAX_WATER_LIGHTS; i++) {
        const L = lights[i];
        if (L) {
          lp[i].set(L.x, L.y, L.z, L.intensity * (0.25 + 0.75 * this.night));
          lc[i].setHex(L.color);
        } else lp[i].set(0, 0, 0, 0);
      }
    }
    if (wake) {
      wake.wakeMat.uniforms.uFoam.value.setHex(w.waterFoam);
      wake.collarMat.uniforms.uFoam.value.setHex(w.waterFoam);
      wake.wakeMat.uniforms.uFogColor.value.setHex(w.fogColor);
      wake.wakeMat.uniforms.uFogDensity.value = w.fogDensity;
      // Wind-blown storm seas are already white; keep trails from dominating.
      wake.wakeMat.uniforms.uOpacity.value = weather === 'storm' ? 0.55 : weather === 'night' ? 0.8 : 1;
    }

    celShared.uRimColor.value.setHex(w.sunColor).lerp(_c.setHex(w.skyHorizon), 0.4);
    celShared.uRim.value = weather === 'night' ? 0.7 : 0.45;
    celShared.uSpecColor.value.setHex(w.sunColor);
    celShared.uOutlineColor.value.setHex(weather === 'night' ? 0x05070f : weather === 'storm' ? 0x0c1016 : 0x141826);
    celShared.uWind.value = w.wind;

    this.post.bloom = w.bloom;
    this.post.exposure = w.exposure;
    this.post.saturation = w.saturation;
    this.post.contrast = w.contrast;
    this.post.vignette = w.vignette;

    this.rain.visible = w.rain > 0;
    this.rainMat.uniforms.uAmount.value = w.rain;
    this.rainMat.uniforms.uWind.value = { x: 5 * w.wind, y: 2.5 * w.wind };
    this.nextStrike = 4 + this.rng.range(0, 6);
  }

  /** Per-frame: lightning, rain follow, view-space sun for cel specular. */
  update(dt: number, camera: Camera, ocean: Ocean | null) {
    this.time += dt;
    const w = this.preset;
    this.rainMat.uniforms.uTime.value = this.time;
    this.rainMat.uniforms.uCam.value.copy(camera.position);
    this.rain.visible = w.rain > 0 && this.rainScale > 0;
    this.rainMat.uniforms.uAmount.value = w.rain * this.rainScale;

    // Lightning.
    if (w.lightning) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = this.rng.range(5, 13);
        this.flashT = 0;
        this.strikeBolt(camera);
        this.events.push('lightning', -1, 0, 0, 0, this.rng.range(0.6, 1));
      }
    }
    this.flashT += dt;
    const t = this.flashT;
    // Double flash envelope.
    this.flash = t < 0.6 ? Math.max(0, 1 - t / 0.12) * 0.9 + (t > 0.18 ? Math.max(0, 1 - (t - 0.18) / 0.3) * 0.7 : 0) : 0;
    this.boltT -= dt;
    this.bolt.visible = this.boltT > 0;
    (this.bolt.material as LineBasicMaterial).opacity = Math.max(0, this.boltT / 0.35);

    this.sky.material.uniforms.uFlash.value = this.flash;
    if (ocean) ocean.material.uniforms.uFlash.value = this.flash;
    this.hemi.intensity = w.hemiIntensity * (1 + this.flash * 1.6);

    // Sun direction in view space for the cel specular term.
    celShared.uSunView.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    this.sun.position.copy(camera.position).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(camera.position);
  }

  private strikeBolt(camera: Camera) {
    const pos = this.bolt.geometry.getAttribute('position') as BufferAttribute;
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(380, 800);
    let x = camera.position.x + Math.cos(a) * d;
    let z = camera.position.z + Math.sin(a) * d;
    let y = 380;
    let k = 0;
    for (let i = 0; i < 32; i++) {
      const nx = x + this.rng.range(-18, 18);
      const nz = z + this.rng.range(-18, 18);
      const ny = y - this.rng.range(8, 16);
      pos.setXYZ(k++, x, y, z);
      pos.setXYZ(k++, nx, ny, nz);
      x = nx;
      y = ny;
      z = nz;
      if (y < 0) break;
    }
    for (; k < 64; k++) pos.setXYZ(k, x, y, z);
    pos.needsUpdate = true;
    this.boltT = 0.35;
  }

  dispose() {
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.bolt.geometry.dispose();
    this.scene.remove(this.rain, this.bolt, this.sun, this.sun.target, this.hemi);
  }
}
