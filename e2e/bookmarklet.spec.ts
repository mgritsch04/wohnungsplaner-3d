import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBookmarklet } from '../src/catalog/providers/bookmarklet';

/**
 * Lesezeichen auf einer Shop-Seite, die fremde Frames verbietet (Möbelix, #273): mit dem echten
 * Helfer (eigener Port, leerer Zwischenspeicher) und einer SYNTHETISCHEN Produktseite.
 */
const PORT = 4797;
const HELPER = `http://127.0.0.1:${PORT}`;
const SHOP_URL = 'https://www.moebelix.at/p/testtisch-synthetisch-001';
// like moebelix.at: no frames, no requests to other hosts
const SHOP_CSP = "default-src 'self'; frame-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'";
const SHOP_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>TESTTISCH Synthetisch</title>
<link rel="canonical" href="${SHOP_URL}">
<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'TESTTISCH Synthetisch', url: SHOP_URL, offers: { price: '299', priceCurrency: 'EUR' } })}</script>
</head><body><h1>TESTTISCH Synthetisch</h1><p>Esstisch</p><p>Breite: 160 cm</p><p>Tiefe: 90 cm</p><p>Höhe: 76 cm</p></body></html>`;

// one helper process on a fixed port is shared by all tests in this file: keep them in one worker (also under fullyParallel / --shard)
test.describe.configure({ mode: 'serial' });

let helper: ChildProcess;
let cache: string;

test.beforeAll(async () => {
  cache = mkdtempSync(join(tmpdir(), 'wp-lesezeichen-'));
  helper = spawn(process.execPath, ['scripts/ikea-helper.mjs', '--port', String(PORT)], { env: { ...process.env, IKEA_HELPER_CACHE: cache }, stdio: 'ignore' });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${HELPER}/empfang`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

test.afterAll(() => {
  helper?.kill();
  rmSync(cache, { recursive: true, force: true });
});

const bookmarklet = () => decodeURIComponent(buildBookmarklet(readFileSync(join(cache, '.lesezeichen-token'), 'utf-8').trim(), HELPER).replace(/^javascript:/, ''));
const inbox = () => JSON.parse(readFileSync(join(cache, 'lesezeichen-eingang.json'), 'utf-8')) as { product: { entry: { name: string } | null } }[];

test('Möbelix verbietet Frames: Lesezeichen öffnet den Empfang als kleines Fenster und sendet die Seite', async ({ page, context }) => {
  await page.route(SHOP_URL, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': SHOP_CSP }, body: SHOP_PAGE }));
  await page.goto(SHOP_URL);
  const popup = context.waitForEvent('page');
  await page.evaluate(bookmarklet());
  const win = await popup;
  await expect(win.locator('#s')).toContainText('„TESTTISCH Synthetisch“ ist im Planer');
  expect(inbox().map((i) => i.product.entry?.name)).toEqual(['TESTTISCH Synthetisch']);
  await expect(page.locator('iframe')).toHaveCount(0);
  await win.waitForEvent('close', { timeout: 8000 }); // closes itself after success
});

test('ohne Fenster: Hinweis erklärt den Helfer und bietet „Seite kopieren“ an', async ({ page }) => {
  await page.route(SHOP_URL, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': SHOP_CSP }, body: SHOP_PAGE }));
  await page.goto(SHOP_URL);
  await page.evaluate(() => (window.open = () => null)); // popup blocked
  await page.evaluate(bookmarklet());
  await expect(page.getByText('Der Planer-Helfer antwortet nicht.')).toBeVisible();
  await expect(page.getByText(/npm run ikea-helper/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Seite kopieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByText('Der Planer-Helfer antwortet nicht.')).toHaveCount(0);
});

test('IKEA erlaubt Frames: Empfang bleibt eingebettet, kein Fenster', async ({ page, context }) => {
  const url = 'https://www.ikea.com/at/de/p/testregal-synthetisch-00000097/';
  const body = SHOP_PAGE.replaceAll(SHOP_URL, url).replaceAll('TESTTISCH', 'TESTREGAL');
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': "connect-src 'self'" }, body }));
  await context.grantPermissions(['local-network-access'], { origin: 'https://www.ikea.com' });
  await page.goto(url);
  let popups = 0;
  context.on('page', () => popups++);
  await page.evaluate(bookmarklet());
  await expect(page.frameLocator('iframe').locator('#s')).toContainText('„TESTREGAL Synthetisch“ ist im Planer');
  expect(popups).toBe(0);
});
