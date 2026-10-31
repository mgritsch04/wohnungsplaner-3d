import { expect, test, type Page } from '@playwright/test';

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

test('Bereiche für Claude: aufziehen, Textfenster beim Loslassen, freie Form, bearbeiten, löschen, gespeichert (#416)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  await page.getByRole('button', { name: 'Werkzeuge', exact: true }).first().click().catch(() => {});
  const editor = page.getByTestId('editor2d');
  const box = (await editor.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // 1. Rechteck aufziehen → beim Loslassen öffnet sich sofort das Textfenster
  // „Bereiche für Claude“ ist eingeklappt (#461): aufklappen, dann den Knopf in der Gruppe nehmen
  await page.getByRole('button', { name: 'Bereiche für Claude' }).click();
  await page.getByTestId('zone-tool').click();
  let p = at(0.38, 0.4);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = at(0.5, 0.55);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  const textBox = page.getByTestId('zone-box');
  await expect(textBox).toBeVisible();
  await expect(page.getByTestId('zone-purpose')).toBeFocused();
  await page.keyboard.type('Arbeitsecke mit Schreibtisch');
  await page.screenshot({ path: 'test-results/zones-textbox.png' });
  await page.keyboard.press('Enter');
  await expect(textBox).toHaveCount(0);
  await expect(page.getByTestId('zone-2d')).toHaveCount(1);
  await expect(page.getByTestId('zones-2d')).toContainText('1 · Arbeitsecke mit Schreibtisch');
  await expect(page.getByLabel('Zweck von Bereich 1')).toHaveValue('Arbeitsecke mit Schreibtisch');

  // 2. freie Form per Klicks, Schnellwahl im Textfenster
  for (const [fx, fy] of [
    [0.6, 0.35],
    [0.72, 0.35],
    [0.72, 0.5],
  ] as const) {
    const q = at(fx, fy);
    await page.mouse.click(q.x, q.y);
  }
  const last = at(0.62, 0.5);
  await page.mouse.dblclick(last.x, last.y);
  await expect(textBox).toBeVisible();
  await textBox.getByRole('button', { name: 'Essbereich' }).click();
  await textBox.getByTestId('zone-save').click();
  await expect(page.getByTestId('zone-2d')).toHaveCount(2);
  await expect(page.getByLabel('Zweck von Bereich 2')).toHaveValue('Essbereich');
  await page.screenshot({ path: 'test-results/zones-plan.png' });

  // 3. Klick in einen Bereich öffnet ihn zum Bearbeiten; Esc bricht ab, Löschen entfernt ihn
  const inside = at(0.44, 0.47);
  await page.mouse.click(inside.x, inside.y);
  await expect(textBox).toBeVisible();
  await expect(page.getByTestId('zone-purpose')).toHaveValue('Arbeitsecke mit Schreibtisch');
  await page.keyboard.press('Escape');
  await expect(textBox).toHaveCount(0);
  await page.mouse.click(inside.x, inside.y);
  await page.getByTestId('zone-delete').click();
  await expect(page.getByTestId('zone-2d')).toHaveCount(1);
  await expect(page.getByLabel('Zweck von Bereich 1')).toHaveValue('Essbereich');

  // 4. Text im Werkzeug-Reiter ändern, nach dem Neuladen noch da
  await page.getByLabel('Zweck von Bereich 1').fill('frei lassen');
  await expect(page.getByTestId('zones-2d')).toContainText('1 · frei lassen');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button', { name: 'Werkzeuge', exact: true }).first().click().catch(() => {});
  await expect(page.getByLabel('Zweck von Bereich 1')).toHaveValue('frei lassen');
  expect(errors).toEqual([]);
});
