import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/quick.png';
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.screenshot({ path: out.replace('.png', '_title.png') });
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ trackId: 'coral' });
  R.autopilot(true);
  R.skipIntro();
  R.simulate(8, 1 / 30);
});
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate(() => window.__RIPTIDE__.stats())));
console.log(errors.slice(0, 20).join('\n'));
await b.close();
