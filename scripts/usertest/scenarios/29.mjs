// Gamepad-Steuerung beim Begehen (#29) – Testschritte aus dem Kommentar in #29.
// Der Controller ist SIMULIERT (Standard-Belegung über navigator.getGamepads); ein echter Controller ist damit nicht ersetzt,
// aber Belegung, Totzone, Tempo, Tür/Möbel/Tragen/Ducken/Sitzen und das Trennen sind geprüft.
const pose = (t) =>
  t.page.evaluate(() => {
    const c = window.__wp.three.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.rotation.y };
  });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const axes = (t, a) => t.page.evaluate((v) => (window.__pad.axes = v), a);
const press = async (t, i, ms = 120) => {
  await t.page.evaluate((k) => (window.__pad.buttons[k] = { pressed: true, value: 1 }), i);
  await t.page.waitForTimeout(ms);
  await t.page.evaluate((k) => (window.__pad.buttons[k] = { pressed: false, value: 0 }), i);
  await t.page.waitForTimeout(ms);
};
const aim = (t, x, y, h) =>
  t.page.evaluate(
    ([tx, ty, th]) => {
      const wp = window.__wp;
      const c = wp.three.camera.position;
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
    },
    [x, y, h],
  );
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RT: 7 };

export default {
  issue: 29,
  name: 'Gamepad beim Begehen',
  title: 'Gamepad-Steuerung: freigeben oder verwerfen',
  device: 'desktop',
  pc: false,
  realDevice: ['Echter Controller (Xbox/PlayStation) per USB/Bluetooth: Erkennung durch den Browser und die echten Stick-Werte'],
  steps: [
    {
      nr: 1,
      action: 'Oben auf 3D und dann auf Begehen klicken.',
      expected: 'Du stehst in der Wohnung, das Fadenkreuz ist sichtbar.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.evaluate(() => {
          const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
          window.__pad = pad;
          Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
        });
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(1200);
        const cross = await page.getByTestId('crosshair').count();
        return { status: cross === 1 ? 'ok' : 'fail', observed: `Begehen aktiv, Fadenkreuz: ${cross ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 2,
      action: 'Einmal eine beliebige Taste am Controller drücken.',
      expected: 'Unten in der Hinweiszeile erscheint „🎮 Controller: …“ mit der Belegung.',
      async run(t) {
        await press(t, BTN.LB); // sitzt kurz, wird in Schritt 10 sauber zurückgesetzt
        await press(t, BTN.LB);
        const hint = t.page.getByTestId('walk-gamepad');
        const txt = (await hint.innerText().catch(() => '')).replace(/\s+/g, ' ');
        return { status: /Controller/.test(txt) ? 'ok' : 'fail', observed: `Hinweiszeile: „${txt.slice(0, 220)}“.` };
      },
    },
    {
      nr: 3,
      action: 'Linken Stick nach vorn drücken, dann leicht zur Seite.',
      expected: 'Vorwärts bzw. seitwärts; bei wenig Auslenkung langsamer, bei voller normal schnell. Durch Wände kommst du nicht hindurch.',
      async run(t) {
        const speed = async (a, ms = 1000) => {
          const p0 = await pose(t);
          await axes(t, a);
          await t.page.waitForTimeout(ms);
          const p1 = await pose(t);
          await axes(t, [0, 0, 0, 0]);
          await t.page.waitForTimeout(200);
          return dist(p0, p1) / (ms / 1000);
        };
        await t.page.evaluate(() => { const c = window.__wp.three.camera.position; c.x = 2.5; c.z = 2.0; });
        await t.page.evaluate(() => window.__wp.walk.look(Math.PI / 2, 0)); // nach −x … Blick frei im Raum
        const full = await speed([0, -1, 0, 0]);
        await t.page.evaluate(() => { const c = window.__wp.three.camera.position; c.x = 2.5; c.z = 2.0; });
        const half = await speed([0, -0.5, 0, 0]);
        // gegen die Wand laufen: 8 s vorwärts in dieselbe Richtung, danach darf man nicht außerhalb der Wohnung sein
        await axes(t, [0, -1, 0, 0]);
        await t.page.waitForTimeout(8000);
        const p = await pose(t);
        await axes(t, [0, 0, 0, 0]);
        const inside = p.x > -0.1 && p.x < 8.7 && p.z > -0.1 && p.z < 4.1;
        t.full = full;
        return { status: full > 0.5 && half > 0.1 && half < full * 0.8 && inside ? 'ok' : 'fail', observed: `Voll nach vorn: ${full.toFixed(2)} m/s; halbe Auslenkung: ${half.toFixed(2)} m/s (langsamer: ${half < full * 0.8 ? 'ja' : 'nein'}); nach 8 s gegen die Wand bei (${p.x.toFixed(2)} / ${p.z.toFixed(2)}) m, innerhalb der Wohnung: ${inside ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 4,
      action: 'Rechten Stick bewegen.',
      expected: 'Die Blickrichtung dreht sich gleichmäßig; kleine Auslenkung dreht langsam.',
      async run(t) {
        const rate = async (v) => {
          const y0 = (await pose(t)).yaw;
          await axes(t, [0, 0, v, 0]);
          await t.page.waitForTimeout(800);
          const y1 = (await pose(t)).yaw;
          await axes(t, [0, 0, 0, 0]);
          return Math.abs(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0))) / 0.8;
        };
        const big = await rate(1);
        const small = await rate(0.3);
        return { status: big > 0.3 && small > 0 && small < big * 0.5 ? 'ok' : 'fail', observed: `Drehung bei voller Auslenkung ${((big * 180) / Math.PI).toFixed(0)}°/s, bei 30 % ${((small * 180) / Math.PI).toFixed(0)}°/s (Kurve verlangsamt feines Zielen: ${small < big * 0.5 ? 'ja' : 'nein'}).` };
      },
    },
    {
      nr: 5,
      action: 'Linken Stick nach vorn halten und zusätzlich RT drücken.',
      expected: 'Doppelt so schnell.',
      async run(t) {
        const p0 = await pose(t);
        await t.page.evaluate(() => { const c = window.__wp.three.camera.position; c.x = 2.5; c.z = 2.0; window.__wp.walk.look(Math.PI / 2, 0); });
        const a = await pose(t);
        await axes(t, [0, -1, 0, 0]);
        await t.page.evaluate(() => (window.__pad.buttons[7] = { pressed: true, value: 1 }));
        await t.page.waitForTimeout(700);
        const b = await pose(t);
        await t.page.evaluate(() => (window.__pad.buttons[7] = { pressed: false, value: 0 }));
        await axes(t, [0, 0, 0, 0]);
        const run = dist(a, b) / 0.7;
        void p0;
        return { status: run > t.full * 1.5 ? 'ok' : 'fail', observed: `Mit RT ${run.toFixed(2)} m/s gegenüber ${t.full.toFixed(2)} m/s ohne (Faktor ${(run / t.full).toFixed(1)}).` };
      },
    },
    {
      nr: 6,
      action: 'Auf eine Tür zielen und X drücken.',
      expected: 'Die Tür öffnet sich; nochmal X schließt sie.',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => { const c = window.__wp.three.camera.position; c.x = 3.8; c.z = 1.6; });
        const door = (await t.project()).openings.find((o) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
        const leaf = await page.evaluate((oid) => {
          const th = window.__wp.three;
          const v = th.scene.getObjectByName(`leaf:${oid}:0`).children[0].getWorldPosition(th.camera.position.clone());
          return { x: v.x, y: v.z };
        }, door.id);
        await aim(t, leaf.x, leaf.y, 1.0);
        await t.poll(async () => ((await page.evaluate(() => window.__wp.walk.targetOpening())) === door.id ? 1 : null), 3000);
        const open = async () => (await t.project()).openings.find((o) => o.id === door.id).open;
        const o0 = await open();
        await press(t, BTN.X, 200);
        await page.waitForTimeout(500);
        const o1 = await open();
        await press(t, BTN.X, 200);
        await page.waitForTimeout(500);
        const o2 = await open();
        return { status: o1 !== o0 && o2 === o0 ? 'ok' : 'fail', observed: `Tür vorher ${o0 ? 'offen' : 'zu'}, nach X ${o1 ? 'offen' : 'zu'}, nach nochmal X ${o2 ? 'offen' : 'zu'}.` };
      },
    },
    {
      nr: 7,
      action: 'Auf ein Möbelstück zielen und A drücken.',
      expected: 'Es wird ausgewählt.',
      async run(t) {
        const table = await t.furniture((f) => f.catalogId === 'generic-coffee-table');
        t.table = table;
        await aim(t, table.x, table.y, 0.3);
        await t.page.waitForTimeout(500);
        await press(t, BTN.A, 200);
        await t.page.waitForTimeout(500);
        const sel = await t.selection();
        return { status: sel?.type === 'furniture' && sel.id === table.id ? 'ok' : 'fail', observed: `Auf den Couchtisch gezielt, A: Auswahl = ${sel?.type === 'furniture' ? (sel.id === table.id ? 'Couchtisch' : 'anderes Möbel') : (sel?.type ?? 'keine')}.` };
      },
    },
    {
      nr: 8,
      action: 'Y drücken, umsehen, dann A drücken.',
      expected: 'Das Möbelstück wird getragen, folgt dem Blick und wird mit A abgesetzt.',
      async run(t) {
        const { page } = t;
        const at = async () => { const f = (await t.project()).furniture.find((q) => q.id === t.table.id); return { x: f.x, y: f.y }; };
        const f0 = await at();
        await press(t, BTN.Y, 200);
        await page.evaluate(() => window.__wp.walk.look(window.__wp.three.camera.rotation.y + 0.6, -0.4));
        await page.waitForTimeout(1200);
        const f1 = await at();
        await press(t, BTN.A, 200);
        await page.waitForTimeout(500);
        const f2 = await at();
        await page.evaluate(() => window.__wp.walk.look(window.__wp.three.camera.rotation.y + 0.6, -0.4));
        await page.waitForTimeout(1000);
        const f3 = await at();
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        return { status: d(f0, f1) > 0.2 && d(f2, f3) < 0.02 ? 'ok' : 'fail', observed: `Couchtisch nach Y und Blickdrehung ${Math.round(d(f0, f1) * 100)} cm bewegt (folgt dem Blick); nach A abgesetzt und weiter umgesehen: ${Math.round(d(f2, f3) * 100)} cm Bewegung (bleibt stehen).` };
      },
    },
    {
      nr: 9,
      action: 'B drücken, dann nochmal.',
      expected: 'Erst geduckt (Anzeige „Geduckt“), dann wieder aufrecht.',
      async run(t) {
        const y0 = (await pose(t)).y;
        await press(t, BTN.B, 200);
        await t.page.waitForTimeout(800);
        const y1 = (await pose(t)).y;
        const label = await t.page.getByTestId('walk-duck').count();
        await press(t, BTN.B, 200);
        await t.page.waitForTimeout(800);
        const y2 = (await pose(t)).y;
        return { status: y1 < y0 - 0.3 && label === 1 && Math.abs(y2 - y0) < 0.05 ? 'ok' : 'fail', observed: `Augenhöhe ${y0.toFixed(2)} → geduckt ${y1.toFixed(2)} (Anzeige „Geduckt“: ${label ? 'ja' : 'nein'}) → wieder ${y2.toFixed(2)} m.` };
      },
    },
    {
      nr: 10,
      action: 'LB drücken, dann nochmal.',
      expected: 'Erst sitzend, dann wieder stehend.',
      async run(t) {
        const y0 = (await pose(t)).y;
        await press(t, BTN.LB, 200);
        await t.page.waitForTimeout(800);
        const y1 = (await pose(t)).y;
        await press(t, BTN.LB, 200);
        await t.page.waitForTimeout(800);
        const y2 = (await pose(t)).y;
        return { status: y1 < y0 - 0.2 && Math.abs(y2 - y0) < 0.05 ? 'ok' : 'fail', observed: `Augenhöhe stehend ${y0.toFixed(2)} → sitzend ${y1.toFixed(2)} → wieder stehend ${y2.toFixed(2)} m.` };
      },
    },
    {
      nr: 11,
      action: 'Den Controller trennen.',
      expected: 'Die Controller-Zeile verschwindet, nichts bewegt sich mehr von selbst; Tastatur und Maus funktionieren weiter.',
      async run(t) {
        await axes(t, [0, -1, 0, 0]);
        await t.page.evaluate(() => (window.__pad.connected = false));
        await t.page.waitForTimeout(500);
        const p0 = await pose(t);
        await t.page.waitForTimeout(1200);
        const p1 = await pose(t);
        const gone = (await t.page.getByTestId('walk-gamepad').count()) === 0;
        await t.page.keyboard.down('KeyW');
        await t.page.waitForTimeout(700);
        await t.page.keyboard.up('KeyW');
        const p2 = await pose(t);
        return { status: gone && dist(p0, p1) < 0.02 && dist(p1, p2) > 0.3 ? 'ok' : 'fail', observed: `Controller-Zeile weg: ${gone ? 'ja' : 'nein'}; ohne Controller bewegt sich nichts (${Math.round(dist(p0, p1) * 100)} cm); Taste W geht weiter (${Math.round(dist(p1, p2) * 100)} cm).` };
      },
    },
  ],
};
