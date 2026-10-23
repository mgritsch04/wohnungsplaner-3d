// Bedienung der 3D-Übersicht mit Maus und Tasten (#132) – Testschritte aus dem Kommentar in #132.
const cam = (t) => t.page.evaluate(() => window.__wp.three.camera.position.toArray());
const dir = (t) => t.page.evaluate(() => { const m = window.__wp.three.camera.matrixWorld.elements; return [-m[8], -m[9], -m[10]]; });
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const tool = (t) => t.page.evaluate(() => window.__wp.useUiStore.getState().tool);
const settle = (t) =>
  t.poll(async () => {
    const a = await cam(t);
    await t.page.waitForTimeout(250);
    return d3(await cam(t), a) < 0.001;
  }, 15000);
const reset = async (t) => {
  await t.page.getByRole('button', { name: 'Kamera zurücksetzen' }).click();
  await t.page.waitForTimeout(800);
  await settle(t);
};
const hover3d = (t) => t.page.locator('[data-testid="scene3d"]').hover();
const bedOf = async (t) => (await t.project()).furniture.find((f) => f.catalogId === 'generic-bed-160');
const keyTravel = async (t, key, ms, shift) => {
  await settle(t);
  const c0 = await cam(t);
  if (shift) await t.page.keyboard.down('Shift');
  await t.page.keyboard.down(key);
  await t.page.waitForTimeout(ms);
  await t.page.keyboard.up(key);
  if (shift) await t.page.keyboard.up('Shift');
  await settle(t);
  return { c0, c1: await cam(t) };
};

