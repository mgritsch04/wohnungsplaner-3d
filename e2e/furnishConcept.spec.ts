import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { getProject } from './fixtures';
import { TEST_FLATS, type FlatKey } from '../src/design/fixtures/flats';
import type { RecordedRun } from '../src/design/fixtures/recorded';
import type { DesignWishes } from '../src/assistant/design';
import { derivePlan } from '../src/model/derived';
import { placementIssues } from '../src/model/placement';
import type { Project } from '../src/model/schema';

/**
 * Einrichten nach Wohnkonzept (#442) in der echten Oberfläche, mit Claudes aufgezeichneten
 * Antworten statt Claude. Geprüft wird, was nur im Browser läuft:
 * - der ganze Ablauf im Panel (Stufen, Konzept, Leitfaden, Begehung, Zonen in der Vorschau) und
 *   dass die übernommenen Möbel keinen Befund der Planprüfung auslösen – Testwohnung B;
 * - die Kritikrunde mit dem Raumbild, das nur ein Browser zeichnen kann – Testwohnung D, deren
 *   Garçonnière die Begehung nicht besteht.
 * Kein echter Claude-Aufruf.
 */
interface Call {
  kind: 'konzept' | 'programm' | 'kritik';
  room: string;
  images: number;
  picture: boolean;
}

const recorded = (key: FlatKey): RecordedRun => JSON.parse(readFileSync(new URL(`../src/design/fixtures/recorded/${key}.json`, import.meta.url), 'utf8')) as RecordedRun;

/**
 * Claude als Laufzeit des Artefakts. Die Laufzeit bekommt kein Etikett (das ist nur für den
 * lokalen Helfer), deshalb erkennt die Antwort die Stufe am Prompt und den Raum an seiner Skizze.
 */
async function fakeClaude(page: Page, answers: RecordedRun) {
  await page.addInitScript(
    (rec) => {
      const w = window as unknown as { claude: unknown; __calls: Call[] };
      w.__calls = [];
      const sample = {
        // dieser Claude kann Bilder ansehen (#442): die Kritik schickt das Raumbild statt der Textkarte
        limits: async () => ({ images: true }),
        json: async (prompt: string, opts: { images?: Blob[] } = {}) => {
          const kind = prompt.includes('Wohnkonzept für die ganze Wohnung') ? 'konzept' : prompt.includes('Dein bisheriges Programm') ? 'kritik' : 'programm';
          const room = /Raum „([^“]+)“/.exec(prompt)?.[1] ?? '';
          w.__calls.push({ kind, room, images: opts.images?.length ?? 0, picture: prompt.includes('beigefügte Bild') });
          await new Promise((r) => setTimeout(r, 10));
          if (kind === 'konzept') return rec.concept;
          const program = rec.programs[room];
          if (!program) throw { code: 'upstream_error', message: `keine aufgezeichnete Antwort für ${room}` };
          return structuredClone(program);
        },
      };
      w.claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
    },
    answers as unknown as { concept: unknown; programs: Record<string, unknown> },
  );
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);

/** Die Testwohnung in den Plan laden (ihr Bestand bleibt, Möbelvorschläge gibt es noch keine). */
async function loadFlat(page: Page, key: FlatKey) {
  await page.evaluate((src) => {
    const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Record<string, unknown>) => void) => void } } } }).__wp;
    wp.useProjectStore.getState().apply((d) => {
      for (const k of ['nodes', 'walls', 'openings', 'rooms', 'furniture', 'zones']) d[k] = (src as Record<string, unknown>)[k] ?? [];
      d.groups = [];
    });
  }, TEST_FLATS[key].build() as unknown as Record<string, unknown>);
}

/** Dieselben Angaben, mit denen die Antworten aufgezeichnet wurden. */
async function fillWishes(panel: Locator, wishes: DesignWishes) {
  await panel.getByLabel('Interessen / Hobbys').fill(wishes.interests);
  await panel.getByLabel('Was du brauchst').fill(wishes.needs);
  await panel.getByLabel('Was du dir wünschst').fill(wishes.wants);
  await panel.getByLabel('Farben (optional)').fill(wishes.colors);
  await panel.getByLabel('Stil').fill(wishes.style);
}

/** Stufe 1 und 2: ein Wohnkonzept (höchstens eine Nachbesserung) und je Raum ein Programm. */
function expectStages(made: Call[], planned: string[]) {
  const concept = made.filter((c) => c.kind === 'konzept');
  expect(concept.length).toBeGreaterThanOrEqual(1);
  expect(concept.length).toBeLessThanOrEqual(2);
  for (const room of planned) expect(made.filter((c) => c.kind === 'programm' && c.room === room).length).toBeGreaterThanOrEqual(1);
  // jede Kritikrunde geht mit genau einem Raumbild hinaus, und höchstens zwei je Raum
  const critique = made.filter((c) => c.kind === 'kritik');
  expect(critique.every((c) => c.images === 1 && c.picture)).toBe(true);
  for (const room of new Set(critique.map((c) => c.room))) expect(critique.filter((c) => c.room === room).length).toBeLessThanOrEqual(2);
  return critique;
}

