// Smart Home: Sichtlinie der Melder durch Türblätter und hohe Möbel blockiert (#236) – Testschritte aus dem Kommentar in #236.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');

/** Erfassungsfächer des ersten Geräts im 2D-Plan: Eckpunkte (m) aus dem SVG-Pfad. */
const fan = (t) =>
  t.page.evaluate(() => {
    const d = document.querySelector('[data-testid="device-2d"] path')?.getAttribute('d');
    if (!d) return null;
    return d.replace(/[MZ]/g, '').split('L').map((s) => s.trim().split(/\s+/).map(Number));
  });
const inside = (poly, [x, y]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const area = (p) => Math.abs(p.reduce((a, [x1, y1], i) => a + (x1 * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y1), 0) / 2);
const reach = (p, s) => Math.max(...p.map(([x, y]) => Math.hypot(x - s.x, y - s.y)));
const SENSOR = { x: 0.1, y: 2.0, rotation: 0 };
const setSensor = (t, s) => t.page.evaluate((q) => window.__wp.useProjectStore.getState().apply((d) => { Object.assign(d.devices[0], q); }), s);
const setDoors = (t, open) => t.page.evaluate((o) => window.__wp.useProjectStore.getState().apply((d) => { for (const q of d.openings) if (q.kind === 'door') q.open = o; }), open);
const setFurniture = (t, item) =>
  t.page.evaluate((it) => window.__wp.useProjectStore.getState().apply((d) => {
    const tpl = { category: 'storage', color: '#8a8a84', model: { type: 'procedural', shape: 'box' }, quantity: 1, approximate: true, locked: false, existing: false };
    d.furniture = it ? [{ ...tpl, id: 'item_ut' + Math.round(it.h * 10), name: it.name, x: it.x, y: it.y, rotation: 0, width: it.w, depth: it.d, height: it.h, elevation: 0, solid: true }] : [];
  }), item);

export default {
  issue: 236,
  name: 'Sichtlinie der Melder',
  title: 'Smart Home: Sichtlinie der Melder auch durch Türblätter und hohe Möbel blockieren',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im 2D-Plan den Erfassungsfächer des Melders ansehen, ohne Möbel im Raum.',
      expected: 'Der Fächer reicht bis zur gegenüberliegenden Wand.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="motion"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(300);
        await setFurniture(t, null);
        await setDoors(t, false);
        await setSensor(t, SENSOR);
        await page.waitForTimeout(300);
        const p = await fan(t);
        const far = p ? p.filter(([x]) => x > 4.9).length : 0;
        await t.shot('Fächer ohne Möbel');
        return { status: p && inside(p, [4.8, 2.0]) && far > 0 ? 'ok' : 'fail', observed: `Melder bei (0,1 / 2,0) m, Blick nach Osten; Fächer reicht bis x = ${p ? Math.max(...p.map((q) => q[0])).toFixed(2) : '–'} m (Ostwand bei 5,0 m); Punkt 0,2 m vor der Wand im Fächer: ${p ? inside(p, [4.8, 2.0]) : false}.` };
      },
    },
    {
      nr: 2,
      action: 'Einen hohen Schrank (etwa 2 m hoch) mitten in den Fächer stellen.',
      expected: 'Der Fächer endet am Schrank; dahinter ist ein unerfasster Schatten.',
      async run(t) {
        const free = await fan(t);
        await setFurniture(t, { name: 'Hoher Schrank', x: 2.0, y: 2.0, w: 0.6, d: 0.6, h: 2.0 });
        await t.page.waitForTimeout(400);
        const p = await fan(t);
        if (!p) return { status: 'fail', observed: `Kein Fächer; Seite: ${(await t.page.locator('body').innerText()).slice(0, 300)} | Geräte: ${(await t.page.getByTestId('device-2d').count())}` };
        const behind = inside(p, [3.5, 2.0]);
        const front = inside(p, [1.0, 2.0]);
        await t.shot('Schatten hinter dem Schrank');
        return { status: !behind && front && area(p) < area(free) - 0.3 ? 'ok' : 'fail', observed: `Fläche ${area(free).toFixed(1)} → ${area(p).toFixed(1)} m²; Punkt 1,5 m hinter dem Schrank erfasst: ${behind}; Punkt davor erfasst: ${front}.` };
      },
    },
    {
      nr: 3,
      action: 'Den Schrank gegen ein niedriges Sofa austauschen (unter 1 m hoch).',
      expected: 'Der Fächer geht über das Sofa hinweg bis zur Wand, kein Schatten.',
      async run(t) {
        await setFurniture(t, { name: 'Niedriges Sofa', x: 2.0, y: 2.0, w: 0.9, d: 0.9, h: 0.8 });
        await t.page.waitForTimeout(400);
        const p = await fan(t);
        const behind = inside(p, [3.5, 2.0]);
        await t.shot('Fächer über das Sofa');
        return { status: behind && inside(p, [4.8, 2.0]) ? 'ok' : 'fail', observed: `Sofa 0,8 m hoch: Punkt hinter dem Sofa erfasst: ${behind}; bis zur Wand: ${inside(p, [4.8, 2.0])}; Fläche ${area(p).toFixed(1)} m².` };
      },
    },
    {
      nr: 4,
      action: 'Die Tür des Raums öffnen, sodass das Türblatt in den Fächer des Melders ragt.',
      expected: 'Hinter dem offenen Türblatt (zur Wand hin) ist der Fächer abgeschnitten. Schließt man die Tür, ist die Ecke wieder erfasst.',
      async run(t) {
        await setFurniture(t, null);
        const s = { x: 0.1, y: 3.9, rotation: Math.atan2(2 - 3.9, 2.5 - 0.1) };
        await setSensor(t, s);
        await setDoors(t, false);
        await t.page.waitForTimeout(400);
        const closed = await fan(t);
        await setDoors(t, true);
        await t.page.waitForTimeout(400);
        const open = await fan(t);
        await t.shot('Tür offen: Fächer abgeschnitten');
        await setDoors(t, false);
        await t.page.waitForTimeout(400);
        const again = await fan(t);
        // Punkte, die nur bei geschlossener Tür erfasst sind
        let lost = 0, regained = 0;
        for (let x = 0.3; x < 5; x += 0.2) for (let y = 0.2; y < 4; y += 0.2) {
          if (inside(closed, [x, y]) && !inside(open, [x, y])) { lost++; if (inside(again, [x, y])) regained++; }
        }
        return { status: lost > 3 && regained === lost && area(open) < area(closed) - 1 ? 'ok' : 'fail', observed: `Melder bei (0,1 / 3,9) m; Fläche Tür zu ${area(closed).toFixed(1)} m², Tür offen ${area(open).toFixed(1)} m²; ${lost} Rasterpunkte nur ohne offenes Türblatt erfasst, davon nach dem Schließen wieder erfasst: ${regained}.` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Optional: In der Simulation die Person hinter den hohen Schrank stellen bzw. bewegen.',
      expected: 'Der Melder meldet keine Bewegung; die Abdeckung des Raums sinkt, sobald der Schrank steht.',
      async run(t) {
        const { page } = t;
        await setSensor(t, SENSOR);
        await setDoors(t, false);
        await setFurniture(t, null);
        await page.waitForTimeout(300);
        const cover = async () => {
          await panel(t).getByTestId('sh-step-devices').click();
          const el = panel(t).locator('[data-testid="coverage"][data-room="Wohnzimmer"]');
          await el.waitFor({ timeout: 4000 }).catch(() => undefined);
          return Number(await el.getAttribute('data-share').catch(() => 'NaN'));
        };
        const c0 = await cover();
        await setFurniture(t, { name: 'Hoher Schrank', x: 2.0, y: 2.0, w: 0.6, d: 0.6, h: 2.0 });
        await page.waitForTimeout(400);
        const c1 = await cover();
        await panel(t).getByTestId('sh-step-test').click();
        await panel(t).getByTestId('sim-start').click();
        await panel(t).getByTestId('sim-person').click();
        await page.waitForTimeout(300);
        const marker = page.getByTestId('sim-person-2d');
        const moveTo = async (x, y) => {
          const b = await marker.boundingBox();
          const to = await t.planToScreen(x, y);
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 12 });
          await page.mouse.move(to.x + 4, to.y + 2, { steps: 4 });
          await page.waitForTimeout(250);
        };
        const on = () => page.locator('[data-testid="device-2d"][data-on="true"]').count();
        let max = 0;
        await moveTo(3.0, 2.0);
        for (let i = 0; i < 6; i++) { max = Math.max(max, await on()); await page.waitForTimeout(200); }
        await page.mouse.up();
        const hidden = max;
        await setFurniture(t, null);
        await page.waitForTimeout(300);
        await moveTo(3.2, 2.1);
        let seen = 0;
        for (let i = 0; i < 6; i++) { seen = Math.max(seen, await on()); await page.waitForTimeout(200); }
        await page.mouse.up();
        return { noFinalShot: true, status: c1 < c0 && hidden === 0 && seen > 0 ? 'ok' : 'fail', observed: `Abdeckung Wohnzimmer ohne Schrank ${(c0 * 100).toFixed(0)} % → mit Schrank ${(c1 * 100).toFixed(0)} %; Person hinter dem Schrank bewegt: Melder an = ${hidden > 0}; Kontrolle ohne Schrank: Melder an = ${seen > 0}.` };
      },
    },
  ],
};
