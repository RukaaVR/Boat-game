/**
 * COURSE VARIANTS — every race course can be driven NORMAL, REVERSE, MIRROR
 * (left↔right) and MIRROR + REVERSE. The track generator builds the normal
 * course and then transforms its data (see Track), so a variant is the same
 * physical layout, never a different random one.
 *
 * Records, medals and ghosts are stored per variant under a course key:
 * `coral` (normal — unchanged from older saves), `coral~r`, `coral~m`, `coral~mr`.
 */

import { TRACKS } from './trackDefs';
import { VARIANT_MEDALS } from './variantMedals';

export type CourseVariant = 'normal' | 'reverse' | 'mirror' | 'mirrorReverse';

export interface VariantDef {
  id: CourseVariant;
  name: string;
  /** Course-key suffix ('' for normal). */
  suffix: string;
  mirror: boolean;
  reverse: boolean;
}

export const VARIANTS: Record<CourseVariant, VariantDef> = {
  normal: { id: 'normal', name: 'NORMAL', suffix: '', mirror: false, reverse: false },
  reverse: { id: 'reverse', name: 'REVERSE', suffix: '~r', mirror: false, reverse: true },
  mirror: { id: 'mirror', name: 'MIRROR', suffix: '~m', mirror: true, reverse: false },
  mirrorReverse: { id: 'mirrorReverse', name: 'MIRROR + REVERSE', suffix: '~mr', mirror: true, reverse: true },
};

export const VARIANT_IDS: CourseVariant[] = ['normal', 'reverse', 'mirror', 'mirrorReverse'];

/** Storage key for records / medals / ghosts of a course variant. */
export function courseKey(trackId: string, variant: CourseVariant = 'normal') {
  return trackId + VARIANTS[variant].suffix;
}

/** Inverse of courseKey; null for anything that is not a race course key. */
export function parseCourseKey(key: string): { trackId: string; variant: CourseVariant } | null {
  const i = key.indexOf('~');
  const trackId = i < 0 ? key : key.slice(0, i);
  const suffix = i < 0 ? '' : key.slice(i);
  if (!TRACKS.some((t) => t.id === trackId)) return null;
  const variant = VARIANT_IDS.find((v) => VARIANTS[v].suffix === suffix);
  return variant ? { trackId, variant } : null;
}

/** Every valid course key (all race courses × all variants). */
export function allCourseKeys(): string[] {
  const out: string[] = [];
  for (const t of TRACKS) for (const v of VARIANT_IDS) out.push(courseKey(t.id, v));
  return out;
}

/** Time-trial medal targets (gold, silver, bronze) for a course variant. */
export function courseMedals(trackId: string, variant: CourseVariant = 'normal'): [number, number, number] {
  const def = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
  if (variant === 'normal') return def.medals;
  return VARIANT_MEDALS[courseKey(def.id, variant)] ?? def.medals;
}

/** Display name, e.g. "CORAL COVE · REVERSE". */
export function courseName(trackId: string, variant: CourseVariant = 'normal') {
  const def = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
  return variant === 'normal' ? def.name : `${def.name} · ${VARIANTS[variant].name}`;
}

/** Minimal save view for the unlock rules (avoids importing the save module). */
export interface VariantUnlockView {
  medals: Record<string, { race: number; tt: number; stunt: number }>;
  classCups: { ripple: Record<string, number>; tsunami: Record<string, number> };
}

export const REVERSE_RULE = 'Win any medal on this course (normal direction)';
export const MIRROR_RULE = 'Win any cup at TSUNAMI class';

function hasMedal(v: VariantUnlockView, trackId: string) {
  const m = v.medals[trackId];
  return !!m && (m.race > 0 || m.tt > 0 || m.stunt > 0);
}
function mirrorOpen(v: VariantUnlockView) {
  return Object.values(v.classCups.tsunami).some((t) => t >= 3);
}

/** Is a variant open for a course? `why` explains how to unlock it when not. */
export function variantUnlocked(v: VariantUnlockView, trackId: string, variant: CourseVariant): { ok: boolean; why: string } {
  switch (variant) {
    case 'normal':
      return { ok: true, why: '' };
    case 'reverse':
      return { ok: hasMedal(v, trackId), why: REVERSE_RULE };
    case 'mirror':
      return { ok: mirrorOpen(v), why: MIRROR_RULE };
    case 'mirrorReverse': {
      const r = hasMedal(v, trackId);
      const m = mirrorOpen(v);
      return { ok: r && m, why: !m ? MIRROR_RULE + ' and medal here' : REVERSE_RULE };
    }
  }
}
