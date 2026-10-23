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
  await expect(left.getByRole('heading', { name: 'Einrichtungsvorschlag', exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});

test('Einrichtungsvorschlag mit Claude (#350): ohne Claude-Verbindung sichtbar mit Hinweis auf den Helfer', async ({ page }) => {
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel-unavailable');
  await expect(panel).toContainText('Einrichtungsvorschlag mit Claude');
  await expect(panel).toContainText('npm run ikea-helper');
  await page.screenshot({ path: 'test-results/design-unavailable.png' });
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

test('Einrichtungsvorschlag mit Claude (#350): ganze Wohnung, eigene Produkte + Platzhalter, Alternative tauschen, Übernehmen, Undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        await new Promise((r) => setTimeout(r, 50));
        const living = /(R\d+) „Wohnzimmer“/.exec(input)?.[1] ?? 'R1';
        const bed = /(R\d+) „Schlafzimmer“/.exec(input)?.[1] ?? 'R2';
        return {
          summary: 'Gemütlich und durchgängig hell, mit Platz für Gaming und Bücher.',
          rooms: [
            {
              room: living,
              type: 'living',
              concept: 'Gaming-Ecke und Leseplatz.',
              items: [
                { catalogId: 'e2e-mx-shelf', quantity: 1, reason: 'Platz für Bücher.' },
                { catalogId: 'generic-armchair', quantity: 1, reason: 'Zum Lesen.', label: 'Lesesessel aus Cord', search: 'Sessel Cord', alternatives: [{ catalogId: 'generic-floor-lamp', reason: 'Nur Licht statt Sessel.', label: 'Stehlampe Messing', search: 'Stehlampe Messing' }] },
                { catalogId: 'erfunden-999', quantity: 1, reason: 'Gibt es nicht.' },
              ],
            },
            { room: bed, type: 'bedroom', concept: 'Ruhig.', items: [{ catalogId: 'generic-plant', quantity: 1, reason: 'Grün.', label: 'Monstera groß', search: 'Monstera' }] },
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
  await expect(panel.getByTestId('design-own-count')).toContainText('Platzhaltern und Suchlinks');

  await page.evaluate(async (items) => {
    const wp = (window as unknown as { __wp: { useCatalogStore: { getState: () => { addItems: (i: unknown[]) => Promise<number> } } } }).__wp;
    await wp.useCatalogStore.getState().addItems(items);
  }, DESIGN_PRODUCTS);
  await expect(panel.getByTestId('design-own-count')).toContainText('2 eigene Produkte');

  const before = (await getProject(page)).furniture.length;
  await expect(panel.getByLabel('Umfang')).toHaveValue('__all');
  await panel.getByLabel('Interessen / Hobbys').fill('Gaming, Lesen');
  await panel.getByLabel('Was du brauchst').fill('Stauraum');
  await panel.getByLabel('Was du dir wünschst').fill('Pflanzen');
  await panel.getByLabel('Stil').fill('gemütlich');
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();

  const proposal = panel.getByTestId('design-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Vorschlag von Claude');
  await expect(panel.getByTestId('design-room')).toHaveCount(2);
  await expect(panel.getByTestId('design-pick')).toHaveCount(3);
  await expect(proposal).toContainText('TESTREGAL Möbelix');
  await expect(proposal).toContainText('Möbelix, 80×40×180 cm');
  await expect(proposal).toContainText('Lesesessel aus Cord');
  await expect(proposal.getByRole('link', { name: 'bei IKEA suchen' }).first()).toHaveAttribute('href', 'https://www.ikea.com/at/de/search/?q=Sessel%20Cord');
  await expect(proposal.getByRole('link', { name: 'Produktseite' })).toHaveAttribute('href', 'https://www.moebelix.at/p/testregal-e2e');
  await expect(panel.getByTestId('design-total')).toHaveText(/89,90/);
  await expect(proposal).toContainText('nicht in den Listen – weggelassen');

  // one request per room, run at the same time; each knows the other rooms and carries the same wishes
  const prompts = await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts);
  expect(prompts).toHaveLength(2);
  const prompt = prompts.find((q) => q.includes('„Wohnzimmer“'))!;
  expect(prompts.every((q) => q.includes('Stil: gemütlich'))).toBe(true);
  expect(prompt).toContain('Interessen/Hobbys: Gaming, Lesen');
  expect(prompt).toContain('Schlafzimmer (');
  expect(prompt).not.toContain('„Schlafzimmer“');
  expect(prompt).toContain('e2e-mx-shelf: TESTREGAL Möbelix (Möbelix)');
  expect(prompt).not.toContain('Beispielwohnung');
  expect(prompt).not.toContain('https://');

  // alternative instead of the armchair, and back
  await proposal.getByRole('button', { name: 'Alternativen (1)' }).click();
  await expect(proposal.getByTestId('design-alternatives')).toContainText('Stehlampe Messing');
  await proposal.getByRole('button', { name: 'Stattdessen nehmen' }).click();
  await expect(proposal).toContainText('Stehlampe Messing');
  await expect(proposal.getByTestId('design-alternatives')).toHaveCount(0);
  await proposal.getByRole('button', { name: 'Alternativen (1)' }).click();
  await proposal.getByRole('button', { name: 'Stattdessen nehmen' }).click();
  await expect(panel.getByTestId('design-pick').nth(1)).toContainText('Lesesessel aus Cord');

  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await expect(page.getByTestId('furnish-preview')).toBeVisible();
  await expect(panel.getByTestId('design-preview')).toContainText('noch nicht übernommen');
  await expect(left.getByTestId('furnish-result')).toHaveCount(0);
  expect((await getProject(page)).furniture.length).toBe(before);
  await page.screenshot({ path: 'test-results/design-350-preview.png' });

  await panel.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('furnish-preview')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before + 3);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  const added = p.furniture.slice(before);
  expect(added.map((f) => f.catalogId).sort()).toEqual(['e2e-mx-shelf', 'generic-armchair', 'generic-plant']);
  expect(added.find((f) => f.catalogId === 'e2e-mx-shelf')?.productUrl).toBe('https://www.moebelix.at/p/testregal-e2e');
  expect(added.find((f) => f.catalogId === 'generic-armchair')?.name).toBe('Lesesessel aus Cord (Platzhalter)');
  for (const f of added) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);

  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before);
  expect(errors).toEqual([]);
});

