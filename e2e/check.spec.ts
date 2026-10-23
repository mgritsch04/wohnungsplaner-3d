import { expect, test, type Page } from '@playwright/test';
import { getProject, getSelection } from './fixtures';

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

const moveSofa = (page: Page, y: number) =>
  page.evaluate((yy) => {
    const s = (window as any).__wp.useProjectStore.getState();
    s.apply((d: any) => void (d.furniture.find((f: any) => /sofa/i.test(f.name)).y = yy));
  }, y);

test('Wohnungs-Check: Liste, Ampel, Sprung zur Stelle, Mangel beheben (#357)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);

  await page.locator('aside.panel.left nav.tabs button', { hasText: 'Check' }).click();
  await page.getByTestId('check-run').click();
  await expect(page.getByTestId('check-traffic')).toBeVisible();
  await expect(page.getByTestId('check-traffic')).not.toHaveAttribute('data-traffic', 'red');
  await expect(page.getByTestId('check-categories')).toContainText('Türaufschlag: in Ordnung');

  // Mangel: Sofa in die Südwand
  const sofa = (await getProject(page)).furniture.find((f: any) => /sofa/i.test(f.name))!;
  await moveSofa(page, 4.2);
  await page.getByTestId('check-run').click();
  await expect(page.getByTestId('check-traffic')).toHaveAttribute('data-traffic', 'red');
  const item = page.getByTestId('check-item').filter({ hasText: 'Sofa' }).first();
  await expect(item).toBeVisible();
  await page.screenshot({ path: 'test-results/check-red.png' });

  // Klick springt zur Stelle: Auswahl + Ring im Plan
  await item.click();
  expect((await getSelection(page))?.id).toBe(sofa.id);
  await expect(page.getByTestId('check-focus')).toBeVisible();
  await page.screenshot({ path: 'test-results/check-jump.png' });

  // beheben und erneut prüfen
  await moveSofa(page, sofa.y);
  await page.getByTestId('check-run').click();
  await expect(page.getByTestId('check-item').filter({ hasText: 'Sofa' })).toHaveCount(0);
  await expect(page.getByTestId('check-traffic')).not.toHaveAttribute('data-traffic', 'red');
  expect(errors).toEqual([]);
});
