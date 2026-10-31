/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';

async function freshStart(page: Page) {
  await page.goto('/?e2e');
  await page.evaluate(async () => {
    for (const name of ['wohnungsplaner-projects', 'wohnungsplaner-assets', 'wohnungsplaner-meta', 'wohnungsplaner-versions']) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => r(null);
      });
    }
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
}

test('Layout-Varianten: A speichern, als B duplizieren, umbenennen, Grundrisse nebeneinander (#58)', async ({ page }) => {
  await freshStart(page);
  const openVersions = async () => {
    await page.getByRole('button', { name: 'Projekt ▾' }).click();
    await page.getByRole('button', { name: /^Versionen/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Versionen' });
    await expect(dlg).toBeVisible();
    return dlg;
  };
  // Layout A speichern
  let dlg = await openVersions();
  await dlg.getByLabel('Name des Stands').fill('Layout A');
  await dlg.getByRole('button', { name: 'Aktuellen Stand speichern' }).click();
  const items = dlg.getByTestId('version-item');
  await expect(items).toHaveCount(1);
  // als B duplizieren
  await items.first().getByRole('button', { name: 'Duplizieren' }).click();
  await dlg.getByLabel('Name der Kopie').fill('Layout B');
  await dlg.getByRole('button', { name: 'Kopie anlegen' }).click();
  await expect(items).toHaveCount(2);
  // umbenennen
  await items.filter({ hasText: 'Layout B' }).getByRole('button', { name: 'Umbenennen' }).click();
  await dlg.getByLabel('Neuer Name').fill('Layout B (Sofa versetzt)');
  await items.filter({ has: page.getByLabel('Neuer Name') }).getByRole('button', { name: 'Umbenennen', exact: true }).last().click();
  await expect(items.filter({ hasText: 'Layout B (Sofa versetzt)' })).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Schließen' }).click();

  // im Plan ein Möbel verschieben, dann den aktuellen Stand gegen A vergleichen
  await page.evaluate(() => {
    const st = (window as any).__wp?.useProjectStore?.getState?.() ?? null;
    if (!st) throw new Error('store fehlt');
    st.apply((d: any) => {
      d.furniture[0].x += 0.8;
    });
  });
  const moved = (await getProject(page)).furniture[0].name;

  dlg = await openVersions();
  const optA = dlg.getByLabel('Stand A').locator('option', { hasText: /^Layout A \(/ });
  await dlg.getByLabel('Stand A').selectOption({ value: (await optA.getAttribute('value'))! });
  await dlg.getByLabel('Stand B').selectOption({ value: 'current' });
  const plans = dlg.getByTestId('variant-plans');
  await expect(plans).toBeVisible();
  await expect(plans.getByTestId('variant-plan-a').locator('svg')).toBeVisible();
  await expect(plans.getByTestId('variant-plan-b').locator('svg')).toBeVisible();
  await expect(plans.getByTestId('variant-changes')).toContainText(`${moved}: 0,8 m verschoben`);
  await plans.scrollIntoViewIfNeeded();
  await plans.screenshot({ path: 'test-results/variants-side-by-side.png' });
});
