import { expect, test, type Page } from '@playwright/test';

/** Reads every record of an IndexedDB store through the page (the app's own database). */
const readStore = (page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('autopilot-lab');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
        };
      }),
    store,
  );

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test('double-clicking Start launches exactly one run', async ({ page }) => {
  await page.goto('/#/training');
  await page.getByTestId('train-start').dblclick();
  await expect(page.getByTestId('run-status')).toContainText('Running');
  await page.waitForTimeout(500);
  expect(await readStore(page, 'experiments')).toHaveLength(1);
});

test('hidden-layer slider keeps focus and works from the keyboard', async ({ page }) => {
  await page.goto('/#/training');
  const layers = page.getByTestId('arch-layers');
  await layers.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(layers).toHaveValue('3');
  await expect(layers).toBeFocused();
  await expect(page.getByText(/^Layer \d neurons$/)).toHaveCount(3);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(layers).toHaveValue('1');
});

test('auto checkpoint is listed in the same generation it is saved', async ({ page }) => {
  await page.goto('/#/training');
  const every = page.getByTestId('ga-autocheckpoint');
  await every.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); // every generation
  await expect(every).toHaveValue('1');
  await page.getByTestId('train-start').click();
  await page.getByTestId('train-next').click();
  await expect(page.getByTestId('stat-generation')).toHaveText('1', { timeout: 10_000 });
  await blur(page);
  await page.keyboard.press('Space'); // pause so no later generation can refresh the list
  await expect(page.getByTestId('checkpoint-list')).toContainText('Gen 1 · auto');
});

test('damaged checkpoint warning is shown once, and Load works without picking', async ({ page }) => {
  await page.goto('/#/training');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('autopilot-lab');
        open.onsuccess = () => {
          const tx = open.result.transaction('checkpoints', 'readwrite');
          tx.objectStore('checkpoints').put({ id: 'broken', experimentId: 'x', schemaVersion: 1 });
          tx.oncomplete = () => (open.result.close(), resolve());
        };
      }),
  );
  await page.reload();
  await page.getByTestId('train-start').click();
  await page.getByTestId('train-next').click();
  await expect(page.getByTestId('stat-generation')).toHaveText('1', { timeout: 10_000 });
  await page.getByTestId('train-next').click();
  await expect(page.getByTestId('stat-generation')).toHaveText('2', { timeout: 10_000 });
  await expect(page.getByText(/damaged checkpoint/)).toHaveCount(1);

  await page.getByTestId('train-stop').click();
  await expect(page.getByText('Training stopped. A checkpoint was saved.')).toBeVisible();
  await page.getByTestId('train-load-cp').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load' }).click();
  await expect(page.getByText(/Resumed/)).toBeVisible();
  await expect(page.getByTestId('run-status')).toContainText('Running');
});
