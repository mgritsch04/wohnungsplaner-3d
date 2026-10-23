// Grundriss-Import erkennt Anschlüsse (#222) – Testschritte aus dem Kommentar in #222. Plan: SYNTHETISCHES PDF (keine echten Pläne).
import { pdfOf, roomWalls, symbols } from './_pdf.mjs';

const plan = (withSymbols) =>
  pdfOf([
    ...roomWalls(),
    ...(withSymbols
      ? [
          ...symbols.socket(1.0, 0.3), // Steckdose
          ...symbols.sw(2.0, 0.3), // Schalter
          ...symbols.lan(3.0, 0.3), // LAN
          ...symbols.water(4.0, 0.3), // Wasser (kein Nassraum)
          ...symbols.radiator(2.5, 3.65), // Heizkörper
        ]
      : []),
  ]);
const left = (t) => t.page.locator('.panel.left');
const draft = (t) => t.page.evaluate(() => window.__wp.useImportStore.getState().draft);

async function importAndRecognise(t, buffer) {
  const { page } = t;
  await t.freshStart();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600);
  await left(t).getByRole('button', { name: 'Import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer });
  await page.getByText('Vektorzeichnung', { exact: false }).waitFor({ timeout: 15000 });
  const btn = page.getByRole('button', { name: 'Aus Angabe übernehmen' });
  if (await btn.count()) await btn.click();
  // calibration confirmed (as in the E2E tests: 1:100 stated scale, set to „reference“)
  await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void ((d.underlay.calibrated = true), (d.underlay.scaleSource = 'reference'))));
  await page.getByRole('button', { name: 'Erkennung starten' }).click();
  await page.getByText('Import prüfen').waitFor({ timeout: 25000 });
}

