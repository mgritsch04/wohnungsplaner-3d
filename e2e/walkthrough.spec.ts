/* eslint-disable @typescript-eslint/no-explicit-any -- test-only access to the app stores */
import { expect, test, type Page } from '@playwright/test';
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

/** Names of the collision marker objects currently in the 3D scene. */
async function collisionMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Obj = { name: string; traverse: (f: (o: Obj) => void) => void };
    const t = (window as unknown as { __wp: { three: { scene: { getObjectByName: (n: string) => Obj | undefined } } } }).__wp.three;
    const out: string[] = [];
    t.scene.getObjectByName('collision-markers')?.traverse((o) => {
      if (o.name.startsWith('collision') && o.name !== 'collision-markers') out.push(o.name);
    });
    return out;
  });
}


test('walkthrough mode can be entered and left', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.locator('.walk-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('walkthrough: body height 163 cm by default (eyes 11 cm lower), adjustable live and saved; crosshair only while walking (#23, #22)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('crosshair')).toHaveCount(0); // not in the overview
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const camY = () =>
    page.evaluate(() => {
       
      return (window as any).__wp.three.camera.position.y as number;
    });
  await expect.poll(camY).toBeCloseTo(1.52, 3);
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  const field = page.getByLabel('Körpergröße');
  await expect(field).toHaveValue('163');
  await field.fill('180');
  await field.press('Enter');
  await expect.poll(camY).toBeCloseTo(1.69, 3); // immediately, still walking
  await expect(page.getByTestId('eye-heights')).toHaveText('Augenhöhe beim Begehen 169 cm, im Sitzen 133 cm');
  await expect(page.locator('.walk-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('crosshair')).toHaveCount(0);
  // saved with the project
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).settings.bodyHeight).toBeCloseTo(1.8, 6);
  expect(errors).toEqual([]);
});

test('walkthrough: look at furniture, select it, carry it with G and put it down (#39)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const before = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  // stand still and look straight at the coffee table (yaw from the camera position)
  const look = await page.evaluate(
    ([tx, ty]) => {
      const wp = (window as any).__wp;
      const c = wp.three.camera.position;
      const yaw = Math.atan2(-(tx - c.x), -(ty - c.z));
      const dist = Math.hypot(tx - c.x, ty - c.z);
      wp.walk.look(yaw, -Math.atan2(c.y - 0.3, dist));
      return { dist };
    },
    [before.x, before.y],
  );
  expect(look.dist).toBeLessThan(6);
  await expect.poll(() => page.evaluate(() => (window as any).__wp.walk.target())).toBe(before.id);
  // G picks it up …
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBe(before.id);
  await expect(page.locator('.walk-overlay')).toContainText('trägst');
  // … turn a bit: it follows the gaze (with the usual collision rules)
  await page.evaluate(() => {
    const wp = (window as any).__wp;
    const e = wp.three.camera.rotation;
    wp.walk.look(e.y + 0.35, e.x);
  });
  await expect
    .poll(async () => {
      const t = (await getProject(page)).furniture.find((f: { id: string }) => f.id === before.id);
      return Math.hypot(t.x - before.x, t.y - before.y);
    })
    .toBeGreaterThan(0.2);
  const pastBefore = await page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length);
  // G again puts it down: one undo step
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).__wp.useUiStore.getState().walkCarry)).toBeNull();
  expect(await page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length)).toBe(pastBefore + 1);
  // G must not switch the 2D tool while walking
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  expect(errors).toEqual([]);
});

test('2D plan shows where you are while walking in 3D (2D + 3D view only) (#19)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D + 3D' }).click();
  await expect(page.getByTestId('walk-marker')).toHaveCount(0);
  await page.getByRole('button', { name: 'Begehen' }).click();
  const marker = page.getByTestId('walk-marker');
  await expect(marker).toHaveCount(1);
  const dot = async () => {
    const b = (await marker.locator('circle').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // the dot sits where the camera is
  const cam = await page.evaluate(() => (window as any).__wp.three.camera.position);
  const expected = await planToScreen(page, cam.x, cam.z);
  const d0 = await dot();
  expect(Math.hypot(d0.x - expected.x, d0.y - expected.y)).toBeLessThan(4);
  // walk forward: the dot follows live. Hold W until the camera has actually moved – with software
  // rendering on a busy CI runner a fixed key-down time can cover only a few frames
  const camNow = () => page.evaluate(() => (window as any).__wp.three.camera.position);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => { const c = await camNow(); return Math.hypot(c.x - cam.x, c.z - cam.z); }, { timeout: 15000 }).toBeGreaterThan(0.3);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => {
    const d = await dot();
    return Math.hypot(d.x - d0.x, d.y - d0.y);
  }).toBeGreaterThan(5);
  // … and sits where the camera now is
  const cam1 = await camNow();
  const expected1 = await planToScreen(page, cam1.x, cam1.z);
  await expect.poll(async () => { const d = await dot(); return Math.hypot(d.x - expected1.x, d.y - expected1.y); }).toBeLessThan(4);
  // 3D only or overview: no marker
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(marker).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('walkthrough: C toggles crouching (lower camera, slower), C again stands up; X and leaving end it (#20, #47)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  const camY = () => page.evaluate(() => (window as any).__wp.three.camera.position.y as number);
  await expect.poll(camY).toBeCloseTo(1.52, 3);
  // one press crouches – and the camera stays down after releasing C (toggle, #47)
  await page.keyboard.press('KeyC');
  await expect.poll(camY).toBeLessThan(1.0);
  await expect(page.getByTestId('walk-duck')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await camY()).toBeLessThan(1.0);
  await expect(page.getByTestId('walk-duck')).toBeVisible();
  // C must not trigger anything in the 2D tools while walking
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  // crouched, walking is slower (same factor as seated)
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().walkDuck)).toBe(true);
  // pressing C again stands up
  await page.keyboard.press('KeyC');
  await expect.poll(camY).toBeCloseTo(1.52, 3);
  await expect(page.getByTestId('walk-duck')).toHaveCount(0);
  // sitting down (X) ends crouching; standing up again (X) does not crouch
  await page.keyboard.press('KeyC');
  await expect.poll(camY).toBeLessThan(1.0);
  await page.keyboard.press('KeyX');
  await expect(page.getByTestId('walk-duck')).toHaveCount(0);
  await expect.poll(camY).toBeCloseTo(1.21, 3);
  await page.keyboard.press('KeyX');
  await expect.poll(camY).toBeCloseTo(1.52, 3);
  // leaving the walkthrough resets crouching
  await page.keyboard.press('KeyC');
  await expect.poll(camY).toBeLessThan(1.0);
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('walk-duck')).toHaveCount(0);
  await expect.poll(camY).toBeCloseTo(1.52, 3);
  expect(errors).toEqual([]);
});

