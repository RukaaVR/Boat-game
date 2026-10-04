// Pose the rider (turn, landing, flip, celebrate) and screenshot each.
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5181/?harness=1';
const tag = process.argv[3] ?? 'pose';
const b = await launch();
const { page, errors } = await openGame(b, url);
await page.evaluate(async () => {
  const R = window.__RIPTIDE__;
  await R.startRace({ trackId: 'coral', weather: 'clear' });
  R.skipIntro();
  R.hideUi(true);
  R.simulate(0.5, 1 / 30);
});
const poses = {
  turn: { steer: 1, yawRate: -1.4 },
  land: { sinceLand: 0.05, landStrength: 1 },
  flip: { airborne: true, trick: 'frontflip' },
  wave: { celebrate: true },
  pickup: { react: 'pickup', frames: 10 },
  hit: { react: 'hit', dir: 1, frames: 8 },
  trickpump: { react: 'trick', frames: 14 },
  lookback: { react: 'lookback', dir: -1, frames: 18 },
};
for (const [name, p] of Object.entries(poses)) {
  await page.evaluate(({ p }) => {
    const g = window.__RIPTIDE__.game;
    const bt = g.session.player.boat;
    g.session.playerAutopilot = false;
    window.__RIPTIDE__.simulate(0.05, 1 / 30);
    const rig = g.rig;
    const a = bt.heading + 0.9;
    rig.startFree();
    rig.freePos.set(bt.position.x + Math.sin(a) * 4.2, bt.position.y + 2, bt.position.z + Math.cos(a) * 4.2);
    const dx = bt.position.x - rig.freePos.x, dz = bt.position.z - rig.freePos.z, dy = bt.position.y + 1.1 - rig.freePos.y;
    rig.freeYaw = Math.atan2(dx, dz);
    rig.freePitch = Math.atan2(dy, Math.hypot(dx, dz));
    rig.freeFov = 50;
    window.__RIPTIDE__.simulate(0.05, 1 / 30);
    const v = g.world.visuals[0];
    const saved = { airborne: bt.airborne, trick: bt.trick, sinceLand: bt.sinceLand, landStrength: bt.landStrength, yawRate: bt.yawRate };
    v.celebrate = !!p.celebrate;
    if (p.react) {
      for (let i = 0; i < 30; i++) v.update(bt, 0, 1 / 30, 9 + i / 30);
      v.rider.react(p.react, p.dir ?? 0);
    }
    for (let i = 0; i < (p.frames ?? 40); i++) {
      Object.assign(bt, { airborne: !!p.airborne, trick: p.trick ?? 'none', sinceLand: p.sinceLand ?? 5, landStrength: p.landStrength ?? 0, yawRate: p.yawRate ?? 0 });
      v.update(bt, p.steer ?? 0, 1 / 30, 10 + i / 30);
    }
    window.__RIPTIDE__.render();
    Object.assign(bt, saved);
    v.celebrate = false;
  }, { p });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/${tag}_${name}.png`, clip: { x: 420, y: 120, width: 600, height: 480 } });
}
console.log(errors.slice(0, 10).join('\n'));
await b.close();
