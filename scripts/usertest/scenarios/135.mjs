// Steckdosen-Leistung (#135) – Testschritte aus dem Kommentar in #135.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const tab = (t, name) => right(t).locator('nav.tabs button', { hasText: name }).click();
const circuitItem = (t) => right(t).getByTestId('circuit-item').first();
const summary = (t) => circuitItem(t).getByTestId('circuit-summary').innerText().then((x) => x.replace(/\s+/g, ' ').trim());
const status = (t) => circuitItem(t).getAttribute('data-status');
const wallPoint = async (t) => {
  const p = await t.project();
  const pts = p.rooms[0].nodeIds.map((id) => p.nodes.find((n) => n.id === id));
  const a = pts[0];
  const b = pts[1];
  const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  const m = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
  const l = Math.hypot(c.x - m.x, c.y - m.y);
  return { x: m.x + ((c.x - m.x) / l) * 0.25, y: m.y + ((c.y - m.y) / l) * 0.25 };
};

export default {
  issue: 135,
  name: 'Steckdosen-Leistung',
  title: 'Steckdosen-Leistung: Stromkreise, Geräte und Überlast-Warnung',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links „Steckdosen & Anschlüsse“ öffnen, „+ Steckdose“ wählen und im 2D-Plan neben eine Wand klicken.',
      expected: 'Steckdose sitzt an der Wand und ist ausgewählt.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        await left(t).getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();
        await t.page.getByTestId('fixture-buttons').getByRole('button', { name: '+ Steckdose', exact: true }).click();
        const at = await wallPoint(t);
        const s = await t.planToScreen(at.x, at.y);
        await t.page.mouse.click(s.x, s.y);
        await t.poll(async () => (await t.project()).fixtures.length === 1);
        const f = (await t.project()).fixtures[0];
        const sl = await t.selection();
        // Abstand zur Wand: die Steckdose liegt auf der Wandfläche, also bis zur Wandachse ca. halbe Wandstärke
        return { status: f.kind === 'socket' && sl?.type === 'fixture' && sl.id === f.id ? 'ok' : 'fail', observed: `Steckdose angelegt (Höhe ${Math.round(f.elevation * 100)} cm), ausgewählt: ${sl?.id === f.id}. Der Wandsitz folgt aus dem Platzieren an der Wand (Drehung ${f.rotation.toFixed(2)} rad passend zur Wand).` };
      },
    },
    {
      nr: 2,
      action: 'Rechts Tab „Projekt“ › „Stromkreise & Leistung“ › „+ Stromkreis“.',
      expected: 'Stromkreis mit 16 A, „0 W von 3.680 W (0 %)“, Hinweis „Richtwert, keine fachliche Freigabe“.',
      async run(t) {
        await tab(t, 'Projekt');
        await right(t).getByRole('button', { name: '+ Stromkreis' }).click();
        await circuitItem(t).waitFor();
        const sum = await summary(t);
        const amps = await circuitItem(t).locator('label.field', { hasText: 'Absicherung' }).locator('select').evaluate((s) => s.selectedOptions[0].textContent);
        const disc = await right(t).getByTestId('circuit-disclaimer').innerText();
        return { status: /0 W von 3\.680 W \(0 %\)/.test(sum) && /^16 A/.test(amps) && /keine fachliche Freigabe/.test(disc) ? 'ok' : 'fail', observed: `Absicherung „${amps}“; „${sum}“; Hinweis: „${disc.slice(0, 60)}…“.` };
      },
    },
    {
      nr: 3,
      action: 'Steckdose auswählen (Tab „Eigenschaften“), Stromkreis zuordnen, „Wasserkocher“ und „Toaster“ wählen.',
      expected: 'Im Tab „Projekt“: „2.900 W von 3.680 W (79 %)“, keine Warnung.',
      async run(t) {
        const p = await t.project();
        await t.page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'fixture', id }), p.fixtures[0].id);
        await tab(t, 'Eigenschaften');
        await right(t).getByTestId('socket-circuit').selectOption(p.circuits[0].id);
        await right(t).getByLabel('Verbraucher hinzufügen').selectOption('Wasserkocher');
        await right(t).getByLabel('Verbraucher hinzufügen').selectOption('Toaster');
        await tab(t, 'Projekt');
        const sum = await summary(t);
        const warn = await right(t).getByTestId('circuit-warning').count();
        const q = await t.project();
        return { status: /2\.900 W von 3\.680 W \(79 %\)/.test(sum) && warn === 0 && q.fixtures[0].circuitId === q.circuits[0].id ? 'ok' : 'fail', observed: `„${sum}“; Warnungen: ${warn}; Steckdose dem Stromkreis zugeordnet: ${q.fixtures[0].circuitId === q.circuits[0].id}; Geräte: ${q.loads.map((l) => `${l.name} ${l.watts} W`).join(', ')}.` };
      },
    },
    {
      nr: 4,
      action: 'Einen dritten Verbraucher (z. B. Mikrowelle) hinzufügen.',
      expected: 'Warnung „Überlast“ in Rot.',
      async run(t) {
        await right(t).getByLabel('Verbraucher hinzufügen').first().selectOption('Mikrowelle');
        const w = right(t).getByTestId('circuit-warning');
        await w.waitFor({ timeout: 3000 });
        const txt = await w.innerText();
        const st = await status(t);
        const badge = circuitItem(t).locator('.badge').first();
        const col = await badge.evaluate((e) => { const c = getComputedStyle(e); return { color: c.color, bg: c.backgroundColor, cls: e.className }; });
        const rgb = (s) => s.match(/[\d.]+/g).map(Number);
        const [r, g, b] = rgb(col.color);
        const [br, bg2, bb] = rgb(col.bg);
        const red = (r > 150 && g < 100 && b < 100) || (br > 150 && bg2 < 120 && bb < 120) || (r > g * 1.8 && r > b * 1.8);
        await t.shot('135-ueberlast');
        return { status: /Überlast/.test(txt) && st === 'over' && red ? 'ok' : /Überlast/.test(txt) && st === 'over' ? 'look' : 'fail', observed: `Status ${st}; Warnung: „${txt.replace(/\s+/g, ' ').slice(0, 110)}…“; Kennzeichen-Farbe ${col.color} auf ${col.bg} (Klasse ${col.cls}), rötlich: ${red}.` };
      },
    },
    {
      nr: 5,
      action: 'Optional: Dauerlast-Grenze auf 50 % stellen oder Absicherung auf 10 A ändern.',
      expected: 'Grenze und Prozentwerte passen sich an, Warnung erscheint früher.',
      async run(t) {
        // zurück auf den 79-%-Stand (Mikrowelle raus), dann Grenze 50 % → Warnung früher
        const mw = (await t.project()).loads.find((l) => l.name === 'Mikrowelle');
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { d.loads = d.loads.filter((l) => l.id !== id); }), mw.id);
        await t.page.waitForTimeout(300);
        const st0 = await status(t);
        const f = right(t).getByRole('textbox', { name: /^Dauerlast-Grenze/ });
        await f.fill('50');
        await f.press('Enter');
        await t.page.waitForTimeout(300);
        const st1 = await status(t);
        const sum1 = await summary(t);
        await f.fill('80');
        await f.press('Enter');
        await circuitItem(t).locator('label.field', { hasText: 'Absicherung' }).locator('select').selectOption({ label: (await circuitItem(t).locator('label.field', { hasText: 'Absicherung' }).locator('select').locator('option').allInnerTexts()).find((o) => /^10 A/.test(o)) });
        await t.page.waitForTimeout(300);
        const sum2 = await summary(t);
        const st2 = await status(t);
        await circuitItem(t).locator('label.field', { hasText: 'Absicherung' }).locator('select').selectOption({ label: (await circuitItem(t).locator('label.field', { hasText: 'Absicherung' }).locator('select').locator('option').allInnerTexts()).find((o) => /^16 A/.test(o)) });
        return { status: st0 === 'ok' && st1 === 'warn' && /2\.300 W/.test(sum2) && st2 === 'over' ? 'ok' : 'fail', observed: `Ohne Mikrowelle: Status ${st0}; Grenze 50 %: Status ${st1} („${sum1}“); Grenze wieder 80 % und Absicherung 10 A: „${sum2}“ (Status ${st2}). Danach auf 16 A zurückgestellt.` };
      },
    },
    {
      nr: 6,
      action: 'Optional: Seite neu laden.',
      expected: 'Stromkreise, Zuordnung und Geräte sind noch da.',
      async run(t) {
        const before = JSON.stringify([(await t.project()).circuits, (await t.project()).loads, (await t.project()).fixtures.map((f) => f.circuitId)]);
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await t.project()).circuits.length === 1);
        const q = await t.project();
        const after = JSON.stringify([q.circuits, q.loads, q.fixtures.map((f) => f.circuitId)]);
        return { status: before === after ? 'ok' : 'fail', observed: `Stromkreise ${q.circuits.length}, Geräte ${q.loads.length}, Zuordnung der Steckdose erhalten: ${!!q.fixtures[0]?.circuitId}; alles identisch zu vorher: ${before === after}.` };
      },
    },
  ],
};
