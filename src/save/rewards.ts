/**
 * Post-event rewards: XP, credits, medals, records, ghosts and the unlocks they
 * trigger. Pure function of (session, save) → summary, applied to the save.
 */

import { BOATS } from '../boat/specs';
import { CHAMP_POINTS, CUPS, TRACKS, trackDef } from '../race/trackDefs';
import type { RaceSession } from '../race/session';
import { cosmeticUnlocks, levelFromXp, type SaveStore } from './save';

export interface RewardSummary {
  xp: number;
  credits: number;
  medal: number; // 0 none, 1 bronze, 2 silver, 3 gold
  medalLabel: string;
  levelBefore: number;
  levelAfter: number;
  xpIntoBefore: number;
  xpIntoAfter: number;
  xpNeedAfter: number;
  unlocks: string[];
  records: string[];
  breakdown: [string, number][];
}

const PLACE_XP = [320, 230, 170, 120, 90, 70, 60, 50];
const PLACE_CR = [700, 480, 340, 240, 170, 120, 100, 80];

export function medalName(m: number) {
  return ['—', 'BRONZE', 'SILVER', 'GOLD'][m] ?? '—';
}

/** Stunt medal thresholds scale with track length. */
export function stuntTargets(trackId: string): [number, number, number] {
  const i = TRACKS.findIndex((t) => t.id === trackId);
  // A no-trick clean run scores ~4–7k; gold needs a run full of tricks and rings.
  const base = 12000 + i * 800;
  return [base, Math.round(base * 0.65), Math.round(base * 0.4)];
}
export function endlessTargets(): [number, number, number] {
  return [6000, 3500, 1800];
}

function unlocksBetween(before: number, after: number) {
  const out: string[] = [];
  for (let l = before + 1; l <= after; l++) {
    for (const b of BOATS) if (b.unlockLevel === l) out.push(`BOAT AVAILABLE: ${b.name}`);
    for (const t of TRACKS) if (t.unlockLevel === l) out.push(`TRACK UNLOCKED: ${t.name}`);
    for (const c of CUPS) if (c.unlockLevel === l) out.push(`CUP UNLOCKED: ${c.name}`);
    const a = cosmeticUnlocks(l - 1);
    const b2 = cosmeticUnlocks(l);
    if (b2.paints > a.paints) out.push('NEW PAINT COLOUR');
    if (b2.stripes > a.stripes) out.push('NEW STRIPE PATTERN');
    if (b2.decals > a.decals) out.push('NEW DECAL');
    if (b2.trails > a.trails) out.push('NEW WAKE TRAIL COLOUR');
    if (b2.boosts > a.boosts) out.push('NEW BOOST FLAME COLOUR');
  }
  return out;
}

