/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getProject, getSelection, planToScreen, worldToScreen3d } from './fixtures';

const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

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


test('loads the sample apartment in 2D and 3D without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="editor2d"] svg')).toBeVisible();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: /Wohnzimmer – 20,00 m²/ })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('zoom slider at the bottom of 2D and 3D, synchronised with the mouse wheel (#6)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const zoom2d = () => page.evaluate(() => (window as any).__wp.useUiStore.getState().view2d.zoom as number);
  const slider2d = page.getByLabel('Zoom 2D', { exact: true });
  await expect(slider2d).toBeVisible();
  const z0 = await zoom2d();
  await page.getByRole('button', { name: 'Zoom 2D: hineinzoomen' }).click();
  expect(await zoom2d()).toBeGreaterThan(z0 * 1.1);
  // mouse wheel → slider follows
  const before = Number(await slider2d.inputValue());
  const box = (await page.getByTestId('editor2d').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => Number(await slider2d.inputValue())).toBeLessThan(before);
  await slider2d.fill('900');
  expect(await zoom2d()).toBeGreaterThan(300);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const slider3d = page.getByLabel('Zoom 3D', { exact: true });
  await expect(slider3d).toBeVisible();
  const dist = () =>
    page.evaluate(() => {
      const wp = (window as any).__wp;
      return wp.three.camera.position.length() as number;
    });
  const d0 = await dist();
  await page.getByRole('button', { name: 'Zoom 3D: hineinzoomen' }).click();
  await expect.poll(dist).toBeLessThan(d0 - 0.2);
  const s0 = Number(await slider3d.inputValue());
  const cbox = (await page.getByTestId('scene3d').boundingBox())!;
  await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 3);
  await page.mouse.wheel(0, 800); // zoom out with the wheel
  await expect.poll(async () => Number(await slider3d.inputValue()), { timeout: 15000 }).toBeLessThan(s0);
  // not shown while walking
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(slider3d).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('3D: clicking furniture keeps it selected after release; walls stay selectable; orbit drag keeps selection', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(2500);
  const p = await getProject(page);
  const bed = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-bed-160');
  const s = await worldToScreen3d(page, bed.x, 0.55, bed.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // repeated click keeps it selected
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // orbit drag on empty floor does not change the selection
  const f = await worldToScreen3d(page, 1.0, 0, 1.5);
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  await page.mouse.move(f.x + 60, f.y + 10, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: bed.id });
  // clicking the exposed top of a wall selects that wall
  await page.getByRole('button', { name: 'Kamera zurücksetzen' }).click();
  await page.waitForTimeout(800);
  const w = await worldToScreen3d(page, 4.0, 2.6, -0.06);
  await page.mouse.click(w.x, w.y);
  await page.waitForTimeout(400);
  expect((await getSelection(page))?.type).toBe('wall');
});

