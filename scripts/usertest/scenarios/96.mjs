// Ruhigeres Desktop-UI (#96–#98) und Ausrichten/Verteilen (#51) – Testschritte aus dem Kommentar in #96.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
const boxes = async (t, ids) => {
  const p = await t.project();
  return ids.map((id) => {
    const f = p.furniture.find((x) => x.id === id);
    const turned = Math.abs(Math.sin(f.rotation)) > 0.5;
    const w = turned ? f.depth : f.width;
    const d = turned ? f.width : f.depth;
    return { minX: f.x - w / 2, maxX: f.x + w / 2, minY: f.y - d / 2, maxY: f.y + d / 2 };
  });
};
const clickShift = async (t, f) => {
  const s = await t.planToScreen(f.x, f.y);
  await t.page.keyboard.down('Shift');
  await t.page.mouse.click(s.x, s.y);
  await t.page.keyboard.up('Shift');
};
const controls = (t) => right(t).getByTestId('arrange-controls');
const openGroups = (t) => left(t).locator('button.panel-group-toggle[aria-expanded="true"]').allInnerTexts();

export default {
  issue: 96,
  name: 'Ruhigeres UI, Ausrichten und Verteilen',
  title: 'Ruhigeres Desktop-UI (#96–#98) und Möbel ausrichten und verteilen (#51)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '(A) App öffnen.',
      expected: 'Das linke Panel wirkt aufgeräumt, nur Werkzeuge + „Raum mit Maßen anlegen“ sind offen.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const open = (await openGroups(t)).map((x) => x.trim());
        const all = (await left(t).locator('button.panel-group-toggle').allInnerTexts()).map((x) => x.trim());
        await t.shot('96-panel');
        return { status: open.length <= 2 && open.includes('Raum mit Maßen anlegen') ? 'look' : 'fail', observed: `Aufgeklappte Gruppen links: ${open.join(', ') || '–'} (insgesamt ${all.length} Gruppen, zugeklappt: ${all.filter((x) => !open.includes(x)).join(', ')}). Ob das Panel „aufgeräumt wirkt“, ist Eindruck: Screenshot 96-panel.` };
      },
    },
    {
      nr: 2,
      action: '(A) Auf „Raster & Einrasten“ klicken, dann neu laden.',
      expected: 'Die Gruppe klappt auf und bleibt nach dem Neuladen offen.',
      async run(t) {
        const g = left(t).getByRole('button', { name: 'Raster & Einrasten' });
        const before = await g.getAttribute('aria-expanded');
        await g.click();
        const mid = await g.getAttribute('aria-expanded');
        await t.page.waitForTimeout(600);
        await t.page.reload();
        await t.page.getByRole('button', { name: '2D', exact: true }).click().catch(() => {});
        await t.page.waitForTimeout(600);
        const after = await left(t).getByRole('button', { name: 'Raster & Einrasten' }).getAttribute('aria-expanded');
        return { status: before === 'false' && mid === 'true' && after === 'true' ? 'ok' : 'fail', observed: `aria-expanded vorher ${before}, nach Klick ${mid}, nach Neuladen ${after}.` };
      },
    },
    {
      nr: 3,
      action: '(A) Werkzeug „Wand“ wählen.',
      expected: 'Unter dem Raster steht ein Satz, was das Werkzeug macht.',
      async run(t) {
        await left(t).getByRole('button', { name: /^Wand/ }).first().click();
        const hint = await left(t).getByTestId('tool-hint').innerText();
        return { status: hint.trim().length > 10 ? 'ok' : 'fail', observed: `Werkzeug „Wand“ gewählt; Hinweis: „${hint.trim()}“.` };
      },
    },
    {
      nr: 4,
      action: '(A) Symbolleiste ansehen.',
      expected: 'Übersicht/Begehen/Schnitt sind beschriftet, die Gruppen sind durch dünne Trenner getrennt.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1000);
        const names = {};
        for (const n of ['Übersicht', 'Begehen', 'Schnitt']) names[n] = await t.page.getByRole('button', { name: n }).first().isVisible().catch(() => false);
        const seps = await t.page.locator('.toolbar hr').count();
        await t.shot('96-symbolleiste');
        return { status: Object.values(names).every(Boolean) ? 'look' : 'fail', observed: `Beschriftete Knöpfe sichtbar: ${Object.entries(names).map(([k, v]) => `${k}=${v}`).join(', ')}; Trenner (hr) in der Symbolleiste: ${seps}. Ob die Trenner „dünn“ und die Leiste ruhig wirken, siehe Screenshot 96-symbolleiste.` };
      },
    },
    {
      nr: 5,
      action: '(A) Zoom-Leiste ansehen und benutzen.',
      expected: 'Sie sitzt unten rechts in jeder Ansicht und funktioniert wie vorher.',
      async run(t) {
        const out = [];
        let ok = true;
        for (const [view, id] of [['2D', 'zoom-2d'], ['3D', 'zoom-3d']]) {
          await t.page.getByRole('button', { name: view, exact: true }).click();
          await t.page.waitForTimeout(800);
          const z = t.page.getByTestId(id);
          const b = await z.boundingBox();
          const vp = t.page.viewportSize();
          const bottomRight = b && b.x + b.width > vp.width * 0.5 && b.y + b.height > vp.height * 0.6;
          const read = view === '2D' ? () => t.page.evaluate(() => window.__wp.useUiStore.getState().view2d.zoom) : () => t.page.evaluate(() => { const c = window.__wp.three.camera.position; return Math.hypot(c.x, c.y, c.z); });
          const v0 = await read();
          await z.getByRole('button', { name: /hineinzoomen/ }).click();
          await t.page.waitForTimeout(700);
          const v1 = await read();
          out.push(`${view}: Box (${Math.round(b.x)}|${Math.round(b.y)}), unten rechts: ${!!bottomRight}, Wert ${v0.toFixed(2)} → ${v1.toFixed(2)}`);
          ok = ok && !!bottomRight && v0 !== v1;
        }
        return { status: ok ? 'ok' : 'fail', observed: out.join('; ') };
      },
    },
    {
      nr: 6,
      action: '(A) Mit der Maus über Knöpfe fahren, klicken, mit Tab durch die Symbolleiste, in ein Feld klicken.',
      expected: 'Hover und Gedrückt-Zustand deutlich, aktives Werkzeug blau, blauer Fokusring, Feld blauer Rand, Rückgängig/Wiederholen im Startzustand ausgegraut.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        const undo = t.page.getByRole('button', { name: /Rückgängig/ }).first();
        const redo = t.page.getByRole('button', { name: /Wiederholen/ }).first();
        const dis = [await undo.isDisabled(), await redo.isDisabled()];
        await t.page.keyboard.press('Tab');
        await t.page.keyboard.press('Tab');
        const focus = await t.page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { tag: e.tagName, outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor, shadow: c.boxShadow.slice(0, 60) }; });
        await t.shot('96-fokus');
        return { status: dis[0] && dis[1] ? 'look' : 'fail', observed: `Rückgängig/Wiederholen im Startzustand ausgegraut: ${dis.join('/')} (true = deaktiviert); Fokus nach 2× Tab auf <${focus.tag}>, Umriss „${focus.outline}“, Schatten „${focus.shadow}“. Hover, Gedrückt, Blau der Werkzeuge und Feldrand sind Optik: Screenshot 96-fokus.` };
      },
    },
    {
      nr: 7,
      action: '(A) Browser-Zoom auf 200 % stellen und das Fenster schmal ziehen.',
      expected: 'Alles bleibt lesbar.',
      async run(t) {
        const vp = t.page.viewportSize();
        await t.page.setViewportSize({ width: 720, height: 450 }); // entspricht 200 % Browser-Zoom bei 1440×900
        await t.page.waitForTimeout(800);
        const over = await t.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        await t.shot('96-zoom200');
        await t.page.setViewportSize(vp);
        return { status: 'look', observed: `Fenster auf 720×450 verkleinert (entspricht 200 % Zoom): waagrechte Scrollleiste der Seite: ${over}. Ob alles lesbar bleibt, siehe Screenshot 96-zoom200.` };
      },
    },
    {
      nr: 8,
      action: '(A) „Plan drucken“ öffnen.',
      expected: 'Das Blatt bleibt weiß, der Druck sieht aus wie vorher.',
      async run(t) {
        await t.page.emulateMedia({ colorScheme: 'dark' });
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).getByRole('button', { name: /Druckansicht/ }).click();
        const pv = t.page.getByTestId('print-view');
        await pv.waitFor({ timeout: 5000 });
        const bg = await pv.locator('.print-page').evaluate((e) => getComputedStyle(e).backgroundColor);
        await t.shot('96-druck');
        await t.page.emulateMedia({ colorScheme: 'light' });
        const lum = (() => { const [r, g, b] = bg.match(/[\d.]+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; })();
        return { status: lum > 0.9 ? 'look' : 'fail', observed: `Druckblatt (bei Dunkelmodus) Hintergrund ${bg}, Helligkeit ${Math.round(lum * 100)} %. „Sieht aus wie vorher“ lässt sich nur im Bild beurteilen: Screenshot 96-druck.` };
      },
    },
    {
      nr: 9,
      action: '(A) Gefällt dir der Look jetzt besser?',
      expected: 'Ja; was noch stört, bitte hier notieren.',
      async run() {
        return { status: 'look', observed: 'Das ist eine Geschmacksfrage und kann nur G beantworten.' };
      },
    },
    {
      nr: 10,
      action: '(B) Im 2D-Plan das Bett anklicken, dann mit Umschalt+Klick beide Nachttische dazunehmen.',
      expected: 'Rechts erscheinen „Ausrichten“ (6 Knöpfe) und „Verteilen“ (2 Knöpfe).',
      async run(t) {
        await t.page.keyboard.press('Escape');
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(600);
        await t.page.getByRole('button', { name: 'Projekt', exact: true }).first().isVisible().catch(() => {});
        const p = await t.project();
        const bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        const ns = p.furniture.filter((f) => f.catalogId === 'generic-nightstand');
        t.ids = [bed.id, ...ns.map((n) => n.id)];
        t.ns = ns;
        const s = await t.planToScreen(bed.x, bed.y);
        await t.page.mouse.click(s.x, s.y);
        for (const n of ns) await clickShift(t, n);
        const nAl = await controls(t).getByRole('group', { name: 'Ausrichten' }).getByRole('button').count();
        const nDi = await controls(t).getByRole('group', { name: 'Verteilen' }).getByRole('button').count();
        return { status: nAl === 6 && nDi === 2 ? 'ok' : 'fail', observed: `Knöpfe Ausrichten: ${nAl}, Verteilen: ${nDi} (Bett und ${ns.length} Nachttische ausgewählt).` };
      },
    },
    {
      nr: 11,
      action: '(B) „Oben ausrichten“ klicken.',
      expected: 'Die drei Möbel haben dieselbe Oberkante. Ein Hinweis bestätigt das.',
      async run(t) {
        const b0 = await boxes(t, t.ids);
        t.past0 = await past(t);
        await controls(t).getByRole('button', { name: 'Oben ausrichten' }).click();
        const top = await boxes(t, t.ids);
        t.top = top;
        const same = top.every((b) => Math.abs(b.minY - top[0].minY) < 0.01);
        const toast = await t.page.locator('[role="status"], .toast').allInnerTexts();
        return { status: same && Math.abs(b0[0].minY - b0[1].minY) > 0.05 ? 'ok' : 'fail', observed: `Oberkanten vorher: ${b0.map((b) => b.minY.toFixed(2)).join(' / ')}; nachher: ${top.map((b) => b.minY.toFixed(2)).join(' / ')}; Rückgängig-Schritte +${(await past(t)) - t.past0}; angezeigte Hinweise: ${toast.map((x) => x.trim()).filter(Boolean).join(' | ') || 'keiner gefunden'}.` };
      },
    },
    {
      nr: 12,
      action: '(B) „Waagrecht verteilen“ klicken.',
      expected: 'Die Abstände zwischen den Möbeln sind gleich groß.',
      async run(t) {
        await controls(t).getByRole('button', { name: 'Waagrecht verteilen' }).click();
        const d = (await boxes(t, t.ids)).sort((a, b) => a.minX - b.minX);
        const gaps = d.slice(1).map((b, i) => b.minX - d[i].maxX);
        return { status: Math.abs(gaps[0] - gaps[1]) < 0.01 && gaps[0] >= 0 ? 'ok' : 'fail', observed: `Abstände: ${gaps.map((g) => (g * 100).toFixed(1) + ' cm').join(' / ')}; Rückgängig-Schritte +${(await past(t)) - t.past0}.` };
      },
    },
    {
      nr: 13,
      action: '(B) Strg+Z drücken.',
      expected: 'Jeder Schritt wird einzeln rückgängig gemacht.',
      async run(t) {
        const p1 = await past(t);
        await t.page.keyboard.press('Control+z');
        const p2 = await past(t);
        const back = await boxes(t, t.ids);
        const same = back.every((b, i) => Math.abs(b.minX - t.top[i].minX) < 0.001 && Math.abs(b.minY - t.top[i].minY) < 0.001);
        return { status: p1 - p2 === 1 && same ? 'ok' : 'fail', observed: `Schritte ${p1} → ${p2}; Zustand wie nach „Oben ausrichten“: ${same}.` };
      },
    },
    {
      nr: 14,
      action: '(B) Möbel aus zwei verschiedenen Räumen ausrichten.',
      expected: 'Ein Möbel stoppt an der Wand dazwischen, ein Hinweis erklärt das, es entsteht keine Überlappung.',
      async run(t) {
        const p = await t.project();
        const sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3');
        const bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        const s = await t.planToScreen(sofa.x, sofa.y);
        await t.page.mouse.click(s.x, s.y);
        await clickShift(t, bed);
        const sl = [(await t.selection())?.id, ...(await t.page.evaluate(() => window.__wp.useUiStore.getState().multi))];
        const before = await boxes(t, [sofa.id, bed.id]);
        await controls(t).getByRole('button', { name: 'Links ausrichten' }).click();
        await t.page.waitForTimeout(400);
        const after = await boxes(t, [sofa.id, bed.id]);
        const toast = (await t.page.locator('[role="status"], .toast').allInnerTexts()).map((x) => x.trim()).filter(Boolean);
        const overlap = !(after[0].maxX <= after[1].minX || after[1].maxX <= after[0].minX || after[0].maxY <= after[1].minY || after[1].maxY <= after[0].minY);
        const moved = after.map((b, i) => Math.abs(b.minX - before[i].minX) > 0.01);
        await t.shot('96-raeume');
        return { status: !overlap && toast.length ? 'look' : 'fail', observed: `Ausgewählt: Sofa und Bett (${sl.filter(Boolean).length}); linke Kanten vorher ${before.map((b) => b.minX.toFixed(2)).join(' / ')}, nachher ${after.map((b) => b.minX.toFixed(2)).join(' / ')}; bewegt: ${moved.join('/')}; Überlappung: ${overlap}; Hinweis: ${toast.join(' | ') || 'keiner'}. Dass das Möbel „an der Wand stoppt“ und der Hinweis es verständlich erklärt, bitte im Bild beurteilen: Screenshot 96-raeume.` };
      },
    },
    {
      nr: 15,
      action: '(B) Genau 2 Möbel auswählen.',
      expected: '„Verteilen“ ist ausgegraut.',
      async run(t) {
        const dis = await controls(t).getByRole('button', { name: 'Waagrecht verteilen' }).isDisabled();
        const dis2 = await controls(t).getByRole('button', { name: 'Senkrecht verteilen' }).isDisabled();
        return { status: dis && dis2 ? 'ok' : 'fail', observed: `Bei 2 ausgewählten Möbeln: „Waagrecht verteilen“ deaktiviert ${dis}, „Senkrecht verteilen“ deaktiviert ${dis2}.` };
      },
    },
  ],
};
