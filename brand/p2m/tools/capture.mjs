// Deterministic motion-frame capture + easing probe for logo_motion.html (pixel2motion Phase 3 QA).
// Uses the ?t=<ms> / ?static=1 hooks. Same pipeline for all frames => Final Frame Contract check is exact.
// Usage: node brand/p2m/tools/capture.mjs   (run from repo root)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(path.resolve(process.cwd(), 'web', 'package.json') + path.sep);
const { chromium } = require('@playwright/test');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(path.join(root, 'logo_motion.html')).href;
const outDir = path.join(root, 'outputs', 'motion_frames');

const TIMES = [0, 200, 500, 750, 1000, 1232, 1400];
const PROBES = [
  { t: 400, sel: '#leaf', prop: 'stroke-dashoffset' },
  { t: 500, sel: '#leaf', prop: 'stroke-dashoffset' },
  { t: 600, sel: '#leaf', prop: 'stroke-dashoffset' },
  { t: 700, sel: '#orbit', prop: 'stroke-dashoffset' },
  { t: 1000, sel: '#orbit', prop: 'stroke-dashoffset' },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });

async function seek(url) {
  await page.goto(url);
  await page.waitForFunction('window.__p2mReady === true', null, { timeout: 10000 });
}

for (const t of TIMES) {
  await seek(`${htmlUrl}?t=${t}`);
  const el = page.locator('#logo-root');
  await el.screenshot({ path: path.join(outDir, `t_${String(t).padStart(4, '0')}.png`) });
  console.log(`captured t=${t}`);
}

await seek(`${htmlUrl}?static=1`);
await page.locator('#logo-root').screenshot({ path: path.join(outDir, 'static.png') });
console.log('captured static=1');

// Easing probe: dashoffset should follow the designed ease, NOT the linear window fraction.
for (const p of PROBES) {
  await seek(`${htmlUrl}?t=${p.t}`);
  const val = await page.evaluate(
    ([sel, prop]) => getComputedStyle(document.querySelector(sel))[prop],
    [p.sel, p.prop],
  );
  console.log(`probe t=${p.t} ${p.sel} ${p.prop} = ${val}`);
}

await browser.close();
console.log('done');
