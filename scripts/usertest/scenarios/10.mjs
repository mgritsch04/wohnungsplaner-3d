// IKEA-Import pflegen (#10) – Testschritte aus dem Kommentar in #10.
// Vorprüfung mit SYNTHETISCHEN Daten (erfundene Namen/Preise, gleiches Dateiformat wie scripts/ikea-products.mjs und der PAX-Planer); IKEA selbst wird nicht abgerufen.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boxGlb } from './_glb.mjs';

const left = (t) => t.page.locator('.panel.left');
const toast = async (t, re) => t.poll(async () => ((await t.page.locator('body').innerText()).match(re)?.[0] ?? null), 6000);
const FIX = 'src/catalog/providers/fixtures';

export default {
  issue: 10,
  name: 'IKEA-Import (Datei-Weg)',
  title: 'IKEA-Import pflegen (GLB-Dateiweg bewahren, Produktdaten, PAX-JSON)',
  device: 'desktop',
  pc: false,
  // Schritt 10 löst die gezeigte Fehlermeldung aus, die die App zusätzlich in die Konsole schreibt
  ignoreConsole: [/IKEA-Planung konnte nicht übernommen werden/],
  realDevice: ['Echte IKEA-Seiten, IKEA-Planer und das Skript scripts/ikea-products.mjs mit Netzzugang'],
  steps: [
    {
      nr: 1,
      action: 'Teil A (Artikelliste), Produktliste erzeugen: Im Projektordner `node scripts/ikea-products.mjs "104.099.32, 106.230.36" --models` ausführen.',
      expected: 'Es entsteht der Ordner `ikea-import` mit `produktliste.json`, `bericht.json` und `.glb`-Dateien.',
      async run() {
        return { status: 'device', observed: 'Ruft echte IKEA-Seiten ab (aus der Cloud sperrt IKEA mit 403, wird nicht umgangen): nur G am PC. Stattdessen habe ich Schritt 2 und 3 mit synthetischen Dateien im gleichen Format geprüft.' };
      },
    },
    {
      nr: 2,
      action: 'Teil A, importieren: In der App links Reiter Katalog › ganz unten „Ordner importieren (z. B. ikea-import)…“ › den Ordner `ikea-import` auswählen › „Hochladen“ bestätigen.',
      expected: 'Meldung „2 Produkt(e) importiert, 2 mit 3D-Modell (übersprungen: bericht.json)“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Katalog', exact: true }).click();
        const list = {
          format: 'wohnungsplaner-catalog',
          version: 1,
          name: 'Synthetisch',
          units: 'cm',
          items: [
            { id: 'a1', name: 'SYNTHETISCH Würfelregal', category: 'storage', width: 111.5, depth: 39, height: 146.5, price: 79, modelFile: '10409932.glb' },
            { id: 'a2', name: 'SYNTHETISCH Standregal', category: 'storage', width: 80, depth: 28, height: 202, price: 59.99, modelFile: '10623036.glb' },
          ],
        };
        const dir = await mkdtemp(join(tmpdir(), 'ikea-import-'));
        await writeFile(join(dir, 'produktliste.json'), JSON.stringify(list));
        await writeFile(join(dir, 'bericht.json'), JSON.stringify([{ article: '104.099.32', ok: true }]));
        await writeFile(join(dir, '10409932.glb'), Buffer.from(boxGlb(1.115, 1.465, 0.39)));
        await writeFile(join(dir, '10623036.glb'), Buffer.from(boxGlb(0.8, 2.02, 0.28)));
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /Ordner importieren/ }).click();
        await (await chooser).setFiles(dir);
        const m = await toast(t, /2 Produkt\(e\) importiert, 2 mit 3D-Modell \(übersprungen: bericht\.json\)/);
        return { status: m ? 'ok' : 'fail', observed: `Meldung: „${m ?? 'nicht gefunden'}“ (synthetische Liste mit zwei erfundenen Produkten und zwei Box-Modellen).` };
      },
    },
    {
      nr: 3,
      action: 'Teil A, prüfen: Im Katalog nach „KALLAX“ suchen, anklicken (wird platziert), dann oben 3D ansehen.',
      expected: 'KALLAX 111,5 × 39 × 146,5 cm, Preis laut Seite, echtes Modell mit Würfelfächern in 3D (kein einfacher Quader).',
      async run(t) {
        const { page } = t;
        await page.getByPlaceholder(/Suchen/).fill('Würfelregal');
        await left(t).getByText('SYNTHETISCH Würfelregal').first().click();
        const f = await t.poll(async () => (await t.project()).furniture.find((x) => x.name === 'SYNTHETISCH Würfelregal'), 5000);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        await t.shot('Importiertes Modell in 3D');
        const dims = f ? [f.width, f.depth, f.height].map((v) => Math.round(v * 1000) / 10) : [];
        return { status: f && f.model.type === 'gltf' && dims.join() === '111.5,39,146.5' ? 'look' : 'fail', observed: `Platziert mit Maßen ${dims.join(' × ')} cm, Modelltyp ${f?.model?.type}, Preis ${f?.price?.amount} €. Dass das echte KALLAX-Modell Würfelfächer hat, ist mit den Box-Testmodellen nicht prüfbar.` };
      },
    },
    {
      nr: 4,
      action: 'Teil B (eigene PAX-Planung), B1 Planung bei IKEA anlegen (Planungscode notieren).',
      expected: 'Die Planung ist unter einem Planungscode abgelegt.',
      async run() {
        return { status: 'device', observed: 'Braucht den IKEA-PAX-Planer im eigenen Browser: nur G.' };
      },
    },
    {
      nr: 5,
      action: 'Teil B, B2 Planungsdaten als Datei speichern (F12 › Netzwerk › configurations › Antwort kopieren › planung.json).',
      expected: 'In `planung.json` kommen die Wörter `itemList` und `articles` vor.',
      async run() {
        return { status: 'device', observed: 'Browser-Entwicklerwerkzeuge auf der echten IKEA-Seite: nur G.' };
      },
    },
    {
      nr: 6,
      action: 'Teil B, ohne Preise importieren: In der App links Reiter Import › „IKEA-Planung (JSON) importieren…“ › nur `planung.json` auswählen.',
      expected: 'Meldung „IKEA-Planung übernommen: Raum + N Korpus(se) …“; ein neuer Raum mit den Maßen aus dem Planer, die Korpusse an den richtigen Stellen (in 2D und 3D prüfen). Ohne Preise, wie bisher. Der GLB-Import unter Katalog funktioniert unverändert.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Import', exact: true }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /IKEA-Planung \(JSON\) importieren/ }).click();
        await (await chooser).setFiles(`${FIX}/ikea-pax-design.json`);
        const m = await toast(t, /IKEA-Planung übernommen: Raum \+ \d+ Korpus[^\n]*/);
        const p = await t.project();
        const room = p.rooms.find((r) => /IKEA-Planung/.test(r.name));
        const frames = p.furniture.filter((f) => /PAX Korpus/.test(f.name));
        t.frames = frames.length;
        await t.shot('Importierte PAX-Planung (synthetische Testplanung)');
        return { status: m && room && frames.length === 5 && frames.every((f) => !f.price) ? 'ok' : 'fail', observed: `Meldung: „${m?.slice(0, 120)}“; neuer Raum „${room?.name}“, ${frames.length} Korpusse (alle ohne Preis: ${frames.every((f) => !f.price)}). Echte Planung von G: Lage der Korpusse in 2D/3D bitte vergleichen.` };
      },
    },
    {
      nr: 7,
      action: 'Teil B (PAX-Planung mit echten Namen und Preisen), Produktliste erzeugen: `node scripts/ikea-products.mjs --plan planung.json --out ikea-import`.',
      expected: 'Meldung „N Produkt(e)“ und die Datei `ikea-import/produktliste.json`.',
      async run() {
        return { status: 'device', observed: 'Ruft echte IKEA-Seiten ab: nur G am PC.' };
      },
    },
    {
      nr: 8,
      action: 'Teil B, importieren: In der App links Import › „IKEA-Planung (JSON) importieren…“ › beide Dateien gleichzeitig wählen (`planung.json` und `ikea-import/produktliste.json`).',
      expected: 'Meldung „IKEA-Planung übernommen: Raum + N Korpus(se) · N/N mit Produktnamen, N mit Preis“, eventuell mit Hinweisen zu Teilen ohne Position (Türen, Scharniere).',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Import', exact: true }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /IKEA-Planung \(JSON\) importieren/ }).click();
        await (await chooser).setFiles([`${FIX}/ikea-pax-design.json`, `${FIX}/ikea-pax-products.synthetic.json`]);
        const m = await toast(t, /IKEA-Planung übernommen: Raum \+ 5 Korpus[^\n]*5\/5 mit Produktnamen, 5 mit Preis[^\n]*/);
        const gaps = await page.getByText(/Nicht in der Produktliste gefunden/).count();
        return { status: m ? 'ok' : 'fail', observed: `Meldung: „${m?.slice(0, 200) ?? 'nicht gefunden'}“; Hinweis auf Teile ohne Eintrag in der Produktliste: ${gaps ? 'ja' : 'nein'}. (Synthetische Namen/Preise.)` };
      },
    },
    {
      nr: 9,
      action: 'Teil B, prüfen: Korpusse und Budget ansehen.',
      expected: 'Die Korpusse tragen echte Namen, z. B. „PAX Korpus Kleiderschrank …“. Rechts unter Budget stehen Preise; je Korpus ist das der Korpus plus Böden, Stangen und Schubladen. Türen und Scharniere ohne eigene Position werden in der Meldung mit ihrer Summe genannt.',
      async run(t) {
        const { page } = t;
        const p = await t.project();
        const frames = p.furniture.filter((f) => /SYNTHETISCH Testartikel/.test(f.name));
        await page.locator('.panel.right').getByRole('button', { name: 'Budget', exact: true }).click();
        const txt = await page.locator('.panel.right').innerText();
        const inBudget = frames.filter((f) => txt.includes(f.name)).length;
        await t.shot('Budget mit importierten Korpussen');
        return { status: frames.length === 5 && frames.every((f) => (f.price?.amount ?? 0) > 0) && inBudget === 5 ? 'look' : 'fail', observed: `${frames.length} Korpusse mit Namen aus der Produktliste, alle mit Preis > 0; im Budget gelistet: ${inBudget}/5. Dass „Korpus + Böden + Stangen + Schubladen“ die richtige Summe ergibt, gilt mit synthetischen Preisen als plausibel, mit echten Preisen bitte nachrechnen.` };
      },
    },
    {
      nr: 10,
      action: 'Teil B, Fehlermeldung: Nur `produktliste.json` wählen.',
      expected: 'Meldung „Keine IKEA-Planung gewählt“.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: 'Import', exact: true }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /IKEA-Planung \(JSON\) importieren/ }).click();
        await (await chooser).setFiles(`${FIX}/ikea-pax-products.synthetic.json`);
        const m = await toast(t, /Keine IKEA-Planung gewählt[^\n]*/);
        return { status: m ? 'ok' : 'fail', observed: `Meldung: „${m ?? 'nicht gefunden'}“.` };
      },
    },
  ],
};
