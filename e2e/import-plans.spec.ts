/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cadFilledPlanPdf, clippedCadPlanPdf, installationPlanPdf, getProject, getSelection, planToScreen, syntheticPlanPng, vectorPlanPdf, worldToScreen3d } from './fixtures';
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
  expect(Math.abs(d.openings[0].width - 1)).toBeLessThan(0.15); // doors lose the jamb allowance (#267)
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  // uncertain elements require confirmation
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  const p = await getProject(page);
  expect(p.walls.length).toBeGreaterThanOrEqual(4);
  expect(p.openings.length).toBeGreaterThanOrEqual(1);
});

test('exports the shopping list as CSV', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.right').getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByText('Summe (bekannte Preise)')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Einkaufsliste als CSV exportieren' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/einkaufsliste\.csv$/);

  // grouped by room (#75): one group per room with its subtotal, CSV with room column and subtotals
  await page.getByRole('combobox', { name: 'Gruppierung' }).selectOption('room');
  const heads = page.locator('.budget-group-head');
  await expect(heads).toHaveCount(2);
  await expect(heads.nth(0)).toContainText('Schlafzimmer');
  await expect(heads.nth(1)).toContainText('Wohnzimmer');
  const download2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Einkaufsliste als CSV exportieren (nach Raum)' }).click();
  const d2 = await download2;
  expect(d2.suggestedFilename()).toMatch(/einkaufsliste-nach-raum\.csv$/);
  const csv = (await readFile((await d2.path())!)).toString('utf8');
  expect(csv).toContain('Raum;Kategorie;Artikel');
  expect(csv).toContain('Zwischensumme Schlafzimmer');
  expect(csv).toContain('Zwischensumme Wohnzimmer');
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

test('CAD plan with solid dark walls, coloured rooms (as strips) and a tile hatch: real walls only, rooms named from the labels (#114)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'grundriss-a3.pdf', mimeType: 'application/pdf', buffer: cadFilledPlanPdf() });
  await expect(page.getByRole('button', { name: 'Aus Angabe übernehmen' })).toBeVisible({ timeout: 15000 });
  await page.locator('.field-row.compact input').fill('75');
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await page.evaluate(() => {
     
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      d.underlay.calibrated = true;
      d.underlay.scaleSource = 'reference';
    });
  });
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
   
  const draft = await page.evaluate(() => (window as any).__wp.useImportStore.getState().draft);
  expect(draft.source).toBe('pdf-vector');
  // 4 outer walls (30 cm) + 3 inner walls (12 cm); no phantom walls from strips or tiles
  expect(draft.walls).toHaveLength(7);
  const thick = draft.walls.map((w: { thickness: number }) => w.thickness).sort();
  expect(thick.filter((t: number) => Math.abs(t - 0.12) < 0.02)).toHaveLength(3);
  expect(thick.filter((t: number) => Math.abs(t - 0.3) < 0.02)).toHaveLength(4);
  // entrance + three inner doors are gaps
  expect(draft.openings.length).toBeGreaterThanOrEqual(4);
  const rooms = draft.rooms.map((r: { name: string; statedArea?: number }) => [r.name, r.statedArea]).sort();
  expect(rooms).toEqual([['Bad', 6], ['Kueche', 6], ['Schlafen', 14], ['Wohnen', 32.5]]);
  expect(errors).toEqual([]);
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

