// Draw the app icons into icons/ (run once; build.mjs copies them).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const svg = (size, { maskable = false, rounded = true } = {}) => {
  const pad = maskable ? size * 0.2 : size * 0.08;
  const radius = rounded && !maskable ? size * 0.22 : 0;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#0b6e72"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 100})">
    <path d="M18 78 L18 70 M18 70 Q40 52 62 58 L56 50 M62 58 L54 64" stroke="#5fd0cf" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="14" y="52" font-family="DejaVu Sans" font-weight="bold" font-size="46" fill="#ffffff">C</text>
    <text x="50" y="40" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="#ffffff">♯</text>
    <text x="64" y="88" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="#ffffff">D</text>
  </g>
</svg>`;
};

fs.mkdirSync('icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { rounded: false }],
];
for (const [name, size, opts] of shots) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opts)}</body></html>`);
  await page.screenshot({ path: `icons/${name}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons drawn');
