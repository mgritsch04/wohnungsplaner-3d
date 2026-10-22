import { expect, test, type Page } from '@playwright/test';
import { getProject as rawProject, getSelection, planToScreen, worldToScreen3d } from './fixtures';
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

test('Smart Home (#170): Melder und Lampe platzieren, Automation, Person löst Licht aus, YAML-Export, bleibt nach Reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const right = page.locator('.panel.right');
  await panel.getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
  await expect(panel.getByLabel('Produkt')).toHaveValue('ikea-vallhorn');
  await panel.getByTestId('device-add').click();
  await panel.locator('[data-testid="device-kind"][data-kind="light"]').click();
  await panel.getByTestId('device-add').click();
  await expect(page.getByTestId('device-2d')).toHaveCount(2);

  // datasheet values with source, hold time marked as assumption
  await panel.getByTestId('device-row').filter({ hasText: 'Bewegungsmelder' }).click();
  const info = right.getByTestId('device-info');
  await expect(info).toContainText('VALLHORN');
  await expect(info.getByLabel('Reichweite')).toHaveValue('5');
  await expect(info.getByText('Annahme')).toHaveCount(1);
  await info.getByTestId('automation-add').click();
  await expect(panel.getByTestId('sh-step-rules')).toHaveAttribute('aria-pressed', 'true');
  await expect(info.getByTestId('device-rule')).toContainText('Wenn Bewegungsmelder Wohnzimmer Bewegung meldet');
  const auto = panel.getByTestId('automation');
  await expect(auto).toHaveCount(1);
  await auto.locator('summary').click();
  await expect(auto.getByLabel(/Smarte Lampe Wohnzimmer/)).toBeChecked();
  await auto.getByLabel('Nur wenn es dunkel ist').uncheck(); // the sample is set to the afternoon
  await panel.getByTestId('sh-step-test').click();

  const p = await getProject(page);
  expect(p.schemaVersion).toBe(3);
  expect(p.devices.map((d) => d.kind)).toEqual(['motion', 'light']);
  const light = p.lights.find((l) => l.id === p.devices[1].lightId)!;
  expect(light.on).toBe(false);

  // person walks inside the detection area → light switches on (simulation only, project unchanged)
  await panel.getByTestId('sim-person').click();
  await panel.getByTestId('sim-start').click();
  const person = page.getByTestId('sim-person-2d');
  const box = (await person.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 2);
  await page.mouse.up();
  const lamp = page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Wohnzimmer"]');
  await expect.poll(() => lamp.getAttribute('data-on')).toBe('true');
  await expect(panel.getByTestId('sim-log')).toContainText('Bewegung erkannt');
  expect((await getProject(page)).lights.find((l) => l.id === light.id)!.on).toBe(false);
  await panel.getByTestId('sim-stop').click();
  await expect(lamp).toHaveAttribute('data-on', 'false');
  await panel.getByTestId('sh-step-rules').click();

  const download = page.waitForEvent('download');
  await panel.getByTestId('ha-export').click();
  const file = await download;
  const yaml = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(yaml).toContain('entity_id: binary_sensor.bewegungsmelder_wohnzimmer');
  expect(yaml).toContain('action: light.turn_on');

  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(2);
  expect((await getProject(page)).automations).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Smart Home (#232, #233): Raum wählen, im Plan klicken, Geräte in 2D und 3D anklicken, schalten, auslösen, löschen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  const right = page.locator('.panel.right');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const info = right.getByTestId('device-info');

  // #232: the chosen room is used (not always the first one)
  await panel.getByLabel('Raum').selectOption({ label: 'Schlafzimmer' });
  await panel.locator('[data-testid="device-kind"][data-kind="light"]').click();
  await panel.getByTestId('device-add').click();
  await expect(info).toContainText('Smarte Lampe Schlafzimmer');
  await expect(page.getByText('in „Schlafzimmer“ platziert')).toBeVisible();
  const lamp = page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Schlafzimmer"]');
  await expect(lamp).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('device-flash')).toHaveCount(1);
  await info.getByTestId('device-toggle').click();
  await expect(lamp).toHaveAttribute('data-on', 'true');
  await info.getByTestId('device-toggle').click();
  await expect(lamp).toHaveAttribute('data-on', 'false');

  // place by a click into the plan; Esc cancels
  await panel.locator('[data-testid="device-kind"][data-kind="motion"]').click();
  await panel.getByTestId('device-place-click').click();
  await expect(panel.getByTestId('device-placing-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('device-placing-hint')).toBeHidden();
  await panel.getByTestId('device-place-click').click();
  const at = await planToScreen(page, 6.4, 1.2);
  await page.mouse.click(at.x, at.y);
  await expect(panel.getByTestId('device-placing-hint')).toBeHidden();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(2);
  const sensor = (await getProject(page)).devices[1];
  expect(sensor).toMatchObject({ kind: 'motion', name: 'Bewegungsmelder Schlafzimmer' });
  expect(sensor.x).toBeCloseTo(6.4, 1);
  expect(sensor.y).toBeCloseTo(1.2, 1);
  await expect(info).toContainText('Bewegungsmelder Schlafzimmer');
  const motion = page.locator('[data-testid="device-2d"][data-device="Bewegungsmelder Schlafzimmer"]');
  await info.getByTestId('device-trigger').click();
  await expect(motion).toHaveAttribute('data-on', 'true');

  // a click on a device in 2D selects it without changing the project
  const before = (await getProject(page)).devices;
  await lamp.getByTestId('device-hit').click();
  await expect(info).toContainText('Smarte Lampe Schlafzimmer');
  expect((await getProject(page)).devices).toEqual(before);

  // … and in 3D
  const s3 = await worldToScreen3d(page, sensor.x, sensor.elevation, sensor.y);
  await page.mouse.click(s3.x, s3.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe(sensor.id);
  await expect(info).toContainText('Bewegungsmelder Schlafzimmer');

  // delete and undo
  await info.getByTestId('device-delete').click();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(2);
  expect(errors).toEqual([]);
});

test('Smart Home (#280): Blickrichtung per Regler, ein Ziehvorgang = ein Undo-Schritt, Feld und Regler synchron, bleibt nach Reload', async ({ page }) => {
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const right = page.locator('.panel.right');
  await panel.getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
  await panel.locator('[data-testid="device-kind"][data-kind="motion"]').click();
  await panel.getByTestId('device-add').click();
  await page.getByTestId('device-2d').first().getByTestId('device-hit').click();
  const info = right.getByTestId('device-info');
  const slider = info.getByTestId('device-rotation-slider');
  const field = info.getByRole('textbox', { name: /^Blickrichtung/ });
  const rotation = async () => (await getProject(page)).devices[0].rotation;

  // drag in several steps: field follows live, and the whole drag is one undo step
  const initial = await slider.inputValue();
  await slider.dispatchEvent('pointerdown');
  await slider.fill('120');
  await slider.fill('250');
  await slider.fill('330');
  await slider.dispatchEvent('pointerup');
  const dragged = Number(await slider.inputValue());
  expect(dragged).toBeGreaterThan(300);
  await expect(field).toHaveValue(String(dragged));
  expect(Math.round(((await rotation()) * 180) / Math.PI)).toBe(dragged);

  // field sets slider
  await field.fill('90');
  await field.press('Enter');
  await expect(slider).toHaveValue('90');

  await page.keyboard.press('Control+z'); // field entry
  await expect(slider).toHaveValue(String(dragged));
  await page.keyboard.press('Control+z'); // the whole drag
  await expect(slider).toHaveValue(initial);

  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  await expect(slider).toHaveValue('90');
  await page.waitForTimeout(800);
  await page.reload();
  await page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
  await page.getByTestId('device-2d').first().getByTestId('device-hit').click();
  await expect(page.locator('.panel.right').getByTestId('device-rotation-slider')).toHaveValue('90');
});

test('Smart Home (#282): Uhrzeit lässt sich bei laufender Simulation von Hand ändern', async ({ page }) => {
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  await panel.locator('[data-testid="device-kind"][data-kind="light"]').click();
  await panel.getByTestId('device-add').click();
  await panel.getByRole('button', { name: /Testen/ }).click();
  await panel.getByTestId('sim-start').click();

  await panel.getByTestId('sim-night').click();
  await expect(panel.getByTestId('sim-clock')).toContainText('22:');
  await expect(panel.getByTestId('sim-log')).toContainText('Uhrzeit von Hand auf 22:00 gestellt');

  // the project panel's time slider drives the simulation clock too
  await page.locator('aside.panel.right nav.tabs button', { hasText: 'Projekt' }).click();
  await page.getByLabel('Tageszeit', { exact: true }).fill('12');
  await expect(panel.getByTestId('sim-clock')).toContainText('12:');

  await panel.getByTestId('sim-stop').click();
  await page.getByLabel('Tageszeit', { exact: true }).fill('9');
  await expect.poll(async () => (await getProject(page)).settings.timeOfDay).toBe(9);
});

test('Smart Home (#253): Router setzen, WLAN-Abdeckung im Plan, Wert je Raum, zweiter Access Point verbessert, bleibt nach Reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const dbm = async (room: string) => Number(await panel.locator(`[data-testid="wifi-room"][data-room="${room}"]`).getAttribute('data-dbm'));

  await panel.getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
  await panel.locator('[data-testid="device-kind"][data-kind="router"]').click();
  await panel.getByTestId('device-add').click();
  await expect(page.locator('[data-testid="device-2d"][data-device="Router / Access Point Wohnzimmer"]')).toBeVisible();

  // off by default; on: colour layer, legend, value per room, estimate hint
  await expect(page.getByTestId('wifi-overlay')).toHaveCount(0);
  await panel.getByLabel('Abdeckung im Plan anzeigen').check();
  await expect(page.getByTestId('wifi-overlay')).toBeVisible();
  await expect(panel.getByTestId('wifi-hint')).toContainText('Messen mit dem Handy ersetzt das nicht');
  const rooms = (await getProject(page)).rooms.map((r) => r.name);
  await expect(panel.getByTestId('wifi-room')).toHaveCount(rooms.length);
  await expect(panel.locator('[data-testid="wifi-room"][data-room="Wohnzimmer"]')).toHaveAttribute('data-level', 'good');
  const far = rooms.filter((n) => n !== 'Wohnzimmer');
  const near = await dbm('Wohnzimmer');
  const values = await Promise.all(far.map(dbm));
  expect(Math.min(...values)).toBeLessThan(near);

  const weakest = far[values.indexOf(Math.min(...values))];
  const before = await dbm(weakest);

  // second access point in the weakest room improves it
  await panel.getByLabel('Raum').selectOption({ label: weakest });
  await panel.getByTestId('device-add').click();
  const improved = await dbm(weakest);
  expect(improved).toBeGreaterThan(before + 3);

  // band 5 GHz is weaker
  await panel.getByLabel('Band').selectOption('5');
  expect(await dbm(weakest)).toBeLessThan(improved);

  // survives save and reload
  await page.waitForTimeout(800);
  await page.reload();
  await left.getByRole('button', { name: 'Smart Home' }).click();
  expect((await getProject(page)).devices.filter((d) => d.kind === 'router')).toHaveLength(2);
  await panel.getByLabel('Abdeckung im Plan anzeigen').check();
  await panel.getByLabel('Band').selectOption('2.4');
  expect(await dbm(weakest)).toBe(improved);
  await expect(page.getByTestId('wifi-overlay')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Smart-Home-Vorschlag (#225): Vorschau, Verwerfen ändert nichts, Übernehmen setzt Geräte', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  await panel.getByLabel('Für').selectOption('all');
  await panel.getByTestId('sh-suggest').click();
  await expect(panel.getByTestId('sh-suggest-item').first()).toBeVisible();
  await expect(panel.getByTestId('sh-suggest-cost')).toContainText('€');
  expect(await page.getByTestId('device-preview').count()).toBeGreaterThan(0);
  expect((await getProject(page)).devices).toHaveLength(0);

  await panel.getByTestId('sh-suggest-discard').click();
  await expect(page.getByTestId('device-preview')).toHaveCount(0);
  expect((await getProject(page)).devices).toHaveLength(0);

  await panel.getByTestId('sh-suggest').click();
  const n = await panel.getByTestId('sh-suggest-item').count();
  await panel.getByTestId('sh-suggest-apply').click();
  await expect(page.getByTestId('device-2d')).toHaveCount(n);
  expect((await getProject(page)).devices).toHaveLength(n);
  expect(errors).toEqual([]);
});

test('LED-Streifen (#238): als Strecke platzieren, Länge, Farbe, Knick, Undo, bleibt nach Reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  const right = page.locator('.panel.right');

  await panel.locator('[data-testid="device-kind"][data-kind="strip"]').click();
  await panel.getByTestId('device-place-click').click();
  await expect(panel.getByTestId('device-placing-hint')).toContainText('Anfang');
  const a = await planToScreen(page, 6.5, 1.2);
  const b = await planToScreen(page, 8.5, 1.2);
  await page.mouse.click(a.x, a.y);
  await expect(panel.getByTestId('device-placing-hint')).toBeVisible(); // waiting for the end point
  await page.mouse.click(b.x, b.y);
  await expect(panel.getByTestId('device-placing-hint')).toBeHidden();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(1);
  const strip = (await getProject(page)).devices[0];
  expect(strip).toMatchObject({ kind: 'strip', direction: 'down' });
  expect(strip.points).toHaveLength(2);
  const info = right.getByTestId('device-info');
  await expect(info.getByTestId('strip-length')).toContainText('2,0');

  // switch on in the simulation, colour shows in 2D
  await info.getByTestId('device-toggle').click();
  const el = page.locator('[data-testid="device-2d"][data-kind="strip"]');
  await expect(el).toHaveAttribute('data-on', 'true');
  await info.getByTestId('strip-color').fill('#ff0000');
  await expect(el).toHaveAttribute('data-color', '#ff0000');

  // add a bend: length grows
  await info.getByTestId('strip-add-section').click();
  await expect(info.getByTestId('strip-length')).toContainText('2 Abschnitte');
  await page.keyboard.press('Control+z');
  await expect(info.getByTestId('strip-length')).toContainText('1 Abschnitt');

  await expect.poll(async () => (await getProject(page)).devices[0]?.color).toBe('#ff0000');
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await expect.poll(async () => (await getProject(page)).devices[0]?.color).toBe('#ff0000');

  // a click on the line in 2D selects the strip (the thick transparent stroke is the hit area)
  const mid = await planToScreen(page, 7.5, 1.2);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(async () => (await getSelection(page))?.id).toBe((await getProject(page)).devices[0].id);
  await right.getByTestId('device-delete').click();
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getProject(page)).devices.length).toBe(1);
  expect(errors).toEqual([]);
});
