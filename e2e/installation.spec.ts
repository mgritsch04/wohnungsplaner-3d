import { expect, test, type Page } from '@playwright/test';
import { getProject as rawProject, getSelection, planToScreen, worldToScreen3d } from './fixtures';
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

/** A point 25 cm inside the first room, in front of the middle of its wall `edge`. */
function nearWall(p: Project, edge: number, along = 0.5) {
  const room = p.rooms[0];
  const pts = room.nodeIds.map((id) => p.nodes.find((n) => n.id === id)!);
  const a = pts[edge % pts.length];
  const b = pts[(edge + 1) % pts.length];
  const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  const m = { x: a.x + (b.x - a.x) * along, y: a.y + (b.y - a.y) * along };
  const l = Math.hypot(c.x - m.x, c.y - m.y);
  return { x: m.x + ((c.x - m.x) / l) * 0.25, y: m.y + ((c.y - m.y) / l) * 0.25 };
}

async function place(page: Page, label: string, at: { x: number; y: number }) {
  await page.getByTestId('fixture-buttons').getByRole('button', { name: `+ ${label}`, exact: true }).click();
  await expect(page.getByTestId('fixture-placing')).toHaveCount(1);
  const s = await planToScreen(page, at.x, at.y);
  await page.mouse.click(s.x, s.y);
  await expect(page.getByTestId('fixture-placing')).toHaveCount(0);
}

