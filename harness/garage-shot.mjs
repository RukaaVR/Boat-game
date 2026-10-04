// Screenshots of the garage (boats and upgrades tabs).
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/garage';
const b = await launch();
const { page } = await openGame(b, url);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}_menu.png` });
await page.evaluate(() => window.__RIPTIDE__.garage());
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}_boats.png` });
await page.click('[data-act=gtab][data-arg=upgrades]');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}_upgrades.png` });
await b.close();
