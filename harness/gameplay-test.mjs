// Automated gameplay tests. Requires a running server (dev or preview).
//
//   node harness/gameplay-test.mjs [--url=http://localhost:5173/]
//
// Each test drives the real game in headless Chromium through the harness API
// (fixed-step clock) and/or real keyboard events, then asserts on game state,
// on localStorage, and on the console (any error/warning fails the run).
import { launch, openGame } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const base = args.url ?? 'http://localhost:5173/';
const URL = base + '?harness=1';
const only = args.only ? args.only.split(',') : null;

let pass = 0;
let fail = 0;
const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await launch();

async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w ?? 1280, height: opts.h ?? 720 } });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.goto(opts.url ?? URL);
  await page.waitForFunction(() => window.__RIPTIDE__?.ready === true, null, { timeout: 120000 });
  return { page, ctx, errors };
}

async function test(name, fn) {
  if (only && !only.some((o) => name.toLowerCase().includes(o))) return;
  const t0 = Date.now();
  try {
    await fn();
    pass++;
    results.push(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(results.at(-1));
  } catch (e) {
    fail++;
    results.push(`✗ ${name}: ${e.message}`);
    console.log(results.at(-1));
  }
}

const S = (page) => page.evaluate(() => window.__RIPTIDE__.stats());

// ── Shared page for the in-session tests ──────────────────────────────────────
const main = await fresh();
const P = main.page;

await test('GPU and CPU wave fields agree', async () => {
  const r = await P.evaluate(() => window.__RIPTIDE__.waveCheck());
  assert(r.maxHeight > 0.5, `waves too flat to be a meaningful test (max ${r.maxHeight})`);
  assert(r.maxErr < 0.02, `max height error ${r.maxErr.toFixed(4)} m (mean ${r.meanErr.toFixed(5)})`);
});

await test('race starts: intro → countdown → racing', async () => {
  await P.evaluate(() => window.__RIPTIDE__.startRace({ trackId: 'coral', laps: 1 }));
  let s = await S(P);
  assert(s.phase === 'intro', 'expected intro, got ' + s.phase);
  await P.evaluate(() => window.__RIPTIDE__.simulate(3.4, 1 / 30));
  s = await S(P);
  assert(s.phase === 'countdown', 'expected countdown, got ' + s.phase);
  await P.evaluate(() => window.__RIPTIDE__.simulate(3.2, 1 / 30));
  s = await S(P);
  assert(s.phase === 'racing', 'expected racing, got ' + s.phase);
});

await test('boat floats at the water line at rest', async () => {
  const s = await S(P);
  const draft = s.surface - (s.y - 0.22);
  assert(draft > -0.2 && draft < 0.6, `hull bottom ${draft.toFixed(2)} m below surface`);
});

await test('player accelerates under throttle', async () => {
  await P.evaluate(() => {
    window.__RIPTIDE__.setControls({ throttle: 1, steer: 0 });
    window.__RIPTIDE__.simulate(3, 1 / 30);
  });
  const s = await S(P);
  assert(s.speed > 15, 'speed after 3s throttle = ' + s.speed);
  await P.evaluate(() => window.__RIPTIDE__.clearControls());
});

await test('checkpoints advance and AI progresses', async () => {
  await P.evaluate(() => {
    window.__RIPTIDE__.autopilot(true);
    window.__RIPTIDE__.simulate(25, 1 / 30);
  });
  const s = await S(P);
  assert(s.checkpoints >= 3, 'player checkpoints = ' + s.checkpoints);
  const probe = await P.evaluate(() => window.__RIPTIDE__.probe());
  for (const r of probe.slice(1)) assert(r.dist > 400, `${r.name} only covered ${r.dist} m`);
  // Different racers take different lines.
  const lats = new Set(probe.map((r) => Math.round(r.lat)));
  assert(lats.size >= 3, 'AI lateral positions suspiciously identical');
});

await test('race finishes and results screen appears', async () => {
  const r = await P.evaluate(() => window.__RIPTIDE__.simulateUntil("s.phase === 'results'", 160, 1 / 30));
  assert(r.ok, 'never reached results; phase=' + r.stats.phase);
  await P.waitForTimeout(400);
  const s = await S(P);
  assert(s.screen === 'results', 'screen is ' + s.screen);
  const visible = await P.isVisible('text=CONTINUE');
  assert(visible, 'CONTINUE button not visible');
});

await test('progression is awarded and saved', async () => {
  const s = await S(P);
  assert(s.save.xp > 0 && s.save.races === 1, `xp=${s.save.xp} races=${s.save.races}`);
  await P.waitForTimeout(400);
  const stored = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')));
  assert(stored && stored.xp === s.save.xp, 'localStorage xp mismatch');
  assert(stored.records.coral && stored.records.coral.lap > 0, 'lap record not stored');
});

await test('results → continue returns to the main menu', async () => {
  await P.keyboard.press('Enter');
  await P.waitForTimeout(800);
  const s = await S(P);
  assert(s.state === 'menu' && s.screen === 'menu', `state=${s.state} screen=${s.screen}`);
});

await test('wrong-way detection', async () => {
  await P.evaluate(() => window.__RIPTIDE__.startRace({ trackId: 'atoll' }));
  await P.evaluate(() => {
    const r = window.__RIPTIDE__;
    r.skipIntro();
    r.simulate(3.3, 1 / 30);
    r.autopilot(true);
    r.simulate(6, 1 / 30);
    r.autopilot(false);
    r.turnPlayerAround();
    r.setControls({ throttle: 1, steer: 0 });
    r.simulate(3, 1 / 30);
  });
  const s = await S(P);
  assert(s.wrongWay === true, 'wrongWay flag not set');
  const banner = await P.isVisible('text=WRONG WAY');
  assert(banner, 'WRONG WAY banner not shown');
});

await test('respawn returns the player to the course', async () => {
  await P.evaluate(() => {
    window.__RIPTIDE__.clearControls();
    window.__RIPTIDE__.respawnPlayer();
    window.__RIPTIDE__.autopilot(true);
    window.__RIPTIDE__.simulate(3, 1 / 30);
  });
  const s = await S(P);
  assert(!s.wrongWay, 'still wrong way after respawn');
});

await test('pause (Escape) freezes the race and resumes', async () => {
  await P.keyboard.press('Escape');
  await P.evaluate(() => window.__RIPTIDE__.tick());
  let s = await S(P);
  assert(s.screen === 'pause', 'pause screen not shown: ' + s.screen);
  const t0 = s.time;
  await P.evaluate(() => window.__RIPTIDE__.simulate(1, 1 / 30));
  s = await S(P);
  assert(Math.abs(s.time - t0) < 1e-6, 'race clock advanced while paused');
  await P.keyboard.press('Escape');
  await P.evaluate(() => window.__RIPTIDE__.simulate(0.5, 1 / 30));
  s = await S(P);
  assert(s.screen === '' && Math.abs(s.time - t0) > 0.1, 'did not resume: screen=' + s.screen);
});

await test('restart (R) starts a fresh session', async () => {
  await P.keyboard.press('KeyR');
  await P.evaluate(() => window.__RIPTIDE__.tick());
  await P.waitForFunction(() => window.__RIPTIDE__.stats().phase === 'intro', null, { timeout: 30000 });
  const s = await S(P);
  assert(s.phase === 'intro' && s.checkpoints === 0, `phase=${s.phase} cp=${s.checkpoints}`);
});

await test('drift builds tiers and releases a boost', async () => {
  await P.evaluate(() => {
    const r = window.__RIPTIDE__;
    r.skipIntro();
    r.simulate(3.3, 1 / 30);
    r.placeOnTrack(300, 30);
    r.setControls({ throttle: 1, steer: 0.5, drift: true });
  });
  const r = await P.evaluate(() => window.__RIPTIDE__.simulateUntil('s.driftTier >= 2', 6, 1 / 60));
  assert(r.ok, 'drift never reached tier 2');
  await P.evaluate(() => window.__RIPTIDE__.setControls({ drift: false, steer: 0 }));
  const b = await P.evaluate(() => window.__RIPTIDE__.simulateUntil('s.boost > 0.5', 1, 1 / 60));
  assert(b.ok, 'releasing the drift did not boost');
});

await test('ramp launches the boat and it lands', async () => {
  await P.evaluate(() => {
    const r = window.__RIPTIDE__;
    r.setControls({ throttle: 1, steer: 0, drift: false, boost: false });
    r.placeAtRamp(0, 32);
  });
  const up = await P.evaluate(() => window.__RIPTIDE__.simulateUntil('s.airborne && s.clearance > 2.5', 5, 1 / 60));
  assert(up.ok, 'never got airborne off the ramp');
  const down = await P.evaluate(() => window.__RIPTIDE__.simulateUntil('!s.airborne', 6, 1 / 60));
  assert(down.ok, 'never landed');
  await P.evaluate(() => window.__RIPTIDE__.clearControls());
});

await test('quit to menu from pause', async () => {
  await P.keyboard.press('Escape');
  await P.evaluate(() => window.__RIPTIDE__.tick());
  await P.click('text=QUIT TO MENU');
  await P.waitForTimeout(800);
  const s = await S(P);
  assert(s.state === 'menu', 'state ' + s.state);
});

await test('every mode starts and runs: time trial, stunt, endless, free ride', async () => {
  for (const mode of ['timetrial', 'stunt', 'endless', 'freeride']) {
    await P.evaluate((m) => window.__RIPTIDE__.startRace({ mode: m, trackId: 'coral', laps: 1 }), mode);
    await P.evaluate(() => {
      const r = window.__RIPTIDE__;
      r.autopilot(true);
      r.skipIntro();
      r.simulate(8, 1 / 30);
    });
    const s = await S(P);
    assert(s.phase === 'racing', `${mode}: phase ${s.phase}`);
    assert(s.speed > 10, `${mode}: not moving`);
  }
});

await test('stunt run ends on its timer with a score', async () => {
  await P.evaluate(() => window.__RIPTIDE__.startRace({ mode: 'stunt', trackId: 'coral' }));
  const r = await P.evaluate(() => {
    const x = window.__RIPTIDE__;
    x.autopilot(true);
    x.skipIntro();
    return x.simulateUntil("s.phase === 'results'", 140, 1 / 20);
  });
  assert(r.ok, 'stunt never ended');
  await P.waitForTimeout(400);
  assert((await S(P)).screen === 'results', 'no results');
  await P.keyboard.press('Enter');
  await P.waitForTimeout(600);
});

await test('time trial saves a ghost', async () => {
  await P.evaluate(() => window.__RIPTIDE__.startRace({ mode: 'timetrial', trackId: 'atoll', laps: 1 }));
  const r = await P.evaluate(() => {
    const x = window.__RIPTIDE__;
    x.autopilot(true);
    x.skipIntro();
    return x.simulateUntil("s.phase === 'results'", 140, 1 / 30);
  });
  assert(r.ok, 'time trial never finished');
  await P.waitForTimeout(500);
  const g = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')).ghosts.atoll);
  assert(g && g.samples.length > 100 && g.time > 20, 'ghost not saved');
  await P.keyboard.press('Enter');
  await P.waitForTimeout(600);
});

await test('championship: start cup, race, standings', async () => {
  await P.evaluate(() => window.__RIPTIDE__.setup('championship'));
  await P.waitForTimeout(300);
  await P.click('[data-act="cup"][data-arg="surf"]');
  await P.waitForTimeout(300);
  let s = await S(P);
  assert(s.screen === 'champStandings', 'screen ' + s.screen);
  await P.click('[data-act="champNext"]');
  await P.waitForTimeout(400);
  await P.click('#goBtn');
  await P.waitForFunction(() => window.__RIPTIDE__.stats().phase === 'intro', null, { timeout: 30000 });
  const r = await P.evaluate(() => {
    const x = window.__RIPTIDE__;
    x.autopilot(true);
    x.skipIntro();
    return x.simulateUntil("s.phase === 'results'", 400, 1 / 20);
  });
  assert(r.ok, 'champ race did not finish');
  await P.waitForTimeout(400);
  await P.keyboard.press('Enter');
  await P.waitForTimeout(500);
  s = await S(P);
  assert(s.screen === 'champStandings', 'after race screen ' + s.screen);
  const champ = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')).champ);
  assert(champ && champ.round === 1 && champ.points.some((p) => p > 0), 'champ state not advanced');
});

await test('championship finale awards a trophy', async () => {
  await P.evaluate(() => window.__RIPTIDE__.setChampRound(2));
  await P.click('[data-act="champNext"]');
  await P.waitForFunction(() => window.__RIPTIDE__.stats().phase === 'intro', null, { timeout: 30000 });
  const r = await P.evaluate(() => {
    const x = window.__RIPTIDE__;
    x.autopilot(true);
    x.skipIntro();
    return x.simulateUntil("s.phase === 'results'", 400, 1 / 20);
  });
  assert(r.ok, 'final round did not finish');
  await P.keyboard.press('Enter'); // results → final standings
  await P.evaluate(() => window.__RIPTIDE__.tick());
  assert(await P.isVisible('text=FINAL STANDINGS'), 'no final standings');
  await P.click('[data-act="champTrophy"]');
  await P.waitForTimeout(300);
  assert(await P.isVisible('text=FINAL RESULT'), 'no trophy screen');
  const d = await P.evaluate(() => window.__RIPTIDE__.saveData());
  assert(d.champ === null && typeof d.cups.surf === 'number', 'cup not closed: ' + JSON.stringify(d.champ));
  await P.click('[data-act="continue"]');
  await P.evaluate(() => window.__RIPTIDE__.tick());
  await P.waitForTimeout(500);
  assert((await S(P)).state === 'menu', 'not back at menu');
});

await test('garage customisation persists', async () => {
  await P.evaluate(() => window.__RIPTIDE__.menu());
  await P.evaluate(() => window.__RIPTIDE__.garage());
  await P.waitForTimeout(300);
  await P.click('[data-act="gtab"][data-arg="paint"]');
  await P.click('[data-act="gpaint"][data-arg="hull:#2ad4ff"]');
  await P.click('[data-act="gnum"][data-arg="10"]');
  await P.waitForTimeout(500);
  const liv = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')).liveries.speedster);
  assert(liv.hull === '#2ad4ff' && liv.number === 17, JSON.stringify(liv));
});

await test('settings persist and apply', async () => {
  await P.evaluate(() => window.__RIPTIDE__.settings());
  await P.click('[data-act="stab"][data-arg="gameplay"]');
  await P.click(`[data-act="sset"][data-arg='units:"mph"']`);
  await P.click('[data-act="stab"][data-arg="video"]');
  await P.click(`[data-act="sset"][data-arg='quality:"medium"']`);
  await P.waitForFunction(() => JSON.parse(localStorage.getItem('riptide.save.v1')).settings.quality === 'medium', null, { timeout: 20000 });
  const st = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')).settings);
  assert(st.units === 'mph' && st.quality === 'medium', JSON.stringify(st));
});

await test('keyboard rebinding', async () => {
  await P.click('[data-act="stab"][data-arg="controls"]');
  await P.click('[data-act="sbind"][data-arg="boost"]');
  await P.keyboard.press('KeyN');
  await P.waitForTimeout(400);
  const b = await P.evaluate(() => JSON.parse(localStorage.getItem('riptide.save.v1')).settings.bindings.boost);
  assert(b[0] === 'KeyN', JSON.stringify(b));
});

await test('resizing keeps rendering', async () => {
  await P.evaluate(() => window.__RIPTIDE__.release());
  for (const [w, h] of [[800, 600], [1920, 800], [640, 900], [1280, 720]]) {
    await P.setViewportSize({ width: w, height: h });
    await P.waitForFunction((ww) => document.getElementById('game').clientWidth === ww, w, { timeout: 20000 });
    const dims = await P.evaluate(() => {
      const c = document.getElementById('game');
      return { cw: c.clientWidth, ch: c.clientHeight, bw: c.width, bh: c.height };
    });
    assert(Math.abs(dims.cw - w) < 2 && Math.abs(dims.ch - h) < 2, `canvas css ${dims.cw}x${dims.ch} for ${w}x${h}`);
    assert(dims.bw > 0 && dims.bh > 0, 'zero drawing buffer');
  }
});

await test('no console errors or warnings during the session', async () => {
  const errs = [...new Set(main.errors)];
  assert(errs.length === 0, errs.slice(0, 5).join(' | '));
});

await test('progress survives a reload', async () => {
  await P.reload();
  await P.waitForFunction(() => window.__RIPTIDE__?.ready === true, null, { timeout: 120000 });
  const d = await P.evaluate(() => window.__RIPTIDE__.saveData());
  assert(d.races >= 2 && d.xp > 0 && d.liveries.speedster.number === 17 && d.settings.units === 'mph', `races=${d.races} xp=${d.xp}`);
});
await main.ctx.close();

// ── Isolated pages ───────────────────────────────────────────────────────────
await test('corrupted save data is handled gracefully', async () => {
  const { page, ctx, errors } = await fresh({
    init: () => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('riptide.save.v1', '{"xp": "lots", "owned": 7, "settings": {"master": "loud", "bindings": {"boost": [1,2]}}, "liveries": {"speedster": {"hull": "javascript:alert(1)"}}');
        sessionStorage.setItem('seeded', '1');
      }
    },
  });
  const d = await page.evaluate(() => window.__RIPTIDE__.saveData());
  assert(d.xp === 0 && Array.isArray(d.owned) && d.settings.master === 0.8, 'defaults not restored');
  await page.evaluate(() => window.__RIPTIDE__.menu());
  await page.waitForTimeout(300);
  assert(await page.isVisible('text=Save data was unreadable'), 'no recovery notice');
  // Valid JSON with hostile values.
  await page.evaluate(() => localStorage.setItem('riptide.save.v1', JSON.stringify({ xp: -5, credits: 1e99, owned: ['speedster', 'hax'], liveries: { speedster: { hull: '<img>' } }, settings: { quality: 'ultra', laps: 1000 } })));
  await page.reload();
  await page.waitForFunction(() => window.__RIPTIDE__?.ready === true, null, { timeout: 120000 });
  const d2 = await page.evaluate(() => window.__RIPTIDE__.saveData());
  assert(d2.xp === 0 && d2.credits <= 1e8 && !d2.owned.includes('hax') && d2.liveries.speedster.hull.startsWith('#') && d2.settings.quality === 'auto' && d2.settings.laps === 9, JSON.stringify({ xp: d2.xp, q: d2.settings.quality }));
  const errs = errors.filter((e) => !e.includes('favicon'));
  assert(errs.length === 0, errs.join(' | '));
  await ctx.close();
});

