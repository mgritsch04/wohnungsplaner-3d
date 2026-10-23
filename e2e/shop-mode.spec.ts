import { expect, test, type Page } from '@playwright/test';

/*
 * Laden-Modus (#361) in einer iPhone-großen Emulation: freie Wände/Nischen, Passt-es-Prüfung,
 * Einkaufsliste mit Haken und Offline-Start über den Service Worker.
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA, serviceWorkers: 'allow' });

async function open(page: Page) {
  await page.goto('/?e2e');
  await expect(page.locator('input.project-name')).toHaveValue('Beispielwohnung');
  await page.getByTestId('open-shop-mode').click();
  await expect(page.getByTestId('shop-mode')).toBeVisible();
}

test('Maße, Passt-es-Prüfung und Haken', async ({ page }) => {
  await open(page);
  // 1. free wall lengths and niches per room
  await expect(page.getByRole('region', { name: 'Wohnzimmer' })).toContainText('Wand frei');
  await expect(page.getByRole('region', { name: 'Schlafzimmer' })).toContainText('Nische');
  await page.screenshot({ path: 'test-results/shop-spans.png' });

  // 2. does it fit?
  await page.getByRole('button', { name: 'Passt es?' }).click();
  await page.getByTestId('shop-w').fill('80');
  await page.getByTestId('shop-d').fill('30');
  await page.getByTestId('shop-h').fill('180');
  await expect(page.getByTestId('shop-answer')).toContainText('Passt an');
  await page.screenshot({ path: 'test-results/shop-fit.png' });
  await page.getByTestId('shop-w').fill('600');
  await expect(page.getByTestId('shop-answer')).toContainText('Passt nirgends');
  await page.getByTestId('shop-w').fill('50');
  await page.getByTestId('shop-h').fill('300');
  await expect(page.getByTestId('shop-answer')).toContainText('höher als die Raumdecke');

  // 3. tick an item: it stays ticked after a reload
  await page.getByRole('button', { name: 'Liste' }).click();
  const sofa = page.getByRole('checkbox', { name: /Sofa 3-Sitzer/ });
  await sofa.check();
  await expect(page.getByText(/1 von \d+ abgehakt/)).toBeVisible();
  await page.screenshot({ path: 'test-results/shop-list.png' });
  await page.goto('/?e2e&laden');
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('checkbox', { name: /Sofa 3-Sitzer/ })).toBeChecked();
});

test('startet ohne Netz', async ({ page, context }) => {
  await open(page);
  // wait until the service worker controls the page and the shell is cached
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/?e2e&laden');
  await expect(page.getByTestId('shop-mode')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wohnzimmer' })).toContainText('Wand frei');
  await expect(page.getByText('Offline')).toBeVisible();
  await page.getByRole('button', { name: 'Passt es?' }).click();
  await page.getByTestId('shop-w').fill('80');
  await page.getByTestId('shop-d').fill('30');
  await page.getByTestId('shop-h').fill('180');
  await expect(page.getByTestId('shop-answer')).toContainText('Passt an');
  await page.screenshot({ path: 'test-results/shop-offline.png' });
});
