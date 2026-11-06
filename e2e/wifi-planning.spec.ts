import { expect, test, type Page } from '@playwright/test';
import { getProject as rawProject, planToScreen } from './fixtures';
import type { Project } from '../src/model/schema';
import { createEmptyProject } from '../src/model/factory';
import { addRectRoom } from '../src/model/operations';

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

/** A long flat (four rooms in a row, solid walls) where one router does not reach everywhere. */
async function loadLongFlat(page: Page) {
  const p = createEmptyProject();
  p.name = 'WLAN-Test';
  const t = 0.25;
  let x = 0;
  for (const [name, w] of [['Wohnzimmer', 5], ['Gang', 3], ['Arbeitszimmer', 4], ['Schlafzimmer', 4]] as const) {
    addRectRoom(p, { x, y: 0, width: w, depth: 4, name, thickness: t, height: 2.6 });
    x += w + t;
  }
  await page.evaluate((proj) => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { load: (p: unknown) => void } }; useUiStore: { getState: () => { setView2d: (v: unknown) => void } } } }).__wp;
    wp.useProjectStore.getState().load(proj);
    wp.useUiStore.getState().setView2d({ cx: 8.4, cy: 2, zoom: 52 });
  }, p);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(300);
}

/** Centre of a room (mean of its corner nodes, plan metres). */
async function roomCentre(page: Page, name: string) {
  const p = await getProject(page);
  const room = p.rooms.find((r) => r.name === name)!;
  const pts = room.nodeIds.map((id) => p.nodes.find((n) => n.id === id)!);
  return { x: pts.reduce((t, n) => t + n.x, 0) / pts.length, y: pts.reduce((t, n) => t + n.y, 0) / pts.length };
}

test('WLAN-Planung (#492): Router, eigene Geräte, Nachbar-WLAN mit Kanal-Rat, Repeater-/Mesh-Vorschlag übernehmen, Wert unter der Maus, bleibt nach Reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  await loadLongFlat(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  await panel.getByLabel('Abdeckung im Plan anzeigen').check();
  await expect(panel.getByText('Noch kein Router')).toBeVisible();

  // router: click "Router setzen", then into the living room (west end)
  const rooms = (await getProject(page)).rooms.map((r) => r.name);
  const living = 'Wohnzimmer';
  await panel.locator('[data-testid="wifi-place"][data-role="router"]').click();
  const c = await roomCentre(page, living);
  let s = await planToScreen(page, c.x - 1, c.y);
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await getProject(page)).devices.filter((d) => d.kind === 'router').length).toBe(1);
  await expect(page.getByTestId('wifi-overlay')).toHaveAttribute('data-mode', 'rate');
  await expect(panel.getByTestId('wifi-room')).toHaveCount(rooms.length);
  const mbps = async (room: string) => Number(await panel.locator(`[data-testid="wifi-room"][data-room="${room}"]`).getAttribute('data-mbps'));
  const values = await Promise.all(rooms.map(mbps));
  expect(await mbps(living)).toBeGreaterThan(100);
  const weakest = rooms[values.indexOf(Math.min(...values))];
  expect(weakest).toBe('Schlafzimmer');
  await page.screenshot({ path: 'test-results/wifi-492-router-only.png' });

  // own device: a PC that needs a lot, in the weakest room
  await panel.locator('label.field', { has: page.locator('span.field-label', { hasText: /^Gerät$/ }) }).locator('select').selectOption('pc');
  await panel.getByTestId('wifi-client-place').click();
  const w = await roomCentre(page, weakest);
  s = await planToScreen(page, w.x, w.y);
  await page.mouse.click(s.x, s.y);
  await expect(panel.getByTestId('wifi-client')).toHaveCount(1);
  await expect(page.getByTestId('wifi-client-2d')).toHaveCount(1);
  const client = panel.getByTestId('wifi-client').first();
  await expect(client).toHaveAttribute('data-ok', 'false');
  await expect(client.getByTestId('wifi-client-advice')).toContainText('LAN-Kabel');

  // neighbour network on channel 6, measured strong; the router fixed on channel 6 gets advice
  await panel.getByTestId('wifi-neighbor-add').click();
  await expect(panel.getByTestId('wifi-neighbor-placing')).toBeVisible();
  s = await planToScreen(page, c.x, -0.9);
  await page.mouse.click(s.x, s.y);
  await expect(page.getByTestId('wifi-neighbor-2d')).toHaveCount(1);
  const nb = panel.getByTestId('wifi-neighbor').first();
  await nb.getByTestId('wifi-neighbor-edit').click();
  await nb.getByLabel('Nutzung').selectOption('high');
  const measured = nb.getByLabel('Gemessen (dBm, 0 = keine Messung)');
  await measured.fill('-50');
  await measured.press('Enter');
  await expect.poll(async () => (await getProject(page)).wifiNeighbors[0]?.measuredDbm).toBe(-50);
  await expect(panel.locator('[data-testid="wifi-channel"][data-band="2.4"]')).toContainText('Automatisch');
  await panel.locator('[data-testid="wifi-ap"] button').first().click();
  const fields = page.getByTestId('wifi-ap-fields');
  await expect(fields).toBeVisible();
  await fields.getByLabel('Kanal 2,4 GHz').selectOption('6');
  await expect(panel.locator('[data-testid="wifi-channel"][data-band="2.4"]')).toHaveAttribute('data-better', 'true');
  await expect(panel.locator('[data-testid="wifi-channel"][data-band="2.4"]')).toContainText('Besser Kanal');
  await panel.getByLabel('Ansicht').selectOption('interference');
  await expect(page.getByTestId('wifi-overlay')).toHaveAttribute('data-mode', 'interference');
  await page.screenshot({ path: 'test-results/wifi-492-interference.png' });
  await panel.getByLabel('Ansicht').selectOption('rate');

  // suggestion: where should a mesh node go? take it over
  await panel.getByTestId('wifi-suggest').click();
  const item = panel.getByTestId('wifi-suggest-item').first();
  await expect(item).toBeVisible();
  await expect(page.getByTestId('wifi-suggest-2d').first()).toBeVisible();
  const before = Number(await item.getAttribute('data-before'));
  const after = Number(await item.getAttribute('data-after'));
  expect(after).toBeGreaterThan(before);
  await page.screenshot({ path: 'test-results/wifi-492-suggest.png' });
  await item.getByTestId('wifi-suggest-apply').click();
  await expect.poll(async () => (await getProject(page)).devices.filter((d) => d.kind === 'router').length).toBe(2);
  expect((await getProject(page)).devices.find((d) => d.wifi?.role === 'mesh')).toBeTruthy();
  await expect(page.getByTestId('wifi-link')).toHaveCount(1);
  await expect(panel.getByTestId('wifi-link-text')).toHaveCount(1);
  expect(await mbps(weakest)).toBeGreaterThan(Math.min(...values));

  // value under the mouse
  s = await planToScreen(page, w.x + 0.3, w.y + 0.3);
  await page.mouse.move(s.x, s.y);
  await expect(page.getByTestId('wifi-hover')).toContainText('dBm');
  await page.screenshot({ path: 'test-results/wifi-492-rate.png' });

  // survives reload
  await page.waitForTimeout(800);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).name).toBe('WLAN-Test');
  const p = await getProject(page);
  expect(p.wifiNeighbors).toHaveLength(1);
  expect(p.wifiClients).toHaveLength(1);
  expect(p.devices.find((d) => d.kind === 'router' && d.wifi?.ch24 === 6)).toBeTruthy();
  expect(errors).toEqual([]);
});
