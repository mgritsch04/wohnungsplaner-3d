import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

test('walkthrough: eye height 163 cm by default, adjustable live and saved; crosshair only while walking (#23, #22)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('crosshair')).toHaveCount(0); // not in the overview
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const camY = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__wp.three.camera.position.y as number;
    });
  await expect.poll(camY).toBeCloseTo(1.63, 3);
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  const field = page.getByLabel('Augenhöhe beim Begehen');
  await expect(field).toHaveValue('163');
  await field.fill('180');
  await field.press('Enter');
  await expect.poll(camY).toBeCloseTo(1.8, 3); // immediately, still walking
  await expect(page.locator('.walk-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('crosshair')).toHaveCount(0);
  // saved with the project
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).settings.eyeHeight).toBeCloseTo(1.8, 6);
  expect(errors).toEqual([]);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
test('walkthrough: look at furniture, select it, carry it with G and put it down (#39)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const before = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  // stand still and look straight at the coffee table (yaw from the camera position)
  const look = await page.evaluate(
    ([tx, ty]) => {
      const wp = (window as any).__wp;
      const c = wp.three.camera.position;
      const yaw = Math.atan2(-(tx - c.x), -(ty - c.z));
      const dist = Math.hypot(tx - c.x, ty - c.z);
      wp.walk.look(yaw, -Math.atan2(c.y - 0.3, dist));
      return { dist };
    },
    [before.x, before.y],
  );
  expect(look.dist).toBeLessThan(6);
  await expect.poll(() => page.evaluate(() => (window as any).__wp.walk.target())).toBe(before.id);
  // G picks it up …
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBe(before.id);
  await expect(page.locator('.walk-overlay')).toContainText('trägst');
  // … turn a bit: it follows the gaze (with the usual collision rules)
  await page.evaluate(() => {
    const wp = (window as any).__wp;
    const e = wp.three.camera.rotation;
    wp.walk.look(e.y + 0.35, e.x);
  });
  await expect
    .poll(async () => {
      const t = (await getProject(page)).furniture.find((f: { id: string }) => f.id === before.id);
      return Math.hypot(t.x - before.x, t.y - before.y);
    })
    .toBeGreaterThan(0.2);
  const pastBefore = await page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length);
  // G again puts it down: one undo step
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBeNull();
  expect(await page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length)).toBe(pastBefore + 1);
  // G must not switch the 2D tool while walking
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
test('zoom slider at the bottom of 2D and 3D, synchronised with the mouse wheel (#6)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const zoom2d = () => page.evaluate(() => (window as any).__wp.useUiStore.getState().view2d.zoom as number);
  const slider2d = page.getByLabel('Zoom 2D', { exact: true });
  await expect(slider2d).toBeVisible();
  const z0 = await zoom2d();
  await page.getByRole('button', { name: 'Zoom 2D: hineinzoomen' }).click();
  expect(await zoom2d()).toBeGreaterThan(z0 * 1.1);
  // mouse wheel → slider follows
  const before = Number(await slider2d.inputValue());
  const box = (await page.getByTestId('editor2d').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => Number(await slider2d.inputValue())).toBeLessThan(before);
  await slider2d.fill('900');
  expect(await zoom2d()).toBeGreaterThan(300);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const slider3d = page.getByLabel('Zoom 3D', { exact: true });
  await expect(slider3d).toBeVisible();
  const dist = () =>
    page.evaluate(() => {
      const wp = (window as any).__wp;
      return wp.three.camera.position.length() as number;
    });
  const d0 = await dist();
  await page.getByRole('button', { name: 'Zoom 3D: hineinzoomen' }).click();
  await expect.poll(dist).toBeLessThan(d0 - 0.2);
  const s0 = Number(await slider3d.inputValue());
  const cbox = (await page.getByTestId('scene3d').boundingBox())!;
  await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 3);
  await page.mouse.wheel(0, 800); // zoom out with the wheel
  await expect.poll(async () => Number(await slider3d.inputValue()), { timeout: 15000 }).toBeLessThan(s0);
  // not shown while walking
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(slider3d).toHaveCount(0);
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
test('2D plan shows where you are while walking in 3D (2D + 3D view only) (#19)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D + 3D' }).click();
  await expect(page.getByTestId('walk-marker')).toHaveCount(0);
  await page.getByRole('button', { name: 'Begehen' }).click();
  const marker = page.getByTestId('walk-marker');
  await expect(marker).toHaveCount(1);
  const dot = async () => {
    const b = (await marker.locator('circle').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // the dot sits where the camera is
  const cam = await page.evaluate(() => (window as any).__wp.three.camera.position);
  const expected = await planToScreen(page, cam.x, cam.z);
  const d0 = await dot();
  expect(Math.hypot(d0.x - expected.x, d0.y - expected.y)).toBeLessThan(4);
  // walk forward: the dot follows live
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => {
    const d = await dot();
    return Math.hypot(d.x - d0.x, d.y - d0.y);
  }).toBeGreaterThan(5);
  // 3D only or overview: no marker
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(marker).toHaveCount(0);
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
test('walkthrough: hold C to crouch (lower camera, slower), release to stand up (#20)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  const camY = () => page.evaluate(() => (window as any).__wp.three.camera.position.y as number);
  await expect.poll(camY).toBeCloseTo(1.63, 3);
  await page.keyboard.down('KeyC');
  await expect.poll(camY).toBeLessThan(1.0);
  await expect(page.getByTestId('walk-duck')).toBeVisible();
  // C must not trigger anything in the 2D tools while walking
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  await page.keyboard.up('KeyC');
  await expect.poll(camY).toBeCloseTo(1.63, 3);
  await expect(page.getByTestId('walk-duck')).toHaveCount(0);
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
test('multi-select: Shift+click, move together, copy/paste, delete, selection box (one undo step each)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const proj = () => getProject(page);
  const sel = () => page.evaluate(() => {
    const s = (window as any).__wp.useUiStore.getState();
    return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : [];
  });
  const past = () => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length as number);
  const p0 = await proj();
  const n1 = p0.furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const ns = p0.furniture.filter((f: any) => f.catalogId === 'generic-nightstand');
  const a = await planToScreen(page, n1.x, n1.y);
  await page.mouse.click(a.x, a.y);
  for (const n of ns) {
    const s = await planToScreen(page, n.x, n.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    await page.keyboard.up('Shift');
  }
  expect((await sel()).sort()).toEqual([n1.id, ...ns.map((n: any) => n.id)].sort());
  await expect(page.getByTestId('multi-note')).toContainText('3 Möbel ausgewählt');
  // drag the bed down by 0.5 m: the night stands move along (one undo step)
  const before = await past();
  const target = await planToScreen(page, n1.x, n1.y + 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  const p1 = await proj();
  const moved = (id: string) => {
    const f = p1.furniture.find((x: any) => x.id === id);
    const o = p0.furniture.find((x: any) => x.id === id);
    return f.y - o.y;
  };
  expect(moved(n1.id)).toBeGreaterThan(0.3);
  for (const n of ns) expect(moved(n.id)).toBeCloseTo(moved(n1.id), 2);
  expect(await past()).toBe(before + 1);
  // copy + paste → three new items, selected
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect((await proj()).furniture.length).toBe(p0.furniture.length + 3);
  expect((await sel()).length).toBe(3);
  // delete removes all selected (one undo step)
  await page.keyboard.press('Delete');
  expect((await proj()).furniture.length).toBe(p0.furniture.length);
  await page.keyboard.press('Control+z');
  expect((await proj()).furniture.length).toBe(p0.furniture.length + 3);
  await page.keyboard.press('Control+z');
  // selection box (Shift+drag on empty floor) around the living-room group
  await page.mouse.click(10, 10); // clear
  const sofa = p0.furniture.find((f: any) => f.catalogId === 'generic-sofa-3');
  const table = p0.furniture.find((f: any) => f.catalogId === 'generic-coffee-table');
  const b0 = await planToScreen(page, 1.5, 1.9);
  const b1 = await planToScreen(page, 4.2, 3.95);
  await page.keyboard.down('Shift');
  await page.mouse.move(b0.x, b0.y);
  await page.mouse.down();
  await page.mouse.move(b1.x, b1.y, { steps: 5 });
  await expect(page.getByTestId('selection-box')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const boxed = await sel();
  expect(boxed).toContain(sofa.id);
  expect(boxed).toContain(table.id);
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  let p = await getProject(page);
  // the TV sideboard stands between table and wall (furniture blocks too) – remove it first
  const board = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-tv-sideboard');
  const b = await planToScreen(page, board.x, board.y);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Delete');
  p = await getProject(page);
  expect(p.furniture.some((f: { id: string }) => f.id === board.id)).toBe(false);
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

test('rotating the selected item (panel buttons, Q/E): collision-checked, one undo step each (#5)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const before = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-wardrobe-150');
  const s = await planToScreen(page, before.x, before.y);
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(before.id);
  const turned = async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === before.id);
  const delta = (r: number) => Math.atan2(Math.sin(r - before.rotation), Math.cos(r - before.rotation));
  // wardrobe stands with its back at the south wall: turning it 90° must push it into the room, not into the wall
  await page.getByRole('group', { name: 'Drehen' }).getByRole('button', { name: '⟳ 90°' }).click();
  let w = await turned();
  expect(delta(w.rotation)).toBeCloseTo(Math.PI / 2, 5);
  expect(w.y + w.width / 2).toBeLessThanOrEqual(4.0 + 0.002); // inner face of the south wall (sample: 4 m deep)
  await expect(page.getByText('gedreht und etwas verschoben')).toBeVisible();
  // one undo step restores rotation and position
  await page.keyboard.press('Control+z');
  w = await turned();
  expect([w.x, w.y, w.rotation]).toEqual([before.x, before.y, before.rotation]);
  // keyboard: E = +15°, Q = −15°
  await page.mouse.click(s.x, s.y);
  await page.keyboard.press('e');
  expect(delta((await turned()).rotation)).toBeCloseTo(Math.PI / 12, 5);
  await page.keyboard.press('q');
  expect(delta((await turned()).rotation)).toBeCloseTo(0, 5);
  expect(errors).toEqual([]);
});

test('hover info: name, category, size and price after a short delay; hidden while dragging (#9)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const sofa = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const s = await planToScreen(page, sofa.x, sofa.y);
  await page.mouse.move(s.x, s.y);
  const card = page.getByTestId('furniture-hover');
  await expect(card).toBeVisible();
  await expect(card).toContainText(sofa.name);
  await expect(card).toContainText('Sofas & Sessel');
  await expect(card).toContainText('210 × 90 × 82 cm');
  await expect(card).toContainText('Schätzung'); // generic items carry estimated prices
  // dragging: the card goes away and does not interfere
  await page.mouse.down();
  await expect(card).toHaveCount(0);
  await page.mouse.up();
  // away from furniture → no card
  const empty = await planToScreen(page, 1.0, 1.0);
  await page.mouse.move(empty.x, empty.y);
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
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
  // while dragging only the live preview changes – no project clone/re-render per step
  const during = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = (window as any).__wp;
    return { saved: wp.useProjectStore.getState().project.settings.timeOfDay, preview: wp.useUiStore.getState().timePreview };
  });
  expect(during.saved).toBe(23.5);
  expect(during.preview).toBeGreaterThan(10);
  // the lighting follows within a couple of frames (frame-rate independent smoothing)
  const lightingGap = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wp = (window as any).__wp;
      return Math.abs(wp.lightingHour() - wp.useUiStore.getState().timePreview);
    });
  await expect.poll(lightingGap, { timeout: 20000 }).toBeLessThan(0.01);
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

