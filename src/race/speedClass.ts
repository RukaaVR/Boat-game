/**
 * ENGINE CLASSES — the same courses at three speeds.
 *
 * A class is a power multiplier on every boat in the session (player and AI
 * alike), applied through `Boat.basePower` → `powerScale`, so thrust, top
 * speed and boost top speed all scale together and the shared BOATS specs are
 * never touched. Corner speeds are limited by turn rate, not engine power, so
 * the AI's curvature speed profile stays valid at every class; the faster
 * classes mainly lengthen the straights and shorten the braking zones.
 *
 * Time Trial always runs at SURGE (power 1) so medal times and staff ghosts
 * stay comparable.
 */

export type SpeedClass = 'ripple' | 'surge' | 'tsunami';

export interface SpeedClassDef {
  id: SpeedClass;
  name: string;
  blurb: string;
  /** Engine power multiplier (thrust, top speed and boost top speed). */
  power: number;
  /** Extra chase-camera field of view (degrees) so speed reads on screen. */
  fov: number;
}

export const SPEED_CLASSES: Record<SpeedClass, SpeedClassDef> = {
  ripple: { id: 'ripple', name: 'RIPPLE', blurb: 'Gentle engines for learning the courses', power: 0.86, fov: -1.5 },
  surge: { id: 'surge', name: 'SURGE', blurb: 'The standard racing class', power: 1, fov: 0 },
  tsunami: { id: 'tsunami', name: 'TSUNAMI', blurb: 'Tuned engines, longer braking zones, no mercy', power: 1.14, fov: 3 },
};

export const SPEED_CLASS_IDS: SpeedClass[] = ['ripple', 'surge', 'tsunami'];

export function speedClassDef(id: SpeedClass | undefined | null): SpeedClassDef {
  return SPEED_CLASSES[id ?? 'surge'] ?? SPEED_CLASSES.surge;
}

/** Minimal save view for the class unlock rule (avoids importing the save module). */
export interface ClassUnlockView {
  cups: Record<string, number>;
}

/** TSUNAMI unlocks after any cup trophy (bronze or better) at SURGE. */
export function speedClassUnlocked(v: ClassUnlockView, id: SpeedClass) {
  if (id !== 'tsunami') return true;
  return Object.values(v.cups).some((t) => t >= 1);
}

export const TSUNAMI_RULE = 'Earn any cup trophy at SURGE to unlock';
