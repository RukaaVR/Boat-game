// Course variants × engine classes, headless. Usage:
//   npx tsx harness/variant-probe.ts tt [id...]     autopilot time-trial laps per variant (SURGE)
//   npx tsx harness/variant-probe.ts race [id...]   full 5-AI race per variant and class (env CLASSES / VARIANTS filter)
import { EventQueue } from '../src/core/events';
import { RaceSession, type SessionConfig } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';
import { TRACKS } from '../src/race/trackDefs';
import { VARIANT_IDS, type CourseVariant } from '../src/race/variants';
import { SPEED_CLASS_IDS, type SpeedClass } from '../src/race/speedClass';

const [cmd = 'tt', ...rest] = process.argv.slice(2);
const ids = rest.length ? rest : TRACKS.map((t) => t.id);

function run(cfg: Partial<SessionConfig>, maxT = 600) {
  const ev = new EventQueue();
  const s = new RaceSession({ mode: 'timetrial', trackId: 'coral', weather: 'clear', laps: 3, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 0, ghost: null, ...cfg }, ev);
  s.playerAutopilot = true;
  let t = 0;
  const resets = new Map<number, number>();
  let wrong = 0;
  // The race clock stops at the results screen, so lap times are only honest until then.
  let snap: number[][] | null = null;
  while ((cfg.mode === 'quick' ? s.racers.some((r) => !r.finished) : s.phase !== 'results') && t < maxT) {
    s.step(1 / 60);
    t += 1 / 60;
    for (const e of ev.list) {
      if (e.type === 'reset') resets.set(e.id, (resets.get(e.id) ?? 0) + 1);
      if (e.type === 'wrongWay') wrong++;
    }
    ev.clear();
    if (!snap && s.phase === 'results') snap = s.racers.map((r) => r.lapTimes.slice());
  }
  snap ??= s.racers.map((r) => r.lapTimes.slice());
  let total = 0;
  for (const v of resets.values()) total += v;
  return { s, t, snap, resets: total, playerResets: resets.get(0) ?? 0, wrong };
}

if (cmd === 'tt') {
  for (const id of ids) {
    const row: string[] = [];
    for (const v of (process.env.VARIANTS?.split(',') ?? VARIANT_IDS) as CourseVariant[]) {
      const { s, resets, wrong } = run({ trackId: id, variant: v, laps: Number(process.env.LAPS ?? 3) });
      row.push(`${v}=${s.player.bestLap.toFixed(2)} [${s.player.lapTimes.map((x) => x.toFixed(1)).join(',')}]${resets ? ` R${resets}` : ''}${wrong ? ` W${wrong}` : ''}`);
    }
    console.log(`${id.padEnd(10)} ${row.join('  ')}`);
  }
} else {
  const classes = (process.env.CLASSES?.split(',') ?? SPEED_CLASS_IDS) as SpeedClass[];
  const variants = (process.env.VARIANTS?.split(',') ?? VARIANT_IDS) as CourseVariant[];
  for (const id of ids) {
    for (const v of variants) {
      for (const c of classes) {
        const { s, t, snap, resets, playerResets } = run({ mode: 'quick', trackId: id, variant: v, speedClass: c, opponents: 5, difficulty: (process.env.DIFF as 'normal') ?? 'normal' });
        if (process.env.LAPS_DETAIL) for (const r of s.racers) console.log(`    ${r.name.padEnd(8)} ${r.boat.spec.name.padEnd(12)} ${snap[r.id].map((x) => x.toFixed(1)).join(',')}`);
        const fin = s.racers.filter((r) => r.finished).length;
        const aiLaps = s.racers.filter((r) => r.ai).flatMap((r) => snap[r.id]);
        const best = Math.min(...aiLaps);
        const avg = aiLaps.reduce((a, x) => a + x, 0) / Math.max(1, aiLaps.length);
        const youLap = Math.min(...snap[0]);
        console.log(
          `${id.padEnd(10)} ${v.padEnd(13)} ${c.padEnd(7)} fin ${fin}/${s.racers.length} simT ${t.toFixed(0)} you ${s.player.finishTime.toFixed(1)} P${s.player.place} youBestLap ${youLap.toFixed(1)} aiBestLap ${best.toFixed(1)} aiAvgLap ${avg.toFixed(1)} top ${Math.max(...s.racers.map((r) => r.topSpeed)).toFixed(1)} resets ${resets} (you ${playerResets})`,
        );
      }
    }
  }
}
