// Rasterise public/icon.svg into the PNG sizes the web manifest needs.
// Usage: node scripts/make-icons.mjs   (uses the Playwright Chromium)
import { launch } from '../harness/browser.mjs';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const b = await launch();
for (const size of [192, 512]) {
  const page = await b.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icon-${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await b.close();
console.log('icons written');
