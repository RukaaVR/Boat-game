// Course look-dev: race view + high orbit overview per course, battle views per rule.
// usage: node harness/course-shots.mjs <url> <outPrefix> spec...
//   spec = trackId[:mode[:rule[:seconds[:view]]]]   view = race | overview | low
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5193/?harness=1';
const prefix = process.argv[3] ?? 'shots/course';
const specs = process.argv.slice(4);
const b = await launch();
const { page, errors } = await openGame(b, url);
for (const spec of specs) {
  const [trackId, mode = 'quick', rule = '', secs = '8', view = 'race'] = spec.split(':');
  const info = await page.evaluate(
    async ({ trackId, mode, rule, secs, view }) => {
      const R = window.__RIPTIDE__;
      await R.startRace({ trackId, mode, ...(rule ? { battleRule: rule } : {}) });
      R.autopilot(true);
      R.skipIntro();
      R.simulate(Number(secs), 1 / 30);
      const s = R.game.session;
      if (view !== 'race') {
        const bd = s.track.bounds;
        const cx = (bd.minX + bd.maxX) / 2;
        const cz = (bd.minZ + bd.maxZ) / 2;
        const span = s.track.arena ? 640 : Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ);
        if (view === 'overview') R.orbitPoint(cx, 0, cz, span * 0.55, span * 0.75);
        else R.orbitPoint(cx, 8, cz, span * 0.5, 40);
        R.simulate(0.3, 1 / 30);
      }
      return { mode: document.querySelector('.modebox')?.textContent, place: s.player.place, phase: s.phase };
    },
    { trackId, mode, rule, secs, view },
  );
  await page.waitForTimeout(400);
  const out = `${prefix}_${trackId}_${mode}${rule ? '_' + rule : ''}_${view}.png`;
  await page.screenshot({ path: out });
  console.log(out, JSON.stringify(info));
}
console.log(errors.slice(0, 10).join('\n'));
await b.close();