/** Names of the collision marker objects currently in the 3D scene. */
async function collisionMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Obj = { name: string; traverse: (f: (o: Obj) => void) => void };
    const t = (window as unknown as { __wp: { three: { scene: { getObjectByName: (n: string) => Obj | undefined } } } }).__wp.three;
    const out: string[] = [];
    t.scene.getObjectByName('collision-markers')?.traverse((o) => {
      if (o.name.startsWith('collision') && o.name !== 'collision-markers') out.push(o.name);
    });
    return out;
  });
}

test('3D: collision with the opened entrance door is shown in the room and disappears when dragged free', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  // reproduce the reported situation: sofa standing in the opened entrance door leaf
  const sofaId: string = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = (window as any).__wp.useProjectStore.getState();
    const sofa = st.project.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
    st.apply((d: { furniture: { id: string; x: number }[] }) => {
      d.furniture.find((f) => f.id === sofa.id)!.x = 1.7;
    });
    return sofa.id;
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // look into the rooms
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/collision-3d-before.png' });
  const markers = await collisionMarkers(page);
  expect(markers).toContain(`collision:${sofaId}`);
  const leaf = markers.find((n) => n.startsWith(`collision-issue:${sofaId}:door-leaf:`));
  expect(leaf, markers.join(', ')).toBeTruthy();
  const doorId = leaf!.split(':')[3];
  expect((await getProject(page)).openings.find((o: { id: string }) => o.id === doorId)?.kind).toBe('door');
  // a click selects the sofa (the cut-away part of the wall in front must not catch it) without moving it
  const sofa = (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofaId);
  const s = await worldToScreen3d(page, sofa.x + 0.5, 0.46, sofa.y - 0.35);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: sofaId });
  expect((await getProject(page)).furniture.find((f: { id: string }) => f.id === sofaId).x).toBe(sofa.x);
  await expect(page.getByText(/Steht im geöffneten Türblatt – Tür \d+ cm/)).toBeVisible();
  // drag it to the right, out of the door leaf: markers follow and disappear
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  const to = await worldToScreen3d(page, sofa.x + 0.5 + 1.2, 0.46, sofa.y - 0.35);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const moved = (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofaId);
  expect(moved.x).toBeGreaterThan(2.5);
  expect(Math.abs(moved.y - sofa.y)).toBeLessThan(0.15);
  expect(await collisionMarkers(page)).toEqual([]);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: sofaId });
  await page.screenshot({ path: 'test-results/collision-3d-after.png' });
  // one undo step restores the colliding position (and its markers)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  expect((await getProject(page)).furniture.find((f: { id: string }) => f.id === sofaId).x).toBe(sofa.x);
  expect(await collisionMarkers(page)).toContain(`collision:${sofaId}`);
  expect(errors).toEqual([]);
});

