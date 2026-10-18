import { expect, test } from '@playwright/test';

/**
 * Installierbare Web-App (#179): der GitHub-Pages-Build hat Manifest und App-Symbole,
 * registriert den Service Worker und startet danach auch ohne Netz – mit dem gespeicherten Plan.
 */
const APP = '/wohnungsplaner-3d/?e2e';
const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i];

test('Manifest und App-Symbole sind erreichbar', async ({ page, request }) => {
  await page.goto(APP);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/wohnungsplaner-3d/manifest.webmanifest');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, `http://x${href}`).pathname);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(apple!)).ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});

test('startet nach dem ersten Besuch auch offline, der Plan bleibt erhalten', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
  });

  await page.goto(APP);
  await expect(page.locator('input.project-name')).toBeVisible();
  // the service worker installed (all files preloaded) and controls the page
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);

  const name = page.locator('input.project-name');
  await name.fill('Offline-Wohnung');
  await name.blur();
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('input.project-name')).toHaveValue('Offline-Wohnung', { timeout: 20000 });
  // on the phone the app opens in 3D
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('[data-testid="editor2d"] svg')).toBeVisible();
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
