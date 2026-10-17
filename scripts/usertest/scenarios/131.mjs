// Katalog per Drag and Drop in den Plan (#131) – Testschritte aus dem Kommentar in #131.
const NAME = 'Zimmerpflanze groß';
const svg = (t) => t.page.locator('[data-testid="editor2d"] svg');
const entry = (t) => t.page.locator('.catalog-item', { hasText: NAME });
const ghost = (t) =>
  t.page
    .getByTestId('drop-ghost')
    .evaluate((g) => ({ stroke: g.getAttribute('stroke'), pts: g.getAttribute('points').split(' ').map((p) => p.split(',').map(Number)) }))
    .catch(() => null);
const plants = async (t) => (await t.project()).furniture.filter((f) => f.name === NAME);
const toast = (t, re) => t.page.locator('.toast').filter({ hasText: re });
const bbox = (g) => ({ x0: Math.min(...g.pts.map((p) => p[0])), x1: Math.max(...g.pts.map((p) => p[0])), y0: Math.min(...g.pts.map((p) => p[1])), y1: Math.max(...g.pts.map((p) => p[1])) });
const cm = (v) => Math.round(v * 100);
const de = (v, n) => v.toFixed(n).replace('.', ',');

/** Start dragging the catalog entry with the real mouse (HTML drag and drop) and move to plan point (x, y). */
async function startDrag(t, x, y) {
  const e = await entry(t).boundingBox();
  await t.page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await t.page.mouse.down();
  await t.page.mouse.move(e.x + e.width / 2 + 20, e.y + e.height / 2, { steps: 3 });
  await moveTo(t, x, y);
}
/** A point inside the 2D drawing area but left of all rooms (12 px from the left edge, like the e2e test). */
async function outside(t) {
  const b = await svg(t).boundingBox();
  return { x: b.x + 12, y: b.y + b.height / 2 };
}
async function moveTo(t, x, y) {
  await moveScreen(t, await t.planToScreen(x, y));
}
/** Chromium delivers dragover one mouse step late, so rest on the target with two tiny extra moves. */
async function moveScreen(t, s) {
  await t.page.mouse.move(s.x, s.y, { steps: 8 });
  for (const dx of [1, 0]) {
    await t.page.waitForTimeout(120);
    await t.page.mouse.move(s.x + dx, s.y);
  }
  await t.page.waitForTimeout(250);
}
/** Inner face of the north wall of the living room (plan y). */
async function northInner(t) {
  const p = await t.project();
  const node = (id) => p.nodes.find((n) => n.id === id);
  const top = p.walls.map((w) => ({ w, a: node(w.a), b: node(w.b) })).filter(({ a, b }) => Math.abs(a.y - b.y) < 1e-6 && a.y === Math.min(...p.nodes.map((n) => n.y)));
  return top[0].a.y + top[0].w.thickness / 2;
}

