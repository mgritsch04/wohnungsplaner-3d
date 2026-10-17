import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { getProject, getSelection, planToScreen } from './fixtures';

/*
 * Handy-Ansicht (#164): Touch-Bedienung in einer iPhone-großen, mobilen Chromium-Emulation
 * (hasTouch + isMobile). Touch-Gesten mit mehreren Fingern laufen über das Chrome-DevTools-
 * Protokoll (Input.dispatchTouchEvent) – so wie ein echter Finger, mit pointerType "touch".
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */

const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i];
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });

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
  await expect(page.locator('.app.phone')).toBeVisible();
  await expect(page.locator('input.project-name')).toHaveValue('Beispielwohnung');
  await page.waitForTimeout(500);
}

type Pt = { x: number; y: number };

/** Real touch input: one call per finger state (start → moves → end). */
class Fingers {
  private constructor(private cdp: CDPSession) {}
  static async on(page: Page) {
    return new Fingers(await page.context().newCDPSession(page));
  }
  private send(type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  }
  /** Move all fingers from `from` to `to` in `steps` steps. */
  async gesture(from: Pt[], to: Pt[], steps = 8) {
    await this.send('touchStart', from);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.send(
        'touchMove',
        from.map((p, k) => ({ x: p.x + (to[k].x - p.x) * t, y: p.y + (to[k].y - p.y) * t })),
      );
    }
    await this.send('touchEnd', []);
  }
  /** Press, drag and keep holding (for the walk stick); `release` lifts. */
  async hold(from: Pt, to: Pt) {
    await this.send('touchStart', [from]);
    for (let i = 1; i <= 5; i++) await this.send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 }]);
  }
  release() {
    return this.send('touchEnd', []);
  }
}

const center = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('Handy: Textauswahl, iOS-Kontextfenster und Seiten-Zoom sind aus, Eingabefelder bleiben bearbeitbar', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Details' }).tap();
  const text = page.locator('.panel.right').getByText('Gesamtfläche');
  await expect(text).toBeVisible();
  // CSS: no selection and no iOS callout on plain UI text and on the 3D view
  const style = (sel: string) =>
    page.evaluate((s) => {
      const cs = getComputedStyle(document.querySelector(s)!) as CSSStyleDeclaration & Record<string, string>;
      return { select: cs.userSelect || cs.webkitUserSelect, touchAction: cs.touchAction, fontSize: cs.fontSize };
    }, sel);
  expect((await style('.panel.right .panel-scroll')).select).toBe('none');
  expect((await style('.toolbar')).select).toBe('none');
  expect((await style('.scene3d')).touchAction).toBe('none');
  expect((await style('.app')).touchAction).toBe('manipulation');
  // (-webkit-touch-callout exists only in Safari – checked in src/ui/phoneCss.test.ts)
  // selectstart (what starts the iOS selection) is blocked on UI text, not in input fields
  const prevented = (sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)!;
      const ev = new Event('selectstart', { bubbles: true, cancelable: true });
      (el.firstChild ?? el).dispatchEvent(ev);
      return ev.defaultPrevented;
    }, sel);
  expect(await prevented('.panel.right .panel-scroll')).toBe(true);
  expect(await prevented('.scene3d')).toBe(true);
  expect(await prevented('input.project-name')).toBe(false);
  // dragging across panel text selects nothing
  const tb = (await text.boundingBox())!;
  await page.mouse.move(tb.x + 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 300, tb.y + 60, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
  // a long press on the 3D view must not open the browser menu
  const menuPrevented = await page.evaluate(() => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('.scene3d canvas')!.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(menuPrevented).toBe(true);
  // input fields: ≥ 16 px, so iOS does not zoom the page when one is tapped
  expect(parseFloat((await style('input.project-name')).fontSize)).toBeGreaterThanOrEqual(16);
  await page.getByRole('button', { name: 'Werkzeuge', exact: true }).tap();
  await page.locator('.panel.left .tabs button', { hasText: 'Katalog' }).tap();
  expect(parseFloat((await style('.panel.left input')).fontSize)).toBeGreaterThanOrEqual(16);
  // the project name can still be edited
  await page.locator('input.project-name').fill('Meine Wohnung');
  await expect.poll(async () => (await getProject(page)).name).toBe('Meine Wohnung');
  expect(errors).toEqual([]);
});

