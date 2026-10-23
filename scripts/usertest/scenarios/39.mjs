// First-Person: Möbel auswählen und tragen, Teppich stoppt an der Wand (#39) – Testschritte aus dem Kommentar in #39.
const target = (t) => t.page.evaluate(() => window.__wp.walk.target());
const carry = (t) => t.page.evaluate(() => window.__wp.useUiStore.getState().walkCarry);
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
/** Walkthrough: look straight at plan point (x, y) at height h (default: table top region). */
const lookAtTable = (t, f) =>
  t.page.evaluate(
    ([tx, ty]) => {
      const wp = window.__wp;
      const c = wp.three.camera.position;
      const yaw = Math.atan2(-(tx - c.x), -(ty - c.z));
      wp.walk.look(yaw, -Math.atan2(c.y - 0.3, Math.hypot(tx - c.x, ty - c.z)));
    },
    [f.x, f.y],
  );
/** Click into the view until the mouse is captured (the first click only captures it). */
async function capture(t) {
  const box = await t.page.getByTestId('scene3d').boundingBox();
  for (let i = 0; i < 4; i++) {
    if (await t.page.evaluate(() => !!document.pointerLockElement)) return true;
    await t.page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await t.page.waitForTimeout(500);
  }
  return t.page.evaluate(() => !!document.pointerLockElement);
}
const table = (t) => t.furniture((f) => f.id === t.tableId);

