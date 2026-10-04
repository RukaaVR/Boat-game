// UI layout audit: opens every menu screen at several viewport sizes and flags
// text that is clipped, buttons whose label wraps, and anything pushed off-screen.
//   node harness/ui-audit.mjs --url=http://localhost:4173/ [--shots=dir] [--only=career,settings]
import { launch, openGame } from './browser.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = (args.url ?? 'http://localhost:5173/') + '?harness=1';
const shots = args.shots;
if (shots) mkdirSync(shots, { recursive: true });
const VIEWS = (args.views ?? '1920x1080,1366x768,1280x720,1024x768,844x390,390x844').split(',').map((v) => v.split('x').map(Number));

// [name, js run in the page with g = game, s = screens]
const SCREENS = [
  ['menu', 'g.enterMenu()'],
  ['modes', 's.modes()'],
  ['career', 's.career()'],
  ['challenges', 's.challenges()'],
  ['achievements', 's.achievements()'],
  ['champ', 's.champ()'],
  ['split', 's.splitSetup()'],
  ['setup-quick', "s.eventSetup('quick')"],
  ['setup-battle', "s.eventSetup('battle')"],
  ['setup-timetrial', "s.eventSetup('timetrial')"],
  ['setup-career', "s.eventSetup('career', 'coral')"],
  ['rider', "s.rider('menu')"],
  ...['boats', 'upgrades', 'paint', 'style', 'fx', 'rider'].map((t) => ['garage-' + t, `s.garage('${t}')`]),
  ...['audio', 'video', 'gameplay', 'controls', 'data'].map((t) => ['settings-' + t, `s.settings('menu', '${t}')`]),
  // In-race screens.
  ['race-hud', "return (async () => { await R.startRace({ trackId: 'starfall', laps: 3, items: true }); R.skipIntro(); R.autopilot(true); R.simulate(12, 1 / 30); R.tick(); })()"],
  ['pause', 's.pause()'],
  ['battle-hud', "return (async () => { await R.startRace({ mode: 'battle', trackId: 'lagoon', battleRule: 'balloons' }); R.skipIntro(); R.autopilot(true); R.simulate(10, 1 / 30); R.tick(); })()"],
  ['results', "return (async () => { await R.startRace({ trackId: 'splash', laps: 1 }); R.skipIntro(); R.autopilot(true); R.simulateUntil(\"s.screen === 'podium' || s.screen === 'results'\", 160, 1 / 30); if (R.podium) { R.simulate(0.7, 1 / 30); R.skipPodium(); } R.simulate(0.3, 1 / 30); })()"],
];
const only = args.only ? args.only.split(',') : null;

const browser = await launch();
const report = [];
for (const [w, h] of VIEWS) {
  const { page, ctx } = await openGame(browser, url, { width: w, height: h });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const R = window.__RIPTIDE__;
    R.patchSave({ xp: 999999, credits: 500000, career: { stage: 3 }, playerName: 'MAXIMUMNAME1' });
  });
  for (const [name, js] of SCREENS) {
    if (only && !only.some((o) => name.startsWith(o))) continue;
    await page.evaluate((js) => { const R = window.__RIPTIDE__; const g = R.game; const s = g.screens; return new Function('g', 's', 'R', js)(g, s, R); }, js);
    await page.evaluate(() => window.__RIPTIDE__.tick?.());
    await page.waitForTimeout(1400); // the screen-in animation runs slowly in software-GL Chromium
    const issues = await page.evaluate(() => {
      const out = [];
      const W = innerWidth, H = innerHeight;
      const root = document.querySelector('#ui .screen:last-of-type') ?? document.querySelector('#ui .hud')?.parentElement ?? document.querySelector('#ui');
      const label = (el) => (el.getAttribute('data-act') ? `[${el.getAttribute('data-act')}${el.getAttribute('data-arg') ? '=' + el.getAttribute('data-arg') : ''}] ` : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') + ' ' : '') + '"' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) + '"';
      const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const scroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') return p; } return null; };
      for (const el of root.querySelectorAll('*')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const sc = scroller(el);
        // Off-screen (only for things not inside a scroll area, or the scroll area itself).
        if (!sc && el.children.length === 0 && (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) && (el.textContent || '').trim())
          out.push(`OFFSCREEN ${label(el)} (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
        // Horizontal clipping — including panels that silently scroll sideways.
        if ((cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2 && (el.textContent || '').trim())
          out.push(`CLIPPED-X ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
        if ((cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 2 && (el.textContent || '').trim() && el.clientHeight > 0)
          out.push(`CLIPPED-Y ${label(el)} (${el.scrollHeight} > ${el.clientHeight})`);
      }
      // Any single run of text that broke across lines inside a button / chip /
      // heading / label (those are meant to be one line).
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent.trim()) continue;
        const host = n.parentElement?.closest('.btn, .opt, .tab, h1, .h, .label, .k, .nm, .val, .pill, .badge, .tag');
        if (!host || !vis(host)) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top / 4)));
        if (tops.size > 1) out.push(`WRAPS ${label(host)} "${n.textContent.trim().slice(0, 30)}" w=${Math.round(host.getBoundingClientRect().width)}`);
      }
      return [...new Set(out)];
    });
    if (issues.length) report.push(`\n## ${name} @ ${w}x${h}\n` + issues.map((i) => '  ' + i).join('\n'));
    if (shots) await page.screenshot({ path: `${shots}/${name}_${w}x${h}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(report.length ? report.join('\n') : 'no layout issues found');
