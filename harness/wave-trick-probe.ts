// Headless WAVE FLIP probe. Usage: npx tsx harness/wave-trick-probe.ts [trackId ...]
// Runs full races (player on autopilot) twice per course: once with the
// player tapping drift at every eligible wave launch ("always"), once never
// ("never"). Reports eligible launches, wave flips started / landed, AI wave
// flips, and wipeouts within 1.5 s of a wave-flip landing vs. the baseline.
import { EventQueue } from '../src/core/events';
import { RaceSession } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';
import { TRACKS } from '../src/race/trackDefs';
import type { AIDriver } from '../src/ai/aiDriver';

type Policy = 'always' | 'never';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : TRACKS.map((t) => t.id);

function run(id: string, policy: Policy, weather: 'clear' | 'storm') {
  const ev = new EventQueue();
  const s = new RaceSession({ mode: 'quick', trackId: id, weather, laps: 2, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 5, ghost: null }, ev);
  s.playerAutopilot = true;
  const base = s.playerDriver;
  let tapNext = false;
  // Wrap the autopilot so the drift button can be overridden at wave launches.
  s.playerDriver = {
    update(boat, c, track, view, dt) {
      base.update(boat, c, track, view, dt);
      if (boat.airborne && boat.trick === 'none') c.drift = false; // no stray presses in the air
      if (policy === 'always' && boat.waveTrickReady) {
        c.drift = tapNext; // release one frame, press the next: a clean edge
        tapNext = !tapNext;
      } else tapNext = false;
      if (policy === 'never' && boat.airborne) c.drift = false;
    },
  } as unknown as AIDriver;
  const st = { eligible: 0, flips: 0, landed: 0, aiFlips: 0, aiLanded: 0, wipe: 0, wipeAfterFlip: 0, airJumps: 0 };
  let wasReady = false;
  let flippedAt = -99;
  let t = 0;
  const dt = 1 / 60;
  while (s.phase !== 'results' && t < 300) {
    s.step(dt);
    t += dt;
    const b = s.player.boat;
    if (b.waveTrickReady && !wasReady) st.eligible++;
    wasReady = b.waveTrickReady;
    for (const e of ev.list) {
      if (e.type === 'trick' && e.text === 'WAVE FLIP') {
        if (e.racer === 0) st.flips++;
        else st.aiFlips++;
      }
      if (e.type === 'waveLand') {
        if (e.racer === 0) {
          st.landed++;
          flippedAt = t;
        } else st.aiLanded++;
      }
      if (e.type === 'launch' && e.racer === 0) st.airJumps++;
      if (e.type === 'wipeout' && e.racer === 0) {
        st.wipe++;
        if (t - flippedAt < 1.5) st.wipeAfterFlip++;
      }
    }
    ev.clear();
  }
  return { ...st, time: t, phase: s.phase, place: s.player.place };
}

const tot = { always: { eligible: 0, flips: 0, landed: 0, wipe: 0, wipeAfterFlip: 0, aiFlips: 0, aiLanded: 0, time: 0 }, never: { eligible: 0, flips: 0, landed: 0, wipe: 0, wipeAfterFlip: 0, aiFlips: 0, aiLanded: 0, time: 0 } };
for (const id of ids) {
  for (const weather of ['clear', 'storm'] as const) {
    for (const pol of ['always', 'never'] as const) {
      const r = run(id, pol, weather);
      const T = tot[pol];
      for (const k of Object.keys(T) as (keyof typeof T)[]) T[k] += r[k];
      console.log(`${id.padEnd(11)} ${weather.padEnd(5)} ${pol.padEnd(6)} eligible ${String(r.eligible).padStart(3)} flips ${String(r.flips).padStart(3)} landed ${String(r.landed).padStart(3)} | AI flips ${String(r.aiFlips).padStart(3)} landed ${String(r.aiLanded).padStart(3)} | wipeouts ${r.wipe} (after flip ${r.wipeAfterFlip}) | ${r.phase} P${r.place} ${r.time.toFixed(0)}s`);
    }
  }
}
for (const pol of ['always', 'never'] as const) {
  const T = tot[pol];
  console.log(`TOTAL ${pol.padEnd(6)} eligible ${T.eligible} flips ${T.flips} landed ${T.landed} (${T.flips ? ((100 * T.landed) / T.flips).toFixed(0) : '-'}%) · eligible/min ${((T.eligible / T.time) * 60).toFixed(2)} · AI flips/min ${((T.aiFlips / T.time) * 60).toFixed(2)} · player wipeouts ${T.wipe} (within 1.5 s of a flip landing: ${T.wipeAfterFlip})`);
}
