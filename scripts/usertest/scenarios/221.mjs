// IKEA-Lesezeichen „An Planer senden“ (#221) – Testschritte aus dem Kommentar in #221.
// Mit dem ECHTEN Helfer (eigener Zwischenspeicher) und dem echten Lesezeichen-Code aus dem Planer; die Shop-Seiten sind
// SYNTHETISCH (keine echten IKEA-/Möbelix-Daten, kein Abruf der Händlerseiten). Das Ziehen in die Lesezeichenleiste,
// die Browser-Abfrage zum lokalen Netzwerk und echte Händlerseiten bleiben für den Menschen.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const left = (t) => t.page.locator('.panel.left');
const section = (t) => left(t).getByTestId('ikea-section');
const IKEA_URL = 'https://www.ikea.com/at/de/p/testregal-synthetisch-00000097/';
const MOEBELIX_URL = 'https://www.moebelix.at/p/testtisch-synthetisch-001';
const OTHER_URL = 'https://www.example.org/';
const CSP_NO_FRAMES = "default-src 'self'; frame-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'";
const pageHtml = (name, url, w, d, h, price) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${name}</title>
<link rel="canonical" href="${url}">
<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, url, offers: { price: String(price), priceCurrency: 'EUR' } })}</script>
</head><body><h1>${name}</h1><p>Breite: ${w} cm</p><p>Tiefe: ${d} cm</p><p>Höhe: ${h} cm</p></body></html>`;

let helper;
const stopHelper = () => {
  try {
    helper?.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stopHelper);
const startHelper = async (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'wp-lesezeichen-'));
  helper = spawn('node', ['scripts/ikea-helper.mjs'], { cwd: new URL('../../..', import.meta.url).pathname, env: { ...process.env, IKEA_HELPER_CACHE: cache }, stdio: 'ignore' });
  await t.poll(async () => ((await fetch('http://127.0.0.1:4791/empfang').then((r) => r.ok).catch(() => false)) ? 1 : null), 15000);
};
/** The bookmark's code as the planner offers it (href of the link, decoded). */
const bookmarkletCode = async (t) => decodeURIComponent((await section(t).getByTestId('ikea-bookmarklet-link').getAttribute('href')).replace(/^javascript:/, ''));

export default {
  issue: 221,
  name: 'Lesezeichen „An Planer senden“',
  title: 'IKEA-Lesezeichen „An Planer senden“: Produktseite per Klick in „Meine IKEA-Auswahl“',
  device: 'desktop',
  pc: false,
  realDevice: ['Lesezeichen wirklich in die Lesezeichenleiste ziehen, Browser-Abfrage zum lokalen Netzwerk bestätigen, echte IKEA- und Möbelix-Seiten (3D-Modell von IKEA, Preis und Foto von Möbelix)'],
  ignoreConsole: [/ERR_CONNECTION_REFUSED/, /Failed to load resource/, /blocked by CSP|Content Security Policy|violates the following/i],
  steps: [
    {
      nr: 1,
      action: 'Im Planer auf Katalog › IKEA gehen und „Lesezeichen „An Planer senden““ aufklappen.',
      expected: 'Ein Link „An Planer senden“ und ein Knopf „Code kopieren“ werden angezeigt.',
      async run(t) {
        const { page } = t;
        await startHelper(t);
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        await section(t).getByTestId('ikea-helper-status').waitFor();
        await section(t).getByTestId('ikea-bookmarklet').locator('summary').click();
        const link = section(t).getByTestId('ikea-bookmarklet-link');
        const label = (await link.innerText()).trim();
        const href = (await link.getAttribute('href')) ?? '';
        const copy = await section(t).getByRole('button', { name: 'Code kopieren' }).count();
        await t.shot('Lesezeichen im Planer');
        t.code = await bookmarkletCode(t);
        return { status: label === 'An Planer senden' && href.startsWith('javascript:') && copy === 1 ? 'ok' : 'fail', observed: `Link „${label}“ (href beginnt mit javascript:, ${href.length} Zeichen), Knopf „Code kopieren“ ×${copy}.` };
      },
    },
    {
      nr: 2,
      action: 'Den Link in die Lesezeichenleiste des Browsers ziehen.',
      expected: 'In der Leiste gibt es jetzt das Lesezeichen „An Planer senden“.',
      async run() {
        return { status: 'device', observed: 'Das Ziehen in die Lesezeichenleiste des Browsers ist in der Cloud nicht prüfbar (kein Browser-Profil mit Lesezeichenleiste). Der Link selbst ist ein gültiger javascript:-Link (Schritt 1).' };
      },
    },
    {
      nr: 3,
      action: 'Auf ikea.com eine Produktseite öffnen (z. B. ein Regal) und das Lesezeichen anklicken. Fragt der Browser nach dem lokalen Netzwerk, „Erlauben“.',
      expected: 'Oben rechts erscheint kurz ein kleines Kästchen mit „… ist im Planer – mit 3D-Modell“.',
      async run(t) {
        const { context } = t;
        const code = t.code;
        const shop = await context.newPage();
        t.shop = shop;
        await shop.route(IKEA_URL, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': "connect-src 'self'" }, body: pageHtml('TESTREGAL Synthetisch', IKEA_URL, 80, 30, 120, 49) }));
        await context.grantPermissions(['local-network-access'], { origin: 'https://www.ikea.com' }).catch(() => undefined);
        await shop.goto(IKEA_URL);
        await shop.evaluate(code);
        const frame = shop.frameLocator('iframe');
        await t.poll(async () => (/ist im Planer/.test(await frame.locator('#s').innerText().catch(() => '')) ? 1 : null), 20000);
        const msg = await frame.locator('#s').innerText({ timeout: 3000 }).catch(() => '');
        await shop.screenshot({ path: join(t.outDir, 'step-3-1.jpg'), type: 'jpeg', quality: 72 });
        t.extraShots.push({ file: 'step-3-1.jpg', caption: 'Synthetische IKEA-Seite mit Kästchen oben rechts' });
        t.msg3 = msg;
        // the box itself works; "mit 3D-Modell" needs the real IKEA model server, not reachable here
        return { status: /„TESTREGAL Synthetisch“ ist im Planer/.test(msg) ? 'device' : 'fail', observed: `Kästchen auf der synthetischen IKEA-Seite: „${msg.replace(/\n/g, ' ')}“. „mit 3D-Modell“ gibt es nur bei einer echten IKEA-Seite (Modell kommt von IKEA), nicht prüfbar.` };
      },
    },
    {
      nr: 4,
      action: 'Zurück in den Planer (IKEA-Reiter) wechseln.',
      expected: 'Innerhalb weniger Sekunden erscheint das Produkt in „Meine IKEA-Auswahl“ mit dem Hinweis „neu vom Lesezeichen“ und lässt sich wie gewohnt in den Raum stellen.',
      async run(t) {
        const { page } = t;
        await page.bringToFront();
        const card = section(t).getByTestId('ikea-card');
        await card.first().waitFor({ timeout: 20000 });
        const txt = await card.first().innerText();
        await card.first().getByRole('button', { name: 'In den Raum' }).click();
        const ok = await t.poll(async () => ((await t.project()).furniture.some((f) => f.name === 'TESTREGAL Synthetisch') ? 1 : null), 6000);
        await page.waitForTimeout(500);
        return { status: /TESTREGAL Synthetisch/.test(txt) && /neu vom Lesezeichen/.test(txt) && ok ? 'ok' : 'fail', observed: `Karte: „${txt.replace(/\n/g, ' ').slice(0, 160)}“; „In den Raum“: Möbel im Projekt ${ok ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 5,
      action: 'Das Lesezeichen auf einer anderen Seite anklicken (z. B. google.com).',
      expected: 'Nur eine Meldung, dass das Lesezeichen auf ikea.com oder moebelix.at gedacht ist. Es passiert sonst nichts.',
      async run(t) {
        const { context } = t;
        const code = t.code;
        const other = await context.newPage();
        await other.route(OTHER_URL, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Andere Seite</title><h1>Andere Seite</h1>' }));
        await other.goto(OTHER_URL);
        let dialog = null;
        other.once('dialog', async (d) => {
          dialog = d.message();
          await d.dismiss();
        });
        const cardsBefore = await section(t).getByTestId('ikea-card').count();
        await other.evaluate(code);
        await other.waitForTimeout(1500);
        const iframes = await other.locator('iframe').count();
        await t.page.bringToFront();
        await t.page.waitForTimeout(2500);
        const cardsAfter = await section(t).getByTestId('ikea-card').count();
        await other.close();
        return { status: dialog && /ikea\.com oder moebelix\.at/.test(dialog) && iframes === 0 && cardsAfter === cardsBefore ? 'ok' : 'fail', observed: `Meldung: „${dialog}“; Frame auf der Seite: ${iframes}; Karten in der Auswahl vorher/nachher: ${cardsBefore}/${cardsAfter}.` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Auf moebelix.at eine Produktseite öffnen und das Lesezeichen anklicken.',
      expected: 'Das Produkt erscheint mit Händler „Möbelix“ und Preis in der Auswahl, aber ohne 3D-Modell (es wird ein einfacher Platzhalter-Körper verwendet).',
      async run(t) {
        const { context, page } = t;
        const code = t.code;
        const shop = await context.newPage();
        await shop.route(MOEBELIX_URL, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': CSP_NO_FRAMES }, body: pageHtml('TESTTISCH Synthetisch', MOEBELIX_URL, 160, 90, 76, 299) }));
        await shop.goto(MOEBELIX_URL);
        const popup = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        await shop.evaluate(code);
        const win = await popup;
        if (win) await t.poll(async () => (/ist im Planer/.test(await win.locator('#s').innerText().catch(() => '')) ? 1 : null), 20000);
        const msg = win ? await win.locator('#s').innerText({ timeout: 3000 }).catch(() => '') : '';
        await shop.close().catch(() => undefined);
        await page.bringToFront();
        // Möbelix has its own list (#278)
        await left(t).getByRole('button', { name: 'Möbelix', exact: true }).click().catch(() => undefined);
        await page.waitForTimeout(3000);
        const txt = await left(t).innerText();
        const has = /TESTTISCH Synthetisch/.test(txt);
        await t.shot('Möbelix-Auswahl');
        const card = left(t).locator('[data-testid$="-card"]', { hasText: 'TESTTISCH Synthetisch' }).first();
        const cardTxt = (await card.count()) ? await card.innerText() : '';
        return { status: has && /299/.test(cardTxt) && /Möbelix/i.test(cardTxt) && !/3D-Modell/.test(cardTxt.replace('Näherungsmodell', '')) ? 'ok' : 'fail', observed: `Empfangsfenster: „${msg.replace(/\n/g, ' ')}“; Karte: „${cardTxt.replace(/\n/g, ' ').slice(0, 200)}“.` };
      },
    },
    {
      nr: 7,
      action: 'Den Helfer beenden und das Lesezeichen auf einer IKEA-Seite noch einmal anklicken.',
      expected: 'Nach ein paar Sekunden kommt eine Meldung, dass der Helfer nicht läuft.',
      async run(t) {
        const { context } = t;
        const code = t.code;
        helper.kill();
        await t.page.waitForTimeout(1000);
        const shop = await context.newPage();
        await shop.route(IKEA_URL, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': "connect-src 'self'" }, body: pageHtml('TESTREGAL Synthetisch', IKEA_URL, 80, 30, 120, 49) }));
        await shop.goto(IKEA_URL);
        await shop.evaluate(code);
        const hint = shop.getByText('Der Planer-Helfer antwortet nicht.');
        const shown = await hint.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
        const body = shown ? await shop.locator('div', { hasText: 'Der Planer-Helfer antwortet nicht.' }).last().innerText() : '';
        const copyBtn = await shop.getByRole('button', { name: 'Seite kopieren' }).count();
        await shop.screenshot({ path: join(t.outDir, 'step-7-1.jpg'), type: 'jpeg', quality: 72 });
        t.extraShots.push({ file: 'step-7-1.jpg', caption: 'Hinweis auf der IKEA-Seite' });
        return { status: shown && /npm run ikea-helper/.test(body) && copyBtn === 1 ? 'ok' : 'fail', observed: `Hinweis „Der Planer-Helfer antwortet nicht.“ sichtbar: ${shown}; nennt „npm run ikea-helper“, Knopf „Seite kopieren“ ×${copyBtn}.` };
      },
    },
  ],
};
