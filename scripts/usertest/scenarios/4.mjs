// Einheitliches Kollisionssystem (#4) – Testschritte aus dem Kommentar in #4.
const right = (t) => t.page.locator('.panel.right');
const ERROR_KINDS = ['wall', 'door-leaf', 'overlap'];
const de = (v, n = 2) => v.toFixed(n).replace('.', ',');
const cm = (v) => Math.round(v * 100);
const byCatalog = (t, id) => t.furniture((f) => f.catalogId === id);
const byId = (t, id) => t.furniture((f) => f.id === id);

/** 3D markers per item: { [id]: ['overlap:<ref>', …] } */
const markers3d = (t) =>
  t.page.evaluate(() => {
    const out = {};
    window.__wp.three?.scene?.getObjectByName('collision-markers')?.traverse((o) => {
      const m = o.name.match(/^collision-issue:([^:]+):([^:]+):(.*)$/);
      if (m) (out[m[1]] ??= []).push(`${m[2]}:${m[3]}`);
    });
    return out;
  });
/** 2D outline colour per item: { [id]: 'error' | 'warn' | 'none' } (from the drawn symbol at the item's position). */
const levels2d = (t) =>
  t.page.evaluate(() => {
    const items = window.__wp.useProjectStore.getState().project.furniture;
    const gs = [...document.querySelectorAll('[data-testid="editor2d"] svg g[transform^="translate("]')];
    const out = {};
    for (const f of items) {
      const g = gs.find((x) => {
        const m = x.getAttribute('transform').match(/translate\(([-\d.e]+)[ ,]([-\d.e]+)\)/);
        return m && Math.abs(Number(m[1]) - f.x) < 1e-6 && Math.abs(Number(m[2]) - f.y) < 1e-6;
      });
      const s = g?.firstElementChild?.style.stroke ?? '';
      out[f.id] = s === 'rgb(220, 38, 38)' ? 'error' : s === 'rgb(217, 119, 6)' ? 'warn' : 'none';
    }
    return out;
  });
const level3d = (list) => (!list?.length ? 'none' : list.some((k) => ERROR_KINDS.includes(k.split(':')[0])) ? 'error' : 'warn');
/** Compare 2D and 3D for every item; returns the mismatches as text. */
async function compare(t) {
  const p = await t.project();
  const l2 = await levels2d(t);
  const m3 = await markers3d(t);
  return p.furniture.filter((f) => l2[f.id] !== level3d(m3[f.id])).map((f) => `${f.name}: 2D ${l2[f.id]}, 3D ${level3d(m3[f.id])}`);
}
async function hint(t, id) {
  await t.page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), id);
  await t.page.waitForTimeout(250);
  return (await right(t).getByTestId('furniture-issues').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}
/** Drag an item in the 2D plan from its centre to plan point (x, y). */
async function drag(t, id, x, y, alt = false) {
  const f = await byId(t, id);
  const a = await t.planToScreen(f.x, f.y);
  const b = await t.planToScreen(x, y);
  await t.page.mouse.move(a.x, a.y);
  if (alt) await t.page.keyboard.down('Alt');
  await t.page.mouse.down();
  await t.page.mouse.move(b.x, b.y, { steps: 30 });
  await t.page.mouse.up();
  if (alt) await t.page.keyboard.up('Alt');
  await t.page.waitForTimeout(500);
  return byId(t, id);
}
/** Add a catalog item with a click on its catalog entry, then put it at (x, y) for the test. */
async function add(t, name, x, y) {
  const left = t.page.locator('.panel.left');
  await left.getByRole('button', { name: 'Katalog' }).click();
  await left.getByLabel('Katalog durchsuchen').fill(name);
  const n0 = (await t.project()).furniture.length;
  await left.locator('.catalog-item', { hasText: name }).first().click();
  const f = await t.poll(async () => {
    const l = (await t.project()).furniture;
    return l.length === n0 + 1 ? l.at(-1) : null;
  }, 4000);
  await t.page.evaluate(
    ([id, px, py]) => window.__wp.useProjectStore.getState().apply((d) => Object.assign(d.furniture.find((q) => q.id === id), { x: px, y: py })),
    [f.id, x, y],
  );
  await t.page.waitForTimeout(300);
  return byId(t, f.id);
}
const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.005 && Math.abs(a.y - b.y) < (a.depth + b.depth) / 2 - 0.005;
/** Footprint size along plan x/y (rotation 0 or 180° keeps width along x). */
const fp = (f) => (Math.abs(Math.sin(f.rotation ?? 0)) > 0.5 ? { width: f.depth, depth: f.width } : { width: f.width, depth: f.depth });
const box = (f) => ({ x: f.x, y: f.y, ...fp(f) });

