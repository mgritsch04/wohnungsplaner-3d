import { expect, test, type Page } from '@playwright/test';
import { encodeGrayPng, getProject as rawProject } from './fixtures';
import type { Project } from '../src/model/schema';

const getProject = async (page: Page) => (await rawProject(page)) as Project;

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

test('Fotos an Wänden (#86): hängen, ausblenden, Deckkraft, bleibt nach Neuladen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);

  const wallId = (await getProject(page)).walls[0].id;
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'wall', id }), wallId);
  await expect(page.getByText('Kein Foto.')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '+ Foto' }).click();
  await (await chooser).setFiles({ name: 'wohnzimmer.png', mimeType: 'image/png', buffer: encodeGrayPng(60, 40, (x, y) => (x + y) % 256) });

  await expect(page.getByTestId('photo-row')).toHaveCount(1);
  let p = await getProject(page);
  expect(p.photos).toHaveLength(1);
  expect(p.photos[0]).toMatchObject({ wallId, side: 'left', visible: true, opacity: 1 });
  expect(p.photos[0].aspect).toBeCloseTo(1.5, 1);

  await page.getByLabel('Sichtbar').uncheck();
  await page.getByLabel('Deckkraft des Fotos').fill('40');
  await page.getByLabel('Wandseite').selectOption('right');
  p = await getProject(page);
  expect(p.photos[0]).toMatchObject({ visible: false, side: 'right' });
  expect(p.photos[0].opacity).toBeCloseTo(0.4);

  // Projekt und Bild bleiben nach dem Neuladen erhalten
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).photos?.length, { timeout: 10000 }).toBe(1);
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'wall', id }), wallId);
  await expect(page.getByTestId('photo-row').locator('img')).toBeVisible();

  await page.getByRole('button', { name: 'Entfernen' }).click();
  await expect(page.getByTestId('photo-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});
