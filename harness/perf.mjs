// Real-clock performance sampling of the production build.
//
//   npm run build && npx vite preview --port 4173 &
//   node harness/perf.mjs --url=http://localhost:4173/ --seconds=12 --dpr=2
//
// Reports real frame intervals (rAF), the CPU cost of simulation + scene
// update, draw calls and triangles mid-race with six boats.
// NOTE: in a container without a GPU, Chromium falls back to SwiftShader
// (software rasterisation) — frame intervals there measure the CPU emulating a
// GPU and say nothing about real hardware. `cpuMs` remains meaningful.
import { launch, openGame } from './browser.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = (args.url ?? 'http://localhost:4173/') + '?harness=1';
const seconds = Number(args.seconds ?? 10);
const dpr = Number(args.dpr ?? 1);
const b = await launch();
const { page, errors } = await openGame(b, url, { width: 1440, height: 810, dpr });
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c.getExtension('WEBGL_debug_renderer_info');
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER);
});
await page.evaluate(async () => {
  const r = window.__RIPTIDE__;
  await r.startRace({ trackId: 'coral' });
  r.autopilot(true);
  r.skipIntro();
  r.simulate(8, 1 / 30);
  r.release();
});
const res = await page.evaluate(async (secs) => {
  const iv = [];
  let last = performance.now();
  const end = last + secs * 1000;
  await new Promise((done) => {
    const f = (t) => {
      iv.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(f);
      else done();
    };
    requestAnimationFrame(f);
  });
  iv.shift();
  iv.sort((a, b) => a - b);
  const st = window.__RIPTIDE__.stats();
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  return { frames: iv.length, mean, p50: iv[iv.length >> 1], p95: iv[Math.floor(iv.length * 0.95)], worst: iv[iv.length - 1], over17: iv.filter((x) => x > 16.9).length, cpuMs: st.cpuMs, calls: st.calls, tris: st.triangles, dpr: st.pixelRatio, particles: st.particles };
}, seconds);
// Precise CPU cost: simulation + world/HUD/audio update for 600 fixed steps (no rendering).
const cpu = await page.evaluate(() => {
  const r = window.__RIPTIDE__;
  const t0 = performance.now();
  r.simulate(10, 1 / 60);
  const ms = (performance.now() - t0) / 600;
  r.release();
  return ms;
});
console.log('renderer:', gl);
console.log('CPU per frame (sim + scene update, 6 boats, no render):', cpu.toFixed(3), 'ms');
console.log(JSON.stringify(res, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v), 1));
if (errors.length) console.log('console:', errors.slice(0, 10));
await b.close();
