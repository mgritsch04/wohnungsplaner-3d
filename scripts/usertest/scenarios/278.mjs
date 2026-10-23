// Katalog: eigene Möbelix-Liste wie „Meine IKEA-Auswahl“ (#278) – Testschritte aus dem Kommentar in #278.
// Mit dem ECHTEN Helfer und dem echten Lesezeichen-Code aus dem Planer; die Möbelix-Seiten sind SYNTHETISCH
// (keine echten Händlerdaten, kein Abruf von moebelix.at). Echte Möbelix-Seiten und ihr Aufbau bleiben für G.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const left = (t) => t.page.locator('.panel.left');
const MX = (n) => `https://www.moebelix.at/p/test${n}-synthetisch-00${n}`;
const IKEA_URL = 'https://www.ikea.com/at/de/p/testregal-synthetisch-00000097/';
const CSP = "default-src 'self'; frame-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'";
const pageHtml = (name, url, dims, price) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${name}</title>
<link rel="canonical" href="${url}">
<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, url, offers: { price: String(price), priceCurrency: 'EUR' } })}</script>
</head><body><h1>${name}</h1>${dims ? `<p>Breite: ${dims[0]} cm</p><p>Tiefe: ${dims[1]} cm</p><p>Höhe: ${dims[2]} cm</p>` : '<p>Maße siehe Beschreibung.</p>'}</body></html>`;
let helper;
const stopHelper = () => { try { helper?.kill(); } catch { /* gone */ } };
process.on('exit', stopHelper);
const bookmarkletCode = async (t) => {
  await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
  const sec = left(t).getByTestId('ikea-section');
  await sec.getByTestId('ikea-bookmarklet').locator('summary').click();
  return decodeURIComponent((await sec.getByTestId('ikea-bookmarklet-link').getAttribute('href')).replace(/^javascript:/, ''));
};
async function send(t, url, name, dims, price, ikea = false) {
  const { context } = t;
  const shop = await context.newPage();
  await shop.route(url, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': ikea ? "connect-src 'self'" : CSP }, body: pageHtml(name, url, dims, price) }));
  await context.grantPermissions(['local-network-access'], { origin: new URL(url).origin }).catch(() => undefined);
  await shop.goto(url);
  const popup = ikea ? null : context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await shop.evaluate(t.code);
  let msg = '';
  if (ikea) {
    const frame = shop.frameLocator('iframe');
    await t.poll(async () => (/ist im Planer/.test(await frame.locator('#s').innerText().catch(() => '')) ? 1 : null), 20000);
    msg = await frame.locator('#s').innerText().catch(() => '');
  } else {
    const win = await popup;
    if (win) {
      await t.poll(async () => (/ist im Planer/.test(await win.locator('#s').innerText().catch(() => '')) ? 1 : null), 20000);
      msg = await win.locator('#s').innerText().catch(() => '');
      await win.close().catch(() => undefined);
    }
  }
  await shop.close().catch(() => undefined);
  await t.page.bringToFront();
  return msg.replace(/\n/g, ' ');
}

export default {
  issue: 278,
  name: 'Möbelix-Liste im Katalog',
  title: 'Katalog: eigene Möbelix-Liste wie „Meine IKEA-Auswahl“',
  device: 'desktop',
  pc: false,
  realDevice: [],
  ignoreConsole: [/ERR_CONNECTION_REFUSED/, /Failed to load resource/, /blocked by CSP|Content Security Policy|violates the following/i],
  steps: [
    {
      nr: 1,
      action: 'Links Katalog öffnen.',
      expected: 'Oben drei Reiter, „Alle Möbel | IKEA | Möbelix“.',
      async run(t) {
        const cache = mkdtempSync(join(tmpdir(), 'wp-mx-'));
        helper = spawn('node', ['scripts/ikea-helper.mjs'], { cwd: new URL('../../..', import.meta.url).pathname, env: { ...process.env, IKEA_HELPER_CACHE: cache }, stdio: 'ignore' });
        await t.poll(async () => ((await fetch('http://127.0.0.1:4791/empfang').then((r) => r.ok).catch(() => false)) ? 1 : null), 15000);
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        const tabs = await left(t).getByRole('button', { name: /^(Alle Möbel|IKEA|Möbelix)$/ }).allInnerTexts();
        t.code = await bookmarkletCode(t);
        await left(t).getByRole('button', { name: 'Möbelix', exact: true }).click();
        await t.shot('Katalog mit drei Reitern');
        return { status: ['Alle Möbel', 'IKEA', 'Möbelix'].every((n) => tabs.map((x) => x.trim()).includes(n)) ? 'ok' : 'fail', observed: `Reiter: ${tabs.map((x) => x.trim()).join(' | ')}.` };
      },
    },
    {
      nr: 2,
      action: 'Auf einer Möbelix-Produktseite das Lesezeichen „An Planer senden“ klicken.',
      expected: 'Das Fenster meldet „… ist im Planer (Katalog › Möbelix)“; im Planer erscheint „… übernommen – zu finden unter Katalog › Möbelix“.',
      async run(t) {
        const msg = await send(t, MX(1), 'TESTTISCH Synthetisch', [160, 90, 76], 299);
        const toast = await t.poll(async () => (await t.page.getByText(/übernommen – zu finden unter Katalog › Möbelix/).first().innerText().catch(() => '')) || null, 20000);
        return { status: /ist im Planer \(Katalog › Möbelix\)/.test(msg) && /TESTTISCH Synthetisch/.test(toast ?? '') ? 'ok' : 'fail', observed: `Fenster: „${msg}“; Hinweis im Planer: „${(toast ?? '').replace(/\n/g, ' ')}“.` };
      },
    },
    {
      nr: 3,
      action: 'Reiter „Möbelix“ öffnen.',
      expected: '„Meine Möbelix-Auswahl (n)“ mit Karte (Foto bzw. Farbfeld, Maße, Preis, „Näherung“, „neu vom Lesezeichen“).',
      async run(t) {
        await left(t).getByRole('button', { name: 'Möbelix', exact: true }).click();
        const sec = left(t).getByTestId('moebelix-section');
        const head = (await sec.getByRole('heading', { name: /Meine Möbelix-Auswahl/ }).innerText()).trim();
        const card = sec.getByTestId('moebelix-card').first();
        const txt = (await card.innerText()).replace(/\n/g, ' ');
        await t.shot('Möbelix-Karte');
        const ok = /160/.test(txt) && /299/.test(txt) && /Näherung/.test(txt) && /neu vom Lesezeichen/.test(txt);
        return { status: ok ? 'ok' : 'fail', observed: `Überschrift „${head}“; Karte: „${txt.slice(0, 200)}“.` };
      },
    },
    {
      nr: 4,
      action: '„In den Raum“ klicken (bzw. Karte in den Plan ziehen).',
      expected: 'Das Möbel steht im Raum wie bei IKEA.',
      async run(t) {
        const n0 = (await t.project()).furniture.length;
        await left(t).getByTestId('moebelix-card').first().getByRole('button', { name: 'In den Raum' }).click();
        const ok = await t.poll(async () => ((await t.project()).furniture.some((f) => f.name === 'TESTTISCH Synthetisch') ? 1 : null), 6000);
        const f = (await t.project()).furniture.find((q) => q.name === 'TESTTISCH Synthetisch');
        return { status: ok && f.width === 1.6 && f.depth === 0.9 ? 'ok' : 'fail', observed: `Möbel im Projekt: ${n0} → ${(await t.project()).furniture.length}; „${f?.name}“ ${f?.width} × ${f?.depth} × ${f?.height} m bei (${f?.x.toFixed(2)} / ${f?.y.toFixed(2)}). Karte in den Plan ziehen wurde nicht gesondert geprüft.` };
      },
    },
    {
      nr: 5,
      action: '„moebelix.at ↗“ öffnet die Produktseite.',
      expected: 'Link auf die Produktseite.',
      async run(t) {
        const a = left(t).getByTestId('moebelix-card').first().getByRole('link', { name: /moebelix\.at/ });
        const href = await a.getAttribute('href');
        const target = await a.getAttribute('target');
        return { status: href === MX(1) && target === '_blank' ? 'ok' : 'fail', observed: `Link auf ${href}, Ziel ${target} (neuer Tab). Das Öffnen der echten Seite wird nicht abgerufen.` };
      },
    },
    {
      nr: 6,
      action: 'Reiter „IKEA“ öffnen.',
      expected: 'Dort stehen nur noch IKEA-Produkte. Möbelix-Produkte, die vorher in der IKEA-Liste lagen, stehen jetzt bei „Möbelix“, keines fehlt.',
      async run(t) {
        await send(t, IKEA_URL, 'TESTREGAL Synthetisch', [80, 30, 120], 49, true);
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        const sec = left(t).getByTestId('ikea-section');
        await t.poll(async () => ((await sec.getByTestId('ikea-card').count()) > 0 ? 1 : null), 20000);
        const names = await sec.getByTestId('ikea-card').allInnerTexts();
        const only = names.length === 1 && /TESTREGAL/.test(names[0]) && !names.some((n) => /TESTTISCH/.test(n));
        return { status: only ? 'ok' : 'fail', observed: `IKEA-Liste (${names.length}): ${names.map((n) => n.split('\n')[0]).join(' | ')}; das Möbelix-Produkt steht nicht dort. Das Umsortieren bereits gespeicherter Möbelix-Einträge aus einer alten IKEA-Liste habe ich nicht nachgestellt.` };
      },
    },
    {
      nr: 7,
      action: 'Auf einer Möbelix-Karte „Entfernen“ klicken.',
      expected: 'Das Produkt verschwindet aus der Liste, schon platzierte Möbel bleiben im Plan.',
      async run(t) {
        await left(t).getByRole('button', { name: 'Möbelix', exact: true }).click();
        await left(t).getByTestId('moebelix-card').first().getByRole('button', { name: /entfernen/i }).click();
        await t.page.waitForTimeout(600);
        const gone = (await left(t).getByTestId('moebelix-card').count()) === 0;
        const placed = (await t.project()).furniture.some((f) => f.name === 'TESTTISCH Synthetisch');
        return { status: gone && placed ? 'ok' : 'fail', observed: `Karte weg: ${gone}; platziertes Möbel noch im Plan: ${placed}.` };
      },
    },
    {
      nr: 8,
      action: 'Ein Möbelix-Produkt ohne Maße auf der Seite senden.',
      expected: 'Es erscheint unter „Maße fehlen“ im Reiter Möbelix, nicht bei IKEA.',
      async run(t) {
        const msg = await send(t, MX(2), 'TESTSOFA Synthetisch', null, 399);
        await left(t).getByRole('button', { name: 'Möbelix', exact: true }).click();
        const sec = left(t).getByTestId('moebelix-section');
        await t.poll(async () => (/Maße fehlen/.test(await sec.innerText()) ? 1 : null), 20000);
        const txt = (await sec.innerText()).replace(/\n/g, ' ');
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        const ikea = (await left(t).getByTestId('ikea-section').innerText()).replace(/\n/g, ' ');
        await t.shot('Möbelix: Maße fehlen');
        return { status: /Maße fehlen/.test(txt) && /TESTSOFA/.test(txt) && !/TESTSOFA/.test(ikea) ? 'ok' : 'fail', observed: `Fenster: „${msg}“; Möbelix-Reiter enthält „Maße fehlen“ und TESTSOFA: ${/Maße fehlen/.test(txt) && /TESTSOFA/.test(txt)}; im IKEA-Reiter: ${/TESTSOFA/.test(ikea)}.` };
      },
    },
  ],
};
