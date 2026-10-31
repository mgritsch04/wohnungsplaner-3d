import { expect, test } from '@playwright/test';

test('Einrichtungsmappe: 3D-Bilder, Möbel je Raum mit Preisen in der Druckansicht', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Mehr' }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Plan drucken / PDF / PNG…' }).click();
  const view = page.getByTestId('print-view');
  await expect(view).toBeVisible();
  await view.getByTestId('mappe-toggle').check();
  await expect(view.getByTestId('mappe-shot').first()).toBeVisible({ timeout: 45_000 });
  expect(await view.getByTestId('mappe-shot').count()).toBeGreaterThanOrEqual(2);
  await expect(view.getByTestId('mappe-room').first()).toBeVisible();
  await expect(view.getByTestId('mappe-total')).toContainText('€');
  await view.getByTestId('mappe-shots').scrollIntoViewIfNeeded();
  await view.getByTestId('mappe-shots').screenshot({ path: 'test-results/mappe-3d.png' });
  await view.getByTestId('mappe-rooms').screenshot({ path: 'test-results/mappe-raeume.png' });
  expect(errors).toEqual([]);
});
