// Deterministic screenshot harness.
//
//   node harness/capture.mjs                       # all shots → shots/
//   node harness/capture.mjs --shots=racing,drift  # named shots
//   node harness/capture.mjs --out=shots/r2 --url=http://localhost:4173/
//   node harness/capture.mjs --list
//
// Every shot drives the game with a fixed-step clock (simulate / simulateUntil),
// so the same shot name always produces the same frame. Transient states (air,
// landing) are *hunted* with predicates, never timestamped; a failed hunt is
// reported loudly.
import { mkdirSync } from 'node:fs';
import { launch, openGame } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = (args.url ?? 'http://localhost:5173/') + '?harness=1';
const out = args.out ?? 'shots';
const dpr = Number(args.dpr ?? 1);
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 810);

const R = (page, fn, arg) => page.evaluate(fn, arg);

const SHOTS = {
  title: { what: 'Title screen over the live attract-mode backdrop', run: async (p) => {} },
  menu: { what: 'Main menu with profile card', run: async (p) => R(p, () => window.__RIPTIDE__.menu()) },
  setup: { what: 'Quick race setup: track cards, weather, boats', run: async (p) => R(p, () => window.__RIPTIDE__.setup('quick')) },
  garage: { what: 'Garage with the 3D boat preview', run: async (p) => R(p, () => { window.__RIPTIDE__.menu(); window.__RIPTIDE__.garage(); window.__RIPTIDE__.simulate(1.5, 1 / 30); }) },
  settings: { what: 'Settings screen', run: async (p) => R(p, () => { window.__RIPTIDE__.menu(); window.__RIPTIDE__.settings(); }) },
  grid: { what: 'Intro fly-by over the starting grid', race: { trackId: 'coral' }, run: async (p) => R(p, () => window.__RIPTIDE__.simulate(1.6, 1 / 30)) },
  countdown: { what: 'Countdown on the grid', race: { trackId: 'coral' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(1.3, 1 / 30); }) },
  racing: { what: 'Mid-pack racing, chase camera', race: { trackId: 'coral' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(14, 1 / 30); }) },
  drift: { what: 'Player drifting at tier 2+', race: { trackId: 'atoll' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.2, 1 / 30); r.placeOnTrack(300, 30); r.setControls({ throttle: 1, steer: 1, drift: true });
    return r.simulateUntil('s.driftTier >= 2', 6, 1 / 30);
  }) },
  boost: { what: 'Nitro boost: flame, radial blur, speed lines', race: { trackId: 'coral' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.2, 1 / 30); r.autopilot(false); r.placeOnTrack(80, 34); r.setControls({ throttle: 1, steer: 0, boost: true });
    return r.simulateUntil('s.boost > 0.85', 4, 1 / 30);
  }) },
  jump: { what: 'Airborne off a ramp', race: { trackId: 'coral' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.2, 1 / 30); r.placeAtRamp(0, 33); r.setControls({ throttle: 1, steer: 0 });
    return r.simulateUntil('s.airborne && s.clearance > 2.5', 6, 1 / 60);
  }) },
  landing: { what: 'Touchdown splash after a ramp jump', race: { trackId: 'coral' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.2, 1 / 30); r.placeAtRamp(1, 33); r.setControls({ throttle: 1, steer: 0 });
    r.simulateUntil('s.airborne && s.clearance > 1.5', 6, 1 / 60);
    return r.simulateUntil('!s.airborne && s.sinceLand < 0.12', 6, 1 / 60);
  }) },
  trick: { what: 'Mid-air backflip', race: { trackId: 'coral' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.2, 1 / 30); r.placeAtRamp(0, 34); r.setControls({ throttle: 1, steer: 0, drift: false });
    r.simulateUntil('s.airborne && s.clearance > 2.2', 6, 1 / 60); r.setControls({ drift: true, pitch: -1 });
    return r.simulateUntil("s.trick !== 'none' && s.clearance > 2", 2, 1 / 60);
  }) },
  storm: { what: 'Thunderhead Coast in a storm: rain, big swell', race: { trackId: 'thunder' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(12, 1 / 30); }) },
  night: { what: 'Neon Harbor at night: skyline, reflections', race: { trackId: 'neon' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(12, 1 / 30); }) },
  sunset: { what: 'Sunset Atoll', race: { trackId: 'atoll' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(16, 1 / 30); }) },
  volcanic: { what: 'Cinder Strait: lava glow, smoke, mines', race: { trackId: 'cinder' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(12, 1 / 30); }) },
  shipyard: { what: 'Shipyard Sprint in daylight', race: { trackId: 'shipyard' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(20, 1 / 30); }) },
  aerial: { what: 'Aerial camera', race: { trackId: 'coral' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(10, 1 / 30); r.camera('aerial'); r.simulate(0.5, 1 / 30); }) },
  bow: { what: 'Bow camera', race: { trackId: 'coral' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(10, 1 / 30); r.camera('bow'); r.simulate(0.5, 1 / 30); }) },
  stunt: { what: 'Stunt run: ring over a ramp, score HUD', race: { trackId: 'coral', mode: 'stunt' }, run: async (p) => R(p, () => {
    const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.3, 1 / 30); r.placeAtRamp(0, 33); r.setControls({ throttle: 1, steer: 0 });
    return r.simulateUntil('s.airborne && s.clearance > 3', 6, 1 / 60);
  }) },
  endless: { what: 'Endless wave after a minute: rising sea, mines', race: { trackId: 'thunder', mode: 'endless', weather: 'clear' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(45, 1 / 20); }) },
  freeride: { what: 'Free ride at night', race: { trackId: 'atoll', mode: 'freeride', weather: 'night' }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(10, 1 / 30); }) },
  ghost: { what: 'Time trial racing a saved ghost', race: { trackId: 'atoll', mode: 'timetrial', laps: 1 }, run: async (p) => {
    await R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulateUntil("s.phase === 'results'", 140, 1 / 30); r.afterResults(); r.release(); });
    await R(p, () => window.__RIPTIDE__.startRace({ trackId: 'atoll', mode: 'timetrial', laps: 1 }));
    return R(p, () => { const r = window.__RIPTIDE__; r.skipIntro(); r.simulate(3.3, 1 / 30); r.setControls({ throttle: 1, steer: 0.06 }); r.simulate(9, 1 / 30); });
  } },
  finish: { what: 'Finish moment (1-lap race)', race: { trackId: 'atoll', laps: 1 }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); return r.simulateUntil("s.phase === 'finished'", 120, 1 / 30); }) },
  results: { what: 'Results screen (1-lap race)', race: { trackId: 'atoll', laps: 1 }, run: async (p) => R(p, () => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulateUntil("s.phase === 'results'", 140, 1 / 30); r.simulate(0.5, 1 / 30); }) },
};

