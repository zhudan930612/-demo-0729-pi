// Render logo.svg on dark + light backgrounds for geometry QA (pixel2motion Phase 2 evidence).
// Usage: node brand/p2m/tools/render.mjs   (run from repo root; resolves @playwright/test from web/)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.resolve(process.cwd(), 'web', 'package.json') + path.sep);
const { chromium } = require('@playwright/test');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'logo.svg'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 2 });

async function renderTo(bg, outPath, size = 480) {
  await page.setContent(`<style>body{margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:640px;height:640px;}div{width:${size}px;height:${size}px;}div svg{width:100%;height:100%;}</style><div>${svg}</div>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: outPath });
}

await renderTo('#10163a', path.join(root, 'outputs', 'logo_on_dark.png'));
await renderTo('#ffffff', path.join(root, 'outputs', 'logo_on_light.png'));
await renderTo('#10163a', path.join(root, 'final_render.png'));

await browser.close();
console.log('rendered: outputs/logo_on_dark.png, outputs/logo_on_light.png, final_render.png');
