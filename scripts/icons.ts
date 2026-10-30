/** Renders public/icons/icon.svg into the PNG sizes the manifest needs (npx tsx scripts/icons.ts). */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, file, pad] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [512, 'icon-maskable-512.png', 0.1], // maskable: keep content inside the safe zone on a full-bleed background
] as const) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<body style="margin:0;background:#0b1220;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: pad === 0 });
}
await browser.close();
console.log('icons written');
