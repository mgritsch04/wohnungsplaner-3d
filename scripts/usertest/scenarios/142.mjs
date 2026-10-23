// Begehen: Blickrichtung springt (#142) – Testschritte aus dem Kommentar in #142.
const canvas = (t) => t.page.locator('[data-testid="scene3d"] canvas');
const pose = (t) =>
  t.page.evaluate(() => {
    const c = window.__wp.three.camera;
    return { x: c.position.x, z: c.position.z, yaw: c.rotation.y, locked: !!document.pointerLockElement };
  });
/** Smallest signed angle a → b in degrees. */
const turn = (a, b) => (Math.atan2(Math.sin(b - a), Math.cos(b - a)) * 180) / Math.PI;
const r1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const r3 = (v) => v.toFixed(3).replace('.', ',');
/** Move the (captured) mouse horizontally in `n` events of `dx` pixels, `pause` ms apart; returns the yaw change per event. */
async function sweep(t, dx, n, pause) {
  const changes = [];
  // start where the whole sweep fits on screen (the cursor is captured, only the movement counts);
  // the jump to the start is one large event that the look filter drops, then a short settle
  let mx = dx > 0 ? 40 : 1400;
  await t.page.mouse.move(mx, 450);
  for (let i = 0; i < 3; i++) await t.page.mouse.move((mx += Math.sign(dx)), 450);
  await t.page.waitForTimeout(pause);
  let last = (await pose(t)).yaw;
  for (let i = 0; i < n; i++) {
    mx += dx;
    await t.page.mouse.move(mx, 450);
    await t.page.waitForTimeout(pause);
    const y = (await pose(t)).yaw;
    changes.push(turn(last, y));
    last = y;
  }
  return changes;
}
/** A single raw mouse event as some browsers deliver it (the cause of the reported jump). */
const rawMove = (t, dx) => t.page.evaluate((m) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: m, movementY: 0, bubbles: true })), dx);

