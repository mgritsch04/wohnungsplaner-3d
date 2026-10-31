/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
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

test('failed autosave shows a clear warning with export option and clears after a successful save (#60)', async ({ page }) => {
  await freshStart(page);
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  // simulate a full browser storage: IndexedDB writes fail (test-side only)
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    (window as unknown as { __restorePut: () => void }).__restorePut = () => (IDBObjectStore.prototype.put = orig);
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  const name = page.locator('input.project-name');
  await name.fill('Test Speicherfehler');
  await name.blur();
  const banner = page.getByTestId('save-error-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText('Speicherplatz des Browsers');
  await expect(banner.getByRole('button', { name: 'Jetzt als Datei exportieren' })).toBeVisible();
  await expect(page.getByText('Gespeichert', { exact: true })).toHaveCount(0);
  // storage works again → retry → banner disappears, status "Gespeichert"
  await page.evaluate(() => (window as unknown as { __restorePut: () => void }).__restorePut());
  await banner.getByRole('button', { name: 'Erneut speichern' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();
});

test('bug report: help › "Problem melden" shows browser/version/state, project data only on request (#62)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByTitle('Hilfe & Tastenkürzel').click();
  await page.getByRole('button', { name: 'Problem melden …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Problem melden' });
  await expect(dialog).toBeVisible();
  const text = dialog.getByTestId('bug-report-text');
  await expect(text).toHaveValue(/App-Version: \d+\.\d+\.\d+/);
  await expect(text).toHaveValue(/Browser: .*Chrome/);
  await expect(text).toHaveValue(/Projekt: 2 Räume/);
  await expect(text).not.toHaveValue(/Sofa 3-Sitzer/);
  await dialog.getByLabel('Was ist passiert?').fill('Sofa springt beim Ziehen');
  await expect(text).toHaveValue(/Sofa springt beim Ziehen/);
  await dialog.getByLabel(/Projektdaten anfügen/).check();
  await expect(text).toHaveValue(/Sofa 3-Sitzer/);
  await expect(dialog.getByRole('button', { name: /Issue auf GitHub öffnen/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('exports the plan as PNG and prints plan + parts list on one A4 page (#71, #72)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const right = page.locator('.panel.right');
  await right.getByRole('button', { name: 'Projekt', exact: true }).click();

  // PNG: real PNG signature, sensible size (2× resolution of the sheet)
  const download = page.waitForEvent('download');
  await right.getByRole('button', { name: 'Plan als PNG' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/-grundriss-\d{4}-\d{2}-\d{2}\.png$/);
  const { readFile } = await import('node:fs/promises');
  const png = await readFile((await d.path())!);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.length).toBeGreaterThan(20_000);
  expect(png.length).toBeLessThan(20_000_000);
  expect(png.readUInt32BE(16)).toBeGreaterThan(1000); // IHDR width
  expect(png.readUInt32BE(20)).toBeGreaterThan(500); // IHDR height

  // print view: plan (without grid) and parts list
  await right.getByRole('button', { name: 'Druckansicht / PDF' }).click();
  const view = page.getByTestId('print-view');
  const plan = view.getByTestId('print-plan');
  await expect(plan.locator('svg')).toBeVisible();
  await expect(plan.getByText('Wohnzimmer')).toBeVisible();
  await expect(plan.locator('pattern')).toHaveCount(0);
  await expect(view.getByTestId('print-list').locator('tbody tr').first()).toBeVisible();
  await expect(view.getByText('Stückliste')).toBeVisible();

  // the scale bar has its true length on paper for both orientations
  for (const o of ['A4 hoch', 'A4 quer']) {
    await view.getByRole('button', { name: o }).click();
    const scaleText = await view.locator('.print-header').innerText();
    const den = Number(/Maßstab 1:(\d+)/.exec(scaleText)![1]);
    const bar = plan.getByTestId('scale-bar');
    const meters = Number(await bar.getAttribute('data-length-m'));
    const box = (await bar.locator('rect').nth(2).boundingBox())!;
    const expectedPx = ((meters * 1000) / den) * (96 / 25.4);
    expect(Math.abs(box.width - expectedPx)).toBeLessThan(1.5);
    // plan + list fit the page width
    const page_ = (await view.locator('.print-page').boundingBox())!;
    const svgBox = (await plan.locator('svg').boundingBox())!;
    expect(svgBox.width).toBeLessThanOrEqual(page_.width);
  }

  // print media: only the page, no controls or app UI
  await page.emulateMedia({ media: 'print' });
  await expect(view.getByTestId('print-controls')).toBeHidden();
  await expect(page.locator('header.toolbar')).toBeHidden();
  await expect(page.locator('[data-testid="editor2d"]')).toBeHidden();
  await expect(plan.locator('svg')).toBeVisible();
  await expect(view.getByTestId('print-list')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('project versions: save, move, open restores (one undo step), automatic state, compare, delete, reload (#66, #58)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  const openVersions = async () => {
    await page.getByRole('button', { name: 'Projekt ▾' }).click();
    await page.getByRole('button', { name: /^Versionen/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Versionen' });
    await expect(dlg).toBeVisible();
    return dlg;
  };
  const itemById = async (id: string) => (await getProject(page)).furniture.find((f: { id: string }) => f.id === id);
  const p0 = await getProject(page);
  const table = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');

  // 1. save the current state under a name
  let dlg = await openVersions();
  await expect(dlg.getByText('Noch keine Stände gespeichert.')).toBeVisible();
  await dlg.getByLabel('Name des Stands').fill('Couchtisch Mitte');
  await dlg.getByRole('button', { name: 'Aktuellen Stand speichern' }).click();
  const items = dlg.getByTestId('version-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Couchtisch Mitte');
  await expect(dlg.getByTestId('versions-count')).toContainText('1 von höchstens 30');
  await dlg.getByRole('button', { name: 'Schließen' }).click();

  // 2. move the coffee table
  const start = await planToScreen(page, table.x, table.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 10, { steps: 5 });
  await page.mouse.move(start.x + 80, start.y + 20, { steps: 5 });
  await page.mouse.up();
  const moved = await itemById(table.id);
  expect(moved.x).toBeGreaterThan(table.x + 0.3);

  // 3. open the saved state: old position back, current state kept as automatic state
  dlg = await openVersions();
  await items.filter({ hasText: 'Couchtisch Mitte' }).getByRole('button', { name: 'Öffnen' }).click();
  await expect(dlg).toBeHidden();
  expect((await itemById(table.id)).x).toBeCloseTo(table.x, 6);
  expect((await itemById(table.id)).y).toBeCloseTo(table.y, 6);
  // opening is ONE undo step
  await page.keyboard.press('Control+z');
  expect((await itemById(table.id)).x).toBeCloseTo(moved.x, 6);
  await page.keyboard.press('Control+y');
  expect((await itemById(table.id)).x).toBeCloseTo(table.x, 6);

  // 4. the moved state is reachable as automatic state; compare both
  dlg = await openVersions();
  await expect(items).toHaveCount(2);
  const auto = items.filter({ hasText: 'Automatisch vor dem Wechsel zu „Couchtisch Mitte“' });
  await expect(auto).toHaveCount(1);
  await expect(auto.locator('.version-badge')).toHaveText('automatisch');
  const optionLabel = async (select: string, prefix: string) => (await dlg.getByLabel(select).locator('option').allInnerTexts()).find((t) => t.startsWith(prefix))!;
  await dlg.getByLabel('Stand A').selectOption({ label: await optionLabel('Stand A', 'Couchtisch Mitte') });
  await dlg.getByLabel('Stand B').selectOption({ label: await optionLabel('Stand B', 'Automatisch') });
  const cmp = dlg.getByTestId('versions-compare-table');
  await expect(cmp).toContainText('A: Couchtisch Mitte');
  await expect(cmp).toContainText('B: Automatisch vor dem Wechsel');
  await expect(cmp).toContainText('Wohnzimmer');
  const pieces = p0.furniture.reduce((s: number, f: { quantity: number }) => s + f.quantity, 0);
  const piecesRow = cmp.getByRole('row', { name: /Anzahl Möbel/ });
  await expect(piecesRow.getByRole('cell').nth(0)).toHaveText(String(pieces));
  await expect(piecesRow.getByRole('cell').nth(2)).toHaveText('±0');
  await expect(cmp.getByRole('row', { name: /Bodenfläche gesamt/ }).getByRole('cell').nth(0)).toContainText('m²');
  await expect(cmp.getByRole('row', { name: /Gesamtpreis/ }).getByRole('cell').nth(0)).toContainText('€');

  // open the automatic state: moved position back; the current state already exists → no extra state
  await auto.getByRole('button', { name: 'Öffnen' }).click();
  await expect(dlg).toBeHidden();
  expect((await itemById(table.id)).x).toBeCloseTo(moved.x, 6);

  // 5. delete a state (with confirmation)
  dlg = await openVersions();
  await expect(items).toHaveCount(2);
  await items.filter({ hasNotText: 'Automatisch' }).getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Automatisch vor dem Wechsel');
  await dlg.getByRole('button', { name: 'Schließen' }).click();

  // 6. states survive a reload
  await expect(page.locator('.save-state')).toHaveText('Gespeichert', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
  dlg = await openVersions();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Automatisch vor dem Wechsel zu „Couchtisch Mitte“');
  await expect(dlg.getByTestId('versions-compare-table')).toBeVisible();
  expect((await itemById(table.id)).x).toBeCloseTo(moved.x, 6);
  expect(errors).toEqual([]);
});

test('properties panel: groups collapse, keep their state across selections and work with the keyboard (#99)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p = await getProject(page);
  const wardrobe = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-wardrobe-150');
  const sofa = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const right = page.locator('.panel.right');
  const group = (name: string) => right.getByRole('button', { name, exact: true });

  // select a piece of furniture: frequently used groups are open, „Produkt“ is collapsed
  const w = await planToScreen(page, wardrobe.x, wardrobe.y);
  await page.mouse.click(w.x, w.y);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: wardrobe.id });
  for (const name of ['Objekt', 'Position', 'Maße', 'Aussehen', 'Preis']) await expect(group(name)).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['3D-Modell', 'Produkt', 'Erweitert']) await expect(group(name)).toHaveAttribute('aria-expanded', 'false');
  await expect(right.getByLabel('Drehung')).toBeVisible();
  await expect(right.getByLabel('Marke')).toHaveCount(0);

  // expand „Produkt“, select another piece of furniture: it stays open
  await group('Produkt').click();
  await expect(group('Produkt')).toHaveAttribute('aria-expanded', 'true');
  await expect(right.getByLabel('Marke')).toBeVisible();
  const s = await planToScreen(page, sofa.x, sofa.y);
  await page.mouse.click(s.x, s.y);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: sofa.id });
  await expect(right.getByLabel('Name')).toHaveValue(sofa.name);
  await expect(group('Produkt')).toHaveAttribute('aria-expanded', 'true');
  await expect(right.getByLabel('Händler')).toBeVisible();
  await expect(group('Erweitert')).toHaveAttribute('aria-expanded', 'false');

  // keyboard: Enter on the heading toggles the group (Space too)
  await group('Erweitert').focus();
  await page.keyboard.press('Enter');
  await expect(group('Erweitert')).toHaveAttribute('aria-expanded', 'true');
  await expect(right.getByLabel('Gesperrt (nicht verschiebbar)')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(group('Erweitert')).toHaveAttribute('aria-expanded', 'false');
  await expect(right.getByLabel('Gesperrt (nicht verschiebbar)')).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect(group('Erweitert')).toHaveAttribute('aria-expanded', 'true');
  // toggling a group changes nothing in the plan (no undo step, selection unchanged)
  expect(await page.evaluate(() => (window as unknown as { __wp: { useProjectStore: { getState: () => { past: unknown[] } } } }).__wp.useProjectStore.getState().past.length)).toBe(0);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: sofa.id });

  // remembered on this device after a reload
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), wardrobe.id);
  await expect(group('Produkt')).toHaveAttribute('aria-expanded', 'true');
  await expect(group('Erweitert')).toHaveAttribute('aria-expanded', 'true');
  await expect(group('3D-Modell')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('empty project: start card with first steps, "Raum zeichnen" picks the tool, gone after the first room, can be closed and reopened (#102)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  // the sample apartment is not empty → no card
  await expect(page.getByTestId('start-card')).toHaveCount(0);
  await page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();

  const card = page.getByTestId('start-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Grundriss importieren' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Beispielwohnung laden' })).toBeVisible();

  // close → small "Erste Schritte" button → reopen
  await card.getByRole('button', { name: 'Startkarte schließen' }).click();
  await expect(card).toHaveCount(0);
  await page.getByTestId('start-card-reopen').click();
  await expect(card).toBeVisible();

  // "Raum zeichnen" selects the room tool
  await card.getByRole('button', { name: 'Raum zeichnen' }).click();
  expect(await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { tool: string } } } }).__wp.useUiStore.getState().tool)).toBe('room');
  await expect(page.locator('.editor-hint')).toContainText('Rechteck');

  // first room → the card disappears
  await page.locator('.panel.left').getByRole('button', { name: 'Raum anlegen' }).click();
  await expect.poll(async () => (await getProject(page)).rooms.length).toBe(1);
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('start-card-reopen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('furniture groups: Strg+G groups, click selects the group, drag moves all (one undo step), second click picks one, rename, kept after reload, Strg+Umschalt+G dissolves (#65)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const sel = () =>
    page.evaluate(() => {
      const s = (window as any).__wp.useUiStore.getState();
      return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : [];
    });
  const past = () => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length as number);
  const click = async (f: { x: number; y: number }) => {
    const s = await planToScreen(page, f.x, f.y);
    await page.mouse.click(s.x, s.y);
  };
  const p0 = await getProject(page);
  expect(p0.groups).toEqual([]);
  const bed = p0.furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const ns = p0.furniture.filter((f: any) => f.catalogId === 'generic-nightstand');
  const ids: string[] = [bed.id, ...ns.map((n: any) => n.id)];

  // select bed + night stands, Strg+G → one group (one undo step)
  await click(bed);
  for (const n of ns) {
    await page.keyboard.down('Shift');
    await click(n);
    await page.keyboard.up('Shift');
  }
  const beforeGroup = await past();
  await page.keyboard.press('Control+g');
  const p1 = await getProject(page);
  expect(p1.groups).toHaveLength(1);
  const gid = p1.groups[0].id;
  expect(p1.furniture.filter((f: any) => f.groupId === gid).map((f: any) => f.id).sort()).toEqual([...ids].sort());
  expect(await past()).toBe(beforeGroup + 1);
  const panel = page.locator('.panel.right');
  await expect(panel.getByTestId('group-controls')).toBeVisible();
  await expect(page.getByTestId('group-outline')).toHaveAttribute('data-whole', 'true');

  // a click on one night stand selects the whole group
  await page.keyboard.press('Escape');
  expect(await sel()).toEqual([]);
  await click(ns[0]);
  expect((await sel()).sort()).toEqual([...ids].sort());
  expect((await sel())[0]).toBe(ns[0].id);
  await expect(page.getByTestId('multi-note')).toContainText('Gruppe „Gruppe 1“ ausgewählt (3 Möbel)');

  // dragging the bed moves all three by the same amount – one undo step
  const beforeDrag = await past();
  const a = await planToScreen(page, bed.x, bed.y);
  const b = await planToScreen(page, bed.x, bed.y + 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  const p2 = await getProject(page);
  const dy = (p: any, id: string) => p.furniture.find((f: any) => f.id === id).y - p0.furniture.find((f: any) => f.id === id).y;
  const dx = (p: any, id: string) => p.furniture.find((f: any) => f.id === id).x - p0.furniture.find((f: any) => f.id === id).x;
  expect(dy(p2, bed.id)).toBeGreaterThan(0.3);
  for (const id of ids) {
    expect(dy(p2, id)).toBeCloseTo(dy(p2, bed.id), 3);
    expect(dx(p2, id)).toBeCloseTo(dx(p2, bed.id), 3);
  }
  expect(await past()).toBe(beforeDrag + 1);
  expect((await sel()).sort()).toEqual([...ids].sort()); // still the group

  // Strg+Z once restores all three positions
  await page.keyboard.press('Control+z');
  const p3 = await getProject(page);
  for (const id of ids) {
    expect(dy(p3, id)).toBeCloseTo(0, 6);
    expect(dx(p3, id)).toBeCloseTo(0, 6);
  }
  expect(p3.groups).toHaveLength(1);

  // E turns the group about its centre – one undo step, distances between the members kept
  const dist = (p: any, i: string, j: string) => {
    const f = p.furniture.find((x: any) => x.id === i);
    const g = p.furniture.find((x: any) => x.id === j);
    return Math.hypot(f.x - g.x, f.y - g.y);
  };
  const beforeTurn = await past();
  await page.keyboard.press('e');
  const p4 = await getProject(page);
  expect(await past()).toBe(beforeTurn + 1);
  expect(p4.furniture.find((f: any) => f.id === bed.id).rotation).not.toBeCloseTo(bed.rotation, 3);
  expect(dist(p4, bed.id, ns[0].id)).toBeCloseTo(dist(p0, bed.id, ns[0].id), 2);
  expect(dist(p4, ns[0].id, ns[1].id)).toBeCloseTo(dist(p0, ns[0].id, ns[1].id), 2);
  await page.keyboard.press('Control+z');

  // a second click (no drag) selects just the clicked item; the group stays outlined faintly
  await click(bed);
  expect(await sel()).toEqual([bed.id]);
  await expect(page.getByTestId('group-outline')).toHaveAttribute('data-whole', 'false');
  await expect(panel.getByTestId('group-controls')).toContainText('Teil der Gruppe „Gruppe 1“');
  // back to the whole group via the panel, rename it there
  await panel.getByRole('button', { name: 'Ganze Gruppe auswählen' }).click();
  expect((await sel()).sort()).toEqual([...ids].sort());
  const nameField = panel.getByTestId('group-controls').getByLabel('Name der Gruppe');
  await nameField.fill('Schlafbereich');
  await nameField.press('Enter');
  await expect.poll(async () => (await getProject(page)).groups[0]?.name).toBe('Schlafbereich');
  await expect(page.getByTestId('group-label')).toHaveText('Schlafbereich');

  // kept after reload
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const p5 = await getProject(page);
  expect(p5.groups).toEqual([{ id: gid, name: 'Schlafbereich' }]);
  expect(p5.furniture.filter((f: any) => f.groupId === gid)).toHaveLength(3);
  await click(bed);
  expect((await sel()).sort()).toEqual([...ids].sort());

  // Strg+Umschalt+G dissolves the group – the items stay where they are; one undo step
  const beforeUngroup = await past();
  await page.keyboard.press('Control+Shift+G');
  const p6 = await getProject(page);
  expect(p6.groups).toEqual([]);
  expect(p6.furniture.every((f: any) => !f.groupId)).toBe(true);
  for (const id of ids) expect(dy(p6, id)).toBeCloseTo(0, 6);
  expect(await past()).toBe(beforeUngroup + 1);
  await page.keyboard.press('Escape');
  await click(bed);
  expect(await sel()).toEqual([bed.id]);
  await expect(page.getByTestId('group-outline')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('calmer toolbar: icons with tooltip and name, "Mehr" menu with exports and light, keyboard operation, stand/sit, "Erste Schritte" (#100, #103)', async ({ page }) => {
  test.setTimeout(240_000); // realism rendering with software WebGL is slow, more so under load
  const errors = collectErrors(page);
  await freshStart(page);
  const toolbar = page.locator('header.toolbar');

  // icon-only buttons: no visible text, a name (aria-label) and a tooltip that starts with it
  const icons = toolbar.locator('button.icon-btn');
  expect(await icons.count()).toBeGreaterThanOrEqual(8);
  for (const b of await icons.all()) {
    const label = (await b.getAttribute('aria-label')) ?? '';
    expect(label.length, 'icon button without aria-label').toBeGreaterThan(1);
    expect((await b.getAttribute('title')) ?? '').toContain(label.split(' ')[0]);
    // icon only, or icon with its name as visible caption (#122)
    expect(['', label]).toContain((await b.innerText()).trim());
  }
  // every toolbar button has a name
  for (const b of await toolbar.locator('button').all()) {
    const name = (await b.getAttribute('aria-label')) ?? (await b.innerText()).trim();
    expect(name, 'toolbar button without a name').not.toBe('');
  }
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveAttribute('title', /Strg\+Z/);
  await expect(page.getByRole('button', { name: 'Hilfe & Tastenkürzel' })).toHaveAttribute('aria-keyshortcuts', '?');
  // rarely used: the separate "Export ▾" button is gone, its entries are in "Mehr"
  await expect(page.getByRole('button', { name: 'Export ▾' })).toHaveCount(0);

  // keyboard: Enter opens "Mehr", the focus goes to the first entry, arrows move, Esc closes and returns
  const more = page.getByRole('button', { name: 'Mehr', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = page.locator('#toolbar-menu-more');
  for (const entry of ['Projektpaket (.wohnplan.json)', 'Grundriss (apartment-plan.json)', 'Einkaufsliste (CSV)', 'Plan drucken / PDF / PNG…', '3D-Modell als GLB …']) {
    await expect(menu.getByRole('button', { name: entry })).toBeVisible();
  }
  await expect(menu.getByRole('button', { name: 'Projektpaket (.wohnplan.json)' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: 'Grundriss (apartment-plan.json)' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('button', { name: '3D-Modell als GLB …' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: 'Projektpaket (.wohnplan.json)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  // keyboard focus shows the name as a tooltip, too (the native title only appears on hover)
  expect(await more.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"Mehr: Export"');
  // Enter on "Projekt ▾" opens it with the focus inside
  await page.getByRole('button', { name: 'Projekt ▾' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Neues leeres Projekt' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#toolbar-menu-project')).toHaveCount(0);
  // a click outside closes a menu
  await more.click();
  await expect(menu).toBeVisible();
  await page.locator('.save-state').click();
  await expect(menu).toHaveCount(0);

  // 3D realism: only the slider stays in the toolbar; presets and lamps are in "Mehr"
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Realismus' }).click();
  await expect(toolbar.getByLabel('Tageszeit', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Lampen', { exact: true })).toHaveCount(0);
  await more.click();
  await expect(menu.getByText('Licht (Realismus)')).toBeVisible();
  await expect(menu.getByLabel('Tageszeit-Voreinstellung')).toBeVisible();
  await menu.getByLabel('Lampen', { exact: true }).selectOption('on');
  expect((await getProject(page)).settings.lamps).toBe('on');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // the toolbar stays on one row – also in a narrow window
  expect((await toolbar.boundingBox())!.height).toBeLessThan(52);
  await page.screenshot({ path: 'test-results/toolbar-1440-realism.png', clip: { x: 0, y: 0, width: 1440, height: 60 } });
  await page.setViewportSize({ width: 1024, height: 800 });
  expect((await toolbar.boundingBox())!.height).toBeLessThan(52);
  await expect(page.getByText('Gespeichert', { exact: true })).toBeAttached(); // still there for screen readers
  await page.screenshot({ path: 'test-results/toolbar-1024-realism.png', clip: { x: 0, y: 0, width: 1024, height: 60 } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Planung', exact: true }).click();

  // walkthrough: stand / sit next to "Begehen", same state as key X; orbit-only tools hidden
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByRole('button', { name: 'Schnitt' })).toHaveCount(0);
  const stand = page.getByRole('button', { name: 'Stehen', exact: true });
  const sit = page.getByRole('button', { name: 'Sitzen', exact: true });
  await expect(stand).toHaveAttribute('aria-pressed', 'true');
  await sit.click();
  await expect(sit).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('walk-sit')).toBeVisible();
  await page.locator('[data-testid="scene3d"]').hover();
  await page.keyboard.press('x');
  await expect(stand).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('walk-sit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByRole('group', { name: 'Haltung beim Begehen' })).toHaveCount(0);

  // "Projekt ▾ › Erste Schritte": disabled for a non-empty project, reopens the start card of an empty one
  await page.getByRole('button', { name: 'Projekt ▾' }).click();
  await expect(page.getByRole('button', { name: /^Erste Schritte/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  const card = page.getByTestId('start-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Startkarte schließen' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Projekt ▾' }).click();
  await page.locator('#toolbar-menu-project').getByRole('button', { name: /^Erste Schritte/ }).click();
  await expect(card).toBeVisible();
  await expect(page.locator('#toolbar-menu-project')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('Handy-Ansicht (#129)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Plan/3D füllen den Bildschirm, Panels öffnen sich als Blatt über die untere Leiste', async ({ page }) => {
    const errors = collectErrors(page);
    await freshStart(page);
    // starts in 3D, side panels and status bar are hidden
    await expect(page.locator('.app.phone')).toBeVisible();
    await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.panel.left')).toBeHidden();
    await expect(page.locator('.panel.right')).toBeHidden();
    await expect(page.locator('.statusbar')).toHaveCount(0);
    const ws = await page.locator('.workspace').boundingBox();
    expect(ws!.height).toBeGreaterThan(844 * 0.6);
    // the toolbar does not take more than a sliver of the screen
    const tb = await page.locator('.toolbar').boundingBox();
    expect(tb!.height).toBeLessThan(130);

    const bar = page.getByRole('navigation', { name: 'Panels' });
    await bar.getByRole('button', { name: 'Werkzeuge' }).click();
    await expect(page.locator('.panel.left')).toBeVisible();
    await expect(page.locator('.panel.left').getByRole('button', { name: 'Raum anlegen' })).toBeVisible();
    await bar.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('.panel.left')).toBeHidden();
    await expect(page.locator('.panel.right').getByRole('button', { name: /Wohnzimmer – 20,00 m²/ })).toBeVisible();
    await bar.getByRole('button', { name: 'Panel schließen' }).click();
    await expect(page.locator('.panel.right')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('ein normales PC-Fenster bleibt unverändert', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshStart(page);
    await expect(page.locator('.app.phone')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Panels' })).toHaveCount(0);
    await expect(page.locator('.panel.left')).toBeVisible();
    await expect(page.locator('.statusbar')).toBeVisible();
    await expect(page.getByRole('button', { name: '2D + 3D' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test('Budget: Gruppierung bleibt nach Auswahl eines Möbels, Panelwechsel und Neuladen erhalten (#206)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const right = page.locator('.panel.right');
  await right.getByRole('button', { name: 'Budget' }).click();
  const grouping = page.getByRole('combobox', { name: 'Gruppierung' });
  await grouping.selectOption('room');
  await expect(page.locator('.budget-group-head').first()).toContainText('Schlafzimmer');

  // selecting furniture switches the right panel to the properties
  const id = (await getProject(page)).furniture[0].id;
  await page.evaluate((fid) => (window as any).__wp.useUiStore.getState().selectFurniture([fid]), id);
  await expect(grouping).toHaveCount(0);
  await right.getByRole('button', { name: 'Budget' }).click();
  await expect(grouping).toHaveValue('room');

  // device setting: kept after reloading
  await page.reload();
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await right.getByRole('button', { name: 'Budget' }).click();
  await expect(grouping).toHaveValue('room');
  expect(errors).toEqual([]);
});

test('Plan-Hintergrund-Schalter liegt nicht hinter dem Zoomregler und ist per Mausklick bedienbar (#258)', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'grundriss.png', mimeType: 'image/png', buffer: syntheticPlanPng() });
  await expect(page.getByText('Nicht kalibriert', { exact: true })).toBeVisible();
  const toggle = page.getByTestId('underlay-toggle');
  const slider = page.getByTestId('zoom-2d');
  const tb = (await toggle.boundingBox())!;
  const sb = (await slider.boundingBox())!;
  expect(tb.y + tb.height).toBeLessThanOrEqual(sb.y + 1);
  expect((await getProject(page)).underlay.visible).toBe(true);
  await toggle.click();
  expect((await getProject(page)).underlay.visible).toBe(false);
});

test('Tür/Fenster setzen: zweiter Klick auf dieselbe Stelle überlagert keine bestehende Öffnung', async ({ page }) => {
  await freshStart(page);
  const panel = page.locator('.panel.left');
  await panel.getByLabel('Name').fill('Testraum');
  await panel.getByLabel('Breite').fill('400');
  await panel.getByLabel('Tiefe').fill('300');
  await panel.getByLabel('Tiefe').blur();
  await panel.getByRole('button', { name: 'Raum anlegen' }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const before = await getProject(page);
  const oldIds = new Set((before.openings as { id: string }[]).map((o) => o.id));
  const nodes = before.nodes as { id: string; x: number; y: number }[];
  const top = Math.min(...nodes.map((n) => n.y));
  const xs = nodes.map((n) => n.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const at = await planToScreen(page, mid, top);
  await panel.getByRole('button', { name: /^Tür/ }).first().click();
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const p = await getProject(page);
  const ops = (p.openings as { id: string; wallId: string; offset: number; width: number }[]).filter((o) => !oldIds.has(o.id));
  expect(ops.length).toBe(2);
  const [a, b] = ops;
  expect(Math.abs(a.offset - b.offset)).toBeGreaterThanOrEqual((a.width + b.width) / 2);
});
