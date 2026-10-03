// Quick headless probe of a full race. Usage: npx tsx harness/sim-probe.ts [trackId]
import { EventQueue } from '../src/core/events';
import { RaceSession } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';
import { TRACKS } from '../src/race/trackDefs';

const ids = process.argv[2] ? [process.argv[2]] : TRACKS.map((t) => t.id);
for (const id of ids) {
  const ev = new EventQueue();
  const s = new RaceSession({ mode: 'quick', trackId: id, weather: 'clear', laps: 3, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 5, ghost: null }, ev);
  s.playerAutopilot = true;
  const counts: Record<string, number> = {};
  let airFrames = 0, frames = 0, maxAir = 0, wipeouts = 0;
  const dt = 1 / 60;
  let t = 0;
  while (s.phase !== 'results' && t < 400) {
    s.step(dt);
    t += dt;
    frames++;
    if (s.player.boat.airborne) airFrames++;
    maxAir = Math.max(maxAir, s.player.boat.airTime);
    for (const e of ev.list) { counts[e.type] = (counts[e.type] ?? 0) + 1; if (e.type === 'wipeout') wipeouts++; }
    ev.clear();
  }
  const tr = s.track;
  console.log(`\n== ${id}: length ${tr.length.toFixed(0)}m gates ${tr.gates.length} ramps ${tr.ramps.length} pads ${tr.pads.length} shortcuts ${tr.shortcuts.length} hazards ${tr.hazards.length} props ${s.layout.props.length} colliders ${s.layout.colliders.length} buoys ${s.buoys.length}`);
  console.log(`phase ${s.phase} simT ${t.toFixed(1)}s  air% ${(100*airFrames/frames).toFixed(1)} maxAir ${maxAir.toFixed(2)}s`);
  for (const r of s.order) console.log(`  P${r.place} ${r.name.padEnd(7)} ${r.boat.spec.name.padEnd(12)} fin=${r.finished} t=${r.finishTime.toFixed(1)} best=${r.bestLap.toFixed(1)} laps=${r.lapTimes.map(x=>x.toFixed(1)).join(',')} top=${r.topSpeed.toFixed(1)}`);
  console.log('  events', JSON.stringify(counts));
}
