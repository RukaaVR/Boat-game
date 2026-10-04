// AI item usage probe: a full items race on autopilot, tallying pickups/uses/hits per item.
//   node harness/items2-ai.mjs [url] [mode] [seconds]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5191/?harness=1';
const mode = process.argv[3] ?? 'quick';
const secs = Number(process.argv[4] ?? 90);
const b = await launch();
const { page, errors } = await openGame(b, url, { width: 640, height: 360 });
const res = await page.evaluate(
  async ({ mode, secs }) => {
    const R = window.__RIPTIDE__;
    const sd = R.saveData();
    R.patchSave({ settings: { ...sd.settings, items: true } });
    await R.startRace({ mode, trackId: 'coral', opponents: 7 });
    R.skipIntro();
    R.simulateUntil("s.phase === 'racing'", 10);
    R.autopilot(true);
    const s = R.game.session;
    const tally = {};
    const orig = s.events.push.bind(s.events);
    s.events.push = (type, racer, x, y, z, value, text) => {
      if (type === 'itemPickup' || type === 'itemUse' || type === 'itemHit' || type === 'itemMiss' || type === 'shieldHit') {
        const k = `${type}:${text}`;
        tally[k] = (tally[k] ?? 0) + 1;
      }
      return orig(type, racer, x, y, z, value, text);
    };
    R.simulate(secs, 1 / 30);
    return { tally, places: s.order.map((r) => r.name).join(' '), power: s.racers.map((r) => r.boat.powerScale.toFixed(2)).join(' ') };
  },
  { mode, secs },
);
console.log(JSON.stringify(res, null, 1));
console.log(errors.filter((e) => !e.includes('403')).slice(0, 5).join('\n'));
await b.close();
