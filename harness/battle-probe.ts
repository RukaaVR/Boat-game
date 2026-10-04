// Headless battle probe. Usage: npx tsx harness/battle-probe.ts [trackId] [rule]
import { EventQueue } from '../src/core/events';
import { RaceSession, type BattleRule } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';

const id = process.argv[2] ?? 'lagoon';
const rule = (process.argv[3] ?? 'balloons') as BattleRule;
const ev = new EventQueue();
const s = new RaceSession({ mode: 'battle', trackId: id, weather: 'clear', laps: 3, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 5, ghost: null, battleRule: rule }, ev);
s.playerAutopilot = true;
const counts: Record<string, number> = {};
const dt = 1 / 60;
let t = 0;
let nextLog = 10;
while (s.phase !== 'results' && t < 300) {
  s.step(dt);
  t += dt;
  for (const e of ev.list) counts[e.type] = (counts[e.type] ?? 0) + 1;
  ev.clear();
  if (t > nextLog) {
    nextLog += 20;
    console.log(`t=${t.toFixed(0)} left=${s.battleTimeLeft.toFixed(0)} ` + s.racers.map((r) => `${r.name}:${r.battleScore}/${r.lives}${r.eliminated ? 'X' : ''}@${Math.hypot(r.boat.position.x, r.boat.position.z).toFixed(0)}`).join(' '));
  }
}
console.log(`== ${id} ${rule}: boxes ${s.items?.boxes.length} props ${s.layout.props.length} colliders ${s.layout.colliders.length} buoys ${s.buoys.length} phase ${s.phase} t ${t.toFixed(1)}`);
for (const r of s.results) console.log(`  P${r.place} ${r.name.padEnd(8)} ${r.battle}`);
console.log('  events', JSON.stringify(counts));