export default {
  issue: 39,
  name: 'Möbel tragen im Begehen',
  title: 'First-Person: Möbel verschieben, Teppich und Objekte blockieren oder rot markieren bei Wandkollision',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '3D › „Begehen“ → in die Ansicht klicken (Maus wird gefangen).',
      expected: 'Unten steht zusätzlich „Klick: Möbel auswählen · G: Möbel tragen“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        const locked = await capture(t);
        const txt = await page.locator('.walk-overlay').innerText();
        const f = await t.furniture((x) => x.catalogId === 'generic-coffee-table');
        t.tableId = f.id;
        const has = /Klick: Möbel auswählen/.test(txt) && /G: Möbel tragen/.test(txt);
        return { status: has ? 'ok' : 'fail', observed: `Maus gefangen: ${locked}; beide Hinweise (Klick: Möbel auswählen, G: Möbel tragen) vorhanden: ${has}; die Zeile ist seit der Tastenumbelegung (#257) länger als im Testtext. Hinweiszeile: „${txt.replace(/\s+/g, ' ').slice(0, 260)}“.` };
      },
    },
    {
      nr: 2,
      action: 'Fadenkreuz auf ein Möbel richten (z. B. Couchtisch) und klicken.',
      expected: 'Das Möbel ist ausgewählt (blauer Rahmen, rechts im Eigenschaften-Panel).',
      async run(t) {
        const { page } = t;
        const f = await table(t);
        await lookAtTable(t, f);
        const tg = await t.poll(async () => ((await target(t)) === f.id ? f.id : null), 4000);
        await capture(t);
        const box = await page.getByTestId('scene3d').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
        const sel = await t.selection();
        const panel = `${await page.locator('.panel.right').innerText()} ${(await page.locator('.panel.right input').evaluateAll((e) => e.map((x) => x.value))).join(' ')}`;
        await t.shot('Couchtisch ausgewählt');
        return { status: tg && sel?.id === f.id && /Couchtisch/.test(panel) ? 'ok' : 'fail', observed: `Fadenkreuz zielt auf ${tg ? 'den Couchtisch' : 'etwas anderes'}; Auswahl: ${sel ? `${sel.type} ${sel.id === f.id ? '(Couchtisch)' : sel.id}` : 'keine'}; Eigenschaften-Panel nennt Couchtisch: ${/Couchtisch/.test(panel)}.` };
      },
    },
    {
      nr: 3,
      action: 'G drücken, dann umsehen und gehen.',
      expected: 'Unten steht „Du trägst ‚Couchtisch‘ …“. Der Tisch folgt deinem Blick auf dem Boden. An Wänden und anderen Möbeln bleibt er hängen und geht nicht hindurch.',
      async run(t) {
        const { page } = t;
        const before = await table(t);
        t.start = { x: before.x, y: before.y };
        t.pastBefore = await past(t);
        await page.keyboard.press('g');
        const c = await t.poll(async () => ((await carry(t)) === before.id ? true : null), 3000);
        const overlay = await page.locator('.walk-overlay').innerText();
        // turn a bit: it follows
        await page.evaluate(() => {
          const e = window.__wp.three.camera.rotation;
          window.__wp.walk.look(e.y + 0.35, e.x);
        });
        const moved = await t.poll(async () => {
          const x = await table(t);
          return Math.hypot(x.x - before.x, x.y - before.y) > 0.2 ? x : null;
        }, 6000);
        const elevation = moved?.elevation;
        // push it far into a wall: swing the view round; the table must never end up inside a wall
        const inWall = [];
        for (const yaw of [1.6, 3.2, 4.7, 0.2]) {
          await page.evaluate((y) => window.__wp.walk.look(y, -0.4), yaw);
          await page.waitForTimeout(500);
          const x = await table(t);
          const p = await t.project();
          const bad = p.walls.some((w) => {
            const ends = Object.values(w).filter((v) => typeof v === 'string' && p.nodes.some((n) => n.id === v));
            const [a, b] = ends.map((id) => p.nodes.find((n) => n.id === id));
            const dx = b.x - a.x, dy = b.y - a.y;
            const tt = Math.max(0, Math.min(1, ((x.x - a.x) * dx + (x.y - a.y) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(x.x - (a.x + tt * dx), x.y - (a.y + tt * dy)) < (w.thickness ?? 0.2) / 2;
          });
          inWall.push(bad);
        }
        await t.shot('Tisch wird getragen');
        return {
          status: c && /trägst/.test(overlay) && /Couchtisch/.test(overlay) && moved && !inWall.some(Boolean) ? 'ok' : 'fail',
          observed: `Nach G: Meldung „${overlay.replace(/\s+/g, ' ').slice(0, 120)}“; beim Umsehen folgte der Tisch ${moved ? `(${Math.round(Math.hypot(moved.x - before.x, moved.y - before.y) * 100)} cm)` : 'nicht'}; in 4 Blickrichtungen (auch gegen Wände) nie im Wandkörper: ${!inWall.some(Boolean)}.`,
        };
      },
    },
    {
      nr: 4,
      action: 'Klick oder nochmals G. Danach Strg+Z.',
      expected: 'Der Tisch wird abgesetzt. Strg+Z macht das ganze Tragen in einem Schritt rückgängig.',
      async run(t) {
        const { page } = t;
        const placed0 = await table(t);
        const start = t.tableStart;
        void start;
        await page.keyboard.press('g');
        const released = await t.poll(async () => ((await carry(t)) === null ? true : null), 3000);
        const steps = (await past(t)) - t.pastBefore;
        const at = await table(t);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(500);
        const after = await table(t);
        const orig = t.original ?? { x: 0, y: 0 };
        void orig; void placed0;
        return { status: released && steps === 1 && Math.hypot(after.x - at.x, after.y - at.y) > 0.2 ? 'ok' : 'fail', observed: `Abgesetzt: ${released ? 'ja' : 'nein'}; Verlauf wuchs um ${steps} Schritt(e); Strg+Z versetzt den Tisch um ${Math.round(Math.hypot(after.x - at.x, after.y - at.y) * 100)} cm zurück (auf die Ausgangsposition: ${Math.hypot(after.x - t.start.x, after.y - t.start.y) < 0.01 ? 'ja' : 'nein'}).` };
      },
    },
    {
      nr: 5,
      action: 'Während des Tragens Esc (Maus freigeben) bzw. „Übersicht“ wählen.',
      expected: 'Der Tisch bleibt dort, wo er gerade ist.',
      async run(t) {
        const { page } = t;
        const f = await table(t);
        await lookAtTable(t, f);
        await t.poll(async () => ((await target(t)) === f.id ? 1 : null), 3000);
        await page.keyboard.press('g');
        await t.poll(async () => ((await carry(t)) === f.id ? 1 : null), 3000);
        await page.evaluate(() => {
          const e = window.__wp.three.camera.rotation;
          window.__wp.walk.look(e.y + 0.3, e.x);
        });
        await page.waitForTimeout(600);
        const carried = await table(t);
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.exitPointerLock()); // the browser itself releases the mouse on Esc; the headless one needs this nudge
        await page.waitForTimeout(500);
        const afterEsc = await table(t);
        const carryEsc = await carry(t);
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(800);
        const after = await table(t);
        const c = await carry(t);
        const d = Math.hypot(after.x - carried.x, after.y - carried.y);
        const dEsc = Math.hypot(afterEsc.x - carried.x, afterEsc.y - carried.y);
        return { status: d < 0.02 && dEsc < 0.02 && c === null ? 'ok' : 'fail', observed: `Nach Esc ${Math.round(dEsc * 100)} cm Abweichung (Tragen ${carryEsc === null ? 'beendet' : 'weiter aktiv'}), nach Wechsel zur Übersicht ${Math.round(d * 100)} cm Abweichung von der Trageposition; Tragen beendet: ${c === null}.` };
      },
    },
    {
      nr: 6,
      action: 'Beim Begehen G drücken.',
      expected: 'G schaltet nicht das Werkzeug „Durchgang“ im 2D-Plan um.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(500);
        await page.keyboard.press('g');
        await page.waitForTimeout(300);
        const tool = (await t.ui()).tool;
        await page.keyboard.press('g'); // put down again if it picked something up
        return { status: tool === 'select' ? 'ok' : 'fail', observed: `Werkzeug nach G: „${tool}“.` };
      },
    },
    {
      nr: 7,
      action: 'Teppich: In 2D einen Teppich gegen eine Wand ziehen.',
      expected: 'Er stoppt an der Wand, statt hindurchzugehen. Unter Sofa und Tisch liegt er weiterhin ohne Warnung.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const p = await t.project();
        const rug = p.furniture.find((f) => /teppich|rug/i.test(`${f.name} ${f.catalogId}`));
        const others = p.furniture.filter((f) => f.id !== rug.id);
        let spot;
        for (let dx = -rug.width / 2 + 0.1; dx <= rug.width / 2 - 0.1 && !spot; dx += 0.1)
          for (let dy = -rug.depth / 2 + 0.1; dy <= rug.depth / 2 - 0.1 && !spot; dy += 0.1) {
            const x = rug.x + dx, y = rug.y + dy;
            if (!others.some((f) => Math.abs(x - f.x) < f.width / 2 + 0.05 && Math.abs(y - f.y) < f.depth / 2 + 0.05)) spot = { x, y };
          }
        const a = await t.planToScreen(spot.x, spot.y);
        const b = await t.planToScreen(spot.x - 4, spot.y); // far to the left, through the wall
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 10 });
        await page.mouse.move(b.x, b.y, { steps: 10 });
        await page.mouse.up();
        const now = await t.furniture((f) => f.id === rug.id);
        // wall faces: the rug's left edge must not cross the nearest wall to the left
        const left = now.x - now.width / 2;
        const walls = p.walls.map((w) => {
          const ends = Object.values(w).filter((v) => typeof v === 'string' && p.nodes.some((n) => n.id === v));
          const [n1, n2] = ends.map((id) => p.nodes.find((n) => n.id === id));
          return { n1, n2, th: w.thickness ?? 0.2 };
        });
        const vertLeft = walls.filter((w) => Math.abs(w.n1.x - w.n2.x) < 1e-6 && w.n1.x < rug.x && Math.min(w.n1.y, w.n2.y) < rug.y && Math.max(w.n1.y, w.n2.y) > rug.y);
        const wallFace = Math.max(...vertLeft.map((w) => w.n1.x + w.th / 2));
        const stopped = left >= wallFace - 0.01;
        const moved = rug.x - now.x;
        // no warning marks while it lies under sofa/table
        await page.mouse.move(2, 2);
        const marks = await page.locator('[data-testid="editor2d"] svg').evaluate((svg) =>
          [...svg.querySelectorAll('*')].filter((e) => !e.closest('[data-testid="narrow-passages"]') && ['rgb(220, 38, 38)', 'rgb(217, 119, 6)'].includes(getComputedStyle(e).stroke)).length,
        );
        await t.shot('Teppich an der Wand');
        return { status: stopped && moved > 0.1 && marks === 0 ? 'ok' : 'fail', observed: `Teppich um ${Math.round(moved * 100)} cm nach links gezogen (4 m angefordert); linke Kante ${left.toFixed(2)} m, Wandfläche ${wallFace.toFixed(2)} m → ${stopped ? 'stoppt an der Wand' : 'ragt in die Wand'}. Rot/orange markierte Möbel im Plan (Teppich liegt unter Sofa/Tisch): ${marks}.` };
      },
    },
  ],
};
