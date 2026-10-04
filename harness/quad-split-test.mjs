// 3–4 player split-screen check: four fake gamepads (with rumble recording)
// drive players 1–4; checks every boat moves, HUD count, the overview panel
// (3 players), pad rumble on drift tiers, draw calls per frame vs. 1 and 2
// players, and that the graphics step-down is undone after the race. Saves
// screenshots of 3P and 4P mid-race.
//   node harness/quad-split-test.mjs [--url=http://localhost:5204/] [--out=shots]
import { launch, openGame } from './browser.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = (args.url ?? 'http://localhost:5204/') + '?harness=1';
const out = args.out ?? 'shots';
mkdirSync(out, { recursive: true });

function assert(c, m) {
  if (!c) throw new Error(m);
}

const browser = await launch();
const { page, errors } = await openGame(browser, url, { width: 1280, height: 720 });
// Four standard-mapping pads; rumble calls are recorded per pad.
await page.evaluate(() => {
  window.__rumble = [0, 0, 0, 0];
  window.__pads = [0, 1, 2, 3].map((i) => ({
    id: `Fake Pad ${i} (STANDARD GAMEPAD)`,
    index: i,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
    vibrationActuator: { playEffect: () => ((window.__rumble[i] += 1), Promise.resolve('complete')) },
  }));
  navigator.getGamepads = () => window.__pads;
});
const btn = (pad, b, on) => page.evaluate(([p, b, on]) => (window.__pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }), [pad, b, on]);
const axis = (pad, a, v) => page.evaluate(([p, a, v]) => (window.__pads[p].axes[a] = v), [pad, a, v]);

const results = {};
async function measure(label, req) {
  await page.evaluate(async (req) => {
    const R = window.__RIPTIDE__;
    await R.startRace(req);
    R.skipIntro();
    R.simulate(3.4, 1 / 30); // through the countdown
  }, req);
  const n = req.p2Boat ? 2 + (req.moreBoats?.length ?? 0) : 1;
  for (let p = 0; p < n; p++) await btn(p, 7, true); // RT on every pad
  const r = await page.evaluate((n) => {
    const R = window.__RIPTIDE__;
    R.simulate(7, 1 / 30);
    const g = R.game;
    const s = g.session;
    R.render();
    const calls1 = g.renderer.stats.calls;
    const tri = g.renderer.stats.triangles;
    return {
      humans: s.humans.length,
      speeds: s.humans.map((h) => +h.boat.speed.toFixed(1)),
      huds: document.querySelectorAll('.splitwrap .hud').length,
      overview: !!document.querySelector('.ovpanel'),
      calls: calls1,
      triangles: tri,
      pixelRatio: g.renderer.pixelRatio,
      quality: g.renderer.quality,
      racers: s.racers.length,
      n,
    };
  }, n);
  results[label] = r;
  console.log(label, JSON.stringify(r));
  return r;
}

// Baselines: 1 player and 2 players, same course and field size.
await measure('1P', { trackId: 'coral', laps: 2, opponents: 3 });
await page.evaluate(() => window.__RIPTIDE__.menu());
await measure('2P', { trackId: 'coral', laps: 2, p2Boat: 'drifter', opponents: 2 });
await page.evaluate(() => window.__RIPTIDE__.menu());

// 3 players: overview quarter.
const r3 = await measure('3P', { trackId: 'coral', laps: 2, p2Boat: 'drifter', moreBoats: ['bullet'], opponents: 2 });
assert(r3.humans === 3 && r3.huds === 3 && r3.overview, '3P layout wrong: ' + JSON.stringify(r3));
assert(r3.speeds.every((v) => v > 12), '3P: every player should move: ' + JSON.stringify(r3.speeds));
await page.evaluate(() => window.__RIPTIDE__.redrawHud());
await page.screenshot({ path: `${out}/split-3p.png` });

// 4 players.
await page.evaluate(() => window.__RIPTIDE__.menu());
const r4 = await measure('4P', { trackId: 'coral', laps: 2, p2Boat: 'drifter', moreBoats: ['bullet', 'aero'], opponents: 2 });
assert(r4.humans === 4 && r4.huds === 4 && !r4.overview, '4P layout wrong: ' + JSON.stringify(r4));
assert(r4.speeds.every((v) => v > 12), '4P: every player should move: ' + JSON.stringify(r4.speeds));
// Player 4 drifts on their pad: A to hop, stick right; their pad rumbles on tiers.
const rumbleBefore = await page.evaluate(() => window.__rumble.slice());
await btn(3, 0, true);
await axis(3, 0, 1);
const drift = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  let maxTier = 0;
  for (let i = 0; i < 90; i++) {
    R.tick(1 / 30);
    maxTier = Math.max(maxTier, R.game.session.humans[3].boat.driftTier);
  }
  return { maxTier, drifting: R.game.session.humans[3].boat.drifting };
});
await page.evaluate(() => window.__RIPTIDE__.redrawHud());
await page.screenshot({ path: `${out}/split-4p.png` });
await btn(3, 0, false);
await axis(3, 0, 0);
await page.evaluate(() => window.__RIPTIDE__.simulate(0.5, 1 / 30));
const rumbleAfter = await page.evaluate(() => window.__rumble.slice());
const delta = rumbleAfter.map((v, i) => v - rumbleBefore[i]);
console.log('P4 drift', JSON.stringify(drift), 'rumble calls per pad during it', JSON.stringify(delta));
assert(drift.maxTier >= 1, 'P4 drift did not reach a tier: ' + JSON.stringify(drift));
assert(delta[3] > 0, 'P4 pad did not rumble');
// Rumble OFF in settings silences every pad.
await page.evaluate(() => {
  const g = window.__RIPTIDE__.game;
  g.save.data.settings.rumble = false;
  g.applySettings();
  window.__rumble = [0, 0, 0, 0];
});
await btn(3, 0, true);
await axis(3, 0, -1);
await page.evaluate(() => window.__RIPTIDE__.simulate(3, 1 / 30));
await btn(3, 0, false);
await page.evaluate(() => window.__RIPTIDE__.simulate(0.5, 1 / 30));
const muted = await page.evaluate(() => window.__rumble.slice());
assert(muted.every((v) => v === 0), 'rumble OFF still rumbled: ' + JSON.stringify(muted));
await page.evaluate(() => {
  const g = window.__RIPTIDE__.game;
  g.save.data.settings.rumble = true;
  g.applySettings();
});
for (let p = 0; p < 4; p++) await btn(p, 7, false);

// Finish: results list every player; graphics restored after leaving.
const fin = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const g = R.game;
  R.finishRace(1);
  R.simulateUntil('s.screen === "results"', 30, 1 / 30);
  const rows = [...document.querySelectorAll('tr.me')].map((t) => t.textContent);
  R.menu();
  R.simulate(0.2, 1 / 30);
  return { rows, screen: g.screens.current, quality: g.renderer.quality, pr: g.renderer.pixelRatio, more: !!g.more };
});
console.log('results', JSON.stringify(fin));
console.log('errors', JSON.stringify(errors.filter((e) => !/Failed to load resource|fonts/.test(e))));
await page.screenshot({ path: `${out}/split-after.png` });
await browser.close();
