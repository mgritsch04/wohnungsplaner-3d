import { expect, test, type Page } from '@playwright/test';
import { getProject, getSelection, planToScreen, syntheticPlanPng } from './fixtures';

const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

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

test('loads the sample apartment in 2D and 3D without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="editor2d"] svg')).toBeVisible();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: /Wohnzimmer – 20,00 m²/ })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('creates a room with numeric dimensions and resizes it', async ({ page }) => {
  await freshStart(page);
  const panel = page.locator('.panel.left');
  await panel.getByLabel('Name').fill('Arbeitszimmer');
  await panel.getByLabel('Breite').fill('320');
  await panel.getByLabel('Tiefe').fill('280');
  await panel.getByLabel('Tiefe').blur();
  await panel.getByRole('button', { name: 'Raum anlegen' }).click();
  const right = page.locator('.panel.right');
  await expect(right.getByText('8,96 m²').first()).toBeVisible();
  // change the width numerically
  const width = right.getByLabel('Breite');
  await width.fill('400');
  await width.press('Enter');
  await expect(right.getByText('11,20 m²').first()).toBeVisible();
  const p = await getProject(page);
  expect(p.rooms.map((r: { name: string }) => r.name)).toContain('Arbeitszimmer');
  // undo restores the previous size
  await page.keyboard.press('Control+z');
  await expect(right.getByText('8,96 m²').first()).toBeVisible();
});

test('selects and drags furniture in 2D, synchronised with the model', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const p = await getProject(page);
  const table = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const start = await planToScreen(page, table.x, table.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 10, { steps: 5 });
  await page.mouse.move(start.x + 80, start.y + 20, { steps: 5 });
  await page.mouse.up();
  const sel = await getSelection(page);
  expect(sel).toEqual({ type: 'furniture', id: table.id });
  const after = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect(after.x).toBeGreaterThan(table.x + 0.3);
  // properties panel shows the item
  await expect(page.locator('.panel.right').getByLabel('Name')).toHaveValue('Couchtisch');
  // rotate with keyboard and delete
  await page.keyboard.press('e');
  const rotated = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect(rotated.rotation).toBeCloseTo(Math.PI / 12, 5);
  await page.keyboard.press('Delete');
  expect((await getProject(page)).furniture.some((f: { id: string }) => f.id === table.id)).toBe(false);
});

test('draws walls with typed lengths and auto-creates a room', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.locator('.panel.left').getByRole('button', { name: /Wand/ }).first().click();
  const o = { x: 12, y: 0 };
  const s = await planToScreen(page, o.x, o.y);
  await page.mouse.click(s.x, s.y);
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (const [dx, dy] of dirs) {
    // hover in the direction, then type the length
    const last = await page.evaluate(() => {
      const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { project: { nodes: { x: number; y: number }[] } } } } }).__wp;
      const n = wp.useProjectStore.getState().project.nodes;
      return n[n.length - 1];
    });
    const base = last && last.x >= 11.9 ? last : o;
    const target = await planToScreen(page, base.x + dx * 2, base.y + dy * 2);
    await page.mouse.move(target.x, target.y, { steps: 3 });
    await page.keyboard.type('300');
    await page.keyboard.press('Enter');
  }
  // close the loop by clicking the start point
  const close = await planToScreen(page, o.x, o.y);
  await page.mouse.move(close.x, close.y, { steps: 3 });
  await page.mouse.click(close.x, close.y);
  const p = await getProject(page);
  const xs = p.nodes.filter((n: { x: number }) => n.x >= 11.9);
  expect(xs.length).toBe(4);
  const room = p.rooms[p.rooms.length - 1];
  expect(room.nodeIds.length).toBe(4);
  // 3 m centerline square with 12 cm walls → 2.88 m × 2.88 m clear interior
  await expect(page.locator('.panel.right').getByText('8,29 m²').first()).toBeVisible();
});

test('persists the project in IndexedDB and restores it after reload', async ({ page }) => {
  await freshStart(page);
  const name = page.locator('input.project-name');
  await name.fill('Meine Wohnung Top 7');
  await name.blur();
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('input.project-name')).toHaveValue('Meine Wohnung Top 7');
});