test('product type comes from the page (armchair stays an armchair); unknown type must be chosen (#8)', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByRole('button', { name: /Produkt von Händlerseite übernehmen/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Produkt von Händlerseite übernehmen' });
  const category = dlg.getByLabel('Kategorie');
  // synthetic shop page: unknown model name, breadcrumb says "Sessel"
  const crumbs = '{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Wohnzimmer"},{"@type":"ListItem","position":2,"name":"Sessel"}]}';
  await dlg
    .getByLabel('Seitenquelltext oder JSON-LD')
    .fill(`<script type="application/ld+json">${crumbs}</script><script type="application/ld+json">{"@type":"Product","name":"Aurora","offers":{"price":"299","priceCurrency":"EUR"}}</script><p>Breite: 80 cm</p><p>Tiefe: 85 cm</p><p>Höhe: 95 cm</p>`);
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await expect(category).toHaveValue('sofa');
  await expect(dlg.getByTestId('category-guess')).toContainText('sicher');
  await dlg.getByRole('button', { name: 'Hinzufügen und platzieren' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { name: string }) => f.name === 'Aurora')).toBe(true);
  const item = (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'Aurora');
  expect(item.category).toBe('sofa');
  expect(item.model).toMatchObject({ type: 'procedural', shape: 'armchair' });
  // nothing recognisable → no silent default, adding stays disabled until a category is chosen
  await page.getByRole('button', { name: /Produkt von Händlerseite übernehmen/ }).click();
  await dlg
    .getByLabel('Seitenquelltext oder JSON-LD')
    .fill('<script type="application/ld+json">{"@type":"Product","name":"Modell Nova","offers":{"price":"99","priceCurrency":"EUR"}}</script><p>Breite: 50 cm</p><p>Tiefe: 50 cm</p><p>Höhe: 50 cm</p>');
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await expect(dlg.getByTestId('category-guess')).toContainText('nicht erkannt');
  await expect(category).toHaveValue('');
  await expect(dlg.getByRole('button', { name: 'Hinzufügen und platzieren' })).toBeDisabled();
  await category.selectOption('decor');
  await expect(dlg.getByRole('button', { name: 'Hinzufügen und platzieren' })).toBeEnabled();
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
  // the „3D-Modell“ group of the properties panel is collapsed by default (#99)
  const modelGroup = page.locator('.panel.right').getByRole('button', { name: '3D-Modell', exact: true });
  await expect(modelGroup).toHaveAttribute('aria-expanded', 'false');
  await modelGroup.click();
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

test('retailer page with a 3D model reference (SIMULATED server): CORS fallback, then direct load', async ({ page }) => {
  const MODEL = 'https://models.retailer.invalid/glb/testregal_0123.glb';
  let allowCors = false;
  await page.route(MODEL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'model/gltf-binary',
      headers: allowCors ? { 'access-control-allow-origin': '*' } : {},
      body: Buffer.from(boxGlb(0.8, 2.02, 0.28)),
    }),
  );
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByRole('button', { name: /Produkt von Händlerseite übernehmen/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Produkt von Händlerseite übernehmen' });
  await dlg.getByLabel('Produkt-URL').fill('https://www.ikea.com/at/de/p/testregal-weiss-00263850/');
  await dlg
    .getByLabel('Seitenquelltext oder JSON-LD')
    .fill(`<html><body><script type="application/ld+json">{"@type":"Product","name":"TESTREGAL","offers":{"price":"59.99","priceCurrency":"EUR"}}</script><script type="text/template" id="pip-xr-viewer-model">{"url":"${MODEL}"}</script><dl><dt>Breite:</dt><dd>80 cm</dd><dt>Tiefe:</dt><dd>28 cm</dd><dt>Höhe:</dt><dd>202 cm</dd></dl></body></html>`);
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await expect(dlg.getByText('Verweis im Quelltext gefunden')).toBeVisible();
  // 1) server without CORS permission → clear message, fallback via file picker
  await dlg.getByRole('button', { name: 'Modell direkt laden' }).click();
  await expect(dlg.getByText(/CORS/)).toBeVisible();
  await dlg.getByLabel('Modelldatei für das Produkt').setInputFiles({ name: 'testregal.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(0.8, 2.02, 0.28)) });
  await expect(dlg.getByText('Modell geprüft')).toBeVisible();
  await expect(dlg.getByText('passt')).toBeVisible();
  // 2) server with CORS permission → direct load works
  await dlg.getByRole('button', { name: 'entfernen' }).click();
  allowCors = true;
  await dlg.getByRole('button', { name: 'Modell direkt laden' }).click();
  await expect(dlg.getByText('Modell direkt geladen.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Hinzufügen und platzieren' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { name: string }) => f.name === 'TESTREGAL')).toBe(true);
  const item = (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'TESTREGAL');
  expect(item.model.type).toBe('gltf');
  expect(item.approximate).toBe(false);
  expect(item.width).toBeCloseTo(0.8, 6);
});

test('product list + .glb files chosen together: models attached, missing ones reported, placed with real model', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  // SYNTHETIC list (made-up products) in the format scripts/ikea-products.mjs writes
  const list = {
    format: 'wohnungsplaner-catalog',
    version: 1,
    name: 'Testliste',
    units: 'cm',
    items: [
      { name: 'TESTREGAL mit Modell', category: 'storage', width: 80, depth: 28, height: 202, price: 59.99, modelFile: '00263850.glb' },
      { name: 'TESTSCHRANK ohne Datei', category: 'storage', width: 30, depth: 32, height: 180, modelFile: 'fehlt.glb' },
    ],
  };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Produktliste importieren/ }).click();
  await (await chooser).setFiles([
    { name: 'produktliste.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(list)) },
    { name: '00263850.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(0.8, 2.02, 0.28)) },
  ]);
  await expect(page.getByText(/2 Produkt\(e\) importiert, 1 mit 3D-Modell/)).toBeVisible();
  await expect(page.getByText(/fehlt\.glb/)).toBeVisible();
  await page.getByPlaceholder(/Suchen/).fill('TESTREGAL');
  await page.locator('.panel.left').getByText('TESTREGAL mit Modell').click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { name: string }) => f.name === 'TESTREGAL mit Modell')).toBe(true);
  const item = (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'TESTREGAL mit Modell');
  expect(item.model.type).toBe('gltf');
  expect(item.model.assetId).toBeTruthy();
  expect(item.approximate).toBe(false);
  expect([item.width, item.depth, item.height]).toEqual([0.8, 0.28, 2.02]);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(2500);
  expect(errors).toEqual([]);
});

