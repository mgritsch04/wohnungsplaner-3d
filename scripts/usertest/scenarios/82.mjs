// Küchen-Arbeitsdreieck (#82), GLB-Export (#87), Sitzen beim Begehen (#78), Startkarte (#102) – Testschritte aus dem Kommentar in #82.
import { readFile, writeFile } from 'node:fs/promises';

const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const plan = (t) => t.page.locator('[data-testid="editor2d"]');
const eyeY = (t) => t.page.evaluate(() => window.__wp.three.camera.position.y);
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const moveFridge = (t, x, y) =>
  t.page.evaluate(
    ([x, y]) =>
      window.__wp.useProjectStore.getState().apply((d) => {
        const f = d.furniture.find((q) => q.kitchen?.type === 'fridge');
        f.x = x;
        f.y = y;
        f.rotation = Math.PI;
      }),
    [x, y],
  );
const newEmpty = async (t) => {
  await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await t.page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
  await t.page.getByRole('button', { name: 'Neu anlegen' }).click();
};

export default {
  issue: 82,
  name: 'Arbeitsdreieck, GLB-Export, Sitzen, Startkarte',
  title: 'Küchen-Arbeitsdreieck prüfen: Abstände zwischen Kühlschrank, Spüle und Herd (plus #87, #78, #102)',
  device: 'desktop',
  pc: false,
  realDevice: ['Schritt 8: GLB im Windows-3D-Viewer ansehen'],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung, 2D: Im Wohnzimmer die Nordwand anklicken und links „Küche“ öffnen.',
      expected: 'Das Küchen-Panel ist offen.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const s = await t.planToScreen(1.0, -0.06);
        await t.page.mouse.click(s.x, s.y);
        const sl = await t.selection();
        await left(t).getByRole('button', { name: 'Küche' }).click();
        const open = await left(t).getByRole('combobox', { name: 'Modul' }).first().isVisible();
        return { status: sl?.type === 'wall' && open ? 'ok' : 'fail', observed: `Auswahl: ${sl?.type}; Küchen-Panel mit Modulauswahl sichtbar: ${open}.` };
      },
    },
    {
      nr: 2,
      action: 'Modul 1 von „Hochschrank“ auf „Kühlschrank freistehend“ stellen, dann „Küchenzeile platzieren“.',
      expected: 'Grüne gestrichelte Linien mit Längen und „Σ … m“; im Panel „im Richtwert“.',
      async run(t) {
        await left(t).getByRole('combobox', { name: 'Modul' }).first().selectOption({ label: 'Kühlschrank freistehend' });
        // der TV-Lowboard würde die Zeile blockieren (#220)
        await t.page.evaluate(() =>
          window.__wp.useProjectStore.getState().apply((d) => {
            d.furniture = d.furniture.filter((f) => f.name !== 'TV-Lowboard');
          }),
        );
        await t.page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        const tri = plan(t).getByTestId('kitchen-triangle');
        await tri.waitFor({ timeout: 5000 });
        const sides = await tri.getByTestId('kitchen-triangle-side').allTextContents();
        const sum = await tri.getByTestId('kitchen-triangle-sum').textContent();
        const res = await left(t).getByTestId('kitchen-triangle-result').first().innerText();
        const ok = sides.length === 3 && sides.every((x) => /^\d+,\d{2} m$/.test(x)) && /^Σ \d+,\d{2} m$/.test(sum ?? '') && /im Richtwert/.test(res);
        await t.shot('82-dreieck');
        return { status: ok ? 'ok' : 'fail', observed: `Seiten: ${sides.join(' / ')}; ${sum}; Panel: „${/im Richtwert|außerhalb/.exec(res)?.[0]}“. (Die Farbe der Linien ist im Screenshot 82-dreieck zu sehen.)` };
      },
    },
    {
      nr: 3,
      action: 'Den Kühlschrank weit wegziehen.',
      expected: 'Nach dem Loslassen sind zu lange Seiten orange, das Panel meldet „außerhalb“.',
      async run(t) {
        await moveFridge(t, 4.6, 3.2);
        const tri = plan(t).getByTestId('kitchen-triangle');
        await t.poll(async () => (await tri.getAttribute('data-ok')) === 'false');
        const longSides = await tri.locator('[data-testid="kitchen-triangle-side"][data-status="long"]').count();
        const res = await left(t).getByTestId('kitchen-triangle-result').first().innerText();
        return { status: longSides > 0 && /außerhalb/.test(res) ? 'ok' : 'fail', observed: `Zu lange Seiten (data-status=long): ${longSides}; Panel: „${/im Richtwert|außerhalb/.exec(res)?.[0]}“. Der Kühlschrank wurde per Store verschoben, nicht mit der Maus gezogen.` };
      },
    },
    {
      nr: 4,
      action: '„Seite max“ auf 400 cm stellen.',
      expected: 'Die Bewertung ändert sich sofort.',
      async run(t) {
        const before = await left(t).getByTestId('kitchen-triangle-result').first().innerText();
        const f = left(t).getByRole('textbox', { name: 'Seite max' });
        await f.fill('400');
        await f.press('Enter');
        await t.page.waitForTimeout(300);
        const after = await left(t).getByTestId('kitchen-triangle-result').first().innerText();
        const max = (await t.project()).settings.kitchenTriangle.sideMax;
        return { status: max === 4 && before !== after ? 'ok' : 'fail', observed: `sideMax=${max} m; Bewertung vorher: ${/im Richtwert|außerhalb/.exec(before)?.[0]}, nachher: ${/im Richtwert|außerhalb/.exec(after)?.[0]}; Text geändert: ${before !== after}.` };
      },
    },
    {
      nr: 5,
      action: 'Den Kühlschrank löschen.',
      expected: 'Das Panel meldet „Kühlschrank fehlt“.',
      async run(t) {
        const id = await t.page.evaluate(() => window.__wp.useProjectStore.getState().project.furniture.find((q) => q.kitchen?.type === 'fridge').id);
        await sel(t, { type: 'furniture', id });
        await t.page.keyboard.press('Delete');
        await t.page.waitForTimeout(300);
        const txt = await left(t).getByTestId('kitchen-triangle-result').first().innerText();
        return { status: /Kühlschrank fehlt/i.test(txt) ? 'ok' : 'fail', observed: `Panel: „${txt.replace(/\s+/g, ' ').slice(0, 160)}“.` };
      },
    },
    {
      nr: 6,
      action: '„Arbeitsdreieck im Plan anzeigen“ ausschalten.',
      expected: 'Die Linien verschwinden, die Auswertung im Panel bleibt.',
      async run(t) {
        await left(t).getByLabel('Arbeitsdreieck im Plan anzeigen').uncheck();
        await t.page.waitForTimeout(300);
        const lines = await plan(t).getByTestId('kitchen-triangle').count();
        const res = await left(t).getByTestId('kitchen-triangle-result').count();
        return { status: lines === 0 && res > 0 ? 'ok' : 'fail', observed: `Linien im Plan: ${lines}; Auswertung im Panel: ${res > 0 ? 'bleibt' : 'weg'}.` };
      },
    },
    {
      nr: 7,
      action: 'Export ▾ → „3D-Modell als GLB …“.',
      expected: '„Beispielwohnung.glb“ wird heruntergeladen (einige 100 kB).',
      async run(t) {
        // seit #100 liegen die Exporte im Menü „Mehr“
        await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const dl = t.page.waitForEvent('download');
        await t.page.getByRole('button', { name: '3D-Modell als GLB …' }).click();
        const d = await dl;
        const buf = await readFile(await d.path());
        t.glb = buf;
        if (process.env.USERTEST_SAVE_GLB) await writeFile(process.env.USERTEST_SAVE_GLB, buf); // optional: Datei für einen externen glTF-Validator
        const kb = Math.round(buf.length / 1024);
        const magic = buf.subarray(0, 4).toString('ascii');
        return { status: d.suggestedFilename() === 'Beispielwohnung.glb' && magic === 'glTF' && buf.readUInt32LE(8) === buf.length && kb > 10 ? 'ok' : 'fail', observed: `Datei „${d.suggestedFilename()}“, ${kb} kB, Kopf „${magic}“, glTF-Version ${buf.readUInt32LE(4)}. Das Menü heißt jetzt „Mehr“ statt „Export ▾“.` };
      },
    },
    {
      nr: 8,
      action: 'Die Datei im Windows-3D-Viewer oder auf gltf-viewer.donmccurdy.com öffnen.',
      expected: 'Wohnung mit Wänden, Fenstern, Türen, Böden, Möbeln, richtig herum, in Metern; Namen in der Szenenliste; keine Grundriss-Unterlage.',
      async run(t) {
        const buf = t.glb;
        const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
        const names = json.nodes.map((n) => n.name);
        const need = ['Wände', 'Böden', 'Möbel', 'Wohnzimmer', 'Schlafzimmer', 'Sofa 3-Sitzer'];
        const missing = need.filter((n) => !names.includes(n));
        const images = (json.images ?? []).length;
        return { status: 'look', observed: `Szenenliste enthält ${need.length - missing.length}/${need.length} erwartete Namen${missing.length ? ` (es fehlen: ${missing.join(', ')})` : ''}; eingebettete Bilder: ${images}. Das Aussehen im Viewer (richtig herum, Maßstab) kann hier nicht beurteilt werden.` };
      },
    },
    {
      nr: 9,
      action: '3D → „Begehen“, in die Ansicht klicken und X drücken.',
      expected: 'Die Kamera senkt sich weich auf Sitzhöhe, oben steht „Sitzen“.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.getByRole('button', { name: 'Begehen' }).click();
        await t.page.getByTestId('crosshair').waitFor();
        const stand = await eyeY(t);
        await t.page.keyboard.press('x');
        await t.poll(async () => near(await eyeY(t), 1.21));
        const sit = await eyeY(t);
        const label = await t.page.getByTestId('walk-sit').innerText();
        return { status: near(stand, 1.52) && near(sit, 1.21) && /Sitzen/.test(label) ? 'ok' : 'fail', observed: `Augenhöhe stehend ${stand.toFixed(2)} m, sitzend ${sit.toFixed(2)} m; Anzeige „${label}“. Ob die Bewegung weich wirkt, ist Optik (nur Endwerte geprüft).` };
      },
    },
    {
      nr: 10,
      action: 'Im Sitzen C halten.',
      expected: 'Die Kamera senkt sich nicht weiter.',
      async run(t) {
        await t.page.keyboard.down('c');
        await t.page.waitForTimeout(500);
        const y = await eyeY(t);
        await t.page.keyboard.up('c');
        return { status: near(y, 1.21) ? 'ok' : 'fail', observed: `Augenhöhe bei gehaltenem C: ${y.toFixed(2)} m.` };
      },
    },
    {
      nr: 11,
      action: 'Projekt › Steuerung (3D) › „Augenhöhe im Sitzen“ auf 105 setzen.',
      expected: 'Die Höhe ändert sich sofort.',
      async run(t) {
        // Das Feld „Augenhöhe im Sitzen“ gibt es seit #263 nicht mehr: die Sitzhöhe folgt der Körpergröße.
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const field = right(t).getByRole('textbox', { name: 'Körpergröße cm' });
        await field.fill('150');
        await field.press('Enter');
        await t.poll(async () => near(await eyeY(t), 1.11));
        const y = await eyeY(t);
        const info = await right(t).getByTestId('eye-heights').innerText();
        return { status: near(y, 1.11) ? 'ok' : 'fail', observed: `Das Feld „Augenhöhe im Sitzen“ existiert nicht mehr (seit #263 folgt die Sitzhöhe der Körpergröße). Mit Körpergröße 150 cm ändert sich die Augenhöhe sofort auf ${y.toFixed(2)} m; Anzeige: „${info}“. Der Wert 105 cm lässt sich deshalb nicht mehr direkt einstellen.` };
      },
    },
    {
      nr: 12,
      action: 'X erneut drücken, danach neu laden.',
      expected: 'Du stehst auf. Nach dem Neuladen ist die Sitzhöhe noch 105 cm.',
      async run(t) {
        await t.page.locator('[data-testid="scene3d"]').hover();
        await t.page.keyboard.press('x');
        await t.poll(async () => near(await eyeY(t), 1.39));
        const stood = await t.page.getByTestId('walk-sit').count();
        await t.page.getByText('Gespeichert', { exact: true }).waitFor({ timeout: 5000 });
        await t.page.waitForTimeout(1200);
        await t.page.reload();
        await t.poll(async () => (await t.project()).settings.bodyHeight === 1.5);
        const bh = (await t.project()).settings.bodyHeight;
        return { status: stood === 0 && bh === 1.5 ? 'ok' : 'fail', observed: `Nach X: Anzeige „Sitzen“ weg (${stood === 0}); nach Neuladen ist die Körpergröße ${bh * 100} cm (Sitzhöhe folgt ihr, s. Schritt 11).` };
      },
    },
    {
      nr: 13,
      action: 'Projekt ▾ → „Neues leeres Projekt“ → „Neu anlegen“.',
      expected: 'Mitten im Plan steht die Karte „Los geht’s“ mit den drei Schritten.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(500);
        await newEmpty(t);
        const card = t.page.getByTestId('start-card');
        await card.waitFor({ timeout: 5000 });
        const txt = await card.innerText();
        await t.shot('82-startkarte');
        const hasTitle = /Los geht/.test(txt);
        return { status: hasTitle ? 'look' : 'fail', observed: `Startkarte sichtbar, Text: „${txt.replace(/\s+/g, ' ').slice(0, 200)}“. Ob die Karte „mitten im Plan“ gut sitzt, siehe Screenshot 82-startkarte.` };
      },
    },
    {
      nr: 14,
      action: '„Raum zeichnen“ klicken und einen Raum anlegen.',
      expected: 'Das Raum-Werkzeug ist aktiv; nach dem Anlegen eines Raums verschwindet die Karte.',
      async run(t) {
        const card = t.page.getByTestId('start-card');
        await card.getByRole('button', { name: 'Raum zeichnen' }).click();
        const tool = await t.page.evaluate(() => window.__wp.useUiStore.getState().tool);
        await left(t).getByRole('button', { name: 'Raum anlegen' }).click();
        await t.poll(async () => (await t.project()).rooms.length === 1);
        const gone = (await card.count()) === 0;
        return { status: tool === 'room' && gone ? 'ok' : 'fail', observed: `Werkzeug nach Klick: ${tool}; Raum über „Raum anlegen“ (Standardrechteck) erzeugt; Karte danach weg: ${gone}.` };
      },
    },
    {
      nr: 15,
      action: 'Noch ein leeres Projekt anlegen, Karte mit × schließen, „Erste Schritte“ klicken, neu laden.',
      expected: '„Erste Schritte“ holt die Karte zurück. Nach dem Neuladen bleibt sie geschlossen.',
      async run(t) {
        await newEmpty(t);
        const card = t.page.getByTestId('start-card');
        await card.waitFor({ timeout: 5000 });
        await card.getByRole('button', { name: 'Startkarte schließen' }).click();
        const closed = (await card.count()) === 0;
        const viaButton = (await t.page.getByTestId('start-card-reopen').count()) > 0;
        if (viaButton) await t.page.getByTestId('start-card-reopen').click();
        else {
          await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
          await t.page.getByRole('button', { name: /Erste Schritte/ }).click();
        }
        await card.waitFor({ timeout: 3000 });
        const back = (await card.count()) === 1;
        await card.getByRole('button', { name: 'Startkarte schließen' }).click();
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.page.waitForTimeout(800);
        const stays = (await t.page.getByTestId('start-card').count()) === 0;
        return { status: closed && back && stays ? 'ok' : 'fail', observed: `Geschlossen: ${closed}; zurückgeholt über ${viaButton ? 'den Knopf unten' : 'Menü Projekt ▾ › Erste Schritte'}: ${back}; nach Neuladen geschlossen geblieben: ${stays}.` };
      },
    },
  ],
};
