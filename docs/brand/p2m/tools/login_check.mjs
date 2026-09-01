// Login page visual check against the running dev server (avoids port conflicts with concurrent sessions).
// Usage: node brand/p2m/tools/login_check.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(path.resolve(process.cwd(), 'web', 'package.json') + path.sep);
const { chromium } = require('@playwright/test');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

await page.goto('http://127.0.0.1:4173/login', { waitUntil: 'networkidle' });
await page.waitForSelector('.login-card', { timeout: 15000 });
await page.waitForTimeout(1600); // let the 1400ms brand-mark reveal finish

const checks = await page.evaluate(() => {
  const mark = document.querySelector('.brand-mark svg');
  const leaf = document.querySelector('.brand-mark .bm-leaf');
  const sat = document.querySelector('.brand-mark .bm-sat');
  const card = document.querySelector('.login-card');
  const dash = leaf ? getComputedStyle(leaf).strokeDashoffset : 'missing';
  const satOpacity = sat ? getComputedStyle(sat).opacity : 'missing';
  return {
    markPresent: !!mark,
    leafDashoffsetAfterReveal: dash,
    satOpacityAfterReveal: satOpacity,
    cardPresent: !!card,
    title: document.querySelector('.brand-title')?.textContent ?? '',
  };
});
console.log(JSON.stringify(checks, null, 2));

await page.screenshot({ path: path.join(root, 'outputs', 'login_integrated.png') });
// zoom crop of the brand head
const head = page.locator('.brand-head');
await head.screenshot({ path: path.join(root, 'outputs', 'login_brand_head.png') });

await browser.close();
console.log('screenshots: outputs/login_integrated.png, outputs/login_brand_head.png');