for (const width of [375, 430]) {
  test(`Handy ${width} px: Werkzeugleiste in zwei Zeilen, Menüs und Leisten bleiben im Bildschirm`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await freshStart(page);
    const tb = (await page.locator('.toolbar').boundingBox())!;
    expect(tb.height).toBeLessThan(110);
    const inside = async (sel: string) => {
      const boxes = await page.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect().toJSON()));
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(-0.5);
        expect(b.right).toBeLessThanOrEqual(width + 0.5);
      }
      return boxes.length;
    };
    expect(await inside('.toolbar button')).toBeGreaterThan(6);
    // no horizontal scrolling of the page
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // essential buttons are big enough to hit with a finger
    for (const name of ['Projekt ▾', 'Rückgängig', 'Mehr']) {
      const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(36);
    }
    for (const menu of ['Projekt ▾', 'Mehr']) {
      await page.getByRole('button', { name: menu, exact: true }).tap();
      await expect(page.locator('.toolbar .menu')).toBeVisible();
      await inside('.toolbar .menu');
      await inside('.toolbar .menu button');
      await page.getByRole('button', { name: menu, exact: true }).tap();
      await expect(page.locator('.toolbar .menu')).toHaveCount(0);
    }
    // quality switch moved into "Mehr" on the phone (not switched here: realism renders very
    // slowly in the software GPU of the test browser; the switch itself is the desktop one)
    await page.getByRole('button', { name: 'Mehr', exact: true }).tap();
    const quality = page.locator('.toolbar .menu').getByRole('group', { name: 'Qualität' });
    await expect(quality.getByRole('button', { name: 'Planung' })).toHaveAttribute('aria-pressed', 'true');
    await expect(quality.getByRole('button', { name: 'Realismus' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Mehr', exact: true }).tap();
    // sheet with five tabs: none is cut off – the row scrolls instead
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Werkzeuge' }).tap();
    const tabs = page.locator('.panel.left .tabs');
    await tabs.getByRole('button', { name: 'Import' }).scrollIntoViewIfNeeded();
    await expect(tabs.getByRole('button', { name: 'Import' })).toBeInViewport({ ratio: 0.9 });
    await inside('.mobile-bar button');
  });
}

