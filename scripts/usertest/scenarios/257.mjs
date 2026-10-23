// Begehen: Tasten neu belegen – F öffnet, Q/E drehen, Rechtsklick-Menü, Klick ins Leere (#257) – Testschritte aus dem Kommentar in #257.
const proj = (t) => t.project();
const openOf = async (t, id) => (await proj(t)).openings.find((o) => o.id === id).open;
const rotOf = async (t, id) => (await proj(t)).furniture.find((f) => f.id === id).rotation;
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

export default {
  issue: 257,
  name: 'Begehen: neue Tastenbelegung',
  title: 'Begehen: Tasten neu belegen (F öffnet, Q/E drehen, Kontextmenü per Rechtsklick, Klick ins Leere hebt Auswahl auf)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Ich-Ansicht („Begehen“) starten.',
      expected: 'Fadenkreuz sichtbar.',
      async run(t) {
        await t.freshStart();
        const p = await proj(t);
        t.win = p.openings.find((o) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6);
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
      action: 'Fadenkreuz auf die Tür richten, F drücken, dann noch einmal F. O macht dasselbe, E öffnet nichts mehr.',
      expected: 'Die Tür öffnet und schließt sich. O macht dasselbe, E öffnet nichts mehr.',
      async run(t) {
        const { page } = t;
        const door0 = await openOf(t, t.door.id);
        const leaf = await restingLeaf(t, t.door.id);
        await lookAt(t, leaf.x, leaf.y, 1.0);
        const hit = await t.poll(async () => (await aimed(t)) === t.door.id);
        await page.keyboard.press('f');
        await page.waitForTimeout(500);
        const afterF1 = await openOf(t, t.door.id);
        await restingLeaf(t, t.door.id);
        const leaf2 = await restingLeaf(t, t.door.id);
        await lookAt(t, leaf2.x, leaf2.y, 1.0);
        await t.poll(async () => (await aimed(t)) === t.door.id);
        await page.keyboard.press('f');
        await page.waitForTimeout(500);
        const afterF2 = await openOf(t, t.door.id);
        await restingLeaf(t, t.door.id);
        const leaf3 = await restingLeaf(t, t.door.id);
        await lookAt(t, leaf3.x, leaf3.y, 1.0);
        await t.poll(async () => (await aimed(t)) === t.door.id);
        await page.keyboard.press('o');
        await page.waitForTimeout(500);
        const afterO = await openOf(t, t.door.id);
        await restingLeaf(t, t.door.id);
        const leaf4 = await restingLeaf(t, t.door.id);
        await lookAt(t, leaf4.x, leaf4.y, 1.0);
        await t.poll(async () => (await aimed(t)) === t.door.id);
        await page.keyboard.press('e');
        await page.waitForTimeout(500);
        const afterE = await openOf(t, t.door.id);
        return { status: hit && afterF1 === !door0 && afterF2 === door0 && afterO === !door0 && afterE === afterO ? 'ok' : 'fail', observed: `Tür auf Zielkreuz erkannt: ${!!hit}; Zustand offen: Start ${door0} → F ${afterF1} → F ${afterF2} → O ${afterO} → E ${afterE} (E ändert nichts).` };
      },
    },
    {
      nr: 3,
      action: 'Das Möbel mit Klick auswählen und Q bzw. E drücken; Strg+Z.',
      expected: 'Das Möbel dreht sich je Druck um 15° nach links bzw. rechts. Strg+Z macht jeden Schritt einzeln rückgängig.',
      async run(t) {
        const { page } = t;
        const f = t.table;
        await lookAt(t, f.x, f.y, 0.3);
        await t.poll(async () => (await page.evaluate(() => window.__wp.walk.target())) === f.id);
        await page.evaluate(() => window.__wp.walk.pickOrDrop());
        await page.waitForTimeout(300);
        let sel = await t.selection();
        const clickSelected = sel?.id === f.id;
        if (!clickSelected) await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), f.id);
        const r0 = await rotOf(t, f.id);
        await page.keyboard.press('e');
        await page.waitForTimeout(250);
        const r1 = await rotOf(t, f.id);
        await page.keyboard.press('e');
        await page.waitForTimeout(250);
        const r2 = await rotOf(t, f.id);
        await page.keyboard.press('q');
        await page.waitForTimeout(250);
        const r3 = await rotOf(t, f.id);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const u1 = await rotOf(t, f.id);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const u2 = await rotOf(t, f.id);
        const deg = (a, b) => ((a - b) * 180) / Math.PI;
        const ok = Math.abs(deg(r1, r0) - 15) < 0.1 && Math.abs(deg(r2, r1) - 15) < 0.1 && Math.abs(deg(r3, r2) + 15) < 0.1 && Math.abs(u1 - r2) < 1e-6 && Math.abs(u2 - r1) < 1e-6;
        return { status: ok ? 'ok' : 'fail', observed: `Auswahl per Klick am Fadenkreuz: ${clickSelected}; E: ${deg(r1, r0).toFixed(0)}°, E: ${deg(r2, r1).toFixed(0)}°, Q: ${deg(r3, r2).toFixed(0)}°; Strg+Z zweimal: zurück auf ${deg(u1, r0).toFixed(0)}° und ${deg(u2, r0).toFixed(0)}° (je ein Schritt).` };
      },
    },
    {
      nr: 4,
      action: 'Rechtsklick auf das Möbel; F drücken; Tastenkürzel-Hilfe (?) ansehen.',
      expected: 'Das Kontextmenü öffnet sich. F öffnet kein Menü mehr, die Hilfe zeigt die neue Belegung.',
      async run(t) {
        const { page } = t;
        const f = t.table;
        await lookAt(t, f.x, f.y, 0.3);
        await t.poll(async () => (await page.evaluate(() => window.__wp.walk.target())) === f.id);
        const box = await page.getByTestId('crosshair').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        const menu = page.getByTestId('object-menu');
        await menu.waitFor({ timeout: 4000 }).catch(() => undefined);
        const shown = await menu.isVisible();
        const ttl = shown ? (await page.getByTestId('object-menu-title').innerText()).trim() : '';
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('f');
        await page.waitForTimeout(400);
        const fMenu = await menu.count();
        await page.getByTitle('Hilfe & Tastenkürzel').click();
        await page.waitForTimeout(400);
        const help = await page.locator('[role="dialog"]').first().innerText().catch(() => '');
        const lines = help.split('\n').map((l) => l.trim());
        const pick = (re) => lines.filter((l) => re.test(l)).join(' / ').slice(0, 160);
        await t.shot('Tastenkürzel-Hilfe');
        await page.keyboard.press('Escape');
        const helpOk = /F\s*\/\s*O/.test(help) && /Q\s*\/\s*E|Q und E|Q.*E/.test(help);
        return { status: shown && ttl === f.name && fMenu === 0 && helpOk ? 'ok' : 'fail', observed: `Rechtsklick am Fadenkreuz: Menü ${shown} („${ttl}“); F danach öffnet ein Menü: ${fMenu > 0}; Hilfe zeigt: „${pick(/F\s*\/\s*O|Q\s*\/\s*E|Rechtsklick/)}“.` };
      },
    },
    {
      nr: 5,
      action: 'Ins Leere klicken, z. B. auf Boden oder Decke.',
      expected: 'Die Auswahl ist aufgehoben.',
      async run(t) {
        const { page } = t;
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), t.table.id);
        let empty = false;
        for (let i = 0; i < 16 && !empty; i++) {
          await page.evaluate((yaw) => window.__wp.walk.look(yaw, 0.9), (i * Math.PI) / 8);
          await page.waitForTimeout(150);
          empty = (await aimed(t)) === null && (await page.evaluate(() => window.__wp.walk.target())) === null;
        }
        await page.evaluate(() => window.__wp.walk.pickOrDrop());
        await page.waitForTimeout(250);
        const sel = await t.selection();
        return { status: empty && sel === null ? 'ok' : 'fail', observed: `Blick zur Decke ohne Treffer: ${empty}; Auswahl danach: ${sel ? sel.type : 'keine'}. (Klick im Test über dieselbe Funktion wie der Mausklick in der Ich-Ansicht ausgelöst.)` };
      },
    },
  ],
};
