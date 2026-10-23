// Treppen: gewendelte und halbgewendelte Treppen sowie Podeste (#335) – Testschritte aus dem Kommentar in #335.
const bar = (t) => t.page.getByTestId('level-bar');
const camXYZ = (t) => t.page.evaluate(() => { const c = window.__wp.three.camera.position; return { x: c.x, y: c.y, z: c.z }; });
const stairs = async (t) => (await t.project()).furniture.filter((f) => f.category === 'stairs');
const KINDS = [
  { query: 'viertelgewendelt mit Podest', name: 'Treppe viertelgewendelt mit Podest, Rechtskurve', label: 'viertelgewendelt (Podest)' },
  { query: 'viertelgewendelt mit Wendelstufen', name: 'Treppe viertelgewendelt mit Wendelstufen, Rechtskurve', label: 'viertelgewendelt (Wendelstufen)' },
  { query: 'halbgewendelt mit Podest', name: 'Treppe halbgewendelt mit Podest (U), Rechtskurve', label: 'halbgewendelt (U, Podest)' },
  { query: 'halbgewendelt mit Wendelstufen', name: 'Treppe halbgewendelt mit Wendelstufen (U), Rechtskurve', label: 'halbgewendelt (U, Wendelstufen)' },
  { query: 'Wendeltreppe', name: 'Wendeltreppe Ø 160 cm, gegen den Uhrzeigersinn', label: 'Wendeltreppe' },
];

/** Drawing of one stair in the 2D plan, found by its position (the plan symbols carry no id). */
const drawn = (t, f) =>
  t.page.evaluate(([x, y]) => {
    const g = [...document.querySelectorAll('[data-testid="editor2d"] svg g[transform^="translate("]')].find((el) => {
      const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\)/.exec(el.getAttribute('transform'));
      return m && Math.abs(+m[1] - x) < 1e-6 && Math.abs(+m[2] - y) < 1e-6 && el.querySelector('polyline, polygon');
    });
    if (!g) return null;
    const pl = g.querySelector('polyline');
    return {
      polys: g.querySelectorAll('polygon').length,
      walk: g.querySelectorAll('polyline').length,
      arrow: g.querySelectorAll('line').length,
      line: pl ? pl.getAttribute('points').trim().split(/\s+/).map((s) => s.split(',').map(Number)) : [],
      box: g.getBoundingClientRect().toJSON(),
    };
  }, [f.x, f.y]);

/** Leave only one of the saved stairs in the project, standing alone in the living room where it conflicts with nothing. */
async function only(t, id) {
  const { page } = t;
  for (const [x, y] of [[3.0, 1.8], [1.5, 1.7], [2.0, 1.7], [2.6, 1.7], [3.6, 1.8], [2.0, 1.8], [3.0, 1.5], [1.5, 1.5]]) {
    await page.evaluate(([saved, want, px, py]) => window.__wp.useProjectStore.getState().apply((d) => {
      d.furniture = saved.filter((f) => f.id === want).map((f) => ({ ...f, x: px, y: py, rotation: 0 }));
    }), [t.saved, id, x, y]);
    await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), id);
    await page.waitForTimeout(250);
    const red = await page.locator('.panel.right').getByText('Rot markiert').count();
    if (!red) break;
  }
  await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
}

/** Add a stair from the catalog (search + click) and return it. */
async function addStair(t, query, name) {
  const { page } = t;
  const before = (await stairs(t)).map((f) => f.id);
  await page.getByRole('button', { name: 'Katalog', exact: true }).click();
  await page.getByPlaceholder(/Suchen/).fill(query);
  await page.getByText(name, { exact: true }).first().click();
  await t.poll(async () => ((await stairs(t)).length > before.length ? 1 : null), 5000);
  return (await stairs(t)).find((f) => !before.includes(f.id));
}

/** Walk up the stair along its drawn walking line (steering with the view direction). */
async function walkUp(t, wps, upper, ground) {
  const { page } = t;
  await page.evaluate(([w]) => {
    window.__rec = [];
    window.__wps = w;
    window.__i = 0;
    window.__recId = setInterval(() => {
      const wp = window.__wp;
      const c = wp.three.camera.position;
      const g = window.__wps;
      while (window.__i < g.length - 1 && Math.hypot(g[window.__i].x - c.x, g[window.__i].y - c.z) < 0.3) window.__i++;
      const tg = g[window.__i];
      const last = window.__i === g.length - 1 && Math.hypot(tg.x - c.x, tg.y - c.z) < 0.3;
      if (!last) wp.walk.look(Math.atan2(-(tg.x - c.x), -(tg.y - c.z)), 0);
      window.__rec.push([c.y, wp.useProjectStore.getState().project.activeLevelId, c.x, c.z]);
    }, 30);
  }, [wps]);
  await page.keyboard.down('KeyW');
  const switched = await t.poll(async () => ((await t.project()).activeLevelId === upper ? true : null), 20000);
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const rec = await page.evaluate(() => { clearInterval(window.__recId); return window.__rec; });
  const before = rec.filter((r) => r[1] !== upper).map((r) => r[0]);
  const rises = before.every((y, i) => i === 0 || y >= before[i - 1] - 0.03);
  // eye height relative to the walking surface must stay roughly constant: no jump larger than 25 cm between samples
  const maxJump = Math.max(0, ...rec.map((r, i) => (i && rec[i - 1][1] === r[1] ? Math.abs(r[0] - rec[i - 1][0]) : 0)));
  return { switched: !!switched, n: before.length, from: before[0], to: before.at(-1), rises, maxJump, rec };
}

