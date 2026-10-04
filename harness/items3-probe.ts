// Headless checks for held items, pearls, battle spectate and replay item state.
// Usage: npx tsx harness/items3-probe.ts
import { EventQueue } from '../src/core/events';
import { RaceSession, type SessionConfig } from '../src/race/session';
import { defaultLivery } from '../src/boat/livery';
import { ReplayPlayer, ReplayRecorder } from '../src/race/replay';
import { PEARL_MAX } from '../src/race/pearls';

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};
const base = (o: Partial<SessionConfig> = {}): SessionConfig => ({ mode: 'quick', items: true, trackId: 'coral', weather: 'clear', laps: 3, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 5, ghost: null, ...o });
const dt = 1 / 60;
function racing(cfg: SessionConfig) {
  const ev = new EventQueue();
  const s = new RaceSession(cfg, ev);
  s.skipIntro();
  s.setPhase('racing');
  for (const r of s.racers) r.boat.holdTime = 0;
  return { s, ev };
}
function run(s: RaceSession, ev: EventQueue, secs: number, each?: () => void, log?: (t: string, e: { racer: number; text: string; value: number }) => void) {
  for (let i = 0; i < Math.round(secs / dt); i++) {
    each?.();
    s.step(dt);
    if (log) for (const e of ev.list) log(e.type, e);
    ev.clear();
  }
}
const give = (r: RaceSession['player'], item: string) => {
  r.item = item;
  r.itemCount = 1;
  r.itemRoll = 0;
  r.itemCooldown = 0;
};
const freeze = (s: RaceSession) => (s.aiFrozen = true);

// ── 1. Tap still deploys exactly as before ─────────────────────────────────
{
  const { s, ev } = racing(base());
  freeze(s);
  const p = s.player;
  p.controls.throttle = 1;
  run(s, ev, 2);
  for (const [item, check] of [
    ['oil', () => s.items!.slicks.some((x) => x.alive)],
    ['shield', () => p.boat.shield > 7],
    ['torpedo', () => s.items!.torpedoes.some((x) => x.alive)],
  ] as const) {
    give(p, item);
    p.controls.item = true;
    run(s, ev, dt);
    p.controls.item = false;
    let used = '';
    run(s, ev, dt, undefined, (t, e) => t === 'itemUse' && (used = e.text));
    ok(used === item && check() && p.item === null && !p.itemHeld, `tap ${item}: deployed on release (item=${p.item})`);
    run(s, ev, 1.5);
  }
}