export function applyRewards(session: RaceSession, store: SaveStore): RewardSummary {
  const d = store.data;
  const p = session.player;
  const trackId = session.cfg.trackId;
  const def = trackDef(trackId);
  const before = levelFromXp(d.xp);
  const breakdown: [string, number][] = [];
  let xp = 0;
  let credits = 0;
  let medal = 0;
  const records: string[] = [];
  const rec = (d.records[trackId] ??= {});
  const med = (d.medals[trackId] ??= { race: 0, tt: 0, stunt: 0 });

  const add = (label: string, x: number) => {
    if (x <= 0) return;
    xp += Math.round(x);
    breakdown.push([label, Math.round(x)]);
  };

  if (session.isRace) {
    const place = p.place;
    const diffMul = session.cfg.difficulty === 'hard' ? 1.35 : session.cfg.difficulty === 'easy' ? 0.75 : 1;
    add(`${place}${['ST', 'ND', 'RD'][place - 1] ?? 'TH'} PLACE`, PLACE_XP[place - 1] * diffMul);
    credits += Math.round(PLACE_CR[place - 1] * diffMul);
    medal = place <= 3 ? 4 - place : 0;
    med.race = Math.max(med.race, medal);
    d.races++;
    if (place === 1) d.wins++;
    if (p.finished && (!rec.race || p.finishTime < rec.race)) {
      if (rec.race) records.push('NEW RECORD — RACE TIME');
      rec.race = p.finishTime;
    }
  }
  if (session.mode === 'timetrial') {
    const best = p.bestLap;
    if (isFinite(best)) {
      const [g, s, b] = def.medals;
      medal = best <= g ? 3 : best <= s ? 2 : best <= b ? 1 : 0;
      med.tt = Math.max(med.tt, medal);
      add('TIME TRIAL', 120 + medal * 90);
      credits += 150 + medal * 150;
    }
    if (session.newGhost) {
      const prev = d.ghosts[trackId];
      if (!prev || session.newGhost.time < prev.time) d.ghosts[trackId] = session.newGhost;
    }
  }
  if (session.mode === 'stunt') {
    const [g, s, b] = stuntTargets(trackId);
    const sc = session.stuntScore;
    medal = sc >= g ? 3 : sc >= s ? 2 : sc >= b ? 1 : 0;
    med.stunt = Math.max(med.stunt, medal);
    add('STUNT SCORE', sc / 18);
    credits += Math.round(sc / 12);
    if (!rec.stunt || sc > rec.stunt) {
      if (rec.stunt) records.push('NEW RECORD — STUNT SCORE');
      rec.stunt = sc;
    }
  }
  if (session.mode === 'endless') {
    const dist = Math.max(0, Math.round(session.endlessDistance));
    const [g, s, b] = endlessTargets();
    medal = dist >= g ? 3 : dist >= s ? 2 : dist >= b ? 1 : 0;
    add('DISTANCE', dist / 12);
    credits += Math.round(dist / 8);
    if (!rec.endless || dist > rec.endless) {
      if (rec.endless) records.push('NEW RECORD — ENDLESS DISTANCE');
      rec.endless = dist;
    }
  }
  if (session.mode !== 'freeride') {
    // Skill bonuses common to every scored mode.
    add('DRIFTING', Math.min(200, p.driftScore * 0.12));
    add('TRICKS', Math.min(200, p.tricks * 22));
    if (isFinite(p.bestLap) && (!rec.lap || p.bestLap < rec.lap)) {
      if (rec.lap) {
        records.push('NEW RECORD — BEST LAP');
        add('LAP RECORD', 80);
      }
      rec.lap = p.bestLap;
    }
  } else {
    add('FREE RIDE', Math.min(150, session.raceTime / 2 + p.tricks * 10 + session.ringsTaken * 10));
    credits += Math.min(200, session.ringsTaken * 20);
  }

  // Championship points.
  if (session.mode === 'championship' && d.champ) {
    for (const r of session.order) {
      const pts = CHAMP_POINTS[r.place - 1] ?? 0;
      d.champ.points[r.id] = (d.champ.points[r.id] ?? 0) + pts;
    }
  }

  d.xp += xp;
  d.credits += credits;
  const after = levelFromXp(d.xp);
  const unlocks = unlocksBetween(before.level, after.level);
  store.save(true);
  return {
    xp,
    credits,
    medal,
    medalLabel: medalName(medal),
    levelBefore: before.level,
    levelAfter: after.level,
    xpIntoBefore: before.into / before.need,
    xpIntoAfter: after.into / after.need,
    xpNeedAfter: after.need,
    unlocks,
    records,
    breakdown,
  };
}

/** Finish a championship (after the last round): award the cup. */
export function finishChampionship(store: SaveStore): { place: number; xp: number; credits: number; unlocks: string[] } {
  const d = store.data;
  const ch = d.champ!;
  const pts = ch.points;
  const order = pts.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const place = order.findIndex((o) => o.i === 0) + 1;
  const trophy = place <= 3 ? 4 - place : 0;
  d.cups[ch.cupId] = Math.max(d.cups[ch.cupId] ?? 0, trophy);
  const before = levelFromXp(d.xp).level;
  const xp = [0, 300, 500, 800][trophy];
  const credits = [200, 800, 1400, 2500][trophy];
  d.xp += xp;
  d.credits += credits;
  d.champ = null;
  store.save(true);
  return { place, xp, credits, unlocks: unlocksBetween(before, levelFromXp(d.xp).level) };
}
