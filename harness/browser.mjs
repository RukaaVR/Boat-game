// Shared Playwright launcher for the harness scripts.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CANDIDATES = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);

export async function launch() {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  return chromium.launch({
    executablePath,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
}

export async function openGame(browser, url, { width = 1440, height = 810, dpr = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__RIPTIDE__?.ready === true, null, { timeout: 120000 });
  return { page, ctx, errors };
}