test('mouse sensitivity: setting scales walk look and orbit rotation, persists in the project', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  const slider = page.getByLabel('Mausempfindlichkeit');
  await expect(slider).toHaveValue('1');
   
  const setSens = (v: number) => page.evaluate((x) => (window as any).__wp.useProjectStore.getState().apply((d: any) => (d.settings.mouseSensitivity = x)), v);
  const camYaw = () =>
    page.evaluate(() => {
       
      return (window as any).__wp.three.camera.rotation.y as number;
    });
  const canvas = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  // walk mode: the same mouse movement turns the view proportionally to the setting
  await page.getByRole('button', { name: 'Begehen' }).click();
  await page.waitForTimeout(800);
  // headless Chromium reports no movementX for synthetic moves under pointer lock, so emulate
  // a locked pointer and send the same relative mouse movement for every setting
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="scene3d"] canvas');
    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  });
  const lookTurn = async (sens: number) => {
    await setSens(sens);
    await page.waitForTimeout(200);
    const y0 = await camYaw();
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 })));
    // the camera follows in the next rendered frame, which can take a while on a busy CI runner
    await expect.poll(async () => Math.abs((await camYaw()) - y0), { timeout: 10_000 }).toBeGreaterThan(1e-4);
    return Math.abs((await camYaw()) - y0);
  };
  const low = await lookTurn(0.5);
  const def = await lookTurn(1);
  const high = await lookTurn(2);
  await page.evaluate(() => delete (document as unknown as Record<string, unknown>).pointerLockElement);
  expect(def).toBeCloseTo(100 * 0.0022, 3); // unchanged default feel
  expect(low / def).toBeCloseTo(0.5, 1);
  expect(high / def).toBeCloseTo(2, 1);

  // orbit: azimuth change scales as well
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await page.waitForTimeout(800);
  const azimuth = () =>
    page.evaluate(() => {
       
      const c = (window as any).__wp.three.camera.position;
      return Math.atan2(c.x - 4.3, c.z - 2);
    });
  const orbitTurn = async (sens: number) => {
    await setSens(sens);
    await page.getByRole('button', { name: 'Kamera zurücksetzen' }).click();
    await page.waitForTimeout(600);
    const a0 = await azimuth();
    await page.mouse.move(cx, cy + 150);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 150, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1500); // damping settles
    return Math.abs((await azimuth()) - a0);
  };
  const oLow = await orbitTurn(0.5);
  const oHigh = await orbitTurn(2);
  expect(oHigh).toBeGreaterThan(oLow * 2.5);

  // the UI slider writes the setting; one undo step per drag; it is saved with the project
  await slider.fill('1.5');
  expect((await getProject(page)).settings.mouseSensitivity).toBe(1.5);
  await page.getByRole('button', { name: 'Standard' }).click();
  expect((await getProject(page)).settings.mouseSensitivity).toBe(1);
  expect(errors).toEqual([]);
});

test('walk look: a single huge pointer-lock delta does not flip the view; editing while walking keeps the view (#142)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  // start the walk in the second room, so a reset to the default start would be visible
  await page.evaluate(() => {
     
    const wp = (window as any).__wp;
    wp.useUiStore.getState().setSelection({ type: 'room', id: wp.useProjectStore.getState().project.rooms[1].id });
  });
  await page.getByRole('button', { name: 'Begehen' }).click();
  await page.waitForTimeout(800);
  const camYaw = () =>
     
    page.evaluate(() => (window as any).__wp.three.camera.rotation.y as number);
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="scene3d"] canvas');
    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  });
  const y0 = await camYaw();
  // slow look to the left with one spurious 1400 px event in between (≈ 175° at the default speed)
  await page.evaluate(() => {
    for (const dx of [4, 5, 4, 1400, 5, 4, 4]) document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 }));
  });
  // the camera follows in the next rendered frame, which can take a while on a busy CI runner
  await expect.poll(async () => Math.abs((await camYaw()) - y0), { timeout: 10_000 }).toBeGreaterThan(1e-4);
  const turned = Math.abs((await camYaw()) - y0);
  expect(turned).toBeCloseTo(26 * 0.0022, 3); // only the small moves count
  // a real fast move (several large events in a row) still turns the view
  await page.evaluate(() => {
    for (const dx of [250, 260, 270]) document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 }));
  });
  await expect.poll(async () => Math.abs((await camYaw()) - y0), { timeout: 10_000 }).toBeGreaterThan(turned + 500 * 0.0022);

  // a change to the plan while walking (here: selection cleared, a door opened) keeps position and view direction
  const pose = () =>
     
    page.evaluate(() => { const c = (window as any).__wp.three.camera; return { x: c.position.x, z: c.position.z, yaw: c.rotation.y }; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  const before = await pose();
  await page.evaluate(() => {
     
    const wp = (window as any).__wp;
    wp.useUiStore.getState().setSelection(null);
    const st = wp.useProjectStore.getState();
    const door = st.project.openings.find((o: { kind: string }) => o.kind === 'door');
     
    st.apply((d: any) => { const o = d.openings.find((x: { id: string }) => x.id === door.id); o.open = !o.open; });
  });
  await page.waitForTimeout(400);
  const after = await pose();
  expect(after.yaw).toBeCloseTo(before.yaw, 3);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
  await page.evaluate(() => delete (document as unknown as Record<string, unknown>).pointerLockElement);
  expect(errors).toEqual([]);
});

