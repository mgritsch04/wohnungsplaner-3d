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

test('Smart Home (#170): Melder und Lampe platzieren, Automation, Person löst Licht aus, YAML-Export, bleibt nach Reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Smart Home' }).click();
  const panel = left.getByTestId('smarthome-panel');
  await panel.getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
  await expect(panel.getByLabel('Produkt')).toHaveValue('ikea-vallhorn');
  await panel.getByTestId('device-add').click();
  await panel.getByLabel('Art').selectOption({ label: 'Smarte Lampe' });
  await panel.getByTestId('device-add').click();
  await expect(page.getByTestId('device-2d')).toHaveCount(2);

  // datasheet values with source, hold time marked as assumption
  await panel.getByTestId('device-row').filter({ hasText: 'Bewegungsmelder' }).click();
  const details = panel.getByTestId('device-details');
  await expect(details).toContainText('VALLHORN');
  await expect(details.getByLabel('Reichweite')).toHaveValue('5');
  await expect(details.getByText('Annahme')).toHaveCount(1);
  await details.getByTestId('automation-add').click();
  const auto = panel.getByTestId('automation');
  await expect(auto).toHaveCount(1);
  await expect(auto.getByLabel(/Smarte Lampe Wohnzimmer/)).toBeChecked();
  await auto.getByLabel('Nur wenn es dunkel ist').uncheck(); // the sample is set to the afternoon

  const p = await getProject(page);
  expect(p.schemaVersion).toBe(2);
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
