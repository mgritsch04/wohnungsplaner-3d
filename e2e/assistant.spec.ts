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

/** Synthetic IKEA/Möbelix products (no real product data) for #350. */
const DESIGN_PRODUCTS = [
  { id: 'e2e-ik-sofa', name: 'TESTSOFA 3er', category: 'sofa', width: 2, depth: 0.9, height: 0.8, model: { type: 'procedural', shape: 'sofa' }, retailer: 'IKEA Österreich', productUrl: 'https://www.ikea.com/at/de/p/testsofa-e2e/', price: { amount: 499, currency: 'EUR', status: 'confirmed' } },
  { id: 'e2e-mx-shelf', name: 'TESTREGAL Möbelix', category: 'storage', width: 0.8, depth: 0.4, height: 1.8, model: { type: 'procedural', shape: 'shelf' }, retailer: 'Möbelix Österreich', productUrl: 'https://www.moebelix.at/p/testregal-e2e', price: { amount: 89.9, currency: 'EUR', status: 'confirmed' } },
].map((p) => ({ color: '#bbbbbb', approximate: true, solid: true, tags: [], source: 'imported', sourceName: 'e2e', ...p }));

test('Einrichtungsvorschlag mit Claude (#350): echte Produkte, Gesamtpreis, Vorschau, Übernehmen, Undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        await new Promise((r) => setTimeout(r, 50));
        return {
          summary: 'Gemütliches Wohnzimmer mit viel Stauraum.',
          items: [
            { catalogId: 'e2e-ik-sofa', quantity: 1, reason: 'Großes Sofa für Gaming-Abende.' },
            { catalogId: 'e2e-mx-shelf', quantity: 1, reason: 'Platz für Bücher.' },
            { catalogId: 'erfunden-999', quantity: 1, reason: 'Gibt es nicht.' },
          ],
        };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await expect(panel.getByTestId('design-no-products')).toBeVisible();

  await page.evaluate(async (items) => {
    const wp = (window as unknown as { __wp: { useCatalogStore: { getState: () => { addItems: (i: unknown[]) => Promise<number> } } } }).__wp;
    await wp.useCatalogStore.getState().addItems(items);
  }, DESIGN_PRODUCTS);
  await expect(panel.getByTestId('design-no-products')).toHaveCount(0);

  const before = (await getProject(page)).furniture.length;
  await panel.getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
  await panel.getByLabel('Interessen / Hobbys').fill('Gaming, Lesen');
  await panel.getByLabel('Was du brauchst').fill('Stauraum');
  await panel.getByLabel('Was du dir wünschst').fill('großes Sofa');
  await panel.getByLabel('Stil').fill('gemütlich');
  await expect(panel).toContainText('2 Produkte aus deiner Auswahl');
  await panel.getByRole('button', { name: 'Vorschlag erstellen' }).click();

  const proposal = panel.getByTestId('design-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Vorschlag von Claude');
  await expect(panel.getByTestId('design-pick')).toHaveCount(2);
  await expect(proposal).toContainText('TESTSOFA 3er');
  await expect(proposal).toContainText('IKEA, 200×90×80 cm');
  await expect(proposal).toContainText('Großes Sofa für Gaming-Abende.');
  await expect(proposal.getByRole('link', { name: 'Produktseite' }).nth(1)).toHaveAttribute('href', 'https://www.moebelix.at/p/testregal-e2e');
  await expect(panel.getByTestId('design-total')).toHaveText(/588,90/);
  await expect(proposal).toContainText('nicht in deiner Auswahl – weggelassen');

  const prompt = (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts))[0];
  expect(prompt).toContain('Interessen/Hobbys: Gaming, Lesen');
  expect(prompt).toContain('e2e-mx-shelf: TESTREGAL Möbelix (Möbelix)');
  expect(prompt).not.toContain('Beispielwohnung');
  expect(prompt).not.toContain('https://');

  await panel.getByRole('button', { name: 'Vorschau im Raum' }).click();
  await expect(page.getByTestId('furnish-preview')).toBeVisible();
  await expect(panel.getByTestId('design-preview')).toContainText('noch nicht übernommen');
  await expect(left.getByTestId('furnish-result')).toHaveCount(0);
  expect((await getProject(page)).furniture.length).toBe(before);
  await page.screenshot({ path: 'test-results/design-350-preview.png' });

  await panel.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('furnish-preview')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Vorschau im Raum' }).click();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before + 2);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  const added = p.furniture.slice(before);
  expect(added.map((f) => f.catalogId).sort()).toEqual(['e2e-ik-sofa', 'e2e-mx-shelf']);
  expect(added.find((f) => f.catalogId === 'e2e-mx-shelf')?.productUrl).toBe('https://www.moebelix.at/p/testregal-e2e');
  for (const f of added) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);

  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before);
  expect(errors).toEqual([]);
});
