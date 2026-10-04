// Screenshots of the rider gear (creator) and the garage PARTS tab.
//   node harness/gear-shots.mjs [url] [outPrefix] [looks|parts|all]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const out = process.argv[3] ?? 'shots/gear';
const what = process.argv[4] ?? 'all';
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
// Unlock everything the gear needs.
await page.evaluate(() => {
  const d = window.__RIPTIDE__.game.save.data;
  d.xp = 1e6;
  d.credits = 99999;
  for (const c of ['splash', 'surf', 'grand']) d.cups[c] = 3;
  for (const a of ['win', 'air', 'weather', 'start']) d.achievements[a] = 1;
  d.owned = ['speedster', 'drifter', 'bullet', 'aero', 'tank', 'breaker'];
});
const looks = [
  ['cap', { headwear: 'cap', outfit: 'jacket', accessory: 'none', build: 'medium', hair: 'burst' }],
  ['helmet', { headwear: 'helmet', outfit: 'wetsuit', accessory: 'goggles', build: 'light', hair: 'messy' }],
  ['bandana', { headwear: 'bandana', outfit: 'storm', accessory: 'scarf', build: 'heavy', hair: 'swept' }],
  ['phones', { headwear: 'phones', outfit: 'neon', accessory: 'bands', build: 'medium', hair: 'burst' }],
  ['captain', { headwear: 'captain', outfit: 'team', accessory: 'goggles', build: 'heavy', hair: 'burst' }],
];
if (what !== 'parts') {
  await page.evaluate(() => window.__RIPTIDE__.rider());
  await page.waitForTimeout(3000);
  for (const [name, lk] of looks) {
    await page.evaluate((lk) => {
      const g = window.__RIPTIDE__.game;
      g.save.data.rider = { ...g.save.data.rider, ...lk };
      g.refreshStage();
      g.screens.rider('menu');
      Object.assign(g.stage, { yaw: 0, yawVel: 0, spinHold: 1e9 });
    }, lk);
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${out}_rider_${name}.png` });
    // Three-quarter view of the head.
    await page.evaluate(() => Object.assign(window.__RIPTIDE__.game.stage, { yaw: 0.85, yawVel: 0, spinHold: 1e9 }));
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}_rider_${name}_q.png`, clip: { x: 760, y: 120, width: 400, height: 300 } });
  }
}
if (what !== 'looks') {
  await page.evaluate(() => {
    const g = window.__RIPTIDE__.game;
    g.save.data.rider = { ...g.save.data.rider, headwear: 'helmet', accessory: 'goggles', outfit: 'jacket' };
    g.closeStage?.();
    g.enterMenu();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__RIPTIDE__.garage());
  await page.waitForTimeout(4000);
  await page.click('[data-act=gtab][data-arg=parts]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}_parts_tab.png` });
  await page.click('[data-act=gpart][data-arg="engine:cowl"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}_parts_try.png` });
  await page.click('[data-act=gpartbuy]');
  await page.waitForTimeout(1500);
  await page.click('[data-act=gpart][data-arg="hull:bumper"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}_parts_try2.png` });
}
console.log(errors.slice(0, 8).join('\n'));
await b.close();
