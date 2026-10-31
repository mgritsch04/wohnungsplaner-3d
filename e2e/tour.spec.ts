import { expect, test } from '@playwright/test';

test('Rundgang: Tour durch die Räume in Augenhöhe, Banner folgt, Esc beendet', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Rundgang' }).click();
  const banner = page.getByTestId('tour-banner');
  await expect(banner).toBeVisible();
  const rooms = new Set<string>();
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(2500);
    if (!(await banner.isVisible())) break;
    rooms.add((await page.getByTestId('tour-room').textContent()) ?? '');
    if (i % 3 === 0) await page.screenshot({ path: info.outputPath(`tour-${i}.png`) });
  }
  expect(rooms.size).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(banner).toBeHidden();
  expect(errors).toEqual([]);
});
