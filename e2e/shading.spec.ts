import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../src/model/schema';
import { getProject as rawProject } from './fixtures';

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

test('Fensterbehang (#413): Rollladen wählen, schließen, 2D-Symbol, Antrieb-Gerät', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const win = (await getProject(page)).openings.find((o) => o.kind === 'window')!;
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'opening', id }), win.id);

  const panel = page.locator('.panel.right');
  await panel.locator('select', { has: page.locator('option', { hasText: 'Rollladen' }) }).selectOption({ label: 'Rollladen' });
  await expect.poll(async () => (await getProject(page)).openings.find((o) => o.id === win.id)?.shading?.type).toBe('roller');
  await panel.getByTestId('shading-closed').fill('100');
  await expect.poll(async () => (await getProject(page)).openings.find((o) => o.id === win.id)?.shading?.closed).toBe(1);
  await expect(panel.getByTestId('shading-closed-label')).toContainText('zu');
  await expect(page.getByTestId('shading-symbol').first()).toBeAttached();

  // smart-home drive for this window
  await page.evaluate((id) => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Project) => void) => void } } } }).__wp;
    wp.useProjectStore.getState().apply((d) => {
      d.devices.push({ id: 'dev_blind', name: 'Antrieb', kind: 'blind', openingId: id, x: 0, y: 0, elevation: 2.2, rotation: 0 });
    });
  }, win.id);
  expect((await getProject(page)).devices.some((d) => d.kind === 'blind')).toBe(true);
  expect(errors).toEqual([]);
});
