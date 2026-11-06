/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { encodeGrayPng, getProject } from './fixtures';

const SHOTS = process.env.OWN_SHOTS; // optional folder for screenshots to look at

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
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('Eigene Objekte (#493): Fahrrad, Schreibtisch und Poster anlegen, platzieren, als feste Vorgabe merken', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByTestId('catalog-own-tab').click();
  await expect(left.getByText('Noch keine eigenen Objekte.')).toBeVisible();

  // bike from the typical sizes
  await left.getByTestId('own-new').click();
  const dlg = page.getByRole('dialog', { name: 'Eigenes Objekt anlegen' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Vorlage mit typischen Maßen').selectOption({ label: 'Fahrrad (City / Trekking)' });
  await expect(dlg.getByLabel('Name des Objekts')).toHaveValue('Fahrrad');
  await expect(dlg.getByLabel('Breite')).toHaveValue('175');
  await dlg.getByLabel('Name des Objekts').fill('Mein Rennrad');
  await dlg.getByLabel('Breite').fill('172');
  await dlg.getByLabel('Hauptfarbe').fill('#c0392b');
  await expect(dlg.getByTestId('own-preview')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'dialog-bike');
  await dlg.getByTestId('own-save-place').click();
  await expect(dlg).toHaveCount(0);

  let p = await getProject(page);
  const bike = p.furniture.find((f: any) => f.name === 'Mein Rennrad')!;
  expect(bike).toBeTruthy();
  expect(bike.model.shape).toBe('bike');
  expect(bike.category).toBe('sport');
  expect(bike.width).toBeCloseTo(1.72, 3);
  expect(bike.fixed).toBe(true);
  expect(bike.color).toBe('#c0392b');
  await expect(left.getByTestId('own-list').getByText('Mein Rennrad')).toBeVisible();
  await expect(left.getByText('feste Vorgabe')).toBeVisible();

  // a metal poster with an own photo (a small gradient), without a frame, hung at 1.4 m
  await left.getByTestId('own-new').click();
  await dlg.getByLabel('Vorlage mit typischen Maßen').selectOption({ label: 'Metall-Poster ohne Rahmen 32×45 cm' });
  await expect(dlg.getByLabel('Name des Objekts')).toHaveValue('Metall-Poster ohne Rahmen');
  await dlg.getByLabel('Name des Objekts').fill('Poster Gebirge');
  const png = encodeGrayPng(160, 220, (x, y) => Math.round(40 + (x / 160) * 120 + (y / 220) * 60));
  await dlg.getByLabel('Foto des Posters wählen').setInputFiles({ name: 'motiv.png', mimeType: 'image/png', buffer: png });
  await expect(dlg.getByText(/zugeschnitten/)).toBeVisible();
  await expect(dlg.getByLabel('Ohne Rahmen (z. B. Metall-Poster)')).toBeChecked();
  await page.waitForTimeout(500);
  await shot(page, 'dialog-poster');
  await dlg.getByTestId('own-save').click();
  const saved = await page.evaluate(() => (window as any).__wp.useCatalogStore.getState().items.filter((i: any) => i.source === 'own'));
  expect(saved.map((i: any) => i.name)).toEqual(expect.arrayContaining(['Mein Rennrad', 'Poster Gebirge']));
  const poster = saved.find((i: any) => i.name === 'Poster Gebirge');
  expect(poster.model).toMatchObject({ shape: 'picture', frameless: true });
  expect(poster.model.texture).toMatch(/^data:image\/jpeg;base64,/);
  expect(poster.model.texture.length).toBeLessThan(80_000);
  expect(poster.elevation).toBeCloseTo(1.4);

  // an invalid entry is not saved
  await left.getByTestId('own-new').click();
  await dlg.getByTestId('own-save').click();
  await expect(dlg.getByRole('alert')).toContainText('Bitte einen Namen eingeben.');
  await dlg.getByRole('button', { name: 'Abbrechen' }).click();

  // the poster is placed from the list, then edited: still the same entry
  await left.getByTestId('own-list').getByRole('button', { name: /Poster Gebirge/ }).click();
  p = await getProject(page);
  expect(p.furniture.find((f: any) => f.name === 'Poster Gebirge')).toMatchObject({ elevation: 1.4, model: { frameless: true } });
  await left.getByTestId('own-list').getByRole('button', { name: 'Bearbeiten' }).last().click();
  const edit = page.getByRole('dialog', { name: 'Eigenes Objekt bearbeiten' });
  await expect(edit.getByLabel('Name des Objekts')).toHaveValue(/Poster Gebirge|Mein Rennrad/);
  await edit.getByRole('button', { name: 'Abbrechen' }).click();

  // a normal catalog piece can be turned into an own one and marked as a fixed given
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'Alle Möbel' }).click();
  await left.getByLabel('Katalog durchsuchen').fill('Esstisch 4');
  await left.locator('.catalog-item', { hasText: 'Esstisch 4 Personen' }).first().click();
  const right = page.locator('.panel.right');
  await right.getByText('Erweitert').click();
  await right.getByLabel('Feste Vorgabe (Einrichtungsvorschlag plant darum herum)').check();
  p = await getProject(page);
  expect(p.furniture.find((f: any) => f.name === 'Esstisch 4 Personen' && f.fixed)).toBeTruthy();
  await right.getByTestId('save-as-own').click();
  const own = await page.evaluate(() => (window as any).__wp.useCatalogStore.getState().items.filter((i: any) => i.source === 'own').map((i: any) => i.name));
  expect(own).toContain('Esstisch 4 Personen');

  // 3D: look at the bike and the poster
  await page.evaluate(() => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id: (window as any).__wp.useProjectStore.getState().project.furniture.find((f: any) => f.name === 'Mein Rennrad').id }));
  await page.waitForTimeout(1500);
  await shot(page, 'plan-3d');
  expect(errors).toEqual([]);
});
