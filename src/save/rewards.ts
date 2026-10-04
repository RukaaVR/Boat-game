/**
 * Post-event rewards: XP, credits, medals, records, ghosts and the unlocks they
 * trigger. Pure function of (session, save) → summary, applied to the save.
 */

import { BOATS, type BoatId } from '../boat/specs';
import { CHAMP_POINTS, CUPS, TRACKS } from '../race/trackDefs';
import type { RaceSession } from '../race/session';
import { cosmeticUnlocks, levelFromXp, type SaveStore } from './save';
import { ACHIEVEMENTS, CAREER, challengeMet, type Challenge } from './progress';
import { courseMedals } from '../race/variants';
import { staffGhostTime } from '../race/staffGhosts';
import { setCupTrophy } from './classCups';

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
  /** Achievements unlocked by this event. */
  achievements: string[];
  /** Challenge outcome, if the event was a challenge attempt. */
  challenge: { text: string; done: boolean; credits: number } | null;
  /** Career outcome, if the event was a career stage. */
  career: { beatBoss: boolean; bossName: string; stage: number; final: boolean } | null;
  bottlesFound: number;
}

/** Extra context for an event that isn't in the session itself. */
export interface RewardContext {
  challenge?: Challenge | null;
  careerStage?: number;
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

export function applyRewards(session: RaceSession, store: SaveStore, ctx: RewardContext = {}): RewardSummary {
  const d = store.data;
  const p = session.player;
  const trackId = session.cfg.trackId;
  const before = levelFromXp(d.xp);
  const breakdown: [string, number][] = [];
  let xp = 0;
  let credits = 0;
  let medal = 0;
  const records: string[] = [];
  // Records, medals and ghosts are kept per course variant (`coral`, `coral~r`, …).
  const key = session.courseKey;
  const variant = session.track.variant;
  // Race and lap records only count at the standard SURGE engine class, so they stay comparable.
  const classOk = (session.cfg.speedClass ?? 'surge') === 'surge';
  const rec = classOk ? (d.records[key] ??= {}) : {};
  const med = (d.medals[key] ??= { race: 0, tt: 0, stunt: 0 });

  const add = (label: string, x: number) => {
    if (x <= 0) return;
    xp += Math.round(x);
    breakdown.push([label, Math.round(x)]);
  };

  if (session.isRace) {
    const place = p.place;
    if (session.mode === 'battle' && place === 1) d.stats.battleWins++;
    const diffMul = session.cfg.difficulty === 'hard' ? 1.35 : session.cfg.difficulty === 'easy' ? 0.75 : 1;
    add(`${place}${['ST', 'ND', 'RD'][place - 1] ?? 'TH'} PLACE`, PLACE_XP[place - 1] * diffMul);
    credits += Math.round(PLACE_CR[place - 1] * diffMul);
    medal = place <= 3 ? 4 - place : 0;
    med.race = Math.max(med.race, medal);
    d.races++;
    if (place === 1) d.wins++;
    if (p.finished && session.mode !== 'battle' && (!rec.race || p.finishTime < rec.race)) {
      if (rec.race) records.push('NEW RECORD — RACE TIME');
      rec.race = p.finishTime;
    }
  }
  if (session.mode === 'timetrial') {
    const best = p.bestLap;
    if (isFinite(best)) {
      const [g, s, b] = courseMedals(trackId, variant);
      medal = best <= g ? 3 : best <= s ? 2 : best <= b ? 1 : 0;
      med.tt = Math.max(med.tt, medal);
      add('TIME TRIAL', 120 + medal * 90);
      credits += 150 + medal * 150;
      // Staff ghost: an AI reference lap per course (normal direction only).
      const staff = variant === 'normal' ? staffGhostTime(trackId) : 0;
      if (staff > 0 && best < staff && !d.staffBeaten.includes(trackId)) {
        d.staffBeaten.push(trackId);
        records.push('STAFF GHOST BEATEN');
        add('BEAT THE STAFF GHOST', 150);
        credits += 300;
      }
    }
    if (session.newGhost) {
      const prev = d.ghosts[key];
      if (!prev || session.newGhost.time < prev.time) d.ghosts[key] = { ...session.newGhost, look: { ...d.rider }, upgrades: { ...store.upgrades(session.newGhost.boatId as BoatId) } };
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
  if (session.mode !== 'freeride' && session.mode !== 'tutorial') {
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
  } else if (session.mode === 'tutorial') {
    if (!d.tutorialDone) {
      d.tutorialDone = true;
      add('TUTORIAL COMPLETE', 300);
      credits += 500;
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

  // ── Lifetime stats ─────────────────────────────────────────────────────
  const st = session.stats;
  const ls = d.stats;
  ls.tricks += p.tricks;
  ls.tier3 += st.tier3;
  ls.cleanLandings += st.clean;
  if (st.perfectStart) ls.perfectStarts++;
  ls.bestAir = Math.max(ls.bestAir, p.bestAir);
  ls.topSpeed = Math.max(ls.topSpeed, p.topSpeed);
  ls.distance += Math.max(0, p.maxRaceDist);
  ls.itemHits += st.itemHits;
  ls.bestCleanInEvent = Math.max(ls.bestCleanInEvent, st.clean);
  const w = session.cfg.weather;
  if (session.mode !== 'tutorial' && !ls.weathers.includes(w)) ls.weathers.push(w);

  // ── Message bottles ────────────────────────────────────────────────────
  let bottlesFound = 0;
  if (st.bottles) {
    const before = d.bottles[trackId] ?? 0;
    const now = before | st.bottles;
    for (let i = 0; i < 8; i++) if (now & ~before & (1 << i)) bottlesFound++;
    d.bottles[trackId] = now;
    if (bottlesFound) {
      credits += 150 * bottlesFound;
      add(`MESSAGE BOTTLE${bottlesFound > 1 ? 'S' : ''} ×${bottlesFound}`, 60 * bottlesFound);
    }
  }

  // ── Challenge ──────────────────────────────────────────────────────────
  let challenge: RewardSummary['challenge'] = null;
  const ch = ctx.challenge;
  if (ch) {
    const done = !d.challengesDone.includes(ch.key) && challengeMet(ch, {
      mode: session.mode,
      trackId,
      weather: session.cfg.weather,
      boat: session.cfg.playerBoat,
      place: p.place,
      finished: p.finished,
      bestLap: p.bestLap,
      stuntScore: session.stuntScore,
      endlessDist: session.endlessDistance,
      tricks: p.tricks,
      tier3: st.tier3,
      cleanLandings: st.clean,
      itemHits: st.itemHits,
    });
    if (done) {
      d.challengesDone.push(ch.key);
      d.challengesDone = d.challengesDone.slice(-60);
      if (ch.weekly) ls.weeklies++;
      else ls.dailies++;
      credits += ch.credits;
      add(ch.weekly ? 'WEEKLY CHALLENGE' : 'DAILY CHALLENGE', ch.xp);
    }
    challenge = { text: ch.text, done, credits: done ? ch.credits : 0 };
  }

  // ── Career ─────────────────────────────────────────────────────────────
  let career: RewardSummary['career'] = null;
  if (session.mode === 'career' && ctx.careerStage !== undefined) {
    const stage = CAREER[ctx.careerStage];
    const boss = session.racers.find((r) => r.rivalIndex === stage.boss);
    const beatBoss = !!boss && p.finished && (!boss.finished || p.finishTime < boss.finishTime) && p.place < boss.place;
    if (beatBoss && d.career.stage === ctx.careerStage) {
      d.career.stage++;
      credits += stage.credits;
      add(`BEAT ${boss!.name}`, stage.xp);
    }
    career = { beatBoss, bossName: boss?.name ?? '?', stage: ctx.careerStage, final: ctx.careerStage === CAREER.length - 1 };
  }

  d.xp += xp;
  d.credits += credits;
  const after = levelFromXp(d.xp);
  const unlocks = unlocksBetween(before.level, after.level);
  const achievements = checkAchievements(store);
  store.save(true);
  return {
    achievements,
    challenge,
    career,
    bottlesFound,
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

/** Results summary for events that award nothing (split-screen). */
export function noRewards(level: number): RewardSummary {
  return { xp: 0, credits: 0, medal: 0, medalLabel: '—', levelBefore: level, levelAfter: level, xpIntoBefore: 0, xpIntoAfter: 0, xpNeedAfter: 1, unlocks: [], records: [], breakdown: [], achievements: [], challenge: null, career: null, bottlesFound: 0 };
}

/** Award any newly met achievements (credits included). Returns their names. */
export function checkAchievements(store: SaveStore): string[] {
  const d = store.data;
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (d.achievements[a.id]) continue;
    if (a.test(d)) {
      d.achievements[a.id] = Date.now();
      d.credits += a.credits;
      out.push(a.name);
    }
  }
  return out;
}

/** Finish a championship (after the last round): award the cup. */
export function finishChampionship(store: SaveStore): { place: number; xp: number; credits: number; unlocks: string[] } {
  const d = store.data;
  const ch = d.champ!;
  const pts = ch.points;
  const order = pts.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const place = order.findIndex((o) => o.i === 0) + 1;
  const trophy = place <= 3 ? 4 - place : 0;
  setCupTrophy(d, ch.speedClass ?? 'surge', ch.cupId, trophy);
  const before = levelFromXp(d.xp).level;
  const xp = [0, 300, 500, 800][trophy];
  const credits = [200, 800, 1400, 2500][trophy];
  d.xp += xp;
  d.credits += credits;
  d.champ = null;
  const ach = checkAchievements(store);
  store.save(true);
  return { place, xp, credits, unlocks: [...unlocksBetween(before, levelFromXp(d.xp).level), ...ach.map((a) => `ACHIEVEMENT: ${a}`)] };
}
