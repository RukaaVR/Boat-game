// Battle end-of-event shot: start a battle with a rule, cut the clock, screenshot results.
// usage: node harness/battle-results-shot.mjs <url> <out.png> <trackId> <rule>
import { launch, openGame } from './browser.mjs';
const [url = 'http://localhost:5193/?harness=1', out = 'shots/battle_results.png', trackId = 'lagoon', rule = 'balloons'] = process.argv.slice(2);
const b = await launch();
const { page, errors } = await openGame(b, url);
const info = await page.evaluate(
  async ({ trackId, rule }) => {
    const R = window.__RIPTIDE__;
    await R.startRace({ mode: 'battle', trackId, battleRule: rule });
    R.autopilot(true);
    R.skipIntro();
    R.simulate(8, 1 / 30);
    const s = R.game.session;
    s.battleTimeLeft = 0.5;
    const r = R.simulateUntil('s.screen === "results"', 12, 1 / 30);
    return { ok: r.ok, results: s.results.map((x) => `${x.place} ${x.name} ${x.battle}`) };
  },
  { trackId, rule },
);
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(out, JSON.stringify(info));
console.log(errors.filter((e) => !e.includes('403')).slice(0, 10).join('\n'));
await b.close();
