// Item boxes in a normal race: approach a row, the roulette spinning, the item landing.
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/items';
const b = await launch();
const { page, errors } = await openGame(b, url);
const info = await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ mode: 'quick', trackId: 'coral' });
  R.skipIntro();
  R.simulateUntil("s.phase === 'racing'", 10);
  const s = R.game.session;
  const L = s.track.length;
  R.placeOnTrack(L * 0.3 / 4 - 45, 26, 0);
  R.autopilot(true);
  R.simulate(0.4, 1 / 30);
  return { items: !!s.items, boxes: s.items?.boxes.length };
});
console.log(JSON.stringify(info));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}_approach.png` });
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.simulateUntil('false', 0); // no-op
  const s = R.game.session;
  for (let i = 0; i < 120 && !s.player.item; i++) R.simulate(1 / 30, 1 / 30);
  R.simulate(0.25, 1 / 30);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}_roulette.png` });
await page.evaluate(() => window.__RIPTIDE__.simulate(1.4, 1 / 30));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}_got.png` });
console.log(errors.slice(0, 5).join('\n'));
await b.close();