export default {
  issue: 222,
  name: 'Anschlüsse beim Grundriss-Import',
  title: 'Grundriss-Import erkennt Anschlüsse (Steckdosen, Wasser, LAN …) und übernimmt sie',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Plan als PDF importieren, Maßstab kalibrieren, „Erkennen“ starten.',
      expected: 'Prüfansicht zeigt „Ausgewählt: … Anschlüsse“ und eine Warnung mit der Zahl der erkannten Installationspunkte.',
      async run(t) {
        const { page } = t;
        await importAndRecognise(t, plan(true));
        const d = await draft(t);
        t.d = d;
        const txt = await page.locator('.panel').first().innerText() + await page.locator('.panel').last().innerText();
        const warn = await page.getByText(/Installationspunkt|Installationssymbol|Anschlüsse? erkannt/).allInnerTexts();
        await t.shot('Import prüfen mit Anschlüssen');
        return { status: /Ausgewählt:.*Anschlüsse/.test(txt) && (d.installations?.length ?? 0) >= 4 && warn.length >= 1 ? 'ok' : 'fail', observed: `Erkannt: ${d.installations?.length ?? 0} Anschlüsse (${(d.installations ?? []).map((x) => x.symbol ?? x.kind).join(', ')}); Zeile: „${(txt.match(/Ausgewählt:[^\n]*/) ?? ['–'])[0]}“; Warnung(en): ${warn.map((w) => w.slice(0, 140)).join(' | ') || 'keine gefunden'}. Prüfplan: ${d.walls.length} Wände erkannt (Plan enthält 4 Wände + einen Heizkörper 100 × 10 cm).` };
      },
    },
    {
      nr: 2,
      action: 'In der Elementliste einen Anschluss anklicken.',
      expected: 'Er ist im 2D-Plan markiert (S/L/H/W/A), Art, Lage und Höhe (Richtwert) sind änderbar.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: /^\s*Steckdose · \d+ cm hoch/ }).first().click();
        const section = page.getByText('Ausgewählter Anschluss');
        const shown = await section.count();
        const sel = await page.evaluate(() => window.__wp.useImportStore.getState().selected);
        const sec = page.locator('section.panel-section', { has: page.getByRole('heading', { name: 'Ausgewählter Anschluss' }) });
        const fields = await sec.locator('label').allInnerTexts();
        const before = (await draft(t)).installations.find((x) => x.id === sel.id);
        // show the selected point in the plan (the draft lies below the sample apartment)
        await page.evaluate(([x, y]) => window.__wp.useUiStore.getState().setView2d({ cx: x, cy: y, zoom: 90 }), [before.center.x, before.center.y]);
        await page.waitForTimeout(500);
        const marks = await page.locator('[data-testid="editor2d"] svg text').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
        const kindSel = sec.getByLabel('Art');
        const kinds = await kindSel.locator('option').allInnerTexts();
        const hoehe = sec.getByLabel('Höhe');
        await hoehe.fill('120');
        await hoehe.press('Enter');
        const mitteX = sec.getByLabel('Mitte X');
        await mitteX.fill(String(Math.round(before.center.x * 100 + 10)));
        await mitteX.press('Enter');
        const after = (await draft(t)).installations.find((x) => x.id === sel.id);
        await t.shot('Anschluss gewählt');
        const letters = marks.filter((m) => /^[SLHWA]$/.test(m.trim()));
        return { status: shown && sel?.type === 'installation' && Math.abs(after.elevation - 1.2) < 0.001 && Math.abs(after.center.x - before.center.x) > 0.05 && letters.length >= 1 ? 'ok' : 'fail', observed: `„Ausgewählter Anschluss“ sichtbar: ${shown}; Felder: ${fields.map((f) => f.trim()).filter(Boolean).join(', ')} (Art-Auswahl: ${kinds.join('/')}); Buchstaben im Plan: ${letters.join('') || '–'}; Höhe ${before.elevation} → ${after.elevation} m, Mitte X ${before.center.x.toFixed(2)} → ${after.center.x.toFixed(2)} m.` };
      },
    },
    {
      nr: 3,
      action: 'Ein unsicheres Symbol suchen (z. B. Wasser außerhalb eines Nassraums).',
      expected: 'Status „unsicher“, nicht vorausgewählt.',
      async run(t) {
        const d = await draft(t);
        const water = d.installations.find((x) => x.kind === 'water');
        await left(t).getByRole('button', { name: /Wasseranschluss/ }).first().click();
        const badge = await t.page.locator('text=unsicher').count();
        const note = water?.note ?? '';
        return { status: water && water.status === 'uncertain' && water.accepted === false && badge >= 1 ? 'ok' : 'fail', observed: `Wasseranschluss: Status „${water?.status}“, vorausgewählt: ${water?.accepted}; Hinweis: „${note}“; „unsicher“ im Panel/Legende sichtbar: ${badge}×.` };
      },
    },
    {
      nr: 4,
      optional: true,
      action: 'Optional: Plan ohne Symbole importieren.',
      expected: 'Import wie bisher, keine Anschlüsse.',
      async run(t) {
        await importAndRecognise(t, plan(false));
        const d = await draft(t);
        return { status: d.walls.length === 4 && (d.installations?.length ?? 0) === 0 ? 'ok' : 'fail', observed: `Plan ohne Symbole: ${d.walls.length} Wände, ${d.installations?.length ?? 0} Anschlüsse.` };
      },
    },
    {
      nr: 5,
      action: '„Übernehmen“.',
      expected: 'Die gewählten Anschlüsse erscheinen im Installationsplan an der richtigen Wand, in den Raum gedreht.',
      async run(t) {
        const { page } = t;
        await importAndRecognise(t, plan(true));
        const d = await draft(t);
        const accepted = d.installations.filter((x) => x.accepted);
        await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
        await page.waitForTimeout(1200);
        const p = await t.project();
        const inst = p.fixtures ?? [];
        const node = (id) => p.nodes.find((n) => n.id === id);
        // nearest wall of each installation and whether its front (−sin r, cos r) points away from that wall, into the room
        const rep = inst.map((f) => {
          let best = null;
          for (const w of p.walls) {
            const a = node(w.a);
            const b = node(w.b);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const k = Math.max(0, Math.min(1, ((f.x - a.x) * dx + (f.y - a.y) * dy) / (dx * dx + dy * dy)));
            const q = { x: a.x + dx * k, y: a.y + dy * k };
            const dist = Math.hypot(f.x - q.x, f.y - q.y);
            if (!best || dist < best.dist) best = { dist, q, t: w.thickness };
          }
          const n = { x: -Math.sin(f.rotation), y: Math.cos(f.rotation) };
          const away = (f.x - best.q.x) * n.x + (f.y - best.q.y) * n.y > 0;
          return { kind: f.kind, gap: best.dist - best.t / 2, away };
        });
        await t.shot('Installationen im Plan');
        // each accepted symbol is a wall installation on a wall of the 5 × 4 room
        return { status: inst.length === accepted.length && inst.length >= 3 && rep.every((r) => r.gap < 0.2 && r.away) && !inst.some((i) => i.kind === 'water') ? 'ok' : 'fail', observed: `Vorausgewählt: ${accepted.length}; im Projekt als Installation: ${inst.length} (${rep.map((r) => `${r.kind}: ${(r.gap * 100).toFixed(0)} cm vor der Wandfläche, Front von der Wand weg: ${r.away}`).join('; ')}). Das unsichere Wasser blieb draußen: ${!inst.some((i) => i.kind === 'water')}.` };
      },
    },
  ],
};