test('realism mode: time-of-day control with presets, one undo step per drag, no errors', async ({ page }) => {
  // realism rendering with software WebGL takes ~45–55 s alone; under parallel load it overran 60 s
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('Tageszeit', { exact: true })).toHaveCount(0); // only in realism mode
  await page.getByRole('button', { name: 'Realismus' }).click();
  const slider = page.getByLabel('Tageszeit', { exact: true });
  await expect(slider).toBeVisible();
  // #192: reflections follow the time of day (the environment is rebuilt), windows are reflecting glass
   
  const envBuilds = () => page.evaluate(() => ((window as any).__wp.envBuilds as number | undefined) ?? 0);
  await expect.poll(envBuilds, { timeout: 30000 }).toBeGreaterThan(0);
  const buildsAtNoon = await envBuilds();
  const glass = await page.evaluate(() => {
     
    const scene = (window as any).__wp.three.scene;
    let n = 0;
     
    scene.traverse((o: any) => void (o.material?.userData?.glass && n++));
    return n;
  });
  expect(glass).toBeGreaterThan(0);
  // software WebGL (no graphics card): the automatic graphics level stays "normal"
  await expect(page.getByTestId('scene3d')).toHaveAttribute('data-graphics-tier', 'normal');
  // presets are in the toolbar's "Mehr" menu (#100)
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await expect(page.getByLabel('Grafikqualität').locator('option:checked')).toHaveText(/automatisch \(normal\)/);
  await page.getByLabel('Grafikqualität').selectOption('high');
  await expect(page.getByTestId('scene3d')).toHaveAttribute('data-graphics-tier', 'high');
  await page.getByLabel('Grafikqualität').selectOption('auto');
  await expect(page.getByTestId('scene3d')).toHaveAttribute('data-graphics-tier', 'normal');
  await page.getByLabel('Tageszeit-Voreinstellung').selectOption({ label: 'Nacht (23:30)' });
  expect((await getProject(page)).settings.timeOfDay).toBe(23.5);
  await expect.poll(envBuilds, { timeout: 30000 }).toBeGreaterThan(buildsAtNoon);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Tageszeit-Voreinstellung')).toHaveCount(0);
  const pastBefore = await page.evaluate(() => (window as unknown as { __wp: { useProjectStore: { getState: () => { past: unknown[] } } } }).__wp.useProjectStore.getState().past.length);
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height / 2, { steps: 4 });
  // while dragging only the live preview changes – no project clone/re-render per step
  const during = await page.evaluate(() => {
     
    const wp = (window as any).__wp;
    return { saved: wp.useProjectStore.getState().project.settings.timeOfDay, preview: wp.useUiStore.getState().timePreview };
  });
  expect(during.saved).toBe(23.5);
  expect(during.preview).toBeGreaterThan(10);
  // the lighting follows within a couple of frames (frame-rate independent smoothing)
  const lightingGap = () =>
    page.evaluate(() => {
       
      const wp = (window as any).__wp;
      return Math.abs(wp.lightingHour() - wp.useUiStore.getState().timePreview);
    });
  await expect.poll(lightingGap, { timeout: 20000 }).toBeLessThan(0.01);
  await page.mouse.up();
  const after = await page.evaluate(() => (window as unknown as { __wp: { useProjectStore: { getState: () => { past: unknown[]; project: { settings: { timeOfDay: number } } } } } }).__wp.useProjectStore.getState());
  expect(after.project.settings.timeOfDay).toBeGreaterThan(10);
  expect(after.project.settings.timeOfDay).toBeLessThan(15);
  expect(after.past.length).toBe(pastBefore + 1);
  await page.waitForTimeout(2500);
  // switching back to planning keeps everything working
  await page.getByRole('button', { name: 'Planung' }).click();
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});

test('3D: click vs. drag – threshold, no jump, release over a wall, focus loss, UI clicks', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // walls cut at 1.2 m: furniture visible
  await page.waitForTimeout(2500);
  const find = async (id: string) => (await getProject(page)).furniture.find((f: { id: string }) => f.id === id);
   
  const txOpen = () => page.evaluate(() => !!(window as any).__wp.useProjectStore.getState().txBase);
  const table = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const top = table.height; // grab the table top
  const a = await worldToScreen3d(page, table.x + 0.2, top, table.y);

  // 1) jitter below the threshold: selects, does not move
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 3, a.y + 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  expect([(await find(table.id)).x, (await find(table.id)).y]).toEqual([table.x, table.y]);

  // 2) a real drag moves it by the pointer's world offset (grab offset kept, no jump)
  const b = await worldToScreen3d(page, table.x + 0.2 - 0.5, top, table.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  expect(await txOpen()).toBe(true);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const t2 = await find(table.id);
  // furniture snaps to the 5 cm grid (#52): a pointer that lands a hair off the line may
  // round to the neighbouring grid line, so allow one grid step – a real jump is far more
  const step = 0.05 + 1e-6;
  expect(Math.abs(t2.x - (table.x - 0.5))).toBeLessThanOrEqual(step);
  expect(Math.abs(t2.y - table.y)).toBeLessThanOrEqual(step);
  expect(await txOpen()).toBe(false);

  // 3) dragged towards the north wall and released with the pointer over the wall: stays selected, flush to the wall
  const c = await worldToScreen3d(page, t2.x + 0.2, top, t2.y);
  const wall = await worldToScreen3d(page, t2.x + 0.2, 1.0, -0.06);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(wall.x, wall.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  const t3 = await find(table.id);
  expect(t3.y - t3.depth / 2).toBeGreaterThanOrEqual(-0.002);

  // 4) focus loss mid-drag ends the drag: later pointer moves no longer move the item
  const d = await worldToScreen3d(page, t3.x, top, t3.y + 0.1);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x - 40, d.y, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await txOpen()).toBe(false);
  const t4 = await find(table.id);
  await page.mouse.move(d.x - 120, d.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect([(await find(table.id)).x, (await find(table.id)).y]).toEqual([t4.x, t4.y]);

  // 5) pressing on a UI button and releasing over the canvas starts no drag
  const before = await getProject(page);
  const btn = await page.getByRole('button', { name: 'Schnitt' }).boundingBox();
  await page.mouse.move(btn!.x + 5, btn!.y + 5);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await getProject(page)).furniture).toEqual(before.furniture);
  expect(await txOpen()).toBe(false);
  expect(errors).toEqual([]);
});

