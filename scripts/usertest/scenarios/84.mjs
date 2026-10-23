// Aufgabenlisten je Raum (#84) – Testschritte aus dem Kommentar in #84.
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const progress = (t) => t.page.getByTestId('task-progress').textContent();
const rows = (t) => t.page.getByTestId('task-row').allTextContents();

export default {
  issue: 84,
  name: 'Aufgaben je Raum',
  title: 'Aufgabenlisten je Raum (Streichen, Vorhang messen …)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im 2D-Plan einen Raum anklicken.',
      expected: 'Unter „Eigenschaften“ gibt es den Abschnitt „Aufgaben“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        t.rooms = p.rooms;
        const room = p.rooms[0];
        const pts = room.nodeIds.map((id) => p.nodes.find((n) => n.id === id));
        const s = await t.planToScreen(pts.reduce((a, q) => a + q.x, 0) / pts.length, pts.reduce((a, q) => a + q.y, 0) / pts.length);
        await t.page.mouse.click(s.x, s.y);
        let sl = await t.selection();
        let how = 'per Mausklick';
        if (sl?.type !== 'room') {
          await sel(t, { type: 'room', id: room.id });
          how = 'per Auswahl gesetzt (Klick traf ein Möbel)';
        }
        const has = await t.page.getByLabel('Neuer Punkt').isVisible();
        return { status: has ? 'ok' : 'fail', observed: `Raum „${room.name}“ ausgewählt (${how}); Aufgaben-Eingabe „Neuer Punkt“ sichtbar: ${has}.` };
      },
    },
    {
      nr: 2,
      action: '„Streichen“ und „Vorhang messen“ eintragen (Enter oder „Hinzufügen“).',
      expected: 'Beide Punkte stehen in der Liste, oben „0 von 2 erledigt“.',
      async run(t) {
        const f = t.page.getByLabel('Neuer Punkt');
        await f.fill('Streichen');
        await f.press('Enter');
        await f.fill('Vorhang messen');
        await t.page.getByRole('button', { name: 'Hinzufügen' }).click();
        const r = await rows(t);
        const pr = await progress(t);
        return { status: r.length === 2 && pr === '0 von 2 erledigt' ? 'ok' : 'fail', observed: `Liste: ${r.map((x) => x.trim()).join(' | ')}; Anzeige „${pr}“ (erster Punkt per Enter, zweiter per „Hinzufügen“).` };
      },
    },
    {
      nr: 3,
      action: '„Streichen“ abhaken.',
      expected: 'Punkt ist durchgestrichen, Anzeige „1 von 2 erledigt“.',
      async run(t) {
        await t.page.getByLabel('Streichen erledigt').check();
        const pr = await progress(t);
        const deco = await t.page.getByTestId('task-row').first().evaluate((row) => {
          const walk = [row, ...row.querySelectorAll('*')];
          return walk.some((e) => getComputedStyle(e).textDecorationLine.includes('line-through'));
        });
        return { status: pr === '1 von 2 erledigt' && deco ? 'ok' : 'fail', observed: `Anzeige „${pr}“; Durchstreichung (text-decoration: line-through) am Punkt: ${deco}.` };
      },
    },
    {
      nr: 4,
      action: '„Erledigte ausblenden“ anhaken, danach wieder abwählen.',
      expected: 'Nur „Vorhang messen“ bleibt sichtbar; Abwählen zeigt „Streichen“ wieder.',
      async run(t) {
        await t.page.getByLabel('Erledigte ausblenden').check();
        const hidden = await rows(t);
        await t.page.getByLabel('Erledigte ausblenden').uncheck();
        const shown = await rows(t);
        return { status: hidden.length === 1 && /Vorhang messen/.test(hidden[0]) && shown.length === 2 ? 'ok' : 'fail', observed: `Ausgeblendet: ${hidden.map((x) => x.trim()).join(' | ')}; danach wieder ${shown.length} Punkte.` };
      },
    },
    {
      nr: 5,
      action: 'Anderen Raum anklicken.',
      expected: 'Eigene, getrennte Liste.',
      async run(t) {
        const other = t.rooms[1];
        await sel(t, { type: 'room', id: other.id });
        await t.page.waitForTimeout(300);
        const r = await rows(t);
        await sel(t, { type: 'room', id: t.rooms[0].id });
        const back = await rows(t);
        return { status: r.length === 0 && back.length === 2 ? 'ok' : 'fail', observed: `Raum „${other.name}“: ${r.length} Punkte (leer); zurück bei „${t.rooms[0].name}“: ${back.length} Punkte. Raum per Auswahl gesetzt, nicht per Mausklick.` };
      },
    },
    {
      nr: 6,
      action: 'Seite neu laden.',
      expected: 'Listen und Häkchen sind noch da.',
      async run(t) {
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await t.project()).tasks?.length === 2);
        const tasks = (await t.project()).tasks;
        await sel(t, { type: 'room', id: t.rooms[0].id });
        await t.page.waitForTimeout(500);
        const pr = await progress(t);
        const done = tasks.filter((x) => x.done).map((x) => x.text);
        return { status: done.length === 1 && done[0] === 'Streichen' && pr === '1 von 2 erledigt' ? 'ok' : 'fail', observed: `Aufgaben im Projekt: ${tasks.map((x) => `${x.text}${x.done ? ' ✓' : ''}`).join(', ')}; Anzeige nach Neuladen „${pr}“.` };
      },
    },
  ],
};
