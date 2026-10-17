// Einrichtungsvorschlag (#137) – Testschritte aus dem Kommentar in #137.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const rooms = (t) => left(t).getByTestId('furnish-room');
const preview2d = (t) => t.page.getByTestId('furnish-preview');
const preview3d = (t) => t.page.evaluate(() => window.__wp.three?.scene?.getObjectByName('furnish-preview')?.children.length ?? 0);
const count = async (t) => (await t.project()).furniture.length;
/** Wish list of one room section: [{name, qty}]. */
const wishes = (room) =>
  room.locator('.wish-list li').evaluateAll((lis) => lis.map((li) => ({ name: li.querySelector('span').textContent.trim(), qty: Number(li.querySelector('input').value) })));
const wishText = (ws) => ws.map((w) => `${w.qty} × ${w.name}`).join(', ');
const placementOf = async (t, id) => {
  await t.page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), id);
  await t.page.waitForTimeout(80);
  return (await right(t).getByTestId('furniture-issues').count()) ? (await right(t).getByTestId('furniture-issues').innerText()).replace(/\s+/g, ' ').trim() : '';
};

export default {
  issue: 137,
  name: 'Einrichtungsvorschlag',
  title: 'Automatischer Einrichtungsvorschlag pro Raum',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links den Reiter Einrichten öffnen.',
      expected: 'Die Tab-Leiste zeigt „Werkzeuge, Katalog, Küche, Einrichten, Import“ vollständig lesbar. Im Panel steht ein Hinweis, dass es ein Vorschlag und keine fertige Planung ist.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        await left(t).getByRole('button', { name: 'Einrichten' }).click();
        await page.waitForTimeout(800);
        const tabs = await left(t)
          .locator('nav.tabs button')
          .evaluateAll((bs) => bs.map((b) => ({ label: b.textContent.trim(), cut: b.scrollWidth > b.clientWidth + 1 })));
        const cut = tabs.filter((x) => x.cut).map((x) => x.label);
        const hint = await left(t).getByText(/Es ist ein Vorschlag, keine fertige Planung/).count();
        await t.shot('Reiter Einrichten');
        return {
          status: cut.length === 0 && hint === 1 ? 'ok' : 'fail',
          observed: `Reiter links (Fenster 1440 px breit): ${tabs.map((x) => x.label).join(', ')}. ${cut.length ? `Abgeschnitten (mit „…“): ${cut.join(', ')}.` : 'Alle vollständig lesbar.'} Hinweis „Es ist ein Vorschlag, keine fertige Planung.“: ${hint ? 'ja' : 'nein'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 2,
      action: 'Bei Umfang deinen Raum wählen.',
      expected: 'Der Raumtyp ist aus dem Raumnamen erraten (z. B. „Schlafzimmer“). Darunter steht eine Wunschliste mit Anzahl je Möbel (z. B. Doppelbett, 2 Nachttische, 2 Tischlampen, Kleiderschrank, Kommode). Möbel, die schon im Raum stehen, haben die Anzahl 0.',
      async run(t) {
        await left(t).getByLabel('Umfang').selectOption({ label: 'Schlafzimmer' });
        await t.page.waitForTimeout(300);
        const room = rooms(t);
        const n = await room.count();
        const type = await room.getByLabel('Raumtyp').evaluate((s) => s.options[s.selectedIndex].text);
        const ws = await wishes(room);
        const p = await t.project();
        const bed = p.furniture.filter((f) => f.catalogId === 'generic-bed-160').length;
        const bedWish = ws.find((w) => /Doppelbett|Bett 160/.test(w.name));
        t.defaults = ws;
        return {
          status: n === 1 && type === 'Schlafzimmer' && ws.length >= 4 && bed > 0 && bedWish?.qty === 0 ? 'ok' : 'fail',
          observed: `Umfang „Schlafzimmer“: ${n} Raumabschnitt, Raumtyp „${type}“. Wunschliste: ${wishText(ws)}. Im Raum steht schon ${bed} Doppelbett – in der Liste ${bedWish ? `mit Anzahl ${bedWish.qty}` : 'nicht aufgeführt'}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Eine Anzahl ändern, über Möbel hinzufügen ein weiteres Möbel ergänzen und eins mit × entfernen.',
      expected: 'Die Liste ändert sich entsprechend. Standardliste stellt die typische Liste wieder her.',
      async run(t) {
        const room = rooms(t);
        const first = t.defaults.find((w) => w.qty > 0);
        await room.getByLabel(`Anzahl ${first.name}`).fill(String(first.qty + 1));
        await room.getByLabel('Möbel hinzufügen').selectOption({ label: 'Zimmerpflanze groß' });
        const gone = t.defaults.find((w) => w !== first && w.qty > 0);
        await room.getByRole('button', { name: `${gone.name} entfernen` }).click();
        await t.page.waitForTimeout(200);
        const ws = await wishes(room);
        const changed = ws.find((w) => w.name === first.name)?.qty === first.qty + 1 && ws.some((w) => w.name === 'Zimmerpflanze groß' && w.qty === 1) && !ws.some((w) => w.name === gone.name);
        await t.shot('Wunschliste geändert');
        await room.getByRole('button', { name: 'Standardliste' }).click();
        await t.page.waitForTimeout(200);
        const back = await wishes(room);
        const restored = JSON.stringify(back) === JSON.stringify(t.defaults);
        return {
          status: changed && restored ? 'ok' : 'fail',
          observed: `${first.name} auf ${first.qty + 1} gesetzt, „Zimmerpflanze groß“ hinzugefügt, ${gone.name} mit × entfernt: Liste ${changed ? 'entsprechend geändert' : 'nicht wie erwartet'} (${wishText(ws)}). Nach „Standardliste“: ${restored ? 'wieder die typische Liste' : `nicht die typische Liste (${wishText(back)})`}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Vorschlag erstellen klicken.',
      expected: 'Im 2D-Plan erscheinen die vorgeschlagenen Möbel als blau gestrichelte Umrisse mit Namen, in 3D als Modelle mit blauem Umriss. Im Panel steht „Vorschlag – noch nicht übernommen“, die Liste der platzierten Möbel je Raum und ein Richtwert-Budget. Möbel ohne freien Platz stehen unter „Kein freier Platz für …“. Die Möbel stehen nicht in Wänden, nicht ineinander, nicht in Türen oder im Türaufschlag und nicht vor Fenstern.',
      async run(t) {
        const { page } = t;
        t.before = await count(t);
        t.snapshot = JSON.stringify(await t.project());
        await left(t).getByRole('button', { name: 'Vorschlag erstellen' }).click();
        const result = left(t).getByTestId('furnish-result');
        await result.waitFor({ timeout: 5000 });
        const items = await preview2d(t).locator('[data-furnish-item]').evaluateAll((gs) => gs.map((g) => ({ name: g.dataset.furnishItem, dashed: getComputedStyle(g.querySelector('polygon')).strokeDasharray, label: !!g.querySelector('text') })));
        const badge = await left(t).getByText('noch nicht übernommen').count();
        const text = (await result.innerText()).replace(/\s+/g, ' ').trim();
        const budget = /Richtwert ca\. .*€/.test(text);
        const missing = /Kein freier Platz für/.test(text);
        const unchanged = (await count(t)) === t.before;
        await t.shot('Vorschlag im 2D-Plan');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        const n3d = await preview3d(t);
        await t.shot('Vorschlag in 3D');
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(500);
        t.shown = items.length;
        const dashed = items.every((i) => i.dashed && i.dashed !== 'none');
        return {
          status: items.length > 0 && dashed && badge === 1 && budget && n3d === items.length && unchanged ? 'look' : 'fail',
          observed: `Vorschlag: ${items.length} gestrichelte Umrisse im 2D-Plan (${items.map((i) => i.name).join(', ')}; Name sichtbar bei ${items.filter((i) => i.label).length}), in 3D ${n3d} Vorschau-Modelle. Panel: „noch nicht übernommen“ ${badge ? 'da' : 'fehlt'}; „${text}“. ${missing ? '' : 'Kein Eintrag „Kein freier Platz für …“ (alles fand Platz). '}Plan selbst ${unchanged ? 'unverändert' : 'verändert'}. Ob die Möbel frei von Wänden, Türen und Fenstern stehen, prüft Schritt 6 an den übernommenen Möbeln; Aussehen bitte auf den Bildern ansehen.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Verwerfen klicken.',
      expected: 'Die Vorschau verschwindet, der Plan ist unverändert.',
      async run(t) {
        await left(t).getByRole('button', { name: 'Verwerfen' }).click();
        await t.page.waitForTimeout(300);
        const gone = (await preview2d(t).count()) === 0 && (await left(t).getByTestId('furnish-result').count()) === 0;
        const same = JSON.stringify(await t.project()) === t.snapshot;
        return { status: gone && same ? 'ok' : 'fail', observed: `Nach „Verwerfen“: Vorschau ${gone ? 'weg' : 'noch da'}, Plan ${same ? 'unverändert' : 'verändert'}.` };
      },
    },
    {
      nr: 6,
      action: 'Erneut Vorschlag erstellen, dann Übernehmen.',
      expected: 'Die Möbel sind jetzt normale Möbel (ausgewählt), ohne rote oder orange Markierung. Sie lassen sich wie üblich verschieben, drehen und löschen.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: 'Vorschlag erstellen' }).click();
        await preview2d(t).waitFor({ timeout: 5000 });
        const shown = await preview2d(t).locator('[data-furnish-item]').count();
        await left(t).getByRole('button', { name: 'Übernehmen' }).click();
        const p = await t.poll(async () => {
          const q = await t.project();
          return q.furniture.length === t.before + shown ? q : null;
        }, 4000);
        const added = p ? p.furniture.slice(t.before) : [];
        const sel = await page.evaluate(() => { const s = window.__wp.useUiStore.getState(); return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : []; });
        const allSelected = added.length > 0 && added.every((f) => sel.includes(f.id));
        const preGone = (await preview2d(t).count()) === 0;
        const issues = [];
        for (const f of added) {
          const i = await placementOf(t, f.id);
          if (i) issues.push(`${f.name}: ${i}`);
        }
        // usual editing on one taken item: arrow key moves, E rotates, Delete removes (then undo all three)
        const f = added[0];
        const get = async () => (await t.project()).furniture.find((x) => x.id === f.id);
        await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), f.id);
        const a = await get();
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(150);
        const b = await get();
        await page.keyboard.press('KeyE');
        await page.waitForTimeout(150);
        const c = await get();
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);
        const d = await get();
        for (let k = 0; k < 3; k++) await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        const restored = (await count(t)) === t.before + shown;
        const moved = b && Math.hypot(b.x - a.x, b.y - a.y) > 0.001;
        const turned = c && Math.abs(c.rotation - b.rotation) > 0.01;
        await t.shot('Übernommene Möbel');
        return {
          status: added.length === shown && allSelected && preGone && issues.length === 0 && moved && turned && !d && restored ? 'ok' : 'fail',
          observed: `Nach „Übernehmen“: ${added.length} neue Möbel im Plan (${added.map((x) => x.name).join(', ')}), ${allSelected ? 'alle ausgewählt' : `nicht alle ausgewählt (${sel.length})`}, Vorschau ${preGone ? 'weg' : 'noch da'}. Hinweise rechts (rote/orange Markierung): ${issues.length ? issues.join(' | ') : 'bei keinem'}. „${f?.name}“: Pfeiltaste verschiebt ${moved ? 'ja' : 'nein'}, E dreht ${turned ? 'ja' : 'nein'}, Entf löscht ${!d ? 'ja' : 'nein'}; 3 × Strg+Z stellt es wieder her: ${restored ? 'ja' : 'nein'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 7,
      action: 'Rechts den Reiter Budget öffnen.',
      expected: 'Die übernommenen Möbel stehen in der Stückliste und im Budget.',
      async run(t) {
        const { page } = t;
        const added = (await t.project()).furniture.slice(t.before);
        await right(t).getByRole('button', { name: 'Budget' }).click();
        await page.waitForTimeout(800);
        const text = await right(t).innerText();
        const listed = [...new Set(added.map((f) => f.name))].map((n) => ({ n, ok: text.includes(n) }));
        const missing = listed.filter((x) => !x.ok).map((x) => x.n);
        await t.shot('Budget mit übernommenen Möbeln');
        return {
          status: added.length && missing.length === 0 ? 'ok' : 'fail',
          observed: `Reiter Budget: ${missing.length ? `fehlt: ${missing.join(', ')}` : `alle übernommenen Möbel aufgeführt (${listed.map((x) => x.n).join(', ')})`}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 8,
      action: 'Strg+Z drücken.',
      expected: 'Alle übernommenen Möbel verschwinden in einem Schritt.',
      async run(t) {
        const { page } = t;
        await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
        const n0 = await count(t);
        await page.keyboard.press('Control+z');
        const n = await t.poll(async () => ((await count(t)) === t.before ? t.before : null), 3000);
        return { status: n === t.before ? 'ok' : 'fail', observed: `Ein Strg+Z: Möbel ${n0} → ${await count(t)} (vor dem Vorschlag ${t.before}).` };
      },
    },
    {
      nr: 9,
      action: 'Bei Umfang „Ganze Wohnung (alle Räume)“ wählen und Raumtypen je Raum einstellen, dann Vorschlag erstellen.',
      expected: 'Für jeden Raum gibt es einen eigenen Abschnitt; der Vorschlag gilt für alle Räume.',
      async run(t) {
        const { page } = t;
        await left(t).getByLabel('Umfang').selectOption({ label: 'Ganze Wohnung (alle Räume)' });
        await page.waitForTimeout(300);
        const p = await t.project();
        const sections = await rooms(t).evaluateAll((rs) => rs.map((r) => r.dataset.room));
        const types = [];
        for (const name of sections) {
          const sel = rooms(t).filter({ has: page.getByRole('heading', { name, exact: true }) }).getByLabel('Raumtyp');
          types.push(`${name}: ${await sel.evaluate((s) => s.options[s.selectedIndex].text)}`);
        }
        await left(t).getByRole('button', { name: 'Vorschlag erstellen' }).click();
        const result = left(t).getByTestId('furnish-result');
        await result.waitFor({ timeout: 5000 });
        const resRooms = await result.locator('.furnish-result-room strong').allInnerTexts();
        const text = (await result.innerText()).replace(/\s+/g, ' ').trim();
        await t.shot('Vorschlag für die ganze Wohnung');
        const all = p.rooms.every((r) => sections.includes(r.name) && resRooms.includes(r.name));
        await left(t).getByRole('button', { name: 'Verwerfen' }).click();
        return {
          status: sections.length === p.rooms.length && all ? 'ok' : 'fail',
          observed: `„Ganze Wohnung“: ${sections.length} Abschnitte (${types.join(', ')}) bei ${p.rooms.length} Räumen. Vorschlag: „${text}“.`,
          noFinalShot: true,
        };
      },
    },
  ],
};
