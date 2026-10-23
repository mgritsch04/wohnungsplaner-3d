import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
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

test('Kaufplan in Phasen: Phasen, Budget-Warnung, Smart-Home-Gerät später (#363)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);

  await page.evaluate(() => {
    const s = (window as any).__wp.useProjectStore.getState();
    s.apply((d: any) => {
      const base = d.furniture[0];
      const mk = (id: string, name: string, amount: number) => ({
        ...JSON.parse(JSON.stringify(base)),
        id,
        name,
        existing: false,
        quantity: 1,
        buyPhase: undefined,
        groupId: undefined,
        kitchen: undefined,
        interior: undefined,
        price: { amount, status: 'user' },
      });
      d.furniture.length = 0;
      d.furniture.push(mk('k_sofa', 'Sofa Testmodell', 800), mk('k_regal', 'Regal Testmodell', 200));
      d.devices.push({ id: 'k_motion', name: 'Bewegungsmelder Flur', kind: 'motion', productId: 'ikea-vallhorn', x: 1, y: 1, elevation: 2.1, rotation: 0 });
    });
  });
  await page.locator('aside.panel.right').getByRole('button', { name: 'Budget' }).click();

  // alles startet zum Einzug
  const movein = page.getByTestId('kaufplan-movein');
  await expect(movein).toContainText('Sofa Testmodell');
  await expect(movein).toContainText('Regal Testmodell');
  const totalBefore = await page.locator('section', { hasText: 'Kaufplan in Phasen' }).locator('.budget-total strong').innerText();

  // 1) Regal in Monat 2
  await page.getByLabel('Phase für Regal Testmodell').selectOption('month2');
  await expect(page.getByTestId('kaufplan-month2')).toContainText('Regal Testmodell');
  await expect(movein).not.toContainText('Regal Testmodell');

  // 2) Budget kleiner als die Phasensumme -> Warnung
  await page.getByLabel('Budget Zum Einzug').fill('500');
  await expect(movein).toContainText('Über Budget');
  await page.getByLabel('Budget Zum Einzug').fill('2000');
  await expect(movein).not.toContainText('Über Budget');
  await page.getByLabel('Budget Zum Einzug').fill('500');
  await page.screenshot({ path: 'test-results/kaufplan.png' });

  // 3) Smart-Home-Gerät später
  await expect(movein).toContainText('Bewegungsmelder Flur');
  await page.getByLabel('Phase für Bewegungsmelder Flur').selectOption('later');
  await expect(page.getByTestId('kaufplan-later')).toContainText('Bewegungsmelder Flur');
  await expect(movein).not.toContainText('Bewegungsmelder Flur');
  const totalAfter = await page.locator('section', { hasText: 'Kaufplan in Phasen' }).locator('.budget-total strong').innerText();
  expect(totalAfter).toBe(totalBefore);
  expect(errors).toEqual([]);
});
