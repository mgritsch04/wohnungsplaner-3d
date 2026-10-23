// Smart Home: vorhandene Lampe smart machen statt ein neues Licht anzulegen (#250) – Testschritte aus dem Kommentar in #250.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const info = (t) => right(t).getByTestId('device-info');
const sum = (v) => (Array.isArray(v) ? v.reduce((a, q) => a + q.i, 0) : v);
const LIGHTS = [
  { id: 'light_ut_a', name: 'Deckenleuchte Wohnzimmer', x: 2.5, y: 2.0, elevation: 2.4, temperature: 2700, intensity: 3, on: true },
  { id: 'light_ut_b', name: 'Wandleuchte Wohnzimmer', x: 1.0, y: 1.0, elevation: 1.8, temperature: 3000, intensity: 2, on: true },
];
/** Point lights in the 3D scene within 0.35 m (horizontally) of a plan point, with their intensity. */
const sceneLights = (t, x, y) =>
  t.page.evaluate(([px, py]) => {
    const out = [];
    window.__wp.three.scene.traverse((o) => {
      if (o.isPointLight || o.isSpotLight) {
        const p = o.getWorldPosition(o.position.clone());
        if (Math.hypot(p.x - px, p.z - py) < 0.35) out.push({ i: o.intensity, y: p.y });
      }
    });
    return out;
  }, [x, y]);

