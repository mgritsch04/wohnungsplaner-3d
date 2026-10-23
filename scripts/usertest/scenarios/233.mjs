// Smart-Home-Reiter übersichtlicher und einfacher bedienbar (#233) – Testschritte aus dem Kommentar in #233.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const info = (t) => right(t).getByTestId('device-info');

export default {
  issue: 233,
  name: 'Smart-Home-Reiter',
  title: 'Smart-Home-Reiter übersichtlicher und einfacher bedienbar machen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, links den Reiter Smart Home wählen. Oben stehen die drei Schritte Geräte / Regeln / Testen.',
      expected: 'Die drei Schritte sind sichtbar.',
      async run(t) {
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        const names = await Promise.all(['sh-step-devices', 'sh-step-rules', 'sh-step-test'].map((id) => panel(t).getByTestId(id).innerText()));
        await t.shot('Smart-Home-Reiter');
        return { status: names.map((n) => n.trim()).join('|').match(/Geräte.*\|.*Regeln.*\|.*Testen/s) ? 'ok' : 'fail', observed: `Schritte: ${names.map((n) => n.trim().replace(/\n/g, ' ')).join(' / ')}.` };
      },
    },
    {
      nr: 2,
      action: 'Unter „Gerät hinzufügen“ den Raum Schlafzimmer wählen, die Kachel Smarte Lampe anklicken und dann „In „Schlafzimmer“ platzieren“ drücken.',
      expected: 'Die Lampe erscheint im Schlafzimmer und pulsiert kurz. Eine Meldung nennt „Schlafzimmer“, und rechts unter „Eigenschaften“ öffnet sich die Geräteinfo.',
      async run(t) {
        const { page } = t;
        await panel(t).getByLabel('Raum').selectOption({ label: 'Schlafzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="light"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(150);
        const flash = await page.getByTestId('device-flash').count();
        const toast = await page.getByText('in „Schlafzimmer“ platziert').count();
        const inf = await info(t).innerText().catch(() => '');
        const lamp = page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Schlafzimmer"]');
        const selected = await lamp.getAttribute('data-selected');
        await t.shot('Lampe platziert, Geräteinfo');
        return { status: flash === 1 && toast >= 1 && /Smarte Lampe Schlafzimmer/.test(inf) && selected === 'true' ? 'ok' : 'fail', observed: `Pulsieren (device-flash): ${flash}; Meldung „… in „Schlafzimmer“ platziert“: ${toast}×; Geräteinfo rechts: „${inf.split('\n')[0]}“; Gerät im Plan ausgewählt: ${selected}.` };
      },
    },
    {
      nr: 3,
      action: 'In der Geräteinfo „Einschalten“ und danach „Ausschalten“ drücken.',
      expected: 'Das Symbol im Plan wird farbig gefüllt und dann wieder weiß.',
      async run(t) {
        const lamp = t.page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Schlafzimmer"]');
        await info(t).getByTestId('device-toggle').click();
        const on = await lamp.getAttribute('data-on');
        const fillOn = await lamp.locator('circle, rect, path').first().evaluate((e) => getComputedStyle(e).fill);
        await info(t).getByTestId('device-toggle').click();
        const off = await lamp.getAttribute('data-on');
        const fillOff = await lamp.locator('circle, rect, path').first().evaluate((e) => getComputedStyle(e).fill);
        return { status: on === 'true' && off === 'false' && fillOn !== fillOff ? 'ok' : 'fail', observed: `Einschalten: data-on=${on}, Füllung ${fillOn}; Ausschalten: data-on=${off}, Füllung ${fillOff}.` };
      },
    },
    {
      nr: 4,
      action: 'Die Kachel Bewegungsmelder wählen, „Im Plan klicken“ drücken und mit Esc abbrechen. Danach erneut „Im Plan klicken“ und in einen Raum im 2D-Plan klicken.',
      expected: 'Der Hinweis verschwindet. Danach sitzt der Melder an der Klickstelle und schaut zur Raummitte.',
      async run(t) {
        const { page } = t;
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-place-click').click();
        const hint1 = await panel(t).getByTestId('device-placing-hint').isVisible();
        await page.keyboard.press('Escape');
        const hint2 = await panel(t).getByTestId('device-placing-hint').isHidden();
        await panel(t).getByTestId('device-place-click').click();
        const at = await t.planToScreen(6.4, 1.2);
        await page.mouse.click(at.x, at.y);
        await t.poll(async () => (((await t.project()).devices.length === 2) ? 1 : null), 4000);
        const m = (await t.project()).devices[1];
        // the bedroom centre is about (7.0, 2.0): the sensor looks toward it (rotation in plan, 0 = +x? use dot product)
        const center = { x: 7.0, y: 2.0 };
        const dir = { x: Math.cos(m.rotation ?? 0), y: Math.sin(m.rotation ?? 0) };
        const toC = { x: center.x - m.x, y: center.y - m.y };
        const len = Math.hypot(toC.x, toC.y);
        const dot = (dir.x * toC.x + dir.y * toC.y) / len;
        const dotAlt = (-Math.sin(m.rotation ?? 0) * toC.x + Math.cos(m.rotation ?? 0) * toC.y) / len;
        await t.shot('Melder an der Klickstelle');
        return { status: hint1 && hint2 && Math.abs(m.x - 6.4) < 0.1 && Math.abs(m.y - 1.2) < 0.1 && Math.max(dot, dotAlt) > 0.5 ? 'ok' : 'fail', observed: `Hinweis beim Platzieren sichtbar: ${hint1}, nach Esc weg: ${hint2}; Melder „${m.name}“ bei (${m.x.toFixed(2)} / ${m.y.toFixed(2)}) m (Klick bei 6,4 / 1,2); Blickrichtung ${((m.rotation ?? 0) * 180 / Math.PI).toFixed(0)}°, Übereinstimmung mit Richtung zur Raummitte ${Math.max(dot, dotAlt).toFixed(2)} (1 = genau).` };
      },
    },
    {
      nr: 5,
      action: 'In der Geräteinfo „Auslösen (testen)“ drücken.',
      expected: 'Der Melder meldet kurz „Bewegung“.',
      async run(t) {
        const motion = t.page.locator('[data-testid="device-2d"][data-device="Bewegungsmelder Schlafzimmer"]');
        await info(t).getByTestId('device-trigger').click();
        let on = await motion.getAttribute('data-on');
        for (let i = 0; i < 20 && on !== 'true'; i++) { await t.page.waitForTimeout(100); on = await motion.getAttribute('data-on'); }
        const txt = await t.page.locator('body').innerText();
        return { status: on === 'true' ? 'ok' : 'fail', observed: `Melder data-on=${on}; „Bewegung“ im Bild/Panel: ${/Bewegung/.test(txt)}.` };
      },
    },
    {
      nr: 6,
      action: 'Ein Gerät im 2D-Plan anklicken, ohne es zu ziehen.',
      expected: 'Die Infos erscheinen unter „Eigenschaften“, und das Gerät bewegt sich nicht.',
      async run(t) {
        const before = (await t.project()).devices;
        const lamp = t.page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Schlafzimmer"]');
        await lamp.getByTestId('device-hit').click();
        const inf = await info(t).innerText();
        const after = (await t.project()).devices;
        return { status: /Smarte Lampe Schlafzimmer/.test(inf) && JSON.stringify(before) === JSON.stringify(after) ? 'ok' : 'fail', observed: `Geräteinfo „${inf.split('\n')[0]}“; Geräte im Projekt unverändert: ${JSON.stringify(before) === JSON.stringify(after)}.` };
      },
    },
    {
      nr: 7,
      action: 'Dasselbe Gerät in der 3D-Ansicht anklicken.',
      expected: 'Seine Infos erscheinen, und über ihm steht ein Namensschild.',
      async run(t) {
        const { page } = t;
        const m = (await t.project()).devices[1];
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(2000);
        const s3 = await t.worldToScreen(m.x, m.elevation, m.y);
        await page.mouse.click(s3.x, s3.y);
        const sel = await t.poll(async () => (((await t.selection())?.id === m.id) ? 1 : null), 4000);
        const inf = await info(t).innerText().catch(() => '');
        const label = await page.evaluate(() => {
          let n = 0;
          window.__wp.three.scene.traverse((o) => void (/device-label|device-name|sprite/i.test(o.name || '') && n++));
          return n;
        });
        const html = await page.locator('[data-testid="scene3d"]').innerText().catch(() => '');
        await t.shot('3D mit Namensschild');
        return { status: sel && /Bewegungsmelder Schlafzimmer/.test(inf) && (label > 0 || /Bewegungsmelder Schlafzimmer/.test(html)) ? 'ok' : 'fail', observed: `Auswahl in 3D: ${!!sel}; Geräteinfo: „${inf.split('\n')[0]}“; Namensschild (3D-Objekt oder Text über dem Gerät): ${label > 0 || /Bewegungsmelder Schlafzimmer/.test(html)}.` };
      },
    },
    {
      nr: 8,
      action: 'Bei einem Melder „Regel anlegen“ drücken.',
      expected: 'Der Reiter springt zu „Regeln“, und die Regel steht dort als Satz („Wenn … Bewegung meldet …, dann …“).',
      async run(t) {
        await info(t).getByTestId('automation-add').click();
        const step = await panel(t).getByTestId('sh-step-rules').getAttribute('aria-pressed');
        const rule = await info(t).getByTestId('device-rule').innerText().catch(() => '');
        const sentence = await panel(t).getByTestId('automation').innerText().catch(() => '');
        return { status: step === 'true' && /Wenn Bewegungsmelder Schlafzimmer Bewegung meldet/.test(rule + sentence) ? 'ok' : 'fail', observed: `Schritt „Regeln“ aktiv: ${step}; Regel: „${(rule || sentence).replace(/\n/g, ' ').slice(0, 140)}“.` };
      },
    },
    {
      nr: 9,
      action: '„Gerät löschen“ drücken, dann Strg+Z.',
      expected: 'Das Gerät ist zuerst weg und danach wieder da.',
      async run(t) {
        const n0 = (await t.project()).devices.length;
        await info(t).getByTestId('device-delete').click();
        await t.page.waitForTimeout(300);
        const n1 = (await t.project()).devices.length;
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(400);
        const n2 = (await t.project()).devices.length;
        return { status: n1 === n0 - 1 && n2 === n0 ? 'ok' : 'fail', observed: `Geräte: ${n0} → nach Löschen ${n1} → nach Strg+Z ${n2}.` };
      },
    },
  ],
};
