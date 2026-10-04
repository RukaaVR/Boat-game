// Feature tests for the expansion systems (admin panel, progression, tutorial,
// touch, battle, replays, photo mode, split-screen, sprints, new courses,
// translations, collectibles, dynamic weather).
//
//   node harness/features-test.mjs [--url=http://localhost:4173/] [--only=name]
//
// Same conventions as gameplay-test.mjs: drives the real game through the
// harness API in headless Chromium and fails on any console error.
import { launch } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const base = args.url ?? 'http://localhost:5173/';
const URL = base + '?harness=1';
const only = args.only ? args.only.split(',') : null;

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const browser = await launch();

async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1280, height: opts.h ?? 720 }, acceptDownloads: true });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__RIPTIDE__?.ready === true, null, { timeout: 120000 });
  return { page, ctx, errors };
}

async function test(name, fn) {
  if (only && !only.some((o) => name.toLowerCase().includes(o))) return;
  const t0 = Date.now();
  try {
    await fn();
    pass++;
    console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    fail++;
    console.log(`✗ ${name}: ${e.message}`);
  }
}

const main = await fresh();
const P = main.page;
const E = (f, a) => P.evaluate(f, a);
const race = (req) => E(async (req) => { const R = window.__RIPTIDE__; await R.startRace(req); R.skipIntro(); }, req);

