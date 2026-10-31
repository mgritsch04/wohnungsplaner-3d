import { expect, test, type Page } from '@playwright/test';
import { syntheticPlanPng } from './fixtures';

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

test('Mieter-Paket: Markierungen mit Notiz und Foto, Bohrloch-Plan, Übergabeprotokoll (#362)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  await page.getByRole('button', { name: 'Werkzeuge', exact: true }).first().click().catch(() => {});
  // Mieter-Paket ist eingeklappt (#461): Werkzeug „Markierung“ klappt die Gruppe auf
  await page.getByRole('button', { name: 'Markierung', exact: true }).click();
  await expect(page.getByTestId('mark-kind')).toBeVisible();

  // 1. Zustand setzen, Notiz + Foto
  const editor = page.getByTestId('editor2d');
  const box = (await editor.boundingBox())!;
  await page.getByTestId('mark-kind').getByRole('button', { name: 'Zustand' }).click();
  await page.getByTestId('mark-tool').click();
  await editor.click({ position: { x: box.width * 0.35, y: box.height * 0.45 } });
  await page.getByLabel('Notiz Z1').fill('Kratzer im Parkett links vom Fenster');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Foto anhängen' }).click();
  (await chooser).setFiles({ name: 'zustand.png', mimeType: 'image/png', buffer: syntheticPlanPng() });
  await expect(page.getByAltText('Foto Z1')).toBeVisible();

  // 2. Bohrloch + Klebestelle
  await page.getByTestId('mark-kind').getByRole('button', { name: 'Bohrloch' }).click();
  await page.getByTestId('mark-tool').click();
  await editor.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.getByLabel('Notiz B1').fill('6 mm, Regal');
  await page.getByTestId('mark-kind').getByRole('button', { name: 'Klebestelle' }).click();
  await page.getByTestId('mark-tool').click();
  await editor.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
  await expect(page.getByTestId('mark')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/handover-plan.png' });

  // 3. Protokoll
  await page.getByTestId('open-handover').click();
  const view = page.getByTestId('handover-view');
  await expect(view.getByTestId('handover-plan-condition').locator('[data-kind="condition"]')).toHaveCount(1);
  await expect(view.getByTestId('handover-plan-drill').locator('[data-testid="mark"]')).toHaveCount(2);
  await expect(view.getByTestId('handover-mark')).toHaveCount(3);
  await expect(view.getByText('Kratzer im Parkett links vom Fenster')).toBeVisible();
  await expect(view.getByAltText('Foto Z1')).toBeVisible();
  await expect(view.getByText('6 mm, Regal')).toBeVisible();
  await page.screenshot({ path: 'test-results/handover-protocol.png', fullPage: true });
  expect(errors).toEqual([]);
});
