// Podium + trophy presentation: real race finish → podium → results (+ replay),
// a 5th-place podium, the full championship final → trophy → final screen,
// debug previews, and a portrait viewport.
// Usage: node harness/podium-shots.mjs [url] [outPrefix]
import { launch, openGame } from './browser.mjs';
const url = process.argv[2] ?? 'http://localhost:5192/?harness=1';
const out = process.argv[3] ?? 'shots/podium';
const b = await launch();
const { page, errors } = await openGame(b, url);
const R = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (name) => {
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${out}_${name}.png` });
  console.log('shot', name, JSON.stringify(await R(() => ({ s: window.__RIPTIDE__.state, p: window.__RIPTIDE__.podium }))));
};
const advance = (sec) => R((s) => window.__RIPTIDE__.simulate(s), sec);

/** Start a race and end it with the player in `place`, then run to the podium. */
async function finishRace(req, place) {
  await R((r) => window.__RIPTIDE__.startRace(r), req);
  await R(() => {
    const a = window.__RIPTIDE__;
    a.skipIntro();
    a.setPhase('racing');
    a.autopilot(true);
    a.simulate(8);
  });
  await R((p) => window.__RIPTIDE__.game.session.adminFinish(p), place);
  const r = await R(() => window.__RIPTIDE__.simulateUntil("s.phase === 'results'", 10));
  console.log('results phase', r.ok);
}

await page.keyboard.press('Enter');
await page.waitForTimeout(800);

// 1) Quick race won → podium.
await finishRace({ mode: 'quick', trackId: 'coral', laps: 3 }, 1);
await advance(0.05);
await advance(0.9);
await shot('race_1s');
await advance(1.6);
await shot('race_2_5s');
await advance(2.0);
await shot('race_4_5s');
await advance(1.6);
await shot('race_6s');
await advance(1.0);
await shot('results_after');
// WATCH REPLAY still works after the podium.
const hasReplay = await R(() => !!document.querySelector('[data-act=replay]'));
console.log('replay button', hasReplay);
if (hasReplay) {
  await page.click('[data-act=replay]');
  await advance(2);
  await shot('replay');
  await R(() => window.__RIPTIDE__.game.replayExit());
  await advance(0.2);
  await shot('results_after_replay');
}

// 2) Fifth place: podium of the top three with the "YOU FINISHED 5TH" note; skip with Enter.
await finishRace({ mode: 'quick', trackId: 'atoll', laps: 3 }, 5);
await advance(1.8);
await shot('race_5th');
await page.keyboard.press('Enter');
await advance(0.1);
await shot('race_5th_skipped');

// 3) Championship final round won → results → final standings → trophy → final screen.
await R(() => {
  const a = window.__RIPTIDE__;
  a.patchSave({ champ: { cupId: 'surf', round: 2, points: [20, 14, 12, 10, 8, 6] } });
});
await finishRace({ mode: 'championship', trackId: 'shipyard', laps: 3 }, 1);
await advance(7);
await shot('champ_results');
await R(() => window.__RIPTIDE__.afterResults());
await advance(0.1);
await shot('champ_standings');
await page.click('[data-act=champTrophy]');
await advance(1.6);
await shot('trophy_1_6s');
await advance(2.4);
await shot('trophy_4s');
await advance(2.6);
await shot('trophy_6_6s');
await advance(2.5);
await shot('champ_final');

// 4) Debug previews.
await R(() => window.__RIPTIDE__.menu());
await advance(0.2);
await R(() => window.__RIPTIDE__.debugTrophy(2));
await advance(5);
await shot('debug_trophy_silver');
await R(() => window.__RIPTIDE__.skipPodium());
await R(() => window.__RIPTIDE__.debugTrophy(3));
await advance(5);
await shot('debug_trophy_bronze');
await R(() => window.__RIPTIDE__.skipPodium());
await advance(0.1);
await shot('debug_back_to_menu');

const mem = await R(() => window.__RIPTIDE__.gpuMemory());
console.log('gpu memory', JSON.stringify(mem));
console.log(errors.slice(0, 10).join('\n'));
await b.close();

// 5) Portrait / phone layout.
const b2 = await launch();
const g2 = await openGame(b2, url, { width: 420, height: 860 });
await g2.page.keyboard.press('Enter');
await g2.page.waitForTimeout(800);
await g2.page.evaluate(() => window.__RIPTIDE__.debugPodium());
await g2.page.evaluate(() => window.__RIPTIDE__.simulate(5));
await g2.page.waitForTimeout(1300);
await g2.page.screenshot({ path: `${out}_portrait.png` });
console.log(g2.errors.slice(0, 5).join('\n'));
await b2.close();
