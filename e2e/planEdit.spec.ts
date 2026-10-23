import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';
import { derivePlan } from '../src/model/derived';
import { buildPlacementObstacles, issueLevel, placementIssues } from '../src/model/placement';
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
 * Stand-in for the Claude artifact runtime: moves the first piece of the living room to another
 * wall of the room, removes the second, adds an armchair and names one wish it cannot do.
 */
async function fakeClaude(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[]; __options: unknown[] };
    w.__prompts = [];
    w.__options = [];
    const sample = {
      json: async (input: string, options: unknown) => {
        w.__prompts.push(input);
        w.__options.push(options);
        await new Promise((r) => setTimeout(r, 50));
        const block = /R\d+ „Wohnzimmer“[\s\S]*?(?=\nR\d+ „|\n\n)/.exec(input)?.[0] ?? '';
        const room = /^(R\d+)/.exec(block)?.[1] ?? 'R1';
        const items = [...block.matchAll(/(M\d+): [^\n]*?steht an (W\d+)/g)];
        const walls = [...block.matchAll(/(W\d+) \(/g)].map((m) => m[1]);
        const [first, second] = items;
        const other = walls.find((x) => x !== first?.[2]) ?? 'W1';
        return {
          summary: 'Ich stelle das erste Möbel um, nehme eins raus und ergänze einen Sessel.',
          changes: [
            ...(first ? [{ op: 'move', item: first[1], wall: other, why: 'andere Wand gewünscht' }] : []),
            ...(second ? [{ op: 'remove', item: second[1], why: 'weniger voll' }] : []),
            { op: 'add', room, catalogId: 'generic-armchair', quantity: 1, why: 'Leseplatz' },
            { op: 'add', room, catalogId: 'erfunden-xyz', quantity: 1 },
          ],
          notPossible: ['Balkontür versetzen: Türen ändert die App nicht.'],
        };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
}

test('Plan per Textanweisung ändern (#415): Änderungen, Vorschau, verwerfen, übernehmen in einem Undo-Schritt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page);
  await freshStart(page);
  const before = (await getProject(page)) as Project;
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('plan-edit-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Bezug').selectOption({ label: 'Wohnzimmer' });
  await panel.getByLabel('Anweisung an Claude').fill('Stell das Sofa an die andere Wand und mach Platz für einen Sessel.');
  await panel.getByLabel('Qualität').selectOption('fast');
  await panel.getByRole('button', { name: 'Ändern lassen' }).click();

  const changes = panel.getByTestId('plan-edit-change');
  await expect(changes.first()).toBeVisible();
  const prompt = (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts))[0];
  expect(prompt).toContain('Anweisung: Stell das Sofa an die andere Wand');
  expect(prompt).toMatch(/W1 \((oben|unten|links|rechts)\)/);
  expect(prompt).not.toContain('Beispielwohnung');
  const options = (await page.evaluate(() => (window as unknown as { __options: { modelTier?: string }[] }).__options))[0];
  expect(options.modelTier).toBe('default');
  await expect(panel.getByTestId('plan-edit-not-possible')).toContainText('Balkontür versetzen');
  await expect(panel).toContainText('weggelassen');
  await expect(changes.filter({ hasText: '„Sessel“ hinzufügen' })).toContainText('✓');

  const preview = page.getByTestId('furnish-preview');
  await expect(preview).toBeVisible();
  await expect(left.getByTestId('furnish-result')).toHaveCount(0);
  expect((await getProject(page)).furniture).toEqual(before.furniture);
  await page.screenshot({ path: 'test-results/plan-edit-preview.png' });

  await panel.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(preview).toHaveCount(0);
  await panel.getByRole('button', { name: 'Ändern lassen' }).click();
  await expect(preview).toBeVisible();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(preview).toHaveCount(0);

  const after = (await getProject(page)) as Project;
  const ids = new Set(after.furniture.map((f) => f.id));
  const gone = before.furniture.filter((f) => !ids.has(f.id));
  const moved = after.furniture.filter((f) => {
    const o = before.furniture.find((x) => x.id === f.id);
    return o && (o.x !== f.x || o.y !== f.y);
  });
  expect(gone).toHaveLength(1);
  expect(moved).toHaveLength(1);
  expect(after.furniture.filter((f) => f.catalogId === 'generic-armchair').length).toBe(before.furniture.filter((f) => f.catalogId === 'generic-armchair').length + 1);
  // everything else unchanged
  const untouched = before.furniture.filter((f) => ids.has(f.id) && !moved.some((m) => m.id === f.id));
  for (const f of untouched) expect(after.furniture.find((x) => x.id === f.id)).toEqual(f);
  const d = derivePlan(after);
  const obstacles = buildPlacementObstacles(d);
  for (const f of [...moved, ...after.furniture.filter((x) => !before.furniture.some((o) => o.id === x.id))]) {
    expect(placementIssues(after, d, f, obstacles).filter((i) => issueLevel(i.kind) === 'error').map((i) => `${f.name}: ${i.message}`)).toEqual([]);
  }
  await page.screenshot({ path: 'test-results/plan-edit-taken.png' });

  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture).toEqual(before.furniture);
  expect(errors).toEqual([]);
});

test('Plan per Textanweisung ändern (#415): ohne Claude ausgeblendet', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.locator('.panel.left').getByRole('heading', { name: 'Einrichtungsvorschlag', exact: true })).toBeVisible();
  await expect(page.getByTestId('plan-edit-panel')).toHaveCount(0);
});
