// New power-ups + manga callouts: forces each new item onto a racer and screenshots it.
//   node harness/items2-shots.mjs [url] [outPrefix]
// Shots: seeker lock + impact (player as the target), triple torpedo HUD + launch,
// golden surge, storm call shrink, and callouts.
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5191/?harness=1';
const out = process.argv[3] ?? 'shots/items2';
const b = await launch();
const { page, errors } = await openGame(b, url);

// While the sim is scripted the page produces no frames, so CSS animations would
// freeze and then jump to their end. Pump rAF for `wait` ms so they play in real time.
const shot = async (name, wait = 350) => {
  await page.evaluate(
    (ms) =>
      new Promise((res) => {
        const end = performance.now() + ms;
        const f = () => (performance.now() >= end ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    wait,
  );
  // Frames are slow under software GL: pin the callout animation mid-hold so it is readable.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.target;
      if (t && t.closest && t.closest('.callout')) {
        a.currentTime = 480;
        a.pause();
      }
    }
  });
  await page.screenshot({ path: `${out}_${name}.png` });
  console.log('shot', name);
};

// A quick race with items on; let the field spread out a little.
const setup = async (extra = {}) =>
  page.evaluate(async (extra) => {
    const R = window.__RIPTIDE__;
    const sd = R.saveData();
    R.patchSave({ settings: { ...sd.settings, items: true, motion: 1 } });
    await R.startRace({ mode: 'quick', trackId: 'coral', ...extra });
    R.skipIntro();
    R.simulateUntil("s.phase === 'racing'", 10);
    R.autopilot(true);
    R.simulate(5, 1 / 30);
    const s = R.game.session;
    return { items: !!s.items, n: s.racers.length };
  }, extra);

console.log(JSON.stringify(await setup()));

// ── SEEKER: the player leads, the runner-up fires one at them ───────────────
const lock = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  const lead = s.order[0];
  R.placeOnTrack(lead.s + 45, 30, 0);
  R.simulate(0.5, 1 / 30);
  const shooter = s.order.find((r) => !r.isPlayer);
  shooter.item = 'homer';
  shooter.itemCount = 1;
  shooter.itemRoll = 0;
  for (let i = 0; i < 40 && !s.items.missiles.some((m) => m.alive); i++) R.tick(1 / 30);
  R.simulate(0.12, 1 / 30);
  const m = s.items.missiles.find((x) => x.alive);
  return { shooter: shooter.name, place: s.player.place, alive: !!m, target: m?.target };
});
console.log('seeker', JSON.stringify(lock));
await shot('seeker_lock');
const flight = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  // Let it close in until it starts the dive.
  for (let i = 0; i < 400; i++) {
    const m = s.items.missiles.find((x) => x.alive);
    if (!m || (m.phase === 'home' && m.t > 1.2)) break;
    R.tick(1 / 30);
  }
  const m = s.items.missiles.find((x) => x.alive);
  return m ? { phase: m.phase, t: m.t.toFixed(2), urg: m.urgency.toFixed(2) } : null;
});
console.log('seeker dive', JSON.stringify(flight));
await shot('seeker_dive', 150);
// Side view of the run-in: orbit cam on the target, missile closing from behind.
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const g = R.game;
  g.rig.startOrbit(g.session.player.boat.position, 16, 5, true);
  g.rig.cut();
  R.simulate(0.05, 1 / 60);
});
await shot('seeker_side', 150);
await page.evaluate(() => window.__RIPTIDE__.game.rig.endScripted());
const impact = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  for (let i = 0; i < 300 && s.items.missiles.some((m) => m.alive); i++) R.tick(1 / 60);
  R.simulate(0.1, 1 / 60);
  return { wipeout: s.player.boat.wipeout.toFixed(2), slow: s.player.boat.itemSlow.toFixed(2), power: s.player.boat.powerScale.toFixed(2) };
});
console.log('seeker impact', JSON.stringify(impact));
await shot('seeker_impact', 120);

