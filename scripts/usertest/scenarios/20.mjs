// Schleichmodus / Ducken beim Begehen (#20) – Testschritte aus dem Kommentar in #20.
const camY = (t) => t.page.evaluate(() => window.__wp.three.camera.position.y);
const pos = (t) => t.page.evaluate(() => ({ x: window.__wp.three.camera.position.x, z: window.__wp.three.camera.position.z }));
const ui = (t) => t.page.evaluate(() => ({ tool: window.__wp.useUiStore.getState().tool, duck: window.__wp.useUiStore.getState().walkDuck, sit: window.__wp.useUiStore.getState().walkSit }));
const hint = (t) => t.page.getByTestId('walk-duck');
const cm = (v) => Math.round(v * 100);
/** Wait until the camera height has settled (no change for a few frames). */
async function settledY(t) {
  let last = await camY(t);
  for (let i = 0; i < 20; i++) {
    await t.page.waitForTimeout(350); // software rendering is slow: give the camera a few frames

    const y = await camY(t);
    if (Math.abs(y - last) < 0.0005) return y;
    last = y;
  }
  return last;
}
/** Free the mouse before clicking a button. A person presses Esc; the headless browser does not release
 *  the pointer lock on Esc by itself, so the script does what the browser would do. */
async function freeMouse(t) {
  await t.page.keyboard.press('Escape');
  await t.page.evaluate(() => document.exitPointerLock());
  await t.page.waitForTimeout(300);
}
/** Distance walked forward while holding W for `ms`, then walk back the same time. */
async function stride(t, ms) {
  const a = await pos(t);
  await t.page.keyboard.down('KeyW');
  await t.page.waitForTimeout(ms);
  await t.page.keyboard.up('KeyW');
  await t.page.waitForTimeout(150);
  const b = await pos(t);
  await t.page.keyboard.down('KeyS');
  await t.page.waitForTimeout(ms);
  await t.page.keyboard.up('KeyS');
  await t.page.waitForTimeout(150);
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export default {
  issue: 20,
  name: 'Ducken beim Begehen',
  title: 'Schleichmodus / Ducken beim Begehen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '3D → „Begehen“ → in die Ansicht klicken.',
      expected: 'Du bist im Begehen-Modus.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        const canvas = page.locator('[data-testid="scene3d"] canvas');
        await canvas.waitFor({ timeout: 20000 });
        await page.waitForTimeout(1200);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(600);
        await canvas.click();
        await page.waitForTimeout(500);
        const cross = await page.getByTestId('crosshair').count();
        const locked = await page.evaluate(() => !!document.pointerLockElement);
        t.stand = await settledY(t);
        return {
          status: cross === 1 && locked && Math.abs(t.stand - 1.52) < 0.01 ? 'ok' : 'fail',
          observed: `Nach „Begehen“ und Klick in die Ansicht: Fadenkreuz ${cross ? 'sichtbar' : 'nicht sichtbar'}, Augenhöhe ${cm(t.stand)} cm (Standard 152 cm bei 163 cm Körpergröße), Maus ${locked ? 'gefangen (Umsehen mit der Maus aktiv)' : 'nicht gefangen'}.`,
        };
      },
    },
    {
      nr: 2,
      action: 'C einmal drücken (Ducken ist ein Umschalter, nicht Halten).',
      expected: 'Die Kamera senkt sich weich auf etwa 60 % deiner Augenhöhe (bei 152 cm Augenhöhe ca. 91 cm, mindestens 80 cm). Oben steht „⤓ Geduckt“, du gehst langsamer, und das bleibt so.',
      async run(t) {
        const { page } = t;
        const walkStand = await stride(t, 800);
        await page.keyboard.press('KeyC');
        const samples = [];
        for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(40);
          samples.push(await camY(t));
        }
        const low = await settledY(t);
        const smooth = samples.some((y) => y < t.stand - 0.02 && y > low + 0.02);
        const shown = (await hint(t).count()) === 1 ? (await hint(t).innerText()).trim() : '';
        const walkDuck = await stride(t, 800);
        await page.waitForTimeout(400);
        const still = (await hint(t).count()) === 1 && Math.abs((await camY(t)) - low) < 0.005;
        await t.shot('Geduckt im Begehen-Modus');
        const ratio = walkStand > 0 ? walkDuck / walkStand : 0;
        const okHeight = Math.abs(low - 0.6 * t.stand) < 0.02 && low >= 0.8;
        return {
          status: okHeight && smooth && shown === '⤓ Geduckt' && ratio > 0.05 && ratio < 0.9 && still ? 'ok' : 'fail',
          observed: `Nach einem C: Augenhöhe sinkt ${smooth ? 'weich (Zwischenwerte gemessen)' : 'ohne messbaren Übergang'} von ${cm(t.stand)} auf ${cm(low)} cm (${Math.round((low / t.stand) * 100)} %). Hinweis oben: ${shown ? `„${shown}“` : 'keiner'}. 0,8 s W gehalten: stehend ${cm(walkStand)} cm, geduckt ${cm(walkDuck)} cm (${Math.round(ratio * 100)} %). Ohne weitere Taste bleibt es geduckt: ${still ? 'ja' : 'nein'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'C nochmal drücken.',
      expected: 'Du stehst wieder auf, und der Hinweis verschwindet.',
      async run(t) {
        await t.page.keyboard.press('KeyC');
        const y = await settledY(t);
        const n = await hint(t).count();
        return { status: Math.abs(y - t.stand) < 0.005 && n === 0 ? 'ok' : 'fail', observed: `Nach dem zweiten C: Augenhöhe ${cm(y)} cm, Hinweis „Geduckt“ ${n ? 'noch da' : 'weg'}.` };
      },
    },
    {
      nr: 4,
      action: 'Ducken, dann X drücken.',
      expected: 'Du sitzt, „Geduckt“ ist weg. Mit X nochmal stehst du normal.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('KeyC');
        const low = await settledY(t);
        await page.keyboard.press('KeyX');
        const sitY = await settledY(t);
        const s = await ui(t);
        const n = await hint(t).count();
        await page.keyboard.press('KeyX');
        const up = await settledY(t);
        const s2 = await ui(t);
        return {
          status: s.sit && !s.duck && n === 0 && Math.abs(sitY - 1.21) < 0.01 && Math.abs(up - t.stand) < 0.005 && !s2.sit && !s2.duck ? 'ok' : 'fail',
          observed: `Geduckt (${cm(low)} cm), dann X: ${s.sit ? 'sitzend' : 'nicht sitzend'} auf ${cm(sitY)} cm Augenhöhe, „Geduckt“ ${n ? 'noch da' : 'weg'}. Nochmal X: ${cm(up)} cm, ${s2.duck ? 'wieder geduckt' : 'normal stehend'}.`,
        };
      },
    },
    {
      nr: 5,
      action: 'Ducken, dann „Übersicht“ und wieder „Begehen“.',
      expected: 'Du stehst.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('KeyC');
        const low = await settledY(t);
        await freeMouse(t);
        await page.getByRole('button', { name: 'Übersicht' }).click({ timeout: 8000 });
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(600);
        const y = await settledY(t);
        const n = await hint(t).count();
        return { status: Math.abs(y - t.stand) < 0.005 && n === 0 && !(await ui(t)).duck ? 'ok' : 'fail', observed: `Geduckt (${cm(low)} cm), dann Übersicht und wieder Begehen: Augenhöhe ${cm(y)} cm, Hinweis „Geduckt“ ${n ? 'da' : 'nicht da'}.` };
      },
    },
    {
      nr: 6,
      action: 'C im 2D-Plan drücken.',
      expected: 'C ändert im 2D-Plan nichts, z. B. kein Werkzeug.',
      async run(t) {
        const { page } = t;
        await freeMouse(t);
        await page.getByRole('button', { name: 'Übersicht' }).click({ timeout: 8000 });
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        await page.locator('[data-testid="editor2d"] svg').click({ position: { x: 5, y: 5 } });
        const before = await ui(t);
        const p0 = JSON.stringify(await t.project());
        await page.keyboard.press('KeyC');
        await page.waitForTimeout(400);
        const after = await ui(t);
        const same = JSON.stringify(await t.project()) === p0;
        return {
          status: before.tool === after.tool && same && !after.duck ? 'ok' : 'fail',
          observed: `C im 2D-Plan: Werkzeug vorher „${before.tool}“, nachher „${after.tool}“; Plan ${same ? 'unverändert' : 'verändert'}; Ducken ${after.duck ? 'eingeschaltet' : 'aus'}.`,
        };
      },
    },
  ],
};
