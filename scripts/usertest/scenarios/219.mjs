// Kleine Objekte auf Tisch und Möbel stellen (#219) – Testschritte aus dem Kommentar in #219.
const byName = async (t, name) => (await t.project()).furniture.find((f) => f.name === name);
const markers = (t) =>
  t.page.evaluate(() => {
    const out = [];
    window.__wp.three?.scene.traverse((o) => typeof o.name === 'string' && /^collision(-issue)?:/.test(o.name) && out.push(o.name));
    return out;
  });

/** Add a catalog item with a click and put it at (x, y) on the floor of the emptied room. */
async function add(t, search, title, x, y) {
  const { page } = t;
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
  await page.getByLabel('Katalog durchsuchen').fill(search);
  const before = (await t.project()).furniture.length;
  await page.locator('.catalog-item', { hasText: title }).first().click();
  await t.poll(async () => ((await t.project()).furniture.length > before ? 1 : null), 5000);
  const f = (await t.project()).furniture.at(-1);
  await page.evaluate(([id, px, py]) => window.__wp.useProjectStore.getState().apply((d) => { const g = d.furniture.find((q) => q.id === id); g.x = px; g.y = py; g.elevation = 0; }), [f.id, x, y]);
  return f.id;
}
async function drag(t, id, to, alt = false) {
  const f = (await t.project()).furniture.find((q) => q.id === id);
  const a = await t.planToScreen(f.x, f.y);
  const b = await t.planToScreen(to.x, to.y);
  await t.page.mouse.move(a.x, a.y);
  await t.page.mouse.down();
  await t.page.mouse.move(b.x, b.y, { steps: 12 });
  await t.page.mouse.up();
  return (await t.project()).furniture.find((q) => q.id === id);
}