test('IKEA import folder (#12): whole folder incl. bericht.json works; list first and .glb later also attaches the model', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  // SYNTHETIC list (made-up product) in the format scripts/ikea-products.mjs writes, plus its bericht.json
  const list = {
    format: 'wohnungsplaner-catalog',
    version: 1,
    name: 'Ordnertest',
    units: 'cm',
    items: [{ id: 'r1', name: 'TESTORDNER Regal', category: 'storage', width: 80, depth: 28, height: 202, modelFile: '00000001.glb' }],
  };
  const dir = await mkdtemp(join(tmpdir(), 'ikea-import-'));
  await writeFile(join(dir, 'produktliste.json'), JSON.stringify(list));
  await writeFile(join(dir, 'bericht.json'), JSON.stringify([{ article: '000.000.01', ok: true }]));
  await writeFile(join(dir, '00000001.glb'), Buffer.from(boxGlb(0.8, 2.02, 0.28)));
  // 1) whole folder in one go
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Ordner importieren/ }).click();
  await (await chooser).setFiles(dir);
  await expect(page.getByText(/1 Produkt\(e\) importiert, 1 mit 3D-Modell \(übersprungen: bericht\.json\)/)).toBeVisible();
  // 2) a second list on its own: imported with a hint, then the .glb alone attaches the model
  const list2 = { ...list, name: 'Einzeltest', items: [{ ...list.items[0], name: 'TESTEINZELN Regal' }] };
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Produktliste importieren/ }).click();
  await (await chooser).setFiles([{ name: 'produktliste.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(list2)) }]);
  await expect(page.getByText(/1 Produkt\(e\) importiert\. 1 Produkt\(e\) haben eine 3D-Modelldatei/)).toBeVisible();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Produktliste importieren/ }).click();
  await (await chooser).setFiles([{ name: '00000001.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(0.8, 2.02, 0.28)) }]);
  await expect(page.getByText(/1 von 1 Produkt\(en\) mit 3D-Modell ergänzt/)).toBeVisible();
  await page.getByPlaceholder(/Suchen/).fill('TESTEINZELN');
  await page.locator('.panel.left').getByText('TESTEINZELN Regal').click();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'TESTEINZELN Regal')?.model.type).toBe('gltf');
  await page.getByPlaceholder(/Suchen/).fill('TESTORDNER');
  await page.locator('.panel.left').getByText('TESTORDNER Regal').click();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { name: string }) => f.name === 'TESTORDNER Regal')?.model.type).toBe('gltf');
  expect(errors).toEqual([]);
});

