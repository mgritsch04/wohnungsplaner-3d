// Einkaufsliste nach Raum (#75, Teil A) und „Problem melden“ (#62, Teil B) – Testschritte aus dem Kommentar in #75.
import { readFileSync } from 'node:fs';

const right = (t) => t.page.locator('.panel.right');
const heads = (t) => right(t).locator('.budget-group-head');
const headTexts = async (t) => (await heads(t).allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
const dialog = (t) => t.page.getByRole('dialog', { name: 'Problem melden' });
const report = (t) => dialog(t).getByTestId('bug-report-text').inputValue();
const euro = (s) => Number((s.match(/[\d.]+,\d\d/) ?? ['0'])[0].replace(/\./g, '').replace(',', '.'));
const DESCRIPTION = 'Testlauf: Sofa springt beim Ziehen';

export default {
  issue: 75,
  name: 'Einkaufsliste nach Raum und Problem melden',
  title: 'Stückliste nach Räumen gruppieren (z. B. Küche und Bad getrennt)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung laden. Rechts Budget öffnen und bei „Einkaufsliste“ „nach Raum“ wählen.',
      expected: 'Es erscheinen die Gruppen Schlafzimmer (€ 950,00) und Wohnzimmer (€ 1.180,00), jeweils mit Zwischensumme.',
      async run(t) {
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        await right(t).getByRole('combobox', { name: 'Gruppierung' }).selectOption('room');
        await t.poll(async () => ((await heads(t).count()) >= 2 ? true : null), 4000);
        const h = await headTexts(t);
        const bed = h.find((x) => x.startsWith('Schlafzimmer'));
        const living = h.find((x) => x.startsWith('Wohnzimmer'));
        const ok = h.length === 2 && bed && living && euro(bed) === 950 && euro(living) === 1180;
        return { status: ok ? 'ok' : 'fail', observed: `Gruppen mit Zwischensumme: ${h.join(' · ') || 'keine'}.` };
      },
    },
    {
      nr: 2,
      action: '(Teil A) Ein Möbel aus der Wohnung hinaus ziehen (mit Alt).',
      expected: 'Es erscheint unter „Ohne Raum“, ganz unten.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const p = await t.project();
        const lamp = p.furniture.find((f) => f.catalogId === 'generic-floor-lamp');
        const minX = Math.min(...p.nodes.map((n) => n.x));
        const s = await t.planToScreen(lamp.x, lamp.y);
        const out = await t.planToScreen(minX - 1.2, lamp.y);
        await page.mouse.move(s.x, s.y);
        await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.move((s.x + out.x) / 2, s.y, { steps: 6 });
        await page.mouse.move(out.x, out.y, { steps: 6 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        const moved = await t.furniture((f) => f.id === lamp.id);
        // the click selected the lamp, so the right side shows its properties: back to Budget
        const tab = (await right(t).locator('[aria-selected="true"], .active').first().innerText().catch(() => '')).trim();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        const grouping = await right(t).getByRole('combobox', { name: 'Gruppierung' }).inputValue();
        if (grouping !== 'room') await right(t).getByRole('combobox', { name: 'Gruppierung' }).selectOption('room');
        t.note = grouping !== 'room' ? ` Hinweis: Nach dem Ziehen zeigte die rechte Seite ${tab ? `„${tab}“` : 'die Eigenschaften'}; zurück bei Budget stand die Gruppierung wieder auf „nach ${grouping === 'category' ? 'Kategorie' : grouping}“ und musste neu auf „nach Raum“ gestellt werden.` : '';
        await t.poll(async () => ((await headTexts(t)).some((x) => x.startsWith('Ohne Raum')) ? true : null), 4000);
        const h = await headTexts(t);
        await t.page.waitForTimeout(1000); // let the tab underline finish its transition before the screenshot
        const last = h.at(-1) ?? '';
        const inGroup = await right(t).locator('.budget-group').last().getByText(lamp.name).count();
        return {
          status: moved.x < minX && last.startsWith('Ohne Raum') && inGroup > 0 ? 'ok' : 'fail',
          observed: `„${lamp.name}“ mit gedrückter Alt-Taste nach links aus der Wohnung gezogen (jetzt ${Math.round((minX - moved.x) * 100)} cm außerhalb). Gruppen: ${h.join(' · ')}. In der letzten Gruppe steht „${lamp.name}“: ${inGroup ? 'ja' : 'nein'}.${t.note}`,
        };
      },
    },
    {
      nr: 3,
      action: '(Teil A) „Einkaufsliste als CSV exportieren (nach Raum)“ klicken und die Datei in Excel oder LibreOffice öffnen.',
      expected: 'Die erste Spalte heißt „Raum“. Nach jedem Raum folgt eine Zeile „Zwischensumme …“, am Ende „Gesamt“.',
      async run(t) {
        const download = t.page.waitForEvent('download');
        await right(t).getByRole('button', { name: 'Einkaufsliste als CSV exportieren (nach Raum)' }).click();
        const d = await download;
        const b = readFileSync(await d.path());
        const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
        const rows = b.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
        const first = rows[0][0];
        const isSum = (r) => r.some((c) => /^(Zwischensumme |Gesamt)/.test(c));
        const lines = rows.slice(1).filter((r) => !isSum(r));
        const rooms = [...new Set(lines.map((r) => r[0]).filter(Boolean))];
        const subtotals = rows.filter((r) => r.some((c) => /^Zwischensumme /.test(c))).map((r) => r.find((c) => /^Zwischensumme /.test(c)));
        // a subtotal row directly after the last line of each room
        const order = rooms.every((room) => {
          const lastIdx = rows.findLastIndex((r) => r[0] === room && !isSum(r));
          return rows[lastIdx + 1]?.some((c) => c === `Zwischensumme ${room}`);
        });
        const total = rows.at(-1).some((c) => /^Gesamt/.test(c));
        return {
          status: first === 'Raum' && order && subtotals.length === rooms.length && total ? 'ok' : 'fail',
          observed: `Datei „${d.suggestedFilename()}“ geprüft statt in Excel geöffnet (UTF-8 mit Byte-Order-Mark: ${bom ? 'ja' : 'nein'}, Trennzeichen Semikolon). Erste Spalte: „${first}“. Räume: ${rooms.join(', ')}. Zwischensummen-Zeilen: ${subtotals.join(', ')}${order ? ', jeweils direkt nach dem Raum' : ', nicht direkt nach dem Raum'}. Letzte Zeile: „${rows.at(-1).filter(Boolean).join(' | ')}“.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: '(Teil B) Oben rechts ? → „Problem melden …“ klicken.',
      expected: 'Der Dialog öffnet sich.',
      async run(t) {
        await t.page.getByTitle('Hilfe & Tastenkürzel').click();
        await t.page.getByRole('button', { name: 'Problem melden …' }).click();
        const open = await dialog(t).waitFor({ timeout: 4000 }).then(() => true, () => false);
        return { status: open ? 'ok' : 'fail', observed: open ? 'Der Dialog „Problem melden“ ist offen.' : 'Kein Dialog „Problem melden“.' };
      },
    },
    {
      nr: 5,
      action: '(Teil B) Etwas in „Was ist passiert?“ eintippen.',
      expected: 'Im Bericht darunter stehen deine Beschreibung, App-Version, Browser, Bildschirm sowie Ansicht und Anzahl der Objekte. Kein Projektname und keine Möbelnamen.',
      async run(t) {
        await dialog(t).getByLabel('Was ist passiert?').fill(DESCRIPTION);
        const r = await report(t);
        const p = await t.project();
        const checks = {
          Beschreibung: r.includes(DESCRIPTION),
          'App-Version': /App-Version: \d+\.\d+\.\d+/.test(r),
          Browser: /Browser: /.test(r),
          Bildschirm: /Bildschirm|Fenster|Viewport/i.test(r),
          Ansicht: /Ansicht/i.test(r),
          'Anzahl Objekte': /\d+ (Objekte|Möbel)/.test(r),
        };
        const leaks = [p.name, ...new Set(p.furniture.map((f) => f.name))].filter((n) => r.includes(n));
        const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
        t.privateLeaks = leaks;
        return {
          status: !missing.length && !leaks.length ? 'ok' : 'fail',
          observed: `Im Bericht: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')}. Projektname oder Möbelnamen enthalten: ${leaks.length ? leaks.join(', ') : 'nein'}.`,
          clip: await dialog(t).boundingBox(),
          caption: 'Dialog „Problem melden“ mit Beschreibung',
        };
      },
    },
    {
      nr: 6,
      action: '(Teil B) Häkchen „Projektdaten anfügen“ setzen.',
      expected: 'Jetzt sind die Projektdaten (u. a. Möbelnamen) enthalten.',
      async run(t) {
        await dialog(t).getByLabel(/Projektdaten anfügen/).check();
        const r = await report(t);
        const names = [...new Set((await t.project()).furniture.map((f) => f.name))];
        const found = names.filter((n) => r.includes(n));
        return {
          status: found.length === names.length ? 'ok' : 'fail',
          observed: `Nach dem Häkchen sind ${found.length} von ${names.length} Möbelnamen im Bericht (z. B. ${found.slice(0, 3).map((n) => `„${n}“`).join(', ') || '–'}).`,
          clip: await dialog(t).boundingBox(),
          caption: 'Bericht mit Projektdaten',
        };
      },
    },
    {
      nr: 7,
      action: '(Teil B) „Bericht kopieren“ klicken und in einen Texteditor einfügen.',
      expected: 'Der Text ist vollständig.',
      async run(t) {
        await t.context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const r = await report(t);
        await dialog(t).getByRole('button', { name: 'Bericht kopieren' }).click();
        const pasted = await t.poll(() => t.page.evaluate(() => navigator.clipboard.readText()), 3000);
        return {
          status: pasted === r ? 'ok' : 'fail',
          observed: `Zwischenablage ausgelesen statt in einen Editor eingefügt: ${pasted?.length ?? 0} Zeichen, Bericht im Dialog ${r.length} Zeichen – ${pasted === r ? 'identisch' : 'nicht identisch'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 8,
      action: '(Teil B) „Issue auf GitHub öffnen“ klicken.',
      expected: 'GitHub öffnet ein neues Issue mit Titel und, bei kurzem Bericht, ausgefülltem Text. Du musst es nicht absenden.',
      async run(t) {
        // GitHub itself is not loaded (nothing is sent): the new tab gets a blank page, only its address is checked
        await t.context.route('https://github.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>GitHub (im Test nicht geladen)</p>' }));
        const open = async () => {
          const r = await report(t);
          const tab = t.context.waitForEvent('page');
          await dialog(t).getByRole('button', { name: /Issue auf GitHub öffnen/ }).click();
          const popup = await tab;
          await popup.waitForURL(/github\.com/, { timeout: 5000 }).catch(() => undefined);
          const url = new URL(popup.url());
          await popup.close();
          const title = url.searchParams.get('title') ?? '';
          const body = url.searchParams.get('body') ?? '';
          return { r, url, title, body, ok: /\/issues\/new$/.test(url.pathname) && title.includes(DESCRIPTION) };
        };
        const say = (x) => `${x.r.length} Zeichen → Tab mit ${x.url.origin}${x.url.pathname}, Titel „${x.title}“, Text ${x.body ? `ausgefüllt (${x.body === x.r ? 'gleich dem Bericht' : 'anders als der Bericht'})` : 'leer'}`;
        // long report (with project data) and short report (without)
        const long = await open();
        await dialog(t).getByLabel(/Projektdaten anfügen/).uncheck();
        const short = await open();
        const ok = long.ok && short.ok && short.body === short.r && (long.body === long.r || !long.body);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Langer Bericht mit Projektdaten: ${say(long)}. Kurzer Bericht ohne Projektdaten: ${say(short)}. Nicht abgesendet.`,
          noFinalShot: true,
        };
      },
    },
  ],
};