export default {
  issue: 142,
  name: 'Blickrichtung beim Begehen',
  title: 'Begehen: Blickrichtung springt teilweise stark, gefühlt um 180 Grad',
  device: 'desktop',
  pc: false,
  realDevice: ['Echte Maus über längere Zeit (der Sprung kam von einzelnen fehlerhaften Mausereignissen des Browsers; hier sind sie nachgestellt)'],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen, oben auf 3D, dann Begehen, in die Ansicht klicken (Maus wird gefangen).',
      expected: 'Fadenkreuz in der Mitte.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await canvas(t).waitFor({ timeout: 20000 });
        await page.waitForTimeout(1200);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(800);
        await canvas(t).click();
        await page.waitForTimeout(500);
        const cross = await page.getByTestId('crosshair').boundingBox();
        const c = await canvas(t).boundingBox();
        const centred = cross && Math.abs(cross.x + cross.width / 2 - (c.x + c.width / 2)) < 3 && Math.abs(cross.y + cross.height / 2 - (c.y + c.height / 2)) < 3;
        const p = await pose(t);
        return {
          status: centred && p.locked ? 'ok' : 'fail',
          observed: `Fadenkreuz ${cross ? (centred ? 'in der Mitte der Ansicht' : 'nicht mittig') : 'fehlt'}, Maus ${p.locked ? 'gefangen' : 'nicht gefangen'}.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Die Maus langsam und gleichmäßig nach links und rechts bewegen, etwa eine Minute lang, auch mal länger in eine Richtung.',
      expected: 'Der Blick folgt gleichmäßig. Keine plötzliche Drehung um ca. 180°.',
      async run(t) {
        const parts = [];
        let worst = 0;
        let wrong = 0;
        for (const [dx, n] of [[4, 120], [-4, 200], [3, 200], [-5, 150]]) {
          const ch = await sweep(t, dx, n, 40);
          worst = Math.max(worst, ...ch.map(Math.abs));
          wrong += ch.filter((c) => Math.abs(c) > 0.01 && Math.sign(c) === Math.sign(dx)).length; // mouse right turns the view right (yaw decreases)
          parts.push(`${n} × ${dx > 0 ? 'rechts' : 'links'} ${Math.abs(dx)} px: zusammen ${r1(Math.abs(ch.reduce((a, b) => a + b, 0)))}° (${r3(Math.abs(ch.reduce((a, b) => a + b, 0)) / n / Math.abs(dx))}° pro px)`);
        }
        // the reported jump: one faulty event of ±1400 px in the middle of slow motion
        const before = (await pose(t)).yaw;
        await sweep(t, 4, 5, 40);
        const mid = (await pose(t)).yaw;
        await rawMove(t, 1400);
        await t.page.waitForTimeout(100);
        const afterSpike = (await pose(t)).yaw;
        await rawMove(t, -1350);
        await t.page.waitForTimeout(100);
        const afterSpike2 = (await pose(t)).yaw;
        await sweep(t, 4, 5, 40);
        const spikeTurn = Math.max(Math.abs(turn(mid, afterSpike)), Math.abs(turn(afterSpike, afterSpike2)));
        const ok = worst <= 3 && wrong === 0 && spikeTurn <= 2 && Math.abs(turn(before, (await pose(t)).yaw)) < 20;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Etwa 670 langsame Mausbewegungen (rund 27 s): ${parts.join('; ')}. Größte Drehung pro Mausereignis ${r1(worst)}°, Drehung gegen die Mausrichtung: ${wrong}×. Einzelnes fehlerhaftes Mausereignis (+1400 px bzw. −1350 px, wie es der Browser manchmal schickt) mitten in der langsamen Bewegung: Blick dreht sich um ${r1(spikeTurn)}° – ${spikeTurn <= 2 ? 'kein Sprung' : 'Sprung'}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Schnelle Mausbewegungen machen (kräftig nach links/rechts wischen).',
      expected: 'Der Blick dreht schnell mit, ohne Sprung.',
      async run(t) {
        const r = await sweep(t, 120, 8, 25);
        const l = await sweep(t, -120, 8, 25);
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        const follows = Math.abs(sum(r)) > 40 && Math.abs(sum(l)) > 40 && Math.sign(sum(r)) !== Math.sign(sum(l));
        const worst = Math.max(...[...r, ...l].map(Math.abs));
        return {
          status: follows && worst < 90 ? 'ok' : 'fail',
          observed: `8 schnelle Wischer nach rechts (je 120 px): Blick dreht ${r1(Math.abs(sum(r)))}°; 8 nach links: ${r1(Math.abs(sum(l)))}°. Größte Drehung pro Mausereignis ${r1(worst)}° – ${follows ? 'dreht schnell mit' : 'dreht nicht mit'}${worst < 90 ? ', ohne Sprung' : ', Sprung'}.`,
        };
      },
    },
    {
      nr: 4,
      action: 'Esc drücken, mit Alt+Tab kurz in ein anderes Fenster und zurück, wieder in die Ansicht klicken und weiter umsehen.',
      expected: 'Kein Sprung beim Wiedereintreten.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.exitPointerLock()); // what Esc does in a real browser
        await page.waitForTimeout(300);
        const freed = !(await pose(t)).locked;
        // Alt+Tab: the window loses and regains focus
        await page.evaluate(() => {
          window.dispatchEvent(new Event('blur'));
          window.dispatchEvent(new Event('focus'));
        });
        const y0 = (await pose(t)).yaw;
        await canvas(t).click();
        await page.waitForTimeout(400);
        const relocked = (await pose(t)).locked;
        const yClick = (await pose(t)).yaw;
        // some browsers report the whole distance the cursor travelled meanwhile as the first movement
        await rawMove(t, 900);
        await page.waitForTimeout(100);
        const yFirst = (await pose(t)).yaw;
        const ch = await sweep(t, 4, 30, 40);
        const jump = Math.max(Math.abs(turn(y0, yClick)), Math.abs(turn(yClick, yFirst)));
        const ok = freed && relocked && jump <= 2 && Math.max(...ch.map(Math.abs)) <= 3;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Esc: Maus ${freed ? 'freigegeben' : 'noch gefangen'}. Fenster verlassen und zurück (simuliert), wieder in die Ansicht geklickt: Maus ${relocked ? 'gefangen' : 'nicht gefangen'}. Blickänderung durch Klick und erstes Mausereignis (900 px, wie nach Alt+Tab möglich): ${r1(jump)}°. Danach weiter umgesehen: gleichmäßig (größte Drehung pro Ereignis ${r1(Math.max(...ch.map(Math.abs)))}°).`,
        };
      },
    },
    {
      nr: 5,
      action: 'Beim Begehen auf eine Tür schauen und E drücken (Tür öffnen/schließen), außerdem ein Möbel anklicken.',
      expected: 'Du bleibst, wo du bist, und schaust weiter in dieselbe Richtung (vorher konnte man auf den Startpunkt zurückgesetzt werden).',
      async run(t) {
        const { page } = t;
        // walk a bit away from the start point first
        await page.evaluate(() => {
          const c = window.__wp.three.camera.position;
          c.x = 3.8;
          c.z = 1.6;
        });
        const aim = (x, y, h) =>
          page.evaluate(
            ([tx, ty, th]) => {
              const wp = window.__wp;
              const c = wp.three.camera.position;
              wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
            },
            [x, y, h],
          );
        const door = (await t.project()).openings.find((o) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
        const leaf = await page.evaluate((oid) => {
          const th = window.__wp.three;
          const v = th.scene.getObjectByName(`leaf:${oid}:0`).children[0].getWorldPosition(th.camera.position.clone());
          return { x: v.x, y: v.z };
        }, door.id);
        await aim(leaf.x, leaf.y, 1.0); // the open leaf stands in the living room
        const aimed = await t.poll(async () => ((await page.evaluate(() => window.__wp.walk.targetOpening())) === door.id ? true : null), 3000);
        const p0 = await pose(t);
        const wasOpen = door.open;
        await page.keyboard.press('f');
        const toggled = await t.poll(async () => ((await t.project()).openings.find((o) => o.id === door.id).open !== wasOpen ? true : null), 3000);
        await page.waitForTimeout(800);
        const p1 = await pose(t);
        const table = await t.furniture((f) => f.catalogId === 'generic-coffee-table');
        await aim(table.x, table.y, 0.3);
        await page.waitForTimeout(400);
        const p2 = await pose(t);
        await canvas(t).click();
        await page.waitForTimeout(800);
        const p3 = await pose(t);
        const sel = await t.selection();
        const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
        const ok = toggled && moved(p0, p1) < 0.01 && Math.abs(turn(p0.yaw, p1.yaw)) <= 1 && moved(p2, p3) < 0.01 && Math.abs(turn(p2.yaw, p3.yaw)) <= 1;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Auf die Innentür geschaut (im Fadenkreuz: ${aimed ? 'ja' : 'nein'}), E: Tür ${toggled ? (wasOpen ? 'geschlossen' : 'geöffnet') : 'unverändert'}; Position ${Math.round(moved(p0, p1) * 100)} cm verschoben, Blick ${r1(Math.abs(turn(p0.yaw, p1.yaw)))}° gedreht. Couchtisch angeklickt (Auswahl danach: ${sel?.type === 'furniture' ? 'Möbel' : sel?.type ?? 'keine'}): Position ${Math.round(moved(p2, p3) * 100)} cm verschoben, Blick ${r1(Math.abs(turn(p2.yaw, p3.yaw)))}° gedreht.`,
        };
      },
    },
  ],
};
