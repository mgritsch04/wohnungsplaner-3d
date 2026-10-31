/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test } from '@playwright/test';
import { createFurnitureFromCatalog } from '../src/catalog/instantiate';
import { findCatalogItem } from '../src/catalog/generic';
import { getProject, planToScreen } from './fixtures';

test('dragging furniture snaps to a neighbour and shows a guide line and clearances', async ({ page }) => {
  await page.goto('/?e2e');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const item = findCatalogItem('generic-tv-sideboard')!;
  const a = createFurnitureFromCatalog(item, { x: 2.5, y: 1.5 });
  const b = createFurnitureFromCatalog(item, { x: 1.5, y: 2.6 });
  await page.evaluate((items) => (window as any).__wp.useProjectStore.getState().apply((d: any) => void (d.furniture = items)), [a, b]);
  await page.waitForTimeout(500);
  const start = await planToScreen(page, b.x, b.y);
  // end 3 cm off the neighbour's left edge (x) and 3 cm below its top edge (y), but clear of it
  const gx = a.x + 0.03;
  const gy = a.y + a.depth + 0.5 + 0.03;
  const goal = await planToScreen(page, gx, gy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(goal.x, goal.y, { steps: 8 });
  await page.screenshot({ path: 'test-results/furniture-snap.png' });
  await expect(page.getByTestId('furniture-guide').first()).toBeAttached();
  await page.screenshot({ path: 'test-results/furniture-snap.png' });
  await page.mouse.up();
  const mb = (await getProject(page)).furniture.find((f: any) => f.id === b.id);
  expect(mb.x).toBeCloseTo(a.x, 2); // centres lined up
});
