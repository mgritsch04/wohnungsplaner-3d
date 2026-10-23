import { expect, test, type Page } from '@playwright/test';
import { getProject } from './fixtures';
import { createEmptyProject } from '../src/model/factory';
import { addOpening, addRectRoom, closestWall } from '../src/model/operations';
import { derivePlan } from '../src/model/derived';
import { placementIssues } from '../src/model/placement';
import type { Project } from '../src/model/schema';

/**
 * Einrichtungsvorschlag (#350) for every room type: a synthetic flat (no real apartment) with
 * living room, bedroom, bath, kitchen, hall, storeroom and balcony; Claude is replaced by fixed
 * answers per room. Checks guide, planner check, placement and „replace instead of add again“.
 */
function flat(): Project {
  const p = createEmptyProject();
  const T = 0.12;
  const rooms: [string, number, number, number, number, boolean][] = [
    ['Wohnzimmer', 0, 0, 5, 4, true],
    ['Schlafzimmer', 5.5, 0, 4, 3.5, true],
    ['Bad', 10, 0, 2.6, 2.4, false],
    ['Küche', 0, 4.6, 3.5, 3, true],
    ['Gang', 4, 4.6, 4.5, 1.6, false],
    ['Abstellraum', 9, 4.6, 2.2, 1.8, false],
    ['Balkon', 11.7, 4.6, 3.2, 1.6, true],
  ];
  for (const [name, x, y, w, d, window] of rooms) {
    addRectRoom(p, { x, y, width: w, depth: d, name, thickness: T, height: 2.6 });
    const south = closestWall(p, { x: x + 0.7, y: y + d + T / 2 }, 0.1);
    if (south) addOpening(p, south.wall.id, 'door', south.s);
    const north = window ? closestWall(p, { x: x + w / 2, y: y - T / 2 }, 0.1) : null;
    if (north) addOpening(p, north.wall.id, 'window', north.s);
  }
  return p;
}