test('imports a stored IKEA PAX planner design (real structure): room + frames at their planned positions', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /IKEA-Planung \(JSON\) importieren/ }).click();
  await (await chooser).setFiles('src/catalog/providers/fixtures/ikea-pax-design.json');
  await expect(page.getByText(/IKEA-Planung übernommen: Raum \+ 5 Korpus/)).toBeVisible();
  const p = await getProject(page);
  expect(p.rooms.some((r: { name: string }) => /IKEA-Planung/.test(r.name))).toBe(true);
  const frames = p.furniture.filter((f: { name: string }) => /PAX Korpus/.test(f.name));
  expect(frames).toHaveLength(5);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/ikea-plan-3d.png' });
  expect(errors).toEqual([]);
});

test('IKEA PAX design + product list (SYNTHETIC names/prices): frames get names and prices, gaps are reported', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /IKEA-Planung \(JSON\) importieren/ }).click();
  await (await chooser).setFiles(['src/catalog/providers/fixtures/ikea-pax-design.json', 'src/catalog/providers/fixtures/ikea-pax-products.synthetic.json']);
  await expect(page.getByText(/IKEA-Planung übernommen: Raum \+ 5 Korpus.*5\/5 mit Produktnamen, 5 mit Preis/)).toBeVisible();
  await expect(page.getByText(/Nicht in der Produktliste gefunden/)).toBeVisible();
  const p = await getProject(page);
  const frames = p.furniture.filter((f: { name: string }) => /SYNTHETISCH Testartikel/.test(f.name));
  expect(frames).toHaveLength(5);
  expect(frames.every((f: { price?: { amount: number } }) => (f.price?.amount ?? 0) > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('recognises a sloped 30° wall in a raster plan and proposes the rooms (#37)', async ({ page }) => {
  const { slopedPlan, slopedPlanPng } = await import('./fixtures');
  const { offsetPolygon, polygonArea } = await import('../src/model/vec');
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'schraege-wand.png', mimeType: 'image/png', buffer: slopedPlanPng() });
  await expect(page.getByText('Nicht kalibriert', { exact: true })).toBeVisible();
  // calibrate on the top wall centerline: x = 100 px … 500 px is 4 m
  await page.getByRole('button', { name: 'Maßstab kalibrieren (2 Punkte)' }).click();
  const u = (await getProject(page)).underlay;
  const toWorld = (px: number, py: number) => ({ x: u.x + px * u.metersPerPixel, y: u.y + py * u.metersPerPixel });
  const a = toWorld(100, 100);
  const b = toWorld(500, 100);
  const sa = await planToScreen(page, a.x, a.y);
  const sb = await planToScreen(page, b.x, b.y);
  await page.mouse.click(sa.x, sa.y);
  await page.mouse.click(sb.x, sb.y);
  await page.getByLabel('Reale Länge (cm)').fill('400');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('Kalibriert', { exact: true })).toBeVisible();
  const cal = (await getProject(page)).underlay;
  const toWorldCal = (px: number, py: number) => ({ x: cal.x + px * cal.metersPerPixel, y: cal.y + py * cal.metersPerPixel });

  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
  type P = { x: number; y: number };
  const draft = await page.evaluate(
    () =>
      (window as unknown as { __wp: { useImportStore: { getState: () => { draft: unknown } } } }).__wp.useImportStore.getState().draft as {
        walls: { a: P; b: P; thickness: number }[];
        openings: { kind: string; center: P; width: number }[];
        rooms: { name: string; area: number; status: string; accepted: boolean }[];
      },
  );
  const len = (w: { a: P; b: P }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const angle = (w: { a: P; b: P }) => ((((Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI) % 180) + 180) % 180;
  // the sloped wall: 30°, 3 m long (centerline), 20 cm thick
  const sloped = draft.walls.filter((w) => Math.abs(angle(w) - 30) < 1);
  expect(sloped).toHaveLength(1);
  expect(Math.abs(len(sloped[0]) - 3)).toBeLessThan(0.05);
  expect(Math.abs(sloped[0].thickness - 0.2)).toBeLessThan(0.03);
  // the door inside the sloped wall
  const [d0, d1] = slopedPlan.slopedDoor.map((q) => toWorldCal(q.x * 100, q.y * 100));
  const doorCenter = { x: (d0.x + d1.x) / 2, y: (d0.y + d1.y) / 2 };
  const door = draft.openings.find((o) => Math.hypot(o.center.x - doorCenter.x, o.center.y - doorCenter.y) < 0.1);
  expect(door).toBeDefined();
  expect(Math.abs(door!.width - 0.8)).toBeLessThan(0.05); // 90 cm gap minus 10 cm jambs (#267)
  // two rooms proposed with their net areas, listed in the review
  expect(draft.rooms).toHaveLength(2);
  const areas = draft.rooms.map((r) => r.area).sort((x, y) => x - y);
  const rightRoom = [slopedPlan.interiorWall[0], ...slopedPlan.outline.slice(1, 4), slopedPlan.interiorWall[1]];
  expect(Math.abs(areas[0] - 1.8 * 3.8)).toBeLessThan(0.15);
  expect(Math.abs(areas[1] - polygonArea(offsetPolygon(rightRoom, -0.1)))).toBeLessThan(0.3);
  await expect(page.getByText(/Raum „Raum 1“ · \d+,\d\d m²/)).toBeVisible();
  // re-proposing from the (unchanged) walls keeps both rooms
  await page.getByRole('button', { name: 'Räume neu vorschlagen' }).click();
  await expect(page.getByText('2 Räume aus den ausgewählten Wänden vorgeschlagen.')).toBeVisible();

  // take it over as the new floor plan
  await page.locator('.panel.left').getByLabel('Übernahme').selectOption('replace');
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click(); // uncertain openings
  await page.getByRole('button', { name: 'Ersetzen' }).click();
  const p = await getProject(page);
  expect(p.rooms.map((r: { name: string }) => r.name).sort()).toEqual(['Raum 1', 'Raum 2']);
  expect(p.openings.length).toBeGreaterThanOrEqual(2);
  // the result renders in 3D
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test('checks the scale against dimension texts of a vector PDF without changing it (#37)', async ({ page }) => {
  const { dimensionedPlanPdf } = await import('./fixtures');
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'bemasst.pdf', mimeType: 'application/pdf', buffer: dimensionedPlanPdf() });
  await expect(page.getByText('Vektorzeichnung', { exact: false })).toBeVisible({ timeout: 15000 });
  // no statement before a scale is set
  await expect(page.getByTestId('dimension-check')).toHaveCount(0);
  // stated scale 1:100 matches the drawing: all four dimensions agree
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await expect(page.getByTestId('dimension-check')).toContainText('passen zum Maßstab (4 Maße');
  // a wrong stated scale (1:110) is reported, not corrected
  await page.getByLabel('Maßstab 1:').fill('110');
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await expect(page.getByTestId('dimension-check')).toContainText('passen nicht zum Maßstab: Abweichung +10,0 %');
  const u = (await getProject(page)).underlay;
  expect(u.pixelsPerPoint * 28.3465 * u.metersPerPixel).toBeCloseTo(1.1, 3); // still 1:110 as entered
  expect(errors).toEqual([]);
});

test('exports the 3D model as a GLB file from the export menu (#87)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Mehr', exact: true }).click(); // exports are in the "Mehr" menu (#100)
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '3D-Modell als GLB …' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('Beispielwohnung.glb');
  const { readFile } = await import('node:fs/promises');
  const glb = await readFile((await d.path())!);
  expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(glb.readUInt32LE(4)).toBe(2); // glTF version 2
  expect(glb.readUInt32LE(8)).toBe(glb.length); // declared length matches
  expect(glb.length).toBeGreaterThan(10_000);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const names = json.nodes.map((n: { name?: string }) => n.name);
  expect(names).toEqual(expect.arrayContaining(['Wände', 'Böden', 'Möbel', 'Wohnzimmer', 'Schlafzimmer', 'Sofa 3-Sitzer']));
  await expect(page.getByText('3D-Modell als GLB exportiert')).toBeVisible();
  expect(errors).toEqual([]);
});

