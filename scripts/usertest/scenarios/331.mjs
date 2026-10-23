// Begehen: Einblendung und Hinweis nennen F statt E für Türen (#331) – Testschritte aus dem Kommentar in #331.
const lookAt = (t, x, y, h) =>
  t.page.evaluate(([tx, ty, th]) => {
    const wp = window.__wp;
    const c = wp.three.camera.position;
    wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
  }, [x, y, h]);
const toastText = (t) => t.page.locator('.toasts').innerText().catch(() => '');

export default {
  issue: 331,
  name: 'Begehen: Tastenhinweise',
  title: 'Begehen: Einblendung und Hinweis nennen noch E für Türen und F als Objekt-Menü',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Begehen starten und die Einblendung unten lesen.',
      expected: '„F (oder Klick, O): Tür/Fenster öffnen/schließen“, „Q/E: Möbel drehen“, „Rechtsklick: Objekt-Menü“; kein „F: Objekt-Menü“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        const p = await t.project();
        t.table = p.furniture.find((f) => f.catalogId === 'generic-coffee-table');
        t.door = p.openings.find((o) => o.kind === 'door');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await page.waitForTimeout(500);
        const overlay = page.locator('.walk-overlay');
        const unlocked = (await overlay.innerText()).replace(/\s+/g, ' ');
        // as a user would: click into the view to capture the mouse, then the full key list is shown
        const b = await page.locator('canvas').first().boundingBox();
        await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.2);
        await page.waitForTimeout(600);
        const txt = (await overlay.innerText()).replace(/\s+/g, ' ');
        if (!/WASD\/Pfeiltasten/.test(txt)) return { status: 'look', observed: `Maus ließ sich in der Cloud-Umgebung nicht fangen (Pointer-Lock), die volle Tastenliste erschien nicht. Einblendung ohne gefangene Maus: „${unlocked}“; Einblendung danach: „${txt}“. Die Liste mit Q/E und Rechtsklick bitte am echten Rechner ansehen.` };
        await t.shot('Einblendung unten', { x: 0, y: 760, width: 1440, height: 140 });
        const ok = /F \(oder Klick, O\): Tür\/Fenster öffnen\/schließen/.test(txt) && /Q\/E: Möbel drehen/.test(txt) && /Rechtsklick: Objekt-Menü/.test(txt) && !/F: Objekt-Menü/.test(txt) && !/E \(oder Klick, O\)/.test(txt);
        return { status: ok ? 'ok' : 'fail', observed: `Einblendung: „${txt}“.` };
      },
    },
    {
      nr: 2,
      action: 'Ein Möbel mit G aufnehmen und F drücken.',
      expected: 'Hinweis „Erst ablegen (G), dann Tür/Fenster mit F bedienen“.',
      async run(t) {
        const { page } = t;
        const f = t.table;
        await lookAt(t, f.x, f.y, 0.3);
        await t.poll(async () => ((await page.evaluate(() => window.__wp.walk.target())) === f.id ? 1 : null));
        await page.keyboard.press('g');
        await page.waitForTimeout(2600);
        await page.keyboard.press('f');
        await page.waitForTimeout(400);
        const toast = (await toastText(t)).replace(/\s+/g, ' ');
        await t.shot('Hinweis beim Tragen');
        await page.keyboard.press('g');
        await page.waitForTimeout(300);
        const ok = /Erst ablegen \(G\), dann Tür\/Fenster mit F bedienen/.test(toast);
        return { status: ok ? 'ok' : 'fail', observed: `Hinweis: „${toast}“.` };
      },
    },
    {
      nr: 3,
      optional: true,
      action: 'Optional: Eigenschaften einer Tür öffnen, Tooltip am Öffnen-Schalter lesen.',
      expected: 'Nennt beim Begehen Taste F (oder Klick).',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => document.exitPointerLock?.());
        await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id }), t.door.id);
        await page.waitForTimeout(500);
        const title = await page.locator('.panel.right label.check', { hasText: /geöffnet/ }).first().getAttribute('title').catch(() => null);
        return { status: title && /beim Begehen Taste F \(oder Klick\)/.test(title) && !/Taste E/.test(title) ? 'ok' : 'fail', observed: `Tooltip des Schalters „Tür geöffnet“: „${title}“.` };
      },
    },
  ],
};
