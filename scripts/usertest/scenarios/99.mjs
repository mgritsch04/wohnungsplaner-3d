// Eigenschaften-Panel mit Gruppen (#99) und Vorher-nachher-Vergleich in 3D (#76) – Testschritte aus dem Kommentar in #99.
const right = (t) => t.page.locator('.panel.right');
const group = (t, name) => right(t).getByRole('button', { name, exact: true });
const exp = async (t, name) => (await group(t, name).getAttribute('aria-expanded')) === 'true';
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const clickAt = async (t, f) => {
  const s = await t.planToScreen(f.x, f.y);
  await t.page.mouse.click(s.x, s.y);
};
const camPos = (t) => t.page.evaluate(() => { const c = window.__wp.three.camera.position; return [c.x, c.y, c.z]; });
const sceneState = (t, tableId, lampId) =>
  t.page.evaluate(([tid, lid]) => {
    const marks = [];
    const furn = {};
    window.__wp.three.scene.traverse((o) => {
      if (o.userData?.compareMarker) {
        let hex = null;
        o.traverse((c) => { if (!hex && c.material?.color) hex = c.material.color.getHexString(); });
        marks.push({ kind: o.userData.compareMarker, ghost: !!o.userData.ghost, id: o.userData.furnitureId, hex });
      } else if (o.userData?.furnitureId) furn[o.userData.furnitureId] = o.position.x;
    });
    return { marks, tableX: furn[tid], hasLamp: lid in furn };
  }, [tableId, lampId]);

