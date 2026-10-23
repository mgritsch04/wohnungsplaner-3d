// Begehen: Tasten (F) funktionieren nach Eingabefeld-Fokus, Hinweise bei Sperre (#283) – Testschritte aus dem Kommentar in #283.
const proj = (t) => t.project();
const openOf = async (t, id) => (await proj(t)).openings.find((o) => o.id === id).open;
const leafCenter = (t, id) =>
  t.page.evaluate((oid) => {
    const th = window.__wp.three;
    const pivot = th.scene.getObjectByName(`leaf:${oid}:0`);
    const v = pivot.children[0].getWorldPosition(th.camera.position.clone());
    return { x: v.x, y: v.z };
  }, id);
const restingLeaf = async (t, id) => {
  let last = await leafCenter(t, id);
  for (let i = 0; i < 20; i++) {
    await t.page.waitForTimeout(150);
    const now = await leafCenter(t, id);
    const moved = Math.hypot(now.x - last.x, now.y - last.y);
    last = now;
    if (moved < 0.001) break;
  }
  return last;
};
const lookAt = (t, x, y, h) =>
  t.page.evaluate(([tx, ty, th]) => {
    const wp = window.__wp;
    const c = wp.three.camera.position;
    wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
  }, [x, y, h]);
const aimed = (t) => t.page.evaluate(() => window.__wp.walk.targetOpening());
const active = (t) => t.page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.type ? `[${a.type}]` : ''}` : 'none'; });
const sky = (t) => t.page.evaluate(() => window.__wp.walk.look(0, 1.2));
/** Tür anpeilen, F drücken, Zustand vorher/nachher */
async function pressF(t, key = 'f') {
  const leaf = await restingLeaf(t, t.door.id);
  await lookAt(t, leaf.x, leaf.y, 1.0);
  const hit = await t.poll(async () => (await aimed(t)) === t.door.id);
  const before = await openOf(t, t.door.id);
  await t.page.keyboard.press(key);
  await t.page.waitForTimeout(500);
  return { hit: !!hit, before, after: await openOf(t, t.door.id) };
}
const toastText = (t) => t.page.locator('.toasts').innerText().catch(() => '');
const canvasClick = async (t) => {
  await sky(t);
  const b = await t.page.locator('canvas').first().boundingBox();
  await t.page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.3);
  await t.page.waitForTimeout(300);
};

export default {
  issue: 283,
  name: 'Begehen: F nach Eingabefeld',
  title: 'Begehen: Tür-/Fenster-Taste funktioniert nach 2D/3D-Wechsel und Eingabefeldern, mit Hinweisen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, in 3D „Begehen“ starten.',
      expected: 'Begehen aktiv.',
      async run(t) {
        await t.freshStart();
        const p = await proj(t);
        t.door = p.openings.find((o) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
        t.table = p.furniture.find((f) => f.catalogId === 'generic-coffee-table');
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.getByRole('button', { name: 'Begehen' }).click();
        await t.page.getByTestId('crosshair').waitFor();
        return { status: 'ok', observed: 'Begehen aktiv, Fadenkreuz sichtbar.' };
      },
    },
    {
      nr: 2,
      action: 'Vorher ins Suchfeld des Katalogs klicken (bzw. einen Regler / eine Checkbox im Panel bedienen), dann in die 3D-Ansicht klicken.',
      expected: 'Der Fokus verlässt das Feld.',
      async run(t) {
        const { page } = t;
        const left = page.locator('.panel.left');
        await left.getByRole('button', { name: 'Katalog', exact: true }).click().catch(() => {});
        const search = page.getByLabel('Katalog durchsuchen');
        await search.click();
        const a1 = await active(t);
        await canvasClick(t);
        const a2 = await active(t);
        // Checkbox bzw. Regler im Panel
        await page.evaluate(() => document.exitPointerLock?.());
        await page.locator('.panel.right').getByRole('button', { name: 'Projekt' }).click();
        const cb = page.getByLabel('Kopfwippen beim Gehen');
        const sl = page.getByLabel('Sichtfeld beim Begehen');
        let a3, a4;
        await cb.focus();
        a3 = `${await active(t)} (Checkbox)`;
        await canvasClick(t);
        a4 = await active(t);
        await page.evaluate(() => document.exitPointerLock?.());
        await sl.focus();
        const a5 = `${await active(t)} (Regler)`;
        await canvasClick(t);
        const a6 = await active(t);
        return { status: /search/.test(a1) && !/^(input|textarea|select)/.test(a2) && !/^(input|textarea|select)/.test(a4) && /checkbox/.test(a3) && /^body/.test(a6) ? 'ok' : 'fail', observed: `Fokus nach Klick ins Suchfeld: ${a1}; nach Klick in die Ansicht: ${a2}. Checkbox fokussiert: ${a3}, nach Klick in die Ansicht: ${a4}; Regler fokussiert: ${a5}, nach Klick in die Ansicht: ${a6}.` };
      },
    },
    {
      nr: 3,
      action: 'Fadenkreuz auf die Tür richten (unter 6 m) und F drücken; ein zweites F kehrt das um.',
      expected: 'Die Tür öffnet bzw. schließt sich, ein zweites F kehrt das um.',
      async run(t) {
        const r1 = await pressF(t);
        const r2 = await pressF(t);
        return { status: r1.hit && r2.hit && r1.after === !r1.before && r2.after === r1.before ? 'ok' : 'fail', observed: `Tür im Fadenkreuz: ${r1.hit && r2.hit}; offen: ${r1.before} → F ${r1.after} → F ${r2.after}.` };
      },
    },
    {
      nr: 4,
      action: 'Im Katalog-Suchfeld Text tippen und dann F drücken, ohne in die Ansicht zu klicken. Danach Esc, wieder F.',
      expected: 'Ein Hinweis sagt, dass ein Eingabefeld aktiv ist. Nach Esc (oder Klick in die Ansicht) geht F wieder.',
      async run(t) {
        const { page } = t;
        const leaf = await restingLeaf(t, t.door.id);
        await lookAt(t, leaf.x, leaf.y, 1.0);
        const search = page.getByLabel('Katalog durchsuchen');
        await page.evaluate(() => document.exitPointerLock?.());
        await page.waitForTimeout(300);
        await search.click();
        await search.type('sofa');
        const before = await openOf(t, t.door.id);
        await page.keyboard.press('f');
        await page.waitForTimeout(400);
        const same = (await openOf(t, t.door.id)) === before;
        const toast = (await toastText(t)).replace(/\n/g, ' ');
        const typed = await search.inputValue();
        await t.shot('Hinweis Eingabefeld aktiv');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(2200);
        const r = await pressF(t);
        return { status: same && /Eingabefeld/.test(toast) && typed === 'sofaf' && r.after === !r.before ? 'ok' : 'fail', observed: `Tür unverändert: ${same}; Hinweis: „${toast}“; Suchfeld enthält „${typed}“ (F wurde als Text getippt); nach Esc öffnet/schließt F die Tür: ${r.before} → ${r.after}.` };
      },
    },
    {
      nr: 5,
      action: 'Ein Möbel aufnehmen (G) und F drücken.',
      expected: 'Hinweis „Erst ablegen (G)“.',
      async run(t) {
        const { page } = t;
        const f = t.table;
        await lookAt(t, f.x, f.y, 0.3);
        await t.poll(async () => (await page.evaluate(() => window.__wp.walk.target())) === f.id);
        await page.keyboard.press('g');
        await page.waitForTimeout(400);
        const before = await openOf(t, t.door.id);
        await page.waitForTimeout(2200);
        await page.keyboard.press('f');
        await page.waitForTimeout(400);
        const toast = (await toastText(t)).replace(/\n/g, ' ');
        const same = (await openOf(t, t.door.id)) === before;
        await t.shot('Hinweis Erst ablegen');
        await page.keyboard.press('g');
        await page.waitForTimeout(300);
        return { status: /Erst ablegen \(G\)/.test(toast) && same ? 'ok' : 'fail', observed: `Hinweis: „${toast}“; Tür unverändert: ${same}.${/mit E bedienen/.test(toast) ? ' Auffällig: Der Hinweis nennt noch „E“, obwohl seit mgritsch04/wohnungsplaner-3d#293 F Türen öffnet.' : ''}` };
      },
    },
  ],
};
