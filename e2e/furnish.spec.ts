import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';
import { derivePlan } from '../src/model/derived';
import { placementIssues } from '../src/model/placement';
import type { Project } from '../src/model/schema';

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

test('Einrichtungsvorschlag (#137): Vorschau ansehen, verwerfen, übernehmen (ein Undo-Schritt), ohne Kollisionen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const before = (await getProject(page)).furniture.length;
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  await left.getByLabel('Umfang').selectOption({ label: 'Wohnzimmer' });
  const room = left.getByTestId('furnish-room');
  await expect(room).toHaveCount(1);
  // the living room already has sofa, coffee table, TV board, rug, floor lamp → only the rest is wished
  await expect(room.getByLabel('Raumtyp')).toHaveValue('living');
  await expect(room.getByLabel('Anzahl Sofa 3-Sitzer')).toHaveValue('0');
  await expect(room.getByLabel('Anzahl Sessel')).toHaveValue('1');
  await room.getByLabel('Möbel hinzufügen').selectOption({ label: 'Zimmerpflanze groß' });

  await left.getByRole('button', { name: 'Vorschlag erstellen' }).click();
  const result = left.getByTestId('furnish-result');
  await expect(result).toBeVisible();
  await expect(left.getByText('noch nicht übernommen')).toBeVisible();
  const preview = page.getByTestId('furnish-preview');
  await expect(preview).toBeVisible();
  const shown = await preview.locator('[data-furnish-item]').count();
  expect(shown).toBeGreaterThanOrEqual(3);
  // a preview does not change the project
  expect((await getProject(page)).furniture.length).toBe(before);

  await left.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(preview).toHaveCount(0);
  expect((await getProject(page)).furniture.length).toBe(before);

  await left.getByRole('button', { name: 'Vorschlag erstellen' }).click();
  await expect(preview).toBeVisible();
  await left.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before + shown);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  const added = p.furniture.slice(before);
  for (const f of added) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
  // budget/bill of materials list the taken items
  await page.locator('.panel.right').getByRole('button', { name: 'Budget' }).click();
  await expect(page.locator('.panel.right').getByText('Sessel').first()).toBeVisible();

  // one undo step removes the whole suggestion
  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before);
  expect(errors).toEqual([]);
});

test('gespeichertes Projekt mit doppelter Möbel-ID wird beim Start repariert statt verworfen (#268)', async ({ page }) => {
  await freshStart(page);
  const p = (await getProject(page)) as Project;
  // the bug: one item saved twice with the same id (a suggestion taken over twice)
  const broken = { ...p, name: 'Kaputter Plan', furniture: [...p.furniture, structuredClone(p.furniture[0])] };
  await page.evaluate(async (json) => {
    const put = (dbName: string, store: string, key: string, value: unknown) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onupgradeneeded = () => open.result.createObjectStore(store);
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite');
          tx.objectStore(store).put(value, key);
          tx.oncomplete = () => resolve(null);
          tx.onerror = () => reject(tx.error);
        };
      });
    const proj = JSON.parse(json) as { id: string };
    await put('wohnungsplaner-projects', 'projects', proj.id, json);
    await put('wohnungsplaner-meta', 'meta', 'lastProjectId', proj.id);
  }, JSON.stringify(broken));
  await page.goto('/?e2e');
  await expect(page.locator('input.project-name')).toHaveValue('Kaputter Plan');
  await expect(page.getByText(/Projekt beim Laden repariert/)).toBeVisible();
  const loaded = (await getProject(page)) as Project;
  expect(loaded.furniture).toHaveLength(p.furniture.length);
  expect(new Set(loaded.furniture.map((f) => f.id)).size).toBe(loaded.furniture.length);
});
