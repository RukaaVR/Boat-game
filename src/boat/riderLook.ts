/**
 * Rider appearance: the player's chosen look (saved), or a stable look for
 * AI racers derived from their livery. Palettes are named so the character
 * creator can label them and new entries can be appended freely (saves store
 * the colour value, not an index, so reordering never changes a saved look).
 */

import type { Livery } from './livery';

export type HairStyle = 'burst' | 'messy' | 'swept';
export type Expression = 'grin' | 'determined';

export interface RiderLook {
  hair: HairStyle;
  hairColor: string;
  skin: string;
  eyes: string;
  expression: Expression;
}

export const HAIR_STYLES: { id: HairStyle; name: string }[] = [
  { id: 'burst', name: 'BURST' },
  { id: 'messy', name: 'MESSY' },
  { id: 'swept', name: 'SWEPT' },
];

export const HAIR_COLORS: { id: string; name: string }[] = [
  { id: '#1e1e2a', name: 'BLACK' },
  { id: '#3a2616', name: 'DARK BROWN' },
  { id: '#7b4b2a', name: 'BROWN' },
  { id: '#f3e0a8', name: 'BLONDE' },
  { id: '#eef0f4', name: 'WHITE' },
  { id: '#d2532e', name: 'RED' },
  { id: '#3a7bd5', name: 'BLUE' },
  { id: '#e86aa6', name: 'PINK' },
  { id: '#2f9a74', name: 'GREEN' },
  { id: '#6a4fb5', name: 'PURPLE' },
  { id: '#ff9a2e', name: 'ORANGE' },
];

export const SKIN_TONES: { id: string; name: string }[] = [
  { id: '#ffe9da', name: 'PORCELAIN' },
  { id: '#ffdcc4', name: 'FAIR' },
  { id: '#f6c9a6', name: 'LIGHT' },
  { id: '#e8b48c', name: 'WARM' },
  { id: '#c98d63', name: 'TAN' },
  { id: '#9c6644', name: 'BROWN' },
  { id: '#6e4630', name: 'DEEP' },
];

export const EYE_COLORS: { id: string; name: string }[] = [
  { id: '#7a4a26', name: 'BROWN' },
  { id: '#3a7bd5', name: 'BLUE' },
  { id: '#2f9a74', name: 'GREEN' },
  { id: '#8a7a2b', name: 'HAZEL' },
  { id: '#6a7a8c', name: 'GRAY' },
  { id: '#e0a020', name: 'AMBER' },
];

export const EXPRESSIONS: { id: Expression; name: string }[] = [
  { id: 'grin', name: 'GRIN' },
  { id: 'determined', name: 'DETERMINED' },
];

export const DEFAULT_LOOK: RiderLook = { hair: 'burst', hairColor: '#f3e0a8', skin: '#ffdcc4', eyes: '#e0a020', expression: 'grin' };

/** Small stable hash of the livery so each AI racer looks the same every race. */
function pickBy<T>(liv: Livery, arr: T[], salt: number) {
  const key = `${liv.hull}|${liv.accent}|${liv.number}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return arr[(h >>> 0) % arr.length];
}

export function lookFromLivery(liv: Livery): RiderLook {
  return {
    hair: pickBy(liv, HAIR_STYLES, 5).id,
    hairColor: pickBy(liv, HAIR_COLORS, 2).id,
    skin: pickBy(liv, SKIN_TONES, 1).id,
    eyes: pickBy(liv, EYE_COLORS, 6).id,
    expression: pickBy(liv, EXPRESSIONS, 7).id,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Accepts only well-formed values; unknown or hostile input falls back field by field. */
export function sanitizeLook(v: unknown): RiderLook {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const hex = (x: unknown, d: string) => (typeof x === 'string' && HEX.test(x) ? x.toLowerCase() : d);
  return {
    hair: HAIR_STYLES.some((h) => h.id === o.hair) ? (o.hair as HairStyle) : DEFAULT_LOOK.hair,
    hairColor: hex(o.hairColor, DEFAULT_LOOK.hairColor),
    skin: hex(o.skin, DEFAULT_LOOK.skin),
    eyes: hex(o.eyes, DEFAULT_LOOK.eyes),
    expression: EXPRESSIONS.some((e) => e.id === o.expression) ? (o.expression as Expression) : DEFAULT_LOOK.expression,
  };
}