export default {
  issue: 131,
  name: 'Katalog per Drag and Drop',
  title: 'Produkte aus dem Katalog per Drag and Drop in den Plan ziehen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im Katalog einen Eintrag (z. B. „Zimmerpflanze groß“ oder „Sofa 3-Sitzer“) mit gedrückter linker Maustaste greifen und in einen Raum im 2D-Plan ziehen, noch nicht loslassen.',
      expected: 'Unter dem Mauszeiger erscheint ein gestrichelter blauer Umriss in der Größe des Produkts. Nahe an einer Wand springt er an die Wand.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
        await page.getByLabel('Katalog durchsuchen').fill('Zimmerpflanze');
        t.before = (await plants(t)).length;
        await startDrag(t, 2.5, 2.0);
        const g = await ghost(t);
        await t.shot('Umriss beim Ziehen mitten im Raum');
        const inner = await northInner(t);
        await moveTo(t, 4.4, inner + 0.3); // free stretch of the north wall (the TV lowboard stands further left)
        const gw = await ghost(t);
        await t.shot('Umriss nahe der Nordwand');
        t.dragging = true;
        const b = g && bbox(g);
        const bw = gw && bbox(gw);
        const centred = b && Math.abs((b.x0 + b.x1) / 2 - 2.5) < 0.06 && Math.abs((b.y0 + b.y1) / 2 - 2.0) < 0.06;
        const snapped = bw && Math.abs(bw.y0 - inner) < 0.005;
        return {
          status: g?.stroke === '#2563eb' && centred && snapped ? 'ok' : 'fail',
          observed: g ? `Beim Ziehen erscheint ein ${g.stroke === '#2563eb' ? 'blauer' : `andersfarbiger (${g.stroke})`} gestrichelter Umriss ${cm(b.x1 - b.x0)} × ${cm(b.y1 - b.y0)} cm ${centred ? 'unter dem Mauszeiger' : 'nicht unter dem Mauszeiger'}. Mit dem Mauszeiger 30 cm vor der Nordwand liegt der Umriss ${bw ? `${cm(bw.y0 - inner)} cm vor der Wand – ${snapped ? 'an die Wand gesprungen' : 'nicht an die Wand gesprungen'}` : 'nicht mehr vor'}.` : 'Beim Ziehen erscheint kein Umriss.',
          noFinalShot: true,
        };
      },
    },
    {
      nr: 2,
      action: 'Die Maus über eine Stelle außerhalb aller Räume bewegen (noch gedrückt).',
      expected: 'Der Umriss wird rot.',
      async run(t) {
        const o = await outside(t);
        await moveScreen(t, o);
        const g = await ghost(t);
        return {
          status: g?.stroke === '#dc2626' ? 'ok' : 'fail',
          observed: `Mauszeiger am linken Rand der Zeichenfläche, links neben der Wohnung: Umriss ${g ? (g.stroke === '#dc2626' ? 'rot' : `nicht rot (${g.stroke})`) : 'nicht zu sehen'}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Zurück in den Raum ziehen und loslassen.',
      expected: 'Das Produkt steht genau dort, wo der blaue Umriss war (im Raster eingerastet bzw. an der Wand), ist ausgewählt, und rechts erscheinen seine Eigenschaften. Unten kommt der Hinweis „… platziert.“',
      async run(t) {
        const { page } = t;
        await moveTo(t, 2.51, 2.06);
        const g = await ghost(t);
        await page.mouse.up();
        const list = await t.poll(async () => {
          const l = await plants(t);
          return l.length === t.before + 1 ? l : null;
        }, 4000);
        const f = list?.at(-1);
        const b = g && bbox(g);
        const same = f && b && Math.abs(f.x - (b.x0 + b.x1) / 2) < 0.002 && Math.abs(f.y - (b.y0 + b.y1) / 2) < 0.002;
        const selected = f && (await t.selection())?.id === f.id;
        const props = f ? await page.locator('.panel.right').locator('input').first().inputValue().catch(() => '') : '';
        const hint = await toast(t, /platziert\./).waitFor({ timeout: 3000 }).then(() => true, () => false);
        t.placed = f;
        return {
          status: same && selected && props === NAME && hint && (await page.getByTestId('drop-ghost').count()) === 0 ? 'ok' : 'fail',
          observed: f ? `Losgelassen bei x 2,51 m / y 2,06 m: „${NAME}“ steht bei x ${de(f.x, 2)} m / y ${de(f.y, 2)} m (5-cm-Raster) – ${same ? 'genau wo der blaue Umriss war' : `nicht wo der Umriss war (Umriss-Mitte ${b ? `${((b.x0 + b.x1) / 2).toFixed(3)} / ${((b.y0 + b.y1) / 2).toFixed(3)}` : 'fehlt'})`}. Ausgewählt: ${selected ? 'ja' : 'nein'}, rechts im Namensfeld: „${props}“. Hinweis „… platziert.“: ${hint ? 'ja' : 'nein'}.` : 'Nach dem Loslassen wurde nichts hinzugefügt.',
        };
      },
    },
    {
      nr: 4,
      action: 'Strg+Z drücken.',
      expected: 'Das abgelegte Produkt verschwindet wieder (ein Rückgängig-Schritt).',
      async run(t) {
        await t.page.keyboard.press('Control+z');
        const n = await t.poll(async () => ((await plants(t)).length === t.before ? t.before : null), 3000);
        return { status: n === t.before ? 'ok' : 'fail', observed: `Nach einem Strg+Z: ${(await plants(t)).length} × „${NAME}“ (vorher ${t.before}) – ${n === t.before ? 'wieder weg' : 'noch da'}.` };
      },
    },
    {
      nr: 5,
      action: 'Das Produkt erneut ziehen, aber außerhalb eines Raums loslassen.',
      expected: 'Nichts wird hinzugefügt, es erscheint der Hinweis „… nicht abgelegt – bitte in einen Raum ziehen.“',
      async run(t) {
        await startDrag(t, 2.5, 2.0);
        const o = await outside(t);
        await moveScreen(t, o);
        await t.page.mouse.up();
        const hint = await toast(t, /nicht abgelegt – bitte in einen Raum ziehen/).waitFor({ timeout: 3000 }).then(() => true, () => false);
        const n = (await plants(t)).length;
        return {
          status: hint && n === t.before ? 'ok' : 'fail',
          observed: `Außerhalb losgelassen: ${n === t.before ? 'nichts hinzugefügt' : 'trotzdem hinzugefügt'}. Hinweis „… nicht abgelegt – bitte in einen Raum ziehen.“: ${hint ? 'ja' : 'nein'}.`,
        };
      },
    },
    {
      nr: 6,
      action: 'Das Produkt beim Loslassen mit gedrückter Alt-Taste nahe an eine Wand ziehen.',
      expected: 'Es bleibt genau an der Mausposition und rastet nicht an der Wand ein.',
      async run(t) {
        const { page } = t;
        const inner = await northInner(t);
        const target = { x: 4.37, y: inner + 0.33 }; // off the 5 cm grid, 8 cm gap to the wall
        await startDrag(t, target.x, target.y);
        await page.keyboard.down('Alt');
        const s = await t.planToScreen(target.x, target.y);
        await page.mouse.move(s.x + 1, s.y, { steps: 2 });
        await page.mouse.move(s.x, s.y, { steps: 2 });
        await page.waitForTimeout(200);
        await page.mouse.up();
        await page.keyboard.up('Alt');
        const f = await t.poll(async () => {
          const l = await plants(t);
          return l.length === t.before + 1 ? l.at(-1) : null;
        }, 4000);
        const scale = await page.evaluate(() => window.__wp.useUiStore.getState().view2d.zoom);
        const tol = 1.5 / scale + 0.002; // one or two screen pixels
        const exact = f && Math.abs(f.x - target.x) < tol && Math.abs(f.y - target.y) < tol;
        return {
          status: exact ? 'ok' : 'fail',
          observed: f ? `Mit Alt losgelassen bei x ${de(target.x, 2)} / y ${de(target.y, 2)} m (Pflanze 8 cm vor der Wand): steht bei x ${de(f.x, 3)} / y ${de(f.y, 3)} m – ${exact ? 'genau an der Mausposition, nicht an der Wand eingerastet' : 'nicht an der Mausposition'} (Abstand zur Wand ${cm(f.y - 0.25 - inner)} cm).` : 'Mit Alt losgelassen: nichts hinzugefügt.',
        };
      },
    },
    {
      nr: 7,
      action: 'Ein Produkt aus dem Katalog in die 3D-Ansicht auf den Boden eines Raums ziehen und loslassen.',
      expected: 'Es steht an der Stelle auf dem Boden, auf die die Maus zeigte, und ist ausgewählt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        const canvas = page.locator('[data-testid="scene3d"] canvas');
        await canvas.waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        const n0 = (await plants(t)).length;
        const cb = await canvas.boundingBox();
        const s = await t.worldToScreen(2.5, 0, 2);
        await entry(t).dragTo(canvas, { targetPosition: { x: s.x - cb.x, y: s.y - cb.y } });
        const f = await t.poll(async () => {
          const l = await plants(t);
          return l.length === n0 + 1 ? l.at(-1) : null;
        }, 5000);
        const d = f ? Math.hypot(f.x - 2.5, f.y - 2) : null;
        const selected = f && (await t.selection())?.id === f.id;
        return {
          status: f && d < 0.1 && selected ? 'ok' : 'fail',
          observed: f ? `In 3D auf den Wohnzimmerboden bei x 2,50 / y 2,00 m gezogen: steht bei x ${de(f.x, 2)} / y ${de(f.y, 2)} m (${cm(d)} cm daneben), ausgewählt: ${selected ? 'ja' : 'nein'}.` : 'In 3D losgelassen: nichts hinzugefügt.',
        };
      },
    },
    {
      nr: 8,
      action: 'Einen Katalogeintrag wie bisher nur anklicken.',
      expected: 'Er wird wie früher zum Plan hinzugefügt.',
      async run(t) {
        const n0 = (await plants(t)).length;
        await entry(t).click();
        const f = await t.poll(async () => {
          const l = await plants(t);
          return l.length === n0 + 1 ? l.at(-1) : null;
        }, 4000);
        const selected = f && (await t.selection())?.id === f.id;
        return {
          status: f && selected ? 'ok' : 'fail',
          observed: f ? `Nach einem Klick auf den Eintrag: „${NAME}“ hinzugefügt (bei x ${de(f.x, 2)} / y ${de(f.y, 2)} m) und ausgewählt: ${selected ? 'ja' : 'nein'}.` : 'Ein Klick fügt nichts hinzu.',
        };
      },
    },
  ],
};
