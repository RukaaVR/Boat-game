// Close-up screenshots of every boat + rider from a few angles.
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5181/?harness=1';
const tag = process.argv[3] ?? 'b';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ trackId: 'coral', weather: 'clear' });
  R.skipIntro();
  R.hideUi(true);
  R.simulate(0.5, 1 / 30);
});
const boats = only ?? ['speedster', 'drifter', 'bullet', 'aero', 'tank', 'breaker'];
const angles = [
  ['q', 0.75, 6.2, 2.4],
  ['side', Math.PI / 2, 5.2, 1.4],
  ['rear', Math.PI + 0.35, 5.4, 2.6],
  ['close', 0.55, 2.6, 1.9],
];
for (const id of boats) {
  for (const [name, ang, dist, h] of angles) {
    await page.evaluate(({ id, ang, dist, h }) => {
      const g = window.__RIPTIDE__.game;
      if (g.session.player.boat.spec.id !== id) g.previewBoat(id, false);
      const bt = g.session.player.boat;
      bt.velocity.set(0, 0, 0);
      g.session.playerAutopilot = false;
      const a = bt.heading + ang;
      const rig = g.rig;
      rig.startFree();
      rig.freePos.set(bt.position.x + Math.sin(a) * dist, bt.position.y + h, bt.position.z + Math.cos(a) * dist);
      const dx = bt.position.x - rig.freePos.x, dz = bt.position.z - rig.freePos.z, dy = bt.position.y + (dist < 3 ? 1.5 : 0.8) - rig.freePos.y;
      rig.freeYaw = Math.atan2(dx, dz);
      rig.freePitch = Math.atan2(dy, Math.hypot(dx, dz));
      rig.freeFov = 50;
      rig.cut?.();
      window.__RIPTIDE__.simulate(0.1, 1 / 30);
      window.__RIPTIDE__.render();
    }, { id, ang, dist, h });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${tag}_${id}_${name}.png`, clip: { x: 340, y: 160, width: 600, height: 400 } });
  }
}
console.log(errors.slice(0, 10).join('\n'));
await b.close();
