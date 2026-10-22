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

type WpWindow = {
  __wp: {
    useProjectStore: { getState: () => { project: Project; apply: (fn: (d: Project) => void) => void } };
    three?: { camera: { position: { x: number; y: number; z: number } } };
  };
};

test('Treppen (#54): aus dem Katalog mit Geschosshöhe, hinauf- und hinuntergehen wechselt die Etage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const ground = (await getProject(page)).activeLevelId;
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  await page.getByTestId('add-level-above').click();
  const upper = (await getProject(page)).activeLevelId;
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await getProject(page)).activeLevelId).toBe(ground);

  // a stair from the catalog gets the storey height; it stands in the living room (rising to −y)
  await page.getByRole('button', { name: 'Katalog', exact: true }).click();
  await page.getByPlaceholder(/Suchen/).fill('Treppe');
  await page.getByText('Treppe gerade 90 cm').first().click();
  await expect.poll(async () => (await getProject(page)).furniture.filter((f) => f.category === 'stairs').length).toBeGreaterThanOrEqual(1);
  // keep only the stair, centred in the living room, so nothing blocks the walk
  await page.evaluate(() => {
    const s = (window as unknown as WpWindow).__wp.useProjectStore.getState();
    s.apply((d) => {
      const st = d.furniture.find((f) => f.category === 'stairs')!;
      st.x = 2.5;
      st.y = 1.85;
      st.rotation = 0;
      d.furniture = [st];
    });
  });
  const stair = (await getProject(page)).furniture[0];
  expect(stair.height).toBeCloseTo(2.6);
  expect(stair.solid).toBe(false);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  // the walk starts in the middle of the living room = a little below half the stair
  await expect.poll(() => page.evaluate(() => (window as unknown as WpWindow).__wp.three!.camera.position.y)).toBeGreaterThan(2.3);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await getProject(page)).activeLevelId, { timeout: 8000 }).toBe(upper);
  await page.keyboard.up('KeyW');
  // upstairs: the eyes are at normal height above the upper floor again
  await expect.poll(() => page.evaluate(() => (window as unknown as WpWindow).__wp.three!.camera.position.y)).toBeLessThan(2);
  await page.keyboard.down('KeyS');
  await expect.poll(async () => (await getProject(page)).activeLevelId, { timeout: 8000 }).toBe(ground);
  await page.keyboard.up('KeyS');
  expect(errors).toEqual([]);
});