// ── 2. Hold trails, blocks a torpedo from behind, release deploys ──────────
{
  const { s, ev } = racing(base());
  freeze(s);
  const p = s.player;
  p.controls.throttle = 1;
  run(s, ev, 3);
  give(p, 'torpedo');
  p.controls.item = true;
  let holdEv = 0;
  run(s, ev, 0.4, undefined, (t) => t === 'itemHold' && holdEv++);
  ok(p.itemHeld && p.item === 'torpedo' && holdEv === 1 && !s.items!.torpedoes.some((x) => x.alive), `hold torpedo: trailing (held=${p.itemHeld}), no shot fired`);
  // A torpedo from a rival 25 m astern, aimed up the player's wake.
  const b = p.boat;
  const t = s.items!.torpedoes[0];
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  Object.assign(t, { x: b.position.x - fx * 25, z: b.position.z - fz * 25, vx: fx * 55, vz: fz * 55, owner: 3, t: 0, alive: true });
  let blocked = 0, hit = 0;
  run(s, ev, 1, undefined, (ty, e) => { if (ty === 'itemBlock' && e.racer === 0) blocked++; if (ty === 'itemHit' && e.racer === 0) hit++; });
  ok(blocked === 1 && hit === 0 && p.item === null && !p.itemHeld && b.wipeout <= 0, `held torpedo blocked a torpedo from behind (blocks ${blocked}, hits ${hit}, wipeout ${b.wipeout.toFixed(2)})`);
  p.controls.item = false;
  run(s, ev, 0.2);
  // Release with brake: the torpedo fires backward.
  give(p, 'torpedo');
  p.controls.item = true;
  run(s, ev, 0.4);
  p.controls.brake = 1;
  p.controls.item = false;
  run(s, ev, dt);
  p.controls.brake = 0;
  const shot = s.items!.torpedoes.find((x) => x.alive && x.owner === 0);
  const dot = shot ? (shot.vx * Math.sin(b.heading) + shot.vz * Math.cos(b.heading)) / Math.hypot(shot.vx, shot.vz) : 0;
  ok(!!shot && dot < -0.8, `held torpedo released with brake fires backward (dir·fwd ${dot.toFixed(2)})`);
  run(s, ev, 4);
  // Release without brake: forward.
  give(p, 'torpedo');
  p.controls.item = true;
  run(s, ev, 0.4);
  p.controls.item = false;
  run(s, ev, dt);
  const fwd = s.items!.torpedoes.find((x) => x.alive && x.owner === 0 && x.t < 0.1);
  const dot2 = fwd ? (fwd.vx * Math.sin(b.heading) + fwd.vz * Math.cos(b.heading)) / Math.hypot(fwd.vx, fwd.vz) : 0;
  ok(!!fwd && dot2 > 0.8, `held torpedo released fires forward (dir·fwd ${dot2.toFixed(2)})`);
  // Held oil: release drops it behind; held shield: release raises it.
  give(p, 'oil');
  p.controls.item = true;
  run(s, ev, 0.5);
  const heldOil = p.itemHeld;
  p.controls.item = false;
  run(s, ev, dt);
  const slick = s.items!.slicks.find((x) => x.alive && x.owner === 0);
  const back = slick ? (slick.x - b.position.x) * Math.sin(b.heading) + (slick.z - b.position.z) * Math.cos(b.heading) : 0;
  ok(heldOil && !!slick && back < -3, `held oil released drops behind (${back.toFixed(1)} m)`);
  give(p, 'shield');
  p.controls.item = true;
  run(s, ev, 0.5);
  const heldSh = p.itemHeld && b.shield <= 0;
  p.controls.item = false;
  run(s, ev, dt);
  ok(heldSh && b.shield > 7, `held shield trails (no bubble), release raises it (${b.shield.toFixed(1)} s)`);
}

// ── 3. Seeker from behind is blocked by a trailed item ────────────────────
{
  const { s, ev } = racing(base());
  freeze(s);
  const p = s.player;
  p.controls.throttle = 1;
  run(s, ev, 2);
  // Put the player in the lead so the seeker targets them.
  p.raceDist += 400;
  p.maxRaceDist += 400;
  run(s, ev, 0.2);
  give(p, 'shield');
  p.controls.item = true;
  run(s, ev, 0.4);
  const shooter = s.racers[3];
  give(shooter, 'homer');
  shooter.controls.item = true;
  let block = 0, hit = 0;
  const keepPressing = () => (shooter.controls.item = !shooter.controls.item && false);
  run(s, ev, 12, keepPressing, (t, e) => { if (t === 'itemBlock' && e.racer === 0) block++; if (t === 'itemHit' && e.racer === 0 && e.text === 'homer') hit++; });
  ok(block === 1 && hit === 0, `trailed shield ate the seeker from behind (blocks ${block}, hits ${hit})`);
}

// ── 4. AI leaders trail defensive items; items still get used ─────────────
{
  const { s, ev } = racing(base());
  s.playerAutopilot = true;
  let heldFrames = 0, leaderHeld = 0, uses = 0, holds = 0, blocks = 0;
  run(s, ev, 150, () => {
    for (const r of s.racers) if (r.ai && r.itemHeld) { heldFrames++; if (r.place <= 2) leaderHeld++; }
  }, (t) => { if (t === 'itemUse') uses++; if (t === 'itemHold') holds++; if (t === 'itemBlock') blocks++; });
  ok(holds > 0 && leaderHeld > heldFrames * 0.6 && uses > 20, `AI trails items (holds ${holds}, held-frames ${heldFrames}, of them by top-2 ${leaderHeld}, blocks ${blocks}), items used ${uses}`);
}