test('3D: click vs. drag – threshold, no jump, release over a wall, focus loss, UI clicks', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // walls cut at 1.2 m: furniture visible
  await page.waitForTimeout(2500);
  const find = async (id: string) => (await getProject(page)).furniture.find((f: { id: string }) => f.id === id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txOpen = () => page.evaluate(() => !!(window as any).__wp.useProjectStore.getState().txBase);
  const table = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const top = table.height; // grab the table top
  const a = await worldToScreen3d(page, table.x + 0.2, top, table.y);

  // 1) jitter below the threshold: selects, does not move
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 3, a.y + 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  expect([(await find(table.id)).x, (await find(table.id)).y]).toEqual([table.x, table.y]);

  // 2) a real drag moves it by the pointer's world offset (grab offset kept, no jump)
  const b = await worldToScreen3d(page, table.x + 0.2 - 0.5, top, table.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  expect(await txOpen()).toBe(true);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const t2 = await find(table.id);
  // furniture snaps to the 5 cm grid (#52): a pointer that lands a hair off the line may
  // round to the neighbouring grid line, so allow one grid step – a real jump is far more
  const step = 0.05 + 1e-6;
  expect(Math.abs(t2.x - (table.x - 0.5))).toBeLessThanOrEqual(step);
  expect(Math.abs(t2.y - table.y)).toBeLessThanOrEqual(step);
  expect(await txOpen()).toBe(false);

  // 3) dragged towards the north wall and released with the pointer over the wall: stays selected, flush to the wall
  const c = await worldToScreen3d(page, t2.x + 0.2, top, t2.y);
  const wall = await worldToScreen3d(page, t2.x + 0.2, 1.0, -0.06);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(wall.x, wall.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  const t3 = await find(table.id);
  expect(t3.y - t3.depth / 2).toBeGreaterThanOrEqual(-0.002);

  // 4) focus loss mid-drag ends the drag: later pointer moves no longer move the item
  const d = await worldToScreen3d(page, t3.x, top, t3.y + 0.1);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x - 40, d.y, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await txOpen()).toBe(false);
  const t4 = await find(table.id);
  await page.mouse.move(d.x - 120, d.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect([(await find(table.id)).x, (await find(table.id)).y]).toEqual([t4.x, t4.y]);

  // 5) pressing on a UI button and releasing over the canvas starts no drag
  const before = await getProject(page);
  const btn = await page.getByRole('button', { name: 'Schnitt' }).boundingBox();
  await page.mouse.move(btn!.x + 5, btn!.y + 5);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await getProject(page)).furniture).toEqual(before.furniture);
  expect(await txOpen()).toBe(false);
  expect(errors).toEqual([]);
});