async function fakeDesigner(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    // placeholder colours from the apartment palette (Runde 2): warm, matching tones instead of the catalogue defaults
    const COLORS: Record<string, string> = { 'generic-sofa-3': '#9caf88', 'generic-armchair': '#d4a94a', 'generic-rug-200': '#d8c3a5', 'generic-tv-sideboard': '#d8bf98', 'generic-coffee-table': '#d8bf98', 'generic-bed-160': '#efe6d6', 'generic-wardrobe-150': '#f4f1ea', 'generic-nightstand': '#d8bf98' };
    const it = (catalogId: string, quantity = 1) => ({ catalogId, quantity, reason: 'passt zum Konzept', ...(COLORS[catalogId] ? { color: COLORS[catalogId] } : {}) });
    const brief = (purpose: string, focus: string) => ({ purpose, zones: ['Hauptzone'], focus, paths: 'Tür bis Fenster frei', palette: ['Sand', 'Salbei'], decor: 'Bild, Pflanze' });
    const answers: Record<string, unknown> = {
      Wohnzimmer: { type: 'living', brief: brief('Entspannen und Gäste', 'großes Bild über dem Sofa'), items: [it('generic-sofa-3'), it('generic-coffee-table'), it('generic-rug-200'), it('generic-tv-sideboard'), it('generic-tv'), it('generic-armchair'), it('generic-floor-lamp'), it('generic-picture-large')] },
      Schlafzimmer: { type: 'bedroom', brief: brief('Schlafen', 'Bett mit Bild darüber'), items: [it('generic-bed-160'), it('generic-nightstand', 2), it('generic-table-lamp', 2), it('generic-wardrobe-150'), it('generic-picture'), it('generic-curtain')] },
      // no washing machine on purpose: the planner adds it
      Bad: { type: 'bath', brief: brief('Bad', 'Spiegel über dem Waschbecken'), items: [it('generic-toilet'), it('generic-washbasin'), it('generic-bath-mirror'), it('generic-shower')] },
      Gang: { type: 'hall', brief: brief('Ankommen', 'Spiegel'), items: [it('generic-shoe-cabinet'), it('generic-coat-rack'), it('generic-mirror'), it('generic-picture')] },
      Abstellraum: { type: 'utility', brief: brief('Stauraum', 'Regale'), items: [it('generic-utility-shelf', 2), it('generic-broom-cabinet'), it('generic-vacuum'), it('generic-storage-box', 4)] },
      Balkon: { type: 'balcony', brief: brief('Draußen sitzen', 'Pflanzen'), items: [it('generic-balcony-table'), it('generic-balcony-chair', 2), it('generic-planter', 2)] },
      Küche: {
        type: 'kitchen',
        brief: brief('Kochen', 'Küchenzeile'),
        items: [],
        kitchen: { fronts: 'weiß matt', frontColor: '#ffffff', reason: 'hell', runs: [[{ catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-dishwasher' }, { catalogId: 'generic-k-oven', above: [{ catalogId: 'generic-k-cooktop' }] }, { catalogId: 'generic-k-base-60' }]] },
      },
    };
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        await new Promise((r) => setTimeout(r, 30));
        const m = /(R\d+) „([^“]+)“/.exec(input);
        const a = m ? (answers[m[2]] as object) : null;
        return { summary: 'Ruhig, hell, warme Naturtöne.', rooms: a ? [{ room: m![1], concept: `${m![2]} mit klarem Konzept.`, ...a }] : [] };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
}

test('Einrichtungsvorschlag (#350): jeder Raumtyp mit Leitfaden, Planer-Prüfung, kollisionsfrei; zweite Vorschau ersetzt die erste', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeDesigner(page);
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  const plan = flat();
  await page.evaluate((src) => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Record<string, unknown>) => void) => void } } } }).__wp;
    wp.useProjectStore.getState().apply((d) => {
      for (const k of ['nodes', 'walls', 'openings', 'rooms']) d[k] = (src as Record<string, unknown>)[k];
      d.furniture = [];
      d.groups = [];
    });
  }, plan as unknown as Record<string, unknown>);

  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
  const proposal = panel.getByTestId('design-proposal');
  await expect(proposal).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('design-room')).toHaveCount(7);
  await expect(panel.getByTestId('design-brief')).toHaveCount(7);
  await expect(proposal.getByText('nachgeprüft')).toHaveCount(7);
  // two rounds per room (draft + check with the placement report)
  const prompts = await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts);
  expect(prompts).toHaveLength(14);
  expect(prompts.filter((q) => q.includes('Zweite Runde'))).toHaveLength(7);
  const bath = panel.getByTestId('design-room').filter({ hasText: 'Bad' }).first();
  await expect(bath.getByTestId('design-fixes')).toContainText('Waschmaschine');
  await proposal.screenshot({ path: 'test-results/design-350-rooms-proposal.png' });

  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await expect(panel.getByTestId('design-preview')).toContainText('noch nicht übernommen');
  const missing = await panel.getByTestId('design-missing').allInnerTexts();
  expect(missing).toEqual([]);
  await page.screenshot({ path: 'test-results/design-350-rooms-2d.png' });
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBeGreaterThan(30);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  for (const f of p.furniture) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
  expect(p.furniture.every((f) => f.suggested)).toBe(true);
  const count = p.furniture.length;
  const has = (id: string) => p.furniture.filter((f) => f.catalogId === id);
  expect(has('generic-washer')).toHaveLength(1);
  expect(has('generic-bath-mirror')[0].elevation).toBeGreaterThan(1);
  expect(has('generic-storage-box').every((b) => b.elevation > 0.05)).toBe(true);
  expect(has('generic-balcony-chair')).toHaveLength(2);
  expect(has('generic-picture-large')[0].elevation).toBeGreaterThan(1);
  expect(has('generic-sofa-3')[0].color).toBe('#9caf88');

  // large plan and 3D view to look at the result room by room
  const setView = (viewMode: string) => page.evaluate((v) => (window as unknown as { __wp: { useUiStore: { setState: (s: object) => void } } }).__wp.useUiStore.setState({ viewMode: v }), viewMode);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 2200, height: 1300 });
  await setView('2d');
  await page.getByRole('button', { name: /alles zeigen/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByTestId('editor2d').screenshot({ path: 'test-results/design-350-rooms-plan.png' });
  await setView('3d');
  await page.getByRole('button', { name: /alles zeigen/ }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/design-350-rooms-3d.png' });
  await page.setViewportSize(size);
  await setView('split');

  // a second preview replaces the first suggestion instead of adding it again
  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await expect(panel.getByTestId('design-replaces')).toContainText(`Ersetzt ${count} Möbel`);
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(count);

  // „Gefällt mir nicht“: only this room is planned again, with the comment
  const living = panel.getByTestId('design-room').filter({ hasText: 'Wohnzimmer' }).first();
  await living.getByTestId('design-dislike').click();
  await living.getByLabel('Was soll anders werden?').fill('Sofa zum Fenster drehen');
  const n = prompts.length;
  await living.getByRole('button', { name: 'Raum neu planen' }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts)).length).toBe(n + 2);
  const redo = (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts))[n];
  expect(redo).toContain('Sofa zum Fenster drehen');
  expect(redo).toContain('„Wohnzimmer“');
  await expect(panel.getByTestId('design-room')).toHaveCount(7);
  expect(errors).toEqual([]);
});
