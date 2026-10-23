// Innenaufteilung von Schränken (#85) – Testschritte aus dem Kommentar in #85.
const right = (t) => t.page.locator('.panel.right');
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const wardrobe = async (t) => (await t.project()).furniture.find((f) => f.name.includes('Kleiderschrank'));
const interior = async (t) => (await wardrobe(t)).interior;
const badge = (t) => right(t).locator('text=/^(nicht geplant|passt|\\d+ Hinweise?)$/').first().textContent();
const issues = (t) => right(t).getByTestId('interior-issues').allTextContents();
const parts = (t) => right(t).getByTestId('interior-part').count();
const redParts = (t) => right(t).getByTestId('interior-front').locator('[stroke="#dc2626"], [fill="#dc2626"]').count();
const dashed2d = (t) => t.page.locator('[data-testid="editor2d"] [stroke-dasharray="4 3"]').count();
const meshes3d = (t, id) =>
  t.page.evaluate((fid) => {
    let n = 0;
    window.__wp.three.scene.traverse((o) => {
      if (o.userData?.furnitureId === fid || o.userData?.id === fid) o.traverse((c) => c.isMesh && n++);
    });
    return n;
  }, id);

export default {
  issue: 85,
  name: 'Innenaufteilung Schrank',
  title: 'Innenaufteilung von Schränken planen (Stange, Fächer, Schubladen)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Kleiderschrank anklicken, im Eigenschaften-Panel die Gruppe „Innenaufteilung“ öffnen.',
      expected: 'Badge „nicht geplant“, Auswahl „Aufteilung beginnen …“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const f = await wardrobe(t);
        t.fid = f.id;
        const s = await t.planToScreen(f.x, f.y);
        await t.page.mouse.click(s.x, s.y);
        let sl = await t.selection();
        let how = 'per Mausklick';
        if (sl?.id !== f.id) {
          await sel(t, { type: 'furniture', id: f.id });
          how = 'per Auswahl gesetzt';
        }
        const group = right(t).getByText('Innenaufteilung', { exact: true }).first();
        await group.waitFor();
        if (!(await right(t).getByLabel('Voreinstellung').isVisible())) await group.click();
        const b = await badge(t);
        const opts = await right(t).getByLabel('Voreinstellung').locator('option').allInnerTexts();
        return { status: b === 'nicht geplant' && opts[0] === 'Aufteilung beginnen …' ? 'ok' : 'fail', observed: `„${f.name}“ (${Math.round(f.width * 100)} cm) ${how} ausgewählt; Badge „${b}“; erste Auswahl „${opts[0]}“.` };
      },
    },
    {
      nr: 2,
      action: '„Kleiderschrank (Stange, Fächer, Schubladen)“ wählen.',
      expected: 'Frontansicht mit 2 Spalten (links Stange, rechts Schubladen unten und Fachböden), Badge „passt“, keine Hinweise.',
      async run(t) {
        await right(t).getByLabel('Voreinstellung').selectOption({ label: 'Kleiderschrank (Stange, Fächer, Schubladen)' });
        await t.page.waitForTimeout(300);
        const i = await interior(t);
        const kinds = (c) => i.parts.filter((p) => p.column === c).map((p) => p.kind);
        const b = await badge(t);
        const iss = await issues(t);
        await right(t).getByTestId('interior-front').scrollIntoViewIfNeeded();
        await t.shot('85-front');
        const ok = i.columns === 2 && kinds(0).includes('rod') && kinds(1).includes('drawer') && kinds(1).includes('shelf') && b === 'passt' && iss.length === 0;
        return { status: ok ? 'ok' : 'fail', observed: `Spalten: ${i.columns}; links: ${kinds(0).join(', ')}; rechts: ${kinds(1).join(', ')}; Badge „${b}“; Hinweise: ${iss.length}. Frontansicht: Screenshot 85-front.` };
      },
    },
    {
      nr: 3,
      action: '„+ Schublade“ klicken und deren Höhe auf 8 cm setzen.',
      expected: 'Hinweis „zu niedrig (mindestens 10 cm)“, Teil in der Frontansicht rot, Badge „Hinweis“.',
      async run(t) {
        await right(t).getByRole('button', { name: '+ Schublade' }).click();
        const f = right(t).getByRole('textbox', { name: 'Höhe der Schublade' }).last();
        await f.fill('8');
        await f.press('Enter');
        await t.page.waitForTimeout(300);
        const iss = (await issues(t)).join(' ');
        const b = await badge(t);
        const red = await redParts(t);
        return { status: /zu niedrig/.test(iss) && /10 cm/.test(iss) && /Hinweis/.test(b) && red > 0 ? 'ok' : 'fail', observed: `Hinweis: „${iss}“; Badge „${b}“; rot gezeichnete Teile in der Frontansicht (stroke/fill #dc2626): ${red}.` };
      },
    },
    {
      nr: 4,
      action: 'Höhe wieder auf 20 cm setzen.',
      expected: 'Hinweis verschwindet.',
      async run(t) {
        const f = right(t).getByRole('textbox', { name: 'Höhe der Schublade' }).last();
        await f.fill('20');
        await f.press('Enter');
        await t.page.waitForTimeout(300);
        const hs = (await interior(t)).parts.map((p) => p.h).filter((h) => h != null);
        const iss = await issues(t);
        const b = await badge(t);
        const ok = iss.length === 0 && b === 'passt';
        // Folgeschritte sollen trotzdem prüfbar bleiben: bei dem Fehler die Höhe per Store auf 20 cm setzen
        if (!ok)
          await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => {
            const parts = d.furniture.find((q) => q.id === id).interior.parts;
            parts[parts.length - 1].h = 0.2;
          }), t.fid);
        return { status: ok ? 'ok' : 'fail', observed: `Hinweise: ${iss.length}${iss.length ? ` („${iss.join(' ')}“)` : ''}; Badge „${b}“. Gespeicherte Schubladenhöhen im Projekt (Meter): ${hs.join(', ')} – eingegeben wurden 20 cm, gespeichert ist ${hs[hs.length - 1]} m (= 0,2 cm, Faktor 100 zu klein). Der Eingabewert wird im Panel offenbar zweimal durch 100 geteilt (NumberField liefert schon Meter, InteriorSection teilt nochmal). Für die Folgeschritte habe ich die Höhe danach per Store auf 20 cm gesetzt.` };
      },
    },
    {
      nr: 5,
      action: 'Den Schrank auf eine Tiefe unter 45 cm verkleinern (Maße).',
      expected: 'Hinweis zur Kleiderstange (mindestens 45 cm Tiefe).',
      async run(t) {
        const f = right(t).getByRole('textbox', { name: /^Tiefe/ }).first();
        const before = (await wardrobe(t)).depth;
        await f.fill('40');
        await f.press('Enter');
        await t.page.waitForTimeout(300);
        const iss = (await issues(t)).join(' ');
        const depth = (await wardrobe(t)).depth;
        return { status: depth < 0.45 && /45 cm/.test(iss) && /Stange/i.test(iss) ? 'ok' : 'fail', observed: `Tiefe ${Math.round(before * 100)} → ${Math.round(depth * 100)} cm; Hinweis: „${iss}“.` };
      },
    },
    {
      nr: 6,
      action: '„Schrank geöffnet zeigen (2D und 3D)“ anhaken.',
      expected: '3D: Schrank ohne Türen mit Fachböden, Stange samt Bügeln, herausgezogenen Schubladen. 2D: Trennlinie zwischen den Spalten, Stange als Linie, gestrichelte Schubladen vor dem Schrank.',
      async run(t) {
        // Tiefe wieder normal, damit die Ansicht ohne Hinweis ist
        const f = right(t).getByRole('textbox', { name: /^Tiefe/ }).first();
        await f.fill('60');
        await f.press('Enter');
        const d0 = await dashed2d(t);
        await right(t).getByLabel('Schrank geöffnet zeigen (2D und 3D)').check();
        await t.page.waitForTimeout(400);
        const d1 = await dashed2d(t);
        await t.shot('85-offen-2d');
        const fid = t.fid;
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1500);
        const wf = await wardrobe(t);
        await t.lookAt([wf.x + 1.6, 1.7, wf.y + 1.6], [wf.x, 0.9, wf.y]);
        await t.shot('85-offen-3d');
        return { status: d1 > d0 ? 'look' : 'fail', observed: `2D: gestrichelte Linien/Rechtecke ${d0} → ${d1} nach dem Öffnen. Das Aussehen (Spaltentrennung, Stange, Schubladen vor dem Schrank, 3D ohne Türen mit Bügeln) ist Optik: Screenshots 85-offen-2d und 85-offen-3d.` };
      },
    },
    {
      nr: 7,
      action: 'Projekt speichern und neu laden.',
      expected: 'Aufteilung ist unverändert da.',
      async run(t) {
        const before = JSON.stringify(await interior(t));
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => !!(await interior(t)));
        if (!(await wardrobe(t))?.interior) return { status: 'fail', observed: `Nach dem Neuladen keine Aufteilung. Möbel: ${(await t.project()).furniture.map((f) => f.name).join(', ')}. Vorher: ${before.slice(0, 80)}` };
        const after = JSON.stringify(await interior(t));
        return { status: before === after ? 'ok' : 'fail', observed: `Aufteilung vor und nach dem Neuladen gleich: ${before === after} (${(await interior(t)).parts.length} Teile, ${(await interior(t)).columns} Spalten). Gespeichert wird automatisch.` };
      },
    },
    {
      nr: 8,
      action: '„Aufteilung entfernen“ klicken.',
      expected: 'Gruppe wieder „nicht geplant“, Schrank in 2D/3D wie vorher.',
      async run(t) {
        await sel(t, { type: 'furniture', id: t.fid });
        const g = right(t).getByText('Innenaufteilung', { exact: true }).first();
        await g.waitFor();
        if (!(await right(t).getByRole('button', { name: 'Aufteilung entfernen' }).isVisible())) await g.click();
        await right(t).getByRole('button', { name: 'Aufteilung entfernen' }).click();
        await t.page.waitForTimeout(300);
        const b = await badge(t);
        const gone = !(await interior(t));
        return { status: b === 'nicht geplant' && gone ? 'ok' : 'fail', observed: `Badge „${b}“; Aufteilung im Projekt entfernt: ${gone}. Dass der Schrank in 2D/3D wie vorher aussieht, wurde nicht per Bild verglichen.` };
      },
    },
  ],
};
