// Smart Home: Uhrzeit während der Simulation selbst einstellen (#282) – Testschritte aus dem Kommentar in #282.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const lamp = (t) => t.page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Wohnzimmer"]');
const lampOn = async (t) => (await lamp(t).getAttribute('data-on')) === 'true';
const log = async (t) => (await panel(t).getByTestId('sim-log').innerText().catch(() => '')).replace(/\n/g, ' | ');
/** Person im 2D-Plan ein Stück ziehen (löst den PIR-Melder aus). */
async function movePerson(t, to) {
  const { page } = t;
  const el = page.getByTestId('sim-person-2d');
  const b = await el.boundingBox();
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const d = await t.planToScreen(to.x, to.y);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move((c.x + d.x) / 2, (c.y + d.y) / 2, { steps: 6 });
  await page.mouse.move(d.x, d.y, { steps: 6 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

export default {
  issue: 282,
  name: 'Simulierte Uhrzeit',
  title: 'Smart Home: Uhrzeit lässt sich während der Simulation selbst ändern',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter Smart Home: Bewegungsmelder und Smarte Lampe in einen Raum stellen, beim Melder „Regel anlegen“ („nur wenn dunkel“ bleibt an).',
      expected: 'Melder, Lampe und Regel „nur wenn dunkel“ sind angelegt.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-add').click();
        await panel(t).locator('[data-testid="device-kind"][data-kind="light"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(300);
        // Melder an die Westwand, Blick nach Osten – sieht den Raum
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => { const m = d.devices.find((x) => x.kind === 'motion'); Object.assign(m, { x: 0.3, y: 2.0, rotation: 0 }); }));
        await panel(t).getByTestId('sh-step-rules').click();
        await panel(t).getByTestId('automation-add').click();
        await page.waitForTimeout(300);
        const p = await t.project();
        const a = p.automations[0];
        return { status: p.devices.length === 2 && a && a.onlyWhenDark === true ? 'ok' : 'fail', observed: `Geräte: ${p.devices.map((d) => d.name).join(', ')}; Regeln: ${p.automations.length}, „nur wenn dunkel“: ${a?.onlyWhenDark}, schaltet ${a?.action.deviceIds.length} Gerät(e).` };
      },
    },
    {
      nr: 2,
      action: 'Schritt „Testen“: „Simulation starten“ drücken.',
      expected: 'Die Simulation läuft, die simulierte Uhr ist sichtbar.',
      async run(t) {
        await panel(t).getByTestId('sh-step-test').click();
        await panel(t).getByTestId('sim-start').click();
        await panel(t).getByTestId('sim-clock').waitFor();
        const clock = (await panel(t).getByTestId('sim-clock').innerText()).trim();
        return { status: /Simulierte Uhrzeit \d\d:\d\d/.test(clock) ? 'ok' : 'fail', observed: `Uhr: „${clock}“.` };
      },
    },
    {
      nr: 3,
      action: 'Den Regler „Simulierte Uhrzeit“ auf 22:00 ziehen.',
      expected: 'Die Uhr springt auf 22:00 und läuft weiter; das Protokoll zeigt „Uhrzeit von Hand auf 22:00 gestellt“.',
      async run(t) {
        const slider = panel(t).getByTestId('sim-hour');
        await slider.fill('22');
        await t.page.waitForTimeout(500);
        const c1 = (await panel(t).getByTestId('sim-clock').innerText()).trim();
        await t.page.waitForTimeout(3000);
        const c2 = (await panel(t).getByTestId('sim-clock').innerText()).trim();
        const lg = await log(t);
        const secs = (c) => Number((c.match(/· (\d+) s/) ?? [])[1]);
        await t.shot('Uhr auf 22:00');
        return { status: /22:00/.test(c1) && /22:\d\d/.test(c2) && secs(c2) > secs(c1) && /Uhrzeit von Hand auf 22:00 gestellt/.test(lg) ? 'ok' : 'fail', observed: `Uhr nach dem Ziehen: „${c1}“, 3 s später: „${c2}“ (läuft weiter: ${secs(c2) > secs(c1)}); Protokoll: „${lg.slice(0, 120)}“. Dass die Szene im Bild dunkel wird, ist hier nicht beurteilt.` };
      },
    },
    {
      nr: 4,
      action: 'Die Person in den Raum stellen und etwas ziehen.',
      expected: 'Die Lampe geht an.',
      async run(t) {
        const on0 = await lampOn(t);
        await panel(t).getByTestId('sim-person').click();
        await t.page.waitForTimeout(500);
        await movePerson(t, { x: 3.2, y: 2.6 });
        let on = await lampOn(t);
        for (let i = 0; i < 20 && !on; i++) { await t.page.waitForTimeout(150); on = await lampOn(t); }
        await t.shot('Nachts: Lampe an');
        return { status: !on0 && on ? 'ok' : 'fail', observed: `Lampe vor dem Hinstellen der Person: ${on0 ? 'an' : 'aus'}; nach Hinstellen und Ziehen der Person: ${on ? 'an' : 'aus'}; Protokoll: „${(await log(t)).slice(0, 140)}“.` };
      },
    },
    {
      nr: 5,
      action: 'Lampe ausschalten, Schnellknopf „Tag (12:00)“ drücken, dann die Person erneut bewegen.',
      expected: 'Die Lampe geht wegen „nur wenn dunkel“ nicht neu an.',
      async run(t) {
        const { page } = t;
        // Lampe von Hand ausschalten (Geräteinfo rechts)
        await page.getByTestId('device-row').filter({ hasText: 'Lampe' }).first().click().catch(() => {});
        await page.locator('.panel.right').getByTestId('device-toggle').click();
        await page.waitForTimeout(300);
        const offNow = !(await lampOn(t));
        // Melder erst „ruhig“ werden lassen (Haltezeit 60 s, hier mit 10-fachem Tempo), damit die Bewegung am Tag eine neue Meldung wäre
        await panel(t).getByLabel('Tempo').selectOption({ label: '10× schneller' });
        const quiet = await t.poll(async () => (/keine Bewegung mehr/.test(await log(t)) ? 1 : null), 20000);
        await panel(t).getByLabel('Tempo').selectOption({ label: 'Echtzeit' });
        await panel(t).getByTestId('sim-day').click();
        await page.waitForTimeout(400);
        const clock = (await panel(t).getByTestId('sim-clock').innerText()).trim();
        await movePerson(t, { x: 2.0, y: 1.4 });
        await movePerson(t, { x: 3.4, y: 2.8 });
        await page.waitForTimeout(800);
        const on = await lampOn(t);
        const lg = await log(t);
        const seen = /12:\d\d Bewegungsmelder Wohnzimmer: Bewegung erkannt/.test(lg);
        await t.shot('Tag: Lampe bleibt aus');
        return { status: quiet && offNow && /12:00/.test(clock) && seen && !on ? 'ok' : 'fail', observed: `Lampe von Hand ausgeschaltet: ${offNow}; Melder zwischenzeitlich „keine Bewegung mehr“: ${!!quiet}; Uhr „${clock}“; nach zweimal Bewegen der Person: Lampe ${on ? 'an' : 'aus'}; der Melder hat tagsüber trotzdem Bewegung erkannt (Protokoll): ${seen}.` };
      },
    },
    {
      nr: 6,
      action: '„Simulation stoppen“ drücken, den Tageszeit-Regler ziehen, dann Strg+Z.',
      expected: 'Der Regler funktioniert wie früher; Strg+Z macht das Ziehen in einem Schritt rückgängig.',
      async run(t) {
        const { page } = t;
        await panel(t).getByTestId('sim-stop').click();
        await page.waitForTimeout(300);
        await page.locator('.panel.right').getByRole('button', { name: 'Projekt' }).click();
        const slider = page.getByRole('slider', { name: 'Tageszeit' });
        const h0 = (await t.project()).settings.timeOfDay;
        const past0 = await page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
        await slider.focus();
        await slider.fill('7');
        await page.waitForTimeout(400);
        const h1 = (await t.project()).settings.timeOfDay;
        const past1 = await page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(400);
        const h2 = (await t.project()).settings.timeOfDay;
        return { status: h1 === 7 && h1 !== h0 && h2 === h0 && past1 === past0 + 1 ? 'ok' : 'fail', observed: `Tageszeit im Projekt: ${h0} → ${h1} nach dem Ziehen (Undo-Schritte +${past1 - past0}) → ${h2} nach Strg+Z.` };
      },
    },
  ],
};
