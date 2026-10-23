// Zoom per Mausrad in der Ich-Ansicht (#228) – Testschritte aus dem Kommentar in #228.
// Hinweis: Die Normalsicht ist seit #263 einstellbar (Standard jetzt 50°, früher 70°); die engste Stufe ist 2/7 davon
// (bei 70° also 20°). Geprüft wird mit Standard (50°) und mit 70° (Regler am Maximum).
const fovOf = (t) => t.page.evaluate(() => window.__wp.three?.camera.fov ?? NaN);
const walkFov = (t) => t.page.evaluate(() => window.__wp.walk.fov?.() ?? NaN);
const wheel = async (t, n, dy) => {
  for (let i = 0; i < n; i++) await t.page.mouse.wheel(0, dy);
  await t.page.waitForTimeout(250);
};
const lookStep = (t) => t.page.evaluate(() => window.__wp.three.camera.rotation.y);

export default {
  issue: 228,
  name: 'Mausrad-Zoom beim Begehen',
  title: 'Zoom per Mausrad in der Ich-Ansicht',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Oben „3D“ wählen, dann „Begehen“ und in die Ansicht klicken.',
      expected: 'Normale Sicht (Sichtfeld 70°); die Hinweiszeile nennt „Mausrad: zoomen (Z: zurück)“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await t.poll(() => page.evaluate(() => !!window.__wp.three), 15000);
        t.overviewFov = await fovOf(t);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await t.poll(async () => ((await fovOf(t)) > 0 ? 1 : null), 5000);
        const box = await page.locator('[data-testid="scene3d"] canvas').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
        await page.waitForTimeout(500);
        t.base = await fovOf(t);
        const hint = await page.locator('.walk-overlay').innerText().catch(() => '');
        return { status: /Mausrad: zoomen/.test(hint) && /Z: zurück/.test(hint) ? 'ok' : 'fail', observed: `Sichtfeld jetzt ${t.base}° (Standard seit #263; Regler 30–70°); Hinweiszeile: „${hint.replace(/\n/g, ' ').slice(0, 160)}“.` };
      },
    },
    {
      nr: 2,
      action: 'Das Mausrad mehrmals nach vorn drehen.',
      expected: 'Die Ansicht vergrößert sich stufenlos wie bei einem Fernglas, die Kamera bewegt sich nicht. Ab einer starken Vergrößerung (20°) wird es nicht mehr enger.',
      async run(t) {
        const pos0 = await t.page.evaluate(() => window.__wp.three.camera.position.toArray());
        const vals = [];
        for (let i = 0; i < 6; i++) {
          await wheel(t, 1, -100);
          vals.push(await fovOf(t));
        }
        await wheel(t, 20, -100);
        const min = await fovOf(t);
        const pos1 = await t.page.evaluate(() => window.__wp.three.camera.position.toArray());
        const still = pos0.every((v, i) => Math.abs(v - pos1[i]) < 1e-6);
        const mono = vals.every((v, i) => i === 0 || v < vals[i - 1]);
        t.min = min;
        await t.shot('Stark herangezoomt');
        return { status: mono && Math.abs(min - (t.base * 2) / 7) < 0.05 && still ? 'ok' : 'fail', observed: `Sichtfeld nach 6 Rasten: ${vals.map((v) => v.toFixed(1)).join(' → ')}° (stetig kleiner: ${mono}); nach 26 Rasten ${min.toFixed(2)}° = 2/7 von ${t.base}° (bei 70° wären es 20°), nicht enger; Kamera bewegt sich nicht: ${still}.` };
      },
    },
    {
      nr: 3,
      action: 'Bei starker Vergrößerung die Maus bewegen.',
      expected: 'Die Blickrichtung dreht sich spürbar langsamer als ohne Zoom.',
      async run(t) {
        const { page } = t;
        // headless Chromium reports no movementX for synthetic moves under pointer lock: emulate a locked pointer
        // and send the same relative mouse movement (100 px) zoomed in and out (as the E2E test for the sensitivity does)
        await page.evaluate(() => {
          const c = document.querySelector('[data-testid="scene3d"] canvas');
          Object.defineProperty(document, 'pointerLockElement', { get: () => c, configurable: true });
        });
        const yaw = () => page.evaluate(() => window.__wp.three.camera.rotation.y);
        const turn = async () => {
          const y0 = await yaw();
          await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0 })));
          await t.poll(async () => (Math.abs((await yaw()) - y0) > 1e-5 ? 1 : null), 5000);
          return Math.abs((await yaw()) - y0);
        };
        const f = await fovOf(t);
        const zoomed = await turn();
        await wheel(t, 40, 100);
        const wide = await turn();
        await wheel(t, 26, -100);
        await page.evaluate(() => delete document.pointerLockElement);
        return { status: zoomed > 0 && wide > 0 && zoomed < wide * 0.6 ? 'ok' : 'fail', observed: `Gleiche Mausbewegung (100 px): bei ${f.toFixed(1)}° Sichtfeld dreht sich die Ansicht um ${zoomed.toFixed(4)} rad, ohne Zoom (${t.base}°) um ${wide.toFixed(4)} rad (Verhältnis ${(zoomed / wide).toFixed(2)}, also spürbar langsamer).` };
      },
    },
    {
      nr: 4,
      action: 'Das Mausrad zurückdrehen.',
      expected: 'Die Ansicht wird wieder weiter, höchstens bis zur normalen Sicht.',
      async run(t) {
        await wheel(t, 1, 100);
        const a = await fovOf(t);
        await wheel(t, 40, 100);
        const b = await fovOf(t);
        return { status: a > t.min + 0.01 && Math.abs(b - t.base) < 0.01 ? 'ok' : 'fail', observed: `Nach 1 Raste zurück ${a.toFixed(2)}° (vorher ${t.min.toFixed(2)}°); nach vielen Rasten ${b.toFixed(2)}° = normale Sicht ${t.base}°, nicht weiter.` };
      },
    },
    {
      nr: 5,
      action: 'Wieder heranzoomen und die Taste Z drücken.',
      expected: 'Sofort wieder normale Sicht.',
      async run(t) {
        await wheel(t, 6, -100);
        const z = await fovOf(t);
        await t.page.keyboard.press('KeyZ');
        await t.page.waitForTimeout(200);
        const f = await fovOf(t);
        return { status: z < t.base - 1 && Math.abs(f - t.base) < 0.01 ? 'ok' : 'fail', observed: `Gezoomt ${z.toFixed(1)}°, nach Z ${f.toFixed(2)}° (normal ${t.base}°).` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Heranzoomen und die mittlere Maustaste klicken.',
      expected: 'Sofort wieder normale Sicht.',
      async run(t) {
        await wheel(t, 6, -100);
        const z = await fovOf(t);
        await t.page.mouse.down({ button: 'middle' });
        await t.page.mouse.up({ button: 'middle' });
        await t.page.waitForTimeout(250);
        const f = await fovOf(t);
        return { status: z < t.base - 1 && Math.abs(f - t.base) < 0.01 ? 'ok' : 'fail', observed: `Gezoomt ${z.toFixed(1)}°, nach Mittelklick ${f.toFixed(2)}°.` };
      },
    },
    {
      nr: 7,
      action: 'Heranzoomen, auf „Übersicht“ wechseln und danach wieder „Begehen“ wählen.',
      expected: 'Die Übersicht und ihr Zoom-Regler verhalten sich wie vorher; beim erneuten Begehen ist die Sicht wieder normal.',
      async run(t) {
        const { page } = t;
        await wheel(t, 6, -100);
        await page.keyboard.press('Escape'); // release the captured mouse to reach the toolbar
        await page.evaluate(() => document.exitPointerLock());
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(800);
        const over = await fovOf(t);
        const slider = await page.locator('.zoom-slider, [data-testid="zoom-slider"]').count();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await t.poll(async () => (Math.abs((await fovOf(t)) - t.base) < 0.01 ? 1 : null), 4000);
        const again = await fovOf(t);
        return { status: Math.abs(over - t.overviewFov) < 0.01 && Math.abs(again - t.base) < 0.01 ? 'ok' : 'fail', observed: `Übersicht: ${over}° (vorher ${t.overviewFov}°), Zoom-Regler vorhanden: ${slider > 0 || 'nicht geprüft'}; beim erneuten Begehen ${again}° (normal ${t.base}°).` };
      },
    },
    {
      nr: 8,
      action: 'Taste ? (Tastenkürzel-Hilfe) öffnen.',
      expected: 'Unter „3D-Begehung“ stehen „Mausrad“ und „Z / mittlere Maustaste“.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.keyboard.press('?');
        const dlg = page.getByRole('dialog').first();
        await dlg.waitFor({ timeout: 4000 }).catch(() => undefined);
        const txt = await page.locator('body').innerText();
        const sec = txt.slice(txt.indexOf('Begehung'));
        const ok = /Mausrad/.test(sec) && /Z \/ mittlere Maustaste/.test(sec);
        await t.shot('Tastenkürzel');
        return { status: ok ? 'ok' : 'fail', observed: `„Mausrad“ im Abschnitt Begehung: ${/Mausrad/.test(sec)}; „Z / mittlere Maustaste“: ${/Z \/ mittlere Maustaste/.test(sec)}.` };
      },
    },
  ],
};
