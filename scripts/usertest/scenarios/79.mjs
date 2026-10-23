// Hilfetexte im Planer (#79) – Testschritte aus dem Kommentar in #79.
const right = (t) => t.page.locator('.panel.right');
const hint = (t, term) => right(t).getByRole('button', { name: `Erklärung: ${term}` });
const notes = (t) => right(t).locator('.info-hint-text').allInnerTexts();

export default {
  issue: 79,
  name: 'Hilfetexte (ⓘ)',
  title: 'Hilfetexte im Planer für Begriffe wie Realismus und Tageszeit',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Rechts das Panel „Projekt" öffnen und zum Abschnitt „Licht & Darstellung (3D)" blättern.',
      expected: 'Neben „Tageszeit" und „Belichtung" steht ein kleines ⓘ.',
      async run(t) {
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const tz = await hint(t, 'Tageszeit').count();
        const bel = await hint(t, 'Belichtung').count();
        await hint(t, 'Tageszeit').scrollIntoViewIfNeeded();
        return { status: tz === 1 && bel === 1 ? 'ok' : 'fail', observed: `ⓘ neben „Tageszeit“: ${tz}, neben „Belichtung“: ${bel}.` };
      },
    },
    {
      nr: 2,
      action: 'Auf das ⓘ neben „Tageszeit" klicken.',
      expected: 'Eine kurze Erklärung in einfachem Deutsch erscheint darunter.',
      async run(t) {
        await hint(t, 'Tageszeit').click();
        const n = await notes(t);
        await t.shot('Erklärung zur Tageszeit');
        return { status: n.length === 1 && /Sonnenstand/.test(n[0]) && n[0].length < 250 ? 'ok' : 'fail', observed: `Erklärung: „${n[0] ?? '–'}“ (${n[0]?.length ?? 0} Zeichen).` };
      },
    },
    {
      nr: 3,
      action: 'Noch einmal auf dasselbe ⓘ klicken.',
      expected: 'Die Erklärung verschwindet wieder.',
      async run(t) {
        await hint(t, 'Tageszeit').click();
        const n = await notes(t);
        return { status: n.length === 0 ? 'ok' : 'fail', observed: `Sichtbare Erklärungen danach: ${n.length}.` };
      },
    },
    {
      nr: 4,
      action: 'Im Abschnitt „Leistung" auf das ⓘ neben „Modus" klicken.',
      expected: 'Eine Erklärung zu „Realismus" erscheint.',
      async run(t) {
        await hint(t, 'Realismus').scrollIntoViewIfNeeded();
        await hint(t, 'Realismus').click();
        const n = await notes(t);
        return { status: n.length === 1 && /Texturen/.test(n[0]) && /Planung/.test(n[0]) ? 'ok' : 'fail', observed: `Erklärung: „${n[0] ?? '–'}“.` };
      },
    },
    {
      nr: 5,
      action: 'Optional: Im Realismusmodus neben dem Feld „Lampen" auf ⓘ klicken.',
      expected: 'Erklärung, dass Lampen ab der Dämmerung automatisch angehen.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Erklärung: Realismus' }).click(); // close the previous note
        await t.page.getByRole('button', { name: 'Realismus', exact: true }).click();
        await t.page.waitForTimeout(500);
        await hint(t, 'Lampen: automatisch').scrollIntoViewIfNeeded();
        await hint(t, 'Lampen: automatisch').click();
        const n = await notes(t);
        return { status: n.length === 1 && /Dämmerung/.test(n[0]) ? 'ok' : 'fail', observed: `Erklärung: „${n[0] ?? '–'}“.` };
      },
    },
    {
      nr: 6,
      action: 'Im Abschnitt „Oberfläche" das Häkchen „Info-Symbole (ⓘ) anzeigen" entfernen.',
      expected: 'Alle ⓘ verschwinden. Nach Neuladen bleiben sie weg.',
      async run(t) {
        const box = right(t).getByLabel('Info-Symbole (ⓘ) anzeigen');
        await box.scrollIntoViewIfNeeded();
        await box.uncheck();
        const after = await right(t).locator('.info-hint-btn').count();
        await t.page.reload();
        await t.page.locator('input.project-name').waitFor();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const reloaded = await right(t).locator('.info-hint-btn').count();
        const checked = await right(t).getByLabel('Info-Symbole (ⓘ) anzeigen').isChecked();
        return { status: after === 0 && reloaded === 0 && !checked ? 'ok' : 'fail', observed: `ⓘ danach: ${after}; nach Neuladen: ${reloaded}; Häkchen gesetzt: ${checked}.` };
      },
    },
    {
      nr: 7,
      action: 'Häkchen wieder setzen.',
      expected: 'Die ⓘ sind wieder da.',
      async run(t) {
        await right(t).getByLabel('Info-Symbole (ⓘ) anzeigen').check();
        const n = await right(t).locator('.info-hint-btn').count();
        return { status: n >= 4 ? 'ok' : 'fail', observed: `Sichtbare ⓘ: ${n}.` };
      },
    },
    {
      nr: 8,
      action: 'Hilfe öffnen (Taste ? oder Hilfe-Symbol oben) und nach unten blättern.',
      expected: 'Ein Abschnitt „Begriffe" erklärt Realismus, Tageszeit, Lampen, Belichtung und Grafikqualität.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: /^Hilfe & Tastenkürzel/ }).click();
        const dlg = page.getByRole('dialog');
        await dlg.waitFor();
        const sec = dlg.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Begriffe', exact: true }) }).last();
        await dlg.getByRole('heading', { name: 'Begriffe', exact: true }).scrollIntoViewIfNeeded();
        const text = await dlg.innerText();
        const part = text.slice(text.indexOf('Begriffe'), text.indexOf('Koordinaten'));
        const missing = ['Realismus', 'Tageszeit', 'Lampen', 'Belichtung', 'Grafikqualität'].filter((w) => !part.includes(w));
        await t.shot('Hilfe › Begriffe');
        void sec;
        return { status: missing.length === 0 ? 'ok' : 'fail', observed: `Abschnitt „Begriffe“ vorhanden; fehlende Begriffe: ${missing.join(', ') || 'keine'}.` };
      },
    },
  ],
};