test('mouse sensitivity: setting scales walk look and orbit rotation, persists in the project', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  const slider = page.getByLabel('Mausempfindlichkeit');
  await expect(slider).toHaveValue('1');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setSens = (v: number) => page.evaluate((x) => (window as any).__wp.useProjectStore.getState().apply((d: any) => (d.settings.mouseSensitivity = x)), v);
  const camYaw = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__wp.three.camera.rotation.y as number;
    });
  const canvas = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  // walk mode: the same mouse movement turns the view proportionally to the setting
  await page.getByRole('button', { name: 'Begehen' }).click();
  await page.waitForTimeout(800);
  // headless Chromium reports no movementX for synthetic moves under pointer lock, so emulate
  // a locked pointer and send the same relative mouse movement for every setting
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="scene3d"] canvas');
    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  });
  const lookTurn = async (sens: number) => {
    await setSens(sens);
    await page.waitForTimeout(200);
    const y0 = await camYaw();
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 })));
    await page.waitForTimeout(300);
    return Math.abs((await camYaw()) - y0);
  };
  const low = await lookTurn(0.5);
  const def = await lookTurn(1);
  const high = await lookTurn(2);
  await page.evaluate(() => delete (document as unknown as Record<string, unknown>).pointerLockElement);
  expect(def).toBeCloseTo(100 * 0.0022, 3); // unchanged default feel
  expect(low / def).toBeCloseTo(0.5, 1);
  expect(high / def).toBeCloseTo(2, 1);

  // orbit: azimuth change scales as well
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await page.waitForTimeout(800);
  const azimuth = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (window as any).__wp.three.camera.position;
      return Math.atan2(c.x - 4.3, c.z - 2);
    });
  const orbitTurn = async (sens: number) => {
    await setSens(sens);
    await page.getByRole('button', { name: '⟲ Kamera' }).click();
    await page.waitForTimeout(600);
    const a0 = await azimuth();
    await page.mouse.move(cx, cy + 150);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 150, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1500); // damping settles
    return Math.abs((await azimuth()) - a0);
  };
  const oLow = await orbitTurn(0.5);
  const oHigh = await orbitTurn(2);
  expect(oHigh).toBeGreaterThan(oLow * 2.5);

  // the UI slider writes the setting; one undo step per drag; it is saved with the project
  await slider.fill('1.5');
  expect((await getProject(page)).settings.mouseSensitivity).toBe(1.5);
  await page.getByRole('button', { name: 'Standard' }).click();
  expect((await getProject(page)).settings.mouseSensitivity).toBe(1);
  expect(errors).toEqual([]);
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

