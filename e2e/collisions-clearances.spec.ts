/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test, type Page } from '@playwright/test';
import { getProject, getSelection, planToScreen, worldToScreen3d } from './fixtures';
import { derivePlan } from '../src/model/derived';
import { createFurnitureFromCatalog } from '../src/catalog/instantiate';
import { findCatalogItem } from '../src/catalog/generic';
import { buildPlacementObstacles, collidingObstacles } from '../src/model/placement';
import { clearanceLabel, furnitureClearances, rotateHandlePoint, selectionClearances } from '../src/model/clearances';

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

test('kitchen warning list does not linger after the obstacle is removed (#220)', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const s = await planToScreen(page, 1.0, -0.06);
  await page.mouse.click(s.x, s.y);
  expect((await getSelection(page))?.type).toBe('wall');
  await page.locator('.panel.left').getByRole('button', { name: 'Küche' }).click();
  const blocked = page.getByTestId('kitchen-run-blocked');
  await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
  await expect(blocked).toContainText('Nicht gesetzt, weil sie hier nicht passen:');
  // undo the placement and delete the lowboard: the old list must be gone
  await page.evaluate(() => {
     
    const w = (window as any).__wp;
    w.useProjectStore.getState().undo();
    w.useProjectStore.getState().apply((d: { furniture: { name: string }[] }) => {
      d.furniture = d.furniture.filter((f) => f.name !== 'TV-Lowboard');
    });
  });
  await expect(blocked).toHaveCount(0);
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
  // the TV lowboard stands in front of the wall: the planner says beforehand which modules do not fit (#220)
  const blocked = page.getByTestId('kitchen-run-blocked');
  await expect(blocked).toContainText('überschneidet sich mit „TV-Lowboard“');
  await page.evaluate(() => {
     
    const st = (window as any).__wp.useProjectStore.getState();
    st.apply((d: { furniture: { name: string }[] }) => {
      d.furniture = d.furniture.filter((f) => f.name !== 'TV-Lowboard');
    });
  });
  await expect(blocked).toHaveCount(0);
  await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
  const q = await getProject(page);
  const kitchen = q.furniture.filter((f: { kitchen?: unknown }) => f.kitchen);
  expect(kitchen.length).toBeGreaterThanOrEqual(6);
  expect(kitchen.some((f: { kitchen: { type: string } }) => f.kitchen.type === 'countertop')).toBe(true);
  expect(q.furniture.length).toBeGreaterThan(p.furniture.length);
  await expect(page.getByText('Stückliste Küche')).toBeVisible();
  // no module stands in the wall or in the connected wall at the corner (#16): flush in front of the face
  const walls = buildPlacementObstacles(derivePlan(q)).filter((o) => o.kind === 'wall');
  for (const f of kitchen) expect(collidingObstacles(f, walls), f.name).toEqual([]);
  const westmost = Math.min(...kitchen.map((f: { x: number; width: number }) => f.x - f.width / 2));
  expect(westmost).toBeGreaterThanOrEqual(0);
  expect(westmost).toBeLessThan(0.01);
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

test('marked furniture says why (#16): reason in the properties panel and in the 2D hover card', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const p0 = await getProject(page);
  const sofa = p0.furniture.find((f: any) => f.catalogId === 'generic-sofa-3');
  const lamp = p0.furniture.find((f: any) => f.catalogId === 'generic-floor-lamp');
  const panel = page.locator('.panel.right');
  // not marked: no reason shown
  const l = await planToScreen(page, lamp.x, lamp.y);
  await page.mouse.click(l.x, l.y);
  await expect(panel.getByTestId('conflict-summary')).toHaveCount(0);
  // Alt: drag the floor lamp into the sofa → both red, the lamp's panel says why
  const into = await planToScreen(page, sofa.x + 0.7, sofa.y);
  await page.mouse.move(l.x, l.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(into.x, into.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const summary = panel.getByTestId('conflict-summary');
  await expect(summary).toHaveText('Rot markiert: überlappt mit „Sofa 3-Sitzer“');
  await expect(summary).toHaveAttribute('data-level', 'error');
  await expect(panel.getByTestId('furniture-issues')).toContainText('Überschneidet sich mit „Sofa 3-Sitzer“.');
  // hovering the (unselected) sofa in 2D: the hover card names the reason, too
  const s = await planToScreen(page, sofa.x - 0.6, sofa.y);
  await page.mouse.move(s.x, s.y);
  const card = page.getByTestId('furniture-hover');
  await expect(card).toBeVisible();
  await expect(card).toContainText(sofa.name);
  await expect(card.getByTestId('hover-conflict')).toHaveText('Rot markiert: überlappt mit „Stehlampe“');
  await page.screenshot({ path: 'test-results/conflict-reason-hover.png' });
  // an item that is not marked shows no reason in its card
  const tv = p0.furniture.find((f: any) => f.catalogId === 'generic-tv-sideboard');
  const t = await planToScreen(page, tv.x, tv.y);
  await page.mouse.move(t.x, t.y);
  await expect(card).toContainText(tv.name);
  await expect(card.getByTestId('hover-conflict')).toHaveCount(0);
  // pushing a sideboard into the wall (Alt): „ragt in die Wand“
  await page.evaluate((id) => (window as any).__wp.useProjectStore.getState().apply((d: any) => void (d.furniture.find((f: any) => f.id === id).y = 0.05)), tv.id);
  await page.mouse.click(t.x, t.y + 2);
  await expect(panel.getByTestId('conflict-summary')).toContainText('ragt in die Wand');
  expect(errors).toEqual([]);
});


test('3D: collision with the opened entrance door is shown in the room and disappears when dragged free', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  // reproduce the reported situation: sofa standing in the opened entrance door leaf
  const sofaId: string = await page.evaluate(() => {
     
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

test('floor lamp and sofa: overlap is marked in 3D, dragging the lamp into the sofa stops at it (2D)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const sofa = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const lamp = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-floor-lamp');
  // 1) lamp placed inside the sofa (e.g. typed coordinates) → real overlap, red in 3D
  await page.evaluate(
    ([id, x, y]) =>
       
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

test('3D: Alt while dragging places freely (no collision stop), without Alt the item stops at the sofa (#16)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // walls cut at 1.2 m: furniture visible
  await page.waitForTimeout(2500);
  const p0 = await getProject(page);
  const sofa = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const table = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const find = async (id: string) => (await getProject(page)).furniture.find((f: { id: string }) => f.id === id);
  const overlapsSofa = (t: { x: number; y: number; width: number; depth: number }) =>
    Math.abs(t.x - sofa.x) < (sofa.width + t.width) / 2 - 0.005 && Math.abs(t.y - sofa.y) < (sofa.depth + t.depth) / 2 - 0.005;
  const drag = async (alt: boolean) => {
    const t = await find(table.id);
    const a = await worldToScreen3d(page, t.x + 0.2, t.height, t.y);
    const b = await worldToScreen3d(page, t.x + 0.2, t.height, t.y + 0.75);
    await page.mouse.move(a.x, a.y);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.waitForTimeout(400);
    return find(table.id);
  };
  // without Alt: the table stops at the sofa
  const t1 = await drag(false);
  expect(t1.y).toBeGreaterThan(table.y + 0.1);
  expect(overlapsSofa(t1)).toBe(false);
  expect(await collisionMarkers(page)).not.toContain(`collision:${table.id}`);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await find(table.id)).y).toBeCloseTo(table.y, 6);
  // with Alt: placed freely into the sofa, the overlap is marked in 3D (as in 2D)
  const t2 = await drag(true);
  expect(overlapsSofa(t2)).toBe(true);
  await expect.poll(() => collisionMarkers(page)).toContain(`collision:${table.id}`);
  expect((await collisionMarkers(page)).some((m) => m.includes(':overlap:') && m.includes(table.id) && m.includes(sofa.id))).toBe(true);
  expect(errors).toEqual([]);
});

test('chair under table (#16): the seat goes under the table top, the backrest stops at the table edge; forced in with Alt it is marked with the reason', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  // an empty living room with a dining table (y 1.075 … 1.925) and a chair facing it
  const table = createFurnitureFromCatalog(findCatalogItem('generic-dining-table-4')!, { x: 2.5, y: 1.5 });
  const chair = createFurnitureFromCatalog(findCatalogItem('generic-chair')!, { x: 2.5, y: 0.5 });
  await page.evaluate(
    (items) => (window as any).__wp.useProjectStore.getState().apply((d: any) => void (d.furniture = items)),
    [table, chair],
  );
  await page.waitForTimeout(400);
  const find = async (id: string) => (await getProject(page)).furniture.find((f: any) => f.id === id);
  const edge = table.y - table.depth / 2;
  const drag = async (toY: number, alt: boolean) => {
    const c = await find(chair.id);
    const a = await planToScreen(page, c.x, c.y);
    const b = await planToScreen(page, c.x, toY);
    await page.mouse.move(a.x, a.y);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    return find(chair.id);
  };
  const panel = page.locator('.panel.right');
  // pushed towards the table centre: stops with the backrest (3.5 cm) at the table edge, seat under the top
  const c1 = await drag(table.y, false);
  const backFront = c1.y - c1.depth / 2 + 0.035;
  expect(backFront).toBeLessThanOrEqual(edge + 0.002);
  expect(backFront).toBeGreaterThan(edge - 0.06); // at most one 5 cm grid step short of the edge
  expect(c1.y + c1.depth / 2 - edge).toBeGreaterThan(0.35); // most of the seat is under the table
  await expect(panel.locator('.panel-issues')).toHaveCount(0);
  // with Alt it can be forced into the table: marked, with the reason
  const c2 = await drag(table.y, true);
  expect(Math.abs(c2.y - table.y)).toBeLessThan(0.05);
  await expect(panel.locator('.panel-issues')).toContainText('Die Lehne steht in „Esstisch 4 Personen“');
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
      // the scene registers itself a moment after the canvas appears
       
      const scene = (window as any).__wp.three?.scene;
      return scene?.getObjectByName('narrow-passages')?.children.length ?? -1;
    });
  await expect.poll(markers3d).toBeGreaterThan(0);

  // minimum 60 cm (lowest allowed value): a 60 cm passage is no longer narrower → marker gone
  const left = page.locator('.panel.left');
  // the settings live in the collapsible group "Engstellen" (closed by default, #122)
  await left.getByRole('button', { name: 'Engstellen' }).click();
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

test('align and distribute several furniture items: top edge, equal gaps, one undo step each (#51)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const p0 = await getProject(page);
  // bedroom: night stand – bed – night stand in a row (different widths)
  const bed = p0.furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const ns = p0.furniture.filter((f: any) => f.catalogId === 'generic-nightstand');
  const ids: string[] = [bed.id, ...ns.map((n: any) => n.id)];
  const a = await planToScreen(page, bed.x, bed.y);
  await page.mouse.click(a.x, a.y);
  for (const n of ns) {
    const s = await planToScreen(page, n.x, n.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    await page.keyboard.up('Shift');
  }
  const controls = page.locator('.panel.right').getByTestId('arrange-controls');
  await expect(controls).toBeVisible();
  const past = () => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length as number);
  // axis-aligned extent of the footprints (rotations here are multiples of 90°)
  const boxes = async () => {
    const p = await getProject(page);
    return ids.map((id) => {
      const f = p.furniture.find((x: any) => x.id === id);
      const turned = Math.abs(Math.sin(f.rotation)) > 0.5;
      const w = turned ? f.depth : f.width;
      const d = turned ? f.width : f.depth;
      return { minX: f.x - w / 2, maxX: f.x + w / 2, minY: f.y - d / 2, maxY: f.y + d / 2 };
    });
  };
  const b0 = await boxes();
  expect(Math.abs(b0[0].minY - b0[1].minY)).toBeGreaterThan(0.05); // not aligned yet

  const before = await past();
  await controls.getByRole('button', { name: 'Oben ausrichten' }).click();
  const top = await boxes();
  for (const b of top) expect(b.minY).toBeCloseTo(top[0].minY, 2);
  expect(await past()).toBe(before + 1);

  await controls.getByRole('button', { name: 'Waagrecht verteilen' }).click();
  const dist = (await boxes()).sort((x, y) => x.minX - y.minX);
  const gaps = dist.slice(1).map((b, i) => b.minX - dist[i].maxX);
  expect(gaps[0]).toBeCloseTo(gaps[1], 2);
  expect(gaps[0]).toBeGreaterThanOrEqual(0);
  expect(await past()).toBe(before + 2);

  // Ctrl+Z undoes exactly the distribution
  await page.keyboard.press('Control+z');
  expect(await past()).toBe(before + 1);
  const back = await boxes();
  for (let i = 0; i < ids.length; i++) {
    expect(back[i].minX).toBeCloseTo(top[i].minX, 3);
    expect(back[i].minY).toBeCloseTo(top[i].minY, 3);
  }
  // with two items selected, distributing is disabled, aligning is not
  const s = await planToScreen(page, ns[1].x, ns[1].y);
  await page.keyboard.down('Shift');
  await page.mouse.click(s.x, s.y);
  await page.keyboard.up('Shift');
  await expect(controls.getByRole('button', { name: 'Waagrecht verteilen' })).toBeDisabled();
  await expect(controls.getByRole('button', { name: 'Links ausrichten' })).toBeEnabled();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('shows the kitchen work triangle with lengths, follows moved appliances and can be switched off (#82)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  // kitchen run along the north wall of the living room – first module: fridge instead of the tall cabinet
  const s = await planToScreen(page, 1.0, -0.06);
  await page.mouse.click(s.x, s.y);
  expect((await getSelection(page))?.type).toBe('wall');
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Küche' }).click();
  await left.getByRole('combobox', { name: 'Modul' }).first().selectOption({ label: 'Kühlschrank freistehend' });
  // the TV lowboard would block the run (#220)
  await page.evaluate(() => {
     
    const st = (window as any).__wp.useProjectStore.getState();
    st.apply((d: { furniture: { name: string }[] }) => {
      d.furniture = d.furniture.filter((f) => f.name !== 'TV-Lowboard');
    });
  });
  await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();

  const plan = page.locator('[data-testid="editor2d"]');
  const triangle = plan.getByTestId('kitchen-triangle');
  await expect(triangle).toBeVisible();
  const sides = triangle.getByTestId('kitchen-triangle-side');
  await expect(sides).toHaveCount(3);
  for (const t of await sides.allTextContents()) expect(t).toMatch(/^\d+,\d{2} m$/);
  await expect(triangle.getByTestId('kitchen-triangle-sum')).toHaveText(/^Σ \d+,\d{2} m$/);
  const result = left.getByTestId('kitchen-triangle-result');
  await expect(result).toContainText('Spüle – Herd');
  await expect(left.getByText('Richtwert, keine Norm', { exact: false })).toBeVisible();

  // moving the fridge far away updates the check (sum too long)
  await page.evaluate(() => {
     
    const st = (window as any).__wp.useProjectStore.getState();
    st.apply((d: { furniture: { kitchen?: { type: string }; x: number; y: number; rotation: number }[] }) => {
      const f = d.furniture.find((x) => x.kitchen?.type === 'fridge')!;
      f.x = 4.6;
      f.y = 3.2;
      f.rotation = Math.PI;
    });
  });
  await expect(triangle).toHaveAttribute('data-ok', 'false');
  await expect(triangle.locator('[data-testid="kitchen-triangle-side"][data-status="long"]').first()).toBeVisible();
  await expect(result).toContainText('außerhalb');

  // switching it off hides the triangle in the plan (the panel keeps the evaluation)
  await left.getByLabel('Arbeitsdreieck im Plan anzeigen').uncheck();
  await expect(plan.getByTestId('kitchen-triangle')).toHaveCount(0);
  await expect(result).toBeVisible();
  expect((await getProject(page)).settings.kitchenTriangle.show).toBe(false);
  expect(errors).toEqual([]);
});

test('clearances (#50): dimension lines to walls and furniture while dragging an item', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const plan = page.getByTestId('editor2d');
  const p0 = await getProject(page);
  const table = p0.furniture.find((f: { catalogId: string }) => f.catalogId === 'generic-coffee-table');
  const a = await planToScreen(page, table.x, table.y);
  const b = await planToScreen(page, table.x - 0.6, table.y);
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
  // while the button is held: lines with cm labels, matching the model for the current position
  const check = async () => {
    const lines = plan.locator('[data-testid="clearance"]');
    await expect(lines.first()).toBeVisible();
    const shown = await lines.evaluateAll((els) =>
      els.map((el) => ({ side: el.getAttribute('data-side'), cm: Number(el.getAttribute('data-distance-cm')), text: el.textContent })),
    );
    const p = await getProject(page);
    const expected = furnitureClearances(p, derivePlan(p), table.id).map((c) => ({ side: c.side, cm: Math.round(c.distance * 100), text: clearanceLabel(c.distance) }));
    expect(expected.length).toBeGreaterThan(0);
    expect(shown).toEqual(expected);
    for (const s of shown) expect(s.text).toMatch(/^\d+ cm$/);
    return shown;
  };
  const mid = await check();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  const end = await check();
  // the values follow the item live (it moved left: less room on the left)
  const left = (xs: typeof mid) => xs.find((s) => s.side === 'left')?.cm ?? NaN;
  expect(left(end)).toBeLessThan(left(mid));
  await page.mouse.up();
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  // Alt held with exactly this item selected shows them again, releasing Alt hides them
  await page.keyboard.down('Alt');
  await expect(plan.getByTestId('clearances')).toHaveCount(1);
  await page.keyboard.up('Alt');
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('clearances of a multi-selection and a group (#94): shared outline to walls and other furniture, while dragging and with Alt', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const plan = page.getByTestId('editor2d');
  const p0 = await getProject(page);
  const bed = p0.furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const ns = p0.furniture.filter((f: any) => f.catalogId === 'generic-nightstand');
  const wardrobe = p0.furniture.find((f: any) => f.catalogId === 'generic-wardrobe-150');
  const ids: string[] = [bed.id, ...ns.map((n: any) => n.id)];
  const shownLines = () =>
    plan.locator('[data-testid="clearance"]').evaluateAll((els) => els.map((el) => ({ side: el.getAttribute('data-side'), cm: Number(el.getAttribute('data-distance-cm')), hit: el.getAttribute('data-hit') })));
  /** The overlay shows the clearances of the whole selection, as the model computes them for the current positions. */
  const check = async () => {
    await expect(plan.getByTestId('clearances')).toHaveCount(1);
    expect((await plan.getByTestId('clearances').getAttribute('data-furniture-ids'))!.split(' ').sort()).toEqual([...ids].sort());
    const p = await getProject(page);
    const expected = selectionClearances(p, derivePlan(p), ids).map((c) => ({ side: c.side, cm: Math.round(c.distance * 100), hit: c.hit.type }));
    expect(expected.length).toBeGreaterThan(0);
    await expect.poll(shownLines).toEqual(expected);
    return expected;
  };
  // bed + both night stands selected (Shift+click)
  const click = async (f: { x: number; y: number }, shift = false) => {
    const s = await planToScreen(page, f.x, f.y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    if (shift) await page.keyboard.up('Shift');
  };
  await click(bed);
  for (const n of ns) await click(n, true);
  await expect(page.getByTestId('multi-note')).toContainText('3 Möbel ausgewählt');
  // Alt shows the clearances of the whole selection (was: nothing for a multi-selection)
  await page.keyboard.down('Alt');
  await check();
  await page.keyboard.up('Alt');
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  // dragging the bed down: lines from the shared outline, live
  const a = await planToScreen(page, bed.x, bed.y);
  const b = await planToScreen(page, bed.x, bed.y + 0.6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, (a.y + b.y) / 2, { steps: 4 });
  const mid = await check();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  const end = await check();
  const cm = (xs: typeof mid, side: string) => xs.find((x) => x.side === side)?.cm ?? NaN;
  expect(cm(end, 'back')).toBeGreaterThan(cm(mid, 'back')); // moved away from the north wall
  // measured from the shared outline: the left line starts at the left night stand (not at the bed),
  // the front line runs to the unselected wardrobe; no line ends at a selected item
  const p1 = await getProject(page);
  const res = selectionClearances(p1, derivePlan(p1), ids);
  const leftEdge = Math.min(...ids.map((id) => p1.furniture.find((f: any) => f.id === id)).map((f: any) => f.x - f.width / 2));
  expect(leftEdge).toBeLessThan(p1.furniture.find((f: any) => f.id === bed.id).x - bed.width / 2 - 0.1);
  expect(res.find((c) => c.side === 'left')!.from.x).toBeCloseTo(leftEdge, 3);
  expect(res.find((c) => c.side === 'front')!.hit).toEqual({ type: 'furniture', id: wardrobe.id });
  for (const c of res) expect(ids).not.toContain(c.hit.id);
  await page.screenshot({ path: 'test-results/clearances-multi-select.png' });
  await page.mouse.up();
  await expect(plan.getByTestId('clearances')).toHaveCount(0);

  // as a group (#65): Strg+G, then drag the group – the same shared-outline lines
  await page.keyboard.press('Control+g');
  await expect(page.getByTestId('group-outline')).toHaveAttribute('data-whole', 'true');
  const pg = await getProject(page);
  const bedNow = pg.furniture.find((f: any) => f.id === bed.id);
  const g1 = await planToScreen(page, bedNow.x, bedNow.y);
  const g2 = await planToScreen(page, bedNow.x, bedNow.y - 0.3);
  await page.mouse.move(g1.x, g1.y);
  await page.mouse.down();
  await page.mouse.move(g2.x, g2.y, { steps: 5 });
  const grp = await check();
  expect(cm(grp, 'front')).toBeGreaterThan(cm(end, 'front')); // the group moved back up, away from the wardrobe
  await page.mouse.up();
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  // Alt with the whole group selected
  await page.keyboard.down('Alt');
  await check();
  await page.keyboard.up('Alt');
  expect(errors).toEqual([]);
});

test('clearances (#125): short distance gets its label beside the line, the rotate handle stays free', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  const plan = page.getByTestId('editor2d');
  const p0 = await getProject(page);
  const table = p0.furniture.find((f: { catalogId: string }) => f.catalogId === 'generic-coffee-table');
  // select the coffee table, then push it to 8 cm in front of the sofa (sofa back edge at y = 3.097)
  const s = await planToScreen(page, table.x, table.y);
  await page.mouse.click(s.x, s.y);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  await page.evaluate((id) => {
     
    (window as any).__wp.useProjectStore.getState().apply((d: { furniture: { id: string; y: number; depth: number }[] }) => {
      const f = d.furniture.find((x) => x.id === id)!;
      f.y = 3.097 - 0.08 - f.depth / 2;
    });
  }, table.id);
  await page.keyboard.down('Alt');
  const front = plan.locator('[data-testid="clearance"][data-side="front"]');
  await expect(front).toHaveAttribute('data-distance-cm', '8');
  await expect(front).toHaveAttribute('data-label', 'beside');
  // the label does not cover the line: it sits next to it
  const lineBox = (await front.locator('line').first().boundingBox())!;
  const textBox = (await front.locator('text').boundingBox())!;
  expect(textBox.x).toBeGreaterThanOrEqual(lineBox.x + lineBox.width - 1);

  // the back line is moved off the rotate handle (≥ 10 px)
  const back = plan.locator('[data-testid="clearance"][data-side="back"]');
  await expect(back).toHaveAttribute('data-shifted', 'true');
  const p = await getProject(page);
  const item = p.furniture.find((f: { id: string }) => f.id === table.id);
  const zoom = await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { view2d: { zoom: number } } } } }).__wp.useUiStore.getState().view2d.zoom);
  const h = rotateHandlePoint(item, 1 / zoom);
  const hs = await planToScreen(page, h.x, h.y);
  const bb = (await back.locator('line').first().boundingBox())!;
  const lineX = bb.x + bb.width / 2;
  expect(Math.abs(lineX - hs.x)).toBeGreaterThanOrEqual(10);
  await page.keyboard.up('Alt');
  await expect(plan.getByTestId('clearances')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('multi-selection reaches the wall with a fast mouse jump, members keep their spacing (#210)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const p0 = await getProject(page);
  const bed = p0.furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const ns = p0.furniture.filter((f: any) => f.catalogId === 'generic-nightstand');
  const ids = [bed.id, ...ns.map((n: any) => n.id)];
  for (const [i, f] of [bed, ...ns].entries()) {
    const s = await planToScreen(page, f.x, f.y);
    if (i) await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    if (i) await page.keyboard.up('Shift');
  }
  // a few large jumps far beyond the wall to the left (a quick flick of the mouse)
  const a = await planToScreen(page, bed.x, bed.y);
  const b = await planToScreen(page, bed.x - 3, bed.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 });
  await page.mouse.up();
  const p1 = await getProject(page);
  const after = ids.map((id) => p1.furniture.find((f: any) => f.id === id));
  const dx = after.map((f: any, i: number) => f.x - [bed, ...ns][i].x);
  for (const v of dx) expect(v).toBeCloseTo(dx[0], 3);
  // the left edge of the selection is flush with the nearest wall face to its left
  const half = (f: any) => (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.depth : f.width) / 2;
  const leftEdge = Math.min(...after.map((f: any) => f.x - half(f)));
  const node = (id: string) => p1.nodes.find((n: any) => n.id === id);
  const startEdge = Math.min(...[bed, ...ns].map((f: any) => f.x - half(f)));
  const inner = Math.max(
    ...p1.walls
      .map((w: any) => ({ w, a: node(w.a), b: node(w.b) }))
      .filter(({ a, b }: any) => Math.abs(a.x - b.x) < 1e-6 && a.x < startEdge && Math.min(a.y, b.y) < bed.y && Math.max(a.y, b.y) > bed.y)
      .map(({ w, a }: any) => a.x + w.thickness / 2),
  );
  expect(leftEdge).toBeGreaterThanOrEqual(inner - 0.005);
  expect(leftEdge - inner).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});