test('3D: doors and windows open/close – double-click, O, click while walking; one undo step each, saved, collision follows (#21)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const inner = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6); // living room ↔ bedroom
  const entrance = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'door' && Math.abs(o.width - 1.0) < 1e-6);
  const window1 = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6); // living room, north
  expect([inner.open, entrance.open, window1.open]).toEqual([true, true, false]);
  const openOf = async (id: string) => (await getProject(page)).openings.find((o: { id: string }) => o.id === id).open as boolean;
  const past = () => page.evaluate(() => (window as any).__wp.useProjectStore.getState().past.length as number);
  /** World centre (plan x/y, height) of the first leaf/sash of an opening, as currently drawn. */
  const leafCenter = (id: string) =>
    page.evaluate((oid) => {
      const t = (window as any).__wp.three;
      const pivot = t.scene.getObjectByName(`leaf:${oid}:0`);
      const v = pivot.children[0].getWorldPosition(t.camera.position.clone());
      return { x: v.x as number, y: v.z as number, h: v.y as number };
    }, id);
  /**
   * Leaf position once its open/close animation has finished. The animation advances at most
   * 0.1 s per frame, so with software rendering under load (few FPS) it takes noticeably longer
   * than its nominal ~0.6 s – aiming at a leaf still in motion misses the thin leaf.
   */
  const restingLeaf = async (id: string) => {
    let last = await leafCenter(id);
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const now = await leafCenter(id);
        const moved = Math.hypot(now.x - last.x, now.y - last.y);
        last = now;
        return moved;
      })
      .toBeLessThan(0.001);
    return last;
  };

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Schnitt' }).click(); // look into the rooms
  await page.waitForTimeout(2000);
  // the open inner door leaf stands in the living room (wall at x = 5.06)
  const openLeaf = await restingLeaf(inner.id);
  expect(openLeaf.x).toBeLessThan(4.8);
  const s = await worldToScreen3d(page, openLeaf.x, 0.8, openLeaf.y);
  // a single click only selects it …
  await page.mouse.click(s.x, s.y);
  await expect.poll(() => getSelection(page)).toEqual({ type: 'opening', id: inner.id });
  expect(await openOf(inner.id)).toBe(true);
  // … a double-click closes it: one undo step, the leaf turns into the wall opening
  const p1 = await past();
  await page.mouse.dblclick(s.x, s.y);
  await expect.poll(() => openOf(inner.id)).toBe(false);
  expect(await past()).toBe(p1 + 1);
  await expect.poll(async () => (await leafCenter(inner.id)).x).toBeGreaterThan(4.95);
  await expect(page.getByLabel('Tür geöffnet')).not.toBeChecked();
  await page.screenshot({ path: 'test-results/doors-3d-closed.png' });
  // O opens the selected door again
  await page.keyboard.press('o');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p1 + 2);
  await expect.poll(async () => (await leafCenter(inner.id)).x).toBeLessThan(4.7);
  await expect(page.getByLabel('Tür geöffnet')).toBeChecked();
  // undo, step by step
  await page.keyboard.press('Control+z');
  await expect.poll(() => openOf(inner.id)).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p1);

  // collision follows the leaf: sofa in the opened entrance door leaf → error; door closed → only the swing warning
  const sofaId: string = await page.evaluate(() => {
    const st = (window as any).__wp.useProjectStore.getState();
    const sofa = st.project.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
    st.apply((d: { furniture: { id: string; x: number }[] }) => void (d.furniture.find((f) => f.id === sofa.id)!.x = 1.7));
    return sofa.id;
  });
  await expect.poll(() => collisionMarkers(page)).toContain(`collision-issue:${sofaId}:door-leaf:${entrance.id}`);
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'opening', id }), entrance.id);
  await page.keyboard.press('o');
  await expect.poll(() => openOf(entrance.id)).toBe(false);
  await expect.poll(() => collisionMarkers(page)).not.toContain(`collision-issue:${sofaId}:door-leaf:${entrance.id}`);
  expect(await collisionMarkers(page)).toContain(`collision-issue:${sofaId}:door-swing:${entrance.id}`);

  // walkthrough: the crosshair aims at a door/window, a click (or O) opens/closes it
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  const lookAt = (x: number, y: number, h: number) =>
    page.evaluate(
      ([tx, ty, th]) => {
        const wp = (window as any).__wp;
        const c = wp.three.camera.position;
        const dist = Math.hypot(tx - c.x, ty - c.z);
        wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, dist));
      },
      [x, y, h] as const,
    );
  const target = () => page.evaluate(() => (window as any).__wp.walk.targetOpening() as string | null);
  const leaf = await restingLeaf(inner.id); // the undo above re-opened it – wait until it stands still
  await lookAt(leaf.x, leaf.y, 1.0);
  await expect.poll(target).toBe(inner.id);
  const p2 = await past();
  await page.evaluate(() => (window as any).__wp.walk.pickOrDrop()); // = click with captured mouse
  await expect.poll(() => openOf(inner.id)).toBe(false);
  expect(await past()).toBe(p2 + 1);
  expect(await getSelection(page)).toEqual({ type: 'opening', id: entrance.id }); // the click does not change the selection
  // the closed door now fills the doorway: aim at it and press O
  await restingLeaf(inner.id);
  await lookAt(5.0, 2.0, 1.0);
  await expect.poll(target).toBe(inner.id);
  await page.keyboard.press('o');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  expect(await past()).toBe(p2 + 2);
  expect(await openOf(entrance.id)).toBe(false); // O acted on the door in sight, not on the selected one
  // the living-room window: the sash opens into the room
  const glass = await restingLeaf(window1.id);
  await lookAt(glass.x, glass.y, 1.6);
  await expect.poll(target).toBe(window1.id);
  await page.evaluate(() => (window as any).__wp.walk.pickOrDrop());
  await expect.poll(() => openOf(window1.id)).toBe(true);
  await expect.poll(async () => (await leafCenter(window1.id)).y).toBeGreaterThan(0.25);
  await page.screenshot({ path: 'test-results/doors-3d-walk-window-open.png' });
  // walking keys and O must not reach the 2D tools
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  await page.getByRole('button', { name: 'Übersicht' }).click();

  // saved with the project
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).openings.find((o: { id: string }) => o.id === entrance.id)?.open).toBe(false);
  const after = await getProject(page);
  expect(after.openings.find((o: { id: string }) => o.id === inner.id).open).toBe(true);
  expect(after.openings.find((o: { id: string }) => o.id === window1.id).open).toBe(true);
  expect(errors).toEqual([]);
});

