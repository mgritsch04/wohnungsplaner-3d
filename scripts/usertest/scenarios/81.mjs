// Anschlüsse planen: Wasser und Abwasser (#81) – Testschritte aus dem Kommentar in #81.
import { expect } from '@playwright/test';

const right = (t) => t.page.locator('.panel.right');
const buttons = (t) => t.page.getByTestId('fixture-buttons');
const fixtures = async (t) => (await t.project()).fixtures;
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
async function nearWall(t, edge, along = 0.5) {
  const p = await t.project();
  const pts = p.rooms[0].nodeIds.map((id) => p.nodes.find((n) => n.id === id));
  const a = pts[edge % pts.length];
  const b = pts[(edge + 1) % pts.length];
  const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  const m = { x: a.x + (b.x - a.x) * along, y: a.y + (b.y - a.y) * along };
  const l = Math.hypot(c.x - m.x, c.y - m.y);
  return { x: m.x + ((c.x - m.x) / l) * 0.25, y: m.y + ((c.y - m.y) / l) * 0.25 };
}
/** Index of the wall of the first room with the most free space in front of it (no furniture within 1 m at 30–70 % of its length). */
async function freeEdge(t) {
  const p = await t.project();
  let best = 0;
  let bestD = -1;
  for (let e = 0; e < p.rooms[0].nodeIds.length; e++) {
    let minDist = Infinity;
    for (const al of [0.3, 0.5, 0.7]) {
      const q = await nearWall(t, e, al);
      for (const f of p.furniture) minDist = Math.min(minDist, Math.hypot(q.x - f.x, q.y - f.y) - Math.max(f.width, f.depth) / 2);
    }
    if (minDist > bestD) {
      bestD = minDist;
      best = e;
    }
  }
  return best;
}
async function place(t, label, at) {
  await buttons(t).getByRole('button', { name: `+ ${label}`, exact: true }).click();
  await t.page.getByTestId('fixture-placing').waitFor();
  const s = await t.planToScreen(at.x, at.y);
  await t.page.mouse.click(s.x, s.y);
  await expect(t.page.getByTestId('fixture-placing')).toHaveCount(0);
}
/** Put a catalog item into the plan (click in the catalog) and move it to (x, y) like a drag would. */
async function furnitureAt(t, catalogName, x, y, rotation, elevation) {
  const { page } = t;
  await page.locator('.panel.left').getByRole('button', { name: 'Katalog', exact: true }).click();
  await page.getByPlaceholder(/Suchen/).fill(catalogName);
  const before = (await t.project()).furniture.map((f) => f.id);
  await page.locator('.panel.left').getByText(catalogName, { exact: false }).first().click();
  const f = await t.poll(async () => (await t.project()).furniture.find((q) => !before.includes(q.id)), 4000);
  await page.evaluate(([id, px, py, rot, el]) => {
    window.__wp.useProjectStore.getState().apply((d) => {
      const q = d.furniture.find((z) => z.id === id);
      q.x = px;
      q.y = py;
      q.rotation = rot;
      if (el !== null) q.elevation = el;
    });
  }, [f.id, x, y, rotation, elevation ?? null]);
  return f.id;
}
/** Number of orange/red outlined shapes in the 2D plan (furniture conflicts; the narrow-passage markers are not counted). */
const marks = (t) =>
  t.page.locator('[data-testid="editor2d"] svg').evaluate(
    (svg) => [...svg.querySelectorAll('*')].filter((e) => !e.closest('[data-testid="narrow-passages"]') && ['rgb(217, 119, 6)', 'rgb(220, 38, 38)'].includes(getComputedStyle(e).stroke)).length,
  );
const in3d = (t) =>
  t.page.evaluate(() => {
    const ids = new Set();
    window.__wp.three.scene.traverse((o) => typeof o.userData?.fixtureId === 'string' && ids.add(o.userData.fixtureId));
    return [...ids];
  });

