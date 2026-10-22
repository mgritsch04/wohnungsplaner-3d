import { expect, test, type Page } from '@playwright/test';
import { getProject as rawProject } from './fixtures';
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

/** Ids of the other storeys drawn in the 3D scene. */
const levelsIn3d = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as unknown as { __wp: { three?: { scene: { traverse: (f: (o: { userData: Record<string, unknown> }) => void) => void } } } }).__wp.three?.scene;
    const ids: string[] = [];
    scene?.traverse((o) => typeof o.userData.levelId === 'string' && ids.push(o.userData.levelId));
    return ids;
  });

test('Etagen (#54): anlegen, benennen, wechseln in 2D und 3D, bleibt nach Neuladen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const start = await getProject(page);
  expect(start.levels).toHaveLength(1);
  await expect(page.getByTestId('level-bar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  await page.getByTestId('add-level-above').click();
  let p = await getProject(page);
  expect(p.levels).toHaveLength(2);
  const upper = p.levels.find((l) => l.id !== start.activeLevelId)!;
  expect(p.activeLevelId).toBe(upper.id);
  // the outline is taken over, the furniture stays downstairs
  expect(p.walls).toHaveLength(start.walls.length);
  expect(p.furniture).toHaveLength(0);
  expect(upper.elevation).toBeCloseTo(2.6);

  const bar = page.getByTestId('level-bar');
  await expect(bar.getByRole('button')).toHaveText(['1. Obergeschoss', 'Erdgeschoss']);
  await expect(bar.getByRole('button', { name: '1. Obergeschoss' })).toHaveAttribute('aria-pressed', 'true');
  // the storey below shows as a faint outline in the plan
  await expect(page.getByTestId('lower-level')).toBeVisible();

  // rename the current storey
  const row = page.locator(`[data-testid="level-row"][data-level-id="${upper.id}"]`);
  const name = row.getByLabel(/^Name/);
  await name.fill('Obergeschoss');
  await name.press('Enter');
  await expect(bar.getByRole('button', { name: 'Obergeschoss' })).toBeVisible();

  // 3D: the ground floor is drawn below the active storey
  await expect.poll(() => levelsIn3d(page)).toContain(start.activeLevelId);

  // Bild ab = storey below; the ground floor with its furniture is back
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('PageDown');
  await expect(bar.getByRole('button', { name: 'Erdgeschoss' })).toHaveAttribute('aria-pressed', 'true');
  p = await getProject(page);
  expect(p.activeLevelId).toBe(start.activeLevelId);
  expect(p.furniture).toHaveLength(start.furniture.length);
  await expect(page.getByTestId('lower-level')).toHaveCount(0);
  // "darunter" shows nothing from the ground floor, "alle" the storey above
  await expect.poll(() => levelsIn3d(page)).toEqual([]);
  await page.getByTestId('other-levels').selectOption('all');
  await expect.poll(() => levelsIn3d(page)).toContain(upper.id);

  // switch with the button and reload: storeys and the active one are kept
  await bar.getByRole('button', { name: 'Obergeschoss' }).click();
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByTestId('level-bar')).toBeVisible();
  p = await getProject(page);
  expect(p.levels.map((l) => l.name)).toEqual(['Erdgeschoss', 'Obergeschoss']);
  expect(p.activeLevelId).toBe(upper.id);
  expect(p.levels.find((l) => l.id === start.activeLevelId)?.plan?.furniture).toHaveLength(start.furniture.length);
  expect(errors).toEqual([]);
});