test('walkthrough: E opens/closes the door or window in sight; in the overview E still rotates the selection (#107)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const window1 = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6); // living room, north
  const inner = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
  const table = p0.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  expect([window1.open, inner.open]).toEqual([false, true]);
  const openOf = async (id: string) => (await getProject(page)).openings.find((o: { id: string }) => o.id === id).open as boolean;
  const rotOf = async (id: string) => (await getProject(page)).furniture.find((f: { id: string }) => f.id === id).rotation as number;
  const leafCenter = (id: string) =>
    page.evaluate((oid) => {
      const t = (window as any).__wp.three;
      const pivot = t.scene.getObjectByName(`leaf:${oid}:0`);
      const v = pivot.children[0].getWorldPosition(t.camera.position.clone());
      return { x: v.x as number, y: v.z as number };
    }, id);
  const restingLeaf = async (id: string) => {
    let last = await leafCenter(id);
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const now = await leafCenter(id);
        const moved = Math.hypot(now.x - last.x, now.y - last.y);
        last = now;
        return moved;
      })
      .toBeLessThan(0.001);
    return last;
  };
  const lookAt = (x: number, y: number, h: number) =>
    page.evaluate(
      ([tx, ty, th]) => {
        const wp = (window as any).__wp;
        const c = wp.three.camera.position;
        wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
      },
      [x, y, h] as const,
    );
  const target = () => page.evaluate(() => (window as any).__wp.walk.targetOpening() as string | null);
  // a selected piece of furniture: F opens, and Q/E rotate it (#257)
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), table.id);
  const rot0 = await rotOf(table.id);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  // the closed living-room window: F opens it …
  const glass = await restingLeaf(window1.id);
  await lookAt(glass.x, glass.y, 1.6);
  await expect.poll(target).toBe(window1.id);
  await page.keyboard.press('f');
  await expect.poll(() => openOf(window1.id)).toBe(true);
  await restingLeaf(window1.id);
  await page.screenshot({ path: 'test-results/walk-e-opens-window.png' });
  // … and F on the opened sash closes it again
  const sash = await restingLeaf(window1.id);
  await lookAt(sash.x, sash.y, 1.6);
  await expect.poll(target).toBe(window1.id);
  await page.keyboard.press('f');
  await expect.poll(() => openOf(window1.id)).toBe(false);
  // the open inner door: F closes it; O still works, too
  const leaf = await restingLeaf(inner.id);
  await lookAt(leaf.x, leaf.y, 1.0);
  await expect.poll(target).toBe(inner.id);
  await page.keyboard.press('f');
  await expect.poll(() => openOf(inner.id)).toBe(false);
  await restingLeaf(inner.id);
  await lookAt(5.0, 2.0, 1.0);
  await expect.poll(target).toBe(inner.id);
  await page.keyboard.press('o');
  await expect.poll(() => openOf(inner.id)).toBe(true);
  // while walking, F/O did not rotate the selected table nor reach the 2D tools; E no longer opens (#257)
  expect(await rotOf(table.id)).toBeCloseTo(rot0, 6);
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().tool)).toBe('select');
  const openBefore = await openOf(inner.id);
  await page.keyboard.press('e');
  await expect.poll(() => rotOf(table.id)).toBeCloseTo(rot0 + Math.PI / 12, 6);
  expect(await openOf(inner.id)).toBe(openBefore);
  await page.keyboard.press('q');
  await expect.poll(() => rotOf(table.id)).toBeCloseTo(rot0, 6);
  // a click into the void (no furniture, door or window under the crosshair) clears the selection
  await page.evaluate((id) => (window as any).__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), table.id);
  let void_ = false;
  for (let i = 0; i < 16 && !void_; i++) {
    await page.evaluate((yaw) => (window as any).__wp.walk.look(yaw, 0.9), (i * Math.PI) / 8);
    await page.waitForTimeout(150);
    void_ = (await target()) === null && (await page.evaluate(() => (window as any).__wp.walk.target())) === null;
  }
  expect(void_).toBe(true);
  await page.evaluate(() => (window as any).__wp.walk.pickOrDrop());
  expect(await getSelection(page)).toBeNull();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  expect(await openOf(window1.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('keyboard overview: "?" opens all shortcuts (2D, 3D, walking), Esc closes (#59)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Hilfe & Tastenkürzel' });
  await expect(dialog).toBeVisible();
  for (const text of ['Werkzeuge', '3D-Begehung', 'Ducken', 'Möbel tragen / absetzen', 'Möbel kopieren / einfügen', 'Diese Übersicht öffnen']) await expect(dialog).toContainText(text);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('a new empty project starts without the measuring line and walking path of the previous project (#133)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  const plan = page.locator('[data-testid="editor2d"]');
  const clickAt = async (x: number, y: number) => {
    const s = await planToScreen(page, x, y);
    await page.mouse.click(s.x, s.y);
  };
  // a measuring line (M) …
  await page.keyboard.press('m');
  await clickAt(1, 0.8);
  await clickAt(3, 0.8);
  await expect(plan.getByTestId('measure-line')).toHaveCount(1);
  // … and a walking path (L), the tool stays active
  await page.keyboard.press('l');
  await clickAt(1, 0.8);
  await clickAt(5.7, 3);
  await expect(plan.getByTestId('walk-path-line')).toBeVisible();
  // Projekt → „Neues leeres Projekt“: nothing of it is left
  await page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await page.getByRole('button', { name: 'Neu anlegen' }).click();
  await expect.poll(async () => (await getProject(page)).walls.length).toBe(0);
  await expect(plan.getByTestId('measure-line')).toHaveCount(0);
  await expect(plan.getByTestId('walk-path')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().measurements.length)).toBe(0);
  // a measurement in the new project works as usual (the start card would cover the plan)
  await page.getByTestId('start-card').getByRole('button', { name: 'Startkarte schließen' }).click();
  await page.keyboard.press('m');
  await clickAt(0, 0);
  await clickAt(2, 0);
  await expect(plan.getByTestId('measure-line')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('measures the walking path from the living room to the bedroom and clears it with Esc (#67)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.locator('.panel.left').getByRole('button', { name: /Laufweg/ }).click();
  const a = { x: 1, y: 0.8 }; // living room
  const b = { x: 5.7, y: 3 }; // bedroom – the straight line hits the wall next to the door
  for (const p of [a, b]) {
    const s = await planToScreen(page, p.x, p.y);
    await page.mouse.click(s.x, s.y);
  }
  const plan = page.locator('[data-testid="editor2d"]');
  await expect(plan.getByTestId('walk-path-line')).toBeVisible();
  const label = plan.getByTestId('walk-path-length');
  await expect(label).toHaveText(/^\d+,\d{2} m$/);
  const length = Number(await label.getAttribute('data-length-m'));
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  expect(length).toBeGreaterThan(straight + 0.05); // detour through the door, around furniture
  expect(length).toBeLessThan(straight * 1.6);
  expect(await getProject(page)).not.toHaveProperty('walkPath'); // display only, nothing stored
  // the 3D view shows it as a floor line
  const segments3d = () =>
    page.evaluate(() => {
       
      const scene = (window as any).__wp.three.scene;
      return scene.getObjectByName('walk-path')?.children.length ?? 0;
    });
  await expect.poll(segments3d).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(plan.getByTestId('walk-path')).toHaveCount(0);
  await expect.poll(segments3d).toBe(0);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('camera bookmarks: save the view, jump back by click and Alt+1, kept after reload, walk bookmark switches mode (#55)', async ({ page }) => {
  test.setTimeout(120_000); // many 3D transitions; slow under software rendering on a busy CI runner
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForTimeout(1000);
  type V = { x: number; y: number; z: number };
  const camPos = (): Promise<V> =>
    page.evaluate(() => {
      const c = (window as any).__wp.three.camera.position;
      return { x: c.x, y: c.y, z: c.z };
    });
  const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const cameraMode = () => page.evaluate(() => (window as any).__wp.useUiStore.getState().cameraMode as string);
  const menu = page.getByTestId('bookmarks-menu');
  const toggleMenu = () => menu.getByRole('button', { name: /^Ansichten/ }).click();
  const saveAs = async (name: string) => {
    await menu.getByRole('button', { name: 'Aktuelle Ansicht speichern …' }).click();
    await menu.getByLabel('Name der Ansicht').fill(name);
    if (name === 'Eingang') await page.screenshot({ path: 'test-results/camera-bookmarks-save-form.png' });
    await menu.getByRole('button', { name: 'Speichern' }).click();
  };
  const zoom = async (dir: 'hinein' | 'heraus', n: number) => {
    for (let i = 0; i < n; i++) await page.getByRole('button', { name: `Zoom 3D: ${dir}zoomen` }).click();
    await page.waitForTimeout(600);
  };

  // change the camera, then save it as "Eingang"
  await zoom('hinein', 4);
  const saved = await camPos();
  await toggleMenu();
  await expect(menu.getByText('Noch keine Ansicht gespeichert.')).toBeVisible();
  await saveAs('Eingang');
  await expect(menu.getByRole('button', { name: /^Eingang/ })).toBeVisible();
  const bm = (await getProject(page)).cameraBookmarks[0];
  expect(bm).toMatchObject({ name: 'Eingang', mode: 'orbit', cutaway: false });
  expect(dist(bm.position, saved)).toBeLessThan(0.01);
  await page.screenshot({ path: 'test-results/camera-bookmarks-menu.png' });

  // change the camera again; a click on the bookmark brings it back (smooth transition ≈ 0.5 s)
  await zoom('heraus', 7);
  expect(dist(await camPos(), saved)).toBeGreaterThan(1);
  await menu.getByRole('button', { name: /^Eingang/ }).click();
  await page.waitForTimeout(120);
  expect(dist(await camPos(), saved)).toBeGreaterThan(0.05); // not a hard cut
  await expect.poll(async () => dist(await camPos(), saved), { timeout: 3000 }).toBeLessThan(0.05);

  // the same with Alt+1 – with reduced motion it jumps immediately
  await toggleMenu(); // close
  await zoom('heraus', 7);
  expect(dist(await camPos(), saved)).toBeGreaterThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Alt+1');
  // with reduced motion the jump has no transition, but it is applied on the next rendered frame –
  // on a slow CI runner (software rendering, a few fps) that can take longer than a fixed wait, so poll
  await expect.poll(async () => dist(await camPos(), saved), { timeout: 3000 }).toBeLessThan(0.05);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Alt+1 must not switch the view mode (plain 1 = 2D)
  expect(await page.evaluate(() => (window as any).__wp.useUiStore.getState().viewMode)).toBe('3d');

  // walk bookmark: saved in "Begehen", restored from "Übersicht" (mode switches)
  await page.getByRole('button', { name: 'Begehen' }).click();
  await page.waitForTimeout(800);
  const startPos = await camPos();
  // step aside (the walkthrough keeps its position in the camera) and look around
  await page.evaluate(() => {
    const c = (window as any).__wp.three.camera;
    c.position.x += 0.6;
    c.position.z -= 0.4;
    (window as any).__wp.walk.look(1.2, -0.1);
  });
  await page.waitForTimeout(300);
  const walkPos = await camPos();
  expect(dist(walkPos, startPos)).toBeGreaterThan(0.2);
  await toggleMenu();
  await saveAs('Flur');
  const flur = (await getProject(page)).cameraBookmarks[1];
  expect(flur).toMatchObject({ name: 'Flur', mode: 'walk' });
  expect(flur.eyeHeight).toBeCloseTo(walkPos.y, 2);
  await toggleMenu();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await page.waitForTimeout(800);
  expect(dist(await camPos(), walkPos)).toBeGreaterThan(1);
  await toggleMenu();
  await menu.getByRole('button', { name: /^Flur/ }).click();
  await expect.poll(cameraMode).toBe('walk');
  await expect.poll(async () => dist(await camPos(), walkPos), { timeout: 3000 }).toBeLessThan(0.05);
  expect(dist(walkPos, startPos)).toBeGreaterThan(0.2);
  await expect.poll(() => page.evaluate(() => (window as any).__wp.three.camera.rotation.y), { timeout: 3000 }).toBeCloseTo(1.2, 2);
  // and back to the orbit bookmark with Alt+1
  await page.keyboard.press('Alt+1');
  await expect.poll(cameraMode).toBe('orbit');
  await expect.poll(async () => dist(await camPos(), saved), { timeout: 3000 }).toBeLessThan(0.05);

  // rename and delete (one undo step each)
  await menu.getByRole('button', { name: '„Flur“ umbenennen' }).click();
  await menu.getByLabel('Neuer Name für „Flur“').fill('Gang');
  await menu.getByRole('button', { name: 'OK' }).click();
  await expect(menu.getByRole('button', { name: /^Gang/ })).toBeVisible();
  await menu.getByRole('button', { name: '„Gang“ löschen' }).click();
  await expect(menu.getByRole('button', { name: /^Gang/ })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(menu.getByRole('button', { name: /^Gang/ })).toBeVisible();

  // kept in the project after a reload
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).cameraBookmarks.map((b: { name: string }) => b.name)).toEqual(['Eingang', 'Gang']);
  await page.getByTestId('bookmarks-menu').getByRole('button', { name: /^Ansichten/ }).click();
  await expect(page.getByTestId('bookmarks-menu').getByRole('button', { name: /^Eingang/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('walkthrough: X switches between standing and sitting, the seated eye height follows the body height (#78, #263)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const eyeY = () => page.evaluate(() => (window as unknown as { __wp: { three: { camera: { position: { y: number } } } } }).__wp.three.camera.position.y);
  await expect.poll(eyeY).toBeCloseTo(1.52, 2);

  // X: sit down – immediately, still walking; the overlay says so
  await page.keyboard.press('x');
  await expect.poll(eyeY).toBeCloseTo(1.21, 2);
  await expect(page.getByTestId('walk-sit')).toHaveText(/Sitzen/);
  await expect(page.getByTestId('crosshair')).toBeVisible();
  // ducking (C) is ignored while seated
  await page.keyboard.down('c');
  await page.waitForTimeout(400);
  expect(await eyeY()).toBeCloseTo(1.21, 2);
  await page.keyboard.up('c');

  // the seated eye height follows the body height and applies right away
  await page.locator('.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
  const field = page.locator('.panel.right').getByRole('textbox', { name: 'Körpergröße cm' });
  await field.fill('150');
  await field.press('Enter');
  await expect.poll(eyeY).toBeCloseTo(1.11, 2);
  await expect(page.locator('.panel.right').getByLabel('Beim Begehen sitzen (Taste X)')).toBeChecked();

  // X again: stand up
  await page.locator('[data-testid="scene3d"]').hover();
  await page.keyboard.press('x');
  await expect.poll(eyeY).toBeCloseTo(1.39, 2);
  await expect(page.getByTestId('walk-sit')).toHaveCount(0);

  // saved with the project and kept after reloading
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).settings.bodyHeight).toBe(1.5);
  expect(errors).toEqual([]);
});

test('sight lines: from the entrance, draggable viewpoint updates the visible area, can be switched off (#89)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); // view re-fits after the layout change
  const right = page.locator('.panel.right');
  await right.getByRole('button', { name: 'Projekt', exact: true }).click();
  await right.getByLabel('Sichtlinien anzeigen').check();

  const plan = page.locator('[data-testid="editor2d"]');
  const sight = plan.getByTestId('sightlines');
  await expect(sight).toBeVisible();
  await expect(plan.getByTestId('sight-visible')).toBeVisible();
  const share0 = Number(await sight.getAttribute('data-share'));
  expect(share0).toBeGreaterThan(0.1);
  expect(share0).toBeLessThan(1);
  await expect(right.getByTestId('sight-share-panel')).toContainText(`${Math.round(share0 * 100)} %`);
  // default viewpoint: just inside the entrance door (living room, south wall)
  const vp = plan.getByTestId('sight-viewpoint');
  const x0 = Number(await vp.getAttribute('data-x'));
  const y0 = Number(await vp.getAttribute('data-y'));
  expect(y0).toBeCloseTo(3.7, 1);

  // drag the viewpoint into the bedroom: the visible area changes, nothing gets selected
  const from = await planToScreen(page, x0, y0);
  const to = await planToScreen(page, 7.2, 2.8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await vp.getAttribute('data-x'))).toBeGreaterThan(6.5);
  const share1 = Number(await sight.getAttribute('data-share'));
  expect(Math.abs(share1 - share0)).toBeGreaterThan(0.05);
  expect(await getSelection(page)).toBeNull();
  // back to the entrance
  await right.getByRole('button', { name: 'Blickpunkt auf den Eingang zurücksetzen' }).click();
  await expect.poll(async () => Number(await vp.getAttribute('data-y'))).toBeCloseTo(3.7, 1);

  await right.getByLabel('Sichtlinien anzeigen').uncheck();
  await expect(plan.getByTestId('sightlines')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('3D tape measure: two clicks on the floor give the distance, nothing gets selected, Esc clears (#88)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Schnitt' }).click(); // look into the rooms
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Maßband' }).click();
  await expect(page.getByRole('status')).toContainText('Ersten Punkt anklicken');

  // two floor points in the living room, 1.40 m apart (world: x, height, plan y)
  for (const [x, z] of [
    [0.6, 0.7],
    [0.6, 2.1],
  ]) {
    const s = await worldToScreen3d(page, x, 0, z);
    await page.mouse.click(s.x, s.y);
  }
  const label = page.getByTestId('tape-label');
  await expect(label).toHaveCount(1);
  expect(Math.abs(Number(await label.getAttribute('data-length')) - 1.4)).toBeLessThanOrEqual(0.01);
  await expect(label).toContainText('1,40 m');
  await expect(label).toContainText('↕ 0,00 m');
  expect(await getSelection(page)).toBeNull(); // measuring never selects

  // a click on furniture while measuring does not select or move it either
  const p = await getProject(page);
  const sofa = p.furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-sofa-3');
  const s = await worldToScreen3d(page, sofa.x, 0.4, sofa.y);
  await page.mouse.click(s.x, s.y);
  expect(await getSelection(page)).toBeNull();
  const after = (await getProject(page)).furniture.find((f: { id: string }) => f.id === sofa.id);
  expect([after.x, after.y]).toEqual([sofa.x, sofa.y]);

  // Esc removes the measurements; K switches the tool off
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tape-label')).toHaveCount(0);
  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: 'Maßband' })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('3D tape measure in the walkthrough: crosshair clicks measure, the capture click does not (#88)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-testid="scene3d"] canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  await page.keyboard.press('k');
  const c = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;
  const centre = () => page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await centre(); // captures the mouse – no point yet
  await expect(page.getByRole('status')).toContainText('Ersten Punkt anklicken');
  // measuring clicks only count while the mouse is captured. The headless browser on CI sometimes
  // refuses the pointer lock; like a user, click again (a click without the lock places no point)
  const locked = () => page.evaluate(() => document.pointerLockElement?.tagName === 'CANVAS');
  await expect(async () => {
    if (!(await locked())) await centre();
    await expect.poll(locked, { timeout: 1500 }).toBe(true);
  }).toPass({ timeout: 20000, intervals: [500, 1000] });
  const look = (yaw: number, pitch: number) => page.evaluate(([y, p]) => (window as unknown as { __wp: { walk: { look: (a: number, b: number) => void } } }).__wp.walk.look(y, p), [yaw, pitch] as const);
  // the new view is applied on the next rendered frame – on a slow CI runner a fixed wait may not cover one,
  // so wait until the camera really looks somewhere else before clicking
  const dir = () => page.evaluate(() => {
     
    const cam = (window as any).__wp.three.camera;
    const m = cam.matrixWorld.elements;
    return [-m[8], -m[9], -m[10]];
  });
  const lookAndWait = async (yaw: number, pitch: number) => {
    const d0 = await dir();
    await look(yaw, pitch);
    await expect.poll(async () => { const d = await dir(); return Math.hypot(d[0] - d0[0], d[1] - d0[1], d[2] - d0[2]); }, { timeout: 15000 }).toBeGreaterThan(0.05);
  };
  await lookAndWait(0, -0.6);
  await centre();
  await expect(page.getByRole('status')).toContainText('Zweiten Punkt anklicken');
  await lookAndWait(0.4, -0.5);
  await centre();
  await expect(page.getByTestId('tape-label')).toHaveCount(1);
  expect(Number(await page.getByTestId('tape-label').getAttribute('data-length'))).toBeGreaterThan(0.1);
  expect(await getSelection(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('walkthrough: a gamepad walks (left stick), looks (right stick) and crouches (B) (#29)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  // simulated standard-mapping pad; the test changes its axes/buttons through window.__pad
  await page.evaluate(() => {
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    (window as any).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('walk-gamepad')).toBeVisible();
  const cam = () => page.evaluate(() => {
    const c = (window as any).__wp.three.camera;
    return { x: c.position.x as number, y: c.position.y as number, z: c.position.z as number, yaw: c.rotation.y as number };
  });
  const c0 = await cam();
  // right stick: the view turns
  await page.evaluate(() => ((window as any).__pad.axes = [0, 0, 1, 0]));
  await expect.poll(async () => Math.abs((await cam()).yaw - c0.yaw), { timeout: 15000 }).toBeGreaterThan(0.2);
  await page.evaluate(() => ((window as any).__pad.axes = [0, 0, 0, 0]));
  // left stick forward: the camera moves
  const c1 = await cam();
  await page.evaluate(() => ((window as any).__pad.axes = [0, -1, 0, 0]));
  await expect.poll(async () => { const c = await cam(); return Math.hypot(c.x - c1.x, c.z - c1.z); }, { timeout: 15000 }).toBeGreaterThan(0.3);
  await page.evaluate(() => ((window as any).__pad.axes = [0, 0, 0, 0]));
  // B toggles crouching (one press = one toggle)
  await page.evaluate(() => ((window as any).__pad.buttons[1] = { pressed: true, value: 1 }));
  await expect.poll(async () => (await cam()).y).toBeLessThan(1.0);
  await page.evaluate(() => ((window as any).__pad.buttons[1] = { pressed: false, value: 0 }));
  await expect(page.getByTestId('walk-duck')).toBeVisible();
  // unplugged: hint disappears, nothing moves
  await page.evaluate(() => ((window as any).__pad.connected = false));
  await expect(page.getByTestId('walk-gamepad')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('walkthrough: a click selects the furniture in the crosshair, not the wall behind it (#185)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const table = (await getProject(page)).furniture.find((f: { catalogId?: string }) => f.catalogId === 'generic-coffee-table');
  await page.evaluate(
    ([tx, ty]) => {
      const wp = (window as any).__wp;
      const c = wp.three.camera.position;
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y - 0.3, Math.hypot(tx - c.x, ty - c.z)));
    },
    [table.x, table.y],
  );
  await expect.poll(() => page.evaluate(() => (window as any).__wp.walk.target())).toBe(table.id);
  await page.evaluate(() => (window as any).__wp.useUiStore.getState().setSelection(null));
  const box = (await page.locator('[data-testid="scene3d"] canvas').boundingBox())!;

  // captured mouse: the browser keeps reporting the position from before the capture – here near
  // the left edge, on a wall or the floor. The click must act at the crosshair only.
  // The mouse is moved there before the capture is faked: under pointer lock a mouse move turns
  // the view, which would take the table out of the crosshair (a real captured mouse does not
  // move the reported position at all).
  const lock = (on: boolean) =>
    page.evaluate((locked) => {
      if (!locked) return void delete (document as unknown as Record<string, unknown>).pointerLockElement;
      const canvas = document.querySelector('[data-testid="scene3d"] canvas');
      Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
    }, on);
  for (const [fx, fy] of [
    [0.04, 0.5],
    [0.96, 0.3],
    [0.5, 0.95],
  ]) {
    await page.evaluate(() => (window as any).__wp.useUiStore.getState().setSelection(null));
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await lock(true);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => getSelection(page)).toEqual({ type: 'furniture', id: table.id });
    await lock(false);
  }
  // nothing was dragged along
  const after = (await getProject(page)).furniture.find((f: { id: string }) => f.id === table.id);
  expect([after.x, after.y]).toEqual([table.x, table.y]);

  // pointer lock refused (e.g. in an embedded page): a short click picks what is under the mouse
  await page.evaluate(() => {
    (window as any).__wp.useUiStore.getState().setSelection(null);
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      return Promise.reject(new Error('refused')) as any;
    };
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => getSelection(page)).toEqual({ type: 'furniture', id: table.id });
  expect(errors).toEqual([]);
});

test('catalog: drag and drop also works while walking – onto the floor under the pointer, the sky is rejected (#227)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByLabel('Katalog durchsuchen').fill('Zimmerpflanze');
  const entry = page.locator('.catalog-item', { hasText: 'Zimmerpflanze groß' });
  const count = async () => (await getProject(page)).furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').length;
  const before = await count();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const canvas = page.locator('[data-testid="scene3d"] canvas');
  // look down at the living-room floor near (2.5, 2)
  await page.evaluate(
    ([tx, ty]) => {
      const wp = (window as any).__wp;
      const c = wp.three.camera.position;
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y, Math.hypot(tx - c.x, ty - c.z)));
    },
    [2.5, 2],
  );
  await page.waitForTimeout(300);
  const cbox = (await canvas.boundingBox())!;
  const s = await worldToScreen3d(page, 2.5, 0, 2);
  await entry.dragTo(canvas, { targetPosition: { x: s.x - cbox.x, y: s.y - cbox.y } });
  await expect.poll(count).toBe(before + 1);
  const placed = (await getProject(page)).furniture.filter((f: { name: string }) => f.name === 'Zimmerpflanze groß').at(-1);
  expect(Math.abs(placed.x - 2.5)).toBeLessThan(0.1);
  expect(Math.abs(placed.y - 2)).toBeLessThan(0.1);
  // still walking afterwards
  await expect(page.getByTestId('crosshair')).toBeVisible();

  // looking up: no floor under the pointer → the same hint as outside a room, nothing added
  await page.evaluate(() => (window as any).__wp.walk.look(0, 1.2));
  await page.waitForTimeout(300);
  await entry.dragTo(canvas, { targetPosition: { x: cbox.width / 2, y: 10 } });
  await expect(page.getByText('nicht abgelegt – bitte in einen Raum ziehen')).toBeVisible();
  expect(await count()).toBe(before + 1);
  expect(errors).toEqual([]);
});

test('walkthrough: mouse wheel zooms the field of view, Z resets it, leaving restores it (#228)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  // NaN until the 3D scene is mounted (after a reload, too), so expect.poll keeps waiting
  const fovOf = () => page.evaluate(() => ((window as any).__wp.three?.camera.fov ?? NaN) as number);
  // the 3D scene mounts asynchronously
  await expect.poll(() => page.evaluate(() => !!(window as any).__wp.three)).toBe(true);
  const overviewFov = await fovOf();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  await expect.poll(fovOf).toBe(50);
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -100);
  // down to 2/7 of the base angle (50° → about 14°)
  await expect.poll(fovOf).toBeCloseTo(100 / 7, 3);
  await page.mouse.wheel(0, 100);
  await expect.poll(fovOf).toBeGreaterThan(100 / 7 + 0.01);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
  await expect.poll(fovOf).toBe(50);
  // Z resets after zooming in
  await page.mouse.wheel(0, -300);
  await expect.poll(fovOf).toBeLessThan(50);
  await page.keyboard.press('KeyZ');
  await expect.poll(fovOf).toBe(50);
  // leaving and re-entering: back to the normal view, the overview keeps its own field of view
  await page.mouse.wheel(0, -300);
  await expect.poll(fovOf).toBeLessThan(50);
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('crosshair')).toHaveCount(0);
  await expect.poll(fovOf).toBe(overviewFov);
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect.poll(fovOf).toBe(50);
  expect(errors).toEqual([]);
});