// Set pieces (writes prop_<track>_<kind>.png).
SHOTS.props = { what: 'Orbit shots of set pieces on each theme', run: async (p) => {
  const list = [['coral', 'waterfall', 45, 38], ['thunder', 'lighthouse', 70, 25], ['thunder', 'bridge', 90, 30], ['neon', 'crane', 80, 30], ['neon', 'bridge', 90, 25], ['cinder', 'volcano', 900, 250], ['thunder', 'wreck', 60, 18]];
  for (const [track, kind, rad, h] of list) {
    await R(p, () => window.__RIPTIDE__.release());
    await R(p, (t) => window.__RIPTIDE__.startRace({ trackId: t }), track);
    const ok = await R(p, ([k, r2, hh]) => { const r = window.__RIPTIDE__; r.autopilot(true); r.skipIntro(); r.simulate(4, 1 / 30); const ok = r.orbitProp(k, r2, hh); r.hideUi(true); r.simulate(1.5, 1 / 30); return ok; }, [kind, rad, h]);
    if (!ok) console.log('  ⚠ no prop', kind, 'on', track);
    await R(p, () => window.__RIPTIDE__.redrawHud());
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/prop_${track}_${kind}.png` });
    await R(p, () => window.__RIPTIDE__.hideUi(false));
  }
} };

// Garage previews of every boat (writes boat_<id>.png).
SHOTS.boats = { what: 'Garage preview of all six boats', run: async (p) => {
  await R(p, () => { window.__RIPTIDE__.menu(); window.__RIPTIDE__.garage(); });
  for (const id of ['speedster', 'drifter', 'bullet', 'aero', 'tank', 'breaker']) {
    await p.click(`[data-act="gboat"][data-arg="${id}"]`);
    await R(p, () => window.__RIPTIDE__.simulate(1.2, 1 / 30));
    await R(p, () => window.__RIPTIDE__.redrawHud());
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/boat_${id}.png` });
  }
} };

if (args.list !== undefined) {
  for (const [k, v] of Object.entries(SHOTS)) console.log(k.padEnd(10), v.what);
  process.exit(0);
}
const names = args.shots ? args.shots.split(',') : Object.keys(SHOTS);
mkdirSync(out, { recursive: true });
const browser = await launch();
const { page, errors } = await openGame(browser, url, { width, height, dpr });
for (const name of names) {
  const shot = SHOTS[name];
  if (!shot) {
    console.log('unknown shot', name);
    continue;
  }
  const t0 = Date.now();
  if (shot.race) {
    await R(page, () => window.__RIPTIDE__.release());
    await R(page, (req) => window.__RIPTIDE__.startRace(req), shot.race);
    if (shot.pre) await shot.pre(page);
  }
  const res = await shot.run(page);
  if (res && res.ok === false) console.log(`  ⚠ STATE NEVER REACHED for ${name}`);
  await R(page, () => window.__RIPTIDE__.redrawHud());
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
  const st = await R(page, () => window.__RIPTIDE__.stats());
  console.log(`✓ ${name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(1)}s  calls=${st.calls} tris=${(st.triangles / 1000).toFixed(0)}k parts=${st.particles} phase=${st.phase} spd=${(st.speed ?? 0).toFixed(1)} air=${st.airborne}`);
}
const uniq = [...new Set(errors)];
if (uniq.length) console.log('CONSOLE:\n' + uniq.slice(0, 30).join('\n'));
await browser.close();