test('floor lamp and sofa: overlap is marked in 3D, dragging the lamp into the sofa stops at it (2D)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const sofa = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const lamp = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-floor-lamp');
  // 1) lamp placed inside the sofa (e.g. typed coordinates) → real overlap, red in 3D
  await page.evaluate(
    ([id, x, y]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__wp.useProjectStore.getState().apply((d: any) => {
        const f = d.furniture.find((q: { id: string }) => q.id === id);
        f.x = x;
        f.y = y;
      }),
    [lamp.id, sofa.x, sofa.y] as const,
  );
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(2000);
  const markers = await collisionMarkers(page);
  expect(markers).toContain(`collision:${lamp.id}`);
  expect(markers).toContain(`collision-issue:${lamp.id}:overlap:${sofa.id}`);
  // 2) undo, then drag the lamp towards the sofa in 2D: it stops at the sofa's side
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(500);
  const l0 = (await getProject(page)).furniture.find((f: { id: string }) => f.id === lamp.id);
  const from = await planToScreen(page, l0.x, l0.y);
  const to = await planToScreen(page, sofa.x, sofa.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  const l1 = (await getProject(page)).furniture.find((f: { id: string }) => f.id === lamp.id);
  expect([l1.x, l1.y]).not.toEqual([l0.x, l0.y]);
  expect(Math.abs(l1.x - sofa.x) < sofa.width / 2 + l1.width / 2 - 0.005 && Math.abs(l1.y - sofa.y) < sofa.depth / 2 + l1.depth / 2 - 0.005).toBe(false);
  expect(errors).toEqual([]);
});

