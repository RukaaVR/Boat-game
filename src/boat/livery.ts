/** Player-customisable paint. Shared by the garage, the save file and the hull texture painter. */

export type StripePattern = 'none' | 'single' | 'twin' | 'racing' | 'chevron' | 'flame' | 'split' | 'digital';
export type DecalStyle = 'none' | 'star' | 'bolt' | 'wave' | 'skull' | 'flame' | 'eye' | 'crown';

export interface Livery {
  hull: string;
  accent: string;
  stripe: StripePattern;
  number: number;
  decal: DecalStyle;
  trail: string;
  boost: string;
}

export const STRIPES: StripePattern[] = ['none', 'single', 'twin', 'racing', 'chevron', 'flame', 'split', 'digital'];
export const DECALS: DecalStyle[] = ['none', 'star', 'bolt', 'wave', 'skull', 'flame', 'eye', 'crown'];

/** Paint swatches. Index = unlock order. */
export const PAINTS = [
  '#ff3b5c', '#2ad4ff', '#ffb21e', '#a6ff3d', '#7b5cff', '#f4f1e8', '#1b1b2f', '#ff8a1e',
  '#ff4fd8', '#00e0a4', '#ffe14d', '#e8233a', '#16324f', '#5b3a29', '#c0c8d8', '#00ffd0',
];
export const TRAILS = ['#ffffff', '#7ff6ff', '#ffe14d', '#ff4fd8', '#a6ff3d', '#ff8a1e', '#b28cff', '#ff3b5c'];
export const BOOSTS = ['#4fd8ff', '#ff6a1e', '#d64fff', '#a6ff3d', '#ffe14d', '#ff2a55', '#ffffff', '#00ffd0'];

export function defaultLivery(hull = '#ff3b5c', accent = '#ffffff', n = 7): Livery {
  return { hull, accent, stripe: 'racing', number: n, decal: 'bolt', trail: '#ffffff', boost: '#4fd8ff' };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Validate untrusted (saved) data, filling anything invalid from `fallback`. */
export function sanitizeLivery(v: unknown, fallback: Livery): Livery {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const col = (k: keyof Livery) => (typeof o[k] === 'string' && HEX.test(o[k] as string) ? (o[k] as string) : (fallback[k] as string));
  return {
    hull: col('hull'),
    accent: col('accent'),
    trail: col('trail'),
    boost: col('boost'),
    stripe: STRIPES.includes(o.stripe as StripePattern) ? (o.stripe as StripePattern) : fallback.stripe,
    decal: DECALS.includes(o.decal as DecalStyle) ? (o.decal as DecalStyle) : fallback.decal,
    number: typeof o.number === 'number' && Number.isInteger(o.number) && o.number >= 0 && o.number <= 99 ? o.number : fallback.number,
  };
}
