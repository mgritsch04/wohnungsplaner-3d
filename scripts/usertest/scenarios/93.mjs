// Sonnenhinweis für Balkon und Terrasse (#93) – Testschritte aus dem Kommentar in #93.
const right = (t) => t.page.locator('.panel.right');
const line = async (t) => (await right(t).getByTestId('daylight-list').locator('li').filter({ hasText: 'Balkon' }).first().innerText()).replace(/\s+/g, ' ');

export default {
  issue: 93,
  name: 'Sonnenhinweis Balkon',
  title: 'Sonnenhinweis für Balkon und Terrasse (Himmelsrichtung, Sonnenzeiten)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Rechtes Panel „Projekt“ öffnen, Abschnitt „Tageslicht & Himmelsrichtung“ (Raum „Balkon“ an der Außenseite).',
      expected: 'Eine Zeile für den Balkon: „zeigt nach <Himmelsrichtung> · Sonne ca. X–Y Uhr (Vormittag/Mittag/…)“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        // die Beispielwohnung hat keinen Balkon: das Schlafzimmer (Außenseite) wird zum „Balkon“ umbenannt
        await t.page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => { d.rooms.find((r) => r.name === 'Schlafzimmer').name = 'Balkon'; }));
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).getByText('Tageslicht & Himmelsrichtung').scrollIntoViewIfNeeded();
        const l = await line(t);
        t.l1 = l;
        return { status: /zeigt nach \S+ · Sonne ca\. \d+–\d+ Uhr/.test(l) ? 'ok' : 'fail', observed: `Zeile: „${l}“. Die Beispielwohnung hat keinen Balkon; getestet wurde mit dem in „Balkon“ umbenannten Schlafzimmer (Außenseite), nicht mit einem echten Balkonraum.` };
      },
    },
    {
      nr: 2,
      action: '„Oben im Plan ist“ ändern (z. B. 90°, 180°).',
      expected: 'Richtung und Sonnenzeiten ändern sich; Nordseite zeigt „kaum direkte Sonne“.',
      async run(t) {
        const seen = [];
        for (const deg of [0, 90, 180, 270]) {
          const f = right(t).getByRole('textbox', { name: /^Oben im Plan ist/ });
          await f.fill(String(deg));
          await f.press('Enter');
          await t.page.waitForTimeout(250);
          seen.push([deg, await line(t)]);
        }
        const dirs = new Set(seen.map(([, l]) => l.match(/zeigt nach (\S+)/)?.[1]));
        const kaum = seen.some(([, l]) => /zeigt nach Norden/.test(l) && /kaum direkte Sonne/.test(l));
        return { status: dirs.size > 1 && kaum ? 'ok' : 'fail', observed: seen.map(([d, l]) => `${d}°: ${l}`).join(' || ') + `. „kaum direkte Sonne“ bei Nord: ${kaum}.` };
      },
    },
    {
      nr: 3,
      action: 'Hinweis am Ende des Abschnitts lesen.',
      expected: 'Er kennzeichnet die Anzeige als grobe Schätzung ohne Verschattung.',
      async run(t) {
        const txt = await right(t).getByText(/Grobe Schätzung nach Himmelsrichtung/).innerText();
        return { status: /Grobe Schätzung/.test(txt) && /keine Verschattung/i.test(txt) ? 'ok' : 'fail', observed: `Hinweis: „${txt.replace(/\s+/g, ' ')}“.` };
      },
    },
  ],
};
