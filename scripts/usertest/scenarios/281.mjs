// Smart Home: Bewegungsmelder erkennen eine sich bewegende Tür (#281) – Testschritte aus dem Kommentar in #281.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const sensor = (t) => t.page.locator('[data-testid="device-2d"][data-device="Bewegungsmelder Wohnzimmer"]');
const lamp = (t) => t.page.locator('[data-testid="device-2d"][data-device="Smarte Lampe Wohnzimmer"]');
const on = async (loc) => (await loc.getAttribute('data-on')) === 'true';
const log = async (t) => (await panel(t).getByTestId('sim-log').innerText().catch(() => '')).replace(/\n/g, ' | ');
const doorOpen = async (t) => (await t.project()).openings.find((o) => o.id === t.door.id).open;
/** Tür über „Tür geöffnet“ in den Eigenschaften (rechts) setzen */
async function setDoor(t, open) {
  const { page } = t;
  await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id }), t.door.id);
  await page.waitForTimeout(200);
  const cb = right(t).getByLabel('Tür geöffnet');
  if (open) await cb.check(); else await cb.uncheck();
  await page.waitForTimeout(300);
}
const waitQuiet = async (t) => {
  await panel(t).getByLabel('Tempo').selectOption({ label: '10× schneller' });
  const q = await t.poll(async () => ((await on(sensor(t))) ? null : 1), 25000);
  await panel(t).getByLabel('Tempo').selectOption({ label: 'Echtzeit' });
  return !!q;
};
const waitSensor = (t, v, ms = 4000) => t.poll(async () => (((await on(sensor(t))) === v) ? 1 : null), ms);
const setSensor = (t, s) => t.page.evaluate((q) => window.__wp.useProjectStore.getState().apply((d) => { Object.assign(d.devices.find((x) => x.kind === 'motion'), q); }), s);

