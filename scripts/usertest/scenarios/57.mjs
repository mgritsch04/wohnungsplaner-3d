// Einkaufsliste als CSV (#57) – Testschritte aus dem Kommentar in #57.
import { readFileSync } from 'node:fs';

const isLamp = (f) => f.catalogId === 'generic-floor-lamp';
const parse = (text) => text.replace(/^﻿/, '').split(/\r\n/).map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')));
const COL = 'Maße B × T × H (cm)';

async function exportCsv(t) {
  const { page } = t;
  await page.locator('.panel.right').getByRole('button', { name: 'Budget' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Einkaufsliste als CSV exportieren', exact: true }).click();
  const d = await download;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

export default {
  issue: 57,
  name: 'Einkaufsliste als CSV',
  title: 'Stückliste exportieren (Möbel, Maße, Menge) als CSV',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung laden und ein Möbelstück zweimal duplizieren (Strg+D), damit es dreimal vorkommt.',
      expected: 'Das Möbelstück ist dreimal vorhanden.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const f = await t.furniture(isLamp);
        const s = await t.planToScreen(f.x, f.y);
        await page.mouse.click(s.x, s.y);
        if ((await t.selection())?.id !== f.id) return { status: 'fail', observed: `„${f.name}“ ließ sich im Plan nicht auswählen.` };
        await page.keyboard.press('Control+d');
        await page.waitForTimeout(300);
        await page.keyboard.press('Control+d');
        const n = await t.poll(async () => {
          const c = (await t.project()).furniture.filter(isLamp).length;
          return c === 3 ? c : null;
        }, 4000);
        return {
          status: n === 3 ? 'ok' : 'fail',
          observed: `„${f.name}“ kommt jetzt ${(await t.project()).furniture.filter(isLamp).length}-mal vor.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Bei Budget / Einkaufsliste die Liste als CSV exportieren.',
      expected: 'Eine CSV-Datei wird heruntergeladen.',
      async run(t) {
        const csv = await exportCsv(t);
        t.csv = csv;
        return {
          status: /\.csv$/.test(csv.name) && csv.bytes.length > 50 ? 'ok' : 'fail',
          observed: `Heruntergeladen: „${csv.name}“, ${csv.bytes.length} Bytes.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Die Datei in Excel oder LibreOffice öffnen.',
      expected: 'Umlaute und €-Beträge sind korrekt, die Spalten sind richtig getrennt.',
      async run(t) {
        const b = t.csv.bytes;
        const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
        const text = b.toString('utf8');
        const rows = parse(text);
        const width = rows[0].length;
        const even = rows.filter((r) => r.length > 1).every((r) => r.length === width);
        const umlauts = /[äöüÄÖÜß×]/.test(text) && !text.includes('�');
        return {
          status: bom && even && umlauts ? 'ok' : 'fail',
          observed: `Datei geprüft statt in Excel geöffnet: UTF-8 mit Byte-Order-Mark ${bom ? 'ja' : 'nein'} (damit liest Excel Umlaute richtig), Trennzeichen Semikolon, ${rows.filter((r) => r.length > 1).length} Zeilen mit je ${width} Spalten${even ? '' : ' (ungleich viele!)'}, Umlaute lesbar: ${umlauts ? 'ja' : 'nein'}. Kopfzeile: ${rows[0].join(' | ')}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Spalten ansehen.',
      expected: 'Es gibt eine Spalte „Maße B × T × H (cm)“.',
      async run(t) {
        const rows = parse(t.csv.bytes.toString('utf8'));
        const i = rows[0].indexOf(COL);
        const sample = rows.slice(1).find((r) => r[i])?.[i];
        return {
          status: i >= 0 && /\d+ × \d+ × \d+/.test(sample ?? '') ? 'ok' : 'fail',
          observed: i >= 0 ? `Spalte „${COL}“ ist da, z. B. „${sample}“.` : `Keine Spalte „${COL}“. Spalten: ${rows[0].join(', ')}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Das dreifach vorhandene Möbelstück in der Liste suchen.',
      expected: 'Es steht in einer Zeile mit Menge 3 und dem richtigen Gesamtpreis. Gleich benannte Möbel mit anderen Maßen oder Preisen stehen in getrennten Zeilen.',
      async run(t) {
        const { page } = t;
        const lamp = await t.furniture(isLamp);
        const rows = parse(t.csv.bytes.toString('utf8'));
        const h = rows[0];
        const [iName, iQty, iUnit, iSum] = ['Artikel', 'Menge', 'Einzelpreis EUR', 'Summe EUR'].map((c) => h.indexOf(c));
        const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
        const lampRows = rows.slice(1).filter((r) => r[iName] === lamp.name);
        const r = lampRows[0];
        const sumOk = r && num(r[iQty]) === 3 && Math.abs(num(r[iSum]) - 3 * num(r[iUnit])) < 0.005;
        // second half: one copy gets another price → it must show up in its own row
        const copy = (await t.project()).furniture.filter(isLamp).at(-1);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), copy.id);
        const right = page.locator('.panel.right');
        await right.getByRole('button', { name: 'Eigenschaften' }).click();
        const price = right.locator('label.field').filter({ has: page.locator('.field-label', { hasText: /^Preis$/ }) }).locator('input');
        await price.fill(String(num(r?.[iUnit] ?? 0) + 10));
        await price.press('Tab');
        await t.poll(async () => ((await t.project()).furniture.find((x) => x.id === copy.id).price?.status === 'user' ? true : null), 3000);
        const again = parse((await exportCsv(t)).bytes.toString('utf8')).slice(1).filter((x) => x[iName] === lamp.name);
        // … and one of the two remaining copies gets another width → three rows
        const other = (await t.project()).furniture.filter(isLamp)[1];
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), other.id);
        await right.getByRole('button', { name: 'Eigenschaften' }).click();
        const width = right.locator('label.field').filter({ has: page.locator('.field-label', { hasText: /^Breite$/ }) }).locator('input');
        await width.fill('45');
        await width.press('Tab');
        await t.poll(async () => (Math.abs((await t.project()).furniture.find((x) => x.id === other.id).width - 0.45) < 1e-6 ? true : null), 3000);
        const third = parse((await exportCsv(t)).bytes.toString('utf8')).slice(1).filter((x) => x[iName] === lamp.name);
        const split = again.length === 2 && again.map((x) => num(x[iQty])).sort().join(',') === '1,2' && third.length === 3;
        return {
          status: lampRows.length === 1 && sumOk && split ? 'ok' : 'fail',
          observed: `„${lamp.name}“: ${lampRows.length} Zeile(n), Menge ${r?.[iQty]}, Einzelpreis ${r?.[iUnit]} €, Summe ${r?.[iSum]} €${sumOk ? ' (= 3 × Einzelpreis)' : ' (passt nicht)'}. Danach eine Kopie auf einen anderen Preis gesetzt und neu exportiert: ${again.length} Zeilen mit Menge ${again.map((x) => x[iQty]).join(' und ')}. Dann eine weitere Kopie auf 45 cm Breite gesetzt: ${third.length} Zeilen (${third.map((x) => x[h.indexOf(COL)]).join(' / ')}).`,
          caption: 'Budget-Ansicht nach dem zweiten Export',
        };
      },
    },
  ],
};
