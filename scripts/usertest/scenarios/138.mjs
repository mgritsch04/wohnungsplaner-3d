// Audio-Setup planen (#138) – Testschritte aus dem Kommentar in #138.
const panel = (t) => t.page.locator('.panel.left').getByTestId('smarthome-panel');
const items = async (t) => t.page.getByTestId('audio-item').evaluateAll((els) => els.map((e) => ({ type: e.dataset.type, text: e.textContent })));
const pick = (t, room) => panel(t).getByLabel('Raum').selectOption({ label: room });
const speakers = async (t) => (await t.project()).devices.filter((d) => d.kind === 'speaker');

export default {
  issue: 138,
  name: 'Audio-Setup planen',
  title: 'Audio-Setup planen: Lautsprecher je Raum, mit Änderungswünschen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Tab „Smart Home“, Raum „Wohnzimmer“, im Abschnitt „Audio-Setup vorschlagen“ auf den Vorschau-Knopf klicken.',
      expected: 'Im 2D-Plan gestrichelte Lautsprecher-Symbole (zwei Regallautsprecher, ein Subwoofer); je Gerät Art und Begründung; „Preis: offen“, keine Modellnamen oder Preise.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
        await t.page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
        await pick(t, 'Wohnzimmer');
        await panel(t).getByTestId('audio-suggest').click();
        await panel(t).getByTestId('audio-result').waitFor();
        const it = await items(t);
        const prev = await t.page.locator('[data-testid="device-preview"][data-kind="speaker"]').count();
        const cost = await panel(t).getByTestId('audio-cost').textContent();
        const types = it.map((i) => i.type).sort().join(',');
        const noPrice = !/\d\s?€|€\s?\d/.test(it.map((i) => i.text).join(' '));
        await t.shot('wohnzimmer-vorschau');
        return { status: types === 'bookshelf,bookshelf,subwoofer' && prev === 3 && /Preis: offen/.test(cost) && noPrice ? 'ok' : 'fail', observed: `Liste: ${it.map((i) => i.text.trim()).join(' || ')}. Vorschau-Symbole im Plan: ${prev}. „${cost?.slice(0, 60)}“. Preis in Zeilen: ${!noPrice}. Dass die Symbole gestrichelt aussehen, wurde nicht am Bild beurteilt.` };
      },
    },
    {
      nr: 2,
      action: 'Bei „Wunsch“ „kompakter, Design nicht gut“ eingeben und „Neuer Vorschlag mit Wunsch“ klicken.',
      expected: 'Neuer Vorschlag mit nur einer Soundbar (kein Subwoofer); noch nichts ins Projekt übernommen.',
      async run(t) {
        await panel(t).getByLabel('Wunsch (optional)').fill('kompakter, Design nicht gut');
        await panel(t).getByRole('button', { name: 'Neuer Vorschlag mit Wunsch' }).click();
        await t.page.waitForTimeout(500);
        const it = await items(t);
        const n = (await speakers(t)).length;
        return { status: it.length === 1 && it[0].type === 'soundbar' && n === 0 ? 'ok' : 'fail', observed: `Vorschlag: ${it.map((i) => `${i.type}: ${i.text.trim()}`).join(' || ')}. Lautsprecher im Projekt: ${n}.` };
      },
    },
    {
      nr: 3,
      action: '„Verwerfen“ klicken.',
      expected: 'Vorschau weg, keine Geräte in der Geräteliste.',
      async run(t) {
        await panel(t).getByTestId('audio-discard').click();
        await t.page.waitForTimeout(400);
        const prev = await t.page.locator('[data-testid="device-preview"]').count();
        const res = await panel(t).getByTestId('audio-result').count();
        const n = (await t.project()).devices.length;
        return { status: prev === 0 && res === 0 && n === 0 ? 'ok' : 'fail', observed: `Vorschau-Symbole ${prev}, Ergebnisbereich ${res}, Geräte im Projekt ${n}.` };
      },
    },
    {
      nr: 4,
      action: 'Wunsch leeren, Vorschau zeigen, „Übernehmen“. Danach Strg+Z.',
      expected: 'Geräte erscheinen in „Geräte im Plan“; ein Strg+Z entfernt alle wieder.',
      async run(t) {
        await panel(t).getByLabel('Wunsch (optional)').fill('');
        await panel(t).getByTestId('audio-suggest').click();
        await panel(t).getByTestId('audio-result').waitFor();
        await panel(t).getByTestId('audio-apply').click();
        await t.page.waitForTimeout(500);
        const n = (await speakers(t)).length;
        const head = await panel(t).getByText(/Geräte im Plan \(\d+\)/).first().textContent().catch(() => null);
        await t.page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(500);
        const after = (await speakers(t)).length;
        return { status: n === 3 && head && after === 0 ? 'ok' : 'fail', observed: `Nach Übernehmen: ${n} Lautsprecher, Überschrift „${head}“. Nach einem Strg+Z: ${after}.` };
      },
    },
    {
      nr: 5,
      action: 'Optional: Raum „Schlafzimmer“ wählen und Schritt 1 wiederholen.',
      expected: 'Schlafzimmer: ein Bluetooth-Lautsprecher neben dem Bett (Arbeitszimmer gibt es im Beispielprojekt nicht).',
      async run(t) {
        await pick(t, 'Schlafzimmer');
        await panel(t).getByTestId('audio-suggest').click();
        await panel(t).getByTestId('audio-result').waitFor();
        const it = await items(t);
        return { status: it.length === 1 && it[0].type === 'bluetooth' ? 'ok' : 'fail', observed: `Schlafzimmer: ${it.map((i) => `${i.type}: ${i.text.trim()}`).join(' || ')}. Arbeitszimmer im Beispielprojekt nicht vorhanden, daher nicht geprüft.` };
      },
    },
    {
      nr: 6,
      action: 'Einen übernommenen Lautsprecher anklicken, nahe an eine Wand ziehen.',
      expected: 'Unter „Eigenschaften“ Hinweise (✓/⚠) zu Wandabstand, Hörplatz und Stereo-Dreieck; Art umstellbar.',
      async run(t) {
        await pick(t, 'Wohnzimmer');
        await panel(t).getByTestId('audio-suggest').click();
        await panel(t).getByTestId('audio-apply').click();
        await t.page.waitForTimeout(500);
        const sp = (await speakers(t))[0];
        if (!sp) return { status: 'fail', observed: 'Kein Lautsprecher nach Übernehmen.' };
        await t.page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id }), sp.id);
        await t.page.waitForTimeout(400);
        const hints = await t.page.getByTestId('speaker-hints').locator('li').allTextContents();
        const art = await t.page.locator('.panel.right').getByLabel('Art').count();
        // nahe an die Wand setzen (Nordwand y≈0)
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { const x = d.devices.find((v) => v.id === id); x.y = 0.03; }), sp.id);
        await t.page.waitForTimeout(400);
        const hints2 = await t.page.getByTestId('speaker-hints').locator('li').allTextContents();
        const warn = hints2.some((h) => h.startsWith('⚠'));
        return { status: hints.length >= 2 && art > 0 && hints.every((h) => /^[✓⚠]/.test(h)) && warn ? 'ok' : 'fail', observed: `Hinweise vorher: ${hints.join(' | ')}. Nach Versetzen nahe an die Wand (über den Projektzustand, nicht per Mausziehen): ${hints2.join(' | ')}. Auswahl „Art“ vorhanden: ${art > 0}.` };
      },
    },
  ],
};