test('catalog: drag and drop places a product at the dropped point in 2D and 3D; outside a room it is rejected (#131)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByLabel('Katalog durchsuchen').fill('Zimmerpflanze');
  const entry = page.locator('.catalog-item', { hasText: 'Zimmerpflanze groß' });
  const svg = page.locator('[data-testid="editor2d"] svg');
  const count = async () => (await getProject(page)).furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').length;
  const before = await count();
  const box = (await svg.boundingBox())!;

  // 2D: dropped in the living room at (2.51, 2.06) → on the 5 cm furniture grid, selected
  const target = await planToScreen(page, 2.51, 2.06);
  await entry.dragTo(svg, { targetPosition: { x: target.x - box.x, y: target.y - box.y } });
  await expect.poll(count).toBe(before + 1);
  const p = await getProject(page);
  const placed = p.furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').at(-1);
  expect(placed.x).toBeCloseTo(2.5, 3);
  expect(placed.y).toBeCloseTo(2.05, 3);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: placed.id });
  await expect(page.getByTestId('drop-ghost')).toHaveCount(0);
  // one undo step removes it again
  await page.keyboard.press('Control+z');
  await expect.poll(count).toBe(before);

  // outside every room (left margin of the fitted plan): rejected with a hint, nothing added
  await entry.dragTo(svg, { targetPosition: { x: 12, y: box.height / 2 } });
  await expect(page.getByText('nicht abgelegt – bitte in einen Raum ziehen')).toBeVisible();
  expect(await count()).toBe(before);

  // 3D: dropped onto the living-room floor near (2.5, 2)
  const canvas = page.locator('[data-testid="scene3d"] canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const cbox = (await canvas.boundingBox())!;
  const s = await worldToScreen3d(page, 2.5, 0, 2);
  await entry.dragTo(canvas, { targetPosition: { x: s.x - cbox.x, y: s.y - cbox.y } });
  await expect.poll(count).toBe(before + 1);
  const q = await getProject(page);
  const placed3d = q.furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').at(-1);
  expect(Math.abs(placed3d.x - 2.5)).toBeLessThan(0.1);
  expect(Math.abs(placed3d.y - 2)).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('empty project: "Grundriss importieren" on the start card opens the file picker and imports the plan (#214)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  const card = page.getByTestId('start-card');
  await expect(card).toBeVisible();

  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await card.getByRole('button', { name: 'Grundriss importieren' }).click();
  await (await chooser).setFiles({ name: 'grundriss.png', mimeType: 'image/png', buffer: syntheticPlanPng() });
  await expect(page.getByText('Nicht kalibriert', { exact: true })).toBeVisible();
  await expect(page.locator('.panel.left .tabs').getByRole('button', { name: /^Import/ })).toHaveClass(/active/);
  await expect.poll(async () => !!(await getProject(page)).underlay).toBe(true);
  // the plan is the next step – the card no longer covers it
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('start-card-reopen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('CAD layout: lines hidden behind the viewport are ignored, a wall cut by it is kept, the balcony becomes a room with railings and a balcony door, door symbols and light partitions are read (#37, #214)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'grundriss-layout.pdf', mimeType: 'application/pdf', buffer: clippedCadPlanPdf() });
  await expect(page.getByRole('button', { name: 'Aus Angabe übernehmen' })).toBeVisible({ timeout: 15000 });
  await page.locator('.field-row.compact input').fill('75');
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await page.evaluate(() => {
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      d.underlay.calibrated = true;
      d.underlay.scaleSource = 'reference';
    });
  });
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
  type W = { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number; height: number };
  type R = { name: string; area: number; statedArea?: number };
  const draft: { walls: W[]; rooms: R[] } = await page.evaluate(() => (window as any).__wp.useImportStore.getState().draft);
  // the neighbouring flat behind the viewport is not proposed
  const names = draft.rooms.map((r) => r.name).sort();
  // the storeroom behind light partitions (drawn only as a light grey fill) is a room of its own (#37)
  expect(names).toEqual(['AR', 'Balkon', 'Schlafen', 'Wohnen']);
  // the east wall, half of it outside the viewport, is still a full wall – the flat is 8 m wide
  const xs = draft.walls.filter((w) => w.height > 2).flatMap((w) => [w.a.x, w.b.x]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(9);
  const bedroom = draft.rooms.find((r) => r.name === 'Schlafen')!;
  expect(bedroom.area).toBeGreaterThan(17);
  expect(bedroom.area).toBeLessThan(21);
  // balcony: three railings (1 m high), its floor area as a room
  expect(draft.walls.filter((w) => w.height === 1)).toHaveLength(3);
  const balcony = draft.rooms.find((r) => r.name === 'Balkon')!;
  expect(balcony.statedArea).toBe(5.8);
  expect(balcony.area).toBeGreaterThan(4.5);
  expect(balcony.area).toBeLessThan(7);
  const storeroom = draft.rooms.find((r) => r.name === 'AR')!;
  expect(storeroom.area).toBeGreaterThan(1);
  expect(storeroom.area).toBeLessThan(2);
  // the opening onto the balcony is a glass balcony door down to the floor (a window without sill), not an inner door (#37)
  type O = { kind: string; width: number; sillHeight: number; hingeSide?: { x: number; y: number }; swingSide?: { x: number; y: number } };
  const openings = (draft as unknown as { openings: O[] }).openings;
  const balconyDoor = openings.find((o) => Math.abs(o.width - 1.5) < 0.1)!;
  expect(balconyDoor).toMatchObject({ kind: 'window', sillHeight: 0 });
  // the partition door: leaf and swing arc give the hinge and the swing side (into the bedroom, east)
  const inner = openings.find((o) => Math.abs(o.width - 0.8) < 0.1)!; // 90 cm gap minus jambs (#267)
  expect(inner.kind).toBe('door');
  expect(inner.hingeSide).toBeDefined();
  expect(inner.swingSide!.x).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button').last().click();
  // (added to the sample flat, whose rooms stay)
  await expect.poll(async () => (await getProject(page)).rooms.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['Balkon', 'Schlafen', 'Wohnen']));
  expect(errors).toEqual([]);
});

