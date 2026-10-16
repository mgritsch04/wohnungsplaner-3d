import { expect, test, type Page } from '@playwright/test';
import { getProject, getSelection, planToScreen, syntheticPlanPng, vectorPlanPdf, worldToScreen3d } from './fixtures';
import { boxGlb } from '../src/test/glbFixture';

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
  await page.waitForTimeout(600); // view re-fits after the layout change
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
  await page.waitForTimeout(600); // view re-fits after the layout change
  // zoom out so there is free space right of the sample apartment
  const box = (await page.locator('[data-testid="editor2d"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(600); // view re-fits after the layout change
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

test('imports page 2 of a vector PDF, applies the stated scale and recognises walls', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: vectorPlanPdf() });
  await expect(page.getByText(/Seite wählen/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Seite 2' }).click();
  await expect(page.getByText('Vektorzeichnung', { exact: false })).toBeVisible({ timeout: 15000 });
  // stated scale 1:100 → marked as assumed, not calibrated
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await expect(page.getByText('Maßstab angenommen', { exact: true })).toBeVisible();
  const u = (await getProject(page)).underlay;
  expect(u.calibrated).toBe(false);
  // 5 m in the drawing must map to ~5 m
  expect(u.pixelsPerPoint * 28.3465 * 5 * u.metersPerPixel).toBeCloseTo(5, 2);
  // recognition needs a confirmed calibration: calibrate on the outer top line (5.2 m)
  await page.evaluate(() => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: { underlay: { calibrated: boolean; scaleSource: string } }) => void) => void } } } }).__wp;
    wp.useProjectStore.getState().apply((d) => {
      d.underlay.calibrated = true;
      d.underlay.scaleSource = 'reference';
    });
  });
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/PDF-Vektordaten/).first()).toBeVisible();
  const draft = await page.evaluate(() => (window as unknown as { __wp: { useImportStore: { getState: () => { draft: { walls: { thickness: number }[] } } } } }).__wp.useImportStore.getState().draft);
  expect(draft.walls).toHaveLength(4);
  for (const w of draft.walls) expect(w.thickness).toBeCloseTo(0.2, 1);
  expect(errors).toEqual([]);
});

test('plans a kitchen run along a selected wall', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  const p = await getProject(page);
  // select the north wall of the living room
  const s = await planToScreen(page, 1.0, -0.06);
  await page.mouse.click(s.x, s.y);
  expect((await getSelection(page))?.type).toBe('wall');
  await page.locator('.panel.left').getByRole('button', { name: 'Küche' }).click();
  await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
  const q = await getProject(page);
  const kitchen = q.furniture.filter((f: { kitchen?: unknown }) => f.kitchen);
  expect(kitchen.length).toBeGreaterThanOrEqual(6);
  expect(kitchen.some((f: { kitchen: { type: string } }) => f.kitchen.type === 'countertop')).toBe(true);
  expect(q.furniture.length).toBeGreaterThan(p.furniture.length);
  await expect(page.getByText('Stückliste Küche')).toBeVisible();
});