await test('gamepad input drives the boat without errors', async () => {
  const { page, ctx, errors } = await fresh({
    init: () => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
      const pad = { id: 'Fake Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0, vibrationActuator: { playEffect: () => Promise.resolve('complete') } };
      window.__pad = pad;
      navigator.getGamepads = () => [pad, null, null, null];
    },
  });
  await page.evaluate(() => window.__RIPTIDE__.startRace({ trackId: 'coral' }));
  await page.evaluate(() => {
    const r = window.__RIPTIDE__;
    r.skipIntro();
    r.simulate(3.3, 1 / 30);
    window.__pad.buttons[7] = { pressed: true, touched: true, value: 1 }; // RT
    window.__pad.axes[0] = 0.4;
    r.simulate(3, 1 / 30);
    window.__pad.buttons[2] = { pressed: true, touched: true, value: 1 }; // X = nitro
    r.simulate(0.5, 1 / 30);
  });
  const s = await S(page);
  assert(s.speed > 15, 'gamepad throttle did not move the boat: ' + s.speed);
  // Start pauses; D-pad + A navigate the pause menu (QUIT TO MENU is the last item).
  const press = async (i) => {
    await page.evaluate((b) => (window.__pad.buttons[b] = { pressed: true, touched: true, value: 1 }), i);
    await page.evaluate(() => window.__RIPTIDE__.tick());
    await page.evaluate((b) => (window.__pad.buttons[b] = { pressed: false, touched: false, value: 0 }), i);
    await page.evaluate(() => window.__RIPTIDE__.tick());
  };
  await page.evaluate(() => { window.__pad.buttons[7] = { pressed: false, touched: false, value: 0 }; window.__pad.buttons[2] = { pressed: false, touched: false, value: 0 }; window.__pad.axes[0] = 0; });
  await press(9);
  assert((await S(page)).screen === 'pause', 'Start did not pause');
  for (let i = 0; i < 5; i++) await press(13); // RESUME → RESTART → PHOTO → CAMERA → SETTINGS → QUIT
  await press(0);
  await page.evaluate(() => window.__RIPTIDE__.tick());
  assert((await S(page)).state === 'menu', 'gamepad could not quit to menu: ' + JSON.stringify(await S(page)));
  assert(errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await test('menus are keyboard navigable end to end', async () => {
  const { page, ctx, errors } = await fresh();
  await page.keyboard.press('Enter'); // title → menu
  await page.waitForTimeout(500);
  let s = await S(page);
  assert(s.screen === 'menu', 'title did not advance: ' + s.screen);
  await page.keyboard.press('Enter'); // PLAY → setup
  await page.waitForTimeout(500);
  s = await S(page);
  assert(s.screen === 'setup', 'setup not shown: ' + s.screen);
  await page.keyboard.press('Enter'); // START (focused)
  await page.waitForFunction(() => window.__RIPTIDE__.stats().phase === 'intro', null, { timeout: 30000 });
  assert(errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
