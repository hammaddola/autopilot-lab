import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const speedOf = async (page: Page) => Number(await page.getByTestId('hud-speed').first().textContent());

test('starts up with navigation and no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/Autopilot Lab/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  for (const [id, title] of [
    ['studio', 'Simulation Studio'],
    ['training', 'AI Training Lab'],
    ['analytics', 'Analytics'],
    ['library', 'Driver Library'],
    ['settings', 'Settings'],
    ['dashboard', 'Dashboard'],
  ]) {
    await page.getByTestId(`nav-${id}`).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId(`nav-${id}`)).toHaveAttribute('aria-current', 'page');
  }
  expect(errors).toEqual([]);
});

test('manual driving responds to the keyboard and reports collisions', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/#/dashboard');
  await page.getByTestId('quick-manual').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Simulation Studio' })).toBeVisible();
  await expect(page.getByTestId('sim-canvas')).toBeVisible();
  // Manual driving opens in drive mode (full window); Esc leaves it, F re-enters.
  const vp = page.getByTestId('viewport');
  await expect(vp).toHaveClass(/maximized/);
  await page.keyboard.press('Escape');
  await expect(vp).not.toHaveClass(/maximized/);
  await page.keyboard.press('KeyF');
  await expect(vp).toHaveClass(/maximized/);
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => speedOf(page), { timeout: 5000 }).toBeGreaterThan(30);
  // Hold full throttle and steer into the road border: the crash banner must appear.
  await page.keyboard.down('ArrowLeft');
  await expect(page.getByTestId('crash-banner')).toBeVisible({ timeout: 15000 });
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('crash-banner')).toBeHidden();
  await expect(vp).toHaveClass(/maximized/); // a restart keeps drive mode as it was
  await page.getByTestId('vp-maximize').click();
  await expect(vp).not.toHaveClass(/maximized/);
  expect(errors).toEqual([]);
});

test('AI training runs, pauses, resumes, advances generations and saves a driver that round-trips through export/import', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/#/training');
  await page.getByTestId('train-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running');
  await expect(page.getByTestId('stat-generation')).toHaveText('0');
  await expect
    .poll(async () => Number(await page.getByTestId('stat-alive').textContent()), { timeout: 5000 })
    .toBeGreaterThan(0);

  await page.getByTestId('play-pause').click();
  await expect(page.getByTestId('run-status')).toContainText('Paused');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space'); // global shortcut
  await expect(page.getByTestId('run-status')).toContainText('Running');

  await page.getByTestId('speed').getByText('10×').click();
  await page.getByTestId('train-next').click();
  await expect(page.getByTestId('stat-generation')).toHaveText('1', { timeout: 10000 });

  // Save the best driver to the library.
  await page.getByTestId('train-save-driver').click();
  await page.getByRole('dialog').getByLabel('Name').fill('E2E driver');
  await page.getByTestId('dialog-save').click();
  await expect(page.getByText('Saved "E2E driver"')).toBeVisible();

  await page.getByTestId('nav-library').click();
  await expect(page.getByTestId('driver-card')).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  const path = await download.path();
  const json = JSON.parse(readFileSync(path, 'utf8'));
  expect(json.format).toBe('autopilot-lab/driver');
  expect(json.driver.brain.layers).toEqual([8, 8, 4]);

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-driver').click();
  await (await chooser).setFiles(path);
  await expect(page.getByTestId('driver-card')).toHaveCount(2);
  await expect(page.getByText(/Imported "E2E driver" as a copy/)).toBeVisible();

  // Malformed file is rejected with a message, nothing is added.
  const bad = page.waitForEvent('filechooser');
  await page.getByTestId('import-driver').click();
  await (
    await bad
  ).setFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":1,"brain":{"layers":[8,8,4],"genome":[1]}}'),
  });
  await expect(page.getByText(/Import failed/)).toBeVisible();
  await expect(page.getByTestId('driver-card')).toHaveCount(2);

  // Test the saved driver against the scenario.
  await page.getByRole('button', { name: 'Test' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Simulation Studio' })).toBeVisible();
  await expect(page.getByTestId('run-status')).toContainText(/Running|Finished/);
  await expect(page.getByTestId('sensor-table').locator('tbody tr')).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('training persists: checkpoints are listed and can be resumed after reload', async ({ page }) => {
  await page.goto('/#/training');
  await page.getByTestId('train-start').click();
  await expect(page.getByTestId('stat-generation')).toHaveText('0');
  await page.getByTestId('train-save-cp').click();
  await expect(page.getByText(/Checkpoint saved at generation/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('checkpoint-list').locator('.list-item').first()).toBeVisible();
  await page.getByTestId('resume-latest').click();
  await expect(page.getByTestId('run-status')).toContainText('Running');
  await expect(page.getByText(/Resumed/)).toBeVisible();
});

test('theme switching applies and persists', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('theme').getByText('Light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('studio applies a seeded scenario and shows sensor readings', async ({ page }) => {
  await page.goto('/#/studio');
  await page.getByTestId('env-preset').selectOption('curved');
  await page.getByTestId('seed').fill('777');
  await page.getByTestId('seed').dispatchEvent('change');
  await page.getByTestId('apply-env').click();
  await page.getByTestId('mode').getByText('Manual').click();
  await expect(page.getByTestId('sensor-table').locator('tbody tr')).toHaveCount(7);
  await page
    .getByTestId('toggle-perf')
    .waitFor({ state: 'detached' })
    .catch(() => {});
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('autopilot-lab:config') ?? '{}'));
  expect(cfg.env.preset).toBe('curved');
  expect(cfg.env.seed).toBe(777);
});

test('PWA: manifest, service worker and offline reload', async ({ page, context }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  await page.goto('/#/settings');
  await expect(page.getByTestId('sw-status')).toContainText('active', { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Make sure the SW controls the page, then go offline.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.getByTestId('nav-training').click();
  await expect(page.getByRole('heading', { level: 1, name: 'AI Training Lab' })).toBeVisible();
  await context.setOffline(false);
});
