/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test } from '@playwright/test';

test('doppelte importierte Möbel zusammenführen: Vorschau, Platzierung wandert mit', async ({ page }) => {
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).__wp?.useCatalogStore);
  const base = {
    name: 'KALLAX Regal', category: 'storage', width: 0.77, depth: 0.39, height: 1.47, color: '#d8d0c4',
    model: { type: 'procedural', shape: 'cabinet' }, approximate: true, solid: true, source: 'imported', sourceName: 'IKEA-Auswahl',
  };
  await page.evaluate(async (b) => {
    const wp = (window as any).__wp;
    await wp.useCatalogStore.getState().replaceItems([
      { ...b, id: 'dup-a', tags: ['803.518.66'] },
      { ...b, id: 'dup-b', tags: ['80351866'], price: { amount: 99, currency: 'EUR', status: 'user' } },
    ]);
    wp.useProjectStore.getState().apply((d: any) => {
      d.furniture.push({ id: 'p1', catalogId: 'dup-b', name: b.name, category: b.category, x: 1, y: 1, elevation: 0, rotation: 0, width: b.width, depth: b.depth, height: b.height, color: b.color, model: b.model, quantity: 1, approximate: true, solid: true });
    });
  }, base);
  await page.locator('.sidebar-left, aside').first().getByRole('button', { name: 'Katalog' }).click();
  await page.getByRole('button', { name: /Doppelte \(1\)/ }).click();
  await expect(page.getByTestId('duplicate-group')).toBeVisible();
  await page.getByLabel('Behalten: KALLAX Regal').first().check();
  await page.getByRole('button', { name: 'Zusammenführen…' }).click();
  await expect(page.getByTestId('merge-preview')).toContainText('1 Platzierung');
  await page.screenshot({ path: 'test-results/duplicates.png' });
  await page.getByRole('button', { name: 'Jetzt zusammenführen' }).click();
  const res = await page.evaluate(() => {
    const wp = (window as any).__wp;
    return { items: wp.useCatalogStore.getState().items.map((i: any) => i.id), cat: wp.useProjectStore.getState().project.furniture.find((f: any) => f.id === 'p1').catalogId, price: wp.useCatalogStore.getState().items[0].price?.amount };
  });
  expect(res.items).toHaveLength(1);
  expect(res.cat).toBe(res.items[0]);
});
