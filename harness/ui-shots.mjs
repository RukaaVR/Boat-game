// Screenshots of the main UI states: title, main menu, pause during the countdown, racing HUD.
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/ui';
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}_title.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}_menu.png` });
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ trackId: 'coral' });
  R.skipIntro();
  R.simulateUntil("s.phase === 'countdown'", 10);
  R.simulate(0.3, 1 / 30);
  R.game.pauseGame();
});
// Software rendering runs ~1 fps, so give the screen's fade-in time to finish.
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}_pause_countdown.png` });
await page.evaluate(() => {
  const R = window.__RIPTIDE__;
  R.game.resumeRace();
  R.autopilot(true);
  R.simulate(7, 1 / 30);
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}_hud.png` });
console.log(errors.slice(0, 10).join('\n'));
await b.close();
