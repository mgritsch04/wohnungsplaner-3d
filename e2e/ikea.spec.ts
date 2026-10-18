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

test('Lesezeichen „An Planer senden“ (#221): Lesezeichen wird angeboten, gesendete Seite erscheint mit Hinweis', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cors = { 'access-control-allow-origin': '*' };
  let inbox = [
    {
      id: 'x1',
      receivedAt: '2026-10-17T15:00:00Z',
      product: {
        article: '000.000.02',
        // SYNTHETIC product as the helper would deliver it from a sent page
        entry: { name: 'TESTBETT Synthetisch', category: 'bed', width: 140, depth: 200, height: 40, price: 199, priceDate: '2026-10-17', retailer: 'IKEA Österreich', articleNumber: '000.000.02' },
        model: null,
      },
    },
  ];
  const acked: string[] = [];
  await page.route(`${HELPER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' } });
    if (url.pathname === '/status') return route.fulfill({ headers: cors, json: { ok: true, name: 'wohnungsplaner-ikea-helper', version: 2 } });
    if (url.pathname === '/bookmarklet') return route.fulfill({ headers: cors, json: { token: 'ab12cd34ef56ab12cd34ef56' } });
    if (url.pathname === '/inbox') return route.fulfill({ headers: cors, json: { items: inbox } });
    if (url.pathname === '/inbox/ack') {
      const ids = (route.request().postDataJSON() as { ids: string[] }).ids;
      acked.push(...ids);
      inbox = inbox.filter((i) => !ids.includes(i.id));
      return route.fulfill({ headers: cors, json: { ok: true } });
    }
    return route.fulfill({ status: 404, headers: cors, json: { error: 'Nicht gefunden.' } });
  });
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'IKEA', exact: true }).click();

  const card = left.getByTestId('ikea-card');
  await expect(card).toContainText('TESTBETT Synthetisch');
  await expect(card).toContainText('neu vom Lesezeichen');
  await expect(page.getByText('„TESTBETT Synthetisch“ vom Lesezeichen übernommen.')).toBeVisible();
  await expect.poll(() => acked).toEqual(['x1']);

  await left.getByTestId('ikea-bookmarklet').locator('summary').click();
  const href = await left.getByTestId('ikea-bookmarklet-link').getAttribute('href');
  expect(href).toMatch(/^javascript:/);
  expect(decodeURIComponent(href!)).toContain('ab12cd34ef56ab12cd34ef56');

  await card.getByRole('button', { name: 'In den Raum' }).click();
  await expect.poll(async () => (await getProject(page)).furniture.some((f) => f.name === 'TESTBETT Synthetisch')).toBe(true);
  await expect(card).toHaveCount(1); // taken over once, not again on the next poll
  expect(errors).toEqual([]);
});

test('Maße fehlen (#269): gesendete Pflanze ohne Maße wartet, Maße eintragen, dann in der Auswahl', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cors = { 'access-control-allow-origin': '*' };
  let inbox = [
    {
      id: 'p1',
      receivedAt: '2026-10-18T12:00:00Z',
      product: {
        article: '000.000.69',
        entry: null,
        // SYNTHETIC page result: name, price and height known, width/depth missing
        draft: { name: 'TESTPFLANZE Synthetisch', category: 'decor', width: null, depth: null, height: 120, price: 19.99, priceDate: '2026-10-18', retailer: 'IKEA Österreich', articleNumber: '000.000.69' },
        reason: 'Maße fehlen auf der Seite',
        model: null,
      },
    },
  ];
  await page.route(`${HELPER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' } });
    if (url.pathname === '/status') return route.fulfill({ headers: cors, json: { ok: true, name: 'wohnungsplaner-ikea-helper', version: 2 } });
    if (url.pathname === '/bookmarklet') return route.fulfill({ headers: cors, json: { token: 'ab12cd34ef56ab12cd34ef56' } });
    if (url.pathname === '/inbox') return route.fulfill({ headers: cors, json: { items: inbox } });
    if (url.pathname === '/inbox/ack') {
      inbox = [];
      return route.fulfill({ headers: cors, json: { ok: true } });
    }
    return route.fulfill({ status: 404, headers: cors, json: { error: 'Nicht gefunden.' } });
  });
  await freshStart(page);
  const left = page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByRole('button', { name: 'IKEA', exact: true }).click();

  const draft = left.getByTestId('ikea-draft');
  await expect(draft).toContainText('TESTPFLANZE Synthetisch');
  await expect(draft).toContainText('Maße fehlen');
  await expect(left.getByTestId('ikea-card')).toHaveCount(0);
  await expect(draft.getByLabel('Höhe in cm')).toHaveValue('120');

  await draft.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(draft).toContainText('Bitte Breite, Tiefe und Höhe eintragen');

  await draft.getByLabel('Breite in cm').fill('24');
  await draft.getByLabel('Tiefe in cm').fill('24');
  await draft.getByRole('button', { name: 'Übernehmen' }).click();
  const card = left.getByTestId('ikea-card');
  await expect(card).toContainText('TESTPFLANZE Synthetisch');
  await expect(card).toContainText('24 × 24 × 120 cm');
  await expect(left.getByTestId('ikea-missing-dims')).toHaveCount(0);
  expect(errors).toEqual([]);
});