export default {
  issue: 4,
  name: 'Kollisionssystem',
  title: 'Einheitliches Kollisionssystem (Lampe im Sofa, inkonsistente Warnungen)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Stehlampe ins Sofa schieben: In der 2D-Ansicht die Stehlampe anklicken und auf das Sofa ziehen.',
      expected: 'Die Lampe bleibt am Rand des Sofas stehen und lässt sich nicht hineinschieben.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
        await page.waitForTimeout(1500);
        t.sofa = await byCatalog(t, 'generic-sofa-3');
        t.lamp = await byCatalog(t, 'generic-floor-lamp');
        t.compares = [];
        const l = await drag(t, t.lamp.id, t.sofa.x, t.sofa.y);
        const gap = l.x - l.width / 2 - (t.sofa.x + fp(t.sofa).width / 2);
        const inside = overlaps(box(l), box(t.sofa));
        await t.shot('Stehlampe aufs Sofa gezogen (ohne Alt)');
        return {
          status: !inside && gap < 0.08 && l.x < t.lamp.x - 0.2 ? 'ok' : 'fail',
          observed: `Stehlampe von x ${de(t.lamp.x)} m auf die Sofamitte gezogen: steht bei x ${de(l.x)} m, ${inside ? 'im Sofa' : `${cm(gap)} cm neben der Sofakante`}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 2,
      action: 'Überlappung sichtbar: Mit gedrückter Alt-Taste (freies Platzieren) die Lampe trotzdem ins Sofa ziehen, in 2D und in 3D (gern mit „Schnitt“; Couchtisch mit Alt ins Sofa ziehen).',
      expected: 'In 2D werden beide Möbel rot umrandet, in 3D erscheint eine rote Markierung. Ohne Alt stoppt das Möbel am Sofa. In den Hinweisen steht, dass sich die beiden überschneiden („Rot markiert: überlappt mit ‚Sofa 3-Sitzer‘“); mit der Maus über das Sofa fahren zeigt den Grund in der Info-Karte.',
      async run(t) {
        const { page } = t;
        const l = await drag(t, t.lamp.id, t.sofa.x + 0.5, t.sofa.y, true);
        const inside = overlaps(box(l), box(t.sofa));
        await page.waitForTimeout(800);
        const l2 = await levels2d(t);
        const m3 = await markers3d(t);
        const red3d = (m3[l.id] ?? []).some((k) => k.startsWith('overlap'));
        const h = await hint(t, l.id);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        const s = await t.planToScreen(t.sofa.x - 0.6, t.sofa.y);
        await page.mouse.move(s.x, s.y);
        const card = await page.getByTestId('hover-conflict').innerText({ timeout: 3000 }).catch(() => '');
        await t.shot('Stehlampe mit Alt im Sofa, Maus über dem Sofa');
        await page.mouse.move(2, 2);
        t.compares.push(...(await compare(t)));
        // the coffee table with Alt into the sofa, in the 3D view (with „Schnitt“)
        const table = await byCatalog(t, 'generic-coffee-table');
        await page.keyboard.press('Control+z'); // lamp back next to the sofa
        await page.getByRole('button', { name: 'Schnitt' }).click();
        await page.waitForTimeout(1500);
        const a = await t.worldToScreen(table.x + 0.2, table.height, table.y);
        const b = await t.worldToScreen(table.x + 0.2, table.height, table.y + 0.75);
        await page.mouse.move(a.x, a.y);
        await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 12 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await page.waitForTimeout(800);
        const tb = await byId(t, table.id);
        const tIn = overlaps(box(tb), box(t.sofa));
        const tm = (await markers3d(t))[tb.id] ?? [];
        await t.shot('Couchtisch in 3D mit Alt ins Sofa gezogen');
        t.compares.push(...(await compare(t)));
        await page.keyboard.press('Control+z');
        const ok = inside && l2[l.id] === 'error' && l2[t.sofa.id] === 'error' && red3d && /überlappt mit „Sofa 3-Sitzer“/.test(h) && /überlappt|Stehlampe/.test(card) && tIn && tm.some((k) => k.startsWith('overlap'));
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Stehlampe mit Alt ins Sofa: ${inside ? 'steht im Sofa' : 'nicht im Sofa'}. 2D-Umrandung Lampe ${l2[l.id]}, Sofa ${l2[t.sofa.id]} (error = rot); rote Markierung in 3D: ${red3d ? 'ja' : 'nein'}. Hinweis rechts: „${h || '–'}“. Info-Karte über dem Sofa: „${card || 'keine'}“. Couchtisch in 3D mit Alt gezogen: ${tIn ? 'im Sofa' : 'nicht im Sofa'}, 3D-Markierung: ${tm.join(', ') || 'keine'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'Stuhl unter Tisch: Einen „Esstisch 4 Personen“ und einen „Stuhl“ einfügen und den Stuhl mit der Sitzfläche voran unter den Tisch schieben.',
      expected: 'Die Sitzfläche verschwindet unter der Tischplatte, die Lehne stoppt an der Tischkante, ohne Warnung. Mit Alt ganz hinein: rot markiert, mit Hinweis.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Schnitt' }).click(); // off again
        t.dining = await add(t, 'Esstisch 4 Personen', 1.0, 1.45);
        const chair = await add(t, 'Stuhl', 1.0, 0.45);
        t.chair = chair;
        const edge = t.dining.y - t.dining.depth / 2;
        const c1 = await drag(t, chair.id, chair.x, t.dining.y);
        const backFront = c1.y - c1.depth / 2 + 0.035;
        const under = c1.y + c1.depth / 2 - edge;
        const h1 = await hint(t, chair.id);
        await t.shot('Stuhl unter den Esstisch geschoben');
        const c2 = await drag(t, chair.id, chair.x, t.dining.y, true);
        await page.waitForTimeout(600);
        const h2 = await hint(t, chair.id);
        const l2 = (await levels2d(t))[chair.id];
        t.compares.push(...(await compare(t)));
        await t.shot('Stuhl mit Alt ganz unter den Tisch');
        const ok = backFront <= edge + 0.002 && backFront > edge - 0.06 && under > 0.3 && !h1 && Math.abs(c2.y - t.dining.y) < 0.05 && l2 === 'error' && /Lehne steht in „Esstisch 4 Personen“/.test(h2);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Ohne Alt: Lehne ${cm(edge - backFront)} cm vor der Tischkante gestoppt, Sitzfläche ${cm(under)} cm unter der Platte, Hinweis: ${h1 ? `„${h1}“` : 'keiner'}. Mit Alt ganz hinein: 2D-Umrandung ${l2}, Hinweis: „${h2 || '–'}“.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Tischlampe auf Tisch: Eine „Tischlampe“ einfügen und auf den Couch- oder Esstisch ziehen.',
      expected: 'Die Lampe steht auf der Tischplatte (in 3D sichtbar), ohne Warnung. Zieht man sie wieder herunter, steht sie am Boden.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Control+z'); // chair out of the table again
        const lamp = await add(t, 'Tischlampe', 0.5, 2.7);
        const on = await drag(t, lamp.id, t.dining.x + 0.3, t.dining.y);
        const h1 = await hint(t, lamp.id);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await t.lookAt({ x: 0.2, y: 1.9, z: 3.2 }, { x: t.dining.x, y: 0.75, z: t.dining.y });
        await page.waitForTimeout(1500);
        await t.shot('Tischlampe auf dem Esstisch (3D)');
        const off = await drag(t, lamp.id, 0.5, 2.7);
        const h2 = await hint(t, lamp.id);
        const ok = Math.abs(on.elevation - t.dining.height) < 0.02 && !h1 && off.elevation < 0.01 && !h2;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Tischlampe eingefügt und auf den Esstisch gezogen: steht auf ${cm(on.elevation)} cm (Tischplatte ${cm(t.dining.height)} cm), Hinweis: ${h1 ? `„${h1}“` : 'keiner'}. Wieder heruntergezogen: ${cm(off.elevation)} cm über dem Boden, Hinweis: ${h2 ? `„${h2}“` : 'keiner'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Teppich: Möbel auf den Teppich stellen.',
      expected: 'Keine Warnung.',
      async run(t) {
        const rug = await byCatalog(t, 'generic-rug-200');
        const l = await drag(t, t.lamp.id, rug.x - 0.6, rug.y - 0.9);
        const onRug = Math.abs(l.x - rug.x) < rug.width / 2 && Math.abs(l.y - rug.y) < rug.depth / 2;
        const h = await hint(t, l.id);
        const table = await byCatalog(t, 'generic-coffee-table');
        const ht = await hint(t, table.id);
        const m3 = await markers3d(t);
        return {
          status: onRug && !h && !ht && !m3[l.id] && !m3[rug.id] ? 'ok' : 'fail',
          observed: `Stehlampe auf den Teppich gezogen (${onRug ? 'steht auf dem Teppich' : 'nicht auf dem Teppich'}): Hinweis ${h ? `„${h}“` : 'keiner'}. Couchtisch auf dem Teppich: Hinweis ${ht ? `„${ht}“` : 'keiner'}. 3D-Markierung an Lampe oder Teppich: ${m3[l.id] || m3[rug.id] ? 'ja' : 'keine'}.`,
        };
      },
    },
    {
      nr: 6,
      action: 'Platz vor Schranktüren: Einen „Sessel“ ca. 30 cm vor den „Kleiderschrank 150 cm“ stellen.',
      expected: 'Oranger Hinweis „Vor ‚Kleiderschrank 150 cm‘ sind nur … cm frei“, in 3D eine orange Fläche vor dem Schrank. Bei ca. 80 cm Abstand verschwindet der Hinweis.',
      async run(t) {
        const { page } = t;
        const ward = await byCatalog(t, 'generic-wardrobe-150');
        const front = ward.y - ward.depth / 2;
        const chair = await add(t, 'Sessel', ward.x, 2.0);
        const s1 = await drag(t, chair.id, ward.x, front - 0.3 - chair.depth / 2);
        await page.waitForTimeout(600);
        const free1 = front - (s1.y + s1.depth / 2);
        const all1 = [await hint(t, chair.id), await hint(t, ward.id)].join(' ');
        const m1 = await markers3d(t);
        const orange3d = [...(m1[chair.id] ?? []), ...(m1[ward.id] ?? [])].some((k) => k.startsWith('clearance'));
        t.compares.push(...(await compare(t)));
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await t.lookAt({ x: 6.1, y: 2.4, z: 0.9 }, { x: 6.1, y: 0.4, z: 3.0 });
        await page.waitForTimeout(1500);
        await t.shot('Sessel 30 cm vor dem Kleiderschrank (3D)');
        const s2 = await drag(t, chair.id, ward.x, front - 0.8 - chair.depth / 2);
        await page.waitForTimeout(600);
        const free2 = front - (s2.y + s2.depth / 2);
        const all2 = [await hint(t, chair.id), await hint(t, ward.id)].join(' ').trim();
        const m2 = await markers3d(t);
        const orange2 = [...(m2[chair.id] ?? []), ...(m2[ward.id] ?? [])].some((k) => k.startsWith('clearance'));
        const ok = /Vor „Kleiderschrank 150 cm“ sind nur \d+ cm frei/.test(all1) && orange3d && !/sind nur/.test(all2) && !orange2;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Sessel ${cm(free1)} cm vor dem Schrank: Hinweis „${all1.trim() || '–'}“; orange Fläche in 3D: ${orange3d ? 'ja' : 'nein'}. Bei ${cm(free2)} cm: Hinweis ${all2 ? `„${all2}“` : 'keiner'}, orange Fläche ${orange2 ? 'noch da' : 'weg'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 7,
      action: 'Küchenzeile: Nordwand des Wohnzimmers wählen, im Bereich „Küchenzeile planen“ „Küchenzeile platzieren“.',
      expected: 'Keine Warnungen zwischen Unterschränken und Arbeitsplatte. Der Hochschrank steht bündig in der Ecke, kein Modul ragt in die Wand.',
      async run(t) {
        const { page } = t;
        const s = await t.planToScreen(1.0, -0.06);
        await page.mouse.click(s.x, s.y);
        const sel = (await t.selection())?.type;
        await page.locator('.panel.left nav.tabs').getByRole('button', { name: 'Küche', exact: true }).click();
        await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        await page.waitForTimeout(1000);
        const p = await t.project();
        const kitchen = p.furniture.filter((f) => f.kitchen);
        const ids = new Set(kitchen.map((f) => f.id));
        const m3 = await markers3d(t);
        const own = [];
        const other = [];
        for (const f of kitchen)
          for (const k of m3[f.id] ?? []) {
            const [kind, ref] = k.split(':');
            if (kind === 'wall' || (kind === 'overlap' && ids.has(ref))) own.push(`${f.name}: ${kind}`);
            else other.push(`${f.name}: ${kind}${ref ? ` (${p.furniture.find((x) => x.id === ref)?.name ?? ref})` : ''}`);
          }
        const tall = kitchen.find((f) => f.kitchen.type === 'tall');
        const westmost = Math.min(...kitchen.map((f) => f.x - fp(f).width / 2));
        const corner = tall && Math.abs(tall.x - fp(tall).width / 2) < 0.01;
        t.compares.push(...(await compare(t)));
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await t.lookAt({ x: 1.6, y: 2.2, z: 2.8 }, { x: 1.6, y: 0.8, z: 0.2 });
        await page.waitForTimeout(1500);
        return {
          status: sel === 'wall' && kitchen.length >= 6 && own.length === 0 && corner && westmost >= -0.001 ? 'ok' : 'fail',
          observed: `Nordwand ausgewählt (${sel}), Küchenzeile mit ${kitchen.length} Modulen platziert. Warnungen zwischen Küchenmodulen oder mit der Wand: ${own.join(', ') || 'keine'}. Hochschrank ${tall ? (corner ? 'bündig in der Ecke' : `nicht bündig (${cm(tall.x - fp(tall).width / 2)} cm)`) : 'nicht vorhanden'}; westlichstes Modul bei x ${de(westmost, 3)} m (Wand bei 0). ${other.length ? `Andere Hinweise an Küchenmodulen (nicht untereinander): ${other.join(', ')}.` : ''}`,
          caption: 'Küchenzeile an der Nordwand (3D)',
        };
      },
    },
    {
      nr: 8,
      action: 'Gleiches Ergebnis in 2D und 3D: Alles oben Genannte in beiden Ansichten ansehen.',
      expected: 'Die Warnungen stimmen überein.',
      async run(t) {
        const now = await compare(t);
        const all = [...new Set([...t.compares, ...now])];
        return {
          status: all.length === 0 ? 'ok' : 'fail',
          observed: all.length ? `Unterschiede zwischen 2D-Umrandung und 3D-Markierung: ${all.join('; ')}.` : 'Nach den Schritten 2, 3, 6 und 7 und am Ende verglichen: Bei jedem Möbel stimmen 2D-Umrandung (rot/orange/keine) und 3D-Markierung überein.',
          noFinalShot: true,
        };
      },
    },
  ],
};
