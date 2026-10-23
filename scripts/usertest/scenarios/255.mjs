// Grundriss-Import: fest eingebaute Sanitärobjekte als Bestand übernehmen (#255) – Testschritte aus dem Kommentar in #255.
// Plan: SYNTHETISCHES PDF (Bad mit Wanne, Waschbecken, WC), kein echter Grundriss.
import { oval, pdfOf, roomWalls, roundedRect, text } from './_pdf.mjs';

const plan = () =>
  pdfOf([
    ...roomWalls(),
    roundedRect(1.0, 0.55, 1.6, 0.7, 0.1), // Badewanne an der Nordwand
    oval(3.3, 0.4, 0.3, 0.21), // Waschbecken an der Nordwand
    oval(4.2, 3.5, 0.2, 0.36), // WC an der Südwand
    text(2.5, 2.0, 'Bad', 14),
  ]);
const left = (t) => t.page.locator('.panel.left');
const draft = (t) => t.page.evaluate(() => window.__wp.useImportStore.getState().draft);

export default {
  issue: 255,
  name: 'Sanitärobjekte als Bestand',
  title: 'Grundriss-Import: fest eingebaute Sanitärobjekte (Badewanne, Waschbecken, WC) als Bestand übernehmen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '„Projekt ▾“ → „Neues leeres Projekt“.',
      expected: 'Leeres Projekt.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await t.page.getByRole('button', { name: 'Neu anlegen' }).click();
        await t.page.waitForTimeout(600);
        const p = await t.project();
        return { status: p.walls.length === 0 ? 'ok' : 'fail', observed: `Wände: ${p.walls.length}, Möbel: ${p.furniture.length}.` };
      },
    },
    {
      nr: 2,
      action: 'Links „Import“ → Grundriss laden, „Erkennung starten“.',
      expected: 'In „Import prüfen“ stehen Badewanne, Waschbecken und WC als vorgeschlagene Objekte („unsicher“), jeweils einzeln abwählbar.',
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
        const d = await draft(t);
        t.fx = d.fixtures ?? [];
        const rows = page.locator('li', { hasText: '(Bestand)' });
        const labels = await rows.allInnerTexts();
        const badges = await rows.locator('.lg').evaluateAll((els) => els.map((e) => e.className));
        // einzeln abwählbar: erste Zeile ab- und wieder anwählen
        const cb = rows.first().getByRole('checkbox');
        await cb.uncheck();
        const off = (await draft(t)).fixtures[0].accepted === false;
        await cb.check();
        const on = (await draft(t)).fixtures[0].accepted === true;
        await t.shot('Import prüfen mit Sanitärobjekten');
        const ids = t.fx.map((f) => f.catalogId).sort().join(',');
        return { status: ids === 'generic-bathtub,generic-toilet,generic-washbasin' && badges.every((b) => /uncertain|estimated/.test(b)) && off && on ? 'ok' : 'fail', observed: `Vorschläge: ${labels.map((l) => l.trim().replace(/\s+/g, ' ')).join(' | ')}; Status-Punkte: ${badges.join(', ')}; Abwählen/Anwählen der ersten Zeile: ${off}/${on}.` };
      },
    },
    {
      nr: 3,
      action: '„In Plan übernehmen“.',
      expected: 'In 2D und 3D stehen die Objekte an der Stelle aus dem Plan, richtig gedreht und etwa in der gezeichneten Größe.',
      async run(t) {
        const { page } = t;
        const d = await draft(t);
        await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
        await page.waitForTimeout(800);
        const modal = page.locator('.modal');
        if (await modal.count()) {
          t.modalText = (await modal.first().innerText()).replace(/\n+/g, ' | ').slice(0, 300);
          await modal.getByRole('button').last().click();
          await page.waitForTimeout(600);
        }
        const p = await t.project();
        const items = p.furniture.filter((f) => /generic-(bathtub|washbasin|toilet)/.test(f.catalogId));
        const node = (id) => p.nodes.find((n) => n.id === id);
        const wallDist = (px, py) =>
          Math.min(...p.walls.map((w) => {
            const a = node(w.a), b = node(w.b);
            const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
            const u = Math.max(0, Math.min(1, ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / l2));
            return Math.hypot(px - (a.x + u * (b.x - a.x)), py - (a.y + u * (b.y - a.y))) - w.thickness / 2;
          }));
        const lines = d.fixtures.map((x) => {
          const f = items.find((q) => q.catalogId === x.catalogId);
          if (!f) return { ok: false, text: `${x.name}: fehlt` };
          // Entwurf liegt im Plan an derselben Stelle wie der Import (Unterlage); Abstand zum Entwurfsmittelpunkt
          const dist = Math.hypot(f.x - x.center.x, f.y - x.center.y);
          const dr = Math.abs(Math.atan2(Math.sin(f.rotation - x.rotation), Math.cos(f.rotation - x.rotation)));
          const back = wallDist(f.x + Math.sin(f.rotation) * (f.depth / 2 + 0.1), f.y - Math.cos(f.rotation) * (f.depth / 2 + 0.1));
          const front = wallDist(f.x - Math.sin(f.rotation) * (f.depth / 2 + 0.1), f.y + Math.cos(f.rotation) * (f.depth / 2 + 0.1));
          return { ok: dist < 0.1 && dr < 0.05 && Math.abs(f.width - x.width) < 0.05 && back < front, text: `${f.name}: ${f.width.toFixed(2)} × ${f.depth.toFixed(2)} m bei (${f.x.toFixed(2)} / ${f.y.toFixed(2)}), Abstand zum Entwurf ${dist.toFixed(2)} m, Drehung ${((f.rotation * 180) / Math.PI).toFixed(0)}° (Rückseite ${back.toFixed(2)} m von der Wand, Vorderseite ${front.toFixed(2)} m)` };
        });
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const n3 = await page.evaluate((ids) => {
          const seen = new Set();
          window.__wp.three.scene.traverse((o) => { if (ids.includes(o.userData?.furnitureId)) seen.add(o.userData.furnitureId); });
          return seen.size;
        }, items.map((f) => f.id));
        await t.shot('3D mit Sanitärobjekten');
        await page.getByRole('button', { name: '2D', exact: true }).click();
        t.items = items;
        return { status: items.length === 3 && lines.every((l) => l.ok) && n3 === 3 ? 'ok' : 'fail', observed: `${lines.map((l) => l.text).join(' | ')}; in der 3D-Szene vorhanden: ${n3} von 3.${t.modalText ? ` Dialog nach dem Übernehmen: „${t.modalText}“.` : ''}` };
      },
    },
    {
      nr: 4,
      action: 'Budget und Einkaufsliste öffnen.',
      expected: 'Die übernommenen Sanitärobjekte erscheinen dort nicht. Im Eigenschaften-Panel (Erweitert) ist „Bestand“ gesetzt.',
      async run(t) {
        const { page } = t;
        const existing = t.items.every((f) => f.existing === true);
        await page.locator('.panel.right').getByRole('button', { name: 'Budget' }).click();
        await page.waitForTimeout(400);
        const budget = await page.locator('.panel.right').innerText();
        const inBudget = ['Badewanne', 'Waschbecken', 'WC', 'Toilette'].some((n) => budget.includes(n));
        await page.evaluate((id) => { window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }); window.__wp.useUiStore.getState().setRightTab('properties'); }, t.items[0].id);
        await page.waitForTimeout(400);
        const box = page.getByLabel(/Bestand \(schon in der Wohnung/);
        if (!(await box.count())) await page.locator('.panel.right').getByText('Erweitert').first().click().catch(() => undefined);
        const checked = await box.isChecked().catch(() => null);
        return { status: existing && !inBudget && checked === true ? 'ok' : 'fail', observed: `Alle drei „Bestand“ im Modell: ${existing}; Namen im Budget-Panel zu finden: ${inBudget}; Häkchen „Bestand“ im Eigenschaften-Panel bei „${t.items[0].name}“: ${checked}. Die Einkaufsliste (CSV) wurde nicht geöffnet; sie nutzt dieselbe Budgetberechnung ohne Bestand.` };
      },
    },
  ],
};
