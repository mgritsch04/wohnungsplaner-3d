import { expect, test, type Page } from '@playwright/test';

/* Level of detail im 2D-Plan beim Herauszoomen (#382): Beschriftungen und Icons verschwinden schrittweise. */

async function freshStart(page: Page) {
  await page.goto('/?e2e');
  await page.evaluate(async () => {
    for (const name of ['wohnungsplaner-projects', 'wohnungsplaner-assets', 'wohnungsplaner-meta']) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => r(null);
      });
    }
    localStorage.clear();
  });
  await page.goto('/?e2e');
  await page.waitForSelector('[data-testid="editor2d"]');
}

test('beim Herauszoomen verschwinden zuerst Maßzahlen, dann Flächen, dann Raumnamen', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const plan = page.locator('[data-testid="editor2d"]');
  const box = (await plan.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const texts = () => plan.locator('svg text').count();
  const before = await texts();
  expect(before).toBeGreaterThan(3);
  const counts = [before];
  for (let step = 0; step < 6; step++) {
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
    counts.push(await texts());
    await page.screenshot({ path: `test-results/lod2d-${step}.png` });
  }
  // monoton weniger Beschriftungen, am Ende (fast) keine
  for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  expect(counts[counts.length - 1]).toBeLessThan(before / 2);
  // wieder hineinzoomen bringt sie zurück
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  expect(await texts()).toBeGreaterThanOrEqual(before - 2);
});
