// Smart Home: Lichtleisten (LED-Streifen) als smartes Gerät (#238) – Testschritte aus dem Kommentar in #238.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const info = (t) => right(t).getByTestId('device-info');
const strip = async (t) => (await t.project()).devices.find((d) => d.kind === 'strip');
const lenOf = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

export default {
  issue: 238,
  name: 'LED-Streifen',
  title: 'Smart Home: Lichtleisten (LED-Streifen) als smartes Gerät',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter „Smart Home“, bei „Gerät hinzufügen“ die Art „LED-Streifen“ wählen und „Im Plan klicken“ drücken.',
      expected: 'Hinweis „Klicke zuerst den Anfang, dann das Ende“.',
      async run(t) {
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).locator('[data-testid="device-kind"][data-kind="strip"]').click();
        await panel(t).getByTestId('device-place-click').click();
        const hint = (await panel(t).getByTestId('device-placing-hint').innerText()).trim();
        return { status: /Anfang/.test(hint) && /Ende/.test(hint) ? 'ok' : 'fail', observed: `Hinweis: „${hint}“.` };
      },
    },
    {
      nr: 2,
      action: 'Im 2D-Plan zuerst den Anfang, dann das Ende klicken (nahe der Wand).',
      expected: 'Ein farbiger Strich erscheint, die Länge steht am Strich und in „Eigenschaften“; er rastet an der Wand ein.',
      async run(t) {
        const { page } = t;
        const a = await t.planToScreen(1.0, 0.12);
        const b = await t.planToScreen(3.0, 0.12);
        await page.mouse.click(a.x, a.y);
        await page.mouse.click(b.x, b.y);
        await page.waitForTimeout(400);
        const s = await strip(t);
        const label = (await page.getByTestId('strip-label').first().innerText().catch(() => '')).trim() || (await page.locator('[data-kind="strip"]').first().innerText().catch(() => '')).trim();
        const len = (await info(t).getByTestId('strip-length').innerText().catch(() => '')).trim();
        const snapped = s && s.points.every((p) => Math.abs(p.y - 0.12) > 0.03);
        await t.shot('Streifen an der Nordwand');
        return { status: s && label && /2[,.]0/.test(len) && snapped ? 'ok' : 'fail', observed: `Geklickt bei y = 0,12 m (Wandfläche bei ca. 0,04 m); Punkte: ${s?.points.map((p) => `(${p.x.toFixed(2)} / ${p.y.toFixed(2)})`).join(' → ')} (an Wand eingerastet: ${snapped}); Beschriftung am Strich „${label}“; Eigenschaften: „${len}“.` };
      },
    },
    {
      nr: 3,
      action: 'Streifen anklicken, „Einschalten“ drücken, Farbe und Helligkeit ändern.',
      expected: 'Strich leuchtet in 2D in der gewählten Farbe; in 3D leuchtet die Linie und hellt die Umgebung leicht auf.',
      async run(t) {
        const { page } = t;
        const s = await strip(t);
        const mid = await t.planToScreen((s.points[0].x + s.points[1].x) / 2, (s.points[0].y + s.points[1].y) / 2);
        await page.mouse.click(mid.x, mid.y);
        await page.waitForTimeout(200);
        await info(t).getByTestId('device-toggle').click();
        await info(t).getByTestId('strip-color').fill('#00ff00');
        await info(t).getByTestId('strip-brightness').fill('60');
        await page.waitForTimeout(300);
        const el = page.locator('[data-testid="device-2d"][data-kind="strip"]');
        const on = await el.getAttribute('data-on');
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        const col = await el.getAttribute('data-color');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const th = await page.evaluate(() => {
          const out = { bars: 0, emissive: '', intensity: 0, lights: 0 };
          window.__wp.three.scene.traverse((o) => {
            if (o.name === 'led-strip') {
              o.traverse((c) => {
                if (c.isMesh) { out.bars++; out.emissive = '#' + c.material.emissive.getHexString(); out.intensity = c.material.emissiveIntensity; }
                if (c.isPointLight) out.lights++;
              });
            }
          });
          return out;
        });
        await t.shot('3D: Streifen leuchtet grün');
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(500);
        return { status: on === 'true' && col === '#00ff00' && th.bars > 0 && th.emissive === '#00ff00' && th.lights > 0 ? 'ok' : 'fail', observed: `2D: data-on=${on}, Farbe ${col}; 3D: ${th.bars} Leuchtbalken, Leuchtfarbe ${th.emissive}, Intensität ${th.intensity.toFixed(2)}, ${th.lights} Punktlichter (heller Umgebung). Dass es im Bild gut aussieht, ist hier nicht bewertet.` };
      },
    },
    {
      nr: 4,
      action: '„Knick anfügen“ drücken, dann Enden und Knick an den blauen Punkten ziehen.',
      expected: 'Länge passt sich an; Strg+Z macht jeden Schritt rückgängig.',
      async run(t) {
        const { page } = t;
        const pastN = () => page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
        const s0 = await strip(t);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id }), s0.id);
        await page.waitForTimeout(200);
        await info(t).getByTestId('strip-add-section').click();
        await page.waitForTimeout(300);
        const s1 = await strip(t);
        const dots = page.getByTestId('strip-point');
        const nDots = await dots.count();
        const last = dots.nth(nDots - 1);
        const box = await last.boundingBox();
        const p0 = await pastN();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const s2 = await strip(t);
        const p1 = await pastN();
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const s3 = await strip(t);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const s4 = await strip(t);
        const L = [s0, s1, s2, s3, s4].map((s) => lenOf(s.points));
        const ok = s1.points.length === s0.points.length + 1 && L[2] > L[1] + 0.1 && Math.abs(L[3] - L[1]) < 0.01 && Math.abs(L[4] - L[0]) < 0.01;
        return { status: ok ? 'ok' : 'fail', observed: `Punkte ${s0.points.length} → ${s1.points.length} (Knick) → Ziehen: Länge ${L[1].toFixed(2)} → ${L[2].toFixed(2)} m (Undo-Schritte +${p1 - p0}); Strg+Z → ${L[3].toFixed(2)} m, nochmal → ${L[4].toFixed(2)} m (Start ${L[0].toFixed(2)} m).` };
      },
    },
    {
      nr: 5,
      action: 'Bewegungsmelder platzieren, Regel anlegen, den Streifen als Ziel anhaken (Helligkeit 40 %), Simulation starten, Person in den Erfassungsbereich ziehen.',
      expected: 'Streifen geht mit 40 % an und nach der eingestellten Zeit ohne Bewegung wieder aus.',
      async run(t) {
        try { return await this.run2(t); } catch (e) { return { status: 'fail', observed: 'Abbruch: ' + String(e.message).split('\n').slice(0, 4).join(' / ') }; }
      },
      async run2(t) {
        const { page } = t;
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(300);
        if (!(await info(t).getByTestId('automation-add').count())) await panel(t).getByTestId('device-row').filter({ hasText: 'Bewegungsmelder' }).click();
        await info(t).getByTestId('automation-add').click();
        const auto = panel(t).getByTestId('automation');
        await auto.locator('summary').click();
        const stripName = (await strip(t)).name;
        await auto.getByLabel(new RegExp(stripName.replace(/[()]/g, '.'))).check();
        await auto.getByLabel('Nur wenn es dunkel ist').uncheck();
        await auto.getByLabel('Helligkeit').fill('40');
        await auto.getByLabel(/Aus nach/).fill('3');
        await auto.getByLabel(/Aus nach/).blur();
        await panel(t).getByTestId('sh-step-test').click();
        if (await panel(t).getByTestId('sim-stop').count()) await panel(t).getByTestId('sim-stop').click(); // Simulation neu starten: Streifen ist wieder aus
        await panel(t).getByLabel('Tempo').selectOption('10');
        await panel(t).getByTestId('sim-person').click();
        if (await panel(t).getByTestId('sim-start').count()) await panel(t).getByTestId('sim-start').click();
        const marker = page.getByTestId('sim-person-2d');
        const b = await marker.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 4, b.y + b.height / 2 + i * 2);
        await page.mouse.up();
        const el = page.locator('[data-testid="device-2d"][data-kind="strip"]');
        const on = await t.poll(async () => (await el.getAttribute('data-on')) === 'true', 6000);
        const stripId = (await strip(t)).id;
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id }), stripId);
        await page.waitForTimeout(250);
        const level = (await info(t).innerText().catch(() => '')).match(/Helligkeit\s*(\d+)\s*%/)?.[1];
        const log = await panel(t).getByTestId('sim-log').innerText().catch(() => '');
        const off = await t.poll(async () => (await el.getAttribute('data-on')) === 'false', 40000);
        return { noFinalShot: true, status: on && off && level === '40' && /Licht bei Bewegung: LED-Streifen/.test(log) && !/von Hand an/.test(log) ? 'ok' : 'fail', observed: `Vorher aus (Simulation neu gestartet); Streifen ging durch die Regel an: ${!!on}, Helligkeit laut Eigenschaften: ${level} %; Aktionen im Protokoll: „${log.replace(/\n/g, ' | ').slice(0, 220)}“; ohne Bewegung später wieder aus: ${!!off}.` };
      },
    },
    {
      nr: 6,
      action: 'Im Reiter „Regeln“ „Als Home-Assistant-YAML herunterladen“.',
      expected: 'Datei enthält `light.…` für den Streifen mit `brightness_pct` und `rgb_color` (bzw. `color_temp_kelvin`).',
      async run(t) {
        const { page } = t;
        await panel(t).getByTestId('sim-stop').click().catch(() => undefined);
        await panel(t).getByTestId('sh-step-rules').click();
        const dl = page.waitForEvent('download');
        await panel(t).getByTestId('ha-export').click();
        const file = await dl;
        const yaml = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
        const lightLine = yaml.split('\n').find((l) => /light\.led/i.test(l)) ?? '';
        const ok = /light\.led/i.test(yaml) && /brightness_pct: 40/.test(yaml) && /rgb_color|color_temp_kelvin/.test(yaml);
        return { status: ok ? 'ok' : 'fail', observed: `Datei „${file.suggestedFilename()}“, ${yaml.split('\n').length} Zeilen; Streifen-Entität: „${lightLine.trim()}“; brightness_pct: 40 vorhanden: ${/brightness_pct: 40/.test(yaml)}; rgb_color: ${/rgb_color/.test(yaml)}; color_temp_kelvin: ${/color_temp_kelvin/.test(yaml)}. Mit echtem Home Assistant nicht geprüft.` };
      },
    },
    {
      nr: 7,
      action: 'Seite neu laden.',
      expected: 'Streifen mit Länge, Farbe und Richtung ist noch da.',
      async run(t) {
        const { page } = t;
        const before = await strip(t);
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const after = await strip(t);
        const same = after && JSON.stringify(after.points) === JSON.stringify(before.points) && after.color === before.color && after.direction === before.direction;
        return { status: same ? 'ok' : 'fail', observed: `Vor dem Laden: ${before.points.length} Punkte, Länge ${lenOf(before.points).toFixed(2)} m, Farbe ${before.color}, Richtung ${before.direction}; danach: ${after ? `${after.points.length} Punkte, Länge ${lenOf(after.points).toFixed(2)} m, Farbe ${after.color}, Richtung ${after.direction}` : 'Streifen fehlt'}.` };
      },
    },
    {
      nr: 8,
      optional: true,
      action: 'Optional: Streifen löschen und mit Strg+Z zurückholen.',
      expected: 'Der Streifen ist weg und wieder da.',
      async run(t) {
        const { page } = t;
        const s = await strip(t);
        const mid = await t.planToScreen((s.points[0].x + s.points[1].x) / 2, (s.points[0].y + s.points[1].y) / 2);
        await page.mouse.click(mid.x, mid.y);
        await right(t).getByTestId('device-delete').click();
        await page.waitForTimeout(250);
        const gone = !(await strip(t));
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const back = !!(await strip(t));
        return { status: gone && back ? 'ok' : 'fail', observed: `Nach Löschen weg: ${gone}; nach Strg+Z zurück: ${back}.` };
      },
    },
  ],
};
