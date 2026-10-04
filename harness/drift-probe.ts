// Headless drift feel probe. Usage: npx tsx harness/drift-probe.ts
// Open water (Lagoon Arena), full throttle, then a drift held at wide / neutral /
// tight steer: reports turn rate of the path, hull angle, speed kept, tier times.
import { EventQueue } from '../src/core/events';
import { RaceSession } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';

function run(label: string, steerInto: number, opts: { hopFirst?: boolean } = {}) {
  const ev = new EventQueue();
  const s = new RaceSession({ mode: 'battle', battleRule: 'timed', trackId: 'lagoon', weather: 'clear', laps: 1, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 0, ghost: null }, ev);
  s.skipIntro();
  const dt = 1 / 60;
  const p = s.player;
  const c = p.controls;
  const b = p.boat;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      s.step(dt);
      ev.clear();
    }
  };
  for (let i = 0; i < 60 * 10 && s.phase !== 'racing'; i++) step(1);
  // Hold the course straight while getting up to speed.
  c.throttle = 1;
  c.steer = 0;
  c.drift = !!opts.hopFirst; // holding drift with no fresh press must not start a slide
  step(60 * 4);
  const v0 = Math.hypot(b.velocity.x, b.velocity.z);
  c.drift = opts.hopFirst ? true : false;
  step(1);
  c.drift = true;
  c.steer = 1;
  step(6);
  const started = b.drifting;
  c.steer = steerInto; // driftDir = +1, so this is "into" directly
  const tiers: number[] = [];
  let phi0 = Math.atan2(b.velocity.x, b.velocity.z);
  let turned = 0;
  let slideSum = 0;
  let n = 0;
  let t = 0;
  let endAt = -1;
  for (let i = 0; i < 60 * 3.2; i++) {
    const before = b.driftTier;
    s.step(dt);
    ev.clear();
    t += dt;
    if (b.driftTier > before) tiers.push(+t.toFixed(2));
    if (!b.drifting && endAt < 0) { endAt = t; console.log("  end: air", b.airborne, "u", b.forwardSpeed.toFixed(1), "clr", b.clearance.toFixed(2)); }
    const phi = Math.atan2(b.velocity.x, b.velocity.z);
    let d = phi - phi0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    turned += d;
    phi0 = phi;
    let sl = b.heading - phi;
    sl = Math.atan2(Math.sin(sl), Math.cos(sl));
    slideSum += Math.abs(sl);
    n++;
  }
  const v1 = Math.hypot(b.velocity.x, b.velocity.z);
  c.drift = false;
  c.steer = 0;
  step(6);
  const boost = b.boostTime.toFixed(2);
  console.log(`${label.padEnd(26)} started=${started} turn ${((Math.abs(turned) / 3.2) * 57.3).toFixed(0)}°/s  hull ${((slideSum / n) * 57.3).toFixed(0)}°  speed kept ${((v1 / v0) * 100).toFixed(0)}%  tiers@${tiers.join('/') || '-'}  boost ${boost}s  ended@${endAt.toFixed(2)} u=${b.forwardSpeed.toFixed(1)} wipe=${b.wipeout.toFixed(1)}`);
}

run('wide (counter-steer)', -1);
run('neutral', 0);
run('tight (into the turn)', 1);
run('held before (no fresh hop)', 1, { hopFirst: true });