test('night lighting: day > evening > night, lamps on/off clearly distinguishable (measured screen brightness)', async ({ page }) => {
  test.setTimeout(600000);
  const errors = collectErrors(page);
  await freshStart(page);
  // a ceiling light in each room: since #216 only placed lamps light a room at night (no automatic room light)
  await page.evaluate(() => {
     
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      for (const [id, x, y] of [['light_e2e_living', 2.5, 2], ['light_e2e_bed', 6.9, 2]] as const)
        d.lights.push({ id, name: 'Deckenlicht', x, y, elevation: 2.4, temperature: 3000, intensity: 5, on: true });
    });
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Realismus' }).click();
  const blankRetries: string[] = [];
  /** True when the screenshot is one flat colour, i.e. the canvas showed no rendered frame at all. */
  const blankShot = (png: Buffer) =>
    page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
      return true;
    }, png.toString('base64'));
  const brightness = async (hour: number, lamps: 'auto' | 'on' | 'off') => {
    // the lamp switch is in the toolbar's "Mehr" menu (#100)
    await page.getByRole('button', { name: 'Mehr', exact: true }).click();
    await page.getByLabel('Lampen', { exact: true }).selectOption(lamps);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Lampen', { exact: true })).toHaveCount(0);
    await page.evaluate((h) => {
      const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: { settings: { timeOfDay: number } }) => void) => void } } } }).__wp;
      wp.useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = h));
    }, hour);
    // software rendering in CI can be very slow: wait until the lighting has reached the hour
    // and several frames were actually rendered with the new state (not a fixed time)
    const frames = () =>
      page.evaluate(() => {
         
        const wp = (window as any).__wp;
        return { frame: wp.three.gl.info.render.frame as number, hour: wp.lightingHour() as number };
      });
    await expect.poll(async () => Math.abs((await frames()).hour - hour), { timeout: 60000 }).toBeLessThan(0.01);
    const f0 = (await frames()).frame;
    await expect.poll(async () => (await frames()).frame - f0, { timeout: 90000 }).toBeGreaterThanOrEqual(12);
    // measure only where the apartment is on screen (the dark sky around it and UI overlays
    // would dilute the difference depending on how large the apartment is framed)
    const clip = await page.evaluate(() => {
       
      const wp = (window as any).__wp;
      const p = wp.useProjectStore.getState().project;
      const xs = p.nodes.map((n: { x: number }) => n.x);
      const ys = p.nodes.map((n: { y: number }) => n.y);
      const cam = wp.three.camera;
      const r = wp.three.canvas.getBoundingClientRect();
      const pts: { x: number; y: number }[] = [];
      for (const x of [Math.min(...xs), Math.max(...xs)])
        for (const y of [Math.min(...ys), Math.max(...ys)])
          for (const z of [0, p.settings.defaultWallHeight]) {
            const v = cam.position.clone().set(x, z, y).project(cam);
            pts.push({ x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height });
          }
      const x0 = Math.max(r.left, Math.min(...pts.map((q) => q.x)));
      const y0 = Math.max(r.top, Math.min(...pts.map((q) => q.y)));
      const x1 = Math.min(r.right, Math.max(...pts.map((q) => q.x)));
      const y1 = Math.min(r.bottom, Math.max(...pts.map((q) => q.y)));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
    expect(clip.width).toBeGreaterThan(50);
    // a lost WebGL context shows the page background instead of the scene – say so instead of measuring it
     
    expect(await page.evaluate(() => (window as any).__wp.three.gl.getContext().isContextLost())).toBe(false);
    // the adaptive quality (PerformanceMonitor) may lower the resolution right now; that resizes the canvas,
    // which shows nothing until the next frame is drawn (#157) – measure a frame that was actually drawn
    let png = await page.screenshot({ clip });
    for (let retry = 0; retry < 5 && (await blankShot(png)); retry++) {
       
      blankRetries.push(`${hour}/${lamps} dprCap ${await page.evaluate(() => (window as any).__wp.usePerformanceStore.getState().dprCap)}`);
      const f1 = (await frames()).frame;
      await expect.poll(async () => (await frames()).frame - f1, { timeout: 90000 }).toBeGreaterThanOrEqual(3);
      png = await page.screenshot({ clip });
    }
    // kept in test-results (uploaded by CI when a test fails) to see what a wrong value looked like (#157)
    await writeFile(test.info().outputPath(`brightness-${hour}-${lamps}.png`), png);
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
  };
  // diagnostics for the CI log: which lights exist and how strong they are right now
  const lightReport = () =>
    page.evaluate(() => {
       
      const wp = (window as any).__wp;
      const out: string[] = [];
       
      wp.three.scene.traverse((o: any) => {
        if (o.isLight)
          out.push(
            `${o.type}:${o.intensity.toFixed(2)}${o.visible ? '' : '(hidden)'}` +
              // lamp shadows (#130, #157): casting? map rendered? update pending?
              (o.castShadow ? `[shadow map:${o.shadow.map ? 'yes' : 'no'} pending:${o.shadow.needsUpdate}]` : ''),
          );
      });
      const gl = wp.three.gl.getContext();
      return `${out.join(' ')} | exposure ${wp.three.gl.toneMappingExposure.toFixed(2)} | maxFragUniforms ${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)} | renderer ${gl.getParameter(gl.RENDERER)}`;
    });
  const noon = await brightness(13, 'auto');
  const evening = await brightness(21, 'auto');
  const night = await brightness(23.5, 'auto');
  const nightLights = await lightReport();
  const nightOff = await brightness(23.5, 'off');
  console.log(`night lighting: noon ${noon.toFixed(1)} · 21:00 ${evening.toFixed(1)} · 23:30 ${night.toFixed(1)} · 23:30 off ${nightOff.toFixed(1)}\n  lamps on: ${nightLights}\n  blank frames re-measured: ${blankRetries.join(', ') || 'none'}\n  lamps off: ${await lightReport()}`);
  expect(errors).toEqual([]); // e.g. shader compile errors would explain missing light
  expect((await getProject(page)).settings.lamps).toBe('off');
  expect(evening).toBeLessThan(noon * 0.5); // 21:00 is clearly darker than noon (was ~0.53× before the fix)
  expect(night).toBeLessThan(evening * 0.85); // and it keeps getting darker after 21:00 (was identical)
  expect(nightOff).toBeLessThan(night * 0.8); // switching the lamps off is visible
  expect(nightOff).toBeGreaterThan(2); // but not pitch black (moonlight / sky)
  expect(errors).toEqual([]);
});

