/**
 * Championship trophies per engine class. SURGE trophies live in the save's
 * original `cups` table (so older saves keep theirs as SURGE); RIPPLE and
 * TSUNAMI have their own tables in `classCups`.
 */

import type { SpeedClass } from '../race/speedClass';
import type { SaveData } from './save';

type CupView = Pick<SaveData, 'cups' | 'classCups'>;

export function cupTable(d: CupView, cls: SpeedClass): Record<string, number> {
  return cls === 'surge' ? d.cups : d.classCups[cls];
}

export function cupTrophy(d: CupView, cls: SpeedClass, cupId: string) {
  return cupTable(d, cls)[cupId] ?? 0;
}

export function setCupTrophy(d: CupView, cls: SpeedClass, cupId: string, trophy: number) {
  const t = cupTable(d, cls);
  t[cupId] = Math.max(t[cupId] ?? 0, trophy);
}
