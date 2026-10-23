// Notizen an Räumen und Möbeln als Pins im Plan (#83) – Testschritte aus dem Kommentar in #83.
const right = (t) => t.page.locator('.panel.right');
const pins = (t) => t.page.getByTestId('note-pin');
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const pinPos = async (t, i) => {
  const b = await pins(t).nth(i).boundingBox();
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

export default {
  issue: 83,
  name: 'Notizen als Pins',
  title: 'Notizen an Räumen und Möbeln als Pins im Plan',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen, im 2D-Plan einen Raum anklicken.',
      expected: 'Rechts unter „Eigenschaften“ gibt es den Abschnitt „Notizen“ mit „+ Notiz“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        const room = p.rooms.find((r) => r.name === 'Schlafzimmer') ?? p.rooms[0];
        t.room = room;
        // freie Stelle im Raum: Mitte des Raums, notfalls per Auswahl
        const pts = room.nodeIds.map((id) => p.nodes.find((n) => n.id === id));
        const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
        const s = await t.planToScreen(c.x, c.y);
        await t.page.mouse.click(s.x, s.y);
        let sl = await t.selection();
        let how = 'per Mausklick';
        if (sl?.type !== 'room') {
          await sel(t, { type: 'room', id: room.id });
          how = 'per Auswahl gesetzt (Klick traf ein Möbel)';
        }
        const has = await right(t).getByRole('button', { name: '+ Notiz' }).isVisible();
        return { status: has ? 'ok' : 'fail', observed: `Raum „${room.name}“ ausgewählt (${how}); Abschnitt „Notizen“ mit „+ Notiz“ sichtbar: ${has}.` };
      },
    },
    {
      nr: 2,
      action: '„+ Notiz“ klicken und „Lampe bestellen“ eintippen.',
      expected: 'In der Raummitte erscheint ein orangefarbener Pin mit Textfeld daneben.',
      async run(t) {
        await right(t).getByRole('button', { name: '+ Notiz' }).click();
        await t.page.getByLabel('Notiz', { exact: true }).fill('Lampe bestellen');
        await pins(t).first().waitFor({ timeout: 3000 });
        const bubble = await t.page.getByTestId('note-bubble').textContent();
        await t.shot('83-pin');
        const fill = await pins(t).first().locator('path').evaluate((e) => getComputedStyle(e).fill);
        const [r, g, b] = fill.match(/[\d.]+/g).map(Number);
        const orange = r > 200 && g > 80 && g < 190 && b < 90;
        const room = t.room;
        const p = await t.project();
        const pts = room.nodeIds.map((id) => p.nodes.find((n) => n.id === id));
        const c = await t.planToScreen(pts.reduce((s, q) => s + q.x, 0) / pts.length, pts.reduce((s, q) => s + q.y, 0) / pts.length);
        const pos = await pinPos(t, 0);
        const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
        const central = dist < 60;
        return { status: !bubble.includes('Lampe bestellen') ? 'fail' : orange && central ? 'ok' : 'look', observed: `Pins im Plan: ${await pins(t).count()}; Textfeld am Pin zeigt „${bubble.replace(/\s+/g, ' ')}“; Pin-Farbe ${fill} (streng orange: ${orange}, ein dunkles Bernstein/Orange); Abstand zum Mittelpunkt der Raumecken ${Math.round(dist)} px (nur Pin vorhanden, Lage und Farbwirkung bitte ansehen). Screenshot 83-pin.` };
      },
    },
    {
      nr: 3,
      action: 'Auf den Pin klicken.',
      expected: 'Der Text klappt zu bzw. wieder auf; der Raum wird dabei nicht neu ausgewählt.',
      async run(t) {
        const before = await t.selection();
        await pins(t).first().click({ force: true });
        const closed = (await t.page.getByTestId('note-bubble').count()) === 0;
        await pins(t).first().click({ force: true });
        const reopened = (await t.page.getByTestId('note-bubble').count()) === 1;
        const after = await t.selection();
        const same = before?.id === after?.id && after?.type === 'room';
        return { status: closed && reopened && same ? 'ok' : 'fail', observed: `Erster Klick schließt: ${closed}; zweiter Klick öffnet: ${reopened}; Auswahl unverändert (Raum): ${same}.` };
      },
    },
    {
      nr: 4,
      action: 'Ein Möbelstück anklicken und dort ebenfalls eine Notiz anlegen.',
      expected: 'Pin sitzt am Möbel und folgt ihm beim Verschieben.',
      async run(t) {
        const p = await t.project();
        const f = p.furniture.find((q) => q.name === 'Sofa 3-Sitzer') ?? p.furniture[0];
        t.fid = f.id;
        const s = await t.planToScreen(f.x, f.y);
        await t.page.mouse.click(s.x, s.y);
        let sl = await t.selection();
        if (sl?.type !== 'furniture') await sel(t, { type: 'furniture', id: f.id });
        await right(t).getByRole('button', { name: '+ Notiz' }).click();
        await t.page.getByLabel('Notiz', { exact: true }).fill('Passende Kissen suchen');
        await t.page.waitForTimeout(300);
        const n = await pins(t).count();
        const idx = n - 1;
        const a = await pinPos(t, idx);
        const sf = await t.planToScreen(f.x, f.y);
        const near = Math.hypot(a.x - sf.x, a.y - sf.y);
        await t.page.evaluate(([id]) => window.__wp.useProjectStore.getState().apply((d) => { d.furniture.find((q) => q.id === id).x += 0.5; }), [f.id]);
        await t.page.waitForTimeout(300);
        const b = await pinPos(t, idx);
        const dx = b.x - a.x;
        const expected = (await t.planToScreen(f.x + 0.5, f.y)).x - sf.x;
        return { status: n === 2 && near < 120 && Math.abs(dx - expected) < 4 ? 'ok' : 'fail', observed: `Pins: ${n}; Abstand Pin–Möbelmitte ${Math.round(near)} px; Pin wanderte beim Verschieben um 50 cm um ${Math.round(dx)} px (Soll ${Math.round(expected)} px). Das Möbel wurde per Store verschoben, nicht mit der Maus gezogen.` };
      },
    },
    {
      nr: 5,
      action: 'Notiz ändern, dann „Löschen“.',
      expected: 'Text ändert sich im Pin; nach dem Löschen verschwindet der Pin.',
      async run(t) {
        const area = t.page.getByLabel('Notiz', { exact: true });
        await area.fill('Kissen in Grün');
        const txt = await t.page.getByTestId('note-bubble').textContent();
        await right(t).getByRole('button', { name: 'Löschen' }).first().click();
        await t.page.waitForTimeout(300);
        const left = await pins(t).count();
        return { status: txt.includes('Kissen in Grün') && left === 1 ? 'ok' : 'fail', observed: `Pin-Text nach Ändern: „${txt.replace(/\s+/g, ' ')}“; Pins nach Löschen: ${left} (vorher 2).` };
      },
    },
    {
      nr: 6,
      action: 'Seite neu laden.',
      expected: 'Verbliebene Notizen sind noch da.',
      async run(t) {
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await t.project()).notes?.length === 1);
        const notes = (await t.project()).notes;
        await t.page.getByRole('button', { name: '2D', exact: true }).click().catch(() => {});
        await t.page.waitForTimeout(500);
        return { status: notes.length === 1 && notes[0].text === 'Lampe bestellen' ? 'ok' : 'fail', observed: `Notizen nach Neuladen: ${notes.length} („${notes[0]?.text}“), Pins im Plan: ${await pins(t).count()}.` };
      },
    },
  ],
};