test('dark mode: light / dark / system switch in the project panel, kept after reload, print sheet stays white (#73)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await freshStart(page);
  const html = page.locator('html');
  // relative luminance (0 = black, 1 = white) of a computed background colour
  const lum = (selector: string) =>
    page.evaluate((sel) => {
      const [r, g, b] = getComputedStyle(document.querySelector(sel)!).backgroundColor.match(/[\d.]+/g)!.map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }, selector);
  const stored = () => page.evaluate(() => localStorage.getItem('wohnungsplaner-theme'));

  await expect(html).toHaveAttribute('data-theme', 'system');
  expect(await lum('html')).toBeGreaterThan(0.8);

  const panel = page.locator('.panel.right');
  await panel.getByRole('button', { name: 'Projekt', exact: true }).click();
  const group = panel.getByRole('group', { name: 'Farbschema' });
  await expect(group.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Dunkel
  await group.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(group.getByRole('button', { name: 'Dunkel', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await lum('html')).toBeLessThan(0.15);
  expect(await lum('.panel.right')).toBeLessThan(0.15);
  expect(await lum('.toolbar')).toBeLessThan(0.15);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  expect(await stored()).toBe('dark');

  // reload → still dark (device setting, not part of the project)
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await lum('html')).toBeLessThan(0.15);

  // the print sheet stays white in dark mode
  await page.getByRole('button', { name: 'Mehr', exact: true }).click(); // exports are in the "Mehr" menu (#100)
  await page.getByRole('button', { name: /Plan drucken/ }).click();
  await expect(page.locator('.print-page')).toBeVisible();
  expect(await lum('.print-page')).toBeGreaterThan(0.99);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('.print-page')).toHaveCount(0);

  // Hell wins over a dark system theme
  await page.emulateMedia({ colorScheme: 'dark' });
  await panel.getByRole('button', { name: 'Projekt', exact: true }).click();
  await group.getByRole('button', { name: 'Hell', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await lum('html')).toBeGreaterThan(0.8);
  expect(await stored()).toBe('light');

  // System follows the operating system
  await group.getByRole('button', { name: 'System', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'system');
  expect(await lum('html')).toBeLessThan(0.15);
  expect(await stored()).toBeNull();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await lum('html')).toBeGreaterThan(0.8);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('input.project-name')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'system');
  expect(await lum('html')).toBeLessThan(0.15);

  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('before/after comparison in 3D: A | B with the same camera, moved/removed furniture marked, project unchanged (#76)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const openVersions = async () => {
    await page.getByRole('button', { name: 'Projekt ▾' }).click();
    await page.getByRole('button', { name: /^Versionen/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Versionen' });
    await expect(dlg).toBeVisible();
    return dlg;
  };
  let saved = 0;
  const saveState = async (name: string) => {
    const dlg = await openVersions();
    await expect(dlg.getByTestId('versions-count')).toContainText(`${saved} von höchstens`); // list loaded
    await dlg.getByLabel('Name des Stands').fill(name);
    await dlg.getByRole('button', { name: 'Aktuellen Stand speichern' }).click();
    saved++;
    await expect(dlg.getByTestId('versions-count')).toContainText(`${saved} von höchstens`);
    await expect(dlg.getByTestId('version-item').locator('strong').getByText(name, { exact: true })).toHaveCount(1);
    await dlg.getByRole('button', { name: 'Schließen' }).click();
  };
  const p0 = await getProject(page);
  const table = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  const lamp = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-floor-lamp');

  // state A, then move the coffee table and delete the floor lamp, state B
  await saveState('A');
  const start = await planToScreen(page, table.x, table.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 10, { steps: 5 });
  await page.mouse.move(start.x + 80, start.y + 20, { steps: 5 });
  await page.mouse.up();
  const tableX = async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id).x;
  await expect.poll(tableX).toBeGreaterThan(table.x + 0.3);
  const lampAt = await planToScreen(page, lamp.x, lamp.y);
  await page.mouse.click(lampAt.x, lampAt.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(lamp.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { id: string }) => f.id === lamp.id)).toBe(false);
  // both changes are committed (no gesture left open) before state B is saved
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useProjectStore.getState().txBase === null)).toBe(true);
  await saveState('B');

  const before = await page.evaluate(() => {
    const s = (window as any).__wp.useProjectStore.getState();
    return { json: JSON.stringify(s.project), past: s.past.length, future: s.future.length, revision: s.revision };
  });

  // pick A and B, compare in 3D
  const dlg = await openVersions();
  await expect(dlg.getByTestId('version-item')).toHaveCount(2); // list loaded (the selects are filled from it)
  const optionLabel = async (select: string, name: string) => (await dlg.getByLabel(select).locator('option').allInnerTexts()).find((t) => t.startsWith(`${name} (`))!;
  await dlg.getByLabel('Stand A').selectOption({ label: await optionLabel('Stand A', 'A') });
  await dlg.getByLabel('Stand B').selectOption({ label: await optionLabel('Stand B', 'B') });
  await dlg.getByRole('button', { name: 'In 3D vergleichen' }).click();
  await expect(dlg).toBeHidden();
  const bar = page.getByTestId('compare-bar');
  await expect(bar).toBeVisible();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="editor2d"]')).toHaveCount(0); // 3D only while comparing
  await expect(bar.getByTestId('compare-legend')).toHaveText('1 verschoben, 1 entfernt');
  await expect(bar.getByText('Bearbeiten ist im Vergleich gesperrt')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1500); // canvas resized, camera settled

  type V = { x: number; y: number; z: number };
  const camPos = (): Promise<V> =>
    page.evaluate(() => {
      const c = (window as any).__wp.three.camera.position;
      return { x: c.x, y: c.y, z: c.z };
    });
  const sceneState = () =>
    page.evaluate(
      ({ tableId, lampId }) => {
        const scene = (window as any).__wp.three.scene;
        const furniture: Record<string, number> = {};
        const marks: string[] = [];
        scene.traverse((o: any) => {
          if (o.userData?.compareMarker) marks.push(`${o.userData.compareMarker}:${o.userData.ghost ? 'ghost' : 'item'}:${o.userData.furnitureId}`);
          else if (o.userData?.furnitureId) furniture[o.userData.furnitureId] = o.position.x;
        });
        return { tableX: furniture[tableId], hasLamp: lampId in furniture, marks: marks.sort() };
      },
      { tableId: table.id, lampId: lamp.id },
    );
  const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  const camA = await camPos();
  const sceneA = await sceneState();
  expect(sceneA.hasLamp).toBe(true);
  expect(sceneA.tableX).toBeCloseTo(table.x, 6);
  expect(sceneA.marks).toEqual([`moved:item:${table.id}`, `removed:item:${lamp.id}`].sort());
  await page.screenshot({ path: 'test-results/compare-a.png' });

  // Space switches to B: other scene, same camera
  await page.keyboard.press(' ');
  await expect(bar.getByRole('button', { name: /^B/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sceneState()).hasLamp).toBe(false);
  const sceneB = await sceneState();
  expect(sceneB.tableX).toBeGreaterThan(table.x + 0.3);
  expect(sceneB.marks).toEqual([`moved:item:${table.id}`, `removed:ghost:${lamp.id}`].sort());
  expect(dist(await camPos(), camA)).toBeLessThan(1e-6);
  await page.screenshot({ path: 'test-results/compare-b.png' });

  // the buttons switch, too; the camera still does not move
  await bar.getByRole('button', { name: /^A/ }).click();
  await expect.poll(async () => (await sceneState()).hasLamp).toBe(true);
  expect(dist(await camPos(), camA)).toBeLessThan(1e-6);
  await page.keyboard.press(' '); // the focused A button must not "click" back
  await expect(bar.getByRole('button', { name: /^B/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  await expect(bar.getByRole('button', { name: /^B/ })).toHaveAttribute('aria-pressed', 'true');

  // editing is locked: Delete / Ctrl+Z change nothing, the toolbar is inert
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Im Vergleichsmodus ist Bearbeiten gesperrt', { exact: false })).toBeVisible();
  await expect(page.locator('.app-header')).toHaveAttribute('inert', '');

  // end: the project is exactly as before, no undo step was added
  await bar.getByRole('button', { name: 'Vergleich beenden' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-testid="editor2d"]')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__wp.useProjectStore.getState();
    return { json: JSON.stringify(s.project), past: s.past.length, future: s.future.length, revision: s.revision };
  });
  expect(after).toEqual(before);
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().viewMode)).toBe('2d');
  // Ctrl+Z works again afterwards (restores the deleted lamp)
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).furniture.some((f: { id: string }) => f.id === lamp.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('2D plan: wall outlines keep their screen-pixel width at every zoom, plan colours come from the tokens (#104)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const wall = page.locator('[data-testid="editor2d"] [data-layer="wall"]').first();
  const strokeAt = async (zoom: number) => {
    await page.evaluate((z) => {
       
      const ui = (window as any).__wp.useUiStore.getState();
      ui.setView2d({ ...ui.view2d, zoom: z });
    }, zoom);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { view2d: { zoom: number } } } } }).__wp.useUiStore.getState().view2d.zoom)).toBe(zoom);
    return wall.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: cs.strokeWidth, effect: cs.getPropertyValue('vector-effect'), stroke: cs.stroke, fill: cs.fill };
    });
  };
  const near = await strokeAt(220);
  const far = await strokeAt(40);
  expect(near.effect).toBe('non-scaling-stroke');
  expect(near.width).toBe('1.5px');
  expect(far).toEqual(near); // same width in screen pixels and same colours, zoomed in or out
  // colours resolve from the plan tokens (theme.css) – identical in light and dark
  expect(near.fill).toBe('rgb(59, 65, 71)'); // --color-plan-wall #3b4147
  expect(near.stroke).toBe('rgb(31, 35, 38)'); // --color-plan-wall-line #1f2326
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await wall.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(59, 65, 71)');
  expect(errors).toEqual([]);
});

