import { expect, test } from '@playwright/test';
import { getProject } from './fixtures';
import { createEmptyProject } from '../src/model/factory';
import { addOpening, addRectRoom, closestWall } from '../src/model/operations';
import { rectPoints } from '../src/model/zones';
import type { Project } from '../src/model/schema';

/**
 * Einrichtungsvorschlag in an open kitchen/living room with an area marked „Küche“: Claude plans
 * the kitchen in two rows (sink row and cooking row). Both rows must stand in the marked area –
 * not the cooking row at the far wall of the living part (looked like a second kitchen).
 * Synthetic flat, Claude is replaced by a fixed answer.
 */
function flat(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 8, depth: 3.6, name: 'Küche / Wohnzimmer', thickness: 0.12, height: 2.6 });
  const east = closestWall(p, { x: 8.06, y: 1.8 }, 0.2);
  if (east) addOpening(p, east.wall.id, 'door', east.s);
  const north = closestWall(p, { x: 1.5, y: -0.06 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

test('Küche nur im markierten Bereich, keine zweite Küchenzeile im Wohnbereich', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown };
    const kitchen = {
      fronts: 'weiß matt',
      frontColor: '#ffffff',
      reason: 'zweizeilig',
      runs: [
        [{ catalogId: 'generic-k-fridge' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-dishwasher' }],
        [
          { catalogId: 'generic-k-oven', above: [{ catalogId: 'generic-k-cooktop' }, { catalogId: 'generic-k-hood-60' }] },
          { catalogId: 'generic-k-base-60', above: [{ catalogId: 'generic-k-wall-60' }] },
        ],
      ],
    };
    const sample = {
      json: async (input: string) => {
        const m = /(R\d+) „/.exec(input);
        return { summary: 'Offene Wohnküche.', rooms: m ? [{ room: m[1], type: 'kitchen', concept: 'Küche im Küchenbereich.', items: [{ catalogId: 'generic-sofa-3', quantity: 1, reason: 'Sofa' }], kitchen }] : [] };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  const plan = flat();
  const zone = { id: 'zk', purpose: 'Küche', points: rectPoints({ x: 0, y: 0 }, { x: 3, y: 3.6 }) };
  await page.evaluate(
    ({ src, zone }) => {
      const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Record<string, unknown>) => void) => void } } } }).__wp;
      wp.useProjectStore.getState().apply((d) => {
        for (const k of ['nodes', 'walls', 'openings', 'rooms']) d[k] = (src as Record<string, unknown>)[k];
        d.furniture = [];
        d.groups = [];
        d.zones = [zone];
      });
    },
    { src: plan as unknown as Record<string, unknown>, zone },
  );

  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await panel.getByLabel('Verfahren').selectOption('liste');
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
  await expect(panel.getByTestId('design-proposal')).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => ((await getProject(page)) as Project).furniture.filter((f) => f.kitchen).length).toBeGreaterThan(4);

  const p = (await getProject(page)) as Project;
  const kitchen = p.furniture.filter((f) => f.kitchen);
  // the whole kitchen (both rows, hob and wall cabinets included) stands in the marked area
  for (const f of kitchen) expect(f.x, f.name).toBeLessThan(3.3);
  expect(kitchen.some((f) => f.kitchen?.type === 'cooktop')).toBe(true);
  expect(kitchen.some((f) => f.kitchen?.type === 'sink')).toBe(true);

  const setView = (viewMode: string) => page.evaluate((v) => (window as unknown as { __wp: { useUiStore: { setState: (s: object) => void } } }).__wp.useUiStore.setState({ viewMode: v }), viewMode);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setView('2d');
  await page.getByRole('button', { name: /alles zeigen/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByTestId('editor2d').screenshot({ path: 'test-results/kitchen-zone-plan.png' });
  expect(errors).toEqual([]);
});