test('Handy: Blatt schiebt die Ansicht hoch, Griff ändert die Höhe, 3D-Wohnung behält ihre Größe', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  // apparent size of the apartment: distance between two corners on screen
  const span = () =>
    page.evaluate(() => {
      const t = (window as any).__wp.three;
      const r = t.canvas.getBoundingClientRect();
      const p = (x: number, z: number) => {
        const v = t.camera.position.clone().set(x, 0, z).project(t.camera);
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      };
      const a = p(0, 0);
      const b = p(8.5, 4);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
  const before = await span();
  const ws0 = (await page.locator('.workspace').boundingBox())!;
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Werkzeuge' }).tap();
  const panel = page.locator('.panel.left');
  await expect(panel).toBeVisible();
  // the view moves up above the sheet instead of disappearing behind it
  const ws1 = (await page.locator('.workspace').boundingBox())!;
  const p1 = (await panel.boundingBox())!;
  expect(ws1.height).toBeLessThan(ws0.height * 0.65);
  expect(ws1.y + ws1.height).toBeLessThanOrEqual(p1.y + 1);
  await expect.poll(span).toBeGreaterThan(before * 0.9);
  expect(await span()).toBeLessThan(before * 1.1);
  // drag the grip up: the sheet grows; down: it shrinks
  const fingers = await Fingers.on(page);
  const grip = await center(page, '.panel.left .sheet-grip');
  await fingers.gesture([grip], [{ x: grip.x, y: grip.y - 150 }]);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(p1.height + 100);
  const grip2 = await center(page, '.panel.left .sheet-grip');
  await fingers.gesture([grip2], [{ x: grip2.x, y: grip2.y + 300 }]);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(p1.height - 50);
  // closing restores the full view and the original size
  // right after the grip gesture a tap can be swallowed while the sheet is still settling: tap again until it closes
  await expect(async () => {
    if (await panel.isVisible()) await page.getByRole('button', { name: 'Panel schließen' }).tap({ timeout: 2000 });
    await expect(panel).toBeHidden({ timeout: 1500 });
  }).toPass({ timeout: 10000 });
  await expect.poll(async () => (await page.locator('.workspace').boundingBox())!.height).toBeGreaterThan(ws0.height - 2);
  await expect.poll(span).toBeGreaterThan(before * 0.95);
  expect(await span()).toBeLessThan(before * 1.05);
  expect(errors).toEqual([]);
});

test('Handy: Auswahl-Leiste zeigt das Möbel und dreht, dupliziert, löscht per Antippen', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const sofa = (await getProject(page)).furniture.find((f: any) => f.name === 'Sofa 3-Sitzer');
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa.id);
  const bar = page.getByRole('toolbar', { name: 'Auswahl' });
  await expect(bar).toContainText('Sofa 3-Sitzer');
  await bar.getByRole('button', { name: 'Nach rechts drehen (15°)' }).tap();
  await expect.poll(async () => (await getProject(page)).furniture.find((f: any) => f.id === sofa.id).rotation).not.toBe(sofa.rotation);
  const n = (await getProject(page)).furniture.length;
  await bar.getByRole('button', { name: 'Duplizieren' }).tap();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(n + 1);
  const copy = (await getSelection(page)).id;
  expect(copy).not.toBe(sofa.id);
  await bar.getByRole('button', { name: 'Löschen' }).tap();
  await expect.poll(async () => (await getProject(page)).furniture.length).toBe(n);
  await expect(bar).toHaveCount(0);
  // "Details" opens the properties sheet of the selection
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa.id);
  await bar.getByRole('button', { name: 'Details' }).tap();
  await expect(page.locator('.panel.right')).toBeVisible();
  await expect(page.locator('.panel.right').getByRole('heading', { name: /Sofa 3-Sitzer/ }).or(page.locator('.panel.right input[value="Sofa 3-Sitzer"]')).first()).toBeVisible();
  await page.getByRole('button', { name: 'Panel schließen' }).tap();
  await bar.getByRole('button', { name: 'Auswahl aufheben' }).tap();
  expect(await getSelection(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('Handy 2D: zwei Finger zoomen und verschieben den Plan, ohne Möbel zu bewegen; ein Finger verschiebt Möbel', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).tap();
  await expect(page.locator('[data-testid="editor2d"] svg')).toBeVisible();
  await page.waitForTimeout(500);
  const proj = await getProject(page);
  const sofa = proj.furniture.find((f: any) => f.name === 'Sofa 3-Sitzer');
  const view = () => page.evaluate(() => (window as any).__wp.useUiStore.getState().view2d);
  const v0 = await view();
  const fingers = await Fingers.on(page);
  // both fingers start on the sofa and spread apart: zoom in, the sofa stays where it is
  const s = await planToScreen(page, sofa.x, sofa.y);
  await fingers.gesture(
    [{ x: s.x - 15, y: s.y }, { x: s.x + 15, y: s.y }],
    [{ x: s.x - 90, y: s.y }, { x: s.x + 90, y: s.y }],
  );
  await expect.poll(async () => (await view()).zoom).toBeGreaterThan(v0.zoom * 3);
  let after = (await getProject(page)).furniture.find((f: any) => f.id === sofa.id);
  expect([after.x, after.y]).toEqual([sofa.x, sofa.y]);
  // the plan point between the fingers stays between them
  const s2 = await planToScreen(page, sofa.x, sofa.y);
  expect(Math.abs(s2.x - s.x)).toBeLessThan(4);
  expect(Math.abs(s2.y - s.y)).toBeLessThan(4);
  // pinch in again and pan with two fingers
  const v1 = await view();
  await fingers.gesture(
    [{ x: 100, y: 300 }, { x: 260, y: 300 }],
    [{ x: 160, y: 360 }, { x: 200, y: 360 }],
  );
  await expect.poll(async () => (await view()).zoom).toBeLessThan(v1.zoom / 2);
  after = (await getProject(page)).furniture.find((f: any) => f.id === sofa.id);
  expect([after.x, after.y]).toEqual([sofa.x, sofa.y]);
  // one finger on the sofa still moves it
  await page.evaluate(() => (window as any).__wp.useUiStore.getState().requestFit());
  await page.waitForTimeout(300);
  const s3 = await planToScreen(page, sofa.x, sofa.y);
  await fingers.gesture([s3], [{ x: s3.x + 30, y: s3.y }], 10);
  await expect.poll(async () => (await getProject(page)).furniture.find((f: any) => f.id === sofa.id).x).not.toBe(sofa.x);
  // one finger on empty space pans
  const v2 = await view();
  await fingers.gesture([{ x: 40, y: 200 }], [{ x: 140, y: 200 }]);
  await expect.poll(async () => (await view()).cx).toBeLessThan(v2.cx - 0.5);
  expect(errors).toEqual([]);
});

