// Smart-Home-Vorschlag (#225) – Testschritte aus dem Kommentar in #225.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');

export default {
  issue: 225,
  name: 'Smart-Home-Vorschlag',
  title: 'Smart-Home-Vorschlag: passende Geräte je Raum vorschlagen und als Vorschau setzen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im Tab „Smart Home“, Schritt „Geräte“, oben bei „Smart Home vorschlagen“ „Für“ auf „Ganze Wohnung“ stellen und „Vorschlag zeigen“ klicken.',
      expected: 'Im 2D-Plan erscheinen gestrichelte Vorschau-Geräte (Melder mit Erfassungsbereich, Kontakte an Fenstern/Außentür); im Panel eine Liste mit Begründung, Abdeckung „x % → y % erfasst“ je Raum und eine Kostenschätzung in €.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Für').selectOption('all');
        await panel(t).getByTestId('sh-suggest').click();
        await panel(t).getByTestId('sh-suggest-item').first().waitFor();
        const previews = await page.getByTestId('device-preview').count();
        const items = await panel(t).getByTestId('sh-suggest-item').allInnerTexts();
        const cost = await panel(t).getByTestId('sh-suggest-cost').innerText();
        const txt = await panel(t).innerText();
        const cover = txt.match(/\d+\s*%\s*→\s*\d+\s*%/g) ?? [];
        const dashed = await page.getByTestId('device-preview').first().evaluate((el) => [el, ...el.querySelectorAll('*')].some((e) => /\d/.test(getComputedStyle(e).strokeDasharray) || e.getAttribute('stroke-dasharray')));
        t.n = items.length;
        const kinds = (await page.getByTestId('device-preview').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind') ?? e.getAttribute('data-device') ?? ''))).join(',');
        await t.shot('Vorschlag in der Vorschau');
        const devices = (await t.project()).devices.length;
        return { status: previews > 0 && items.length > 0 && items.every((i) => i.trim().length > 12) && cover.length >= 2 && /€/.test(cost) && dashed && devices === 0 ? 'ok' : 'fail', observed: `${previews} Vorschau-Geräte im Plan (gestrichelt: ${dashed}; ${kinds}); Liste mit ${items.length} Einträgen, z. B. „${items[0].replace(/\n/g, ' ').slice(0, 110)}“; Abdeckung je Raum: ${cover.join(' | ')}; Kosten: „${cost.replace(/\n/g, ' ')}“; Geräte im Projekt: ${devices}.` };
      },
    },
    {
      nr: 2,
      action: '„Verwerfen“ klicken.',
      expected: 'Vorschau verschwindet, Geräteliste bleibt unverändert (leer).',
      async run(t) {
        await panel(t).getByTestId('sh-suggest-discard').click();
        const previews = await t.page.getByTestId('device-preview').count();
        const rows = await panel(t).getByTestId('device-row').count();
        const devices = (await t.project()).devices.length;
        return { status: previews === 0 && rows === 0 && devices === 0 ? 'ok' : 'fail', observed: `Vorschau-Geräte: ${previews}; Zeilen in der Geräteliste: ${rows}; Geräte im Projekt: ${devices}.` };
      },
    },
    {
      nr: 3,
      action: 'Erneut „Vorschlag zeigen“, dann „Übernehmen“.',
      expected: 'Alle Geräte stehen im Plan und in der Geräteliste, Hinweis „… übernommen“.',
      async run(t) {
        await panel(t).getByTestId('sh-suggest').click();
        const n = await panel(t).getByTestId('sh-suggest-item').count();
        await panel(t).getByTestId('sh-suggest-apply').click();
        await t.page.waitForTimeout(500);
        const in2d = await t.page.getByTestId('device-2d').count();
        const rows = await panel(t).getByTestId('device-row').count();
        const devices = (await t.project()).devices.length;
        const toast = await t.page.getByText(/übernommen/).first().innerText().catch(() => '');
        await t.shot('Übernommen');
        return { status: n > 0 && in2d === n && devices === n && rows === n && toast ? 'ok' : 'fail', observed: `Vorschlag: ${n} Geräte; nach „Übernehmen“ im Plan ${in2d}, in der Geräteliste ${rows}, im Projekt ${devices}; Hinweis: „${toast}“.` };
      },
    },
    {
      nr: 4,
      action: 'Strg+Z drücken.',
      expected: 'Alle übernommenen Geräte verschwinden in EINEM Schritt.',
      async run(t) {
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(400);
        const devices = (await t.project()).devices.length;
        return { status: devices === 0 ? 'ok' : 'fail', observed: `Geräte nach einem Strg+Z: ${devices}.` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Optional: Nur einen Raum wählen („Nur …“) und den Vorschlag zeigen.',
      expected: 'Nur Geräte dieses Raums. Nach dem Übernehmen schlägt ein weiterer Vorschlag nichts mehr vor.',
      async run(t) {
        const { page } = t;
        const sel = panel(t).getByLabel('Für');
        const opts = await sel.locator('option').allInnerTexts();
        const only = opts.find((o) => /^Nur .*Schlafzimmer/.test(o)) ?? opts.find((o) => /^Nur /.test(o));
        await sel.selectOption({ label: only });
        await panel(t).getByTestId('sh-suggest').click();
        await panel(t).getByTestId('sh-suggest-item').first().waitFor();
        const n = await panel(t).getByTestId('sh-suggest-item').count();
        await panel(t).getByTestId('sh-suggest-apply').click();
        await page.waitForTimeout(400);
        const devs = (await t.project()).devices;
        const rooms = [...new Set(devs.map((d) => (d.name.match(/Wohnzimmer|Schlafzimmer|Bad|Küche|Flur/) ?? ['?'])[0]))];
        await panel(t).getByTestId('sh-suggest').click();
        await page.waitForTimeout(400);
        const again = await panel(t).getByTestId('sh-suggest-item').count();
        const msg = await panel(t).innerText();
        return { status: n > 0 && rooms.length === 1 && again === 0 ? 'ok' : 'fail', observed: `Auswahl „${only}“: ${n} Geräte, Raum der Geräte: ${rooms.join(', ')}; zweiter Vorschlag danach: ${again} Einträge (${(msg.match(/(Nichts|Keine)[^\n]*/) ?? [''])[0]}).` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Im Bad/Schlafzimmer-Vorschlag steht ein Hinweis auf Sensoren, die es als Gerätetyp noch nicht gibt (Feuchte, CO₂, Leck).',
      expected: 'Hinweis auf fehlende Gerätetypen (Feuchte, CO₂, Leck).',
      async run(t) {
        const txt = await panel(t).innerText();
        const hit = /Feuchte|CO₂|CO2|Leck/.test(txt);
        return { status: hit ? 'ok' : 'skip', observed: hit ? `Hinweis gefunden: „${(txt.match(/[^\n]*(Feuchte|CO₂|Leck)[^\n]*/) ?? [''])[0].slice(0, 160)}“` : 'In der Beispielwohnung (Wohnzimmer/Schlafzimmer, kein Bad) nicht gefunden; optional, nicht geprüft.' };
      },
    },
  ],
};
