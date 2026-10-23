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

test('Lux-Lichtkarte: Schreibtisch ohne Lampe zu dunkel, mit stärkerer Lampe ok (#360)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);

  // Arbeitsplatz im Schlafzimmer: Schreibtisch, noch ohne Lampe
  await page.evaluate(() => {
    const s = (window as any).__wp.useProjectStore.getState();
    s.apply((d: any) => {
      const base = d.furniture[0];
      const mk = (id: string, name: string, category: string, shape: string, x: number, y: number, w: number, dpt: number, h: number, elevation = 0) => ({
        ...JSON.parse(JSON.stringify(base)),
        id,
        catalogId: undefined,
        name,
        category,
        x,
        y,
        width: w,
        depth: dpt,
        height: h,
        elevation,
        rotation: 0,
        groupId: undefined,
        kitchen: undefined,
        interior: undefined,
        lumen: undefined,
        model: { type: 'procedural', shape },
      });
      d.furniture.push(mk('desk_lux', 'Schreibtisch 140×70', 'desk', 'desk', 7, 1.2, 1.4, 0.7, 0.74));
    });
  });
  await page.locator('aside.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
  await page.getByText('Lichtkarte (Lux) im Plan anzeigen').click();
  await expect(page.getByTestId('lux-overlay')).toBeVisible();
  await expect(page.getByTestId('lux-hint')).toContainText('Schätzung');
  await expect(page.getByTestId('lux-room').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/lux-ohne-lampe.png' });

  const desk = page.getByTestId('lux-surface').filter({ hasText: 'Schreibtisch' });
  await expect(desk).toHaveAttribute('data-status', 'dark');
  await expect(desk).toContainText('zu dunkel');
  await expect(page.getByTestId('lux-warning')).toHaveCount(1);

  // stärkere Lampe über den Schreibtisch
  await page.evaluate(() => {
    const s = (window as any).__wp.useProjectStore.getState();
    s.apply((d: any) => {
      const lamp = JSON.parse(JSON.stringify(d.furniture.find((f: any) => f.id === 'desk_lux')));
      Object.assign(lamp, { id: 'lamp_lux', name: 'Tischlampe', category: 'lighting', x: 7.2, y: 1.2, width: 0.25, depth: 0.25, height: 0.45, elevation: 0.75, lumen: 800, model: { type: 'procedural', shape: 'table-lamp' } });
      d.furniture.push(lamp);
    });
  });
  await expect(page.getByTestId('lux-surface').filter({ hasText: 'Schreibtisch' })).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('lux-warning')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/lux-mit-lampe.png' });

  // Tagmodus: Tageslicht kommt dazu
  await page.getByLabel('Situation').selectOption('day');
  await expect(page.getByTestId('lux-overlay')).toBeVisible();
  expect(errors).toEqual([]);
});