/** Claude desktop app nachgebildet: Entwurf mit Sessel + Monstera, Shop-Suche findet nur den Sessel. */
async function installDesktopMock(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __browser: string[] };
    w.__browser = [];
    type Tool = { name: string; execute: (input: unknown) => Promise<unknown> };
    const sample = {
      json: async (input: string, options?: { tools?: Tool[] }) => {
        await new Promise((r) => setTimeout(r, 30));
        if (options?.tools) await new Promise((r) => setTimeout(r, 2500));
        if (options?.tools && /Monstera/.test(input)) return { products: [] };
        if (options?.tools) {
          // product search: open the search page through the page function, then report what was "read"
          const open = options.tools.find((t) => t.name === 'open_page')!;
          await open.execute({ url: 'https://www.ikea.com/at/de/search/?q=Sessel%20Cord' });
          await open.execute({ url: 'https://example.com/fremd' }).catch(() => w.__browser.push('fremd abgelehnt'));
          return {
            products: [
              { name: 'TESTSESSEL Cord', url: 'https://www.ikea.com/at/de/p/testsessel-cord-00000001/', price: 149, width_cm: 78, depth_cm: 80, height_cm: 84, why: 'Weicher Cord, passt zum Stil.' },
              { name: 'TESTSESSEL Möbelix', url: 'https://www.moebelix.at/p/testsessel-e2e', price: 199, width_cm: 80, depth_cm: 82, height_cm: 90, why: 'Etwas breiter.' },
              { name: 'Erfunden', url: 'https://example.com/x', price: 1, width_cm: 50, depth_cm: 50, height_cm: 50 },
            ],
          };
        }
        const living = /(R\d+) „Wohnzimmer“/.exec(input)?.[1] ?? 'R1';
        return {
          summary: 'Gemütlich.',
          rooms: [
            {
              room: living,
              type: 'living',
              items: [
                { catalogId: 'generic-armchair', quantity: 1, reason: 'Zum Lesen.', label: 'Lesesessel aus Cord', search: 'Sessel Cord' },
                { catalogId: 'generic-plant', quantity: 1, reason: 'Grün.', label: 'Monstera groß', search: 'Monstera' },
              ],
            },
          ],
        };
      },
    };
    const mcp = {
      listTools: async () => ({ servers: [{ server: 'host:claude_browser', authStatus: 'connected', tools: [] }] }),
      callTool: async (_server: string, tool: string, input: { url?: string }) => {
        w.__browser.push(`${tool}${input?.url ? ` ${input.url}` : ''}`);
        return { content: [{ type: 'text', text: tool === 'get_page_text' ? 'TESTSESSEL Cord 149,– € …' : 'ok' }] };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : name === 'mcp' ? mcp : null) };
  });
}