test('imports an apartment-plan.json through the review stage', async ({ page }) => {
  await freshStart(page);
  const plan = {
    format: 'apartment-plan',
    version: 1,
    units: 'cm',
    name: 'Importtest',
    walls: [
      { id: 'w1', start: [0, 0], end: [600, 0], thickness: 20 },
      { id: 'w2', start: [600, 0], end: [600, 400], thickness: 20 },
      { id: 'w3', start: [600, 400], end: [0, 400], thickness: 20 },
      { id: 'w4', start: [0, 400], end: [0, 0], thickness: 20 },
      { id: 'w5', start: [350, 0], end: [350, 400], thickness: 10 },
    ],
    openings: [
      { type: 'door', wall: 'w5', offset: 200, width: 90 },
      { type: 'window', wall: 'w1', offset: 150, width: 120, sillHeight: 90, height: 140 },
    ],
    rooms: [
      { name: 'Küche', labelPoint: [150, 200], statedArea: 12.4 },
      { name: 'Bad', labelPoint: [480, 200] },
    ],
  };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Projekt ▾' }).click();
  await page.getByRole('button', { name: 'Grundriss-JSON importieren…' }).click();
  await (await chooser).setFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await expect(page.getByText('Import prüfen')).toBeVisible();
  await page.locator('.panel.left').getByLabel('Übernahme').selectOption('replace');
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  await page.getByRole('button', { name: 'Ersetzen' }).click();
  const p = await getProject(page);
  expect(p.rooms.map((r: { name: string }) => r.name).sort()).toEqual(['Bad', 'Küche']);
  expect(p.openings).toHaveLength(2);
  expect(p.walls.length).toBe(7); // outer walls split at the T-junctions
});

test('imports a raster plan, calibrates the scale and recognises walls', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'grundriss.png', mimeType: 'image/png', buffer: syntheticPlanPng() });
  await expect(page.getByText('Nicht kalibriert', { exact: true })).toBeVisible();
  // calibrate: the top wall centerline from x=100px to x=600px is 5 m
  await page.getByRole('button', { name: 'Maßstab kalibrieren (2 Punkte)' }).click();
  const u = (await getProject(page)).underlay;
  const toWorld = (px: number, py: number) => ({ x: u.x + px * u.metersPerPixel, y: u.y + py * u.metersPerPixel });
  const a = toWorld(100, 100);
  const b = toWorld(600, 100);
  const sa = await planToScreen(page, a.x, a.y);
  const sb = await planToScreen(page, b.x, b.y);
  await page.mouse.click(sa.x, sa.y);
  await page.mouse.click(sb.x, sb.y);
  await page.getByLabel('Reale Länge (cm)').fill('500');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('Kalibriert', { exact: true })).toBeVisible();
  const cal = (await getProject(page)).underlay;
  expect(cal.metersPerPixel).toBeGreaterThan(0.0095);
  expect(cal.metersPerPixel).toBeLessThan(0.0105);
  // automatic recognition
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
  const draft = await page.evaluate(() => (window as unknown as { __wp: { useImportStore: { getState: () => { draft: unknown } } } }).__wp.useImportStore.getState().draft);
  const d = draft as { walls: { thickness: number }[]; openings: { kind: string; width: number }[] };
  expect(d.walls.length).toBeGreaterThanOrEqual(4);
  expect(d.openings.length).toBeGreaterThanOrEqual(1);
  expect(Math.abs(d.openings[0].width - 1)).toBeLessThan(0.1);
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  // uncertain elements require confirmation
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  const p = await getProject(page);
  expect(p.walls.length).toBeGreaterThanOrEqual(4);
  expect(p.openings.length).toBeGreaterThanOrEqual(1);
});

test('walkthrough mode can be entered and left', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.locator('.walk-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('exports the shopping list as CSV', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.right').getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByText('Summe (bekannte Preise)')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Einkaufsliste als CSV exportieren' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/einkaufsliste\.csv$/);
});
