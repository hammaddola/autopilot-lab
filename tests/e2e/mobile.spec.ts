import { expect, test } from '@playwright/test';

test('mobile layout: bottom navigation, no horizontal scroll, touch pedals drive the car', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('nav-training')).toBeVisible();
  const box = await page.locator('.sidebar').boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 2); // docked at the bottom

  for (const path of ['dashboard', 'studio', 'training', 'analytics', 'library', 'settings']) {
    await page.goto(`/#/${path}`);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
  }

  await page.goto('/#/studio');
  await page.getByTestId('mode').getByText('Manual').click();
  await expect(page.getByTestId('touch-controls')).toBeVisible();
  // Drive mode covers the whole screen, bottom navigation included.
  const vb = (await page.getByTestId('viewport').boundingBox())!;
  expect(vb.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(vb.height).toBeGreaterThanOrEqual(vp.height - 1);
  const throttle = page.getByTestId('pad-up');
  const b = (await throttle.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  // Hold via pointer events (tap is too short to accelerate visibly).
  await throttle.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
  await expect
    .poll(async () => Number(await page.getByTestId('hud-speed').textContent()), { timeout: 5000 })
    .toBeGreaterThan(20);
  await throttle.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
  expect(errors).toEqual([]);
});
