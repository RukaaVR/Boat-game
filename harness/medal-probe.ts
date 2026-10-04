// Autopilot time-trial laps for medal calibration. Usage: npx tsx harness/medal-probe.ts id [id...]
import { EventQueue } from '../src/core/events';
import { RaceSession } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';

for (const id of process.argv.slice(2)) {
  const ev = new EventQueue();
  const s = new RaceSession({ mode: 'timetrial', trackId: id, weather: 'clear', laps: 3, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 0, ghost: null }, ev);
  s.playerAutopilot = true;
  let t = 0;
  while (s.phase !== 'results' && t < 400) {
    s.step(1 / 60);
    t += 1 / 60;
    ev.clear();
  }
  const tr = s.track;
  console.log(`${id}: len ${tr.length.toFixed(0)} ramps ${tr.ramps.length} pads ${tr.pads.length} sc ${tr.shortcuts.length} hz ${tr.hazards.length} laps ${s.player.lapTimes.map((x) => x.toFixed(1)).join(',')} best ${s.player.bestLap.toFixed(2)}`);
}
