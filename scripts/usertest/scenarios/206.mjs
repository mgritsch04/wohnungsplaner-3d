// Budget: Gruppierung bleibt nach Panelwechsel erhalten (#206) – Testschritte aus dem Kommentar in #206.
const right = (t) => t.page.locator('.panel.right');
const grouping = (t) => t.page.getByRole('combobox', { name: 'Gruppierung' });
const groupHeads = (t) => t.page.locator('.budget-group-head').allInnerTexts();

export default {
  issue: 206,
  name: 'Budget-Gruppierung bleibt',
  title: 'Budget: Gruppierung springt nach Panelwechsel auf „nach Kategorie“ zurück',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Rechts den Reiter „Budget“ öffnen und bei „Gruppierung“ „nach Raum“ wählen.',
      expected: 'Die Liste ist nach Räumen gruppiert (z. B. Schlafzimmer, Wohnzimmer).',
      async run(t) {
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        await grouping(t).selectOption('room');
        const heads = await groupHeads(t);
        await t.shot('Budget nach Raum');
        const ok = heads.some((h) => /Schlafzimmer/.test(h)) && heads.some((h) => /Wohnzimmer/.test(h));
        return { status: ok ? 'ok' : 'fail', observed: `Gruppen: ${heads.map((h) => h.replace(/\s+/g, ' ').slice(0, 30)).join(' | ')}` };
      },
    },
    {
      nr: 2,
      action: 'Im 2D-Plan ein Möbel anklicken und ein Stück ziehen.',
      expected: 'Rechts erscheinen die Eigenschaften des Möbels.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        const f = (await t.project()).furniture[0];
        const a = await t.planToScreen(f.x, f.y);
        await t.page.mouse.move(a.x, a.y);
        await t.page.mouse.down();
        await t.page.mouse.move(a.x + 40, a.y + 20, { steps: 6 });
        await t.page.mouse.up();
        const sel = await t.selection();
        const gone = await grouping(t).count();
        return { status: sel?.id && gone === 0 ? 'ok' : 'fail', observed: `Auswahl: ${JSON.stringify(sel)}; Gruppierungs-Auswahl im Panel sichtbar: ${gone} (0 = Eigenschaften-Panel aktiv).` };
      },
    },
    {
      nr: 3,
      action: 'Rechts wieder „Budget“ öffnen.',
      expected: 'Die Gruppierung steht weiterhin auf „nach Raum“.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Budget' }).click();
        const v = await grouping(t).inputValue();
        return { status: v === 'room' ? 'ok' : 'fail', observed: `Gruppierung: ${v}` };
      },
    },
    {
      nr: 4,
      action: 'Links und rechts zwischen anderen Reitern wechseln und danach wieder „Budget“ öffnen.',
      expected: 'Weiterhin „nach Raum“.',
      async run(t) {
        const p = t.page;
        await p.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
        await p.locator('.panel.left').getByRole('button', { name: 'Projekt', exact: true }).click().catch(() => undefined);
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        const v = await grouping(t).inputValue();
        return { status: v === 'room' ? 'ok' : 'fail', observed: `Gruppierung: ${v}` };
      },
    },
    {
      nr: 5,
      action: 'Die Seite neu laden und „Budget“ öffnen.',
      expected: 'Weiterhin „nach Raum“.',
      async run(t) {
        await t.page.reload();
        await t.page.locator('input.project-name').waitFor();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        const v = await grouping(t).inputValue();
        return { status: v === 'room' ? 'ok' : 'fail', observed: `Gruppierung nach Neuladen: ${v}` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: „nach Händler“ wählen und Schritt 2–3 wiederholen.',
      expected: 'Die Gruppierung bleibt „nach Händler“.',
      async run(t) {
        await grouping(t).selectOption('retailer');
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        const f = (await t.project()).furniture[1];
        const a = await t.planToScreen(f.x, f.y);
        await t.page.mouse.move(a.x, a.y);
        await t.page.mouse.down();
        await t.page.mouse.move(a.x + 30, a.y + 10, { steps: 5 });
        await t.page.mouse.up();
        await right(t).getByRole('button', { name: 'Budget' }).click();
        const v = await grouping(t).inputValue();
        return { status: v === 'retailer' ? 'ok' : 'fail', observed: `Gruppierung: ${v}` };
      },
    },
  ],
};