test('night lighting: day > evening > night, lamps on/off clearly distinguishable (measured screen brightness)', async ({ page }) => {
  test.setTimeout(600000);
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Realismus' }).click();
  const brightness = async (hour: number, lamps: 'auto' | 'on' | 'off') => {
    await page.getByLabel('Lampen', { exact: true }).selectOption(lamps);
    await page.evaluate((h) => {
      const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: { settings: { timeOfDay: number } }) => void) => void } } } }).__wp;
      wp.useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = h));
    }, hour);
    // software rendering in CI can be very slow: wait until the lighting has reached the hour
    // and several frames were actually rendered with the new state (not a fixed time)
    const frames = () =>
      page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wp = (window as any).__wp;
        return { frame: wp.three.gl.info.render.frame as number, hour: wp.lightingHour() as number };
      });
    await expect.poll(async () => Math.abs((await frames()).hour - hour), { timeout: 60000 }).toBeLessThan(0.01);
    const f0 = (await frames()).frame;
    await expect.poll(async () => (await frames()).frame - f0, { timeout: 90000 }).toBeGreaterThanOrEqual(12);
    // measure only where the apartment is on screen (the dark sky around it and UI overlays
    // would dilute the difference depending on how large the apartment is framed)
    const clip = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wp = (window as any).__wp;
      const p = wp.useProjectStore.getState().project;
      const xs = p.nodes.map((n: { x: number }) => n.x);
      const ys = p.nodes.map((n: { y: number }) => n.y);
      const cam = wp.three.camera;
      const r = wp.three.canvas.getBoundingClientRect();
      const pts: { x: number; y: number }[] = [];
      for (const x of [Math.min(...xs), Math.max(...xs)])
        for (const y of [Math.min(...ys), Math.max(...ys)])
          for (const z of [0, p.settings.defaultWallHeight]) {
            const v = cam.position.clone().set(x, z, y).project(cam);
            pts.push({ x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height });
          }
      const x0 = Math.max(r.left, Math.min(...pts.map((q) => q.x)));
      const y0 = Math.max(r.top, Math.min(...pts.map((q) => q.y)));
      const x1 = Math.min(r.right, Math.max(...pts.map((q) => q.x)));
      const y1 = Math.min(r.bottom, Math.max(...pts.map((q) => q.y)));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
    expect(clip.width).toBeGreaterThan(50);
    const png = await page.screenshot({ clip });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    }, png.toString('base64'));
  };
  // diagnostics for the CI log: which lights exist and how strong they are right now
  const lightReport = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wp = (window as any).__wp;
      const out: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wp.three.scene.traverse((o: any) => {
        if (o.isLight) out.push(`${o.type}:${o.intensity.toFixed(2)}${o.visible ? '' : '(hidden)'}`);
      });
      const gl = wp.three.gl.getContext();
      return `${out.join(' ')} | exposure ${wp.three.gl.toneMappingExposure.toFixed(2)} | maxFragUniforms ${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)} | renderer ${gl.getParameter(gl.RENDERER)}`;
    });
  const noon = await brightness(13, 'auto');
  const evening = await brightness(21, 'auto');
  const night = await brightness(23.5, 'auto');
  const nightLights = await lightReport();
  const nightOff = await brightness(23.5, 'off');
  console.log(`night lighting: noon ${noon.toFixed(1)} · 21:00 ${evening.toFixed(1)} · 23:30 ${night.toFixed(1)} · 23:30 off ${nightOff.toFixed(1)}\n  lamps on: ${nightLights}\n  lamps off: ${await lightReport()}`);
  expect(errors).toEqual([]); // e.g. shader compile errors would explain missing light
  expect((await getProject(page)).settings.lamps).toBe('off');
  expect(evening).toBeLessThan(noon * 0.5); // 21:00 is clearly darker than noon (was ~0.53× before the fix)
  expect(night).toBeLessThan(evening * 0.85); // and it keeps getting darker after 21:00 (was identical)
  expect(nightOff).toBeLessThan(night * 0.8); // switching the lamps off is visible
  expect(nightOff).toBeGreaterThan(2); // but not pitch black (moonlight / sky)
  expect(errors).toEqual([]);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
