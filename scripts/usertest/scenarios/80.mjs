// Wandaufbau mit Schallschutz-Einschätzung (#80) – Testschritte aus dem Kommentar in #80.
const right = (t) => t.page.locator('.panel.right');
const buildSel = (t) => right(t).locator('select').first();
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
async function wallBetween(t) {
  const p = await t.project();
  const nodes = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
  return p.walls.find((w) => Math.abs(nodes[w.a].x - 5) < 0.2 && Math.abs(nodes[w.b].x - 5) < 0.2);
}
const panel = (t) => right(t).innerText();

export default {
  issue: 80,
  name: 'Wandaufbau und Schallschutz',
  title: 'Wandaufbau wählen (Ziegel, Trockenbau, Beton) mit grober Schallschutz-Einschätzung',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Eine Wand anklicken (z. B. im Beispielprojekt).',
      expected: 'In den Eigenschaften gibt es die Gruppe „Aufbau und Schallschutz“ mit Auswahl Ziegel, Beton, Porenbeton, Trockenbau.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(600);
        const w = await wallBetween(t);
        t.wall = w;
        // a real click on the wall in the plan
        const p = await t.project();
        const nodes = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
        const s = await t.planToScreen(nodes[w.a].x, Math.min(nodes[w.a].y, nodes[w.b].y) + 0.4);
        await t.page.mouse.click(s.x, s.y);
        const sl = await t.selection();
        if (sl?.id !== w.id) await sel(t, { type: 'wall', id: w.id });
        const opts = await buildSel(t).locator('option').allInnerTexts();
        const head = (await panel(t)).includes('Aufbau und Schallschutz');
        return { status: head && ['Ziegel', 'Beton', 'Porenbeton', 'Trockenbau'].every((o) => opts.includes(o)) ? 'ok' : 'fail', observed: `Gruppe „Aufbau und Schallschutz“: ${head ? 'ja' : 'nein'}; Auswahl: ${opts.join(' / ')} (Wand per Mausklick im Plan ausgewählt: ${sl?.id === w.id ? 'ja' : 'nein, per Auswahl gesetzt'}).` };
      },
    },
    {
      nr: 2,
      action: 'Aufbau auf „Trockenbau“ stellen.',
      expected: '„Schallschutz (Schätzung)“ zeigt ca. 38 dB, schwach; Hinweis „Grobe Schätzung zur Orientierung, keine bauphysikalische Berechnung“.',
      async run(t) {
        await buildSel(t).selectOption({ label: 'Trockenbau' });
        const txt = await panel(t);
        const m = txt.match(/ca\. (\d+) dB, (\w+)/);
        return { status: m && m[1] === '38' && m[2] === 'schwach' && /Grobe Schätzung zur Orientierung, keine bauphysikalische Berechnung/.test(txt) ? 'ok' : 'fail', observed: `Anzeige: „${m?.[0] ?? '–'}“; Hinweis „Grobe Schätzung … keine bauphysikalische Berechnung“: ${/keine bauphysikalische Berechnung/.test(txt)}.` };
      },
    },
    {
      nr: 3,
      action: 'Zwei Räume nebeneinander zeichnen, einen „Küche“, den anderen „Schlafzimmer“ nennen, die gemeinsame Wand anklicken.',
      expected: 'Warnung „Laut neben ruhig: Küche grenzt an Schlafzimmer“.',
      async run(t) {
        // the sample apartment already has two rooms side by side: rename the living room to "Küche"
        const p = await t.project();
        const living = p.rooms.find((r) => r.name === 'Wohnzimmer');
        await sel(t, { type: 'room', id: living.id });
        const name = right(t).locator('label.field').filter({ has: t.page.locator('.field-label', { hasText: /^Name$/ }) }).locator('input');
        await name.fill('Küche');
        await name.press('Tab');
        await sel(t, { type: 'wall', id: t.wall.id });
        const txt = await panel(t);
        const m = txt.match(/Laut neben ruhig: [^\n]*/);
        return { status: m && /Küche grenzt an Schlafzimmer/.test(m[0]) ? 'ok' : 'fail', observed: `Statt zwei neue Räume zu zeichnen, habe ich im Beispielprojekt das Wohnzimmer in „Küche“ umbenannt (Schlafzimmer steht daneben). Meldung an der gemeinsamen Wand: „${m?.[0] ?? '–'}“.` };
      },
    },
    {
      nr: 4,
      action: 'Raum „Schlafzimmer“ anklicken.',
      expected: 'Schall-Warnung (Schätzung) mit dB-Wert.',
      async run(t) {
        const p = await t.project();
        const bed = p.rooms.find((r) => r.name === 'Schlafzimmer');
        await sel(t, { type: 'room', id: bed.id });
        const txt = await panel(t);
        const m = txt.match(/[^\n]*(\d+) dB[^\n]*/g);
        return { status: m && /Küche/.test(txt) && /Schätzung/.test(txt) ? 'ok' : 'fail', observed: `Im Raum „Schlafzimmer“: ${m ? m.map((x) => `„${x}“`).join(', ') : 'keine Schall-Anzeige'}; Küche genannt: ${/Küche/.test(txt)}, als Schätzung gekennzeichnet: ${/Schätzung/.test(txt)}.` };
      },
    },
    {
      nr: 5,
      action: 'Gemeinsame Wand auf „Beton“ stellen.',
      expected: 'Warnungen verschwinden (ca. 55 dB, gut).',
      async run(t) {
        await sel(t, { type: 'wall', id: t.wall.id });
        await buildSel(t).selectOption({ label: 'Beton' });
        const txt = await panel(t);
        const wallMsg = txt.match(/ca\. (\d+) dB, (\w+)/);
        const warn = /Laut neben ruhig/.test(txt);
        const p = await t.project();
        await sel(t, { type: 'room', id: p.rooms.find((r) => r.name === 'Schlafzimmer').id });
        const roomTxt = await panel(t);
        return { status: wallMsg && wallMsg[1] === '55' && wallMsg[2] === 'gut' && !warn && !/Laut neben ruhig/.test(roomTxt) ? 'ok' : 'fail', observed: `Wand: „${wallMsg?.[0]}“, Warnung an der Wand: ${warn ? 'noch da' : 'weg'}; im Schlafzimmer: ${/Laut neben ruhig/.test(roomTxt) ? 'Warnung noch da' : 'keine Warnung'}.` };
      },
    },
    {
      nr: 6,
      action: 'Projekt speichern und neu laden.',
      expected: 'Wandaufbau bleibt erhalten.',
      async run(t) {
        await t.page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.page.locator('input.project-name').waitFor();
        const w = (await t.project()).walls.find((x) => x.id === t.wall.id);
        await sel(t, { type: 'wall', id: t.wall.id });
        const val = await buildSel(t).evaluate((s) => s.selectedOptions[0]?.textContent);
        return { status: val === 'Beton' ? 'ok' : 'fail', observed: `Nach Neuladen: Wandaufbau „${val}“ (gespeichert: ${JSON.stringify(w.construction ?? w.build ?? w.material ?? null)}).` };
      },
    },
  ],
};
