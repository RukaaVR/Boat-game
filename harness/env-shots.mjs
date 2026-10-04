// Environment look-dev shots: race view + prop close-ups per track.
// usage: node harness/env-shots.mjs <prefix> [track:prop:radius:height ...]
import { launch, openGame } from './browser.mjs';
const url = 'http://localhost:5187/?harness=1';
const prefix = process.argv[2] ?? 'shots/env';
const specs = process.argv.slice(3);
const b = await launch();
const { page, errors } = await openGame(b, url);
for (const spec of specs) {
  const [trackId, prop, radius, height, weather] = spec.split(':');
  await page.evaluate(
    async ({ trackId, prop, radius, height, weather }) => {
      const R = window.__RIPTIDE__;
      await R.startRace(weather ? { trackId, weather } : { trackId });
      R.autopilot(true);
      R.skipIntro();
      R.simulate(prop === 'race' ? 8 : 2, 1 / 30);
      if (prop !== 'race') {
        R.orbitProp(prop, Number(radius || 40), Number(height || 12));
        R.simulate(0.5, 1 / 30);
      }
    },
    { trackId, prop, radius, height, weather },
  );
  await page.waitForTimeout(400);
  const out = `${prefix}_${trackId}_${prop}${weather ? '_' + weather : ''}.png`;
  await page.screenshot({ path: out });
  console.log(out);
}
console.log(errors.slice(0, 10).join('\n'));
await b.close();
