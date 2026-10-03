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
    skyTop: 0x2b7fe0,
    skyHorizon: 0xbfe9ff,
    skyBottom: 0x9fd9f0,
    sunColor: 0xfff3d6,
    sunElev: 0.42,
    sunAzim: 0.6,
    sunSize: 1.0,
    sunIntensity: 2.6,
    hemiSky: 0xbfe6ff,
    hemiGround: 0x2f6f86,
    hemiIntensity: 1.25,
    fogColor: 0xbfe6f7,
    fogDensity: 0.0011,
    waterDeep: 0x0a4e8f,
    waterMid: 0x1287b8,
    waterShallow: 0x37e0d6,
    waterFoam: 0xf6fdff,
    waterCrest: 0x4fe6e0,
    cloudCover: 0.35,
    cloudColor: 0xffffff,
    cloudShade: 0xb7cde6,
    stars: 0,
    rain: 0,
    lightning: false,
    bloom: 0.35,
    exposure: 1.0,
    saturation: 1.12,
    contrast: 1.05,
    vignette: 0.28,
    wind: 0.6,
  },
  sunset: {
    id: 'sunset',
    name: 'SUNSET',
    sea: 1.1,
    chop: 1.05,
    skyTop: 0x2e2a6b,
    skyHorizon: 0xff9a4a,
    skyBottom: 0xd96a5a,
    sunColor: 0xffb56a,
    sunElev: 0.1,
    sunAzim: 2.2,
    sunSize: 1.7,
    sunIntensity: 2.4,
    hemiSky: 0xffb38a,
    hemiGround: 0x3a2a5a,
    hemiIntensity: 1.05,
    fogColor: 0xf0907a,
    fogDensity: 0.0013,
    waterDeep: 0x1d1f55,
    waterMid: 0x37407f,
    waterShallow: 0x3fb8b0,
    waterFoam: 0xffe8d6,
    waterCrest: 0xff8f6a,
    cloudCover: 0.45,
    cloudColor: 0xffc49a,
    cloudShade: 0x7a4a7a,
    stars: 0.15,
    rain: 0,
    lightning: false,
    bloom: 0.6,
    exposure: 1.02,
    saturation: 1.15,
    contrast: 1.08,
    vignette: 0.34,
    wind: 0.5,
  },
  storm: {
    id: 'storm',
    name: 'STORM',
    sea: 1.75,
    chop: 1.3,
    skyTop: 0x1c2430,
    skyHorizon: 0x5d6b78,
    skyBottom: 0x3a4652,
    sunColor: 0xc8d6e6,
    sunElev: 0.5,
    sunAzim: 1.4,
    sunSize: 0.0,
    sunIntensity: 1.1,
    hemiSky: 0x8a9aae,
    hemiGround: 0x1d2a33,
    hemiIntensity: 1.1,
    fogColor: 0x56626e,
    fogDensity: 0.0042,
    waterDeep: 0x0d2230,
    waterMid: 0x24485a,
    waterShallow: 0x3d7a7a,
    waterFoam: 0xe3edf2,
    waterCrest: 0x6aa6a8,
    cloudCover: 0.95,
    cloudColor: 0x6f7a86,
    cloudShade: 0x2a323c,
    stars: 0,
    rain: 1,
    lightning: true,
    bloom: 0.3,
    exposure: 0.98,
    saturation: 0.85,
    contrast: 1.12,
    vignette: 0.42,
    wind: 1.6,
  },
  night: {
    id: 'night',
    name: 'NIGHT',
    sea: 1.05,
    chop: 1.0,
    skyTop: 0x050a1e,
    skyHorizon: 0x1c2a5a,
    skyBottom: 0x0d1636,
    sunColor: 0xa8c4ff,
    sunElev: 0.36,
    sunAzim: -0.9,
    sunSize: 0.8,
    sunIntensity: 0.9,
    hemiSky: 0x4a5c9a,
    hemiGround: 0x0a1020,
    hemiIntensity: 0.8,
    fogColor: 0x10183a,
    fogDensity: 0.0016,
    waterDeep: 0x030a1c,
    waterMid: 0x0b1f45,
    waterShallow: 0x0f5a6a,
    waterFoam: 0xb8d4ff,
    waterCrest: 0x2a5aa8,
    cloudCover: 0.3,
    cloudColor: 0x2a3560,
    cloudShade: 0x0c1230,
    stars: 1,
    rain: 0,
    lightning: false,
    bloom: 0.9,
    exposure: 1.05,
    saturation: 1.15,
    contrast: 1.1,
    vignette: 0.4,
    wind: 0.5,
  },
};

export const WEATHER_IDS: WeatherId[] = ['clear', 'sunset', 'storm', 'night'];

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
