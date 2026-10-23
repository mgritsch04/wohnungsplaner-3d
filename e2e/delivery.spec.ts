import { expect, test } from '@playwright/test';
import { getProject } from './fixtures';

/* Lieferweg-Check (#358). */
/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */

async function freshStart(page: import('@playwright/test').Page) {
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

test('Lieferweg prüfen: Sofa passt, ein überbreites Möbel nicht (#358)', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const project = await getProject(page);
  const sofa = project.furniture.find((f: { category: string }) => f.category === 'sofa');
  expect(sofa).toBeTruthy();
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa.id);
  await page.getByRole('button', { name: 'Lieferweg', exact: true }).click();
  await page.getByRole('button', { name: 'Lieferweg prüfen' }).click();
  const res = page.getByTestId('delivery-result');
  await expect(res).toContainText('Schätzung');
  await expect(page.getByTestId('delivery-route')).toBeVisible();
  await page.screenshot({ path: 'test-results/delivery-sofa.png' });

  // make it far wider than any door
  await page.evaluate((id) => {
    const s = (window as any).__wp.useProjectStore.getState();
    s.apply((d: any) => {
      const f = d.furniture.find((x: any) => x.id === id);
      f.width = 3;
      f.depth = 2.5;
      f.height = 2.5;
    });
  }, sofa.id);
  await page.getByRole('button', { name: 'Lieferweg prüfen' }).click();
  await expect(res).toHaveAttribute('data-fits', '0');
  await expect(res).toContainText('nicht');
  await page.screenshot({ path: 'test-results/delivery-toobig.png' });
});
