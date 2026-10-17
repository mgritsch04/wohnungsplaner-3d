// Plan als PNG / Druckansicht / PDF (#71) – Testschritte aus dem Kommentar in #71.
import { readFileSync } from 'node:fs';

const right = (t) => t.page.locator('.panel.right');
const view = (t) => t.page.getByTestId('print-view');
const PX_PER_MM = 96 / 25.4;

/** Remember the SVG the PNG export draws (it goes through a blob URL). */
const captureSvg = (t) =>
  t.page.evaluate(() => {
    window.__svgs = [];
    const orig = URL.createObjectURL.bind(URL);
    if (!window.__svgHooked) {
      window.__svgHooked = true;
      URL.createObjectURL = (b) => {
        if (b?.type?.startsWith('image/svg')) b.text().then((s) => window.__svgs.push(s));
        return orig(b);
      };
    }
  });

async function exportPng(t) {
  const download = t.page.waitForEvent('download');
  await right(t).getByRole('button', { name: 'Plan als PNG' }).click();
  const d = await download;
  const png = readFileSync(await d.path());
  const svg = await t.poll(() => t.page.evaluate(() => window.__svgs.at(-1)), 3000);
  return { name: d.suggestedFilename(), png, path: await d.path(), svg };
}

/** Count pages of a PDF made with the browser's own print (same as „Als PDF speichern“). */
async function pdfPages(t) {
  await t.page.emulateMedia({ media: 'print' });
  const pdf = await t.page.pdf({ preferCSSPageSize: true, printBackground: true });
  await t.page.emulateMedia({ media: 'screen' });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

export default {
  issue: 71,
  name: 'Plan exportieren und drucken',
  title: 'Plan als PDF oder Bild exportieren (Grundriss mit Maßen, Titel und Maßstab)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung laden. Im Projekt-Panel gibt es den Bereich „Plan exportieren“; im Menü Export ▾ gibt es den Eintrag „Plan drucken / PDF / PNG…“.',
      expected: 'Beides ist vorhanden.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const section = await right(t).getByText('Plan exportieren', { exact: true }).count();
        const oldMenu = await page.getByRole('button', { name: 'Export ▾' }).count();
        await page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const entry = await page.locator('#toolbar-menu-more').getByRole('button', { name: 'Plan drucken / PDF / PNG…' }).count();
        await t.shot('Menü „Mehr“ mit dem Eintrag');
        await page.keyboard.press('Escape');
        return {
          status: section && entry ? 'ok' : 'fail',
          observed: `Projekt-Panel: Bereich „Plan exportieren“ ${section ? 'vorhanden' : 'fehlt'}. Eintrag „Plan drucken / PDF / PNG…“ ${entry ? 'vorhanden' : 'fehlt'} – ${oldMenu ? 'im Menü „Export ▾“' : 'das Menü „Export ▾“ gibt es seit #100 nicht mehr, der Eintrag steht jetzt oben rechts unter „Mehr“ (⋯)'}.`,
        };
      },
    },
    {
      nr: 2,
      action: '„Plan als PNG“ klicken.',
      expected: 'Eine PNG-Datei `…-grundriss-JJJJ-MM-TT.png` wird heruntergeladen. Sie zeigt den Grundriss mit Maßen, Titel, Datum und Maßstabsbalken. Raster und Auswahl sind nicht zu sehen.',
      async run(t) {
        const { page } = t;
        await captureSvg(t);
        // select the sofa first: the picture must not show the selection
        const sofa = (await t.project()).furniture.find((f) => f.catalogId === 'generic-sofa-3');
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa.id);
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const a = await exportPng(t);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const b = await exportPng(t);
        const p = await t.project();
        const date = new Date().toLocaleDateString('de-AT');
        const sig = [...a.png.subarray(0, 8)].join(',') === '137,80,78,71,13,10,26,10';
        const w = a.png.readUInt32BE(16);
        const h = a.png.readUInt32BE(20);
        const svg = a.svg ?? '';
        const checks = {
          Dateiname: /-grundriss-\d{4}-\d{2}-\d{2}\.png$/.test(a.name),
          'PNG-Datei': sig && w > 1000 && h > 500,
          Titel: svg.includes(`>${p.name}</text>`),
          Datum: svg.includes(`>${date}</text>`),
          Maße: (svg.match(/\d,\d\d m/g) ?? []).length >= 4,
          Maßstabsbalken: /data-testid="scale-bar"/.test(svg),
          'kein Raster': !/<pattern/.test(svg),
          'keine Auswahl': !!b.svg && a.svg === b.svg,
        };
        // show the downloaded picture itself in the report
        const tab = await t.context.newPage();
        await tab.setContent(`<body style="margin:0;background:#888"><img src="data:image/png;base64,${a.png.toString('base64')}" style="max-width:100%;display:block"></body>`);
        await tab.screenshot({ path: `${t.outDir}/step-2-1.jpg`, type: 'jpeg', quality: 72 });
        await tab.close();
        t.extraShots.push({ file: 'step-2-1.jpg', caption: `Die heruntergeladene Datei „${a.name}“` });
        const missing = Object.entries(checks).filter(([, v]) => !v);
        return {
          status: missing.length ? 'fail' : 'ok',
          observed: `„${a.name}“, ${w} × ${h} px. Geprüft am gezeichneten Plan (dasselbe SVG, aus dem das PNG entsteht): ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')} (Auswahl: mit ausgewähltem Sofa und ohne Auswahl exportiert, beide Bilder gleich).`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: '„Druckansicht / PDF“ klicken.',
      expected: 'Die Druckansicht zeigt den Plan und darunter die Stückliste mit Menge, Maßen, Händler, Summe und Gesamtsumme.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Druckansicht / PDF' }).click();
        await view(t).waitFor({ timeout: 4000 });
        await view(t).getByRole('button', { name: 'A4 hoch' }).click();
        const plan = await view(t).getByTestId('print-plan').boundingBox();
        const list = await view(t).getByTestId('print-list').boundingBox();
        const heads = (await view(t).locator('[data-testid="print-list"] thead th').allInnerTexts()).map((s) => s.trim());
        const rows = await view(t).locator('[data-testid="print-list"] tbody tr').count();
        const foot = (await view(t).locator('[data-testid="print-list"] tfoot').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        const want = ['Menge', 'Maße', 'Händler', 'Summe'];
        const ok = plan && list && list.y >= plan.y + plan.height - 1 && want.every((w) => heads.some((h) => h.startsWith(w))) && rows > 0 && /€/.test(foot);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Druckansicht offen (A4 hoch). Stückliste ${list && plan && list.y >= plan.y + plan.height - 1 ? 'unter dem Plan' : 'nicht unter dem Plan'}, Spalten: ${heads.join(' | ')}, ${rows} Zeilen, Fußzeile: „${foot}“.`,
        };
      },
    },
    {
      nr: 4,
      action: '„A4 quer“ wählen.',
      expected: 'Die Stückliste steht rechts neben dem Plan.',
      async run(t) {
        await view(t).getByRole('button', { name: 'A4 quer' }).click();
        await t.page.waitForTimeout(400);
        const plan = await view(t).getByTestId('print-plan').boundingBox();
        const list = await view(t).getByTestId('print-list').boundingBox();
        const beside = plan && list && list.x >= plan.x + plan.width - 1 && list.y < plan.y + plan.height;
        return { status: beside ? 'ok' : 'fail', observed: `A4 quer: Stückliste ${beside ? 'rechts neben dem Plan' : 'nicht rechts neben dem Plan'} (Plan ab x ${Math.round(plan?.x)}, Liste ab x ${Math.round(list?.x)}).` };
      },
    },
    {
      nr: 5,
      action: '„Drucken / Als PDF speichern“ klicken und im Druckdialog „Als PDF speichern“ wählen.',
      expected: 'Die Vorschau zeigt genau eine Seite, ohne Buttons und ohne graue Hintergründe. Das gilt für A4 hoch und für A4 quer.',
      async run(t) {
        const { page } = t;
        // the system print dialog can't be operated: the button must call window.print(); the PDF comes from the browser's own print
        await page.evaluate(() => {
          window.__printed = 0;
          window.print = () => void window.__printed++;
        });
        await view(t).getByRole('button', { name: 'Drucken / Als PDF speichern' }).click();
        const printed = await page.evaluate(() => window.__printed);
        const res = {};
        for (const o of ['A4 hoch', 'A4 quer']) {
          await view(t).getByRole('button', { name: o }).click();
          await page.waitForTimeout(300);
          await page.emulateMedia({ media: 'print' });
          const controls = await view(t).getByTestId('print-controls').isVisible();
          const toolbar = await page.locator('header.toolbar').isVisible();
          const grey = await page.evaluate(() => {
            const v = document.querySelector('[data-testid="print-view"]');
            const bad = [];
            for (const el of [v, ...v.querySelectorAll('*')]) {
              const c = getComputedStyle(el).backgroundColor;
              const m = c.match(/\d+(\.\d+)?/g)?.map(Number);
              if (m && (m[3] ?? 1) > 0 && !(m[0] > 245 && m[1] > 245 && m[2] > 245) && el.closest('svg') === null) bad.push(`${el.className || el.tagName} ${c}`);
            }
            return bad;
          });
          await page.emulateMedia({ media: 'screen' });
          res[o] = { pages: await pdfPages(t), controls, toolbar, grey };
        }
        const ok = printed === 1 && Object.values(res).every((r) => r.pages === 1 && !r.controls && !r.toolbar && !r.grey.length);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Der Button ruft den Druck des Browsers auf: ${printed === 1 ? 'ja' : 'nein'}. PDF mit dem Druck des Browsers erzeugt (Druckdialog selbst nicht bedienbar): ${Object.entries(res).map(([o, r]) => `${o}: ${r.pages} Seite(n), Buttons ${r.controls ? 'sichtbar' : 'ausgeblendet'}, App-Leiste ${r.toolbar ? 'sichtbar' : 'ausgeblendet'}, graue Hintergründe ${r.grey.length ? r.grey.slice(0, 3).join('; ') : 'keine'}`).join(' · ')}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 6,
      action: 'Optional: Das PDF in Originalgröße (100 %) ausdrucken und mit dem Lineal messen.',
      expected: '1 m auf dem Maßstabsbalken ist etwa 13,3 mm lang (Maßstab 1:75).',
      async run(t) {
        await view(t).getByRole('button', { name: 'A4 hoch' }).click();
        await t.page.waitForTimeout(300);
        const den = Number(/Maßstab 1:(\d+)/.exec(await view(t).locator('.print-header').innerText())?.[1]);
        const bar = view(t).getByTestId('print-plan').getByTestId('scale-bar');
        const m = Number(await bar.getAttribute('data-length-m'));
        const box = await bar.locator('rect').nth(2).boundingBox();
        const mmPerM = box.width / PX_PER_MM / m;
        const want = 1000 / den;
        return {
          status: Math.abs(mmPerM - want) < 0.3 ? 'ok' : 'fail',
          observed: `Statt Lineal auf dem Bildschirm in CSS-Millimetern gemessen (A4 hoch): Maßstab 1:${den}, Balken ${m} m, 1 m = ${mmPerM.toFixed(1)} mm (soll ${want.toFixed(1)} mm${den === 75 ? '' : `; der Plan hat hier 1:${den} statt 1:75`}). Ob der Drucker in 100 % druckt, prüft das nicht.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 7,
      action: 'Esc oder „Schließen“ drücken.',
      expected: 'Zurück zur App.',
      async run(t) {
        await t.page.keyboard.press('Escape');
        const escClosed = await view(t).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
        await right(t).getByRole('button', { name: 'Druckansicht / PDF' }).click();
        await view(t).getByRole('button', { name: 'Schließen' }).click();
        const btnClosed = await view(t).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
        const app = await t.page.locator('[data-testid="editor2d"]').isVisible();
        return {
          status: escClosed && btnClosed && app ? 'ok' : 'fail',
          observed: `Esc schließt die Druckansicht: ${escClosed ? 'ja' : 'nein'}. „Schließen“ schließt sie: ${btnClosed ? 'ja' : 'nein'}. App mit Plan sichtbar: ${app ? 'ja' : 'nein'}.`,
        };
      },
    },
  ],
};
