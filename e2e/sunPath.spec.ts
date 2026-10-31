import { expect, test, type Page } from '@playwright/test';

async function freshStart(page: Page) {
  await page.goto('/?e2e');
  await page.evaluate(async () => {
    for (const name of ['wohnungsplaner-projects', 'wohnungsplaner-assets', 'wohnungsplaner-meta']) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => r(null);
      });
    }
  });
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await page.waitForTimeout(500);
}

test('Sonnenstand: Jahreszeit und Uhrzeit ändern die Sonne je Raum', async ({ page }) => {
  await freshStart(page);
  await page.locator('aside.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
  const controls = page.getByTestId('sun-controls');
  await expect(controls).toBeVisible();
  await expect(page.locator('[data-testid^="sun-room-"]').first()).toContainText(/Std\. direkte Sonne|keine direkte Sonne/);
  await page.getByTestId('season-summer').click();
  const summer = await page.getByTestId('daylight-list').innerText();
  await page.getByTestId('season-winter').click();
  const winter = await page.getByTestId('daylight-list').innerText();
  expect(summer).not.toBe(winter);
  await page.getByTestId('sun-hour').fill('12');
  await expect(page.getByTestId('sun-position')).toContainText(/Sonne steht im/);
  await controls.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/sunpath.png' });
});