export default {
  issue: 132,
  name: 'Bedienung der 3D-Übersicht',
  title: 'Bedienung der 3D-Übersicht mit Maus und Tasten',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Oben auf 3D klicken (Modus „Übersicht“).',
      expected: 'Die Wohnung ist von schräg oben zu sehen; unten links steht ein kleines Feld „Steuerung“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1800);
        const help = t.page.getByTestId('orbit-help');
        const b = await help.boundingBox();
        const vp = t.page.viewportSize();
        const c = await cam(t);
        await t.shot('132-uebersicht');
        const pitch = Math.atan2(c[1], Math.hypot(c[0] - 3.5, c[2] - 2.5)) * 180 / Math.PI;
        return { status: (await help.getByText('Steuerung').isVisible()) && b.x < vp.width * 0.4 && b.y > vp.height * 0.7 && c[1] > 3 ? 'ok' : 'fail', observed: `Feld „Steuerung“ sichtbar, unten links (x ${Math.round(b.x)}, y ${Math.round(b.y)}); Kamera bei Höhe ${c[1].toFixed(1)} m, ca. ${Math.round(pitch)}° über dem Boden gesehen von der Wohnungsmitte (schräg von oben).` };
      },
    },
    {
      nr: 2,
      action: 'Auf „Steuerung“ klicken, dann auf „Alle Tastenkürzel (?)“, Hilfe mit Esc schließen.',
      expected: 'Die Hilfe öffnet sich und enthält den Abschnitt „3D-Übersicht: Kamera“.',
      async run(t) {
        const help = t.page.getByTestId('orbit-help');
        await help.getByText('Steuerung').click();
        const mid = (await help.innerText()).includes('mittlere Maustaste');
        await help.getByRole('button', { name: 'Alle Tastenkürzel (?)' }).click();
        const dlg = t.page.getByRole('dialog');
        await dlg.waitFor();
        const has = (await dlg.innerText()).includes('3D-Übersicht: Kamera');
        await t.page.keyboard.press('Escape');
        const closed = (await t.page.getByRole('dialog').count()) === 0;
        await help.getByText('Steuerung').click();
        return { status: mid && has && closed ? 'ok' : 'fail', observed: `Kurzliste nennt „mittlere Maustaste“: ${mid}; Hilfe-Dialog enthält „3D-Übersicht: Kamera“: ${has}; Esc schließt: ${closed}.` };
      },
    },
    {
      nr: 3,
      action: 'Mauszeiger auf ein Möbel am Rand stellen und das Mausrad nach vorne drehen, dann zurück.',
      expected: 'Die Ansicht zoomt auf die Stelle unter dem Mauszeiger zu (nicht nur auf die Mitte). Zurückdrehen zoomt heraus.',
      async run(t) {
        await settle(t);
        const bed = await bedOf(t);
        const s0 = await t.worldToScreen(bed.x, 0.5, bed.y);
        const c0 = await cam(t);
        const mid = await t.page.locator('[data-testid="scene3d"] canvas').boundingBox();
        await t.page.mouse.move(s0.x, s0.y);
        for (let i = 0; i < 4; i++) { await t.page.mouse.wheel(0, -300); await t.page.waitForTimeout(150); }
        await settle(t);
        const s1 = await t.worldToScreen(bed.x, 0.5, bed.y);
        const c1 = await cam(t);
        const cx = mid.x + mid.width / 2;
        const cy = mid.y + mid.height / 2;
        const towardsCursor = Math.hypot(s1.x - s0.x, s1.y - s0.y) < Math.hypot(s1.x - cx, s1.y - cy) * 0.6 + 40;
        for (let i = 0; i < 4; i++) { await t.page.mouse.wheel(0, 300); await t.page.waitForTimeout(150); }
        await settle(t);
        const c2 = await cam(t);
        const dist = (c) => Math.hypot(c[0] - bed.x, c[1] - 0.5, c[2] - bed.y);
        return { status: dist(c1) < dist(c0) * 0.9 && towardsCursor && dist(c2) > dist(c1) * 1.05 ? 'ok' : 'fail', observed: `Abstand zum Bett vorher ${dist(c0).toFixed(1)} m, nach Vorwärts-Drehen ${dist(c1).toFixed(1)} m, nach Zurückdrehen ${dist(c2).toFixed(1)} m. Das Bett wanderte auf dem Bildschirm von (${Math.round(s0.x)}|${Math.round(s0.y)}) nach (${Math.round(s1.x)}|${Math.round(s1.y)}) (Mauszeiger war bei ${Math.round(s0.x)}|${Math.round(s0.y)}; Bildmitte ${Math.round(cx)}|${Math.round(cy)}), es bleibt also nah am Zeiger: ${towardsCursor}.` };
      },
    },
    {
      nr: 4,
      action: 'Mit der mittleren Maustaste auf einem Möbel klicken, halten und nach links/rechts ziehen.',
      expected: 'Die Ansicht dreht sich; das Möbel bleibt an seinem Platz. Kein Bildlauf-Symbol des Browsers.',
      async run(t) {
        await reset(t);
        const bed = await bedOf(t);
        const s = await t.worldToScreen(bed.x, 0.55, bed.y);
        const c0 = await cam(t);
        const d0 = await dir(t);
        await t.page.mouse.move(s.x, s.y);
        await t.page.mouse.down({ button: 'middle' });
        await t.page.mouse.move(s.x + 120, s.y, { steps: 8 });
        await t.page.mouse.up({ button: 'middle' });
        await settle(t);
        const c1 = await cam(t);
        const d1 = await dir(t);
        const after = await bedOf(t);
        const turned = d3(d0, d1) > 0.1;
        // Der Browser zeigt das Bildlauf-Symbol nur, wenn das mittlere Klick-Ereignis nicht abgefangen wird: prüfen, ob die App es abfängt
        const prevented = await t.page.evaluate(() => {
          const canvas = window.__wp.three.canvas;
          const ev = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
          canvas.dispatchEvent(ev);
          const ev2 = new PointerEvent('pointerdown', { button: 1, buttons: 4, bubbles: true, cancelable: true, pointerId: 77 });
          canvas.dispatchEvent(ev2);
          return [ev.defaultPrevented, ev2.defaultPrevented];
        });
        return { status: d3(c0, c1) > 0.5 && turned && after.x === bed.x && after.y === bed.y && prevented[0] ? 'ok' : prevented[0] ? 'fail' : 'look', observed: `Kamera bewegte sich um ${d3(c0, c1).toFixed(1)} m, Blickrichtung änderte sich um ${d3(d0, d1).toFixed(2)}; Bett unverändert: ${after.x === bed.x && after.y === bed.y}. Bildlauf-Symbol: das Browser-Ereignis „mousedown“ der mittleren Taste wird von der App abgefangen (defaultPrevented): ${prevented[0]} (das Symbol selbst zeigt die Test-Umgebung nicht an).` };
      },
    },
    {
      nr: 5,
      action: 'Mit der rechten Maustaste ziehen.',
      expected: 'Die Ansicht verschiebt sich, ohne sich zu drehen.',
      async run(t) {
        await reset(t);
        const c0 = await cam(t);
        const d0 = await dir(t);
        const box = await t.page.locator('[data-testid="scene3d"] canvas').boundingBox();
        const x = box.x + box.width * 0.5;
        const y = box.y + box.height * 0.5;
        await t.page.mouse.move(x, y);
        await t.page.mouse.down({ button: 'right' });
        await t.page.mouse.move(x + 150, y + 40, { steps: 8 });
        await t.page.mouse.up({ button: 'right' });
        await settle(t);
        const c1 = await cam(t);
        const d1 = await dir(t);
        return { status: d3(c0, c1) > 0.5 && d3(d0, d1) < 0.02 ? 'ok' : 'fail', observed: `Kamera bewegte sich um ${d3(c0, c1).toFixed(1)} m, Blickrichtung änderte sich nur um ${d3(d0, d1).toFixed(3)} (kleiner Wert = keine Drehung).` };
      },
    },
    {
      nr: 6,
      action: 'In die 3D-Ansicht zeigen, nichts auswählen und W, A, S, D bzw. Pfeiltasten gedrückt halten (auch mit Umschalt).',
      expected: 'Die Ansicht fährt vor/links/zurück/rechts, die Höhe bleibt gleich; mit Umschalt schneller. W wählt nicht das Wand-Werkzeug.',
      async run(t) {
        await reset(t);
        await t.page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await hover3d(t);
        const out = [];
        let ok = true;
        for (const k of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
          const { c0, c1 } = await keyTravel(t, k, 500, false);
          const flat = Math.abs(c1[1] - c0[1]) < 0.02;
          out.push(`${k}: ${d3(c0, c1).toFixed(2)} m${flat ? '' : ' (Höhe geändert)'}`);
          ok = ok && d3(c0, c1) > 0.3 && flat;
        }
        const slow = await keyTravel(t, 'd', 500, false);
        const fast = await keyTravel(t, 'd', 500, true);
        const tl = await tool(t);
        return { status: ok && d3(fast.c0, fast.c1) > d3(slow.c0, slow.c1) * 1.3 && tl !== 'wall' ? 'ok' : 'fail', observed: `Weg in 0,5 s: ${out.join(', ')}; D normal ${d3(slow.c0, slow.c1).toFixed(2)} m, mit Umschalt ${d3(fast.c0, fast.c1).toFixed(2)} m; Werkzeug danach „${tl}“.` };
      },
    },
    {
      nr: 7,
      action: 'Ein Möbel mit der linken Maustaste anklicken, festhalten und verschieben, dann loslassen.',
      expected: 'Das Möbel wandert mit, die Ansicht dreht sich nicht und springt nach dem Loslassen nicht.',
      async run(t) {
        await reset(t);
        const bed = await bedOf(t);
        const s = await t.worldToScreen(bed.x, 0.55, bed.y);
        const c0 = await cam(t);
        await t.page.mouse.move(s.x, s.y);
        await t.page.mouse.down();
        await t.page.mouse.move(s.x + 40, s.y + 5, { steps: 8 });
        await t.page.mouse.up();
        await t.poll(async () => (await bedOf(t)).x !== bed.x);
        await t.page.waitForTimeout(500);
        const c1 = await cam(t);
        const after = await bedOf(t);
        t.bedAfter = after;
        return { status: after.x !== bed.x && d3(c0, c1) < 0.01 ? 'ok' : 'fail', observed: `Bett um ${((after.x - bed.x) * 100).toFixed(0)} cm in x und ${((after.y - bed.y) * 100).toFixed(0)} cm in y verschoben; Kamera nach 0,5 s Ruhe um ${d3(c0, c1).toFixed(3)} m verändert.` };
      },
    },
    {
      nr: 8,
      action: 'Mit dem ausgewählten Möbel die Pfeiltasten drücken; danach W A S D.',
      expected: 'Das Möbel wird in kleinen Schritten verschoben, W A S D bewegen weiter die Ansicht.',
      async run(t) {
        const sel = await t.selection();
        const before = await bedOf(t);
        const c0 = await cam(t);
        await hover3d(t);
        const tried = [];
        let after = before;
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
          await t.page.keyboard.press(k);
          await t.page.waitForTimeout(300);
          after = await bedOf(t);
          const d = Math.hypot(after.x - before.x, after.y - before.y) * 100;
          tried.push(`${k}: ${d.toFixed(1)} cm`);
          if (d > 0.5) break;
        }
        const c1 = await cam(t);
        const stepCm = Math.hypot(after.x - before.x, after.y - before.y) * 100;
        const { c0: w0, c1: w1 } = await keyTravel(t, 'a', 500, false);
        const stillSelected = (await t.selection())?.id === before.id;
        return { status: sel?.id === before.id && stepCm > 0.5 && stepCm < 30 && d3(c0, c1) < 0.01 && d3(w0, w1) > 0.3 && stillSelected ? 'ok' : 'fail', observed: `Bett war ausgewählt (${sel?.id === before.id}); Pfeiltasten (${tried.join(', ')}): Bett ${stepCm.toFixed(1)} cm verschoben, Kamera ${d3(c0, c1).toFixed(3)} m bewegt; A danach: Kamera ${d3(w0, w1).toFixed(2)} m, Bett weiter ausgewählt: ${stillSelected}.` };
      },
    },
    {
      nr: 9,
      action: 'Ansicht kräftig drehen und sofort „Kamera zurücksetzen“ klicken.',
      expected: 'Die Ansicht springt auf die Startansicht und bleibt dort stehen (dreht nicht nach).',
      async run(t) {
        await reset(t);
        const home = await cam(t);
        const box = await t.page.locator('[data-testid="scene3d"] canvas').boundingBox();
        const x = box.x + box.width * 0.5;
        const y = box.y + box.height * 0.8;
        await t.page.mouse.move(x, y);
        await t.page.mouse.down({ button: 'middle' });
        await t.page.mouse.move(x + 400, y, { steps: 6 });
        await t.page.mouse.up({ button: 'middle' });
        await t.page.getByRole('button', { name: 'Kamera zurücksetzen' }).click(); // sofort nach der Drehung
        await t.page.waitForTimeout(1200);
        const a = await cam(t);
        await t.page.waitForTimeout(1200);
        const b = await cam(t);
        return { status: d3(a, home) < 0.2 && d3(a, b) < 0.01 ? 'ok' : 'fail', observed: `Abstand zur Startansicht ${d3(a, home).toFixed(2)} m, danach nach weiteren 1,2 s Bewegung ${d3(a, b).toFixed(3)} m (kein Nachdrehen).` };
      },
    },
    {
      nr: 10,
      action: 'Oben auf „2D + 3D“ umschalten; Maus über den 2D-Plan, W drücken; dann Maus über die 3D-Ansicht und W gedrückt halten.',
      expected: 'Über dem 2D-Plan wird das Wand-Werkzeug gewählt; über der 3D-Ansicht bewegt sich die 3D-Ansicht.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D + 3D' }).click();
        await t.page.waitForTimeout(1500);
        await t.page.locator('[data-testid="editor2d"]').hover();
        await t.page.keyboard.press('w');
        const t2d = await tool(t);
        await t.page.keyboard.press('Escape');
        await t.page.evaluate(() => window.__wp.useUiStore.getState().setTool('select'));
        await hover3d(t);
        const { c0, c1 } = await keyTravel(t, 'w', 500, false);
        const t3d = await tool(t);
        return { status: t2d === 'wall' && d3(c0, c1) > 0.3 && t3d !== 'wall' ? 'ok' : 'fail', observed: `Über dem 2D-Plan: W → Werkzeug „${t2d}“; über 3D: Kamera ${d3(c0, c1).toFixed(2)} m bewegt, Werkzeug danach „${t3d}“.` };
      },
    },
  ],
};