export default {
  issue: 281,
  name: 'Melder sehen die Tür',
  title: 'Smart Home: Bewegungsmelder erkennen eine sich öffnende oder schließende Tür',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter Smart Home → Geräte: Bewegungsmelder und Smarte Lampe in einen Raum mit Tür platzieren, den Melder zur Tür drehen.',
      expected: 'Melder und Lampe stehen im Wohnzimmer, der Melder schaut zur Tür.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        const door = await page.evaluate(() => {
          const p = window.__wp.useProjectStore.getState().project;
          const o = p.openings.find((q) => q.kind === 'door' && Math.abs(q.width - 0.9) < 1e-6);
          const w = p.walls.find((x) => x.id === o.wallId);
          const n = (id) => p.nodes.find((q) => q.id === id);
          const a = n(w.a), b = n(w.b);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const k = (o.offset + o.width / 2) / len;
          return { id: o.id, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        });
        t.door = door;
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-add').click();
        await panel(t).locator('[data-testid="device-kind"][data-kind="light"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(300);
        // Tür zu, Melder 2 m vor der Tür mit Blick auf sie
        const s = { x: door.x - 2.2, y: door.y, rotation: 0 };
        await page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { for (const o of d.openings) if (o.id === id) o.open = false; }), door.id);
        await setSensor(t, s);
        await page.waitForTimeout(300);
        await t.shot('Melder schaut zur Tür');
        return { status: 'ok', observed: `Tür bei (${door.x.toFixed(2)} / ${door.y.toFixed(2)}) m (geschlossen); Melder bei (${s.x.toFixed(2)} / ${s.y.toFixed(2)}) m, Blick nach Osten zur Tür; Lampe im Wohnzimmer.` };
      },
    },
    {
      nr: 2,
      action: 'Beim Melder „Regel anlegen“ und unter „Regeln“ „Nur wenn es dunkel ist“ ausschalten.',
      expected: 'Regel ohne „nur wenn dunkel“.',
      async run(t) {
        const { page } = t;
        await panel(t).getByTestId('sh-step-rules').click();
        await panel(t).getByTestId('automation-add').click();
        await panel(t).getByTestId('automation').first().locator('summary').click();
        await panel(t).getByLabel('Nur wenn es dunkel ist').uncheck();
        await page.waitForTimeout(300);
        const a = (await t.project()).automations[0];
        return { status: a && a.onlyWhenDark === false ? 'ok' : 'fail', observed: `Regel „${a?.name}“: nur wenn dunkel = ${a?.onlyWhenDark}; schaltet ${a?.action.deviceIds.length} Gerät(e).` };
      },
    },
    {
      nr: 3,
      action: 'Schritt „Testen“: Simulation starten, keine Person in den Raum stellen.',
      expected: 'Simulation läuft, Melder ruhig.',
      async run(t) {
        await panel(t).getByTestId('sh-step-test').click();
        await panel(t).getByTestId('sim-start').click();
        await panel(t).getByTestId('sim-clock').waitFor();
        await t.page.waitForTimeout(1200);
        const s = await on(sensor(t));
        const l = await on(lamp(t));
        return { status: !s && !l ? 'ok' : 'fail', observed: `Person im Plan: ${await t.page.getByTestId('sim-person-2d').count()}; Melder meldet Bewegung: ${s}; Lampe an: ${l}.` };
      },
    },
    {
      nr: 4,
      action: 'Die Tür öffnen (Eigenschaften der Tür → „Tür geöffnet“).',
      expected: 'Der Melder meldet „Bewegung“, das Protokoll zeigt „… Bewegung erkannt (Tür)“, die Lampe geht an.',
      async run(t) {
        await setDoor(t, true);
        const s = await waitSensor(t, true);
        await t.page.waitForTimeout(500);
        const lg = await log(t);
        const l = await on(lamp(t));
        await t.shot('Tür geöffnet: Bewegung');
        return { status: s && /Bewegung erkannt \(Tür\)/.test(lg) && l ? 'ok' : 'fail', observed: `Tür offen: ${await doorOpen(t)}; Melder Bewegung: ${!!s}; Lampe an: ${l}; Protokoll: „${lg.slice(0, 160)}“.` };
      },
    },
    {
      nr: 5,
      action: 'Warten, bis der Melder wieder „ruhig“ ist, dann die Tür schließen.',
      expected: 'Der Melder meldet wieder „Bewegung“.',
      async run(t) {
        const quiet = await waitQuiet(t);
        const before = (await log(t)).match(/Bewegung erkannt/g)?.length ?? 0;
        await setDoor(t, false);
        const s = await waitSensor(t, true);
        const lg = await log(t);
        return { status: quiet && s && /Bewegung erkannt \(Tür\)/.test(lg) ? 'ok' : 'fail', observed: `Melder war ruhig: ${quiet}; Tür offen: ${await doorOpen(t)}; nach dem Schließen Melder Bewegung: ${!!s}; Protokoll: „${lg.slice(0, 140)}“ (vorher ${before} Meldungen sichtbar).` };
      },
    },
    {
      nr: 6,
      action: 'Den Melder von der Tür wegdrehen und die Tür öffnen.',
      expected: 'Keine Meldung.',
      async run(t) {
        const quiet = await waitQuiet(t);
        await setSensor(t, { rotation: Math.PI });
        await t.page.waitForTimeout(400);
        await setDoor(t, true);
        await t.page.waitForTimeout(2500);
        const s = await on(sensor(t));
        const lg = await log(t);
        const recent = lg.split(' | ')[0];
        await t.shot('Melder schaut weg');
        return { status: quiet && !s && !/Bewegung erkannt/.test(recent) ? 'ok' : 'fail', observed: `Melder war ruhig: ${quiet}; Blick nach Westen (weg von der Tür), Tür offen: ${await doorOpen(t)}; Melder Bewegung nach 2,5 s: ${s}; neuester Protokolleintrag: „${recent}“.` };
      },
    },
    {
      nr: 7,
      action: 'Im Rundgang (Begehen) an die Tür treten, stillstehen und die Tür mit F öffnen.',
      expected: 'Der Melder in Sichtweite meldet „Bewegung“.',
      async run(t) {
        const { page } = t;
        // Melder wieder zur Tür, Tür zu, Melder ruhig
        await setSensor(t, { rotation: 0 });
        await setDoor(t, false);
        const quiet = await waitQuiet(t);
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        const d = t.door;
        // Person 1,2 m vor der Tür, Blick zur Tür; Tür von Westen her, Melder steht 2,2 m davor
        await page.evaluate(([x, y]) => window.__wp.useCameraRig.getState().walk.set({ x, z: y, eye: 1.6, yaw: Math.PI / 2, pitch: 0 }), [d.x - 1.0, d.y + 0.9]);
        await page.waitForTimeout(2000);
        const first = async () => (await log(t)).split(' | ')[0];
        // die Ankunft der Person löst den Melder selbst aus: stillstehen, bis er wieder „ruhig“ ist (10-faches Tempo)
        await panel(t).getByLabel('Tempo').selectOption({ label: '10× schneller' });
        await t.poll(async () => (/keine Bewegung mehr/.test(await first()) ? 1 : null), 25000);
        await panel(t).getByLabel('Tempo').selectOption({ label: 'Echtzeit' });
        await page.waitForTimeout(1500);
        const lg0 = await first();
        const stillQuiet = /keine Bewegung mehr/.test(lg0);
        await page.evaluate(([x, y]) => {
          const wp = window.__wp; const c = wp.three.camera.position;
          wp.walk.look(Math.atan2(-(x - c.x), -(y - c.z)), Math.atan2(1.0 - c.y, Math.hypot(x - c.x, y - c.z)));
        }, [d.x, d.y]);
        await page.waitForTimeout(500);
        const aimed = await page.evaluate(() => window.__wp.walk.targetOpening());
        await page.keyboard.press('f');
        const s = await t.poll(async () => (/Bewegung erkannt \(Tür\)/.test(await first()) ? 1 : null), 4000);
        const lg = await first();
        await t.shot('Rundgang: Tür mit F geöffnet');
        return { status: quiet && stillQuiet && aimed === d.id && (await doorOpen(t)) && s ? 'ok' : 'fail', observed: `Melder vorher ruhig: ${quiet && stillQuiet}; Tür im Fadenkreuz: ${aimed === d.id}; Tür offen nach F: ${await doorOpen(t)}; Protokoll vorher „${lg0}“, nachher „${lg}“.` };
      },
    },
  ],
};