test('3D: doors and windows open/close – double-click, O, click while walking; one undo step each, saved, collision follows (#21)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const inner = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6); // living room ↔ bedroom
  const entrance = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'door' && Math.abs(o.width - 1.0) < 1e-6);
  const window1 = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6); // living room, north
  expect([inner.open, entrance.open, window1.open]).toEqual([true, true, false]);
  const openOf = async (id: string) => (await getProject(page)).openings.find((o: { id: string }) => o.id === id).open as boolean;
  const past = () => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length as number);
  /** World centre (plan x/y, height) of the first leaf/sash of an opening, as currently drawn. */
  const leafCenter = (id: string) =>
    page.evaluate((oid) => {
      const t = (window as any).__wp.three;
      const pivot = t.scene.getObjectByName(`leaf:${oid}:0`);
      const v = pivot.children[0].getWorldPosition(t.camera.position.clone());
      return { x: v.x as number, y: v.z as number, h: v.y as number };
    }, id);
  /**
   * Leaf position once its open/close animation has finished. The animation advances at most
   * 0.1 s per frame, so with software rendering under load (few FPS) it takes noticeably longer
   * than its nominal ~0.6 s – aiming at a leaf still in motion misses the thin leaf.
   */
  const restingLeaf = async (id: string) => {
    let last = await leafCenter(id);
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const now = await leafCenter(id);
        const moved = Math.hypot(now.x - last.x, now.y - last.y);
        last = now;
        return moved;
      })
      .toBeLessThan(0.001);
    return last;
  };

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // look into the rooms
  await page.waitForTimeout(2000);
  // the open inner door leaf stands in the living room (wall at x = 5.06)
  const openLeaf = await restingLeaf(inner.id);
  expect(openLeaf.x).toBeLessThan(4.8);
  const s = await worldToScreen3d(page, openLeaf.x, 0.8, openLeaf.y);
  // a single click only selects it …
  await page.mouse.click(s.x, s.y);
  await expect.poll(() => getSelection(page)).toEqual({ type: 'opening', id: inner.id });
  expect(await openOf(inner.id)).toBe(true);
  // … a double-click closes it: one undo step, the leaf turns into the wall opening
  const p1 = await past();
  await page.mouse.dblclick(s.x, s.y);
  await expect.poll(() => openOf(inner.id)).toBe(false);
  expect(await past()).toBe(p1 + 1);
  await expect.poll(async () => (await leafCenter(inner.id)).x).toBeGreaterThan(4.95);
  await expect(page.getByLabel('Tür geöffnet')).not.toBeChecked();
  await page.screenshot({ path: 'test-results/doors-3d-closed.png' });
  // O opens the selected door again
  await page.keyboard.press('o');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p1 + 2);
  await expect.poll(async () => (await leafCenter(inner.id)).x).toBeLessThan(4.7);
  await expect(page.getByLabel('Tür geöffnet')).toBeChecked();
  // undo, step by step
  await page.keyboard.press('Control+z');
  await expect.poll(() => openOf(inner.id)).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p1);

  // collision follows the leaf: sofa in the opened entrance door leaf → error; door closed → only the swing warning
  const sofaId: string = await page.evaluate(() => {
    const st = (window as any).__wp.useProjectStore.getState();
    const sofa = st.project.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
    st.apply((d: { furniture: { id: string; x: number }[] }) => void (d.furniture.find((f) => f.id === sofa.id)!.x = 1.7));
    return sofa.id;
  });
  await expect.poll(() => collisionMarkers(page)).toContain(`collision-issue:${sofaId}:door-leaf:${entrance.id}`);
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'opening', id }), entrance.id);
  await page.keyboard.press('o');
  await expect.poll(() => openOf(entrance.id)).toBe(false);
  await expect.poll(() => collisionMarkers(page)).not.toContain(`collision-issue:${sofaId}:door-leaf:${entrance.id}`);
  expect(await collisionMarkers(page)).toContain(`collision-issue:${sofaId}:door-swing:${entrance.id}`);

  // walkthrough: the crosshair aims at a door/window, a click (or O) opens/closes it
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  const lookAt = (x: number, y: number, h: number) =>
    page.evaluate(
      ([tx, ty, th]) => {
        const wp = (window as any).__wp;
        const c = wp.three.camera.position;
        const dist = Math.hypot(tx - c.x, ty - c.z);
        wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, dist));
      },
      [x, y, h] as const,
    );
  const target = () => page.evaluate(() => (window as any).__wp.walk.targetOpening() as string | null);
  const leaf = await restingLeaf(inner.id); // the undo above re-opened it – wait until it stands still
  await lookAt(leaf.x, leaf.y, 1.0);
  await expect.poll(target).toBe(inner.id);
  const p2 = await past();
  await page.evaluate(() => (window as any).__wp.walk.pickOrDrop()); // = click with captured mouse
  await expect.poll(() => openOf(inner.id)).toBe(false);
  expect(await past()).toBe(p2 + 1);
  expect(await getSelection(page)).toEqual({ type: 'opening', id: entrance.id }); // the click does not change the selection
  // the closed door now fills the doorway: aim at it and press O
  await restingLeaf(inner.id);
  await lookAt(5.0, 2.0, 1.0);
  await expect.poll(target).toBe(inner.id);
  await page.keyboard.press('o');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p2 + 2);
  expect(await openOf(entrance.id)).toBe(false); // O acted on the door in sight, not on the selected one
  // the living-room window: the sash opens into the room
  const glass = await restingLeaf(window1.id);
  await lookAt(glass.x, glass.y, 1.6);
  await expect.poll(target).toBe(window1.id);
  await page.evaluate(() => (window as any).__wp.walk.pickOrDrop());
  await expect.poll(() => openOf(window1.id)).toBe(true);
  await expect.poll(async () => (await leafCenter(window1.id)).y).toBeGreaterThan(0.25);
  await page.screenshot({ path: 'test-results/doors-3d-walk-window-open.png' });
  // walking keys and O must not reach the 2D tools
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  await page.getByRole('button', { name: 'Übersicht' }).click();

  // saved with the project
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).openings.find((o: { id: string }) => o.id === entrance.id)?.open).toBe(false);
  const after = await getProject(page);
  expect(after.openings.find((o: { id: string }) => o.id === inner.id).open).toBe(true);
  expect(after.openings.find((o: { id: string }) => o.id === window1.id).open).toBe(true);
  expect(errors).toEqual([]);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  expect(Math.abs(door!.width - 0.9)).toBeLessThan(0.05);
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

