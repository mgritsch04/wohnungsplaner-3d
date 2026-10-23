// Gemeinsame Objekt-Kontext-Oberfläche in 2D, 3D und Ich-Ansicht (#235) – Testschritte aus dem Kommentar in #235.
const menu = (t) => t.page.getByTestId('object-menu');
const title = (t) => t.page.getByTestId('object-menu-title');
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
const table = (t) => t.furniture((f) => f.catalogId === 'generic-coffee-table');
const view = (t) => t.page.getByRole('button', { name: '2D', exact: true });

export default {
  issue: 235,
  name: 'Objekt-Kontextmenü',
  title: 'Gemeinsame Objekt-Kontext-Oberfläche in 2D, 3D und Ich-Ansicht',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Ansicht „2D“, mit der rechten Maustaste auf den Couchtisch klicken.',
      expected: 'Neben dem Mauszeiger erscheint ein Feld mit Name, Maßen (B × T × H) und den Knöpfen ↺ 90°, ↻ 90°, Duplizieren, Löschen, Eigenschaften.',
      async run(t) {
        await t.freshStart();
        await view(t).click();
        await t.page.waitForTimeout(600);
        const f = await table(t);
        const at = await t.planToScreen(f.x, f.y);
        await t.page.mouse.click(at.x, at.y, { button: 'right' });
        await menu(t).waitFor({ timeout: 4000 });
        const txt = await menu(t).innerText();
        const actions = await menu(t).locator('[data-action]').evaluateAll((els) => els.map((e) => e.getAttribute('data-action')));
        const ttl = (await title(t).innerText()).trim();
        const ok = ttl === f.name && /B × T × H/.test(txt) && ['rotate-left', 'rotate-right', 'duplicate', 'delete', 'properties'].every((a) => actions.includes(a));
        return { status: ok ? 'ok' : 'fail', observed: `Titel „${ttl}“ (Möbel: „${f.name}“); Maße im Feld: ${/B × T × H/.test(txt)}; Aktionen: ${actions.join(', ')}; Preis im Feld: ${/€/.test(txt)}.` };
      },
    },
    {
      nr: 2,
      action: 'Im Feld „↻ 90°“ drücken, danach Strg+Z.',
      expected: 'Der Tisch dreht sich um 90°, das Feld bleibt offen; Strg+Z dreht ihn in einem Schritt zurück.',
      async run(t) {
        const f0 = await table(t);
        const p0 = await past(t);
        await menu(t).locator('[data-action="rotate-right"]').click();
        await t.page.waitForTimeout(200);
        const f1 = await table(t);
        const p1 = await past(t);
        const open = await menu(t).isVisible();
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(200);
        const f2 = await table(t);
        const turned = Math.abs(f1.rotation - f0.rotation - Math.PI / 2) < 1e-3;
        const back = Math.abs(f2.rotation - f0.rotation) < 1e-3;
        return { status: turned && p1 === p0 + 1 && open && back ? 'ok' : 'fail', observed: `Drehung +${((f1.rotation - f0.rotation) * 180 / Math.PI).toFixed(0)}°, Undo-Schritte +${p1 - p0}, Feld offen: ${open}; nach Strg+Z zurück: ${back}.` };
      },
    },
    {
      nr: 3,
      action: 'Esc drücken.',
      expected: 'Das Feld schließt, der Tisch bleibt ausgewählt.',
      async run(t) {
        const f = await table(t);
        if (!(await menu(t).isVisible())) {
          const at = await t.planToScreen(f.x, f.y);
          await t.page.mouse.click(at.x, at.y, { button: 'right' });
          await menu(t).waitFor();
        }
        await t.page.keyboard.press('Escape');
        await t.page.waitForTimeout(200);
        const gone = (await menu(t).count()) === 0;
        const sel = await t.selection();
        return { status: gone && sel?.id === f.id ? 'ok' : 'fail', observed: `Feld geschlossen: ${gone}; Auswahl: ${sel?.type}/${sel?.id === f.id ? 'Couchtisch' : sel?.id}.` };
      },
    },
    {
      nr: 4,
      action: 'Mit gedrückter rechter Maustaste im Plan ziehen.',
      expected: 'Der Plan verschiebt sich wie bisher, es öffnet sich kein Feld.',
      async run(t) {
        const f = await table(t);
        const at = await t.planToScreen(f.x, f.y);
        const v0 = (await t.ui()).view2d;
        await t.page.mouse.move(at.x + 200, at.y);
        await t.page.mouse.down({ button: 'right' });
        await t.page.mouse.move(at.x + 260, at.y + 30, { steps: 5 });
        await t.page.mouse.up({ button: 'right' });
        await t.page.waitForTimeout(200);
        const v1 = (await t.ui()).view2d;
        const none = (await menu(t).count()) === 0;
        const moved = Math.abs(v1.cx - v0.cx) > 0.01 || Math.abs(v1.cy - v0.cy) > 0.01;
        return { status: none && moved ? 'ok' : 'fail', observed: `Plan verschoben: ${moved} (cx ${v0.cx.toFixed(2)} → ${v1.cx.toFixed(2)}); Feld offen: ${!none}.` };
      },
    },
    {
      nr: 5,
      action: 'Eine Tür im Plan anklicken, dann Umschalt+F10 drücken und im Feld „Öffnen“ bzw. „Schließen“ wählen.',
      expected: 'Das Feld zeigt „Tür“ mit Maßen; die Tür wechselt ihren Zustand, ein Undo-Schritt.',
      async run(t) {
        const p = await t.project();
        const door = p.openings.find((o) => o.kind === 'door');
        await t.page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id }), door.id);
        await t.page.keyboard.press('Shift+F10');
        await menu(t).waitFor({ timeout: 4000 });
        const ttl = (await title(t).innerText()).trim();
        const hasDims = /\d/.test(await menu(t).innerText());
        const p0 = await past(t);
        await menu(t).locator('[data-action="toggle-open"]').click();
        await t.page.waitForTimeout(200);
        const d1 = (await t.project()).openings.find((o) => o.id === door.id);
        const p1 = await past(t);
        return { status: ttl === 'Tür' && hasDims && d1.open === !door.open && p1 === p0 + 1 ? 'ok' : 'fail', observed: `Titel „${ttl}“, Maße angezeigt: ${hasDims}; open ${!!door.open} → ${!!d1.open}; Undo-Schritte +${p1 - p0}.` };
      },
    },
    {
      nr: 6,
      action: 'Ansicht „3D“ (Übersicht), mit der rechten Maustaste auf das TV-Board an der hinteren Wand klicken; dann auf eine Wand, hinter der ein Möbel steht.',
      expected: 'Dasselbe Feld wie in 2D für das TV-Board. Ein Rechtsklick auf eine Wand mit Möbel dahinter öffnet kein Feld.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const hidden = await table(t);
        const b = await t.worldToScreen(hidden.x, hidden.elevation + hidden.height * 0.9, hidden.y);
        await page.mouse.click(b.x, b.y, { button: 'right' });
        await page.waitForTimeout(400);
        const blocked = (await menu(t).count()) === 0;
        const tv = await t.furniture((f) => f.catalogId === 'generic-tv-sideboard');
        const a = await t.worldToScreen(tv.x, tv.elevation + tv.height * 0.9, tv.y);
        await page.mouse.click(a.x, a.y, { button: 'right' });
        await menu(t).waitFor({ timeout: 4000 }).catch(() => undefined);
        const shown = await menu(t).isVisible();
        const ttl = shown ? (await title(t).innerText()).trim() : '';
        const place = shown ? await menu(t).getAttribute('data-place') : '';
        await t.shot('3D-Feld am TV-Board');
        return { status: blocked && shown && ttl === tv.name ? 'ok' : 'fail', observed: `Wand vor Möbel: kein Feld = ${blocked}; TV-Board: Feld = ${shown}, Titel „${ttl}“ (Möbel „${tv.name}“), Ort ${place}.` };
      },
    },
    {
      nr: 7,
      action: '„Begehen“, in die Ansicht klicken, auf ein Möbel zielen und F drücken.',
      expected: 'Das Feld erscheint unter dem Fadenkreuz mit „Tragen“; „Tragen“ hebt das Möbel auf, F zeigt dann „Absetzen“.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        const f = await table(t);
        await page.evaluate(([tx, ty]) => {
          const wp = window.__wp;
          const c = wp.three.camera.position;
          const dist = Math.hypot(tx - c.x, ty - c.z);
          wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y - 0.3, dist));
        }, [f.x, f.y]);
        const tgt = await t.poll(async () => (await page.evaluate(() => window.__wp.walk.target())) === f.id);
        await page.keyboard.press('f');
        await page.waitForTimeout(500);
        const fOpens = await menu(t).isVisible(); // seit #257 öffnet/schließt F Türen und Fenster
        const box = await page.getByTestId('crosshair').boundingBox();
        if (!fOpens) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await menu(t).waitFor({ timeout: 4000 }).catch(() => undefined);
        const shown = await menu(t).isVisible();
        const carry = shown && (await menu(t).locator('[data-action="carry"]').count()) === 1;
        let carried = false;
        let drop = false;
        if (carry) {
          await menu(t).locator('[data-action="carry"]').click();
          carried = !!(await t.poll(async () => (await t.ui()).walkCarry === f.id));
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await page.waitForTimeout(300);
          drop = (await menu(t).locator('[data-action="drop"]').count()) === 1;
        }
        await t.shot('Feld in der Ich-Ansicht');
        return { status: tgt && fOpens && carry && carried && drop ? 'ok' : 'fail', observed: `Ziel erkannt: ${!!tgt}; Feld nach F: ${fOpens} (F öffnet seit #257 Türen/Fenster); per Rechtsklick am Fadenkreuz: Feld ${shown}, „Tragen“ ${carry}; getragen: ${carried}; danach Rechtsklick zeigt „Absetzen“: ${drop}.` };
      },
    },
    {
      nr: 8,
      optional: true,
      action: 'Optional (Handy): Möbel antippen und in der unteren Auswahlleiste auf „⋯“ tippen.',
      expected: 'Das Feld öffnet sich als Blatt von unten; „Eigenschaften“ öffnet das Details-Blatt.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.exitPointerLock?.());
        await page.setViewportSize({ width: 390, height: 664 });
        await page.waitForTimeout(800);
        const isPhone = (await page.locator('.app.phone').count()) > 0;
        if (!isPhone) return { status: 'skip', observed: 'Handy-Layout ließ sich per Fenstergröße nicht erzwingen; nur im Handy-Emulationslauf prüfbar.' };
        const f = await table(t);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), f.id);
        await page.getByTestId('mobile-object-menu').click();
        const sheet = await menu(t).evaluate((e) => e.className);
        const ttl = (await title(t).innerText()).trim();
        await t.shot('Blatt von unten');
        await menu(t).locator('[data-action="properties"]').click();
        await page.waitForTimeout(400);
        const detail = (await page.locator('.app.phone.sheet-right').count()) > 0;
        return { status: /sheet/.test(sheet) && detail ? 'ok' : 'fail', observed: `Feld-Klasse „${sheet}“, Titel „${ttl}“; Details-Blatt offen: ${detail}.`, noFinalShot: false };
      },
    },
    {
      nr: 9,
      optional: true,
      action: 'Optional: Smart-Home-Gerät (Lampe) im 2D-Plan per Rechtsklick öffnen.',
      expected: 'Feld mit Gerätetyp, Status und „Einschalten“/„Ausschalten“.',
      async run(t) {
        const { page } = t;
        await page.setViewportSize({ width: 1440, height: 900 });
        await t.freshStart();
        await page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
        const panel = page.locator('.panel.left').getByTestId('smarthome-panel');
        await panel.locator('[data-testid="device-kind"][data-kind="light"]').click();
        await panel.getByTestId('device-add').click();
        await page.waitForTimeout(300);
        const dev = (await t.project()).devices[0];
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const at = await t.planToScreen(dev.x, dev.y);
        await page.mouse.click(at.x, at.y, { button: 'right' });
        await menu(t).waitFor({ timeout: 4000 }).catch(() => undefined);
        const shown = await menu(t).isVisible();
        const txt = shown ? (await menu(t).innerText()).replace(/\n/g, ' | ') : '';
        return { status: shown && /Einschalten|Ausschalten/.test(txt) ? 'ok' : 'fail', observed: `Feld sichtbar: ${shown}; Inhalt: ${txt}.` };
      },
    },
  ],
};