export default {
  issue: 335,
  name: 'Gewendelte Treppen',
  title: 'Treppen: gewendelte und halbgewendelte Treppen sowie Podeste',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen, im Reiter „Projekt“ eine Etage darüber anlegen, zurück ins Erdgeschoss wechseln.',
      expected: 'Zwei Etagen, das Erdgeschoss ist aktiv.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        t.start = await t.project();
        await page.locator('.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
        await page.getByTestId('add-level-above').click();
        t.upper = (await t.project()).activeLevelId;
        await page.keyboard.press('PageDown');
        const ok = await t.poll(async () => ((await t.project()).activeLevelId === t.start.activeLevelId ? 1 : null), 3000);
        const p = await t.project();
        return { status: ok && p.levels.length === 2 ? 'ok' : 'fail', observed: `${p.levels.length} Etagen, aktiv: „${p.levels.find((l) => l.id === p.activeLevelId)?.name}“.` };
      },
    },
    {
      nr: 2,
      action: 'Im Katalog nach „Treppe“ suchen: viertelgewendelt (mit Podest / mit Wendelstufen), halbgewendelt (U, mit Podest / mit Wendelstufen) und Wendeltreppe, je mit Rechts- und Linkskurve bzw. Drehsinn. Treppe platzieren.',
      expected: 'Treppe wird platziert, Höhe = Geschosshöhe (260 cm).',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Katalog', exact: true }).click();
        const search = page.getByPlaceholder(/Suchen/);
        await search.fill('Treppe');
        const names = await page.locator('.panel.left').innerText();
        const wanted = [
          'viertelgewendelt mit Podest, Rechtskurve', 'viertelgewendelt mit Podest, Linkskurve',
          'viertelgewendelt mit Wendelstufen, Rechtskurve', 'viertelgewendelt mit Wendelstufen, Linkskurve',
          'halbgewendelt mit Podest (U), Rechtskurve', 'halbgewendelt mit Podest (U), Linkskurve',
          'halbgewendelt mit Wendelstufen (U), Rechtskurve', 'halbgewendelt mit Wendelstufen (U), Linkskurve',
          'Wendeltreppe Ø 160 cm, gegen den Uhrzeigersinn', 'Wendeltreppe Ø 160 cm, im Uhrzeigersinn',
        ];
        const missing = wanted.filter((w) => !names.includes(w));
        const heights = [];
        for (const k of KINDS) {
          const f = await addStair(t, k.query, k.name);
          heights.push(`${k.label}: ${Math.round(f.height * 100)} cm`);
          t[k.label] = f;
        }
        const all = await stairs(t);
        const okH = all.every((f) => Math.abs(f.height - 2.6) < 1e-6);
        return { status: missing.length === 0 && okH && all.length === KINDS.length ? 'ok' : 'fail', observed: `Katalogeinträge fehlend: ${missing.length ? missing.join('; ') : 'keine (alle 10 vorhanden)'}. Platziert: ${heights.join(', ')}.` };
      },
    },
    {
      nr: 3,
      action: 'Im 2D-Plan ansehen.',
      expected: 'Stufen als einzelne Felder (Wendelstufen als Keile), Lauflinie mit Pfeil nach oben.',
      async run(t) {
        const { page } = t;
        t.saved = await stairs(t);
        await page.addStyleTag({ content: '.toasts{display:none !important}' });
        await page.getByRole('button', { name: '2D', exact: true }).click();
        const info = [];
        for (const [i, k] of KINDS.entries()) {
          await only(t, t[k.label].id);
          await page.waitForTimeout(500);
          const f = (await stairs(t))[0];
          info.push((await drawn(t, f)) ?? { polys: 0, walk: 0, arrow: 0 });
          await t.shot(`2D: ${k.label}`, { x: 300, y: 200, width: 820, height: 360 });
        }
        const ok = info.every((i) => i.polys >= 10 && i.walk === 1 && i.arrow >= 2);
        return { status: ok ? 'look' : 'fail', observed: `Je Treppe (Felder / Lauflinie / Pfeilstriche): ${KINDS.map((k, i) => `${k.label} ${info[i].polys}/${info[i].walk}/${info[i].arrow}`).join('; ')}. Dass Wendelstufen als Keile aussehen, ist am Screenshot zu beurteilen.` };
      },
    },
    {
      nr: 4,
      action: 'In 3D ansehen (Übersicht).',
      expected: 'Stufen steigen gleichmäßig, Podest ist eben, Wendeltreppe hat eine Mittelstange; Loch in der Decke bzw. im Boden der Etage darüber hat den Treppenumriss.',
      async run(t) {
        const { page } = t;
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1000);
        for (const k of KINDS) {
          await only(t, t[k.label].id);
          await page.waitForTimeout(1500);
          await t.shot(`3D, Erdgeschoss: ${k.label}`, { x: 300, y: 43, width: 820, height: 600 });
          await page.keyboard.press('PageUp');
          await page.waitForTimeout(1500);
          await t.shot(`3D, Obergeschoss (Loch im Boden): ${k.label}`, { x: 300, y: 43, width: 820, height: 600 });
          await page.keyboard.press('PageDown');
          await page.waitForTimeout(500);
        }
        return { status: errors.length ? 'fail' : 'look', observed: `3D-Ansicht für alle 5 Treppenarten ohne Fehler aufgebaut (Fehler: ${errors.length}). Gleichmäßige Stufen, ebenes Podest, Mittelstange und der Treppenumriss im Boden der Etage darüber sind reine Optik; Bilder liegen bei.` };
      },
    },
    {
      nr: 5,
      action: '„Begehen“ starten und die Treppe von unten nach oben gehen; danach wieder hinunter.',
      expected: 'Blick steigt weich mit, am Ende wechselt die aktive Etage nach oben; zurück nach unten gehen wechselt wieder.',
      async run(t) {
        const { page } = t;
        const results = [];
        let allOk = true;
        const saved = t.saved;
        for (const k of [KINDS[0], KINDS[2], KINDS[4]]) {
          // keep only this stair; find where the walker starts (centre of the first room), then put the first tread there
          await page.getByRole('button', { name: '2D', exact: true }).click();
          if (process.env.UT_DBG) console.log('vor Filter', (await t.project()).furniture.map((f) => f.id + ':' + f.name).join(' | '), k.label, t[k.label]?.id);
          await page.evaluate((name) => window.__wp.useProjectStore.getState().apply((d) => {
            d.furniture = name.stairs.filter((f) => f.id === name.id).map((f) => ({ ...f }));
            d.furniture.forEach((f) => { f.x = -6; f.y = -6; f.rotation = 0; });
          }), { stairs: saved, id: t[k.label].id });
          await page.getByRole('button', { name: '3D', exact: true }).click();
          await page.getByRole('button', { name: 'Begehen' }).click();
          await page.locator('.walk-overlay').waitFor();
          await page.waitForTimeout(500);
          const start = await camXYZ(t);
          await page.evaluate(() => document.exitPointerLock());
          await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
          await page.getByRole('button', { name: '2D', exact: true }).click();
          await page.waitForTimeout(500);
          const st = (await stairs(t))[0];
          if (!st) { const q = await t.project(); throw new Error(`keine Treppe: Etage ${q.activeLevelId} (oben ${t.upper}), Möbel ${q.furniture.length}, id ${t[k.label]?.id}`); }
          const line = (await drawn(t, st)).line;
          // turn the stair (0/90/180/270 degrees) so that its first tread lies under the start point and the whole walking line stays inside the building
          const pr = await t.project();
          const xs = pr.nodes.map((n) => n.x);
          const ys = pr.nodes.map((n) => n.y);
          const bb = { x0: Math.min(...xs) + 0.2, x1: Math.max(...xs) - 0.2, y0: Math.min(...ys) + 0.2, y1: Math.max(...ys) - 0.2 };
          let wps = null;
          let rot = 0;
          for (const r of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
            const c = Math.cos(r), s2 = Math.sin(r);
            const rp = line.map(([x, y]) => [x * c - y * s2, x * s2 + y * c]);
            const cand = rp.map(([x, y]) => ({ x: start.x + x - rp[0][0], y: start.z + y - rp[0][1] }));
            if (cand.every((w) => w.x > bb.x0 && w.x < bb.x1 && w.y > bb.y0 && w.y < bb.y1)) { wps = cand; rot = r; break; }
          }
          if (!wps) { rot = 0; wps = line.map(([x, y]) => ({ x: start.x + x - line[0][0], y: start.z + y - line[0][1] })); }
          {
            const c = Math.cos(rot), s2 = Math.sin(rot);
            const l0 = [line[0][0] * c - line[0][1] * s2, line[0][0] * s2 + line[0][1] * c];
            await page.evaluate(([id, x, y, r]) => window.__wp.useProjectStore.getState().apply((d) => { const f = d.furniture.find((v) => v.id === id); f.x = x; f.y = y; f.rotation = r; }), [st.id, start.x - l0[0], start.z - l0[1], rot]);
          }
          await page.getByRole('button', { name: '3D', exact: true }).click();
          await page.getByRole('button', { name: 'Begehen' }).click();
          await page.locator('.walk-overlay').waitFor();
          await page.waitForTimeout(600);
          const up = await walkUp(t, wps, t.upper, t.start.activeLevelId);
          const btn = await bar(t).getByRole('button', { name: /Obergeschoss/ }).getAttribute('aria-pressed');
          // back down: walk the line in reverse from where we stand
          const rev = [...wps].reverse();
          await page.evaluate(([w]) => {
            window.__wps = w; window.__i = 0; window.__rec = [];
            window.__recId = setInterval(() => {
              const wp = window.__wp; const c = wp.three.camera.position; const g = window.__wps;
              while (window.__i < g.length - 1 && Math.hypot(g[window.__i].x - c.x, g[window.__i].y - c.z) < 0.3) window.__i++;
              const tg = g[window.__i];
              wp.walk.look(Math.atan2(-(tg.x - c.x), -(tg.y - c.z)), 0);
            }, 30);
          }, [rev]);
          await page.keyboard.down('KeyW');
          const back = await t.poll(async () => ((await t.project()).activeLevelId === t.start.activeLevelId ? true : null), 20000);
          await page.waitForTimeout(500);
          await page.keyboard.up('KeyW');
          const endPos = await page.evaluate(() => { clearInterval(window.__recId); const c = window.__wp.three.camera.position; return { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), i: window.__i, lvl: window.__wp.useProjectStore.getState().project.activeLevelId }; });
          const ok = up.switched && up.rises && up.maxJump < 0.3 && btn === 'true' && !!back;
          allOk = allOk && ok;
          results.push(`${k.label}: hinauf ${up.switched ? 'Etage gewechselt' : 'KEIN Etagenwechsel'}, ${up.n} Messpunkte Augenhöhe ${up.from?.toFixed(2)}→${up.to?.toFixed(2)} m, stetig ansteigend ${up.rises}, größter Sprung ${(up.maxJump * 100).toFixed(0)} cm; hinunter Etage zurück: ${!!back}${back ? '' : ` (Ende bei x ${endPos.x}, z ${endPos.z}, Höhe ${endPos.y}, Wegpunkt ${endPos.i + 1}/${wps.length}, Etage ${endPos.lvl}; Treppenlinie ${wps.map((w) => `${w.x.toFixed(1)}/${w.y.toFixed(1)}`).join(' ')})`}`);
          await page.evaluate(() => document.exitPointerLock());
          await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
          // back to ground floor for the next kind
          await page.getByRole('button', { name: '2D', exact: true }).click();
          if ((await t.project()).activeLevelId !== t.start.activeLevelId) { await page.keyboard.press('PageDown'); await t.poll(async () => ((await t.project()).activeLevelId === t.start.activeLevelId ? 1 : null), 3000); }
        }
        return { status: allOk ? 'ok' : 'fail', observed: results.join(' | ') };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Treppe drehen und die Maße ändern.',
      expected: 'Stufen und Loch passen sich an.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        const st = (await stairs(t))[0];
        let cur = st;
        const grab = () => drawn(t, cur);
        const a = await grab();
        await page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { const f = d.furniture.find((v) => v.id === id); f.rotation = Math.PI / 2; f.width = 2.0; f.depth = 3.0; }), st.id);
        await page.waitForTimeout(500);
        cur = (await stairs(t))[0];
        const b = await grab();
        await t.shot('Gedrehte Treppe mit geänderten Maßen');
        const changed = Math.abs(a.box.width - b.box.width) > 1 || Math.abs(a.box.height - b.box.height) > 1;
        return { status: changed && b.polys === a.polys ? 'ok' : 'fail', observed: `Felder ${a.polys}→${b.polys}; Umriss im Plan ${Math.round(a.box.width)}×${Math.round(a.box.height)} → ${Math.round(b.box.width)}×${Math.round(b.box.height)} px (Drehung/Maße über den Projektzustand gesetzt, nicht über die Eingabefelder). Das Loch im Boden der Etage darüber wurde hier nicht geprüft.` };
      },
    },
  ],
};
