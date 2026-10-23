// Smart Home: Blickrichtung der Sensoren mit Schieberegler (0–360°) (#280) – Testschritte aus dem Kommentar in #280.
const left = (t) => t.page.locator('.panel.left');
const right = (t) => t.page.locator('.panel.right');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const info = (t) => right(t).getByTestId('device-info');
const slider = (t) => info(t).getByTestId('device-rotation-slider');
const field = (t) => info(t).getByRole('textbox', { name: /^Blickrichtung/ });
const rotDeg = async (t) => Math.round((((await t.project()).devices[0].rotation * 180) / Math.PI + 360) % 360);
const fanPoints = (t) =>
  t.page.evaluate(() => {
    const d = document.querySelector('[data-testid="device-2d"] path')?.getAttribute('d');
    return d ? d.replace(/[MZ]/g, '').split('L').map((s) => s.trim().split(/\s+/).map(Number)) : [];
  });
const centroid = (p) => ({ x: p.reduce((s, q) => s + q[0], 0) / p.length, y: p.reduce((s, q) => s + q[1], 0) / p.length });
const share = (t) => panel(t).locator('[data-testid="coverage"][data-room="Wohnzimmer"]').getAttribute('data-share').then(Number);

export default {
  issue: 280,
  name: 'Blickrichtung-Regler',
  title: 'Smart Home: Blickrichtung der Sensoren mit Schieberegler (0–360°) drehen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter Smart Home → Geräte, einen Bewegungsmelder in einen Raum platzieren.',
      expected: 'Melder steht im Raum.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(300);
        const d = (await t.project()).devices[0];
        return { status: d?.kind === 'motion' ? 'ok' : 'fail', observed: `Gerät „${d?.name}“ bei (${d?.x.toFixed(2)} / ${d?.y.toFixed(2)}) m, Blickrichtung ${await rotDeg(t)}°.` };
      },
    },
    {
      nr: 2,
      action: 'Den Melder anklicken. Unter „Eigenschaften“ stehen bei „Blickrichtung“ das Zahlenfeld und darunter ein Schieberegler (0–360°).',
      expected: 'Zahlenfeld und Regler sind da.',
      async run(t) {
        const { page } = t;
        await page.getByTestId('device-2d').first().getByTestId('device-hit').click();
        await page.waitForTimeout(250);
        const min = await slider(t).getAttribute('min');
        const max = await slider(t).getAttribute('max');
        const val = await slider(t).inputValue();
        const f = await field(t).inputValue();
        await t.shot('Eigenschaften mit Regler');
        return { status: min === '0' && max === '360' && String(Number(f)) === val ? 'ok' : 'fail', observed: `Regler ${min}–${max}°, Wert ${val}°; Zahlenfeld ${f}°.` };
      },
    },
    {
      nr: 3,
      action: 'Den Regler langsam ziehen.',
      expected: 'Der Erfassungsbereich (Keil) im 2D-Plan dreht live mit, das Zahlenfeld zeigt denselben Wert.',
      async run(t) {
        const { page } = t;
        t.init = { rot: await rotDeg(t), share: await share(t).catch(() => NaN) };
        t.fan0 = centroid(await fanPoints(t));
        const box = await slider(t).boundingBox();
        const y = box.y + box.height / 2;
        const xAt = (deg) => box.x + 8 + ((box.width - 16) * deg) / 360;
        await page.mouse.move(xAt(t.init.rot), y);
        await page.mouse.down();
        const seen = [];
        for (const g of [120, 180, 250, 300]) {
          await page.mouse.move(xAt(g), y, { steps: 5 });
          await page.waitForTimeout(150);
          seen.push({ slider: Number(await slider(t).inputValue()), field: Number(await field(t).inputValue()), model: await rotDeg(t), fan: centroid(await fanPoints(t)) });
        }
        await page.mouse.up();
        t.drag = seen.at(-1);
        const moved = seen.every((s, i) => i === 0 || Math.hypot(s.fan.x - seen[i - 1].fan.x, s.fan.y - seen[i - 1].fan.y) > 0.01);
        const same = seen.every((s) => s.slider === s.field && s.model === s.slider);
        return { noFinalShot: false, status: moved && same ? 'ok' : 'fail', observed: `Beim Ziehen (4 Stationen): Regler/Zahlenfeld/Modell ${seen.map((s) => `${s.slider}/${s.field}/${s.model}°`).join(', ')}; Keilmitte wandert bei jeder Station: ${moved}.` };
      },
    },
    {
      nr: 4,
      action: 'Loslassen.',
      expected: 'Die Abdeckung des Raums in der Geräteliste passt sich an.',
      async run(t) {
        const { page } = t;
        await page.waitForTimeout(400);
        const s1 = await share(t);
        return { status: Number.isFinite(s1) && Math.abs(s1 - t.init.share) > 0.005 ? 'ok' : 'fail', observed: `Abdeckung „Wohnzimmer“ in der Geräteliste: ${(t.init.share * 100).toFixed(0)} % (Start, ${t.init.rot}°) → ${(s1 * 100).toFixed(0)} % (${t.drag.model}°).` };
      },
    },
    {
      nr: 5,
      action: 'Im Zahlenfeld 90 eingeben.',
      expected: 'Der Regler springt auf 90°, und der Melder schaut in die neue Richtung.',
      async run(t) {
        await field(t).fill('90');
        await field(t).press('Enter');
        await t.page.waitForTimeout(300);
        const sl = await slider(t).inputValue();
        const rot = await rotDeg(t);
        return { status: sl === '90' && rot === 90 ? 'ok' : 'fail', observed: `Regler ${sl}°, Modell ${rot}°.` };
      },
    },
    {
      nr: 6,
      action: 'Strg+Z drücken; nochmal Strg+Z.',
      expected: 'Die Eingabe von 90 wird rückgängig gemacht. Nochmal Strg+Z macht den ganzen Ziehvorgang in einem Schritt rückgängig.',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const a = await rotDeg(t);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(250);
        const b = await rotDeg(t);
        return { status: a === t.drag.model && b === t.init.rot ? 'ok' : 'fail', observed: `Nach 1. Strg+Z: ${a}° (Stand nach dem Ziehen: ${t.drag.model}°); nach 2. Strg+Z: ${b}° (Start: ${t.init.rot}°).` };
      },
    },
    {
      nr: 7,
      action: 'Neu laden.',
      expected: 'Die eingestellte Richtung ist erhalten.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Wiederholen' }).click();
        await page.getByRole('button', { name: 'Wiederholen' }).click();
        await page.waitForTimeout(1800);
        const before = await rotDeg(t);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const after = await rotDeg(t);
        return { status: before === 90 && after === 90 ? 'ok' : 'fail', observed: `Richtung vor/nach dem Neuladen: ${before}°/${after}°.` };
      },
    },
    {
      nr: 8,
      optional: true,
      action: 'Handy-Ansicht: Den Melder antippen und den Regler mit dem Finger ziehen.',
      expected: 'Er lässt sich bedienen, und der Melder dreht sich.',
      async run(t) {
        const { page } = t;
        await page.setViewportSize({ width: 390, height: 664 });
        await page.waitForTimeout(800);
        if (!(await page.locator('.app.phone').count())) return { status: 'skip', observed: 'Handy-Layout ließ sich per Fenstergröße nicht erzwingen.' };
        const id = (await t.project()).devices[0].id;
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id: i }), id);
        await page.waitForTimeout(500);
        // „Details“ in der Leiste öffnet das Eigenschaften-Blatt
        await page.getByRole('button', { name: 'Details' }).first().click().catch(() => undefined);
        await page.waitForTimeout(500);
        const sl = page.getByTestId('device-rotation-slider');
        if (!(await sl.isVisible().catch(() => false))) return { status: 'skip', observed: 'Regler im Handy-Blatt nicht sichtbar (Blatt ließ sich nicht öffnen).' };
        await sl.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await sl.boundingBox();
        const before = await rotDeg(t);
        // Fingerbedienung braucht Touch-Emulation (anderes Szenario-Gerät); hier nur mit der Maus im Handy-Layout
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 8 + ((box.width - 16) * before) / 360, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.75, y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const after = await rotDeg(t);
        const topEl = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}.${e.className}` : '–'; }, [box.x + box.width * 0.5, y]);
        return { status: before !== after ? 'ok' : 'fail', observed: `Element über der Mitte des Reglers: ${topEl}; Regler-Box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}. Handy-Layout (390×664) mit der Maus gezogen: ${before}° → ${after}° (Regler sichtbar und bedienbar: ${before !== after}). Mit dem Finger habe ich nicht gezogen (keine Touch-Emulation in diesem Lauf), nur mit der Maus im Handy-Layout.` };
      },
    },
  ],
};