test('3D overview navigation (#132): keys move the view, middle button turns it, dragging furniture keeps the view still', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500); // initial fit
  const cam = () => page.evaluate(() => (window as any).__wp.three.camera.position.toArray() as number[]);
  const moved = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // wait until a damped camera movement has come to rest
  const settled = () =>
    expect
      .poll(async () => {
        const a = await cam();
        await page.waitForTimeout(250);
        return moved(await cam(), a);
      }, { timeout: 15000 })
      .toBeLessThan(0.001);

  // short overview of the controls, with a link to all shortcuts
  const help = page.getByTestId('orbit-help');
  await help.getByText('Steuerung').click();
  await expect(help).toContainText('mittlere Maustaste');
  await help.getByRole('button', { name: 'Alle Tastenkürzel (?)' }).click();
  await expect(page.getByRole('dialog')).toContainText('3D-Übersicht: Kamera');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await help.getByText('Steuerung').click();

  // D held: the camera moves sideways in the floor plane (height unchanged); W is not the wall tool here
  await page.locator('[data-testid="scene3d"]').hover();
  const c0 = await cam();
  await page.keyboard.down('d');
  await expect.poll(async () => moved(await cam(), c0), { timeout: 15000 }).toBeGreaterThan(0.5);
  await page.keyboard.up('d');
  const c1 = await cam();
  expect(Math.abs(c1[1] - c0[1])).toBeLessThan(0.01);
  await page.keyboard.down('w');
  await expect.poll(async () => moved(await cam(), c1), { timeout: 15000 }).toBeGreaterThan(0.5);
  await page.keyboard.up('w');
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).not.toBe('wall');

  // middle button drag on a furniture item turns the view, the item stays where it is
  await page.getByRole('button', { name: 'Kamera zurücksetzen' }).click();
  await page.waitForTimeout(800);
  await settled();
  const p0 = await getProject(page);
  const bed = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-bed-160');
  let s = await worldToScreen3d(page, bed.x, 0.55, bed.y);
  const c2 = await cam();
  await page.mouse.move(s.x, s.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(s.x + 120, s.y, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => moved(await cam(), c2), { timeout: 15000 }).toBeGreaterThan(0.5);
  const after = (await getProject(page)).furniture.find((f: { id: string }) => f.id === bed.id);
  expect([after.x, after.y]).toEqual([bed.x, bed.y]);

  // left button drag on the item moves the item, the camera stays put
  await page.getByRole('button', { name: 'Kamera zurücksetzen' }).click();
  await page.waitForTimeout(800);
  await settled();
  s = await worldToScreen3d(page, bed.x, 0.55, bed.y);
  const c3 = await cam();
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 40, s.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === bed.id).x).not.toBe(bed.x);
  await page.waitForTimeout(500); // damping would show a late jump here
  expect(moved(await cam(), c3)).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('Möbel-Material: Standardmaterial wählen, in 3D anzeigen und speichern (#63)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const sofa = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const s = await planToScreen(page, sofa.x, sofa.y);
  await page.mouse.click(s.x, s.y);
  expect(await getSelection(page)).toEqual({ type: 'furniture', id: sofa.id });
  const right = page.locator('.panel.right');
  await expect(right.getByRole('combobox', { name: /^Material/ })).toHaveValue('auto');

  // one click on a standard material sets material and colour
  await right.getByRole('button', { name: 'Leder Cognac' }).click();
  await expect(right.getByRole('button', { name: 'Leder Cognac' })).toHaveAttribute('aria-pressed', 'true');
  await expect(right.getByRole('combobox', { name: /^Material/ })).toHaveValue('leather');
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id)).toMatchObject({ finish: 'leather', color: '#8a4f2a' });

  // the material alone can be changed, the colour stays
  await right.getByRole('combobox', { name: /^Material/ }).selectOption('wood');
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id)).toMatchObject({ finish: 'wood', color: '#8a4f2a' });

  // saved with the project
  await expect(page.locator('.save-state')).toHaveText('Gespeichert', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id)?.finish).toBe('wood');

  // „Automatisch“ removes the material again
  const s2 = await planToScreen(page, sofa.x, sofa.y);
  await page.mouse.click(s2.x, s2.y);
  await page.locator('.panel.right').getByRole('combobox', { name: /^Material/ }).selectOption('auto');
  await expect.poll(async () => 'finish' in (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id)).toBe(false);

  // the colour can be set back to the model's original colour as well (#187)
  const colorAuto = page.locator('.panel.right').getByRole('button', { name: 'Automatisch', exact: true });
  await expect(colorAuto).toBeEnabled();
  await colorAuto.click();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id).color).toBe(sofa.color);
  await expect(colorAuto).toHaveAttribute('aria-pressed', 'true');
  await expect(colorAuto).toBeDisabled();
  expect(errors).toEqual([]);
});