// ── TRIPLE TORPEDOES ───────────────────────────────────────────────────────
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  R.simulate(2.5, 1 / 30);
  const p = s.player;
  // Put a rival in the sights.
  const tgt = s.order.find((r) => !r.isPlayer && r.raceDist > p.raceDist);
  R.placeOnTrack((tgt ? tgt.s : p.s) - 30, 30, 0);
  p.item = 'torpedo3';
  p.itemCount = 3;
  p.itemRoll = 0;
  R.simulate(0.3, 1 / 30);
});
await shot('torpedo3_hud');
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const p = R.game.session.player;
  p.controls.item = true;
  R.tick(1 / 30);
  p.controls.item = false;
  R.simulate(0.35, 1 / 30);
  p.controls.item = true;
  R.tick(1 / 30);
  p.controls.item = false;
  R.simulate(0.3, 1 / 30);
});
console.log('torpedo3 left', await page.evaluate(() => window.__RIPTIDE__.game.session.player.itemCount));
await shot('torpedo3_fired', 200);

// ── GOLDEN SURGE ───────────────────────────────────────────────────────────
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  R.simulate(2, 1 / 30);
  const p = s.player;
  p.boat.wipeout = 0;
  R.placeOnTrack(p.s + 2, 32, 0);
  p.item = 'surge';
  p.itemCount = 1;
  p.itemRoll = 0;
  for (let k = 0; k < 4; k++) {
    p.controls.item = true;
    R.tick(1 / 30);
    p.controls.item = false;
    R.simulate(0.5, 1 / 30);
  }
});
console.log('surge', await page.evaluate(() => window.__RIPTIDE__.game.session.player.boat.surge.toFixed(2)));
await shot('surge', 1500);
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const g = R.game;
  g.rig.startOrbit(g.session.player.boat.position, 10, 3.5, true);
  g.rig.cut();
  R.simulate(0.3, 1 / 30);
});
await shot('surge_side', 200);
await page.evaluate(() => window.__RIPTIDE__.game.rig.endScripted());
await page.evaluate(() => window.__RIPTIDE__.simulate(5, 1 / 30));

// ── STORM CALL: from behind the pack so the shrunk boats are in view ───────
const storm = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  const p = s.player;
  const ahead = s.order.find((r) => !r.isPlayer);
  R.placeOnTrack(ahead.s - 22, 28, 0);
  R.simulate(0.4, 1 / 30);
  p.item = 'storm';
  p.itemCount = 1;
  p.itemRoll = 0;
  p.controls.item = true;
  R.tick(1 / 30);
  p.controls.item = false;
  R.simulate(0.25, 1 / 30);
  return s.racers.map((r) => `${r.name}:${r.boat.shrink.toFixed(1)}/${r.boat.powerScale.toFixed(2)}`).join(' ');
});
console.log('storm', storm);
await shot('storm_flash', 60);
await page.evaluate(() => window.__RIPTIDE__.simulate(0.8, 1 / 30));
await shot('storm_shrunk', 100);
// Close look at a shrunk rival next to the (full-size) player.
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const g = R.game;
  const s = g.session;
  const v = s.racers.find((r) => !r.isPlayer && r.boat.shrink > 0);
  const b = v.boat;
  g.rig.startOrbit(b.position, 11, 3.5, true);
  g.rig.cut();
  R.simulate(0.3, 1 / 30);
});
await shot('storm_closeup', 150);
await page.evaluate(() => window.__RIPTIDE__.game.rig.endScripted());
const restored = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.simulate(5.5, 1 / 30);
  return R.game.session.racers.map((r) => r.boat.powerScale.toFixed(2)).join(' ');
});
console.log('after storm powerScale', restored);

// ── Callouts ────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.game.hud.callout('VEGA OVERTAKEN', 'cyan', 2);
  R.tick(1 / 30);
});
await shot('callout_rival', 260);
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.simulate(1.3, 1 / 30);
  R.game.hud.callout('MAELSTROM IS RIGHT BEHIND YOU', 'warn boss', 3);
  R.tick(1 / 30);
});
await shot('callout_boss', 300);
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.simulate(1.3, 1 / 30);
  R.game.hud.callout('FINAL LAP!', 'gold', 3);
  R.tick(1 / 30);
});
await shot('callout_final', 450);

console.log(errors.slice(0, 8).join('\n'));
await b.close();
