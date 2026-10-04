/**
 * Graphics presets.
 *
 * The saved setting is 'auto' | 'low' | 'medium' | 'high'. AUTO picks a
 * concrete preset from the device (GPU string, cores, memory, touch / screen
 * size) and can step down at runtime if the frame rate stays poor even after
 * the adaptive resolution controller has done what it can.
 *
 * A preset drives: ocean grid density, particle budget and rain count (via
 * the existing Quality plumbing), MSAA and bloom (renderer), LOD distances
 * and distant outlines (render/lod.ts), the pixel-ratio cap, boat/rider LOD
 * ranges, and contact shadows.
 */

import type { Quality } from './renderer';
import { LOD } from './lod';

export type GraphicsSetting = 'auto' | Quality;

export interface Preset {
  /** LOD distance multiplier (near-detail radius for props, buoys, boats). */
  lodScale: number;
  /** Outlines on LOD-managed scenery (props/buoys) at all. */
  sceneryOutlines: boolean;
  /** Upper bound on device pixel ratio. */
  maxPixelRatio: number;
  /** Stylised contact shadows under boats. */
  shadows: boolean;
}

export const PRESETS: Record<Quality, Preset> = {
  low: { lodScale: 0.55, sceneryOutlines: false, maxPixelRatio: 1, shadows: false },
  medium: { lodScale: 0.8, sceneryOutlines: true, maxPixelRatio: 1.5, shadows: true },
  high: { lodScale: 1, sceneryOutlines: true, maxPixelRatio: 2, shadows: true },
};

/** The preset currently in force (after resolving AUTO). */
export let activeQuality: Quality = 'high';

export function applyPreset(q: Quality) {
  activeQuality = q;
  const p = PRESETS[q];
  LOD.scale = p.lodScale;
  LOD.outlines = p.sceneryOutlines ? 1 : 0;
}

export interface DeviceInfo {
  gpu: string;
  cores: number;
  memoryGb: number;
  mobile: boolean;
  software: boolean;
}

export function deviceInfo(): DeviceInfo {
  let gpu = '';
  try {
    const c = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (c) {
      const ext = c.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
      c.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no GL info */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  return {
    gpu,
    cores: navigator.hardwareConcurrency || 4,
    memoryGb: nav.deviceMemory ?? 8,
    mobile,
    software: /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu),
  };
}

/** Best-guess preset for this device. Deliberately conservative. */
let detected: Quality | null = null;
export function detectQuality(): Quality {
  detected ??= classify(deviceInfo());
  return detected;
}
function classify(d: DeviceInfo): Quality {
  if (d.software) return 'low';
  if (d.mobile) return d.memoryGb >= 6 && d.cores >= 8 ? 'medium' : 'low';
  const g = d.gpu.toLowerCase();
  const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m\d|apple gpu/.test(g);
  const integrated = /intel|uhd|iris|mali|adreno|powervr|vega \d|radeon\(tm\) graphics/.test(g);
  if (discrete && d.cores >= 6) return 'high';
  if (integrated || d.cores < 4 || d.memoryGb < 4) return 'medium';
  return d.cores >= 8 ? 'high' : 'medium';
}

/** Resolve a saved setting to the preset to use now. */
export function resolveQuality(s: GraphicsSetting): Quality {
  return s === 'auto' ? detectQuality() : s;
}

/**
 * AUTO safety net: if, with AUTO on, frames stay slow for several seconds even
 * at the adaptive controller's minimum resolution, step the preset down.
 * Returns the new preset when a step happens.
 */
export class AutoDowngrade {
  private slow = 0;
  private cooldown = 0;
  update(dt: number, medianFrameMs: number, atMinResolution: boolean, current: Quality): Quality | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || current === 'low') return null;
    if (atMinResolution && medianFrameMs > 24) this.slow += dt;
    else this.slow = Math.max(0, this.slow - dt * 0.5);
    if (this.slow < 6) return null;
    this.slow = 0;
    this.cooldown = 20;
    return current === 'high' ? 'medium' : 'low';
  }
}