// ── 5. Pearls ─────────────────────────────────────────────────────────────
{
  const { s, ev } = racing(base());
  s.playerAutopilot = true;
  const pe = s.pearls!;
  const specTop = s.racers.map((r) => r.boat.spec.topSpeed);
  let picks = 0, drops = 0, maxP = 0;
  const per: number[] = s.racers.map(() => 0);
  let powerOk = true;
  const check = () => { for (const r of s.racers) maxP = Math.max(maxP, r.pearls); };

  for (let i = 0; i < 120 * 60; i++) {
    s.step(dt);
    for (const e of ev.list) { if (e.type === 'pearl') { picks++; per[e.racer]++; } if (e.type === 'pearlDrop') drops++; }
    ev.clear();
    check();
  }
  ok(pe.course > 30, `pearls placed on course: ${pe.course} (pool ${pe.n})`);
  ok(picks > 20 && per.filter((x) => x > 0).length >= 4, `pearls collected: ${picks} (per racer ${per.join(',')}), max carried ${maxP}`);
  ok(maxP <= PEARL_MAX, `never more than ${PEARL_MAX} carried`);
  ok(drops > 0, `pearls spilled on hits: ${drops}`);
  {
    // Controlled: same boat, same frame state, 0 vs 7 pearls.
    const q = racing(base({ opponents: 0 }));
    q.s.player.controls.throttle = 1;
    run(q.s, q.ev, 1);
    q.s.step(dt);
    const p0 = q.s.player.boat.powerScale;
    q.s.player.pearls = 7;
    q.s.step(dt);
    const p7 = q.s.player.boat.powerScale;
    powerOk = Math.abs(p7 / p0 - 1.07) < 1e-6;
    ok(powerOk, `pearl bonus through powerScale: 0 → ${p0.toFixed(4)}, 7 → ${p7.toFixed(4)} (×${(p7 / p0).toFixed(4)})`);
  }
  ok(s.racers.every((r, i) => r.boat.spec.topSpeed === specTop[i]), 'boat specs unchanged');
  // Spill → others can grab them.
  const p = s.player;
  p.pearls = 6;
  const before = pe.up.slice(pe.course).reduce((a, x) => a + x, 0);
  pe.spill(p);
  const after = pe.up.slice(pe.course).reduce((a, x) => a + x, 0);
  ok(p.pearls === 3 && after - before === 3, `spill drops 3 loose pearls (carried ${p.pearls}, loose +${after - before})`);
  // Top speed with 10 pearls vs 0 (straight-line, no AI): measure.
  const top = (n: number) => {
    const { s: s2, ev: e2 } = racing(base({ opponents: 0 }));
    s2.player.pearls = n;
    s2.player.controls.throttle = 1;
    let v = 0;
    run(s2, e2, 9, () => { s2.player.controls.steer = Math.max(-1, Math.min(1, -s2.player.lateral * 0.08)); v = Math.max(v, s2.player.boat.forwardSpeed); });
    return v;
  };
  const v0 = top(0), v10 = top(10);
  ok(v10 > v0 * 1.04, `top speed 0 pearls ${v0.toFixed(2)} m/s, 10 pearls ${v10.toFixed(2)} m/s (+${((v10 / v0 - 1) * 100).toFixed(1)} %)`);
  // Battle has pearls too.
  const b = racing(base({ mode: 'battle', trackId: 'lagoon', battleRule: 'timed' }));
  ok(!!b.s.pearls && b.s.pearls.course > 30, `battle arena pearls: ${b.s.pearls?.course}`);
  const noItems = racing(base({ items: false }));
  ok(noItems.s.pearls === null, 'no pearls when items are off');
}