export default {
  issue: 219,
  name: 'Kleine Objekte auf Möbeln',
  title: 'Kleine Objekte (z. B. Boxen) lassen sich nicht auf Tische und Möbel stellen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Aus dem Katalog „Esstisch 4 Personen“ in den Raum ziehen, daneben „Aufbewahrungsbox“ auf den freien Boden ziehen.',
      expected: 'Die Box steht auf dem Boden (Höhe über Boden 0 cm).',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void (d.furniture = [])));
        t.table = await add(t, 'Esstisch', 'Esstisch 4 Personen', 2.5, 2.0);
        t.box = await add(t, 'Aufbewahrungsbox', 'Aufbewahrungsbox', 4.0, 2.0);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await page.waitForTimeout(500);
        const box = await byName(t, 'Aufbewahrungsbox');
        const table = await byName(t, 'Esstisch 4 Personen');
        t.tableH = table.height;
        await t.shot('Tisch und Box auf dem Boden');
        return { status: box && table && box.elevation === 0 ? 'ok' : 'fail', observed: `Box „${box?.name}“ ${(box?.width * 100).toFixed(0)}×${(box?.depth * 100).toFixed(0)}×${(box?.height * 100).toFixed(0)} cm, Höhe über Boden ${(box?.elevation * 100).toFixed(0)} cm; Tisch Höhe ${(table?.height * 100).toFixed(0)} cm.` };
      },
    },
    {
      nr: 2,
      action: 'Die Box im 2D-Plan auf die Tischplatte ziehen und loslassen.',
      expected: 'Die Box steht auf der Tischplatte (Höhe über Boden 75 cm), weder Tisch noch Box sind als Kollision markiert.',
      async run(t) {
        const table = await byName(t, 'Esstisch 4 Personen');
        const box = await drag(t, t.box, { x: table.x, y: table.y });
        // the properties panel of a selected, marked item shows the reason
        const summary = await t.page.locator('.panel.right').getByTestId('conflict-summary').count();
        await t.shot('Box auf der Tischplatte');
        t.onTable = box.elevation;
        return { status: Math.abs(box.elevation - table.height) < 0.011 && Math.abs(box.elevation - 0.75) < 0.011 && summary === 0 ? 'ok' : 'fail', observed: `Höhe über Boden ${(box.elevation * 100).toFixed(1)} cm (Tischhöhe ${(table.height * 100).toFixed(0)} cm); Konflikt-Hinweis im Panel: ${summary === 0 ? 'keiner' : 'ja'}.` };
      },
    },
    {
      nr: 3,
      action: 'In die 3D-Ansicht wechseln.',
      expected: 'Die Box steht sichtbar auf dem Tisch.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const m = await markers(t);
        const box = await byName(t, 'Aufbewahrungsbox');
        const table = await byName(t, 'Esstisch 4 Personen');
        await page.waitForTimeout(1200);
        await t.shot('3D: Box auf dem Tisch');
        // box centre projected on screen sits above the tabletop: elevation in the model is the evidence
        return { status: Math.abs(box.elevation - table.height) < 0.011 && m.length === 0 ? 'ok' : 'fail', observed: `3D: Box-Unterkante auf ${(box.elevation * 100).toFixed(1)} cm = Tischplatte; Kollisionsmarkierungen in der Szene: ${m.length ? m.join(', ') : 'keine'}.` };
      },
    },
    {
      nr: 4,
      action: 'Die Box in 3D vom Tisch herunter auf den freien Boden ziehen.',
      expected: 'Die Box steht wieder auf dem Boden (Höhe 0 cm).',
      async run(t) {
        const { page } = t;
        const box = await byName(t, 'Aufbewahrungsbox');
        const table = await byName(t, 'Esstisch 4 Personen');
        const a = await t.worldToScreen(box.x, box.elevation + box.height, box.y);
        const b = await t.worldToScreen(table.x + 1.6, 0, table.y);
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw new Error(`Bildschirmposition nicht berechenbar: ${JSON.stringify({ a, b, box: [box.x, box.elevation, box.height, box.y] })}`);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const after = await byName(t, 'Aufbewahrungsbox');
        return { status: after.elevation === 0 && Math.abs(after.x - box.x) > 0.5 ? 'ok' : 'fail', observed: `Nach dem Ziehen: x ${box.x.toFixed(2)} → ${after.x.toFixed(2)} m, Höhe über Boden ${(after.elevation * 100).toFixed(1)} cm.` };
      },
    },
    {
      nr: 5,
      action: '„Sofa 2-Sitzer“ in den Raum ziehen und auf den Tisch zu ziehen.',
      expected: 'Das Sofa bleibt auf dem Boden und stoppt am Tisch, es wird nicht auf den Tisch gestellt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const table = await byName(t, 'Esstisch 4 Personen');
        const sid = await add(t, 'Sofa', 'Sofa 2-Sitzer', table.x - 2.0, table.y);
        t.sofa = sid;
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        const sofa = await drag(t, sid, { x: table.x, y: table.y });
        const stops = Math.abs(sofa.x - table.x) >= (sofa.width + table.width) / 2 - 0.01 || Math.abs(sofa.y - table.y) >= (sofa.depth + table.depth) / 2 - 0.01 || Math.abs(sofa.x - table.x) >= (sofa.depth + table.width) / 2 - 0.01;
        await t.shot('Sofa stoppt am Tisch');
        return { status: sofa.elevation === 0 && stops && Math.hypot(sofa.x - table.x, sofa.y - table.y) > 0.5 ? 'ok' : 'fail', observed: `Sofa Höhe über Boden ${(sofa.elevation * 100).toFixed(0)} cm, Mitte (${sofa.x.toFixed(2)}, ${sofa.y.toFixed(2)}) m; Tisch (${table.x.toFixed(2)}, ${table.y.toFixed(2)}) m, Abstand der Mitten ${Math.hypot(sofa.x - table.x, sofa.y - table.y).toFixed(2)} m (Überlappung ausgeschlossen: ${stops}).` };
      },
    },
    {
      nr: 6,
      action: 'Die Box wieder auf den Tisch ziehen, Projekt speichern und neu laden.',
      expected: 'Die Box steht nach dem Laden weiterhin auf der Tischplatte.',
      async run(t) {
        const { page } = t;
        const table = await byName(t, 'Esstisch 4 Personen');
        const box = await drag(t, t.box, { x: table.x, y: table.y });
        await page.getByText('Gespeichert').waitFor({ timeout: 8000 });
        await page.waitForTimeout(1500);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const b2 = await byName(t, 'Aufbewahrungsbox');
        return { status: box.elevation > 0.7 && b2 && Math.abs(b2.elevation - table.height) < 0.011 ? 'ok' : 'fail', observed: `Vor dem Neuladen Höhe ${(box.elevation * 100).toFixed(1)} cm, nach dem Neuladen ${(b2?.elevation * 100).toFixed(1)} cm (Tischplatte ${(table.height * 100).toFixed(0)} cm).` };
      },
    },
    {
      nr: 7,
      optional: true,
      action: 'Optional: „Barhocker“ unter den Tisch ziehen.',
      expected: 'Der Hocker bleibt auf dem Boden unter dem Tisch und springt nicht auf die Tischplatte.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        const table = await byName(t, 'Esstisch 4 Personen');
        const hid = await add(t, 'Barhocker', 'Barhocker', table.x + 2.0, table.y + 1.2);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        const h = await drag(t, hid, { x: table.x + 0.4, y: table.y });
        return { status: h.elevation === 0 ? 'ok' : 'fail', observed: `Barhocker Höhe über Boden ${(h.elevation * 100).toFixed(0)} cm, Mitte (${h.x.toFixed(2)}, ${h.y.toFixed(2)}) m; Tisch (${table.x.toFixed(2)}, ${table.y.toFixed(2)}).` };
      },
    },
  ],
};
