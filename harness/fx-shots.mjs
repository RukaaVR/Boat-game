// Anime FX check: screenshots of boost (speed lines + sparkles), a ramp
// landing (splash crown, impact burst/frame) and a drift.
// usage: node harness/fx-shots.mjs [url] [outPrefix]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/fx';
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ trackId: 'coral' });
  R.autopilot(true);
  R.skipIntro();
  R.simulate(6, 1 / 30);
  R.hideUi(true);
});
const shot = async (name) => {
  await page.evaluate(() => window.__RIPTIDE__.redrawHud());
  await page.screenshot({ path: `${out}_${name}.png` });
};

// Boost: start a strong boost and fire the boostStart event for the sparkle burst.
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const g = R.game;
  const bt = g.session.player.boat;
  bt.boostTime = 4;
  bt.boostStrength = 1;
  g.events.push('boostStart', 0, bt.position.x, bt.position.y, bt.position.z, 3);
  R.simulate(0.12, 1 / 60);
});
await shot('boost_start');
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const bt = R.game.session.player.boat;
  bt.boostTime = 4;
  R.simulate(0.8, 1 / 60);
});
await shot('boost');

// Ramp landing.
const ramp = await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  const bt = R.game.session.player.boat;
  bt.boostTime = 0;
  bt.boostLevel = 0;
  if (!R.placeAtRamp(0, 36)) return 'noramp';
  const a = R.simulateUntil('s.airborne', 6);
  const l = R.simulateUntil('!s.airborne', 6);
  return JSON.stringify({ a: a.ok, l: l.ok, t: l.t });
});
console.log('ramp', ramp);
await page.evaluate(() => window.__RIPTIDE__.simulate(1 / 30, 1 / 60));
await shot('land_impact');
await page.evaluate(() => window.__RIPTIDE__.simulate(0.12, 1 / 60));
await shot('land_crown');
await page.evaluate(() => window.__RIPTIDE__.simulate(0.25, 1 / 60));
await shot('land_after');

// Drift with sparks.
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.setControls({ throttle: 1, steer: 1, drift: true });
  R.simulate(1.6, 1 / 60);
});
await shot('drift');
console.log(JSON.stringify(await page.evaluate(() => window.__RIPTIDE__.stats())));
console.log(errors.slice(0, 20).join('\n'));
await b.close();