test('Installationsplan (#64, #81): Steckdose, Heizkörper und Wasseranschluss an Wände setzen, ziehen, Möbel davor markiert, 3D, bleibt nach Reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  const right = page.locator('.panel.right');
  await left.getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();

  const p0 = await getProject(page);
  expect(p0.fixtures).toEqual([]);
  await place(page, 'Steckdose', nearWall(p0, 0, 0.3));
  await place(page, 'Heizkörper', nearWall(p0, 0, 0.7));
  await place(page, 'Wasseranschluss', nearWall(p0, 2));
  await expect(page.getByTestId('fixture-2d')).toHaveCount(3);
  const p1 = await getProject(page);
  expect(p1.fixtures.map((f) => f.kind)).toEqual(['socket', 'radiator', 'water']);
  expect(p1.fixtures.map((f) => f.elevation)).toEqual([0.3, 0.15, 0.55]);
  // the last placed one is selected and its properties are shown
  await expect.poll(async () => (await getSelection(page))?.type).toBe('fixture');
  const props = right.getByTestId('fixture-props');
  await expect(props).toContainText('Wasseranschluss');

  // a click far away from any wall places nothing
  await page.getByTestId('fixture-buttons').getByRole('button', { name: '+ Lichtschalter', exact: true }).click();
  const c = p0.rooms[0].nodeIds.map((id) => p0.nodes.find((n) => n.id === id)!);
  const mid = { x: c.reduce((s, q) => s + q.x, 0) / c.length, y: c.reduce((s, q) => s + q.y, 0) / c.length };
  const sm = await planToScreen(page, mid.x, mid.y);
  await page.mouse.click(sm.x, sm.y);
  await expect(page.getByText('Bitte auf oder nahe an eine Wand klicken')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fixture-placing')).toHaveCount(0);
  expect((await getProject(page)).fixtures).toHaveLength(3);

  // drag the socket 50 cm along its wall: it stays on the wall face (same distance and direction)
  const socket = p1.fixtures[0];
  const dir = { x: Math.cos(socket.rotation), y: Math.sin(socket.rotation) };
  const knob = page.locator(`[data-fixture-id="${socket.id}"] circle[fill="#ffffff"]`);
  const kb = (await knob.boundingBox())!;
  const from = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };
  const s0 = await planToScreen(page, socket.x, socket.y);
  const s1 = await planToScreen(page, socket.x + dir.x * 0.5, socket.y + dir.y * 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((s1.x - s0.x) * i) / 6, from.y + ((s1.y - s0.y) * i) / 6 + (i % 2 ? 6 : -6));
  await page.mouse.up();
  const moved = (await getProject(page)).fixtures[0];
  expect(Math.hypot(moved.x - socket.x - dir.x * 0.5, moved.y - socket.y - dir.y * 0.5)).toBeLessThan(0.03);
  expect(moved.rotation).toBeCloseTo(socket.rotation, 6);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).fixtures[0].x).toBeCloseTo(socket.x, 6);

  // a cabinet in front of the water connection is marked orange, with the reason
  const water = p1.fixtures[2];
  await page.evaluate((w) => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Project) => void) => void } } } }).__wp;
    wp.useProjectStore.getState().apply((d) => {
      d.furniture.push({
        id: 'e2e-board',
        name: 'Testkommode',
        category: 'storage',
        x: w.x - Math.sin(w.rotation) * 0.25,
        y: w.y + Math.cos(w.rotation) * 0.25,
        elevation: 0,
        rotation: w.rotation,
        width: 0.8,
        depth: 0.4,
        height: 0.8,
        color: '#b0a898',
        model: { type: 'procedural', shape: 'box' },
        quantity: 1,
        approximate: true,
        solid: true,
        locked: false,
        existing: false,
      });
    });
  }, water);
  await page.locator(`[data-fixture-id="${water.id}"] circle[fill="#ffffff"]`).click({ force: true });
  await expect(props.getByTestId('fixture-blocked')).toContainText('Testkommode');
  await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'furniture', id: 'e2e-board' }));
  await expect(right).toContainText('steht vor einem Wasseranschluss');

  // radiator: properties change its size; it is visible and selectable in 3D
  const radiator = p1.fixtures[1];
  await page.locator(`[data-fixture-id="${radiator.id}"] circle[fill="#ffffff"]`).click({ force: true });
  await props.getByRole('textbox', { name: 'Breite' }).fill('120');
  await props.getByRole('textbox', { name: 'Breite' }).press('Enter');
  await expect.poll(async () => (await getProject(page)).fixtures[1].width).toBeCloseTo(1.2, 6);
  await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection(null));
  const r3 = await worldToScreen3d(page, radiator.x, radiator.elevation + 0.3, radiator.y);
  await page.mouse.click(r3.x, r3.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(radiator.id);

  // delete with the key, undo; everything is saved with the project
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await getProject(page)).fixtures.length).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).fixtures.length).toBe(3);
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await expect.poll(async () => (await getProject(page)).fixtures.map((f) => f.kind)).toEqual(['socket', 'radiator', 'water']);
  await expect(page.getByTestId('fixture-2d')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('Steckdosen-Leistung (#135): Stromkreis anlegen, Steckdose zuordnen, Geräte eintragen, Warnung bei Überschreitung', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  const right = page.locator('.panel.right');
  await left.getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();
  const p0 = await getProject(page);
  await place(page, 'Steckdose', nearWall(p0, 0, 0.3));

  // circuit in the project tab
  await right.locator('nav.tabs button', { hasText: 'Projekt' }).click();
  await right.getByRole('button', { name: '+ Stromkreis' }).click();
  await expect(right.getByTestId('circuit-item')).toHaveCount(1);
  await expect(right.getByTestId('circuit-disclaimer')).toContainText('keine fachliche Freigabe');
  await expect(right.getByTestId('circuit-summary')).toContainText('0 W von 3.680 W (0 %)');

  // socket → circuit, with a consumer
  const socketId = (await getProject(page)).fixtures[0].id;
  await page.evaluate((id) => {
    const wp = (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp;
    wp.useUiStore.getState().setSelection({ type: 'fixture', id });
  }, socketId);
  await right.locator('nav.tabs button', { hasText: 'Eigenschaften' }).click();
  const circuitId = (await getProject(page)).circuits[0].id;
  await right.getByTestId('socket-circuit').selectOption(circuitId);
  await right.getByLabel('Verbraucher hinzufügen').selectOption('Wasserkocher');
  await right.getByLabel('Verbraucher hinzufügen').selectOption('Toaster');
  const p1 = await getProject(page);
  expect(p1.fixtures[0].circuitId).toBe(circuitId);
  expect(p1.loads.map((l) => [l.name, l.watts])).toEqual([['Wasserkocher', 2000], ['Toaster', 900]]);

  await right.locator('nav.tabs button', { hasText: 'Projekt' }).click();
  await expect(right.getByTestId('circuit-summary')).toContainText('2.900 W von 3.680 W (79 %)');
  await expect(right.getByTestId('circuit-warning')).toHaveCount(0);

  // a third appliance pushes it over the limit
  await right.getByLabel('Verbraucher hinzufügen').first().selectOption('Mikrowelle');
  await expect(right.getByTestId('circuit-warning')).toBeVisible();
  await expect(right.getByTestId('circuit-item')).toHaveAttribute('data-status', 'over');
  expect(errors).toEqual([]);
});
