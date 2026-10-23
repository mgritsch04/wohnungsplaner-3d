import { expect, test, type Page } from '@playwright/test';

/* Trennlinie zwischen 2D und 3D (#368): ziehen, Mindestbreite, Doppelklick, Merken, Tastatur. */

async function open(page: Page) {
  await page.goto('/?e2e');
  await page.evaluate(() => localStorage.removeItem('wohnungsplaner-split'));
  await page.goto('/?e2e');
  await expect(page.getByRole('separator')).toBeVisible();
  await page.waitForTimeout(500);
}

const widths = async (page: Page) => ({
  w2d: (await page.locator('.pane-2d').boundingBox())!.width,
  w3d: (await page.locator('.pane-3d').boundingBox())!.width,
});

test('divider drags, clamps, resets, persists and works by keyboard (#368)', async ({ page }) => {
  await open(page);
  const sep = page.getByRole('separator');
  const start = await widths(page);
  expect(Math.abs(start.w2d - start.w3d)).toBeLessThan(4);

  const box = (await sep.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, y, { steps: 5 });
  await page.mouse.up();
  const left = await widths(page);
  expect(left.w2d).toBeLessThan(start.w2d - 150);
  expect(left.w3d).toBeGreaterThan(start.w3d + 150);
  await page.waitForTimeout(600);
  // the 3D canvas follows the pane (no stretching): drawing buffer matches the displayed size
  const ratio = await page.evaluate(() => {
    const c = document.querySelector('.pane-3d canvas') as HTMLCanvasElement;
    return { buf: c.width / c.height, shown: c.clientWidth / c.clientHeight };
  });
  expect(Math.abs(ratio.buf - ratio.shown)).toBeLessThan(0.05);
  await page.screenshot({ path: 'test-results/split-left.png' });

  // minimum width
  const b2 = (await sep.boundingBox())!;
  await page.mouse.move(b2.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(5, y, { steps: 5 });
  await page.mouse.up();
  expect((await widths(page)).w2d).toBeGreaterThanOrEqual(238);

  // persists over reload
  const before = await widths(page);
  await page.reload();
  await expect(sep).toBeVisible();
  await page.waitForTimeout(500);
  expect(Math.abs((await widths(page)).w2d - before.w2d)).toBeLessThan(3);

  // keyboard
  await sep.focus();
  const k0 = (await widths(page)).w2d;
  await page.keyboard.press('ArrowRight');
  expect((await widths(page)).w2d).toBeGreaterThan(k0 + 20);

  // double click resets
  await sep.dblclick();
  const reset = await widths(page);
  expect(Math.abs(reset.w2d - reset.w3d)).toBeLessThan(4);
  await page.screenshot({ path: 'test-results/split-reset.png' });
});

test('2D zooms out with the divider instead of cropping the plan, 3D never goes blank', async ({ page }) => {
  await open(page);
  const zoom = async () => Number(await page.getByTestId('editor2d').getAttribute('data-zoom'));
  const z0 = await zoom();
  const w0 = (await widths(page)).w2d;
  const sep = page.getByRole('separator');
  const box = (await sep.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, y, { steps: 8 });
  // while dragging: the 3D canvas keeps a drawing buffer (no cleared, blank canvas)
  const filled = await page.evaluate(() => {
    const c = document.querySelector('.pane-3d canvas') as HTMLCanvasElement;
    return c.width > 0 && c.height > 0;
  });
  expect(filled).toBe(true);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const w1 = (await widths(page)).w2d;
  expect(await zoom()).toBeCloseTo((z0 * w1) / w0, 0);
  // back: the same view returns
  const b2 = (await sep.boundingBox())!;
  await page.mouse.move(b2.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 0.5, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(Math.abs((await zoom()) - z0)).toBeLessThan(z0 * 0.03);
  await page.screenshot({ path: 'test-results/split-zoom-back.png' });
});