export default {
  issue: 250,
  name: 'Vorhandene Lampe smart machen',
  title: 'Smart Home: vorhandene Lampe smart machen statt immer ein neues Licht anzulegen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Smart-Home-Reiter › Geräte: Geräteart „Smarte Lampe“ wählen, bei „Vorhandenes Licht nutzen“ die Leuchte auswählen und „Vorhandenes Licht smart machen“ klicken.',
      expected: 'Es entsteht kein zweites Licht; das Gerät sitzt an der Leuchte, Meldung „Lampe ist jetzt smart“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.evaluate((l) => window.__wp.useProjectStore.getState().apply((d) => void (d.lights = l)), LIGHTS);
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).locator('[data-testid="device-kind"][data-kind="light"]').click();
        await panel(t).getByLabel('Vorhandenes Licht nutzen').selectOption({ label: `${LIGHTS[0].name} (Wohnzimmer)` });
        await panel(t).getByTestId('device-add-existing').click();
        await page.waitForTimeout(300);
        const p = await t.project();
        const dev = p.devices[0];
        const toast = await page.getByText(/ist jetzt smart/).first().innerText().catch(() => '');
        await t.shot('Lampe ist jetzt smart');
        return { status: p.lights.length === 2 && p.devices.length === 1 && dev.lightId === LIGHTS[0].id && /ist jetzt smart/.test(toast) && Math.abs(dev.x - LIGHTS[0].x) < 0.05 && Math.abs(dev.y - LIGHTS[0].y) < 0.05 ? 'ok' : 'fail', observed: `Lichter im Projekt: ${p.lights.length} (vorher 2); Geräte: ${p.devices.length}; Gerät „${dev?.name}“ bei (${dev?.x.toFixed(2)} / ${dev?.y.toFixed(2)}) m, verknüpft mit der Deckenleuchte: ${dev?.lightId === LIGHTS[0].id}; Meldung: „${toast.trim()}“.` };
      },
    },
    {
      nr: 2,
      action: 'Eine andere Leuchte im Plan anklicken, unter „Eigenschaften › Smart Home“ ein Produkt wählen und „Smart machen“ klicken.',
      expected: 'Gleiches Ergebnis wie in Schritt 1; danach steht dort „Smart: …“.',
      async run(t) {
        const { page } = t;
        await page.evaluate((id) => { window.__wp.useUiStore.getState().setSelection({ type: 'light', id }); window.__wp.useUiStore.getState().setRightTab('properties'); }, LIGHTS[1].id);
        await page.waitForTimeout(300);
        await right(t).getByTestId('light-make-smart').click();
        await page.waitForTimeout(300);
        const p = await t.project();
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'light', id }), LIGHTS[1].id);
        await page.waitForTimeout(300);
        const linked = (await right(t).getByTestId('light-smart-linked').innerText().catch(() => '')).trim();
        const dev = p.devices.find((d) => d.lightId === LIGHTS[1].id);
        return { status: p.lights.length === 2 && p.devices.length === 2 && dev && /^Smart: /.test(linked) ? 'ok' : 'fail', observed: `Lichter: ${p.lights.length}, Geräte: ${p.devices.length}; Gerät an der Wandleuchte: ${dev?.name ?? 'keins'}; Anzeige: „${linked.slice(0, 90)}“.` };
      },
    },
    {
      nr: 3,
      action: 'Smart-Home-Reiter › Testen: Lampe per Gerät ein- und ausschalten.',
      expected: 'Genau diese vorhandene Leuchte leuchtet in 3D auf und geht wieder aus.',
      async run(t) {
        const { page } = t;
        const p = await t.project();
        const dev = p.devices.find((d) => d.lightId === LIGHTS[0].id);
        await panel(t).getByTestId('sh-step-test').click();
        await panel(t).getByTestId('sim-start').click();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id }), dev.id);
        await page.evaluate(() => window.__wp.useUiStore.getState().setRightTab('properties'));
        await page.waitForTimeout(300);
        const toggle = info(t).getByTestId('device-toggle');
        const read = async () => ({ me: sum(await sceneLights(t, LIGHTS[0].x, LIGHTS[0].y)), other: sum(await sceneLights(t, LIGHTS[1].x, LIGHTS[1].y)), label: (await toggle.innerText()).trim() });
        const s0 = await read();
        await toggle.click();
        await page.waitForTimeout(800);
        const s1 = await read();
        await toggle.click();
        await page.waitForTimeout(800);
        const s2 = await read();
        await t.shot('3D: Deckenleuchte wieder an');
        await toggle.click();
        await page.waitForTimeout(800);
        const s3 = await read();
        const proj = (await t.project()).lights;
        const f = (x) => x.me.toFixed(2);
        const ok = s0.me > 0.5 && s1.me < 0.01 && s2.me > 0.5 && s3.me < 0.01 && [s1, s2, s3].every((x) => Math.abs(x.other - s0.other) < 1e-6);
        return { status: ok ? 'ok' : 'fail', observed: `Lichtstärke der Deckenleuchte in 3D (Summe der Lichter in 0,35 m): Start ${f(s0)} (Knopf „${s0.label}“), nach 1. Druck ${f(s1)}, nach 2. Druck ${f(s2)}, nach 3. Druck ${f(s3)}; die andere Leuchte bleibt unverändert (${s0.other.toFixed(2)}): ${[s1, s2, s3].every((x) => Math.abs(x.other - s0.other) < 1e-6)}; Lichter im Projekt unverändert an: ${proj.every((l) => l.on)}.` };
      },
    },
    {
      nr: 4,
      action: 'Gerät löschen, danach Strg+Z.',
      expected: 'Die Leuchte bleibt als normale Leuchte stehen; Rückgängig stellt das Gerät wieder her.',
      async run(t) {
        const { page } = t;
        const dev = (await t.project()).devices.find((d) => d.lightId === LIGHTS[0].id);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id }), dev.id);
        await page.waitForTimeout(250);
        await info(t).getByTestId('device-delete').click();
        await page.waitForTimeout(300);
        const p1 = await t.project();
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        const p2 = await t.project();
        return { status: p1.devices.length === 1 && p1.lights.some((l) => l.id === LIGHTS[0].id) && p2.devices.some((d) => d.lightId === LIGHTS[0].id) ? 'ok' : 'fail', observed: `Nach Löschen: Geräte ${p1.devices.length}, Leuchte noch da: ${p1.lights.some((l) => l.id === LIGHTS[0].id)}; nach Strg+Z: Geräte ${p2.devices.length}, Verknüpfung wieder da: ${p2.devices.some((d) => d.lightId === LIGHTS[0].id)}.` };
      },
    },
    {
      nr: 5,
      action: 'Projekt speichern und neu laden.',
      expected: 'Die Verknüpfung bleibt erhalten.',
      async run(t) {
        const { page } = t;
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const p = await t.project();
        const ok = p.devices.length === 2 && p.devices.every((d) => LIGHTS.some((l) => l.id === d.lightId)) && p.lights.length === 2;
        return { status: ok ? 'ok' : 'fail', observed: `Nach dem Neuladen: ${p.devices.length} Geräte, verknüpft mit ${p.devices.map((d) => p.lights.find((l) => l.id === d.lightId)?.name ?? '–').join(' und ')}; Lichter ${p.lights.length}.` };
      },
    },
  ],
};