await test('admin panel: wrong passwords are rejected and lock out, the right one unlocks', async () => {
  const { page, ctx, errors } = await fresh();
  await page.evaluate(() => window.__RIPTIDE__.menu());
  await page.keyboard.press('Control+Shift+KeyK');
  await page.waitForSelector('.admin input[data-pw]');
  for (let i = 0; i < 3; i++) {
    await page.fill('.admin input[data-pw]', 'nope' + i);
    await page.keyboard.press('Enter');
  }
  assert(/Too many attempts/.test(await page.textContent('.admin')), 'no lockout after 3 wrong attempts');
  assert(!(await page.$('.admin input[data-pw]')), 'password box still offered while locked');
  await page.evaluate(() => sessionStorage.removeItem('riptide.admin.lock'));
  await page.click('.admin [data-a=close]');
  await page.keyboard.press('Control+Shift+KeyK');
  await page.fill('.admin input[data-pw]', 'SaltyKraken77');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.admin [data-a=addCredits]');
  const before = (await page.evaluate(() => window.__RIPTIDE__.saveData())).credits;
  await page.click('.admin [data-a=addCredits]');
  const after = (await page.evaluate(() => window.__RIPTIDE__.saveData())).credits;
  assert(after === before + 10000, `credits ${before} → ${after}`);
  assert(errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await test('boat upgrades raise the player boat stats in a race', async () => {
  await E(() => window.__RIPTIDE__.patchSave({ upgrades: { speedster: { engine: 3, hull: 2, nitro: 0, handling: 1 } }, selectedBoat: 'speedster' }));
  await race({ trackId: 'coral', boat: 'speedster' });
  const r = await E(() => { const s = window.__RIPTIDE__.game.session; return { top: s.player.boat.spec.topSpeed, thrust: s.player.boat.spec.thrust, tough: s.player.boat.toughness }; });
  assert(r.top > 31 * 1.07 && r.thrust > 15 * 1.1, 'upgrades not applied: ' + JSON.stringify(r));
  assert(r.tough < 1, 'hull upgrade did not reduce damage taken');
  await E(() => window.__RIPTIDE__.patchSave({ upgrades: {} }));
});

await test('finishing a race unlocks achievements and records lifetime stats', async () => {
  await race({ trackId: 'coral', laps: 1 });
  await E(() => window.__RIPTIDE__.autopilot(true));
  const r = await E(() => window.__RIPTIDE__.simulateUntil('s.screen === "results"', 160, 1 / 30));
  assert(r.ok, 'race did not reach results');
  const d = await E(() => window.__RIPTIDE__.saveData());
  assert(d.achievements.first, 'WET FEET not unlocked: ' + JSON.stringify(Object.keys(d.achievements)));
  assert(d.stats.distance > 1000 && d.stats.topSpeed > 20, 'lifetime stats not recorded: ' + JSON.stringify(d.stats));
});

await test('replay plays the race back and returns to results', async () => {
  assert(await E(() => window.__RIPTIDE__.game.replayAvailable), 'no replay recorded');
  await P.click('[data-act=replay]');
  const a = await E(() => { const R = window.__RIPTIDE__; const p = R.game.session.player.boat.position; const x0 = p.x, z0 = p.z; R.simulate(6, 1 / 30); return { moved: Math.hypot(p.x - x0, p.z - z0), t: R.game.replay.t }; });
  assert(a.t > 5 && a.moved > 30, 'replay did not advance: ' + JSON.stringify(a));
  await P.click('.replaybar [data-r=photo]');
  await P.waitForSelector('.photopanel');
  const before = (await E(() => window.__RIPTIDE__.saveData())).stats.photos;
  const dl = P.waitForEvent('download', { timeout: 10000 });
  await P.click('.photopanel [data-p=snap]');
  const file = await dl;
  assert(/riptide-photo-.*\.png$/.test(file.suggestedFilename()), 'unexpected photo name ' + file.suggestedFilename());
  assert((await E(() => window.__RIPTIDE__.saveData())).stats.photos === before + 1, 'photo not counted');
  await P.click('.photopanel [data-p=exit]');
  await P.click('.replaybar [data-r=exit]');
  assert((await E(() => window.__RIPTIDE__.state)).screen === 'results', 'did not return to results');
});

await test('ghost codes round-trip and reject garbage', async () => {
  const r = await E(async () => {
    const m = window.__RIPTIDE__.ghostCode;
    m.encodeGhost = m.encode;
    m.decodeGhost = m.decode;
    const samples = [];
    for (let i = 0; i < 400; i++) samples.push(Math.cos(i * 0.02) * 260, 0.4, Math.sin(i * 0.02) * 220, (i * 0.02) % 3, 0.03, -0.01);
    const code = await m.encodeGhost({ trackId: 'atoll', boatId: 'aero', time: 55.5, samples }, 'pal');
    const g = await m.decodeGhost(code);
    let err = 0;
    for (let i = 0; i < samples.length; i++) err = Math.max(err, Math.abs(samples[i] - g.samples[i]));
    return { code, err, name: g.name, track: g.trackId, bad: await m.decodeGhost('RPT1.atoll.aero.5000.X.zzzz'), junk: await m.decodeGhost('hello') };
  });
  assert(r.code.startsWith('RPT1.atoll.aero.55500.PAL.'), 'bad header ' + r.code);
  assert(r.err < 0.06, 'lossy beyond quantisation: ' + r.err);
  assert(r.bad === null && r.junk === null, 'garbage accepted');
});

await test('daily and weekly challenges are deterministic per date', async () => {
  const r = await E(() => {
    const g = window.__RIPTIDE__.game;
    g.screens.challenges();
    const cards = [...document.querySelectorAll('.card.chal .ct')].map((e) => e.textContent);
    g.screens.challenges();
    const again = [...document.querySelectorAll('.card.chal .ct')].map((e) => e.textContent);
    return { cards, again };
  });
  assert(r.cards.length === 2 && r.cards[0] && r.cards[1], 'challenges missing: ' + JSON.stringify(r.cards));
  assert(JSON.stringify(r.cards) === JSON.stringify(r.again), 'challenges not stable');
  await E(() => window.__RIPTIDE__.menu());
});

await test('guided tutorial completes step by step', async () => {
  await E(async () => { const R = window.__RIPTIDE__; await R.startTutorial(); R.skipIntro(); });
  const run = (c, t) => E(([c, t]) => { const R = window.__RIPTIDE__; R.setControls(c); return R.simulate(t, 1 / 30); }, [c, t]);
  const step = () => E(() => window.__RIPTIDE__.tutorialStep().step);
  await run({ throttle: 1 }, 3);
  await run({ throttle: 1, steer: 1 }, 2.5);
  await E(() => window.__RIPTIDE__.autopilot(true));
  for (let i = 0; i < 40 && (await step()) === 'checkpoint'; i++) await E(() => window.__RIPTIDE__.simulate(1, 1 / 30));
  for (let i = 0; i < 12 && (await step()) === 'drift'; i++) await run({ throttle: 1, steer: 0.9, drift: true }, 0.5);
  await run({ throttle: 1, drift: false, steer: 0 }, 0.5);
  await run({ throttle: 1, boost: true }, 1.6);
  await run({ throttle: 1, boost: false }, 4);
  for (let k = 0; k < 5 && (await step()) === 'trick'; k++) {
    await E(() => { const R = window.__RIPTIDE__; R.setControls({ throttle: 1, steer: 0, drift: false }); return R.simulateUntil('s.airborne', 6, 1 / 60); });
    await run({ throttle: 0, drift: true, steer: 1 }, 1.2);
    await run({ throttle: 1, drift: false, steer: 0 }, 2);
  }
  await run({ throttle: 0, drift: false, steer: 0 }, 3); // settle after the trick jump
  for (let k = 0; k < 10 && (await step()) === 'land'; k++) {
    const air = await E(() => { const R = window.__RIPTIDE__; R.setControls({ throttle: 1, steer: 0, drift: false }); return R.simulateUntil('s.airborne', 6, 1 / 60).ok; });
    await run({ throttle: 0, drift: false, steer: 0 }, 2.5);
    if (process.env.DEBUG_TUT) console.log('  land try', air, JSON.stringify(await E(() => ({ t: window.__RIPTIDE__.tutorialStep(), st: window.__RIPTIDE__.stats() }))).slice(0, 300));
  }
  for (let k = 0; k < 3 && (await step()) === 'start'; k++) {
    await run({ throttle: 0 }, 2.6);
    await run({ throttle: 1 }, 1.5);
  }
  assert((await step()) === 'done', 'tutorial stuck at ' + (await step()));
  const r = await E(() => window.__RIPTIDE__.simulateUntil('s.screen === "results"', 10, 1 / 30));
  assert(r.ok && (await E(() => window.__RIPTIDE__.saveData())).tutorialDone, 'tutorial completion not saved');
});

await test('battle mode: boxes give items, rivals fire them, hits damage hulls', async () => {
  await race({ mode: 'battle', trackId: 'coral', laps: 3 });
  await E(() => window.__RIPTIDE__.autopilot(true));
  const r = await E(() => {
    const R = window.__RIPTIDE__;
    const s = R.game.session;
    const counts = {};
    const push = s.events.push.bind(s.events);
    s.events.push = (t, ...a) => ((counts[t] = (counts[t] || 0) + 1), push(t, ...a));
    R.simulate(80, 1 / 30);
    s.events.push = push;
    return { counts, dmg: Math.max(...s.racers.map((x) => x.boat.damage)) };
  });
  assert((r.counts.itemPickup ?? 0) >= 8, 'too few pickups: ' + JSON.stringify(r.counts));
  assert((r.counts.itemUse ?? 0) >= 6, 'items not used: ' + JSON.stringify(r.counts));
  assert(r.dmg > 0, 'no hull damage taken by anyone');
});

await test('lagoon arena: every battle rule runs, AI fights, standings follow the rule', async () => {
  for (const battleRule of ['balloons', 'timed', 'score']) {
    await race({ mode: 'battle', trackId: 'lagoon', battleRule });
    await E(() => window.__RIPTIDE__.autopilot(true));
    const r = await E(() => {
      const R = window.__RIPTIDE__;
      const s = R.game.session;
      let pickups = 0;
      const push = s.events.push.bind(s.events);
      s.events.push = (t, ...a) => (t === 'itemPickup' && pickups++, push(t, ...a));
      R.simulate(70, 1 / 30);
      s.events.push = push;
      return { pickups, rule: s.battleRule, laps: s.totalLaps, boxes: s.items.boxes.length, hits: s.racers.reduce((n, x) => n + x.timesHit, 0), lives: s.racers.map((x) => x.lives), mode: document.querySelector('.modebox')?.textContent ?? '' };
    });
    assert(r.rule === battleRule && r.laps === 0, 'rule not applied: ' + JSON.stringify(r));
    assert(r.boxes >= 40 && r.pickups >= 8, 'arena boxes not being collected: ' + JSON.stringify(r));
    assert(r.hits >= 1, 'nobody got hit in 70 s: ' + JSON.stringify(r));
    assert(r.mode.length > 0, 'battle mode box empty');
  }
  await E(() => window.__RIPTIDE__.menu());
});

await test('split-screen: two players drive their own boats', async () => {
  await race({ trackId: 'coral', laps: 1, p2Boat: 'drifter', opponents: 1 });
  await P.keyboard.down('KeyW');
  await P.keyboard.down('ArrowUp');
  const r = await E(() => { const R = window.__RIPTIDE__; R.simulate(6, 1 / 30); const s = R.game.session; return { p1: s.racers[0].boat.speed, p2: s.racers[1].boat.speed, huds: document.querySelectorAll('.splitwrap .hud').length, humans: s.humans.length }; });
  await P.keyboard.up('KeyW');
  await P.keyboard.up('ArrowUp');
  assert(r.humans === 2 && r.huds === 2, 'split HUDs missing: ' + JSON.stringify(r));
  assert(r.p1 > 15 && r.p2 > 15, 'both players should be moving: ' + JSON.stringify(r));
  const keyOnlyP2 = await E(() => { const R = window.__RIPTIDE__; R.simulate(4, 1 / 30); const s = R.game.session; return s.racers[0].boat.speed; });
  assert(keyOnlyP2 < 15, 'player 1 kept accelerating with keys released');
  await E(() => window.__RIPTIDE__.menu());
});

await test('point-to-point sprint finishes after one run', async () => {
  await race({ trackId: 'jungle', laps: 3 });
  await E(() => window.__RIPTIDE__.autopilot(true));
  const r = await E(() => window.__RIPTIDE__.simulateUntil('s.phase === "results"', 120, 1 / 30));
  const s = await E(() => { const s = window.__RIPTIDE__.game.session; return { laps: s.totalLaps, sprint: s.track.sprint, finished: s.player.finished, gates: s.track.gates.length, cps: s.gateCount }; });
  assert(r.ok && s.finished, 'sprint did not finish: ' + JSON.stringify(s));
  assert(s.sprint && s.laps === 1 && s.gates === s.cps + 1, 'sprint bookkeeping wrong: ' + JSON.stringify(s));
});

await test('new courses build and race cleanly', async () => {
  for (const id of ['glacier', 'canal', 'fjord', 'splash', 'hopscotch', 'lighthouse', 'starfall']) {
    await race({ trackId: id, laps: 1 });
    await E(() => window.__RIPTIDE__.autopilot(true));
    const st = await E(() => window.__RIPTIDE__.simulate(12, 1 / 30));
    assert(st.speed > 15 && st.checkpoints >= 1, `${id}: not racing ` + JSON.stringify({ speed: st.speed, cp: st.checkpoints }));
  }
});

await test('career: beating the boss advances the ladder', async () => {
  await E(() => window.__RIPTIDE__.patchSave({ career: { stage: 0 } }));
  await race({ mode: 'career', trackId: 'coral', careerStage: 0 });
  const boss = await E(() => window.__RIPTIDE__.game.session.racers.some((r) => r.name === 'KAI'));
  assert(boss, 'boss KAI missing from the field');
  await E(() => { const R = window.__RIPTIDE__; R.setPhase('racing'); R.simulate(1, 1 / 30); R.game.session.adminFinish(1); });
  const r = await E(() => window.__RIPTIDE__.simulateUntil('s.screen === "results"', 20, 1 / 30));
  assert(r.ok, 'career race did not end');
  assert((await E(() => window.__RIPTIDE__.saveData())).career.stage === 1, 'career stage not advanced');
});

await test('message bottles are collected and saved', async () => {
  await race({ mode: 'freeride', trackId: 'atoll' });
  const r = await E(() => {
    const R = window.__RIPTIDE__;
    const s = R.game.session;
    R.setPhase('racing');
    const bt = s.bottles.find((b) => b.y < 2);
    s.player.boat.place(bt.x - 6, bt.z, Math.PI / 2);
    s.player.boat.velocity.set(8, 0, 0);
    R.simulate(2, 1 / 60);
    return { found: s.bottles.filter((b) => b.found).length, mask: s.stats.bottles };
  });
  assert(r.found >= 1 && r.mask > 0, 'bottle not collected: ' + JSON.stringify(r));
  await E(() => window.__RIPTIDE__.game.session.adminFinish(1));
  await E(() => window.__RIPTIDE__.simulateUntil('s.screen === "results"', 20, 1 / 30));
  assert(((await E(() => window.__RIPTIDE__.saveData())).bottles.atoll ?? 0) > 0, 'bottle not saved');
});

await test('dynamic weather changes mid-race', async () => {
  await E(() => { const g = window.__RIPTIDE__.game; g.save.data.settings.dynamicWeather = true; });
  await race({ trackId: 'coral', laps: 3, weather: 'clear' });
  await E(() => window.__RIPTIDE__.autopilot(true));
  const r = await E(() => { const R = window.__RIPTIDE__; const s = R.game.session; const at = s.weatherPlan.at; R.simulate(at + 18, 1 / 30); return { w: s.cfg.weather, done: s.weatherPlan.done, world: R.game.world.weather }; });
  await E(() => { window.__RIPTIDE__.game.save.data.settings.dynamicWeather = false; });
  assert(r.done && r.w !== 'clear' && r.world === r.w, 'weather did not change: ' + JSON.stringify(r));
});

await test('touch controls drive the boat', async () => {
  const { page, ctx, errors } = await fresh({ w: 900, h: 420 });
  await page.evaluate(() => { const g = window.__RIPTIDE__.game; g.save.data.settings.touch = 'on'; g.applySettings(); });
  await page.evaluate(async () => { const R = window.__RIPTIDE__; await R.startRace({ trackId: 'coral' }); R.skipIntro(); R.setPhase('racing'); R.simulate(0.2, 1 / 30); });
  const gas = await page.$('.touch .t-gas');
  assert(gas && (await gas.isVisible()), 'GAS button not shown');
  const bb = await gas.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  const st = await page.evaluate(() => window.__RIPTIDE__.simulate(2.5, 1 / 30));
  await page.mouse.up();
  assert(st.speed > 12, 'touch GAS did not accelerate: ' + st.speed);
  assert(errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await test('language switch translates the menus', async () => {
  await E(() => { const g = window.__RIPTIDE__.game; g.save.data.settings.lang = 'es'; g.applySettings(); g.enterMenu(); });
  const txt = await P.textContent('.menu');
  await E(() => { const g = window.__RIPTIDE__.game; g.save.data.settings.lang = 'en'; g.applySettings(); g.enterMenu(); });
  assert(/JUGAR/.test(txt) && /TALLER/.test(txt), 'menu not in Spanish: ' + txt.slice(0, 120));
});

await test('hostile values in new save fields are sanitised', async () => {
  const { page, ctx, errors } = await fresh({
    init: () => {
      localStorage.setItem('riptide.save.v1', JSON.stringify({ upgrades: { speedster: { engine: 99, hull: 'x' }, bogus: {} }, achievements: { first: 'yes', fake: 1 }, stats: { tricks: -5, weathers: ['storm', 'lava'] }, challengesDone: ['2026-01-01', 'DROP TABLE', 5], career: { stage: 999 }, bottles: { coral: 9999, nowhere: 3 }, settings: { lang: 'xx', touch: 'maybe', tilt: 'yes' } }));
    },
  });
  const d = await page.evaluate(() => window.__RIPTIDE__.saveData());
  assert(d.upgrades.speedster.engine === 3 && d.upgrades.speedster.hull === 0 && !d.upgrades.bogus, 'upgrades: ' + JSON.stringify(d.upgrades));
  assert(!d.achievements.first && !d.achievements.fake, 'achievements: ' + JSON.stringify(d.achievements));
  assert(d.stats.tricks === 0 && d.stats.weathers.join() === 'storm', 'stats: ' + JSON.stringify(d.stats));
  assert(d.challengesDone.length === 1 && d.career.stage <= 8 && d.bottles.coral === 31 && !d.bottles.nowhere, 'misc: ' + JSON.stringify([d.challengesDone, d.career, d.bottles]));
  assert(d.settings.lang === 'en' && d.settings.touch === 'auto' && d.settings.tilt === false, 'settings: ' + JSON.stringify(d.settings));
  assert(errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await test('no console errors or warnings in the feature session', async () => {
  assert(main.errors.length === 0, main.errors.slice(0, 5).join(' | '));
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
