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

/**
 * Stand-in for Claude (`window.claude.use('sample')`): reads the device keys (K1 …) from the prompt,
 * takes motion sensors and contacts in phase 1, drops one presence sensor, adds scenes and makes up
 * a device and a room that do not exist (must be dropped).
 */
async function fakeClaude(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __prompts: string[] };
    w.__prompts = [];
    const sample = {
      json: async (input: string) => {
        w.__prompts.push(input);
        await new Promise((r) => setTimeout(r, 50));
        const lines = [...input.matchAll(/^(K\d+): (R\d+), (.+?) (?:\(|$)/gm)];
        let droppedOne = false;
        const devices = lines.map((m) => {
          const kind = m[3];
          if (kind.startsWith('Präsenzsensor') && !droppedOne) {
            droppedOne = true;
            return { key: m[1], keep: false, reason: 'Ein Sensor genügt, der Raum ist klein.' };
          }
          const phase = kind.startsWith('Bewegungsmelder') || kind.startsWith('Tür-') ? 1 : 2;
          return { key: m[1], keep: true, phase, reason: `Claude: ${kind} in ${m[2]}.` };
        });
        const living = /(R\d+) „Wohnzimmer“/.exec(input)?.[1] ?? 'R1';
        return {
          summary: 'Erst Bewegung und Kontakte, danach Licht und Präsenz.',
          rooms: [{ room: living, role: 'Hauptaufenthalt mit Präsenz.' }, { room: 'R99', role: 'gibt es nicht' }],
          devices: [...devices, { key: 'K999', keep: true, phase: 1, reason: 'erfunden' }],
          scenes: [{ name: 'Abwesend', trigger: 'Alle Handys weg', actions: 'Alle Lichter aus, Hinweis bei offenem Fenster.', rooms: [living] }],
          phases: [{ phase: 1, title: 'Sicherheit und Flur', why: 'Günstig und sofort nützlich.' }],
          network: 'Zigbee für Batteriegeräte, Thread nur für Matter-Geräte; alles lokal in Home Assistant.',
          voice: false,
          questions: [{ question: 'Darf geklebt werden?', proposal: 'Ja, nur Klebegeräte.' }],
          later: [],
        };
      },
    };
    w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  });
}

test('Smart-Home-Konzept (#375): ganze Wohnung mit Claude, Phase wählen, Vorschau, verwerfen, übernehmen, Undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page);
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const before = (await getProject(page)).devices.length;

  await panel.getByLabel('Alltag').fill('zwei Personen, Homeoffice');
  await panel.getByLabel('Budget in € (0 = egal)').fill('400');
  await panel.getByTestId('concept-ask').click();

  const concept = panel.getByTestId('concept');
  await expect(concept).toBeVisible();
  await expect(concept).toContainText('Vorschlag von Claude');
  await expect(concept).toContainText('Erst Bewegung und Kontakte');
  await expect(concept.getByTestId('concept-room').first()).toBeVisible();
  const rooms = await concept.getByTestId('concept-room').count();
  expect(rooms).toBeGreaterThanOrEqual(2);
  await expect(concept.getByTestId('concept-scene')).toHaveCount(1);
  await expect(concept.getByTestId('concept-network')).toContainText('Zigbee');
  await expect(concept.getByTestId('concept-left')).toContainText('Ein Sensor genügt');
  await expect(concept.getByTestId('concept-budget')).toContainText('Home Assistant Green');
  await expect(concept.getByTestId('concept-budget-central')).toContainText('179,90');
  await expect(concept.getByTestId('concept-questions')).toContainText('Darf geklebt werden?');
  await expect(concept).toContainText('nicht zum Plan');
  // the room suggestion's own list does not show the concept's devices twice
  await expect(panel.getByTestId('sh-suggest-result')).toHaveCount(0);

  const all = await concept.getByTestId('concept-item').count();
  const phase1 = await concept.locator('[data-testid="concept-item"][data-phase="1"]').count();
  expect(phase1).toBeGreaterThan(0);
  expect(phase1).toBeLessThan(all);
  await expect(page.getByTestId('device-preview')).toHaveCount(all);

  const prompt = (await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts))[0];
  expect(prompt).toContain('Alltag: zwei Personen, Homeoffice');
  expect(prompt).toContain('höchstens 400 €');
  expect(prompt).not.toContain('Beispielwohnung');
  expect(prompt).not.toContain('https://');
  await page.screenshot({ path: 'test-results/concept-375-all.png' });
  await concept.screenshot({ path: 'test-results/concept-375-card.png' });

  // only phase 1: smaller preview, smaller total
  const totalAll = await concept.getByTestId('concept-total').textContent();
  await concept.getByLabel('Vorschau und Übernehmen bis').selectOption('1');
  await expect(page.getByTestId('device-preview')).toHaveCount(phase1);
  expect(await concept.getByTestId('concept-total').textContent()).not.toBe(totalAll);
  expect((await getProject(page)).devices.length).toBe(before);
  await page.screenshot({ path: 'test-results/concept-375-phase1.png' });

  // discard: plan unchanged, preview gone
  await concept.getByTestId('concept-discard').click();
  await expect(concept).toHaveCount(0);
  await expect(page.getByTestId('device-preview')).toHaveCount(0);
  expect((await getProject(page)).devices.length).toBe(before);

  // again, take over everything: one undo step brings the plan back
  await panel.getByTestId('concept-ask').click();
  await expect(concept).toBeVisible();
  await concept.getByTestId('concept-apply').click();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(before + all);
  await expect(concept).toHaveCount(0);
  await expect(page.getByTestId('device-preview')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/concept-375-applied.png' });
  await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(before);
  expect(errors).toEqual([]);
});

test('Smart-Home-Konzept (#375): ohne Claude regelbasiert, mit Szenen, Budget und Quellen', async ({ page }) => {
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  await expect(panel.getByTestId('concept-ask')).toHaveCount(0);
  await panel.getByTestId('concept-rules').click();
  const concept = panel.getByTestId('concept');
  await expect(concept).toContainText('Regelbasierter Vorschlag');
  expect(await concept.getByTestId('concept-scene').count()).toBeGreaterThan(0);
  await expect(concept.getByRole('link', { name: 'Home Assistant Green' })).toHaveAttribute('href', /shelly\.com/);
  await expect(concept.getByTestId('concept-total')).toContainText('€');
  await page.screenshot({ path: 'test-results/concept-375-rules.png' });
  await concept.screenshot({ path: 'test-results/concept-375-rules-card.png' });
});
