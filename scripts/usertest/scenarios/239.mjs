// Grundriss-Import: Leichtbauwände, die nur als hellgraue Fläche gezeichnet sind (#239) – Testschritte aus dem Kommentar in #239.
// Plan: SYNTHETISCHES PDF (zwei kleine Räume WC und AR, getrennt durch eine 8 cm dicke hellgraue Fläche). Gs echter Plan bleibt privat.
import { fillRect, pdfOf, roomWalls, text } from './_pdf.mjs';

const plan = () => pdfOf([...roomWalls(), fillRect(1.96, 0.1, 2.04, 3.9, 0.85), text(0.7, 2.0, 'WC', 14), text(3.2, 2.0, 'AR', 14)]);
const left = (t) => t.page.locator('.panel.left');
const draft = (t) => t.page.evaluate(() => window.__wp.useImportStore.getState().draft);

export default {
  issue: 239,
  name: 'Leichtbauwände als graue Fläche',
  title: 'Grundriss-Import: Leichtbauwände erkennen, die nur als hellgraue Fläche gezeichnet sind (z. B. AR/WC)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, „Projekt ▾“ → „Neues leeres Projekt“.',
      expected: 'Leeres Projekt.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await t.page.getByRole('button', { name: 'Neu anlegen' }).click();
        await t.page.waitForTimeout(600);
        const p = await t.project();
        return { status: p.walls.length === 0 && p.rooms.length === 0 ? 'ok' : 'fail', observed: `Wände: ${p.walls.length}, Räume: ${p.rooms.length}.` };
      },
    },
    {
      nr: 2,
      action: 'Links „Import“ → den Grundriss (PDF) laden und „Erkennung starten“.',
      expected: 'Die Erkennung läuft durch und zeigt „Import prüfen“.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: 'Import' }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.dropzone').click();
        await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: plan() });
        await page.getByText('Vektorzeichnung', { exact: false }).waitFor({ timeout: 15000 });
        const btn = page.getByRole('button', { name: 'Aus Angabe übernehmen' });
        if (await btn.count()) await btn.click();
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void ((d.underlay.calibrated = true), (d.underlay.scaleSource = 'reference'))));
        await page.getByRole('button', { name: 'Erkennung starten' }).click();
        await page.getByText('Import prüfen').waitFor({ timeout: 25000 });
        return { status: 'ok', observed: 'Erkennung durchgelaufen, „Import prüfen“ sichtbar (synthetisches PDF 1:100).' };
      },
    },
    {
      nr: 3,
      action: 'In „Import prüfen“: WC und AR erscheinen als zwei eigene Räume, zwischen ihnen steht eine dünne Wand.',
      expected: 'Zwei Räume, eine dünne Trennwand.',
      async run(t) {
        const d = await draft(t);
        const vert = d.walls.filter((w) => Math.abs(w.a.x - w.b.x) < 0.05);
        const xs = vert.map((w) => w.a.x);
        const mid = vert.filter((w) => w.a.x > Math.min(...xs) + 1 && w.a.x < Math.max(...xs) - 1);
        const names = d.rooms.map((r) => r.name).join(', ');
        await t.shot('Import prüfen');
        return { status: d.rooms.length === 2 && mid.length >= 1 && mid.every((w) => w.thickness < 0.15) ? 'ok' : 'fail', observed: `Räume im Entwurf: ${d.rooms.length} (${names}); senkrechte Trennwand zwischen den Außenwänden: ${mid.length}${mid[0] ? `, Dicke ${(mid[0].thickness * 100).toFixed(0)} cm` : ''}; Wände gesamt ${d.walls.length}.` };
      },
    },
    {
      nr: 4,
      action: '„In Plan übernehmen“.',
      expected: 'Beide Räume sind auch im Plan getrennt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
        await page.waitForTimeout(800);
        const p = await t.project();
        const names = p.rooms.map((r) => r.name).join(', ');
        return { status: p.rooms.length === 2 ? 'ok' : 'fail', observed: `Im Plan: ${p.rooms.length} Räume (${names}), ${p.walls.length} Wände.` };
      },
    },
  ],
};