test('Einrichtungsvorschlag mit Claude (#350): einstufig mit echten Produkten, Nachsuchen für Fallbacks (Browser der Desktop-App nachgebildet)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installDesktopMock(page);
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await panel.getByLabel('Umfang').selectOption({ label: 'Wohnzimmer' });
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
  const proposal = panel.getByTestId('design-proposal');
  // one step: the real product is found without a second click; the progress is shown meanwhile
  await expect(panel.getByTestId('design-search')).toContainText(/Suche .* 1\/2/);
  await expect(panel.getByRole('button', { name: 'Suche stoppen' })).toBeVisible();
  await page.screenshot({ path: 'test-results/design-350-progress.png' });
  const pick = panel.getByTestId('design-pick').first();
  await expect(pick).toContainText('TESTSESSEL Cord');
  await expect(pick).toHaveAttribute('data-placeholder', 'no');
  await expect(pick).toContainText('von Claude gefunden');
  await expect(pick).toContainText('IKEA, 78×80×84 cm');
  await expect(pick).toContainText('Weicher Cord, passt zum Stil.');
  await expect(pick.getByRole('link', { name: 'Produktseite' })).toHaveAttribute('href', 'https://www.ikea.com/at/de/p/testsessel-cord-00000001/');
  await pick.getByRole('button', { name: 'Alternativen (2)' }).click();
  await expect(pick.getByTestId('design-alternatives')).toContainText('TESTSESSEL Möbelix');
  await expect(pick.getByTestId('design-alternatives')).toContainText('Lesesessel aus Cord');
  await expect(proposal).not.toContainText('Erfunden');
  await expect(panel.getByTestId('design-total')).toHaveText(/149,00/);
  // fallback: the plant was not found – stays a marked placeholder with search link; "Nachsuchen" is offered
  const plant = panel.getByTestId('design-pick').nth(1);
  await expect(plant).toHaveAttribute('data-placeholder', 'yes');
  await expect(plant.getByTestId('design-notfound')).toBeVisible();
  await expect(plant.getByRole('link', { name: 'bei IKEA suchen' })).toBeVisible();
  await expect(proposal.getByRole('button', { name: 'Nachsuchen (1 Platzhalter)' })).toBeVisible();
  const browser = await page.evaluate(() => (window as unknown as { __browser: string[] }).__browser);
  expect(browser).toEqual(['navigate https://www.ikea.com/at/de/search/?q=Sessel%20Cord', 'get_page_text', 'fremd abgelehnt']);
  await page.screenshot({ path: 'test-results/design-350-found.png' });

  // the found product is in „Meine IKEA-Auswahl“ and is placed like any other
  const before = (await getProject(page)).furniture.length;
  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(before + 2);
  const added = ((await getProject(page)) as Project).furniture.slice(before).find((f) => f.name === 'TESTSESSEL Cord')!;
  expect(added).toMatchObject({ name: 'TESTSESSEL Cord', retailer: 'IKEA Österreich', productUrl: 'https://www.ikea.com/at/de/p/testsessel-cord-00000001/' });
  expect(errors).toEqual([]);
});


test('Einrichtungsvorschlag mit Claude (#350): Schalter „Erst Vorschlag, dann suchen“ – Einzelknopf und „Alle suchen“, Auswahl bleibt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installDesktopMock(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await panel.getByLabel('Umfang').selectOption({ label: 'Wohnzimmer' });
  await expect(panel.getByLabel('Ablauf')).toHaveValue('direct');
  await panel.getByLabel('Ablauf').selectOption('later');
  await expect(panel.getByTestId('design-mode-hint')).toContainText('zuerst den Vorschlag mit Platzhaltern');
  await page.screenshot({ path: 'test-results/design-350-mode-switch.png' });

  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
  const proposal = panel.getByTestId('design-proposal');
  await expect(proposal).toContainText('Lesesessel aus Cord');
  // no automatic search: both stay placeholders
  await expect(panel.getByTestId('design-pick').first()).toHaveAttribute('data-placeholder', 'yes');
  await expect(panel.getByTestId('design-pick').nth(1)).toHaveAttribute('data-placeholder', 'yes');
  expect(await page.evaluate(() => (window as unknown as { __browser: string[] }).__browser)).toEqual([]);

  // single piece
  await panel.getByTestId('design-pick').first().getByRole('button', { name: 'Echtes Produkt suchen' }).click();
  await expect(panel.getByTestId('design-pick').first()).toContainText('TESTSESSEL Cord');
  await expect(panel.getByTestId('design-pick').nth(1)).toHaveAttribute('data-placeholder', 'yes');
  // all remaining
  await proposal.getByRole('button', { name: 'Alle suchen (1 Platzhalter)' }).click();
  await expect(panel.getByTestId('design-notfound')).toBeVisible();
  await page.screenshot({ path: 'test-results/design-350-mode-later.png' });

  // the choice is remembered
  await page.reload();
  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  await expect(page.getByTestId('design-panel').getByLabel('Ablauf')).toHaveValue('later');
  expect(errors).toEqual([]);
});
