// Triangle / draw-call audit of a race scene: ranks meshes by submitted
// triangles (instances included) and splits outline passes from base meshes.
//   node harness/perf-audit.mjs [url] [trackId] [weather]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5173/?harness=1';
const trackId = process.argv[3] ?? 'coral';
const weather = process.argv[4] ?? 'clear';
const quality = process.argv[5] ?? 'high';
const b = await launch();
const { page } = await openGame(b, url);
const out = await page.evaluate(async ({ trackId, weather, quality }) => {
  const R = window.__RIPTIDE__;
  R.game.save.data.settings.quality = quality;
  R.game.applySettings();
  await R.startRace({ trackId, weather });
  R.autopilot(true);
  R.skipIntro();
  R.simulate(6, 1 / 30);
  R.render();
  const g = R.game;
  const info = g.renderer.renderer ? g.renderer.renderer.info : null;
  const rows = new Map();
  let total = 0;
  let outlineTotal = 0;
  g.world.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLineSegments) return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    const geo = o.geometry;
    if (!geo) return;
    const tri = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    const isOutline = !!o.userData.isOutline;
    let owner = o;
    while (owner.parent && owner.userData.isOutline) owner = owner.parent;
    // Name by the nearest named ancestor so rider/boat parts group sensibly.
    const base = isOutline ? owner : o;
    let name = base.name;
    for (let p = base; !name && p; p = p.parent) name = p.name;
    name = (name || base.type) + (base.name ? '' : ' (child)') + ' v' + (geo.getAttribute('position').count > 2000 ? 'big' : 'small');
    name = name.replace(/_\d+$/, '').replace(/boat_\w+/, 'boat');
    const key = (isOutline ? '[outline] ' : '') + name;
    const r = rows.get(key) ?? { key, tri: 0, draws: 0, inst: 0 };
    r.tri += tri * n;
    r.draws += 1;
    r.inst += n;
    rows.set(key, r);
    total += tri * n;
    if (isOutline) outlineTotal += tri * n;
  });
  const top = [...rows.values()].sort((a, b) => b.tri - a.tri).slice(0, 30);
  return { stats: R.stats(), total: Math.round(total), outlineTotal: Math.round(outlineTotal), top: top.map((r) => `${String(Math.round(r.tri)).padStart(8)}  draws ${String(r.draws).padStart(3)}  inst ${String(r.inst).padStart(5)}  ${r.key}`) };
}, { trackId, weather, quality });
console.log(`rendered: calls ${out.stats.calls}  tris ${out.stats.triangles}`);
console.log(`scene (pre-cull) tris ${out.total}  of which outlines ${out.outlineTotal}`);
console.log(out.top.join('\n'));
await b.close();