test('takes over a product from a pasted retailer page (synthetic sample) and places it', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByRole('button', { name: /Produkt von Händlerseite übernehmen/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Produkt von Händlerseite übernehmen' });
  // failure case: garbage input keeps the app usable and adding disabled
  await dlg.getByLabel('Seitenquelltext oder JSON-LD').fill('keine Produktdaten');
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await expect(dlg.getByText('unzureichend')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Hinzufügen und platzieren' })).toBeDisabled();
  // synthetic page (not a real retailer page)
  await dlg.getByLabel('Produkt-URL').fill('https://www.ikea.com/at/de/p/testregal-weiss-00263850/');
  await dlg
    .getByLabel('Seitenquelltext oder JSON-LD')
    .fill('<script type="application/ld+json">{"@type":"Product","name":"TESTREGAL","sku":"00263850","offers":{"price":"59.99","priceCurrency":"EUR"}}</script><p>Breite: 80 cm</p><p>Tiefe: 28 cm</p><p>Höhe: 202 cm</p>');
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await expect(dlg.getByText('vollständig aus Quelle')).toBeVisible();
  await expect(dlg.getByText('IKEA Österreich').first()).toBeVisible();
  await dlg.getByRole('button', { name: 'Hinzufügen und platzieren' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { name: string }) => f.name === 'TESTREGAL')).toBe(true);
  const p = await getProject(page);
  const item = p.furniture.find((f: { name: string }) => f.name === 'TESTREGAL');
  expect(item).toBeTruthy();
  expect(item.width).toBeCloseTo(0.8, 6);
  expect(item.height).toBeCloseTo(2.02, 6);
  expect(item.retailer).toBe('IKEA Österreich');
  expect(item.price.amount).toBe(59.99);
});

test('imports a GLB model into the catalog, places it and attaches a model to an item', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByRole('button', { name: /3D-Modell importieren/ }).click();
  const dlg = page.getByRole('dialog', { name: '3D-Modell importieren' });
  // invalid file first
  await dlg.getByLabel('Modelldatei').setInputFiles({ name: 'kaputt.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('nope') });
  await expect(dlg.getByText(/Kein glTF/)).toBeVisible();
  // valid box model 80 × 60 × 200 cm, modelled in centimetres
  await dlg.getByLabel('Modelldatei').setInputFiles({ name: 'schrank.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(80, 200, 60)) });
  await expect(dlg.getByText('gültig')).toBeVisible();
  await expect(dlg.getByText(/Zentimetern/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Zum Katalog hinzufügen und platzieren' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { name: string }) => f.name === 'schrank')).toBe(true);
  const item = (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'schrank');
  expect(item.model.type).toBe('gltf');
  expect(item.width).toBeCloseTo(0.8, 6);
  expect(item.height).toBeCloseTo(2.0, 6);
  expect(item.approximate).toBe(false);
  // attach a model to an existing procedural item via the properties panel
  const sofa = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa.id);
  await page.getByRole('button', { name: 'Eigenes GLB hinterlegen…' }).click();
  const dlg2 = page.getByRole('dialog', { name: '3D-Modell importieren' });
  await dlg2.getByLabel('Modelldatei').setInputFiles({ name: 'sofa.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(2.1, 0.8, 0.9)) });
  await dlg2.getByRole('button', { name: 'Auf bisherige Maße skalieren' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id).model.type).toBe('gltf');
  const sofa2 = (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id);
  expect(sofa2.model.type).toBe('gltf');
  expect(sofa2.width).toBeCloseTo(sofa.width, 6);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(2500);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('3D: clicking furniture keeps it selected after release; walls stay selectable; orbit drag keeps selection', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(2500);
  const p = await getProject(page);
  const bed = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-bed-160');
  const s = await worldToScreen3d(page, bed.x, 0.55, bed.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // repeated click keeps it selected
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // orbit drag on empty floor does not change the selection
  const f = await worldToScreen3d(page, 1.0, 0, 1.5);
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  await page.mouse.move(f.x + 60, f.y + 10, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // clicking the exposed top of a wall selects that wall
  await page.getByRole('button', { name: '⟲ Kamera' }).click();
  await page.waitForTimeout(800);
  const w = await worldToScreen3d(page, 4.0, 2.6, -0.06);
  await page.mouse.click(w.x, w.y);
  await page.waitForTimeout(400);
  expect((await getSelection(page))?.type).toBe('wall');
});

test('2D: dragging furniture into a wall stops flush (no tunnelling), Alt allows free placement', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const p = await getProject(page);
  const table = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const s = await planToScreen(page, table.x, table.y);
  const target = await planToScreen(page, table.x, -3); // far beyond the north wall
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 3 }); // fast drag
  await page.mouse.up();
  const t = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect(t.y - t.depth / 2).toBeGreaterThanOrEqual(-0.002); // inner face of the north wall is y=0
  expect(t.y - t.depth / 2).toBeLessThan(0.02); // snapped flush
  // a plain click (with tiny jitter) does not move the item
  const s2 = await planToScreen(page, t.x, t.y);
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.down();
  await page.mouse.move(s2.x + 2, s2.y + 1);
  await page.mouse.up();
  const t2 = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect([t2.x, t2.y]).toEqual([t.x, t.y]);
  // Alt = free placement through the wall
  await page.keyboard.down('Alt');
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const t3 = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect(t3.y).toBeLessThan(-1);
});

test('realism mode: time-of-day control with presets, one undo step per drag, no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('Tageszeit', { exact: true })).toHaveCount(0); // only in realism mode
  await page.getByRole('button', { name: 'Realismus' }).click();
  const slider = page.getByLabel('Tageszeit', { exact: true });
  await expect(slider).toBeVisible();
  await page.getByLabel('Tageszeit-Voreinstellung').selectOption({ label: 'Nacht (23:30)' });
  expect((await getProject(page)).settings.timeOfDay).toBe(23.5);
  const pastBefore = await page.evaluate(() => (window as unknown as { __wp: { useProjectStore: { getState: () => { past: unknown[] } } } }).__wp.useProjectStore.getState().past.length);
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = await page.evaluate(() => (window as unknown as { __wp: { useProjectStore: { getState: () => { past: unknown[]; project: { settings: { timeOfDay: number } } } } } }).__wp.useProjectStore.getState());
  expect(after.project.settings.timeOfDay).toBeGreaterThan(10);
  expect(after.project.settings.timeOfDay).toBeLessThan(15);
  expect(after.past.length).toBe(pastBefore + 1);
  await page.waitForTimeout(2500);
  // switching back to planning keeps everything working
  await page.getByRole('button', { name: 'Planung' }).click();
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
