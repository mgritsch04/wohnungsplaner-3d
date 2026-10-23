// Sichtlinien (#89), Maßband in 3D (#88), kurze Maßlinien (#125), klarerer 2D-Plan (#104) – Testschritte aus dem Kommentar in #89.
const right = (t) => t.page.locator('.panel.right');
const plan = (t) => t.page.locator('[data-testid="editor2d"]');
const sight = (t) => plan(t).getByTestId('sightlines');
const vp = (t) => plan(t).getByTestId('sight-viewpoint');
const share = async (t) => Number(await sight(t).getAttribute('data-share'));
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const zoom2d = (t) => t.page.evaluate(() => window.__wp.useUiStore.getState().view2d.zoom);
const setZoom = async (t, z) => {
  await t.page.evaluate((v) => {
    const ui = window.__wp.useUiStore.getState();
    ui.setView2d({ ...ui.view2d, zoom: v });
  }, z);
  await t.poll(async () => (await zoom2d(t)) === z);
};
const circle = async (t) => {
  const c = await t.page.locator('[data-testid="scene3d"] canvas').boundingBox();
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
};

export default {
  issue: 89,
  name: 'Sichtlinien, Maßband, Maßlinien, 2D-Plan',
  title: 'Sichtlinien im Plan (plus #88 Maßband, #125 kurze Maßlinien, #104 klarerer 2D-Plan)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '(A) Beispielwohnung, 2D. Projekt › „Sichtlinien (2D)“ › „Sichtlinien anzeigen“.',
      expected: 'Blickpunkt (Kreis) innen an der Eingangstür; Wohnzimmer grün, im Schlafzimmer nur ein Keil durch die Zimmertür; „sichtbar … %“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).getByLabel('Sichtlinien anzeigen').check();
        await sight(t).waitFor();
        const sh = await share(t);
        t.share0 = sh;
        const x = Number(await vp(t).getAttribute('data-x'));
        const y = Number(await vp(t).getAttribute('data-y'));
        const txt = await right(t).getByTestId('sight-share-panel').innerText();
        await t.shot('89-sicht');
        const ok = near(y, 3.7, 0.1) && sh > 0.1 && sh < 1 && txt.includes(`${Math.round(sh * 100)} %`) && (await plan(t).getByTestId('sight-visible').count()) > 0;
        return { status: ok ? 'look' : 'fail', observed: `Blickpunkt bei (${x.toFixed(2)} | ${y.toFixed(2)}) m, also an der Eingangstür; sichtbare Fläche ${Math.round(sh * 100)} % (Panel: „${txt.replace(/\s+/g, ' ')}“). Ob das Wohnzimmer grün ist und im Schlafzimmer nur ein Keil durch die Tür liegt, zeigt der Screenshot 89-sicht.` };
      },
    },
    {
      nr: 2,
      action: '(A) Den Kreis ins Schlafzimmer ziehen.',
      expected: 'Die grüne Fläche folgt, kein Möbel wird verschoben.',
      async run(t) {
        const furn0 = JSON.stringify((await t.project()).furniture.map((f) => [f.x, f.y]));
        const x0 = Number(await vp(t).getAttribute('data-x'));
        const y0 = Number(await vp(t).getAttribute('data-y'));
        const a = await t.planToScreen(x0, y0);
        const b = await t.planToScreen(7.2, 2.8);
        await t.page.mouse.move(a.x, a.y);
        await t.page.mouse.down();
        await t.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
        await t.page.mouse.move(b.x, b.y, { steps: 5 });
        await t.page.mouse.up();
        await t.poll(async () => Number(await vp(t).getAttribute('data-x')) > 6.5);
        const sh = await share(t);
        const furn1 = JSON.stringify((await t.project()).furniture.map((f) => [f.x, f.y]));
        const sl = await t.selection();
        await t.shot('89-sicht-schlafzimmer');
        return { status: Math.abs(sh - t.share0) > 0.05 && furn0 === furn1 && !sl ? 'ok' : 'fail', observed: `Sichtbare Fläche ${Math.round(t.share0 * 100)} % → ${Math.round(sh * 100)} %; Möbel unverändert: ${furn0 === furn1}; nichts ausgewählt: ${!sl}.` };
      },
    },
    {
      nr: 3,
      action: '(A) Die Zimmertür auswählen und mit O schließen.',
      expected: 'Der Blick durch die Tür verschwindet.',
      async run(t) {
        const p = await t.project();
        const nodes = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
        const door = p.openings.find((o) => {
          if (o.kind !== 'door') return false;
          const w = p.walls.find((q) => q.id === o.wallId);
          return Math.abs(nodes[w.a].x - 5) < 0.2 && Math.abs(nodes[w.b].x - 5) < 0.2;
        });
        t.door = door;
        const before = await share(t);
        await sel(t, { type: 'opening', id: door.id });
        const wasOpen = (await t.project()).openings.find((o) => o.id === door.id).open;
        if (wasOpen !== false) await t.page.keyboard.press('o');
        await t.page.waitForTimeout(400);
        const open1 = (await t.project()).openings.find((o) => o.id === door.id).open;
        const after = await share(t);
        return { status: open1 === false && after < before - 0.005 ? 'ok' : 'fail', observed: `Tür vorher ${wasOpen ? 'offen' : 'zu'}, nach O ${open1 ? 'offen' : 'zu'}; sichtbare Fläche vom Schlafzimmer aus ${Math.round(before * 100)} % → ${Math.round(after * 100)} %.` };
      },
    },
    {
      nr: 4,
      action: '(A) „Blickpunkt auf den Eingang zurücksetzen“ klicken, Häkchen entfernen.',
      expected: 'Der Blickpunkt steht wieder am Eingang, die Anzeige ist aus.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).getByRole('button', { name: 'Blickpunkt auf den Eingang zurücksetzen' }).click();
        await t.poll(async () => near(Number(await vp(t).getAttribute('data-y')), 3.7, 0.1));
        const y = Number(await vp(t).getAttribute('data-y'));
        await right(t).getByLabel('Sichtlinien anzeigen').uncheck();
        const gone = (await plan(t).getByTestId('sightlines').count()) === 0;
        return { status: gone && near(y, 3.7, 0.1) ? 'ok' : 'fail', observed: `Blickpunkt y = ${y.toFixed(2)} m (Eingang); Anzeige aus: ${gone}. Die Tür aus Schritt 3 ist weiter geschlossen.` };
      },
    },
    {
      nr: 5,
      action: '(B) 3D, „Schnitt“ an, oben links „Maßband“ oder Taste K.',
      expected: 'Das Maßband ist aktiv.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.getByRole('button', { name: 'Schnitt' }).click();
        await t.page.waitForTimeout(1500);
        await t.page.getByRole('button', { name: 'Maßband' }).click();
        const st = await t.page.getByRole('status').first().innerText();
        const on = (await t.page.getByRole('button', { name: 'Maßband' }).getAttribute('aria-pressed')) === 'true';
        return { status: on && /Ersten Punkt anklicken/.test(st) ? 'ok' : 'fail', observed: `Knopf aktiv: ${on}; Hinweis: „${st.trim()}“. (Per Knopf, nicht per Taste K aktiviert.)` };
      },
    },
    {
      nr: 6,
      action: '(B) Zwei Punkte auf dem Boden anklicken.',
      expected: 'Eine orange Linie mit Länge und ↔/↕; weitere Messungen möglich.',
      async run(t) {
        for (const [x, z] of [[0.6, 0.7], [0.6, 2.1]]) {
          const s = await t.worldToScreen(x, 0, z);
          await t.page.mouse.click(s.x, s.y);
        }
        const label = t.page.getByTestId('tape-label');
        await label.first().waitFor({ timeout: 4000 });
        const len = Number(await label.first().getAttribute('data-length'));
        const txt = await label.first().innerText();
        // a second measurement
        for (const [x, z] of [[1.2, 0.7], [2.4, 0.7]]) {
          const s = await t.worldToScreen(x, 0, z);
          await t.page.mouse.click(s.x, s.y);
        }
        await t.page.waitForTimeout(300);
        const count = await label.count();
        await t.shot('89-massband');
        return { status: near(len, 1.4, 0.01) && /1,40 m/.test(txt) && /↕ 0,00 m/.test(txt) && count === 2 ? 'ok' : 'fail', observed: `Beschriftung „${txt.replace(/\s+/g, ' ')}“ (Länge ${len.toFixed(2)} m, Soll 1,40 m); nach einer weiteren Messung ${count} Messungen. Die Linienfarbe (orange) habe ich nicht gemessen, siehe Screenshot 89-massband.` };
      },
    },
    {
      nr: 7,
      action: '(B) Beim Messen auf ein Möbel klicken.',
      expected: 'Es wird nur gemessen, nichts wird ausgewählt.',
      async run(t) {
        const p = await t.project();
        const sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3') ?? p.furniture[0];
        const n0 = await t.page.getByTestId('tape-label').count();
        const s = await t.worldToScreen(sofa.x, 0.4, sofa.y);
        await t.page.mouse.click(s.x, s.y);
        const sl = await t.selection();
        const after = (await t.project()).furniture.find((f) => f.id === sofa.id);
        const unmoved = after.x === sofa.x && after.y === sofa.y;
        return { status: !sl && unmoved ? 'ok' : 'fail', observed: `Nach Klick aufs Sofa: Auswahl ${sl ? JSON.stringify(sl) : 'keine'}; Sofa unverändert: ${unmoved}; Messungen ${n0} → ${await t.page.getByTestId('tape-label').count()} (der Klick setzt den ersten Punkt der nächsten Messung).` };
      },
    },
    {
      nr: 8,
      action: '(B) Beim Begehen K drücken und mit dem Fadenkreuz zwei Punkte setzen.',
      expected: 'Die Messung funktioniert auch im Begehen-Modus.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.keyboard.press('k'); // tool off
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await page.keyboard.press('k');
        const c = await circle(t);
        const centre = () => page.mouse.click(c.x, c.y);
        await centre();
        const locked = () => page.evaluate(() => document.pointerLockElement?.tagName === 'CANVAS');
        for (let i = 0; i < 20 && !(await locked()); i++) {
          await centre();
          await page.waitForTimeout(600);
        }
        const dir = () => page.evaluate(() => { const m = window.__wp.three.camera.matrixWorld.elements; return [-m[8], -m[9], -m[10]]; });
        const lookAndWait = async (yaw, pitch) => {
          const d0 = await dir();
          await page.evaluate(([y, p]) => window.__wp.walk.look(y, p), [yaw, pitch]);
          await t.poll(async () => { const d = await dir(); return Math.hypot(d[0] - d0[0], d[1] - d0[1], d[2] - d0[2]) > 0.05; }, 15000);
        };
        const before = await page.getByTestId('tape-label').count();
        await lookAndWait(0, -0.6);
        await centre();
        const st1 = await page.getByRole('status').first().innerText();
        await lookAndWait(0.4, -0.5);
        await centre();
        await page.getByTestId('tape-label').first().waitFor({ timeout: 4000 }).catch(() => {});
        const n = await page.getByTestId('tape-label').count();
        const len = Number(await page.getByTestId('tape-label').last().getAttribute('data-length'));
        const sl = await t.selection();
        return { status: n === before + 1 && len > 0.1 && !sl && /Zweiten Punkt/.test(st1) ? 'ok' : 'fail', observed: `Mauszeiger gefangen: ${await locked()}; nach Punkt 1: „${st1.trim()}“; Messungen ${before} → ${n}, Länge ${len.toFixed(2)} m; nichts ausgewählt: ${!sl}. Die Blickrichtung wurde per Testhaken gesetzt, nicht mit der Maus.` };
      },
    },
    {
      nr: 9,
      action: '(B) Esc drücken, dann K.',
      expected: 'Esc löscht die Messungen, K beendet das Maßband.',
      async run(t) {
        await t.page.evaluate(() => document.exitPointerLock()); // the browser itself releases the mouse on Esc
        await t.page.keyboard.press('Escape');
        await t.page.waitForTimeout(300);
        const n = await t.page.getByTestId('tape-label').count();
        await t.page.keyboard.press('k');
        const on = await t.page.getByRole('button', { name: 'Maßband' }).getAttribute('aria-pressed').catch(() => null);
        return { status: n === 0 && on !== 'true' ? 'ok' : 'fail', observed: `Messungen nach Esc: ${n}; Maßband nach K: aria-pressed=${on}.` };
      },
    },
    {
      nr: 10,
      action: '(C) Den Couchtisch auf etwa 8 cm vor das Sofa ziehen.',
      expected: '„8 cm“ steht neben der kurzen Linie, nicht darauf.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        const table = p.furniture.find((f) => f.catalogId === 'generic-coffee-table');
        t.table = table;
        const s = await t.planToScreen(table.x, table.y);
        await t.page.mouse.click(s.x, s.y);
        const sl = await t.selection();
        if (sl?.id !== table.id) await sel(t, { type: 'furniture', id: table.id });
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { const f = d.furniture.find((x) => x.id === id); f.y = 3.097 - 0.08 - f.depth / 2; }), table.id);
        await t.page.keyboard.down('Alt');
        const front = plan(t).locator('[data-testid="clearance"][data-side="front"]');
        await front.waitFor({ timeout: 4000 });
        const dist = await front.getAttribute('data-distance-cm');
        const lab = await front.getAttribute('data-label');
        const lb = await front.locator('line').first().boundingBox();
        const tb = await front.locator('text').boundingBox();
        await t.shot('89-massline');
        const beside = tb.x >= lb.x + lb.width - 1;
        return { status: dist === '8' && lab === 'beside' && beside ? 'ok' : 'fail', observed: `Abstand ${dist} cm, Beschriftung „${lab}“; Text beginnt bei x=${Math.round(tb.x)}, Linie endet bei x=${Math.round(lb.x + lb.width)} (neben der Linie: ${beside}). Der Tisch wurde per Store verschoben, nicht mit der Maus gezogen.` };
      },
    },
    {
      nr: 11,
      action: '(C) Den Tisch angeklickt lassen und Alt halten.',
      expected: 'Die hintere Maßlinie läuft am Dreh-Griff vorbei, der Griff bleibt bedienbar.',
      async run(t) {
        const back = plan(t).locator('[data-testid="clearance"][data-side="back"]');
        const shifted = await back.getAttribute('data-shifted');
        const item = (await t.project()).furniture.find((f) => f.id === t.table.id);
        const zoom = await zoom2d(t);
        const px = 1 / zoom;
        // rotate handle: 22 px behind the back edge (src/model/clearances.ts)
        const rx = Math.cos(item.rotation) * 0 - Math.sin(item.rotation) * (-item.depth / 2 - 22 * px);
        const ry = Math.sin(item.rotation) * 0 + Math.cos(item.rotation) * (-item.depth / 2 - 22 * px);
        const hs = await t.planToScreen(item.x + rx, item.y + ry);
        const bb = await back.locator('line').first().boundingBox();
        const dx = Math.abs(bb.x + bb.width / 2 - hs.x);
        await t.page.keyboard.up('Alt');
        const gone = (await plan(t).getByTestId('clearances').count()) === 0;
        return { status: shifted === 'true' && dx >= 10 && gone ? 'ok' : 'fail', observed: `Hintere Linie verschoben (data-shifted=${shifted}); Abstand zum Dreh-Griff ${Math.round(dx)} px (Soll ≥ 10 px); nach Loslassen von Alt sind die Maßlinien weg: ${gone}. Dass der Griff dabei bedienbar bleibt, wurde nicht mit der Maus ausprobiert.` };
      },
    },
    {
      nr: 12,
      action: '(D) 2D-Plan ansehen.',
      expected: 'Wände kräftig mit klarer Kante, Möbel dünner und heller, Raster dezent.',
      async run(t) {
        await sel(t, null);
        await t.page.waitForTimeout(300);
        await t.shot('89-plan');
        const wall = await plan(t).locator('[data-layer="wall"]').first().evaluate((el) => { const c = getComputedStyle(el); return { fill: c.fill, stroke: c.stroke, w: c.strokeWidth }; });
        return { status: 'look', observed: `Wand: Füllung ${wall.fill}, Kante ${wall.stroke}, Linienbreite ${wall.w}. Ob die Wände kräftig, die Möbel dünner und hell und das Raster dezent wirken, ist Optik: Screenshot 89-plan.` };
      },
    },
    {
      nr: 13,
      action: '(D) Stark hinein- und hinauszoomen.',
      expected: 'Die Linien bleiben gleich dick.',
      async run(t) {
        const wall = plan(t).locator('[data-layer="wall"]').first();
        const at = async (z) => {
          await setZoom(t, z);
          return wall.evaluate((el) => { const c = getComputedStyle(el); return `${c.strokeWidth}|${c.getPropertyValue('vector-effect')}`; });
        };
        const a = await at(220);
        const b = await at(40);
        return { status: a === b && a.endsWith('non-scaling-stroke') ? 'ok' : 'fail', observed: `Linienbreite bei Zoom 220: ${a}; bei Zoom 40: ${b}.` };
      },
    },
    {
      nr: 14,
      action: '(D) Dunkelmodus an; „Plan als PNG“ und „Druckansicht“ öffnen.',
      expected: 'Der Plan bleibt hell. PNG und Druckansicht zeigen dieselbe ruhige Darstellung.',
      async run(t) {
        await t.page.emulateMedia({ colorScheme: 'dark' });
        await t.page.waitForTimeout(400);
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const wallFill = await plan(t).locator('[data-layer="wall"]').first().evaluate((el) => getComputedStyle(el).fill);
        const dl = t.page.waitForEvent('download');
        await right(t).getByRole('button', { name: 'Plan als PNG' }).click();
        const d = await dl;
        await right(t).getByRole('button', { name: /Druckansicht/ }).click();
        await t.page.getByTestId('print-view').waitFor({ timeout: 5000 });
        await t.shot('89-druckansicht');
        return { status: 'look', observed: `Dunkelmodus an: Wandfarbe im Plan unverändert ${wallFill}; PNG „${d.suggestedFilename()}“ wurde erzeugt; Druckansicht geöffnet. Ob Plan, PNG und Druckansicht hell und gleich ruhig aussehen, bitte ansehen: Screenshot 89-druckansicht.` };
      },
    },
  ],
};
