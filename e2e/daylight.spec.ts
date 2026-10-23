import { test, expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */

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

/** Set the hour, wait until the lighting shows it and a few frames were drawn, then measure the mean brightness of the 3D view. */
async function brightnessAt(page: Page, hour: number, pose: () => Promise<void>): Promise<number> {
  await page.evaluate((h) => (window as any).__wp.useProjectStore.getState().apply((d: any) => void (d.settings.timeOfDay = h)), hour);
  await expect.poll(async () => Math.abs((await page.evaluate(() => (window as any).__wp.lightingHour?.() ?? 99)) - hour), { timeout: 60000 }).toBeLessThan(0.01);
  await pose();
  const frame = () => page.evaluate(() => (window as any).__wp.three.gl.info.render.frame as number);
  const f0 = await frame();
  await expect.poll(async () => (await frame()) - f0, { timeout: 90000 }).toBeGreaterThanOrEqual(10);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + box.width * 0.1, y: box.y + box.height * 0.15, width: box.width * 0.8, height: box.height * 0.7 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, png.toString('base64'));
}

test('daylight comes in through the windows: closed roller shutters darken the room at noon, a switched-off lamp stays dark at night (#420)', async ({ page }) => {
  test.setTimeout(600_000); // realism rendering with software WebGL is slow
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Realismus' }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  // stand in the living room, looking at the window wall
  const pose = () =>
    page.evaluate(() => {
      const wp = (window as any).__wp;
      wp.three.camera.position.set(4.3, 1.5, 3.6);
      wp.walk.look(0.7, -0.08);
    });
  const open = await brightnessAt(page, 13, pose);
  await page.evaluate(() =>
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      for (const o of d.openings) if (o.kind === 'window') o.shading = { type: 'roller', closed: 1, motor: false };
    }),
  );
  const shut = await brightnessAt(page, 13.01, pose);
  console.log(`daylight: noon open ${open.toFixed(1)} · shutters closed ${shut.toFixed(1)}`);
  expect(shut).toBeLessThan(open * 0.6);

  // at night only the lamps light the room; the floor lamp can be switched off on its own
  const lampsOn = await brightnessAt(page, 23.5, pose);
  await page.evaluate(() =>
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      d.furniture.find((f: any) => f.catalogId === 'generic-floor-lamp').lightOff = true;
    }),
  );
  const lampOff = await brightnessAt(page, 23.51, pose);
  console.log(`night: floor lamp on ${lampsOn.toFixed(1)} · off ${lampOff.toFixed(1)}`);
  expect(lampOff).toBeLessThan(lampsOn * 0.8);
});