test('Handy: Begehen mit Stick und Finger – gehen, umsehen, Möbel per Tippen auswählen', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Begehen' }).tap();
  const stick = page.getByTestId('touch-stick');
  await expect(stick).toBeVisible();
  await expect(page.locator('.walk-overlay')).toContainText('Stick: gehen');
  await page.waitForTimeout(500);
  const pose = () =>
    page.evaluate(() => {
      const c = (window as any).__wp.three.camera;
      return { x: c.position.x as number, z: c.position.z as number, yaw: c.rotation.y as number, fov: c.fov as number };
    });
  const p0 = await pose();
  expect(p0.fov).toBeCloseTo(70, 0);
  // push the stick forward and hold: the walker moves
  const fingers = await Fingers.on(page);
  const c = await center(page, '[data-testid="touch-stick"]');
  await fingers.hold(c, { x: c.x, y: c.y - 60 });
  await expect.poll(async () => {
    const p = await pose();
    return Math.hypot(p.x - p0.x, p.z - p0.z);
  }).toBeGreaterThan(0.3);
  await fingers.release();
  await page.waitForTimeout(200);
  const p1 = await pose();
  await page.waitForTimeout(400);
  const p2 = await pose();
  expect(Math.hypot(p2.x - p1.x, p2.z - p1.z)).toBeLessThan(0.02); // released: stands still
  // drag a finger across the view: looks around, does not walk
  const canvas = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;
  const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await fingers.gesture([{ x: mid.x + 60, y: mid.y }], [{ x: mid.x - 60, y: mid.y }]);
  await expect.poll(async () => Math.abs((await pose()).yaw - p2.yaw)).toBeGreaterThan(0.2);
  const p3 = await pose();
  expect(Math.hypot(p3.x - p2.x, p3.z - p2.z)).toBeLessThan(0.02);
  // aim at the sofa and tap: it is selected; "Tragen" picks it up, "Absetzen" puts it down
  const sofa = (await getProject(page)).furniture.find((f: any) => f.name === 'Sofa 3-Sitzer');
  await page.evaluate(
    ([sx, sy]) => {
      const wp = (window as any).__wp;
      const cam = wp.three.camera.position;
      const yaw = Math.atan2(-(sx - cam.x), -(sy - cam.z));
      const dist = Math.hypot(sx - cam.x, sy - cam.z);
      wp.walk.look(yaw, -Math.atan2(cam.y - 0.3, dist));
    },
    [sofa.x, sofa.y],
  );
  await page.waitForTimeout(300);
  await page.touchscreen.tap(mid.x, mid.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(sofa.id);
  // a finger drag that starts on the sofa only looks around – the sofa stays put
  const yawBefore = (await pose()).yaw;
  await fingers.gesture([mid], [{ x: mid.x + 80, y: mid.y }]);
  await expect.poll(async () => Math.abs((await pose()).yaw - yawBefore)).toBeGreaterThan(0.1);
  const still = (await getProject(page)).furniture.find((f: any) => f.id === sofa.id);
  expect([still.x, still.y]).toEqual([sofa.x, sofa.y]);
  await page.getByRole('button', { name: 'Tragen' }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBe(sofa.id);
  await page.getByRole('button', { name: 'Absetzen' }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBeNull();
  // crouch button
  await page.getByRole('button', { name: 'Ducken' }).tap();
  await expect(page.getByTestId('walk-duck')).toBeVisible();
  // back to the overview: no stick, normal field of view
  await page.getByRole('button', { name: 'Übersicht' }).tap();
  await expect(stick).toHaveCount(0);
  await expect.poll(async () => (await pose()).fov).toBeCloseTo(50, 0);
  expect(errors).toEqual([]);
});

test('Handy 3D: Möbel per Finger antippen und ziehen, ein Finger auf leerer Fläche dreht die Ansicht', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
  // the bed is visible from the start view (the sofa hides behind the front wall)
  const bed = (await getProject(page)).furniture.find((f: any) => f.catalogId === 'generic-bed-160');
  const at = () =>
    page.evaluate(
      ([x, z]) => {
        const t = (window as any).__wp.three;
        const v = t.camera.position.clone().set(x, 0.5, z).project(t.camera);
        const r = t.canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      [bed.x, bed.y],
    );
  const fingers = await Fingers.on(page);
  const p = await at();
  await fingers.gesture([p], [p], 1);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(bed.id);
  const cam0 = await page.evaluate(() => (window as any).__wp.three.camera.position.clone());
  await fingers.gesture([p], [{ x: p.x - 40, y: p.y + 10 }], 10);
  await expect.poll(async () => (await getProject(page)).furniture.find((f: any) => f.id === bed.id).x).not.toBe(bed.x);
  const cam1 = await page.evaluate(() => (window as any).__wp.three.camera.position.clone());
  expect(Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y, cam1.z - cam0.z)).toBeLessThan(0.01); // view did not turn
  // empty floor area at the top of the view: one finger turns the view
  const canvas = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;
  await fingers.gesture([{ x: canvas.x + 60, y: canvas.y + 120 }], [{ x: canvas.x + 260, y: canvas.y + 120 }]);
  await expect
    .poll(async () => {
      const c = await page.evaluate(() => (window as any).__wp.three.camera.position.clone());
      return Math.hypot(c.x - cam1.x, c.z - cam1.z);
    })
    .toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});