export default {
  issue: 99,
  name: 'Eigenschaften-Panel und Vergleich',
  title: 'Eigenschaften-Panel mit Gruppen (#99) und Vorher-nachher-Vergleich in 3D (#76)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '(A) Beispielwohnung, 2D: den Kleiderschrank anklicken.',
      expected: 'Gruppen Objekt, Position, Maße, Aussehen, Preis offen; 3D-Modell, Produkt, Erweitert zu (mit Pfeil). Drehknöpfe, Duplizieren und Löschen weiter unten.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        t.wardrobe = p.furniture.find((f) => f.catalogId === 'generic-wardrobe-150');
        t.sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3');
        await clickAt(t, t.wardrobe);
        const sl = await t.selection();
        const open = {};
        for (const n of ['Objekt', 'Position', 'Maße', 'Aussehen', 'Preis', '3D-Modell', 'Produkt', 'Erweitert']) open[n] = await exp(t, n);
        const ok = sl?.id === t.wardrobe.id && ['Objekt', 'Position', 'Maße', 'Aussehen', 'Preis'].every((n) => open[n]) && ['3D-Modell', 'Produkt', 'Erweitert'].every((n) => !open[n]);
        const chev = await group(t, 'Produkt').locator('svg.panel-group-chevron').count();
        const dup = await right(t).getByRole('button', { name: /Duplizieren/ }).count();
        const del = await right(t).getByRole('button', { name: /Löschen/ }).count();
        const rot = await right(t).getByRole('button', { name: /⟲|⟳|links drehen|rechts drehen/i }).count();
        return { status: ok && chev > 0 && dup > 0 && del > 0 ? 'ok' : 'fail', observed: `Aufgeklappt: ${Object.entries(open).map(([k, v]) => `${k}=${v}`).join(', ')}; Pfeil-Symbol vor „Produkt“: ${chev > 0}; Knöpfe Duplizieren ${dup}, Löschen ${del}, Dreh-Knöpfe ${rot} gefunden. Die Reihenfolge (weiter unten) wurde nicht gemessen.` };
      },
    },
    {
      nr: 2,
      action: '(A) „Produkt“ anklicken, dann das Sofa anklicken.',
      expected: 'Marke, Händler und Produkt-URL erscheinen. Beim Sofa bleibt „Produkt“ offen.',
      async run(t) {
        await group(t, 'Produkt').click();
        const a = [await right(t).getByLabel('Marke').isVisible(), await right(t).getByLabel('Händler').isVisible(), await right(t).getByLabel('Produkt-URL').isVisible()];
        await clickAt(t, t.sofa);
        const sl = await t.selection();
        const stays = await exp(t, 'Produkt');
        return { status: a.every(Boolean) && sl?.id === t.sofa.id && stays ? 'ok' : 'fail', observed: `Marke/Händler/Produkt-URL sichtbar: ${a.join('/')}; Sofa ausgewählt: ${sl?.id === t.sofa.id}; „Produkt“ bleibt offen: ${stays}.` };
      },
    },
    {
      nr: 3,
      action: '(A) Mit Tab bis zur Überschrift „Erweitert“ gehen und Enter drücken.',
      expected: '„Hindernis beim Begehen“ und „Gesperrt“ erscheinen. Enter oder Leertaste klappt wieder zu.',
      async run(t) {
        await group(t, 'Erweitert').focus(); // statt vieler Tab-Schritte
        await t.page.keyboard.press('Enter');
        const on = (await exp(t, 'Erweitert')) && (await right(t).getByLabel('Hindernis beim Begehen').isVisible()) && (await right(t).getByLabel(/^Gesperrt/).isVisible());
        await t.page.keyboard.press('Enter');
        const closed = !(await exp(t, 'Erweitert'));
        await t.page.keyboard.press(' ');
        const space = await exp(t, 'Erweitert');
        return { status: on && closed && space ? 'ok' : 'fail', observed: `Enter öffnet (mit „Hindernis beim Begehen“ und „Gesperrt“): ${on}; Enter schließt: ${closed}; Leertaste öffnet wieder: ${space}. Der Fokus wurde direkt auf die Überschrift gesetzt, nicht mit Tab angesteuert.` };
      },
    },
    {
      nr: 4,
      action: '(A) „Gesperrt“ anhaken.',
      expected: 'X, Y und Drehung sind ausgegraut, bei „Position“ steht ein Badge „gesperrt“.',
      async run(t) {
        await right(t).getByLabel(/^Gesperrt/).check();
        const dis = [];
        for (const n of ['X', 'Y', 'Drehung']) dis.push(await right(t).getByRole('textbox', { name: new RegExp(`^${n}`) }).first().isDisabled().catch(() => null));
        const badge = await right(t).locator('[data-group="furniture.position"]').getByText('gesperrt', { exact: true }).count();
        // wieder entsperren, damit das Sofa später frei bleibt
        await right(t).getByLabel(/^Gesperrt/).uncheck();
        return { status: dis.every((d) => d === true) && badge > 0 ? 'ok' : 'fail', observed: `Felder X/Y/Drehung deaktiviert: ${dis.join('/')}; Badge „gesperrt“ bei Position: ${badge > 0}. Danach wieder entsperrt.` };
      },
    },
    {
      nr: 5,
      action: '(A) Eine Tür anklicken.',
      expected: '„Tür geöffnet“, „Anschlag“ und „Breite“ sind ohne Aufklappen sichtbar.',
      async run(t) {
        const p = await t.project();
        const door = p.openings.find((o) => o.kind === 'door');
        await sel(t, { type: 'opening', id: door.id });
        const v = [await right(t).getByLabel('Tür geöffnet').isVisible(), await right(t).getByLabel('Anschlag').isVisible(), await right(t).getByLabel('Breite').first().isVisible()];
        return { status: v.every(Boolean) ? 'ok' : 'fail', observed: `Sichtbar: Tür geöffnet ${v[0]}, Anschlag ${v[1]}, Breite ${v[2]}. Die Tür wurde per Auswahl gesetzt, nicht per Mausklick.` };
      },
    },
    {
      nr: 6,
      action: '(A) Neu laden.',
      expected: 'Die zuletzt offenen und geschlossenen Gruppen sind gemerkt.',
      async run(t) {
        await t.page.reload();
        await t.page.waitForTimeout(800);
        await sel(t, { type: 'furniture', id: t.wardrobe.id });
        const st = { Produkt: await exp(t, 'Produkt'), Erweitert: await exp(t, 'Erweitert'), '3D-Modell': await exp(t, '3D-Modell'), Maße: await exp(t, 'Maße') };
        return { status: st.Produkt && st.Erweitert && !st['3D-Modell'] && st.Maße ? 'ok' : 'fail', observed: `Nach Neuladen aufgeklappt: ${Object.entries(st).map(([k, v]) => `${k}=${v}`).join(', ')} (erwartet: Produkt und Erweitert offen, 3D-Modell zu).` };
      },
    },
    {
      nr: 7,
      action: '(A) Dasselbe im dunklen Farbschema ansehen.',
      expected: 'Alles ist gut lesbar.',
      async run(t) {
        await t.page.emulateMedia({ colorScheme: 'dark' });
        await t.page.waitForTimeout(500);
        await t.shot('99-dunkel');
        // Kontrast aller sichtbaren Texte im rechten Panel (WCAG: mindestens 4,5 : 1 für normalen Text)
        const res = await t.page.evaluate(() => {
          const parse = (c) => c.match(/[\d.]+/g).map(Number);
          const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c.slice(0, 3); } return [255, 255, 255]; };
          const out = [];
          for (const el of document.querySelectorAll('.panel.right *')) {
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own || !el.offsetParent) continue;
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || (el.disabled && true)) continue;
            const fg = parse(st.color).slice(0, 3);
            const bg = bgOf(el);
            const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
            out.push({ t: el.textContent.trim().slice(0, 30), ratio: (l1 + 0.05) / (l2 + 0.05) });
          }
          out.sort((x, y) => x.ratio - y.ratio);
          return { n: out.length, worst: out.slice(0, 3) };
        });
        await t.page.emulateMedia({ colorScheme: 'light' });
        const min = res.worst[0]?.ratio ?? 0;
        return { status: res.n > 10 && min >= 4.5 ? 'ok' : 'look', observed: `Dunkelmodus: ${res.n} Texte im rechten Panel gemessen; niedrigster Kontrast ${min.toFixed(1)} : 1 („${res.worst[0]?.t}“), danach ${res.worst.slice(1).map((w) => `${w.ratio.toFixed(1)} („${w.t}“)`).join(', ')}. Gemessen wurde nur das Kontrastverhältnis (Ziel für Text meist ab 4,5 : 1, deaktivierte Felder ausgenommen), nicht der Gesamteindruck: Screenshot 99-dunkel.` };
      },
    },
    {
      nr: 8,
      action: '(B) Projekt ▾ → Versionen → Name „Vorher“ → „Aktuellen Stand speichern“, Dialog schließen.',
      expected: 'Der Stand „Vorher“ ist gespeichert.',
      async run(t) {
        t.saved = 0;
        t.openVersions = async () => {
          await t.page.getByRole('button', { name: 'Projekt ▾' }).click();
          await t.page.getByRole('button', { name: /^Versionen/ }).click();
          const dlg = t.page.getByRole('dialog', { name: 'Versionen' });
          await dlg.waitFor();
          return dlg;
        };
        t.saveState = async (name) => {
          const dlg = await t.openVersions();
          await t.poll(async () => (await dlg.getByTestId('versions-count').innerText()).includes(`${t.saved} von höchstens`));
          await dlg.getByLabel('Name des Stands').fill(name);
          await dlg.getByRole('button', { name: 'Aktuellen Stand speichern' }).click();
          t.saved++;
          await t.poll(async () => (await dlg.getByTestId('versions-count').innerText()).includes(`${t.saved} von höchstens`));
          const n = await dlg.getByTestId('version-item').locator('strong').getByText(name, { exact: true }).count();
          await dlg.getByRole('button', { name: 'Schließen' }).click();
          return n;
        };
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(600);
        const n = await t.saveState('Vorher');
        return { status: n === 1 ? 'ok' : 'fail', observed: `Stand „Vorher“ in der Liste: ${n}×.` };
      },
    },
    {
      nr: 9,
      action: '(B) Im 2D-Plan den Couchtisch verschieben, einen Nachttisch drehen (Q/E), die Stehleuchte löschen und ein Möbel aus dem Katalog hinzufügen.',
      expected: 'Die Änderungen sind sichtbar.',
      async run(t) {
        const p = await t.project();
        const table = p.furniture.find((f) => f.catalogId === 'generic-coffee-table');
        const lamp = p.furniture.find((f) => f.catalogId === 'generic-floor-lamp');
        const ns = p.furniture.find((f) => f.catalogId === 'generic-nightstand');
        Object.assign(t, { table, lamp, ns });
        const s0 = await t.planToScreen(table.x, table.y);
        await t.page.mouse.move(s0.x, s0.y);
        await t.page.mouse.down();
        await t.page.mouse.move(s0.x + 40, s0.y + 10, { steps: 5 });
        await t.page.mouse.move(s0.x + 80, s0.y + 20, { steps: 5 });
        await t.page.mouse.up();
        await clickAt(t, ns);
        const rot0 = ns.rotation;
        await t.page.keyboard.press('e');
        await clickAt(t, lamp);
        await t.page.keyboard.press('Delete');
        await t.page.locator('.panel.left').getByRole('button', { name: 'Katalog', exact: true }).click();
        const before = (await t.project()).furniture.map((f) => f.id);
        await t.page.getByPlaceholder(/Suchen/).fill('Kommode');
        await t.page.locator('.panel.left').getByText('Kommode', { exact: false }).first().click();
        await t.poll(async () => (await t.project()).furniture.length > before.length - 1 + 0 && (await t.project()).furniture.some((f) => !before.includes(f.id)));
        await t.poll(() => t.page.evaluate(() => window.__wp.useProjectStore.getState().txBase === null));
        const q = await t.project();
        const moved = q.furniture.find((f) => f.id === table.id).x - table.x;
        const turned = q.furniture.find((f) => f.id === ns.id).rotation - rot0;
        const gone = !q.furniture.some((f) => f.id === lamp.id);
        const added = q.furniture.some((f) => !before.includes(f.id));
        return { status: moved > 0.3 && Math.abs(turned) > 0.05 && gone && added ? 'ok' : 'fail', observed: `Couchtisch um ${moved.toFixed(2)} m verschoben (Maus), Nachttisch um ${(turned * 180 / Math.PI).toFixed(0)}° gedreht (Taste E), Stehleuchte gelöscht: ${gone}, Katalog-Möbel („Kommode“, per Klick im Katalog) hinzugefügt: ${added}.` };
      },
    },
    {
      nr: 10,
      action: '(B) Versionen → als „Nachher“ speichern. Unter „Zwei Stände vergleichen“ A = Vorher, B = Nachher → „In 3D vergleichen“.',
      expected: 'Es ist nur noch 3D zu sehen.',
      async run(t) {
        await t.saveState('Nachher');
        const dlg = await t.openVersions();
        await t.poll(async () => (await dlg.getByTestId('version-item').count()) === 2);
        const lab = async (sel, name) => (await dlg.getByLabel(sel).locator('option').allInnerTexts()).find((x) => x.startsWith(`${name} (`));
        await dlg.getByLabel('Stand A').selectOption({ label: await lab('Stand A', 'Vorher') });
        await dlg.getByLabel('Stand B').selectOption({ label: await lab('Stand B', 'Nachher') });
        t.before = await t.page.evaluate(() => { const s = window.__wp.useProjectStore.getState(); return { json: JSON.stringify(s.project), past: s.past.length, future: s.future.length, revision: s.revision }; });
        await dlg.getByRole('button', { name: 'In 3D vergleichen' }).click();
        await t.page.getByTestId('compare-bar').waitFor();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1500);
        const only3d = (await t.page.locator('[data-testid="editor2d"]').count()) === 0;
        return { status: only3d ? 'ok' : 'fail', observed: `Vergleichsleiste da, 2D-Editor ausgeblendet: ${only3d}.` };
      },
    },
    {
      nr: 11,
      action: '(B) Obere Leiste und Seitenleisten ansehen.',
      expected: 'Oben steht „2 verschoben, 1 neu, 1 entfernt“. Werkzeugleiste und Seitenleisten sind abgeblendet und gesperrt.',
      async run(t) {
        const bar = t.page.getByTestId('compare-bar');
        const legend = await bar.getByTestId('compare-legend').innerText();
        const inert = await t.page.locator('.app-header').getAttribute('inert');
        const panelsInert = await t.page.locator('.panel.left').evaluate((e) => e.hasAttribute('inert') || !!e.closest('[inert]'));
        await t.shot('99-vergleich-a');
        return { status: legend.trim() === '2 verschoben, 1 neu, 1 entfernt' && inert !== null && panelsInert ? 'ok' : 'fail', observed: `Legende „${legend.trim()}“; Werkzeugleiste inert: ${inert !== null}; Seitenleisten inert: ${panelsInert}. Das Abblenden selbst (Optik) siehe Screenshot 99-vergleich-a.` };
      },
    },
    {
      nr: 12,
      action: '(B) Mit Leertaste, A/B-Tasten oder Knöpfen umschalten.',
      expected: 'In B: neues Möbel grün, verschobene/gedrehte orange, Stehleuchte roter Geist. In A: verschobene orange, Stehleuchte rot. Blickwinkel bleibt gleich.',
      async run(t) {
        const bar = t.page.getByTestId('compare-bar');
        const camA = await camPos(t);
        const A = await sceneState(t, t.table.id, t.lamp.id);
        await t.page.keyboard.press(' ');
        await t.poll(async () => !(await sceneState(t, t.table.id, t.lamp.id)).hasLamp);
        const B = await sceneState(t, t.table.id, t.lamp.id);
        const camB = await camPos(t);
        await t.shot('99-vergleich-b');
        await bar.getByRole('button', { name: /^A/ }).click();
        await t.poll(async () => (await sceneState(t, t.table.id, t.lamp.id)).hasLamp);
        const camA2 = await camPos(t);
        const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const colors = (s) => s.marks.map((m) => `${m.kind}${m.ghost ? '(Geist)' : ''}:#${m.hex}`).sort().join(', ');
        const hexB = Object.fromEntries(B.marks.map((m) => [m.kind, m.hex]));
        const hexA = Object.fromEntries(A.marks.map((m) => [m.kind, m.hex]));
        const okB = hexB.added === '16a34a' && hexB.moved === 'd97706' && hexB.removed === 'dc2626' && B.marks.some((m) => m.kind === 'removed' && m.ghost);
        const okA = hexA.moved === 'd97706' && hexA.removed === 'dc2626' && !hexA.added;
        return { status: okA && okB && d(camA, camB) < 1e-6 && d(camA, camA2) < 1e-6 ? 'ok' : 'fail', observed: `Markierungen in B: ${colors(B)} (grün #16a34a, orange #d97706, rot #dc2626); in A: ${colors(A)}; Kamera beim Umschalten identisch: ${d(camA, camB) < 1e-6 && d(camA, camA2) < 1e-6}. Leertaste und Knopf A getestet, die Tasten A/B nicht. Farben aus den Markierungs-Materialien gelesen, nicht im Bild beurteilt (Screenshot 99-vergleich-b).` };
      },
    },
    {
      nr: 13,
      action: '(B) Entf oder Strg+Z drücken.',
      expected: 'Es erscheint „Bearbeiten gesperrt“, nichts ändert sich.',
      async run(t) {
        await t.page.keyboard.press(' '); // zurück auf B
        await t.page.keyboard.press('Delete');
        await t.page.keyboard.press('Control+z');
        const msg = await t.page.getByText('Im Vergleichsmodus ist Bearbeiten gesperrt', { exact: false }).first().isVisible().catch(() => false);
        const after = await t.page.evaluate(() => { const s = window.__wp.useProjectStore.getState(); return { json: JSON.stringify(s.project), past: s.past.length, future: s.future.length, revision: s.revision }; });
        const same = JSON.stringify(after) === JSON.stringify(t.before);
        return { status: msg && same ? 'ok' : 'fail', observed: `Hinweis „Im Vergleichsmodus ist Bearbeiten gesperrt“ sichtbar: ${msg}; Projekt, Undo-Stapel und Revision unverändert: ${same}.` };
      },
    },
    {
      nr: 14,
      action: '(B) „Vergleich beenden“ (oder Esc).',
      expected: 'Die vorherige Ansicht ist zurück, das Projekt ist „Nachher“, Strg+Z macht deinen letzten eigenen Schritt rückgängig.',
      async run(t) {
        await t.page.getByTestId('compare-bar').getByRole('button', { name: 'Vergleich beenden' }).click();
        await t.page.getByTestId('compare-bar').waitFor({ state: 'hidden' });
        const back2d = await t.page.locator('[data-testid="editor2d"]').isVisible();
        const after = await t.page.evaluate(() => { const s = window.__wp.useProjectStore.getState(); return { json: JSON.stringify(s.project), past: s.past.length, future: s.future.length, revision: s.revision }; });
        const same = JSON.stringify(after) === JSON.stringify(t.before);
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(400);
        const q = await t.project();
        const lastUndone = q.furniture.length === JSON.parse(t.before.json).furniture.length - 1;
        return { status: back2d && same && lastUndone ? 'ok' : 'fail', observed: `2D-Ansicht zurück: ${back2d}; Projekt exakt wie vor dem Vergleich (= „Nachher“): ${same}; Strg+Z nimmt den letzten Schritt (das Katalog-Möbel) zurück: ${lastUndone}. Beendet per Knopf, nicht per Esc.` };
      },
    },
  ],
};
