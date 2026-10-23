// IKEA-Produktauswahl im Planer (#183) – Testschritte aus dem Kommentar in #183.
// Schritt 1–3 laufen mit dem ECHTEN Helfer (npm run ikea-helper). Das Holen echter IKEA-Seiten ist hier nicht möglich
// (kein Zugriff auf ikea.com, keine Händlerseiten abrufen): Schritt 4–6 nutzen deshalb einen Stellvertreter-Helfer mit
// SYNTHETISCHEM Produkt (wie e2e/ikea.spec.ts) und bleiben als „am echten Produkt prüfen“ offen.
import { spawn } from 'node:child_process';
import { boxGlb } from './_glb.mjs';

const HELPER = 'http://127.0.0.1:4791';
const left = (t) => t.page.locator('.panel.left');
const section = (t) => left(t).getByTestId('ikea-section');
let helper;
const stopHelper = () => {
  try {
    helper?.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stopHelper);

export default {
  issue: 183,
  name: 'IKEA-Produktauswahl',
  title: 'IKEA-Produktauswahl im Planer: Link einfügen, holen, als 3D-Objekt platzieren',
  device: 'desktop',
  pc: false,
  // Konsolenmeldungen, die der Test selbst auslöst: gestoppter Helfer (Schritt 2) und der Stellvertreter-Helfer kennt /inbox und /bookmarklet (#221) nicht
  ignoreConsole: [/ERR_CONNECTION_REFUSED/, /status of 404/],
  realDevice: ['Echtes Holen einer IKEA-Produktseite (z. B. KALLAX) mit dem Helfer auf dem PC, Aussehen des echten 3D-Modells und Maße gegen die IKEA-Seite'],
  steps: [
    {
      nr: 1,
      action: 'Im Projektordner ein zweites Terminal öffnen und `npm run ikea-helper` eingeben. Das Fenster offen lassen.',
      expected: '„IKEA-Helfer läuft auf http://127.0.0.1:4791 …“',
      async run(t) {
        let out = '';
        helper = spawn('node', ['scripts/ikea-helper.mjs'], { cwd: new URL('../../..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });
        helper.stdout.on('data', (d) => (out += d));
        helper.stderr.on('data', (d) => (out += d));
        await t.poll(async () => (/läuft auf/.test(out) ? 1 : null), 15000);
        const line = out.split('\n').find((l) => /läuft auf/.test(l)) ?? out.slice(0, 200);
        return { noFinalShot: false, status: /IKEA-Helfer läuft auf http:\/\/127\.0\.0\.1:4791/.test(line) ? 'ok' : 'fail', observed: `Ausgabe: „${line.trim()}“` };
      },
    },
    {
      nr: 2,
      action: 'Im Planer links den Reiter Katalog öffnen und oben auf IKEA klicken.',
      expected: 'Ein grüner Kasten mit „IKEA-Helfer verbunden.“ Läuft der Helfer nicht, steht dort eine Anleitung, und „Holen“ ist gesperrt.',
      async run(t) {
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        const status = section(t).getByTestId('ikea-helper-status');
        await status.waitFor();
        const state = await t.poll(async () => ((await status.getAttribute('data-state')) === 'on' ? 'on' : null), 8000);
        const txt = await status.innerText();
        const color = await status.evaluate((el) => getComputedStyle(el).backgroundColor + ' / ' + getComputedStyle(el).borderColor + ' / ' + getComputedStyle(el).color);
        // helper stopped: instructions instead, "Holen" locked
        helper.kill();
        await t.page.waitForTimeout(800);
        await t.page.reload();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        await section(t).getByLabel(/Links oder Artikelnummern/).fill('104.099.32');
        const off = await t.poll(async () => ((await section(t).getByTestId('ikea-helper-status').getAttribute('data-state')) === 'off' ? 'off' : null), 8000);
        const offTxt = await section(t).getByTestId('ikea-helper-status').innerText();
        const locked = await left(t).getByRole('button', { name: 'Holen' }).isDisabled();
        await t.shot('Ohne Helfer: Anleitung, Holen gesperrt');
        return { status: state === 'on' && /IKEA-Helfer verbunden/.test(txt) && off === 'off' && /npm run ikea-helper/.test(offTxt) && locked ? 'ok' : 'fail', observed: `Mit Helfer: Kasten „${txt.trim()}“ (Farben ${color}); ohne Helfer: Anleitung „${offTxt.replace(/\n/g, ' ').slice(0, 120)}“, Holen gesperrt: ${locked}.` };
      },
    },
    {
      nr: 3,
      action: 'Auf ikea.com/at ein Produkt suchen … Die Adresse der Produktseite kopieren und ins Feld „Links oder Artikelnummern“ einfügen. Du kannst auch mehrere Links oder Nummern eintragen, eine pro Zeile.',
      expected: 'Der Link bzw. die Nummer steht im Feld.',
      async run(t) {
        const field = section(t).getByLabel(/Links oder Artikelnummern/);
        await field.fill('https://www.ikea.com/at/de/p/testregal-weiss-00000001/\n999.999.99');
        const v = await field.inputValue();
        const btn = await left(t).getByRole('button', { name: /Produkte? holen|Holen/ }).first().innerText();
        return { status: v.includes('00000001') && v.includes('999.999.99') ? 'ok' : 'fail', observed: `Feld enthält ${v.split('\n').length} Zeilen (Link mit Artikelnummer, Nummer); Knopf: „${btn}“. (Link ist ein synthetischer, kein echter IKEA-Link.)` };
      },
    },
    {
      nr: 4,
      action: '„3D-Modell mitladen“ angehakt lassen und auf Holen klicken.',
      expected: 'Nach ein paar Sekunden erscheint eine Meldung wie „1 von 1 IKEA-Produkt(en) übernommen“. Unter „Meine IKEA-Auswahl“ steht dann eine Karte mit Bild, Name, Maßen (B × T × H), Artikelnummer, Preis mit Datum und dem grünen Kennzeichen „3D-Modell“.',
      async run(t) {
        const { page } = t;
        const cors = { 'access-control-allow-origin': '*' };
        await page.route(`${HELPER}/**`, async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === '/status') return route.fulfill({ headers: cors, json: { ok: true, name: 'wohnungsplaner-ikea-helper', version: 1 } });
          if (url.pathname === '/product') {
            const art = url.searchParams.get('article');
            if (art === '999.999.99') return route.fulfill({ headers: cors, json: { article: art, entry: null, model: null, reason: 'HTTP 404' } });
            return route.fulfill({ headers: cors, json: { article: art, entry: { name: 'TESTREGAL Synthetisch', category: 'storage', width: 80, depth: 30, height: 120, price: 49.99, priceDate: '2026-10-17', retailer: 'IKEA Österreich', productUrl: 'https://www.ikea.com/at/de/p/-00000001/', articleNumber: art, modelFile: '00000001.glb' }, model: '00000001.glb' } });
          }
          if (url.pathname === '/model/00000001.glb') return route.fulfill({ headers: { ...cors, 'content-type': 'model/gltf-binary' }, body: Buffer.from(boxGlb(0.8, 1.2, 0.3)) });
          return route.fulfill({ status: 404, headers: cors, json: { error: 'Nicht gefunden.' } });
        });
        await page.reload();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        await section(t).getByLabel(/Links oder Artikelnummern/).fill('https://www.ikea.com/at/de/p/testregal-weiss-00000001/');
        await section(t).getByRole('button', { name: /holen/i }).click();
        await page.getByText(/1 von 1 IKEA-Produkt\(en\) übernommen/).waitFor({ timeout: 10000 });
        const card = section(t).getByTestId('ikea-card');
        const txt = await card.innerText();
        await t.shot('Karte in „Meine IKEA-Auswahl“ (synthetisches Produkt)');
        const parts = ['TESTREGAL Synthetisch', '80 × 30 × 120 cm', '000.000.01', '3D-Modell'].map((s) => txt.includes(s));
        const priceDate = /49,99/.test(txt) && /2026|17\.10/.test(txt);
        // only the synthetic stand-in could be fetched: the real IKEA page stays a human check
        return { status: parts.every(Boolean) && priceDate ? 'device' : 'fail', observed: `Mit synthetischem Stellvertreter-Helfer: Meldung „1 von 1 IKEA-Produkt(en) übernommen“, Karte zeigt Name, Maße 80 × 30 × 120 cm, Artikelnummer, Preis 49,99 € mit Datum, „3D-Modell“ (${parts.map(Number).join('')}, Preis+Datum ${priceDate}). Mit einer echten IKEA-Seite nicht geprüft.` };
      },
    },
    {
      nr: 5,
      action: 'Auf der Karte auf In den Raum klicken und oben auf 3D wechseln.',
      expected: 'Das Produkt steht im Raum und sieht aus wie das echte Produkt (beim KALLAX zum Beispiel mit Fächern), nicht wie ein einfacher Kasten. Die Maße rechts unter „Eigenschaften“ stimmen mit der IKEA-Seite überein.',
      async run(t) {
        const { page } = t;
        await section(t).getByTestId('ikea-card').getByRole('button', { name: 'In den Raum' }).click();
        await t.poll(async () => ((await t.project()).furniture.some((f) => f.name === 'TESTREGAL Synthetisch') ? 1 : null), 8000);
        const f = (await t.project()).furniture.find((x) => x.name === 'TESTREGAL Synthetisch');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(2500);
        await t.shot('3D mit dem synthetischen Produkt');
        return { status: f.model.type === 'gltf' && f.width === 0.8 && f.depth === 0.3 && f.height === 1.2 ? 'device' : 'fail', observed: `Im Raum: „${f.name}“, Modelltyp ${f.model.type}, ${f.width * 100}×${f.depth * 100}×${f.height * 100} cm entsprechen der Karte. Ob das echte Modell wie das Produkt aussieht und die Maße zur IKEA-Seite passen, lässt sich nur mit einer echten IKEA-Seite prüfen.` };
      },
    },
    {
      nr: 6,
      action: 'Die Karte noch einmal in den 2D-Plan ziehen.',
      expected: 'Das Produkt landet an der Stelle, an der du loslässt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const card = section(t).getByTestId('ikea-card');
        const eb = await card.boundingBox();
        const target = await t.planToScreen(2.5, 2.05);
        const before = (await t.project()).furniture.filter((f) => f.name === 'TESTREGAL Synthetisch').length;
        await page.mouse.move(eb.x + 30, eb.y + eb.height / 2);
        await page.mouse.down();
        await page.mouse.move(eb.x + 60, eb.y + eb.height / 2, { steps: 3 });
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.mouse.up();
        await t.poll(async () => ((await t.project()).furniture.filter((f) => f.name === 'TESTREGAL Synthetisch').length > before ? 1 : null), 5000);
        const f = (await t.project()).furniture.filter((x) => x.name === 'TESTREGAL Synthetisch').at(-1);
        return { status: Math.abs(f.x - 2.5) < 0.1 && Math.abs(f.y - 2.05) < 0.1 ? 'ok' : 'fail', observed: `Losgelassen bei (2,50 / 2,05) m, Möbel gelandet bei (${f.x.toFixed(2)} / ${f.y.toFixed(2)}) m.` };
      },
    },
    {
      nr: 7,
      action: 'Die Seite neu laden (F5) und wieder Katalog › IKEA öffnen.',
      expected: 'Die Karte ist noch da. Mit „Entfernen“ verschwindet sie aus der Auswahl. Bereits platzierte Möbel bleiben im Plan.',
      async run(t) {
        const { page } = t;
        await page.getByText('Gespeichert').waitFor({ timeout: 8000 });
        await page.waitForTimeout(1200);
        const placed = (await t.project()).furniture.filter((f) => f.name === 'TESTREGAL Synthetisch').length;
        await page.reload();
        await left(t).getByRole('button', { name: 'Katalog' }).click();
        await left(t).getByRole('button', { name: 'IKEA', exact: true }).click();
        const n1 = await section(t).getByTestId('ikea-card').count();
        await section(t).getByTestId('ikea-card').getByRole('button', { name: /entfernen/i }).click();
        const n2 = await section(t).getByTestId('ikea-card').count();
        const placed2 = (await t.project()).furniture.filter((f) => f.name === 'TESTREGAL Synthetisch').length;
        return { status: n1 === 1 && n2 === 0 && placed2 === placed && placed >= 2 ? 'ok' : 'fail', observed: `Nach Neuladen Karten: ${n1}; nach „Entfernen“: ${n2}; platzierte Möbel vorher/nachher: ${placed}/${placed2}.` };
      },
    },
  ],
};