test('catalog: while dragging, the item itself is previewed in 2D and 3D instead of the product photo (#217)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByLabel('Katalog durchsuchen').fill('Zimmerpflanze');
  const entry = page.locator('.catalog-item', { hasText: 'Zimmerpflanze groß' });
  const count = async () => (await getProject(page)).furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').length;
  const before = await count();
  const ghost = page.getByTestId('drop-ghost');
  const ebox = (await entry.boundingBox())!;
  const svg = page.locator('[data-testid="editor2d"] svg');
  const box = (await svg.boundingBox())!;

  // 2D: over the living room the plan symbol appears in real size, free spot = level ok
  await page.mouse.move(ebox.x + 20, ebox.y + ebox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ebox.x + 40, ebox.y + ebox.height / 2, { steps: 3 });
  const target = await planToScreen(page, 2.5, 2.05);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-level', 'ok');
  // outside every room: marked as outside (would be rejected)
  await page.mouse.move(box.x + 12, box.y + box.height / 2, { steps: 8 });
  await expect(ghost).toHaveAttribute('data-level', 'outside');
  // back over the catalog and released there: preview gone, nothing added
  await page.mouse.move(ebox.x + 20, ebox.y + ebox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await count()).toBe(before);

  // 3D: a translucent model follows the pointer on the floor and lands exactly there
  const canvas = page.locator('[data-testid="scene3d"] canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const ghost3d = () => page.evaluate(() => {
    const o = (window as any).__wp.three.scene.getObjectByName('catalog-drop-ghost');
    return o ? { x: o.position.x as number, z: o.position.z as number } : null;
  });
  const s = await worldToScreen3d(page, 2.5, 0, 2);
  await page.mouse.move(ebox.x + 20, ebox.y + ebox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ebox.x + 40, ebox.y + ebox.height / 2, { steps: 3 });
  await page.mouse.move(s.x, s.y, { steps: 8 });
  await expect.poll(ghost3d).not.toBeNull();
  const g = (await ghost3d())!;
  await page.mouse.up();
  await expect.poll(count).toBe(before + 1);
  await expect.poll(ghost3d).toBeNull();
  const placed = (await getProject(page)).furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').at(-1);
  expect(placed.x).toBeCloseTo(g.x, 2);
  expect(placed.y).toBeCloseTo(g.z, 2);
  expect(errors).toEqual([]);
});