// ── 6. Battle spectate ────────────────────────────────────────────────────
{
  const { s, ev } = racing(base({ mode: 'battle', trackId: 'lagoon', battleRule: 'balloons' }));
  s.playerAutopilot = true;
  run(s, ev, 3);
  // Knock the player out.
  const p = s.player;
  p.lives = 1;
  p.hitCooldown = 0;
  ev.push('itemHit', 0, 0, 0, 0, 1, 'torpedo');
  s.step(dt); // battleHits reads only events pushed during the items step, so use a real hit:
  ev.clear();
  if (!p.eliminated) {
    const t = s.items!.torpedoes[0];
    const b = p.boat;
    Object.assign(t, { x: b.position.x + 3, z: b.position.z, vx: -55, vz: 0, owner: 2, t: 0, alive: true });
    b.shield = 0;
    p.itemHeld = false;
    run(s, ev, 0.3);
  }
  ok(p.eliminated, 'player knocked out');
  run(s, ev, 2);
  ok(s.phase === 'racing' && s.spectating(p), `battle continues while the player spectates (phase ${s.phase}, fighters ${s.activeFighters.length})`);
  let t = 0;
  while (s.phase === 'racing' && t < 250) {
    run(s, ev, 1);
    t++;
  }
  ok(s.phase !== 'racing', `battle ended after ${t + 2} s more (fighters ${s.activeFighters.length}, clock ${s.battleTimeLeft.toFixed(0)})`);
  run(s, ev, 5);
  const order = s.results.map((r) => `${r.place}:${r.name}:${r.battle}`).join(' | ');
  const outs = s.racers.filter((r) => r.eliminated).sort((a, b) => b.outOrder - a.outOrder);
  const alive = s.racers.filter((r) => !r.eliminated);
  const rankOk = s.results.length === s.racers.length && s.results.slice(alive.length).every((row, i) => row.id === outs[i].id) && s.results.findIndex((r) => r.isPlayer) === s.racers.length - 1;
  ok(rankOk, `results ranking: survivors first, then reverse knock-out order; player (out first) last. ${order}`);
  // Skip to results.
  const k = racing(base({ mode: 'battle', trackId: 'lagoon', battleRule: 'balloons' }));
  k.s.playerAutopilot = true;
  run(k.s, k.ev, 2);
  ok(!k.s.skipBattle(), 'skip refused while the player is still fighting');
  const kp = k.s.player;
  kp.lives = 0;
  (k.s as unknown as { eliminate(r: unknown): void }).eliminate(kp);
  ok(k.s.skipBattle(), 'skip accepted once knocked out');
  run(k.s, k.ev, 0.1);
  ok(k.s.phase === 'finished', `skip settles the battle at once (phase ${k.s.phase})`);
}

// ── 7. Replay records item effect state ───────────────────────────────────
{
  const { s, ev } = racing(base());
  s.playerAutopilot = true;
  const rec = new ReplayRecorder(s);
  const r3 = s.racers[3];
  let tShrink = -1, tSurge = -1, tHeld = -1;
  let time = 0;
  for (let i = 0; i < 60 * 30; i++) {
    if (i === 60 * 5) { r3.boat.shrink = 5; tShrink = time; }
    if (i === 60 * 12) { s.player.boat.surge = 6; tSurge = time; }
    if (i === 60 * 20) { give(s.racers[2], 'oil'); s.racers[2].itemHeld = true; tHeld = time; }
    if (i > 60 * 20 && i < 60 * 22) s.racers[2].controls.item = true;
    s.step(dt);
    rec.record(dt, ev);
    ev.clear();
    time += dt;
  }
  const data = rec.finish();
  ok(data.rf === 19 && data.gf === 7, `replay format: ${data.rf} floats/racer, ${data.gf} global`);
  const pl = new ReplayPlayer(data, s);
  // Seek by advancing (the player writes boats each update).
  const at = (t: number) => { pl.t = t - 1 / 60; pl.playing = true; pl.update(1 / 60, ev); ev.clear(); };
  at(tShrink + 1);
  ok(r3.boat.shrink > 3, `replay: shrunk boat restored (shrink ${r3.boat.shrink.toFixed(2)})`);
  at(tShrink - 1);
  ok(r3.boat.shrink === 0, 'replay: not shrunk before the hit');
  at(tSurge + 1);
  ok(s.player.boat.surge > 4, `replay: golden surge restored (surge ${s.player.boat.surge.toFixed(2)})`);
  at(tHeld + 0.5);
  ok(s.racers[2].itemHeld && s.racers[2].item === 'oil', `replay: trailed oil restored (${s.racers[2].item}, held ${s.racers[2].itemHeld})`);
  at(28);
  ok(s.racers.some((r) => r.pearls > 0), `replay: pearls carried restored (${s.racers.map((r) => r.pearls).join(',')})`);
  // v1 data (no rf/gf) still plays.
  const v1 = { ...data, rf: undefined, gf: undefined };
  ok(!!new ReplayPlayer(v1, s), 'v1 replay data accepted (layout defaults to 15/4)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
