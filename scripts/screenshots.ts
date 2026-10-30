/** Captures README screenshots from a running preview (npm run build && npx vite preview --port 4173). */
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${name}.png` });

// Real training run (nothing staged): start, speed up, let a few generations complete.
await page.goto(`${base}/#/training`);
await page.getByTestId('train-start').click();
await page.getByTestId('speed').getByText('10×').click();
await page.waitForFunction(
  () => Number(document.querySelector('[data-testid="stat-generation"]')?.textContent) >= 3,
  null,
  { timeout: 120_000 },
);
await page.getByTestId('speed').getByText('1×').click();
await page.waitForTimeout(2500);
await shot('training-lab');
await page.getByTestId('train-save-driver').click();
await page.getByRole('dialog').getByLabel('Name').fill('Highway gen 3');
await page.getByTestId('dialog-save').click();
await page.waitForTimeout(500);
await page.goto(`${base}/#/dashboard`);
await page.waitForTimeout(1500);
await shot('dashboard');
await page.goto(`${base}/#/analytics`);
await page.waitForTimeout(1500);
await shot('analytics');
await page.goto(`${base}/#/library`);
await page.waitForTimeout(800);
await shot('driver-library');
await page.getByRole('button', { name: 'Test' }).first().click();
await page.waitForTimeout(2500);
await shot('studio-test');
await page.getByTestId('mode').getByText('Manual').click();
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(1200);
await page.keyboard.up('ArrowUp');
await shot('studio-manual');
await page.goto(`${base}/#/settings`);
await page.getByTestId('theme').getByText('Light').click();
await page.waitForTimeout(400);
await shot('settings-light');
await page.goto(`${base}/#/training`);
await page.waitForTimeout(1500);
await shot('training-lab-light');

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
});
const m = await mobile.newPage();
await m.goto(`${base}/#/studio`);
await m.getByTestId('mode').getByText('Manual').click();
await m.waitForTimeout(1500);
await m.screenshot({ path: 'docs/screenshots/mobile-manual.png' });
await m.goto(`${base}/#/training`);
await m.waitForTimeout(800);
await m.screenshot({ path: 'docs/screenshots/mobile-training.png' });
await browser.close();
console.log('screenshots written');