/** Import of the synthetic installation plan; `symbols` / `sanitary` tick the opt-in boxes. Returns the draft. */
async function importInstallationPlan(page: Page, opts: { symbols: boolean }) {
  await freshStart(page);
  await page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.getByTestId('start-card').getByRole('button', { name: 'Grundriss importieren' }).click();
  await (await chooser).setFiles({ name: 'installationen.pdf', mimeType: 'application/pdf', buffer: installationPlanPdf() });
  await expect(page.getByRole('button', { name: 'Aus Angabe übernehmen' })).toBeVisible({ timeout: 15000 });
  await page.locator('.field-row.compact input').fill('75');
  await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
  await page.evaluate(() => {
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      d.underlay.calibrated = true;
      d.underlay.scaleSource = 'reference';
    });
  });
  if (opts.symbols) {
    await page.getByLabel(/Steckdosen, Schalter, Heizkörper aus Symbolen suchen/).check();
    await page.getByLabel(/WC, Badewanne, Waschbecken aus Symbolen suchen/).check();
  }
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await expect(page.getByText('Import prüfen')).toBeVisible({ timeout: 20000 });
  return page.evaluate(() => (window as any).__wp.useImportStore.getState().draft);
}

const shotDir = process.env.INSTALL_SHOTS;

test('import invents no installations and no duplicate doors by default; "Steckdosen raten" places marked sockets on walls (#371–#374)', async ({ page }) => {
  const errors = collectErrors(page);
  const draft = await importInstallationPlan(page, { symbols: false });
  expect(draft.installations ?? []).toHaveLength(0);
  expect(draft.fixtures ?? []).toHaveLength(0);
  expect(draft.openings.filter((o: { kind: string }) => o.kind === 'door')).toHaveLength(1);
  if (shotDir) await page.screenshot({ path: join(shotDir, '1-standard-pruefansicht.png') });
  await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button').last().click();
  await expect.poll(async () => (await getProject(page)).walls.length).toBeGreaterThan(3);
  expect((await getProject(page)).fixtures).toHaveLength(0);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Werkzeuge' }).click();
  await left.getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();
  await page.getByTestId('guess-sockets').click();
  await expect.poll(async () => (await getProject(page)).fixtures.length).toBeGreaterThan(0);
  const p = await getProject(page);
  for (const f of p.fixtures) {
    expect(f.kind).toBe('socket');
    expect(f.note).toMatch(/geraten/);
  }
  // none in the door gap (x 1.0–1.9 on the south wall) and the room is a 6 × 4 m rectangle
  expect(p.fixtures.some((f: { x: number; y: number }) => f.x > 0.7 && f.x < 2.2 && f.y < 0.5)).toBe(false);
  if (shotDir) await page.screenshot({ path: join(shotDir, '3-steckdosen-raten.png') });
  expect(errors).toEqual([]);
});

test('with the boxes ticked only symbols at a wall face outside openings are proposed (#371)', async ({ page }) => {
  const errors = collectErrors(page);
  const draft = await importInstallationPlan(page, { symbols: true });
  const inst: { kind: string; center: { x: number; y: number } }[] = draft.installations ?? [];
  // the real symbol on the west wall is found
  expect(inst.some((i) => i.kind === 'socket' && Math.hypot(i.center.x - 0.2, i.center.y - 2.0) < 0.6)).toBe(true);
  // the lookalike in the door's swing (1.45, 0.45) is dropped
  expect(inst.some((i) => Math.hypot(i.center.x - 1.45, i.center.y - 0.45) < 0.4)).toBe(false);
  expect(draft.openings.filter((o: { kind: string }) => o.kind === 'door')).toHaveLength(1);
  if (shotDir) await page.screenshot({ path: join(shotDir, '2-mit-haekchen-pruefansicht.png') });
  expect(errors).toEqual([]);
});
