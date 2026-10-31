import { expect, test, type Page } from '@playwright/test';
import { getProject, getSelection, planToScreen, worldToScreen3d } from './fixtures';

/* Gemeinsames Objekt-Kontextmenü (#235): 2D, 3D-Übersicht, Begehen und Handy-Blatt. */
/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */

const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

/** Right click at the view centre = where the crosshair is (no pointer lock in the test browser). */
async function openWalkMenu(page: Page) {
  const box = await page.getByTestId('crosshair').boundingBox();
  if (!box) throw new Error('no crosshair');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
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

const pastLength = (page: Page) => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length);
const coffeeTable = async (page: Page) => (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');

test('2D: right-click on furniture opens the context menu; rotate, duplicate and delete are one undo step each (#235)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const table = await coffeeTable(page);
  const at = await planToScreen(page, table.x, table.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByTestId('object-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-place', '2d');
  await expect(page.getByTestId('object-menu-title')).toHaveText(table.name);
  await expect(menu).toContainText('(B × T × H)');
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });

  // rotate: one undo step, the menu stays open
  let past = await pastLength(page);
  await menu.locator('[data-action="rotate-right"]').click();
  await expect.poll(async () => (await coffeeTable(page)).rotation).toBeCloseTo(table.rotation + Math.PI / 2, 5);
  expect(await pastLength(page)).toBe(past + 1);
  await expect(menu).toBeVisible();

  // Esc closes the menu, the selection stays
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });

  // duplicate from the menu (keyboard: Shift+F10 opens it for the selection)
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  past = await pastLength(page);
  const count = (await getProject(page)).furniture.length;
  await menu.locator('[data-action="duplicate"]').click();
  await expect(menu).toHaveCount(0);
  expect((await getProject(page)).furniture.length).toBe(count + 1);
  expect(await pastLength(page)).toBe(past + 1);

  // a right-drag still pans the plan and opens no menu
  const view = await page.evaluate(() => (window as any).__wp.useUiStore.getState().view2d);
  await page.mouse.move(at.x + 200, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(at.x + 260, at.y + 30, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(menu).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__wp.useUiStore.getState().view2d)).cx).not.toBeCloseTo(view.cx, 3);

  // delete the copy from its menu
  const copy = (await getSelection(page)) as { id: string };
  const c = (await getProject(page)).furniture.find((f: { id: string }) => f.id === copy.id);
  // the copy lies 30 cm off the original: click its outer corner, where the original does not reach
  const m = Math.min(c.width, c.depth) / 2 - 0.05;
  const cAt = await planToScreen(page, c.x + m, c.y + m);
  await page.mouse.click(cAt.x, cAt.y, { button: 'right' });
  await expect(page.getByTestId('object-menu-title')).toHaveText(c.name);
  await menu.locator('[data-action="delete"]').click();
  await expect(menu).toHaveCount(0);
  expect((await getProject(page)).furniture.some((f: { id: string }) => f.id === copy.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('2D: doors open and close from the context menu; "Eigenschaften" shows the properties panel (#235)', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const door = (await getProject(page)).openings.find((o: { kind: string }) => o.kind === 'door');
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'opening', id }), door.id);
  await page.evaluate(() => (window as any).__wp.useUiStore.getState().setRightTab('budget'));
  await page.keyboard.press('Shift+F10');
  const menu = page.getByTestId('object-menu');
  await expect(page.getByTestId('object-menu-title')).toHaveText('Tür');
  const past = await pastLength(page);
  await menu.locator('[data-action="toggle-open"]').click();
  await expect.poll(async () => (await getProject(page)).openings.find((o: { id: string }) => o.id === door.id).open).toBe(!door.open);
  expect(await pastLength(page)).toBe(past + 1);
  await expect(menu.locator('[data-action="toggle-open"]')).toHaveText(door.open ? 'Öffnen' : 'Schließen');
  await menu.locator('[data-action="properties"]').click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().rightTab)).toBe('properties');
});

test('3D overview: right-click on furniture opens the same context menu (#235)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(1500);
  const project = await getProject(page);
  // the coffee table is hidden behind the near wall from the default view: the wall blocks the pick
  const hidden = await coffeeTable(page);
  const behind = await worldToScreen3d(page, hidden.x, hidden.elevation + hidden.height * 0.9, hidden.y);
  await page.mouse.click(behind.x, behind.y, { button: 'right' });
  const menu = page.getByTestId('object-menu');
  await page.waitForTimeout(300);
  await expect(menu).toHaveCount(0);
  // the TV sideboard at the far wall is in plain sight
  const table = project.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-tv-sideboard');
  const at = await worldToScreen3d(page, table.x, table.elevation + table.height * 0.9, table.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-place', '3d');
  await expect(page.getByTestId('object-menu-title')).toHaveText(table.name);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  // a click outside closes it
  await page.mouse.click(at.x + 300, at.y - 200);
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('walkthrough: right click opens the context menu at the crosshair; carry and drop from it (#235)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const table = await coffeeTable(page);
  await page.evaluate(
    ([tx, ty]) => {
      const wp = (window as any).__wp;
      const c = wp.three.camera.position;
      const dist = Math.hypot(tx - c.x, ty - c.z);
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y - 0.3, dist));
    },
    [table.x, table.y],
  );
  await expect.poll(() => page.evaluate(() => (window as any).__wp.walk.target())).toBe(table.id);
  await openWalkMenu(page);
  const menu = page.getByTestId('object-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-place', '3d'); // free mouse (no pointer lock): menu opens under the cursor
  await expect(page.getByTestId('object-menu-title')).toHaveText(table.name);
  // the right click must not switch the 2D tool while walking
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  await menu.locator('[data-action="carry"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBe(table.id);
  await openWalkMenu(page);
  await expect(menu.locator('[data-action="drop"]')).toBeVisible();
  await menu.locator('[data-action="drop"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBeNull();
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('the "⋯" button opens the context menu as a sheet; "Eigenschaften" opens the details sheet (#235)', async ({ page }) => {
    await freshStart(page);
    await expect(page.locator('.app.phone')).toBeVisible();
    const table = await coffeeTable(page);
    await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), table.id);
    await page.getByTestId('mobile-object-menu').click();
    const menu = page.getByTestId('object-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/sheet/);
    await expect(page.getByTestId('object-menu-title')).toHaveText(table.name);
    await menu.locator('[data-action="properties"]').click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.app.phone.sheet-right')).toBeVisible();
  });
});
