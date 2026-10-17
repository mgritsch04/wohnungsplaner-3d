import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';
import { derivePlan } from '../src/model/derived';
import { placementIssues } from '../src/model/placement';
import type { Project } from '../src/model/schema';

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

/**
 * Stand-in for the Claude artifact runtime (`window.claude.use('sample')`): answers with a
 * fixed suggestion list for the living room (key read from the plan summary in the prompt)
 * and keeps the prompts for checks.
 */
async function fakeClaude(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        await new Promise((r) => setTimeout(r, 50));
        const key = /(R\d+) „Wohnzimmer“/.exec(input)?.[1] ?? 'R1';
        return {
          suggestions: [
            { title: 'Leseecke am Fenster', detail: 'Ein Sessel mit Stehlampe schafft einen ruhigen Platz.', room: key, furniture: [{ catalogId: 'generic-armchair', quantity: 1 }, { catalogId: 'erfunden-xyz', quantity: 1 }] },
            { title: 'Wärmeres Licht', detail: 'Warmweiße Lampen am Abend.', room: null, furniture: [] },
          ],
        };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
}

test('Claude fragen (#151): ohne Artefakt-Laufzeit ausgeblendet', async ({ page }) => {
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  await expect(left.getByText('Einrichtungsvorschlag')).toBeVisible();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});

test('Claude fragen (#151): Vorschläge, Vorschau, verwerfen, übernehmen in einem Undo-Schritt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page);
  await freshStart(page);
  const before = (await getProject(page)).furniture.length;
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Bezug').selectOption({ label: 'Wohnzimmer' });
  await panel.getByLabel('Frage an Claude').fill('Wie wirkt das Wohnzimmer gemütlicher?');
  await panel.getByRole('button', { name: 'Fragen' }).click();

  const cards = panel.getByTestId('assistant-suggestion');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Leseecke am Fenster');
  await expect(cards.first()).toContainText('Möbel: Sessel');
  await expect(cards.first()).toContainText('nicht im Katalog – weggelassen');
  await expect(cards.nth(1).getByRole('button', { name: 'Vorschau' })).toHaveCount(0);

  const prompt = (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts))[0];
  expect(prompt).toContain('Frage: Wie wirkt das Wohnzimmer gemütlicher?');
  expect(prompt).toContain('„Wohnzimmer“');
  expect(prompt).not.toContain('Beispielwohnung');

  await cards.first().getByRole('button', { name: 'Vorschau' }).click();
  const preview = page.getByTestId('furnish-preview');
  await expect(preview).toBeVisible();
  await expect(panel.getByTestId('assistant-preview')).toContainText('noch nicht übernommen');
  // the rule-based panel below does not show a second „Übernehmen“ for the same preview
  await expect(left.getByTestId('furnish-result')).toHaveCount(0);
  expect((await getProject(page)).furniture.length).toBe(before);

  await panel.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(preview).toHaveCount(0);

  await cards.first().getByRole('button', { name: 'Vorschau' }).click();
  await expect(preview).toBeVisible();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before + 1);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  const added = p.furniture.slice(before);
  expect(added.map((f) => f.catalogId)).toEqual(['generic-armchair']);
  for (const f of added) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);

  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before);
  expect(errors).toEqual([]);
});
