import { expect, test, type Page } from '@playwright/test';
import { getProject as rawProject } from './fixtures';
import { boxGlb } from '../src/test/glbFixture';
import type { Project } from '../src/model/schema';

const getProject = async (page: Page) => (await rawProject(page)) as Project;
const HELPER = 'http://127.0.0.1:4791';

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

/** Stand-in for `npm run ikea-helper` with a SYNTHETIC product (no real IKEA data). */
async function fakeHelper(page: Page, asked: string[]) {
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(`${HELPER}/**`, async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname + url.search);
    if (url.pathname === '/status') return route.fulfill({ headers: cors, json: { ok: true, name: 'wohnungsplaner-ikea-helper', version: 1 } });
    if (url.pathname === '/product') {
      const art = url.searchParams.get('article');
      if (art === '999.999.99') return route.fulfill({ headers: cors, json: { article: art, entry: null, model: null, reason: 'HTTP 404' } });
      return route.fulfill({
        headers: cors,
        json: {
          article: art,
          entry: {
            name: 'TESTREGAL Synthetisch',
            category: 'storage',
            width: 80,
            depth: 30,
            height: 120,
            price: 49.99,
            priceDate: '2026-10-17',
            retailer: 'IKEA Österreich',
            productUrl: 'https://www.ikea.com/at/de/p/-00000001/',
            articleNumber: art,
            modelFile: '00000001.glb',
          },
          model: '00000001.glb',
        },
      });
    }
    if (url.pathname === '/model/00000001.glb') return route.fulfill({ headers: { ...cors, 'content-type': 'model/gltf-binary' }, body: Buffer.from(boxGlb(0.8, 1.2, 0.3)) });
    return route.fulfill({ status: 404, headers: cors, json: { error: 'Nicht gefunden.' } });
  });
}

test('IKEA-Auswahl: Link einfügen, über den Helfer holen, mit 3D-Modell in den Raum setzen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const asked: string[] = [];
  await fakeHelper(page, asked);
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'IKEA', exact: true }).click();
  const section = left.getByTestId('ikea-section');
  await expect(section.getByTestId('ikea-helper-status')).toHaveAttribute('data-state', 'on');

  await section.getByLabel(/Links oder Artikelnummern/).fill('https://www.ikea.com/at/de/p/testregal-weiss-00000001/\n999.999.99');
  await section.getByRole('button', { name: '2 Produkte holen' }).click();
  await expect(page.getByText('1 von 2 IKEA-Produkt(en) übernommen')).toBeVisible();
  await expect(section.getByTestId('ikea-outcomes')).toContainText('999.999.99: HTTP 404');
  expect(asked).toContain('/product?article=000.000.01&model=1');

  const card = section.getByTestId('ikea-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('TESTREGAL Synthetisch');
  await expect(card).toContainText('80 × 30 × 120 cm');
  await expect(card).toContainText('3D-Modell');
  await card.getByRole('button', { name: 'In den Raum' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f) => f.name === 'TESTREGAL Synthetisch')).toBe(true);
  const item = (await getProject(page)).furniture.find((f) => f.name === 'TESTREGAL Synthetisch')!;
  expect(item.model.type).toBe('gltf');
  expect([item.width, item.depth, item.height]).toEqual([0.8, 0.3, 1.2]);

  // the selection stays after a reload
  await page.reload();
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'IKEA', exact: true }).click();
  await expect(left.getByTestId('ikea-card')).toHaveCount(1);
  await left.getByTestId('ikea-card').getByRole('button', { name: /entfernen/ }).click();
  await expect(left.getByTestId('ikea-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('IKEA-Auswahl ohne laufenden Helfer: Anleitung statt Fehler, Holen gesperrt', async ({ page }) => {
  await page.route(`${HELPER}/**`, (route) => route.abort('connectionrefused'));
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'IKEA', exact: true }).click();
  const status = left.getByTestId('ikea-helper-status');
  await expect(status).toHaveAttribute('data-state', 'off');
  await expect(status).toContainText('npm run ikea-helper');
  await left.getByLabel(/Links oder Artikelnummern/).fill('104.099.32');
  await expect(left.getByRole('button', { name: 'Holen' })).toBeDisabled();
});
