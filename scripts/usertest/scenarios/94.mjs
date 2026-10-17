// Mehrfachauswahl: auswählen, gemeinsam ziehen, Maßlinien, kopieren, löschen (#94) – Testschritte aus dem Kommentar in #94.
const plan = (t) => t.page.getByTestId('editor2d');
const sel = (t) =>
  t.page.evaluate(() => {
    const s = window.__wp.useUiStore.getState();
    return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : [];
  });
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
const lines = (t) =>
  plan(t)
    .locator('[data-testid="clearance"]')
    .evaluateAll((els) => els.map((el) => ({ side: el.dataset.side, cm: Number(el.dataset.distanceCm), hit: el.dataset.hit })));
const overlayIds = async (t) => ((await plan(t).getByTestId('clearances').getAttribute('data-furniture-ids').catch(() => null)) ?? '').split(' ').filter(Boolean).sort();
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const SIDE = { left: 'links', right: 'rechts', back: 'hinten', front: 'vorn' };
const describeLines = (ls) => ls.map((l) => `${SIDE[l.side] ?? l.side} ${l.cm} cm → ${l.hit === 'wall' ? 'Wand' : l.hit === 'furniture' ? 'Möbel' : l.hit}`).join(', ') || 'keine';
const pos = async (t, ids) => {
  const p = await t.project();
  return ids.map((id) => p.furniture.find((f) => f.id === id));
};

async function click(t, f, shift = false) {
  const s = await t.planToScreen(f.x, f.y);
  if (shift) await t.page.keyboard.down('Shift');
  await t.page.mouse.click(s.x, s.y);
  if (shift) await t.page.keyboard.up('Shift');
}
/** Bed, then both night stands with Shift (at their current positions). */
async function selectThree(t) {
  const [bed, ...ns] = await pos(t, t.ids);
  await t.page.keyboard.press('Escape');
  await click(t, bed);
  for (const n of ns) await click(t, n, true);
}
/** Drag furniture f by (dx, dy) metres; `during` runs while the mouse is still down. */
async function drag(t, f, dx, dy, during, steps = 5) {
  const a = await t.planToScreen(f.x, f.y);
  const b = await t.planToScreen(f.x + dx, f.y + dy);
  await t.page.mouse.move(a.x, a.y);
  await t.page.mouse.down();
  await t.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps });
  await t.page.mouse.move(b.x, b.y, { steps });
  const r = during ? await during() : undefined;
  await t.page.mouse.up();
  return r;
}

