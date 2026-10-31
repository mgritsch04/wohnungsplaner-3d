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

test('Notizen, Raumaufgaben und Umzugs-Checkliste (#83, #84, #91)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);

  // Raum auswählen -> Notiz + Aufgabe
  const roomId = (await getProject(page)).rooms[0].id;
  await page.evaluate((id) => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: unknown) => void } } } }).__wp.useUiStore.getState().setSelection({ type: 'room', id }), roomId);
  await page.getByRole('button', { name: '+ Notiz' }).click();
  await page.getByLabel('Notiz', { exact: true }).fill('Lampe bestellen');
  await expect(page.getByTestId('note-pin')).toHaveCount(1);
  // beim Bearbeiten ist die Notiz offen; Klick auf den Pin schließt, nochmals öffnet
  await expect(page.getByTestId('note-bubble')).toContainText('Lampe bestellen');
  await page.getByTestId('note-pin').click({ force: true });
  await expect(page.getByTestId('note-bubble')).toHaveCount(0);
  await page.getByTestId('note-pin').click({ force: true });
  await expect(page.getByTestId('note-bubble')).toContainText('Lampe bestellen');

  await page.getByLabel('Neuer Punkt').fill('Streichen');
  await page.getByLabel('Neuer Punkt').press('Enter');
  await page.getByLabel('Neuer Punkt').fill('Vorhang messen');
  await page.getByLabel('Neuer Punkt').press('Enter');
  await page.getByLabel('Streichen erledigt').check();
  await expect(page.getByTestId('task-progress')).toHaveText('1 von 2 erledigt');
  await page.getByLabel('Erledigte ausblenden').check();
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  // Umzugs-Checkliste im Reiter Projekt
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  await page.getByRole('button', { name: 'Vorlage einfügen' }).click();
  const step = 'Kündigungsfrist der alten Wohnung prüfen und kündigen';
  await page.getByLabel(`Datum für ${step}`).fill('2026-11-15');
  await page.getByLabel(`${step} erledigt`).click();

  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).notes?.length, { timeout: 10000 }).toBe(1);
  const p = await getProject(page);
  expect(p.notes).toHaveLength(1);
  expect(p.tasks.filter((t) => t.roomId)).toHaveLength(2);
  const move = p.tasks.filter((t) => !t.roomId);
  expect(move.length).toBeGreaterThan(5);
  const first = move.find((t) => t.text === step)!;
  expect(first.due).toBe('2026-11-15');
  expect(first.done).toBe(true);
  expect(errors).toEqual([]);
});

test('Umzug: Aufbauplan mit Maßprüfung (#487)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  // Treppenhaus-Maße eintragen
  await page.getByText('Maße des Hauses').click();
  await page.getByLabel('Treppenhaus Breite').fill('80');
  await page.getByLabel('Treppenhaus Breite').press('Enter');
  await page.getByLabel('Treppenhaus Höhe').fill('200');
  await page.getByLabel('Treppenhaus Höhe').press('Enter');
  await page.getByTestId('moveplan-calc').click();
  await expect(page.getByTestId('moveplan-summary')).toBeVisible();
  const steps = page.getByTestId('moveplan-step');
  const n = await steps.count();
  if (n > 0) {
    await steps.first().getByRole('checkbox').check();
    await expect(page.getByTestId('moveplan-summary')).toContainText('1 aufgebaut');
  }
  await expect.poll(async () => (await getProject(page)).moveAccess?.stairWidth, { timeout: 5000 }).toBeCloseTo(0.8, 2);
  expect(errors).toEqual([]);
});