test('night without lamps: at 0:00 no light source shines in a room without lamps (#216)', async ({ page }) => {
  test.setTimeout(240_000); // realism rendering with software WebGL is slow
  const errors = collectErrors(page);
  await freshStart(page);
  await page.evaluate(() => {
    (window as any).__wp.useProjectStore.getState().apply((d: any) => {
      d.settings.quality = 'realism';
      d.settings.timeOfDay = 0;
      d.settings.lamps = 'auto';
      d.lights = [];
      d.furniture = d.furniture.filter((f: any) => !(f.model.type === 'procedural' && ['floor-lamp', 'table-lamp', 'pendant'].includes(f.model.shape)));
    });
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Math.abs((window as any).__wp.lightingHour?.() ?? 99)), { timeout: 60000 }).toBeLessThan(0.01);
  const shining = () =>
    page.evaluate(() => {
      let n = 0;
      (window as any).__wp.three.scene.traverse((o: any) => void ((o.isPointLight || o.isSpotLight) && o.intensity > 0.01 && n++));
      return n;
    });
  await expect.poll(shining, { timeout: 30000 }).toBe(0);
  // reflections are not lit either: handles and window panes do not glow in the dark
  const brightestReflection = () =>
    page.evaluate(() => {
      let max = 0;
      (window as any).__wp.three.scene.traverse((o: any) => {
        for (const m of [o.material].flat()) if (m?.envMap) max = Math.max(max, m.envMapIntensity);
      });
      return max;
    });
  await expect.poll(brightestReflection, { timeout: 30000 }).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('3D: Blick von außen zeigt Gebäude und Eingang und lässt sich umschalten (#92)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Außen' }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('exterior-entrance-label')).toBeVisible();
  await page.screenshot({ path: 'test-results/exterior-view.png' });
  await page.getByRole('button', { name: 'Außen' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('exterior-entrance-label')).toHaveCount(0);
  expect(errors).toEqual([]);
});