export default {
  issue: 81,
  name: 'Wasser- und Abwasseranschlüsse',
  title: 'Anschlüsse planen: Wasser und Abwasser für Küche und Bad markieren',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links „Werkzeuge“ › „Steckdosen & Anschlüsse“ aufklappen, „+ Wasseranschluss“ wählen und an eine freie Wand klicken.',
      expected: 'Ein blauer Tropfen sitzt an der Wand, rechts „Höhe 55 cm“.',
      async run(t) {
        await t.freshStart();
        await t.page.locator('.panel.left').getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();
        t.edge = await freeEdge(t);
        await place(t, 'Wasseranschluss', await nearWall(t, t.edge, 0.5));
        const f = (await fixtures(t))[0];
        t.water = f;
        const props = await t.page.getByTestId('fixture-props').innerText();
        const color = await t.page.locator(`[data-fixture-id="${f.id}"] *`).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill') || e.getAttribute('stroke')).filter((c) => c && c !== 'none' && c !== '#ffffff'))]);
        const h = await t.page.getByTestId('fixture-props').getByRole('textbox', { name: /^Höhe/ }).inputValue();
        await t.shot('Wasseranschluss');
        return { status: f.kind === 'water' && Math.round(f.elevation * 100) === 55 && h === '55' ? 'ok' : 'fail', observed: `Wasseranschluss gesetzt, Höhe ${h} cm, Farben im Symbol: ${color.join(', ')} (ob es ein „blauer Tropfen“ ist, zeigt das Bild; Eigenschaften: ${props.replace(/\n+/g, ' | ').slice(0, 60)}).` };
      },
    },
    {
      nr: 2,
      action: 'Daneben mit „+ Abwasseranschluss“ einen Abfluss setzen.',
      expected: 'Graues Symbol mit Pfeil nach unten, Höhe 45 cm.',
      async run(t) {
        await place(t, 'Abwasseranschluss', await nearWall(t, t.edge, 0.7));
        const f = (await fixtures(t)).find((x) => x.kind === 'drain');
        t.waste = f;
        const h = await t.page.getByTestId('fixture-props').getByRole('textbox', { name: /^Höhe/ }).inputValue();
        const colors = await t.page.locator(`[data-fixture-id="${f?.id}"] *`).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill') || e.getAttribute('stroke')).filter((c) => c && c !== 'none' && c !== '#ffffff'))]);
        return { status: f && Math.round(f.elevation * 100) === 45 && h === '45' ? 'ok' : 'fail', observed: `Abwasseranschluss („${f?.kind}“) gesetzt, Höhe ${h} cm, Symbolfarben ${colors.join(', ')}; die Form (Pfeil nach unten) ist im Bild zu sehen.` };
      },
    },
    {
      nr: 3,
      action: 'Beide entlang der Wand ziehen.',
      expected: 'Sie bleiben an der Wand und lassen sich verschieben.',
      async run(t) {
        const { page } = t;
        const out = [];
        for (const f0 of [t.water, t.waste]) {
          const f = (await fixtures(t)).find((x) => x.id === f0.id);
          const pr = await t.project();
          const pts = pr.rooms[0].nodeIds.map((id) => pr.nodes.find((n) => n.id === id));
          const ea = pts[t.edge % pts.length];
          const eb = pts[(t.edge + 1) % pts.length];
          const el = Math.hypot(eb.x - ea.x, eb.y - ea.y);
          const dir = { x: (eb.x - ea.x) / el, y: (eb.y - ea.y) / el }; // along the wall
          const knob = page.locator(`[data-fixture-id="${f.id}"] circle[fill="#ffffff"]`);
          const kb = await knob.boundingBox();
          const from = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };
          const s0 = await t.planToScreen(f.x, f.y);
          const s1 = await t.planToScreen(f.x - dir.x * 0.3, f.y - dir.y * 0.3);
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + ((s1.x - s0.x) * i) / 5, from.y + ((s1.y - s0.y) * i) / 5 + (i % 2 ? 5 : -5));
          await page.mouse.up();
          const g = (await fixtures(t)).find((x) => x.id === f.id);
          const along = Math.abs((g.x - f.x) * -dir.y + (g.y - f.y) * dir.x); // sideways drift off the wall line
          out.push({ moved: Math.round(Math.hypot(g.x - f.x, g.y - f.y) * 100), off: Math.round(along * 100), rot: Math.abs(g.rotation - f.rotation) < 1e-6 });
        }
        t.water = (await fixtures(t)).find((x) => x.id === t.water.id);
        t.waste = (await fixtures(t)).find((x) => x.id === t.waste.id);
        return { status: out.every((o) => o.moved >= 25 && o.moved <= 60 && o.off <= 3 && o.rot) ? 'ok' : 'fail', observed: `Wasseranschluss ${out[0].moved} cm, Abwasseranschluss ${out[1].moved} cm an der Wand entlang verschoben (Abweichung von der Wandlinie ${out[0].off}/${out[1].off} cm, Drehung unverändert).` };
      },
    },
    {
      nr: 4,
      action: 'Aus dem Katalog eine Kommode oder ein Regal direkt vor den Wasseranschluss ziehen.',
      expected: 'Das Möbel wird orange markiert; rechts beim Möbel steht „steht vor einem Wasseranschluss“, beim Anschluss „Orange markiert: davor steht …“.',
      async run(t) {
        const w = t.water;
        const x = w.x - Math.sin(w.rotation) * 0.25;
        const y = w.y + Math.cos(w.rotation) * 0.25;
        const id = await furnitureAt(t, 'Kommode', x, y, w.rotation, 0);
        t.board = id;
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(600);
        await sel(t, { type: 'furniture', id });
        await t.page.mouse.move(2, 2);
        const panelTxt = await right(t).innerText();
        await t.page.mouse.move(2, 2);
        const orange = (await marks(t)) > 0;
        await t.page.locator(`[data-fixture-id="${w.id}"] circle[fill="#ffffff"]`).click({ force: true });
        const fixTxt = await t.page.getByTestId('fixture-props').innerText();
        await t.shot('Kommode vor dem Wasseranschluss');
        return { status: orange && /steht vor einem Wasseranschluss/.test(panelTxt) && /Orange markiert: davor steht/.test(fixTxt) ? 'ok' : 'fail', observed: `Kommode direkt vor dem Anschluss (per Katalog-Klick eingefügt und dorthin gesetzt, nicht per Maus gezogen): im Plan orange/rot markiert: ${orange}; Möbel-Panel „steht vor einem Wasseranschluss“: ${/steht vor einem Wasseranschluss/.test(panelTxt)}; Anschluss-Panel „Orange markiert: davor steht …“: ${/Orange markiert: davor steht/.test(fixTxt)}.` };
      },
    },
    {
      nr: 5,
      action: 'Stattdessen eine Spüle (Küche) oder einen Waschtisch (Bad) vor den Anschluss stellen.',
      expected: 'Keine Markierung – diese Möbel gehören an den Anschluss.',
      async run(t) {
        const w = t.water;
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => (d.furniture = d.furniture.filter((f) => f.id !== id))), t.board);
        const x = w.x - Math.sin(w.rotation) * 0.25;
        const y = w.y + Math.cos(w.rotation) * 0.25;
        const id = await furnitureAt(t, 'Waschtisch 60 cm', x, y, w.rotation, 0);
        await t.page.mouse.move(2, 2);
        const orange = (await marks(t)) > 0;
        await sel(t, { type: 'furniture', id });
        const txt = await right(t).innerText();
        t.basin = id;
        const why = (txt.match(/(ragt|steht|überschneidet|kollidiert)[^\n]*/g) ?? []).join(' | ');
        return { status: !/Wasseranschluss/.test(txt) && (!orange || /ragt|überschneidet|kollidiert|steht/.test(why)) ? 'ok' : 'fail', observed: `Waschtisch vor dem Anschluss: Hinweis „steht vor einem Wasseranschluss“: ${/steht vor einem Wasseranschluss/.test(txt)}; andere Hinweise im Panel: ${why || 'keine'}; orange Markierung im Plan: ${orange}.` };
      },
    },
    {
      nr: 6,
      action: 'Einen Hängeschrank über den Anschluss hängen.',
      expected: 'Keine Markierung.',
      async run(t) {
        const w = t.water;
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => (d.furniture = d.furniture.filter((f) => f.id !== id))), t.basin);
        const x = w.x - Math.sin(w.rotation) * 0.2;
        const y = w.y + Math.cos(w.rotation) * 0.2;
        const id = await furnitureAt(t, 'Oberschrank 60 cm', x, y, w.rotation, null);
        const f = await t.furniture((q) => q.id === id);
        await t.page.mouse.move(2, 2);
        const orange = (await marks(t)) > 0;
        await sel(t, { type: 'furniture', id });
        const txt = await right(t).innerText();
        const why = (txt.match(/(ragt|steht|überschneidet|kollidiert)[^\n]*/g) ?? []).join(' | ');
        return { status: f.elevation > 1 && !/Wasseranschluss/.test(txt) && (!orange || /ragt|überschneidet|kollidiert|steht/.test(why)) ? 'ok' : 'fail', observed: `Oberschrank (Höhe ab Boden ${Math.round(f.elevation * 100)} cm) über dem Anschluss: Hinweis „steht vor einem Wasseranschluss“: ${/steht vor einem Wasseranschluss/.test(txt)}; andere Hinweise im Panel: ${why || 'keine'}; orange Markierung im Plan: ${orange}.` };
      },
    },
    {
      nr: 7,
      action: 'In 3D bzw. beim Begehen hinsehen.',
      expected: 'Wasseranschluss (Eckventil) und Abfluss (grauer Stutzen) sind an der Wand in ihrer Höhe sichtbar.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        const over = await in3d(t);
        const pos = await page.evaluate((ids) => {
          const out = {};
          window.__wp.three.scene.traverse((o) => {
            if (ids.includes(o.userData?.fixtureId)) out[o.userData.fixtureId] = o.getWorldPosition(window.__wp.three.camera.position.clone()).y;
          });
          return out;
        }, [t.water.id, t.waste.id]);
        // Nahaufnahme: von der Raummitte aus auf Wasseranschluss und Abfluss schauen
        const pr = await t.project();
        const room = pr.rooms[0];
        const pts = room.nodeIds.map((id) => pr.nodes.find((n) => n.id === id));
        const cen = { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length };
        for (const [label, fx] of [['Wasseranschluss', t.water], ['Abwasseranschluss', t.waste]]) {
          const f = (await fixtures(t)).find((q) => q.id === fx.id);
          const l = Math.hypot(cen.x - f.x, cen.y - f.y) || 1;
          await t.lookAt({ x: f.x + ((cen.x - f.x) / l) * 1.1, y: (f.elevation ?? 0.5) + 0.4, z: f.y + ((cen.y - f.y) / l) * 1.1 }, { x: f.x, y: f.elevation ?? 0.5, z: f.y });
          await page.waitForTimeout(500);
          await t.shot(`Nahaufnahme ${label}`);
        }
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(1200);
        const walk = await in3d(t);
        await t.shot('Begehen: Anschlüsse an der Wand');
        const ok = over.includes(t.water.id) && over.includes(t.waste.id) && walk.includes(t.water.id) && walk.includes(t.waste.id);
        return { status: ok ? 'look' : 'fail', observed: `In 3D und im Begehen vorhanden: ${ok ? 'beide Anschlüsse' : 'nicht beide'}; Mittelhöhen ${Object.values(pos).map((y) => `${Math.round(y * 100)} cm`).join(' / ')}. Ob Eckventil und Stutzen gut aussehen, bitte am Bild beurteilen.` };
      },
    },
  ],
};