export default {
  issue: 94,
  name: 'Mehrfachauswahl',
  title: 'Mehrfachauswahl: mehrere Möbel auswählen, verschieben, kopieren, löschen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'In 2D das Bett anklicken, dann mit Umschalt+Klick beide Nachttische dazuwählen. Danach einen weiteren Umschalt+Klick auf ein ausgewähltes Möbel.',
      expected: 'Alle drei sind blau, rechts steht „3 Möbel ausgewählt …“. Der weitere Umschalt+Klick nimmt das Möbel wieder heraus.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const p = await t.project();
        t.bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        t.ns = p.furniture.filter((f) => f.catalogId === 'generic-nightstand');
        t.wardrobe = p.furniture.find((f) => f.catalogId === 'generic-wardrobe-150');
        t.ids = [t.bed.id, ...t.ns.map((n) => n.id)];
        await t.page.keyboard.press('Escape');
        await click(t, t.bed);
        for (const n of t.ns) await click(t, n, true);
        const three = await sel(t);
        const note = (await page.getByTestId('multi-note').innerText().catch(() => '')).trim();
        await t.shot('Bett und beide Nachttische ausgewählt');
        await click(t, t.ns[1], true);
        const two = await sel(t);
        const note2 = (await page.getByTestId('multi-note').innerText().catch(() => '')).trim();
        const ok = same(three, t.ids) && /^3 Möbel ausgewählt/.test(note) && same(two, [t.bed.id, t.ns[0].id]);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Nach Bett + 2 × Umschalt+Klick: ${three.length} Möbel ausgewählt, rechts „${note.split('\n')[0]}“. Nach einem weiteren Umschalt+Klick auf einen Nachttisch: ${two.length} ausgewählt („${note2.split('\n')[0]}“), der Nachttisch ist wieder heraus.`,
          caption: 'Nach dem weiteren Umschalt+Klick',
        };
      },
    },
    {
      nr: 2,
      action: 'Eines der drei ziehen. Danach Strg+Z.',
      expected: 'Alle bewegen sich gemeinsam, jedes stoppt an Wänden. Strg+Z setzt alle in einem Schritt zurück.',
      async run(t) {
        const p = await t.project();
        await selectThree(t);
        const before = await pos(t, t.ids);
        const h0 = await past(t);
        // first down into the room, then far to the left against the wall between the rooms
        await drag(t, t.bed, 0, 0.5);
        const mid = await pos(t, t.ids);
        await drag(t, mid[0], -2.5, 0, undefined, 40); // a smooth mouse movement, like a hand
        const after = await pos(t, t.ids);
        const steps = (await past(t)) - h0;
        const dx = after.map((f, i) => f.x - before[i].x);
        const dy = after.map((f, i) => f.y - before[i].y);
        const together = dx.every((v) => Math.abs(v - dx[0]) < 1e-6) && dy.every((v) => Math.abs(v - dy[0]) < 1e-6);
        // inner face of the wall between living room and bedroom (the wall left of the bed)
        const half = (f) => (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.depth : f.width) / 2;
        const leftEdge = Math.min(...after.map((f) => f.x - half(f)));
        const node = (id) => p.nodes.find((n) => n.id === id);
        const walls = p.walls
          .map((w) => ({ w, a: node(w.a), b: node(w.b) }))
          .filter(({ a, b }) => Math.abs(a.x - b.x) < 1e-6 && a.x < before[0].x)
          .map(({ w, a }) => a.x + w.thickness / 2);
        const inner = Math.max(...walls);
        // „jedes stoppt an Wänden“: no piece crosses the wall, the others keep their spacing (no overlap)
        const inside = after.every((f) => f.x - half(f) >= inner - 0.005);
        const box = (f) => ({ x0: f.x - half(f), x1: f.x + half(f), y0: f.y - (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.width : f.depth) / 2, y1: f.y + (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.width : f.depth) / 2 });
        const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.005 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.005;
        const overlaps = [];
        for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) if (overlap(box(after[i]), box(after[j]))) overlaps.push(`${after[i].name} / ${after[j].name}`);
        const stopped = inside && Math.abs(leftEdge - inner) < 0.02;
        await t.shot('Nach dem Ziehen an die Wand links');
        await t.page.keyboard.press('Control+z');
        const undo1 = await pos(t, t.ids);
        const backOne = undo1.every((f, i) => Math.abs(f.x - mid[i].x) < 1e-6 && Math.abs(f.y - mid[i].y) < 1e-6);
        await t.page.keyboard.press('Control+z');
        const undo2 = await pos(t, t.ids);
        const backAll = undo2.every((f, i) => Math.abs(f.x - before[i].x) < 1e-6 && Math.abs(f.y - before[i].y) < 1e-6);
        return {
          status: stopped && !overlaps.length && Math.max(...dx) - Math.min(...dx) < 0.1 && steps === 2 && backOne && backAll ? 'ok' : 'fail',
          observed: `Bett gezogen (erst 50 cm nach unten, dann 2,5 m nach links gegen die Wand zum Wohnzimmer): alle drei bewegten sich ${together ? 'gemeinsam um dieselbe Strecke' : 'gemeinsam'} (nach links: ${after.map((f, i) => `${f.name} ${Math.round(-dx[i] * 100)} cm`).join(', ')}; alle ${Math.round(dy[0] * 100)} cm nach unten). Linker Rand der Auswahl ${Math.round((leftEdge - inner) * 100)} cm vor der Wand – ${stopped ? 'an der Wand gestoppt, kein Möbel in der Wand' : 'nicht an der Wand gestoppt'}. Überlappungen untereinander: ${overlaps.length ? overlaps.join(', ') : 'keine'}. Rückgängig-Schritte für die zwei Ziehvorgänge: ${steps}. Einmal Strg+Z: ${backOne ? 'alle drei zurück auf den Stand nach dem ersten Ziehen' : 'nicht alle zurück'}; zweites Strg+Z: ${backAll ? 'alle wieder am Ausgangsort' : 'nicht alle am Ausgangsort'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'Beim Ziehen die Maßlinien ansehen (Bett und beide Nachttische ausgewählt, ziehen).',
      expected: 'Die Maßlinien gehen vom äußeren Rand der Dreier-Auswahl zu den Wänden und zum Schrank (Abstände der ganzen Auswahl; ausgewählte Möbel untereinander nicht).',
      async run(t) {
        await selectThree(t);
        const [bed] = await pos(t, [t.bed.id]);
        const r = await drag(t, bed, 0, 0.6, async () => {
          await t.page.waitForTimeout(300);
          const ls = await lines(t);
          const ids = await overlayIds(t);
          await t.shot('Maßlinien während des Ziehens');
          return { ls, ids };
        });
        const after = await lines(t);
        const toWardrobe = r.ls.some((l) => l.hit === 'furniture');
        const walls = r.ls.filter((l) => l.hit === 'wall').length;
        const ok = same(r.ids, t.ids) && r.ls.length > 0 && walls >= 2 && toWardrobe && after.length === 0;
        t.dragLines = r.ls;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Während des Ziehens: Maßlinien für ${same(r.ids, t.ids) ? 'die ganze Dreier-Auswahl (gemeinsamer Umriss)' : `nur ${r.ids.length} Möbel`}: ${describeLines(r.ls)}. Linien zum Schrank: ${toWardrobe ? 'ja' : 'nein'}; Linien zwischen den ausgewählten Möbeln gibt es nicht, weil die Auswahl als ein Umriss gemessen wird. Nach dem Loslassen: ${after.length} Linien.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Stillhalten und Alt halten.',
      expected: 'Dieselben Maßlinien erscheinen.',
      async run(t) {
        const { page } = t;
        const before = await pos(t, t.ids);
        await page.keyboard.down('Alt');
        await page.waitForTimeout(300);
        const ls = await lines(t);
        const ids = await overlayIds(t);
        await t.shot('Alt gehalten');
        await page.keyboard.up('Alt');
        const after = await pos(t, t.ids);
        const still = before.every((f, i) => f.x === after[i].x && f.y === after[i].y);
        const sides = (xs) => xs.map((l) => `${l.side}:${l.hit}`).sort().join(',');
        return {
          status: same(ids, t.ids) && ls.length > 0 && sides(ls) === sides(t.dragLines) && still ? 'ok' : 'fail',
          observed: `Mit Alt: ${describeLines(ls)} – ${sides(ls) === sides(t.dragLines) ? 'dieselben Linien (Seiten und Ziele) wie beim Ziehen' : 'andere Linien als beim Ziehen'}. Bewegt hat sich ${still ? 'nichts' : 'etwas'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Dasselbe nach Strg+G als Gruppe.',
      expected: 'Die Maßlinien erscheinen genauso.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Control+g');
        const whole = await page.getByTestId('group-outline').getAttribute('data-whole').catch(() => null);
        const [bed] = await pos(t, [t.bed.id]);
        const d = await drag(t, bed, 0, -0.3, async () => {
          await page.waitForTimeout(300);
          return { ls: await lines(t), ids: await overlayIds(t) };
        });
        await page.keyboard.down('Alt');
        await page.waitForTimeout(300);
        const alt = { ls: await lines(t), ids: await overlayIds(t) };
        await page.keyboard.up('Alt');
        const ok = whole === 'true' && same(d.ids, t.ids) && d.ls.length > 0 && same(alt.ids, t.ids) && alt.ls.length > 0;
        t.grouped = true;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Strg+G: Gruppe ${whole === 'true' ? 'gebildet und als Ganzes ausgewählt' : 'nicht als Ganzes ausgewählt'}. Beim Ziehen der Gruppe: ${describeLines(d.ls)} (Umriss aller drei: ${same(d.ids, t.ids) ? 'ja' : 'nein'}). Mit Alt: ${describeLines(alt.ls)}.`,
        };
      },
    },
    {
      nr: 6,
      action: 'Pfeiltasten drücken.',
      expected: 'Alle ausgewählten Möbel verschieben sich.',
      async run(t) {
        const { page } = t;
        // back to a plain multi-selection (ungroup) as in the steps before Strg+G
        await page.keyboard.press('Control+Shift+g');
        await selectThree(t);
        const before = await pos(t, t.ids);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        const after = await pos(t, t.ids);
        const d = after.map((f, i) => ({ x: f.x - before[i].x, y: f.y - before[i].y }));
        const ok = d.every((v) => Math.hypot(v.x, v.y) > 0.005 && Math.abs(v.x - d[0].x) < 1e-6 && Math.abs(v.y - d[0].y) < 1e-6);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Gruppe wieder aufgelöst (Strg+Umschalt+G), alle drei ausgewählt. 2 × ↓ und 1 × ←: ${d.map((v) => `${Math.round(v.x * 100)}/${Math.round(v.y * 100)} cm`).join(', ')} – ${ok ? 'alle gleich verschoben' : 'nicht alle gleich verschoben'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 7,
      action: 'Strg+C, dann Strg+V. Danach nochmals Strg+V.',
      expected: 'Kopien erscheinen leicht versetzt und sind ausgewählt. Nochmals Strg+V gibt weitere Kopien, noch etwas weiter versetzt.',
      async run(t) {
        const { page } = t;
        const n0 = (await t.project()).furniture.length;
        const orig = await pos(t, t.ids);
        await page.keyboard.press('Control+c');
        await page.keyboard.press('Control+v');
        const s1 = await sel(t);
        const c1 = await pos(t, s1);
        await page.keyboard.press('Control+v');
        const s2 = await sel(t);
        const c2 = await pos(t, s2);
        const n2 = (await t.project()).furniture.length;
        // offset of each copy against the original with the same name/position order
        const off = (copies) => copies.map((c) => {
          const o = orig.find((x) => x.catalogId === c.catalogId && Math.abs(x.rotation - c.rotation) < 1e-6 && Math.abs(c.x - x.x - (copies[0].x - orig[0].x)) < 1e-3);
          return o ? Math.hypot(c.x - o.x, c.y - o.y) : NaN;
        });
        const o1 = off(c1);
        const o2 = off(c2);
        const fresh = s1.every((id) => !t.ids.includes(id)) && s2.every((id) => !t.ids.includes(id) && !s1.includes(id));
        const ok = s1.length === 3 && s2.length === 3 && n2 === n0 + 6 && fresh && o1.every((v) => v > 0.05 && v < 1) && Math.min(...o2) > Math.max(...o1) - 1e-6;
        t.copies = s2;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Möbel vorher ${n0}, nach 2 × Einfügen ${n2}. Erste Kopien: ${s1.length} ausgewählt, versetzt um ${o1.map((v) => Math.round(v * 100)).join('/')} cm. Zweite Kopien: ${s2.length} ausgewählt, versetzt um ${o2.map((v) => Math.round(v * 100)).join('/')} cm${Math.min(...o2) > Math.max(...o1) - 1e-6 ? ' (weiter als die ersten)' : ' (nicht weiter)'}.`,
        };
      },
    },
    {
      nr: 8,
      action: 'Entf drücken, danach Strg+Z.',
      expected: 'Alle ausgewählten Möbel werden gelöscht. Strg+Z holt sie zurück.',
      async run(t) {
        const { page } = t;
        const ids = await sel(t);
        const n0 = (await t.project()).furniture.length;
        await page.keyboard.press('Delete');
        const p1 = await t.project();
        const gone = ids.every((id) => !p1.furniture.some((f) => f.id === id));
        await page.keyboard.press('Control+z');
        const p2 = await t.project();
        const back = ids.every((id) => p2.furniture.some((f) => f.id === id));
        return {
          status: ids.length === 3 && gone && p1.furniture.length === n0 - 3 && back && p2.furniture.length === n0 ? 'ok' : 'fail',
          observed: `${ids.length} ausgewählte Kopien: nach Entf ${gone ? 'alle gelöscht' : 'nicht alle gelöscht'} (${n0} → ${p1.furniture.length} Möbel). Nach einem Strg+Z: ${back ? 'alle wieder da' : 'nicht alle wieder da'} (${p2.furniture.length} Möbel).`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 9,
      action: 'Umschalt gedrückt halten und auf dem Boden einen Rahmen ziehen.',
      expected: 'Alle Möbel, deren Mitte im Rahmen liegt, werden ausgewählt.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.mouse.click(10, 10);
        const p = await t.project();
        const box = { x0: 1.5, y0: 1.9, x1: 4.2, y1: 3.95 }; // living room: sofa, coffee table, rug, lamp
        const inside = p.furniture.filter((f) => f.x > box.x0 && f.x < box.x1 && f.y > box.y0 && f.y < box.y1).map((f) => f.id);
        const a = await t.planToScreen(box.x0, box.y0);
        const b = await t.planToScreen(box.x1, box.y1);
        await page.keyboard.down('Shift');
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 5 });
        const visible = await page.getByTestId('selection-box').isVisible();
        await t.shot('Rahmen wird gezogen');
        await page.mouse.up();
        await page.keyboard.up('Shift');
        const s = await sel(t);
        const names = (ids) => ids.map((id) => p.furniture.find((f) => f.id === id)?.name).join(', ');
        return {
          status: visible && inside.length > 0 && same(s, inside) ? 'ok' : 'fail',
          observed: `Rahmen sichtbar: ${visible ? 'ja' : 'nein'}. Mitte im Rahmen: ${names(inside)}. Ausgewählt: ${names(s) || 'nichts'}${same(s, inside) ? ' – genau diese' : ' – weicht ab'}.`,
        };
      },
    },
    {
      nr: 10,
      action: 'Strg+A (in 2D).',
      expected: 'Alle Möbel sind ausgewählt.',
      async run(t) {
        await plan(t).hover();
        await t.page.keyboard.press('Control+a');
        const s = await sel(t);
        const all = (await t.project()).furniture.map((f) => f.id);
        t.all = all;
        return { status: same(s, all) ? 'ok' : 'fail', observed: `Ausgewählt: ${s.length} von ${all.length} Möbeln.` };
      },
    },
    {
      nr: 11,
      action: 'In 3D ansehen.',
      expected: 'Ausgewählte Möbel sind ebenfalls hervorgehoben (die Auswahl selbst erfolgt im 2D-Plan). Drehen wirkt weiterhin nur auf das zuerst gewählte Möbel.',
      async run(t) {
        const { page } = t;
        await selectThree(t);
        const first = (await sel(t))[0];
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        // blue selection frames in the 3D scene
        const frames = await t.poll(async () => {
          const n = await page.evaluate(() => {
            let c = 0;
            window.__wp.three?.scene?.traverse((o) => {
              if (o.isLineSegments && o.material?.color?.getHexString() === '2563eb') c++;
            });
            return c;
          });
          return n === 3 ? n : null;
        }, 8000);
        const bed = (await pos(t, [t.bed.id]))[0];
        await t.lookAt({ x: bed.x - 1.2, y: 4.5, z: bed.y + 3.2 }, { x: bed.x, y: 0.3, z: bed.y });
        await page.waitForTimeout(1200);
        await t.shot('3D: Bett und Nachttische hervorgehoben');
        const before = await pos(t, t.ids);
        await page.keyboard.press('e');
        await page.waitForTimeout(300);
        const after = await pos(t, t.ids);
        const turned = after.filter((f, i) => Math.abs(f.rotation - before[i].rotation) > 1e-6).map((f) => f.id);
        const ok = frames === 3 && turned.length === 1 && turned[0] === first;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `In 3D ${frames ?? 0} blaue Auswahlrahmen (Bett und beide Nachttische). Drehen mit E: gedreht ${turned.length === 1 && turned[0] === first ? 'nur das zuerst gewählte Möbel (Bett)' : `${turned.length} Möbel`}.`,
          noFinalShot: true,
        };
      },
    },
  ],
};
