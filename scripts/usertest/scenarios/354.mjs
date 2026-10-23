// Smart Home: WLAN getrennt für 2,4 und 5 GHz mit Empfehlung je Raum (#354) – Testschritte aus dem Issue-Text.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const recs = (t) => panel(t).getByTestId('wifi-rec').evaluateAll((els) => els.map((e) => ({ room: e.getAttribute('data-room'), band: e.getAttribute('data-band'), d24: Number(e.getAttribute('data-dbm24')), d5: Number(e.getAttribute('data-dbm5')), text: e.innerText })));

export default {
  issue: 354,
  name: 'WLAN 2,4 und 5 GHz getrennt',
  title: 'Smart Home: WLAN-Abdeckung getrennt für 2,4 und 5 GHz, mit Empfehlung je Raum',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, Projekt mit mehreren Räumen (Beispielwohnung).',
      expected: 'Mehrere Räume, getrennt durch Wände.',
      async run(t) {
        await t.freshStart();
        const p = await t.project();
        return { status: p.rooms.length >= 2 ? 'ok' : 'fail', observed: `Räume: ${p.rooms.map((r) => r.name).join(', ')}.` };
      },
    },
    {
      nr: 2,
      action: 'Router im Plan platzieren (Wohnzimmer), WLAN-Abdeckung einschalten.',
      expected: 'Zwei Bänder wählbar: 2,4 GHz und 5 GHz.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="router"]').click();
        await panel(t).getByTestId('device-add').click();
        await panel(t).getByLabel('Abdeckung im Plan anzeigen').check();
        await page.getByTestId('wifi-overlay').waitFor({ timeout: 5000 });
        const opts = await panel(t).getByLabel('Band').locator('option').allInnerTexts();
        return { status: opts.includes('2,4 GHz') && opts.includes('5 GHz') ? 'ok' : 'fail', observed: `Bänder: ${opts.join(', ')}.` };
      },
    },
    {
      nr: 3,
      action: 'Beide Bänder nacheinander anzeigen.',
      expected: '5 GHz ist am Router stark und fällt hinter Wänden schneller ab als 2,4 GHz.',
      async run(t) {
        const { page } = t;
        await panel(t).getByLabel('Band').selectOption('2.4');
        await page.waitForTimeout(300);
        await t.shot('Abdeckung 2,4 GHz');
        const r = await recs(t);
        await panel(t).getByLabel('Band').selectOption('5');
        await page.waitForTimeout(300);
        await t.shot('Abdeckung 5 GHz');
        const near = r.find((x) => x.room === 'Wohnzimmer');
        const others = r.filter((x) => x.room !== 'Wohnzimmer');
        const drop24 = near.d24 - Math.min(...others.map((x) => x.d24));
        const drop5 = near.d5 - Math.min(...others.map((x) => x.d5));
        return { status: drop5 > drop24 ? 'ok' : 'fail', observed: `Abfall vom Wohnzimmer zum schwächsten Raum: 2,4 GHz ${drop24.toFixed(1)} dB, 5 GHz ${drop5.toFixed(1)} dB.` };
      },
    },
    {
      nr: 4,
      action: 'Empfehlung je Raum prüfen; „Empfehlung 2,4 oder 5 GHz im Plan färben“ einschalten.',
      expected: 'Jeder Raum hat „hier besser 2,4 GHz“ oder „hier besser 5 GHz“ mit Begründung (Abstand, Wände). Im Plan sind die Räume nach Band eingefärbt.',
      async run(t) {
        const { page } = t;
        await panel(t).getByLabel('Empfehlung 2,4 oder 5 GHz im Plan färben').check();
        await page.getByTestId('wifi-rec-overlay').waitFor({ timeout: 5000 });
        await t.shot('Empfehlung je Raum');
        const r = await recs(t);
        t.recs = r;
        const rooms = (await t.project()).rooms.length;
        const ok = r.length === rooms && r.every((x) => /hier besser (2,4|5) GHz/.test(x.text) && /Abstand/.test(x.text) && /Wände/.test(x.text));
        return { status: ok ? 'ok' : 'fail', observed: r.map((x) => `${x.room}: ${x.band}`).join(' · ') };
      },
    },
    {
      nr: 5,
      action: 'Alle Wände auf Betondicke (30 cm) ändern und die Türen/Durchgänge zumauern (sonst geht das Signal durch die Öffnung).',
      expected: 'Die Empfehlung für Räume hinter Wänden ändert sich nachvollziehbar (5 GHz wird zu 2,4 GHz, Begründung nennt zu schwaches 5 GHz).',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => {
          const s = window.__wp.useProjectStore;
          const p = structuredClone(s.getState().project);
          p.walls.forEach((w) => (w.thickness = 0.3));
          p.openings = p.openings.filter((o) => o.kind === 'window');
          s.setState({ project: p });
        });
        await page.waitForTimeout(800);
        const after = await recs(t);
        const changed = after.filter((x, i) => x.band !== t.recs[i]?.band);
        await t.shot('Empfehlung bei Betonwänden');
        const reason = after.find((x) => x.band === '2.4')?.text ?? '';
        return { status: changed.length > 0 && /zu schwach/.test(reason) ? 'ok' : 'fail', observed: `Geändert: ${changed.map((x) => x.room).join(', ') || 'keiner'}. Nachher: ${after.map((x) => `${x.room}: ${x.band}`).join(' · ')}.` };
      },
    },
    {
      nr: 6,
      action: 'Ansicht als Schätzung prüfen.',
      expected: 'Hinweis „Messen mit dem Handy ersetzt das nicht“ sichtbar; Richtwerte mit Quelle.',
      async run(t) {
        const hint = await panel(t).getByTestId('wifi-hint').innerText();
        await panel(t).locator('summary', { hasText: 'Wie wird gerechnet' }).click();
        const links = await panel(t).locator('details a').count();
        return { status: /Messen mit dem Handy ersetzt das nicht/.test(hint) && links >= 1 ? 'ok' : 'fail', observed: `Hinweis: „${hint.replace(/\n/g, ' ')}“; Quellenlinks: ${links}.` };
      },
    },
  ],
};
