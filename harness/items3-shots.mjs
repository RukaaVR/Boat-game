// Held items, pearls + HUD counter, battle spectate (single and split-screen).
//   node harness/items3-shots.mjs [url] [outPrefix]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5202/?harness=1';
const out = process.argv[3] ?? 'shots/items3';
const b = await launch();
const { page, errors } = await openGame(b, url);

// Pump real frames briefly so CSS animations settle before the capture.
const shot = async (name, wait = 300) => {
  await page.evaluate(
    (ms) =>
      new Promise((res) => {
        const end = performance.now() + ms;
        const f = () => (performance.now() >= end ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    wait,
  );
  await page.evaluate(() => {
    const R = window.__RIPTIDE__;
    R.tick(1 / 60);
  });
  await page.screenshot({ path: `${out}_${name}.png` });
  console.log('shot', name);
};

const race = async (extra = {}) =>
  page.evaluate(async (extra) => {
    const R = window.__RIPTIDE__;
    const sd = R.saveData();
    R.patchSave({ settings: { ...sd.settings, items: true, motion: 1 } });
    await R.startRace({ mode: 'quick', trackId: 'coral', ...extra });
    R.skipIntro();
    R.simulateUntil("s.phase === 'racing'", 10);
    R.autopilot(true);
    R.simulate(4, 1 / 30);
    return { pearls: R.game.session.pearls?.course ?? 0 };
  }, extra);

console.log('race', JSON.stringify(await race()));

// ── Held torpedo trailing behind the player (chase cam) ────────────────────
const held = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  const p = s.player;
  p.item = 'torpedo';
  p.itemCount = 1;
  p.itemRoll = 0;
  p.controls.item = true;
  R.camera('chase');
  R.simulate(1.2, 1 / 30);
  return { held: p.itemHeld, item: p.item };
});
console.log('held', JSON.stringify(held));
await shot('held_torpedo');

// Held oil, from the side (cinematic-ish: aerial is clearer under software GL).
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const p = R.game.session.player;
  p.controls.item = false;
  R.simulate(0.2, 1 / 30);
  p.item = 'oil';
  p.itemCount = 1;
  p.itemRoll = 0;
  p.controls.item = true;
  R.simulate(1, 1 / 30);
});
await shot('held_oil');
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const p = R.game.session.player;
  p.controls.item = false;
  R.simulate(0.2, 1 / 30);
  p.item = 'shield';
  p.itemCount = 1;
  p.itemRoll = 0;
  p.controls.item = true;
  R.simulate(1, 1 / 30);
});
await shot('held_shield');

// ── Pearls: line the player up on a string of pearls ───────────────────────
const pr = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const s = R.game.session;
  const p = s.player;
  p.controls.item = false;
  p.item = null;
  R.simulate(0.2, 1 / 30);
  const pe = s.pearls;
  // First pearl of the 2nd string, projected onto the course.
  const proj = { s: 0, index: -1, lateral: 0, dist: 0, shortcut: -1 };
  s.track.project(pe.x[7], pe.z[7], -1, proj);
  R.placeOnTrack(proj.s - 38, 24, proj.lateral);
  p.pearls = 6;
  R.camera('chase');
  R.simulate(0.4, 1 / 30);
  return { s: proj.s, lat: proj.lateral, carried: p.pearls };
});
console.log('pearls', JSON.stringify(pr));
await shot('pearls_ahead');
const got = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.simulate(1.3, 1 / 30);
  return R.game.session.player.pearls;
});
console.log('pearls after run', got);
await shot('pearls_collected', 150);

// ── Battle spectate (single player) ────────────────────────────────────────
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ mode: 'battle', trackId: 'lagoon', battleRule: 'balloons' });
  R.skipIntro();
  R.simulateUntil("s.phase === 'racing'", 10);
  R.autopilot(true);
  R.simulate(6, 1 / 30);
  const s = R.game.session;
  s.player.lives = 0;
  s.eliminate(s.player);
  R.simulate(3, 1 / 30);
});
const sp = await page.evaluate(() => {
  const s = window.__RIPTIDE__.game.session;
  const banner = document.querySelector('.spectate');
  return { phase: s.phase, fighters: s.activeFighters.length, banner: banner && getComputedStyle(banner).display, text: banner?.textContent.replace(/\s+/g, ' ').trim() };
});
console.log('spectate', JSON.stringify(sp));
await shot('spectate');
// Cycle to the next fighter with the right arrow.
const cyc = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const before = document.querySelector('.spectate .sp-name').textContent;
  R.key('ArrowRight', true);
  R.simulate(0.3, 1 / 30);
  R.key('ArrowRight', false);
  R.simulate(1.5, 1 / 30);
  return { before, after: document.querySelector('.spectate .sp-name').textContent };
});
console.log('cycle', JSON.stringify(cyc));
await shot('spectate_cycled');
// Skip to results via the banner button.
const skip = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  document.querySelector('.spectate .sp-skip').click();
  R.simulate(6, 1 / 30);
  const s = R.game.session;
  return { phase: s.phase, screen: R.state.screen, results: s.results.map((r) => `${r.place}:${r.name}:${r.battle}`) };
});
console.log('skip', JSON.stringify(skip));
await shot('spectate_results', 600);

// ── Split-screen: player 1 knocked out spectates in the top viewport ───────
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ mode: 'battle', trackId: 'lagoon', battleRule: 'balloons', p2Boat: 'drifter', opponents: 3 });
  R.skipIntro();
  R.simulateUntil("s.phase === 'racing'", 10);
  const s = R.game.session;
  s.playerAutopilot = true;
  R.simulate(5, 1 / 30);
  s.player.lives = 0;
  s.eliminate(s.player);
  R.simulate(3, 1 / 30);
});
const sp2 = await page.evaluate(() => {
  const s = window.__RIPTIDE__.game.session;
  const bs = [...document.querySelectorAll('.spectate')].map((x) => getComputedStyle(x).display + ':' + x.querySelector('.sp-skip').textContent);
  return { phase: s.phase, banners: bs };
});
console.log('split spectate', JSON.stringify(sp2));
await shot('spectate_split');

console.log('errors', errors.filter((e) => !/font|403|Failed to load resource/i.test(e)).slice(0, 10));
await b.close();