test('marks a narrow passage (~60 cm) in 2D and 3D and follows the minimum width (#68)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  const p = await getProject(page);
  const wardrobe = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-wardrobe-150');
  const bed = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-bed-160');
  // select the wardrobe and move it numerically so 60 cm remain between bed and wardrobe
  const s = await planToScreen(page, wardrobe.x, wardrobe.y);
  await page.mouse.click(s.x, s.y);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: wardrobe.id });
  const y = bed.y + bed.depth / 2 + 0.6 + wardrobe.depth / 2;
  const right = page.locator('.panel.right');
  await right.getByRole('textbox', { name: 'Y cm', exact: true }).fill(String(Math.round(y * 1000) / 10).replace('.', ','));
  await right.getByRole('textbox', { name: 'Y cm', exact: true }).press('Enter');

  const plan = page.locator('[data-testid="editor2d"]');
  const marker = plan.locator('[data-testid="narrow-passage"][data-width-cm="60"]');
  await expect(marker.first()).toBeVisible();
  await expect(marker.first().getByText('60 cm')).toBeVisible();
  // the 3D view shows floor markers too
  const markers3d = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = (window as any).__wp.three.scene;
      return scene.getObjectByName('narrow-passages')?.children.length ?? -1;
    });
  await expect.poll(markers3d).toBeGreaterThan(0);

  // minimum 60 cm (lowest allowed value): a 60 cm passage is no longer narrower → marker gone
  const left = page.locator('.panel.left');
  const min = left.getByRole('textbox', { name: 'Durchgang mindestens cm' });
  await min.fill('60');
  await min.press('Enter');
  expect((await getProject(page)).settings.minPassageWidth).toBeCloseTo(0.6, 6);
  await expect(marker).toHaveCount(0);

  // switching the display off hides all markers in 2D and 3D
  await left.getByLabel('Engstellen anzeigen').uncheck();
  await expect(plan.locator('[data-testid="narrow-passage"]')).toHaveCount(0);
  await expect.poll(markers3d).toBe(0);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('keyboard overview: "?" opens all shortcuts (2D, 3D, walking), Esc closes (#59)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Hilfe & Tastenkürzel' });
  await expect(dialog).toBeVisible();
  for (const text of ['Werkzeuge', '3D-Begehung', 'Ducken', 'Möbel tragen / absetzen', 'Möbel kopieren / einfügen', 'Diese Übersicht öffnen']) await expect(dialog).toContainText(text);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