test('walkthrough: "Gefühlt echt" uses a natural 62° view with scale hints – distance and height at the crosshair, door heights; it is saved (#256, #263)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  // NaN until the 3D scene is mounted (after a reload, too), so expect.poll keeps waiting
  const fovOf = () => page.evaluate(() => ((window as any).__wp.three?.camera.fov ?? NaN) as number);
  await expect.poll(fovOf).toBe(50);
  await expect(page.getByTestId('aim-readout')).toHaveCount(0);
  await expect(page.getByTestId('door-height')).toHaveCount(0);
  const toggle = page.locator('.toolbar').getByRole('button', { name: 'Gefühlt echt' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(fovOf).toBe(62);
  // the crosshair readout names distance and height of what is in sight
  await page.evaluate(() => (window as any).__wp.walk.look(0, -0.3));
  await expect(page.getByTestId('aim-readout')).toContainText(/\d,\d\d m entfernt/);
  // a door in sight shows its clear height
  const doorInSight = await page.evaluate(() => {
    const p = (window as any).__wp.useProjectStore.getState().project;
    return p.openings.some((o: any) => o.kind !== 'window');
  });
  if (doorInSight) {
    for (let i = 0; i < 16 && (await page.getByTestId('door-height').count()) === 0; i++) {
      await page.evaluate((k) => (window as any).__wp.walk.look((k * Math.PI) / 8, 0), i);
      await page.waitForTimeout(250);
    }
    await expect(page.getByTestId('door-height').first()).toContainText(/↕ \d,\d\d m/);
  }
  // zoom starts from the base value, Z goes back to it
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(fovOf).toBeLessThan(62);
  await page.keyboard.press('KeyZ');
  await expect.poll(fovOf).toBe(62);
  // saved: after leaving, reloading and walking again the switch is still on
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('aim-readout')).toHaveCount(0);
  await expect(page.getByText('Gespeichert')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.reload();
  await expect.poll(async () => (await getProject(page)).settings.walkTrueScale).toBe(true);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect.poll(fovOf).toBe(62);
  // switched off: the slider angle (default 50°) is back, no hints
  await toggle.click();
  await expect.poll(fovOf).toBe(50);
  await expect(page.getByTestId('aim-readout')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('walkthrough: field-of-view slider with quick choices, head bob, reference figure in the body height placed with P (#263)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.getByTestId('crosshair')).toBeVisible();
  const fovOf = () => page.evaluate(() => ((window as any).__wp.three?.camera.fov ?? NaN) as number);
  const settings = async () => (await getProject(page)).settings;
  await expect.poll(fovOf).toBe(50);
  const panel = page.locator('.panel.right');
  await panel.getByRole('button', { name: 'Projekt', exact: true }).click();
  // quick choices and slider
  const quick = panel.getByRole('group', { name: 'Sichtfeld-Schnellwahl' });
  await expect(quick.getByRole('button', { name: 'Normal (50°)' })).toHaveAttribute('aria-pressed', 'true');
  await quick.getByRole('button', { name: 'Weit (70°)' }).click();
  await expect.poll(fovOf).toBe(70);
  await quick.getByRole('button', { name: 'Gefühlt echt', exact: true }).click();
  await expect.poll(fovOf).toBe(62);
  expect((await settings()).walkTrueScale).toBe(true);
  const slider = panel.getByRole('slider', { name: 'Sichtfeld beim Begehen' });
  await slider.fill('45');
  await expect.poll(fovOf).toBe(45);
  expect((await settings()).walkTrueScale).toBe(false);
  expect((await settings()).walkFov).toBe(45);

  // head bob: the eyes dip a little while walking; switched off they stay level
  // keys typed into a form field do not walk: take the focus off the panel first
  const focusScene = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.locator('[data-testid="scene3d"]').hover();
  };
  const sampleY = async () => {
    await focusScene();
    await page.evaluate(() => (window as any).__wp.walk.look(0, 0));
    await page.keyboard.down('KeyW');
    // sample densely over several bob periods so a single sample cannot land on the zero crossing
    const ys: number[] = [];
    for (let i = 0; i < 40; i++) {
      ys.push(await page.evaluate(() => (window as any).__wp.three.camera.position.y as number));
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('KeyW');
    return Math.min(...ys);
  };
  expect((await settings()).walkHeadBob).toBe(true);
  await expect.poll(sampleY, { timeout: 15_000 }).toBeLessThan(1.52 - 0.002);
  const camY = () => page.evaluate(() => (window as any).__wp.three.camera.position.y as number);
  await expect.poll(camY).toBeCloseTo(1.52, 3); // settles when standing still
  await panel.getByLabel('Kopfwippen beim Gehen').uncheck();
  expect(await sampleY()).toBeCloseTo(1.52, 3);

  // reference figure: off by default; P places it where the crosshair meets the floor and shows it
  const figure = () => page.evaluate(() => {
    const o = (window as any).__wp.three.scene.getObjectByName('ref-figure');
    return o ? { x: o.position.x as number, z: o.position.z as number, h: o.userData.height as number } : null;
  });
  expect(await figure()).toBeNull();
  await panel.getByLabel('Referenzfigur in deiner Größe (Taste P)').check();
  await expect.poll(figure).not.toBeNull();
  expect((await figure())!.h).toBeCloseTo(1.63, 6);
  await focusScene();
  await page.evaluate(() => (window as any).__wp.walk.look(0.3, -0.5));
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyP');
  const cam = await page.evaluate(() => {
    const p = (window as any).__wp.three.camera.position;
    return { x: p.x as number, z: p.z as number };
  });
  // looking 0.5 rad down from 1.52 m: the floor is about 2.8 m ahead
  await expect.poll(async () => { const f = await figure(); return f ? Math.hypot(f.x - cam.x, f.z - cam.z) : 0; }).toBeGreaterThan(2.5);
  const f = (await figure())!;
  expect(Math.hypot(f.x - cam.x, f.z - cam.z)).toBeLessThan(3.1);
  // it follows the body height
  await panel.getByRole('textbox', { name: 'Körpergröße cm' }).fill('190');
  await panel.getByRole('textbox', { name: 'Körpergröße cm' }).press('Enter');
  await expect.poll(async () => (await figure())?.h).toBeCloseTo(1.9, 6);
  // P while the figure is hidden switches it on again
  await panel.getByLabel('Referenzfigur in deiner Größe (Taste P)').uncheck();
  await expect.poll(figure).toBeNull();
  await focusScene();
  await page.keyboard.press('KeyP');
  await expect.poll(figure).not.toBeNull();
  expect((await settings()).showRefFigure).toBe(true);
  expect(errors).toEqual([]);
});

test('walkthrough: F still works after a slider or checkbox had focus; text fields hint instead of eating keys silently (#283)', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page);
  const p0 = await getProject(page);
  const window1 = p0.openings.find((o: { kind: string; width: number }) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6);
  const openOf = async (id: string) => (await getProject(page)).openings.find((o: { id: string }) => o.id === id).open as boolean;
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Begehen' }).click();
  await expect(page.locator('.walk-overlay')).toBeVisible();
  const aim = async () => {
    const c = await page.evaluate((oid) => {
      const t = (window as any).__wp.three;
      const v = t.scene.getObjectByName(`leaf:${oid}:0`).children[0].getWorldPosition(t.camera.position.clone());
      const cam = t.camera.position;
      (window as any).__wp.walk.look(Math.atan2(-(v.x - cam.x), -(v.z - cam.z)), Math.atan2(1.6 - cam.y, Math.hypot(v.x - cam.x, v.z - cam.z)));
    }, window1.id);
    return c;
  };
  await aim();
  await expect.poll(() => page.evaluate(() => (window as any).__wp.walk.targetOpening() as string | null)).toBe(window1.id);
  // a focused checkbox/slider no longer swallows E
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.id = 'probe-cb';
    document.body.appendChild(i);
    i.focus();
  });
  await page.keyboard.press('f');
  await expect.poll(() => openOf(window1.id)).toBe(true);
  // a text field still blocks the walking keys, but says why; Esc hands the keyboard back
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'text';
    i.id = 'probe-text';
    document.body.appendChild(i);
    i.focus();
  });
  await page.keyboard.press('f');
  await expect(page.getByText('Eingabefeld aktiv')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('probe-text');
  expect(errors).toEqual([]);
});
