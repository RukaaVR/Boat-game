import type { ThemeId, WeatherId } from '../core/types';

/**
 * Weather presets. One preset drives sky, light, fog, water colour, sea state,
 * particles, grading and ambience. Theme tints are layered on top.
 */
export interface WeatherPreset {
  id: WeatherId;
  name: string;
  sea: number;
  chop: number;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  sunColor: number;
  /** Elevation and azimuth of the sun (or moon), radians. */
  sunElev: number;
  sunAzim: number;
  sunSize: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogDensity: number;
  waterDeep: number;
  waterMid: number;
  waterShallow: number;
  waterFoam: number;
  waterCrest: number;
  cloudCover: number;
  cloudColor: number;
  cloudShade: number;
  stars: number;
  rain: number;
  lightning: boolean;
  bloom: number;
  exposure: number;
  saturation: number;
  contrast: number;
  vignette: number;
  wind: number;
}

export const WEATHER: Record<WeatherId, WeatherPreset> = {
  clear: {
    id: 'clear',
    name: 'CLEAR',
    sea: 1.0,
    chop: 1.0,
    skyTop: 0x3f9ff0,
    skyHorizon: 0xcfeeff,
    skyBottom: 0xb6e2f7,
    sunColor: 0xfff8e6,
    sunElev: 0.42,
    sunAzim: 0.6,
    sunSize: 1.0,
    sunIntensity: 2.3,
    hemiSky: 0xd2ecff,
    hemiGround: 0x5aa2c4,
    hemiIntensity: 1.55,
    fogColor: 0xc4e6fa,
    fogDensity: 0.0015,
    waterDeep: 0x1474cc,
    waterMid: 0x1ba3ea,
    waterShallow: 0x5fe8e0,
    waterFoam: 0xffffff,
    waterCrest: 0x58cdf6,
    cloudCover: 0.35,
    cloudColor: 0xffffff,
    cloudShade: 0xc4dcf4,
    stars: 0,
    rain: 0,
    lightning: false,
    bloom: 0.12,
    exposure: 1.0,
    saturation: 1.2,
    contrast: 1.0,
    vignette: 0.08,
    wind: 0.6,
  },
  sunset: {
    id: 'sunset',
    name: 'SUNSET',
    sea: 1.1,
    chop: 1.05,
    skyTop: 0x4b4fae,
    skyHorizon: 0xffb27a,
    skyBottom: 0xf09a86,
    sunColor: 0xffc58a,
    sunElev: 0.1,
    sunAzim: 2.2,
    sunSize: 1.7,
    sunIntensity: 2.2,
    hemiSky: 0xffc4a0,
    hemiGround: 0x6a5aa0,
    hemiIntensity: 1.3,
    fogColor: 0xf6ae92,
    fogDensity: 0.0013,
    waterDeep: 0x33449c,
    waterMid: 0x4a6ac4,
    waterShallow: 0x5ccac6,
    waterFoam: 0xfff2e6,
    waterCrest: 0x7d8fe0,
    cloudCover: 0.45,
    cloudColor: 0xffd2b0,
    cloudShade: 0xa47aa8,
    stars: 0.15,
    rain: 0,
    lightning: false,
    bloom: 0.25,
    exposure: 1.02,
    saturation: 1.18,
    contrast: 1.0,
    vignette: 0.1,
    wind: 0.5,
  },
  storm: {
    id: 'storm',
    name: 'STORM',
    sea: 1.75,
    chop: 1.3,
    skyTop: 0x43546a,
    skyHorizon: 0x8b9bad,
    skyBottom: 0x6a7a8c,
    sunColor: 0xd8e4f0,
    sunElev: 0.5,
    sunAzim: 1.4,
    sunSize: 0.0,
    sunIntensity: 1.3,
    hemiSky: 0x9fb0c4,
    hemiGround: 0x3a4e60,
    hemiIntensity: 1.3,
    fogColor: 0x8090a2,
    fogDensity: 0.0036,
    waterDeep: 0x1b4a66,
    waterMid: 0x2a6e8c,
    waterShallow: 0x4aa0a2,
    waterFoam: 0xf0f6fa,
    waterCrest: 0x4e98b2,
    cloudCover: 0.95,
    cloudColor: 0x9eacba,
    cloudShade: 0x5c6a7c,
    stars: 0,
    rain: 1,
    lightning: true,
    bloom: 0.12,
    exposure: 0.98,
    saturation: 1.0,
    contrast: 1.0,
    vignette: 0.16,
    wind: 1.6,
  },
  night: {
    id: 'night',
    name: 'NIGHT',
    sea: 1.05,
    chop: 1.0,
    skyTop: 0x0b1844,
    skyHorizon: 0x2c478a,
    skyBottom: 0x1a2c64,
    sunColor: 0xb8d0ff,
    sunElev: 0.36,
    sunAzim: -0.9,
    sunSize: 0.8,
    sunIntensity: 1.0,
    hemiSky: 0x6a80c8,
    hemiGround: 0x1c2c5c,
    hemiIntensity: 1.05,
    fogColor: 0x1e2e64,
    fogDensity: 0.0016,
    waterDeep: 0x0a2256,
    waterMid: 0x133e88,
    waterShallow: 0x1a7a9e,
    waterFoam: 0xcfe2ff,
    waterCrest: 0x2d68b8,
    cloudCover: 0.3,
    cloudColor: 0x3a4c88,
    cloudShade: 0x1a2656,
    stars: 1,
    rain: 0,
    lightning: false,
    bloom: 0.5,
    exposure: 1.05,
    saturation: 1.15,
    contrast: 1.0,
    vignette: 0.16,
    wind: 0.5,
  },
};

