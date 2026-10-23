import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';

/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
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

/** Stand-in for the Claude runtime: moves the first piece of furniture 20 cm and names a piece that does not exist. */
async function fakeClaude(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        const m = /^(M\d+): .*Mitte x=(-?[\d.]+) y=(-?[\d.]+) m, gedreht (\d+)°/m.exec(input)!;
        return {
          summary: 'Der Plan ist gut, zwei Kleinigkeiten.',
          suggestions: [
            { title: 'Möbel leicht versetzen', reason: 'Etwas mehr Luft.', moves: [{ item: m[1], x: Number(m[2]) + 0.2, y: Number(m[3]), rotation: Number(m[4]) }] },
            { title: 'Erfundenes Möbel', reason: 'gibt es nicht', moves: [{ item: 'M99', x: 1, y: 1 }] },
            { title: 'Anderes Möbel drehen', reason: 'Bessere Blickrichtung.', moves: [{ item: m[1], x: Number(m[2]), y: Number(m[3]), rotation: (Number(m[4]) + 90) % 360 }] },
          ],
        };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
}

test('Raumkritik mit Claude (#365): Vorschläge, Vorschau, Übernehmen mit einem Undo, Verwerfen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page);
  await freshStart(page);
  await page.locator('aside.panel.left nav.tabs button', { hasText: 'Check' }).click();

  await page.getByTestId('critique-ask').click();
  await expect(page.getByTestId('critique-result')).toBeVisible();
  const prompt = await page.evaluate(() => (window as any).__prompts[0] as string);
  expect(prompt).toContain('Wohnungs-Checks');
  await expect(page.getByTestId('critique-suggestion').first()).toContainText('Möbel leicht versetzen');
  await expect(page.getByTestId('critique-result')).not.toContainText('Erfundenes Möbel');

  const before = await getProject(page);
  const first = page.getByTestId('critique-suggestion').first();

  // Vorschau ändert den Plan nicht
  await first.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await expect(page.getByTestId('furnish-preview')).toBeVisible();
  expect(await getProject(page)).toEqual(before);

  // Übernehmen = ein Undo-Schritt
  await first.getByRole('button', { name: 'Übernehmen' }).click();
  const after = await getProject(page);
  expect(after.furniture.some((f: any, i: number) => Math.abs(f.x - before.furniture[i].x) > 0.15)).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await getProject(page)).toEqual(before);

  // Verwerfen lässt den Plan unverändert
  await page.getByTestId('critique-ask').click();
  await expect(page.getByTestId('critique-suggestion').first()).toBeVisible();
  await page.getByTestId('critique-suggestion').first().getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('critique-suggestion')).toHaveCount(0);
  expect(await getProject(page)).toEqual(before);
  expect(errors).toEqual([]);
});