test('Einrichten nach Wohnkonzept (#442): Stufen, Begehung im Panel, Zonen in der Vorschau, Übernahme ohne Befund', async ({ page }) => {
  test.setTimeout(240_000);
  const answers = recorded('B');
  /** Der Balkon wurde im Aufzeichnungslauf nie gefragt – die Oberfläche muss das sagen. */
  const planned = Object.keys(answers.programs);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page, answers);
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await loadFlat(page, 'B');

  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await fillWishes(panel, TEST_FLATS.B.wishes);
  // der neue Weg ist voreingestellt, und weil dieser Claude Bilder ansehen kann, kündigt der Hinweis das Bild an
  await expect(panel.getByTestId('design-method-hint')).toContainText('als Bild');
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();

  // während des Laufs sagt der Knopf, woran Claude gerade ist
  await expect(panel.getByRole('button', { name: /^(Räume lesen|Wohnkonzept|Raumprogramme|Aufstellen|Begehung|Nachbessern)/ })).toBeVisible({ timeout: 60_000 });

  const proposal = panel.getByTestId('design-proposal');
  await expect(proposal).toBeVisible({ timeout: 180_000 });
  // der Balkon hatte keine Antwort: er fehlt im Vorschlag und die App sagt es
  await expect(panel.getByTestId('design-room')).toHaveCount(planned.length);
  await expect(page.locator('.toast')).toContainText('Balkon');

  // je Raum: wie der Raum gedacht ist, der Leitfaden mit Zonen und das Ergebnis der Begehung
  await expect(panel.getByTestId('design-brief')).toHaveCount(planned.length);
  const reviews = panel.getByTestId('design-review');
  await expect(reviews).toHaveCount(planned.length);
  for (const text of await reviews.allInnerTexts()) expect(text).toMatch(/Begehung: \d+ von 100 Punkten\s*·\s*(nicht bestanden|bestanden)/);
  // jedes Möbel trägt seine Begründung aus dem Raumprogramm
  await expect(panel.getByTestId('design-pick').first()).toBeVisible();
  const picks = await panel.getByTestId('design-pick').allInnerTexts();
  expect(picks.length).toBeGreaterThan(20);
  expect(picks.every((t) => t.trim().length > 20)).toBe(true);

  const made = await calls(page);
  expectStages(made, planned);
  // der Balkon wurde gefragt, aber nicht beantwortet
  expect(made.some((c) => c.kind === 'programm' && c.room === 'Balkon')).toBe(true);
  await proposal.screenshot({ path: 'test-results/design-442-konzept-panel.png' });

  // Vorschau: die Zonen des Raumprogramms liegen als blasse Flächen im Plan
  await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
  await expect(panel.getByTestId('design-preview')).toContainText('noch nicht übernommen');
  expect(await panel.getByTestId('design-missing').allInnerTexts()).toEqual([]);
  await expect(page.locator('.furnish-zone').first()).toBeVisible();
  expect(await page.locator('.furnish-zone-label').count()).toBeGreaterThan(3);

  // Übernahme: die Möbel stehen so, dass die Planprüfung nichts zu sagen hat
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBeGreaterThan(30);
  const p = (await getProject(page)) as Project;
  const d = derivePlan(p);
  for (const f of p.furniture) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
  expect(p.furniture.some((f) => f.suggested)).toBe(true);

  // großer Plan und 3D-Ansicht, um das Ergebnis Raum für Raum anzusehen (ohne Auswahlrahmen)
  await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: null) => void } } } }).__wp.useUiStore.getState().setSelection(null));
  const setView = (viewMode: string) => page.evaluate((v) => (window as unknown as { __wp: { useUiStore: { setState: (s: object) => void } } }).__wp.useUiStore.setState({ viewMode: v }), viewMode);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 2200, height: 1300 });
  await setView('2d');
  await page.getByRole('button', { name: /alles zeigen/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByTestId('editor2d').screenshot({ path: 'test-results/design-442-konzept-plan.png' });
  await setView('3d');
  await page.getByRole('button', { name: /alles zeigen/ }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/design-442-konzept-3d.png' });
  await page.setViewportSize(size);
  await setView('split');
  expect(errors).toEqual([]);
});

test('Kritikrunde (#442): ein Raum, der die Begehung nicht besteht, geht mit seinem Bild zurück an Claude', async ({ page }) => {
  test.setTimeout(240_000);
  const answers = recorded('D');
  const planned = Object.keys(answers.programs);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeClaude(page, answers);
  await page.goto('/?e2e');
  await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
  await loadFlat(page, 'D');

  await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
  const panel = page.getByTestId('design-panel');
  await fillWishes(panel, TEST_FLATS.D.wishes);
  await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
  await expect(panel.getByTestId('design-proposal')).toBeVisible({ timeout: 180_000 });
  await expect(panel.getByTestId('design-room')).toHaveCount(planned.length);

  // in der Garçonnière findet die Begehung einen schweren Mangel: Claude bessert nach, mit Bild
  const critique = expectStages(await calls(page), planned);
  expect(critique.length).toBeGreaterThan(0);
  expect(critique.some((c) => c.room === 'Zimmer')).toBe(true);
  // der nachgebesserte Raum steht weiter da (die nachgestellte Antwort ändert nichts, also bleibt die erste Aufstellung)
  const room = panel.getByTestId('design-room').filter({ hasText: 'Zimmer' }).first();
  await expect(room.getByTestId('design-review')).toContainText('Begehung:');
  expect((await room.getByTestId('design-pick').allInnerTexts()).length).toBeGreaterThan(5);
  await panel.getByTestId('design-proposal').screenshot({ path: 'test-results/design-442-kritik-panel.png' });
  expect(errors).toEqual([]);
});