export const WEATHER_IDS: WeatherId[] = ['clear', 'sunset', 'storm', 'night'];

const COLOR_KEYS = new Set(['skyTop', 'skyHorizon', 'skyBottom', 'sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'waterDeep', 'waterMid', 'waterShallow', 'waterFoam', 'waterCrest', 'cloudColor', 'cloudShade']);
function lerpHex(a: number, b: number, k: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
/** A preset part-way from `a` to `b` (mid-race weather changes). */
export function blendWeather(a: WeatherPreset, b: WeatherPreset, k: number): WeatherPreset {
  const out = { ...(k < 0.5 ? a : b) } as unknown as Record<string, unknown>;
  for (const key of Object.keys(a) as (keyof WeatherPreset)[]) {
    const va = a[key];
    const vb = b[key];
    if (typeof va !== 'number' || typeof vb !== 'number') continue;
    out[key] = COLOR_KEYS.has(key) ? lerpHex(va, vb, k) : va + (vb - va) * k;
  }
  // Rain should arrive late and leave early, so it never pours from a clear sky.
  out.rain = Math.min(a.rain, b.rain) + Math.abs(b.rain - a.rain) * (b.rain > a.rain ? Math.max(0, k * 2 - 1) : Math.max(0, 1 - k * 2));
  return out as unknown as WeatherPreset;
}

/** Per-theme accents layered over the weather. */
export interface ThemeStyle {
  /** Emissive accent used for lights, lava, neon. */
  glow: number;
  glow2: number;
  rock: number;
  rockDark: number;
  sand: number;
  grass: number;
  /** Added horizon glow colour and strength (lava, city light pollution). */
  horizonGlow: number;
  horizonGlowAmt: number;
  /** Ambient airborne particles: 0 none, 1 embers/ash, 2 sea mist. */
  ambientFx: number;
  buoyLeft: number;
  buoyRight: number;
}

export const THEME_STYLE: Record<ThemeId, ThemeStyle> = {
  tropical: { glow: 0xffd34d, glow2: 0x3dffe0, rock: 0x8a7f73, rockDark: 0x4d4640, sand: 0xf3dfa6, grass: 0x4fb84a, horizonGlow: 0xffffff, horizonGlowAmt: 0, ambientFx: 0, buoyLeft: 0xff4a3d, buoyRight: 0xfff4e0 },
  storm: { glow: 0xfff0b0, glow2: 0x9fd7ff, rock: 0x4c535a, rockDark: 0x24292e, sand: 0x8c8676, grass: 0x3f5a3a, horizonGlow: 0x9fb4c8, horizonGlowAmt: 0.1, ambientFx: 2, buoyLeft: 0xff5a2a, buoyRight: 0xf2f2f2 },
  neon: { glow: 0xff2fa8, glow2: 0x26e8ff, rock: 0x4a4e5c, rockDark: 0x252836, sand: 0x6a6a72, grass: 0x3a4a3a, horizonGlow: 0xff4fd8, horizonGlowAmt: 0.25, ambientFx: 0, buoyLeft: 0xff2fa8, buoyRight: 0x26e8ff },
  arctic: { glow: 0x9fe8ff, glow2: 0xb6ffd8, rock: 0xdfeaf2, rockDark: 0x8fa6b8, sand: 0xf4f8fc, grass: 0xe8f0f6, horizonGlow: 0x7fffd0, horizonGlowAmt: 0.12, ambientFx: 3, buoyLeft: 0xff3b5c, buoyRight: 0x1e2a44 },
  jungle: { glow: 0xffe26a, glow2: 0x7dff6a, rock: 0x5e6b4e, rockDark: 0x2f3a28, sand: 0x9a8058, grass: 0x2f7d32, horizonGlow: 0xffffff, horizonGlowAmt: 0, ambientFx: 2, buoyLeft: 0xffb21e, buoyRight: 0xf4f0e0 },
  canal: { glow: 0xffc46a, glow2: 0x6ad8ff, rock: 0xa0644a, rockDark: 0x5a3626, sand: 0xc8b89a, grass: 0x5a7a4a, horizonGlow: 0xffb070, horizonGlowAmt: 0.15, ambientFx: 0, buoyLeft: 0xe8233a, buoyRight: 0xfff4e0 },
  volcanic: { glow: 0xff5a1a, glow2: 0xffb02a, rock: 0x3a3236, rockDark: 0x17131a, sand: 0x2d2628, grass: 0x3a3a30, horizonGlow: 0xff5a1a, horizonGlowAmt: 0.35, ambientFx: 1, buoyLeft: 0xffb02a, buoyRight: 0xf2e8e0 },
};
