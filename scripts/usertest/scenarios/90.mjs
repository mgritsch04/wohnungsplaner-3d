// Heizkosten-Schätzung (#90) – Testschritte aus dem Kommentar in #90.
const right = (t) => t.page.locator('.panel.right');
const est = async (t) => {
  const txt = await t.page.getByTestId('heating-estimate').innerText();
  const m = txt.match(/Etwa ([\d.]+) €/);
  return { eur: m ? Number(m[1].replace(/\./g, '')) : NaN, txt };
};
const assumptions = (t) => right(t).getByText(/Annahmen:/).innerText();
const pick = (t, label, option) => right(t).getByLabel(label).selectOption({ label: option });
const winShare = (a) => Number(a.match(/= ([\d.,]+) % der Fläche/)?.[1].replace(',', '.'));

export default {
  issue: 90,
  name: 'Heizkosten-Schätzung',
  title: 'Grobe Heizkosten-Schätzung aus Fläche, Dämmstandard und Fensteranteil',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter „Projekt“: Abschnitt „Heizkosten (grobe Schätzung)“ suchen.',
      expected: 'Dämmstandard (Standard) und Heizung (Gas) vorbelegt; „Etwa … € pro Jahr (Richtwert, kein Angebot)“ und darunter die Annahmen.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const sec = right(t).getByText('Heizkosten (grobe Schätzung)');
        await sec.scrollIntoViewIfNeeded();
        const dae = await right(t).getByLabel('Dämmstandard').evaluate((s) => s.selectedOptions[0].textContent);
        const heiz = await right(t).getByLabel('Heizung').evaluate((s) => s.selectedOptions[0].textContent);
        const e = await est(t);
        t.e1 = e.eur;
        const a = await assumptions(t);
        const ok = /^Standard/.test(dae) && /Gas/.test(heiz) && /Richtwert, kein Angebot/.test(e.txt) && /m² beheizte Fläche/.test(a) && /kWh/.test(a) && /ct\/kWh/.test(a);
        return { status: ok ? 'ok' : 'fail', observed: `Dämmstandard „${dae}“, Heizung „${heiz}“; „${e.txt.replace(/\s+/g, ' ')}“; Annahmen: „${a.replace(/\s+/g, ' ').slice(0, 220)}“.` };
      },
    },
    {
      nr: 2,
      action: 'Dämmstandard auf „Altbau unsaniert“ stellen.',
      expected: 'Der Betrag steigt (ca. das Doppelte gegenüber „Standard“).',
      async run(t) {
        await pick(t, 'Dämmstandard', (await right(t).getByLabel('Dämmstandard').locator('option').allInnerTexts()).find((o) => /Altbau unsaniert/.test(o)));
        const e = await est(t);
        t.e2 = e.eur;
        const ratio = e.eur / t.e1;
        return { status: ratio > 1.6 && ratio < 2.6 ? 'ok' : 'fail', observed: `Betrag ${t.e1} € → ${e.eur} € pro Jahr (Faktor ${ratio.toFixed(2)}).` };
      },
    },
    {
      nr: 3,
      action: 'Dämmstandard auf „Passivhaus“ stellen.',
      expected: 'Der Betrag sinkt deutlich.',
      async run(t) {
        await pick(t, 'Dämmstandard', (await right(t).getByLabel('Dämmstandard').locator('option').allInnerTexts()).find((o) => /Passivhaus/.test(o)));
        const e = await est(t);
        t.e3 = e.eur;
        return { status: e.eur < t.e1 * 0.6 ? 'ok' : 'fail', observed: `Betrag ${t.e1} € (Standard) → ${e.eur} € (Passivhaus), also ${Math.round((1 - e.eur / t.e1) * 100)} % weniger.` };
      },
    },
    {
      nr: 4,
      action: 'Heizung auf „Elektro-Direktheizung“ stellen.',
      expected: 'Der Betrag steigt, die Annahmen nennen 30 ct/kWh.',
      async run(t) {
        await pick(t, 'Heizung', (await right(t).getByLabel('Heizung').locator('option').allInnerTexts()).find((o) => /Elektro/.test(o)));
        const e = await est(t);
        const a = await assumptions(t);
        return { status: e.eur > t.e3 && /30 ct\/kWh/.test(a) ? 'ok' : 'fail', observed: `Betrag ${t.e3} € → ${e.eur} € (Passivhaus, Gas → Elektro); Annahmen nennen „${a.match(/[\d,]+ ct\/kWh/)?.[0]}“.` };
      },
    },
    {
      nr: 5,
      action: 'Ein Fenster in eine Außenwand setzen.',
      expected: '„Fenster … m²“ und der Fensteranteil werden größer, der Betrag ändert sich leicht.',
      async run(t) {
        const a0 = await assumptions(t);
        const e0 = (await est(t)).eur;
        // Fenster per Store in eine Außenwand (ein Mausklick-Platzieren wäre eine eigene Prüfung)
        await t.page.evaluate(() =>
          window.__wp.useProjectStore.getState().apply((d) => {
            const used = new Set(d.openings.map((o) => o.wallId));
            const w = d.walls.find((q) => !used.has(q.id)) ?? d.walls[0];
            d.openings.push({ id: 'usertest-fenster', wallId: w.id, kind: 'window', offset: 0.8, width: 1.8, height: 1.4, sillHeight: 0.9, hinge: 'start', swing: 'left', open: false });
          }),
        );
        await t.page.waitForTimeout(400);
        const a1 = await assumptions(t);
        const e1 = (await est(t)).eur;
        const n = (s) => Number(s.match(/Fenster ([\d.,]+) m²/)?.[1].replace(',', '.'));
        return { status: n(a1) > n(a0) && winShare(a1) >= winShare(a0) ? 'ok' : 'fail', observed: `Fensterfläche ${n(a0)} → ${n(a1)} m², Anteil ${winShare(a0)} % → ${winShare(a1)} %; Betrag ${e0} € → ${e1} €. Das Fenster wurde per Store eingefügt (an einer Wand ohne Öffnung), nicht mit dem Platzier-Werkzeug; ob die Wand eine Außenwand ist, zeigt die Fensterfläche in den Annahmen. Der optionale Balkon-Raum wurde nicht geprüft.` };
      },
    },
    {
      nr: 6,
      action: 'Projekt speichern und neu laden.',
      expected: 'Dämmstandard und Heizung bleiben erhalten.',
      async run(t) {
        const s0 = (await t.project()).settings;
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await t.project()).settings.insulation === s0.insulation);
        const s1 = (await t.project()).settings;
        return { status: s1.insulation === s0.insulation && s1.heatingSource === s0.heatingSource && s0.insulation !== 'standard' ? 'ok' : 'fail', observed: `Vorher: ${s0.insulation} / ${s0.heatingSource}; nachher: ${s1.insulation} / ${s1.heatingSource}.` };
      },
    },
    {
      nr: 7,
      action: 'Hinweistext lesen.',
      expected: 'Deutlich als grobe Orientierung gekennzeichnet („keine Energieberatung und keine Normrechnung“).',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const txt = await right(t).getByText(/Grobe Orientierung mit typischen Werten/).innerText();
        return { status: /keine Energieberatung und keine Normrechnung/.test(txt) ? 'ok' : 'fail', observed: `Hinweis: „${txt.replace(/\s+/g, ' ')}“.` };
      },
    },
  ],
};
