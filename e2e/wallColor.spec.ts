import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../src/model/schema';
import { getProject as rawProject } from './fixtures';

const getProject = async (page: Page) => (await rawProject(page)) as Project;

test('Wandfarbe pro Raum (#462): eigene Farbe wählen, im Plan gespeichert, ein Undo-Schritt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await page.waitForTimeout(500);
  const room = (await getProject(page)).rooms[0];
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'room', id }), room.id);

  const panel = page.locator('.panel.right');
  await panel.getByLabel('Wandfarbe wählen').fill('#7aa0c4');
  await panel.getByTestId('wall-color-apply').click();
  await expect.poll(async () => {
    const p = await getProject(page);
    const id = p.rooms.find((r) => r.id === room.id)?.wallMaterialId;
    return p.materials.find((m) => m.id === id)?.color;
  }).toBe('#7aa0c4');
  await page.screenshot({ path: 'test-results/wallcolor.png' });

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).rooms.find((r) => r.id === room.id)?.wallMaterialId).toBeUndefined();
  expect(errors).toEqual([]);
});
