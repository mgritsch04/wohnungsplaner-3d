// Fenster und Türen in 3D öffnen und schließen (#21) – Testschritte aus dem Kommentar in #21.
const right = (t) => t.page.locator('.panel.right');
const checkbox = (t) => right(t).getByLabel('Tür geöffnet');
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
const openOf = async (t, id) => (await t.project()).openings.find((o) => o.id === id).open;
const markers = (t) =>
  t.page.evaluate(() => {
    const out = [];
    window.__wp.three.scene.getObjectByName('collision-markers')?.traverse((o) => {
      if (o.name.startsWith('collision-issue')) out.push(o.name);
    });
    return out;
  });
/** World centre (plan x/y) of the first leaf or sash of an opening, as drawn in 3D. */
const leafCenter = (t, id) =>
  t.page.evaluate((oid) => {
    const th = window.__wp.three;
    const v = th.scene.getObjectByName(`leaf:${oid}:0`).children[0].getWorldPosition(th.camera.position.clone());
    return { x: v.x, y: v.z, h: v.y };
  }, id);
/** Wait until the open/close animation has finished. */
async function restingLeaf(t, id) {
  let last = await leafCenter(t, id);
  for (let i = 0; i < 60; i++) {
    await t.page.waitForTimeout(200);
    const now = await leafCenter(t, id);
    if (Math.hypot(now.x - last.x, now.y - last.y) < 0.001) return now;
    last = now;
  }
  return last;
}
/** Walkthrough: turn the view so the crosshair points at plan (x, y) at height h. */
const lookAt = (t, x, y, h) =>
  t.page.evaluate(
    ([tx, ty, th]) => {
      const wp = window.__wp;
      const c = wp.three.camera.position;
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
    },
    [x, y, h],
  );
const target = (t) => t.page.evaluate(() => window.__wp.walk.targetOpening());
const deg = (r) => Math.round((r * 180) / Math.PI);

export default {
  issue: 21,
  name: 'Fenster und Türen öffnen',
  title: '3D: Fenster und Türen öffnen und schließen können',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung laden, Ansicht 3D öffnen (gern mit Schnitt).',
      expected: '3D-Ansicht mit der Wohnung.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        const p = await t.project();
        t.inner = p.openings.find((o) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
        t.entrance = p.openings.find((o) => o.kind === 'door' && Math.abs(o.width - 1.0) < 1e-6);
        t.window = p.openings.find((o) => o.kind === 'window' && Math.abs(o.width - 1.8) < 1e-6);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Schnitt' }).click();
        await page.waitForTimeout(2500);
        const leaves = await page.evaluate(() => {
          let n = 0;
          window.__wp.three.scene.traverse((o) => (n += o.name.startsWith('leaf:') ? 1 : 0));
          return n;
        });
        return {
          status: leaves > 0 && t.inner && t.entrance && t.window ? 'ok' : 'fail',
          observed: `3D-Ansicht mit Schnitt offen. ${p.openings.length} Türen und Fenster im Plan, ${leaves} Türblätter und Fensterflügel in 3D gezeichnet.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Die Tür zwischen Wohn- und Schlafzimmer einmal anklicken.',
      expected: 'Die Tür ist ausgewählt, und rechts steht ein Häkchen „Tür geöffnet“.',
      async run(t) {
        const leaf = await restingLeaf(t, t.inner.id);
        t.leafScreen = await t.worldToScreen(leaf.x, 0.8, leaf.y);
        await t.page.mouse.click(t.leafScreen.x, t.leafScreen.y);
        const sel = await t.poll(async () => ((await t.selection())?.id === t.inner.id ? true : null), 4000);
        const checked = await checkbox(t).isChecked().catch(() => null);
        return {
          status: sel && checked === true ? 'ok' : 'fail',
          observed: `Ein Klick aufs Türblatt: Tür ${sel ? 'ausgewählt' : 'nicht ausgewählt'}; „Tür geöffnet“ ${checked === null ? 'nicht zu sehen' : checked ? 'mit Häkchen' : 'ohne Häkchen'}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Doppelklick auf die Tür. Danach Taste O drücken. Danach mit Strg+Z jeden Schritt einzeln rückgängig machen.',
      expected: 'Beim Doppelklick schwenkt das Türblatt in die Zarge (geschlossen) und das Häkchen ist weg. O öffnet sie wieder. Strg+Z macht jeden Schritt einzeln rückgängig.',
      async run(t) {
        const { page } = t;
        const id = t.inner.id;
        const p0 = await past(t);
        await page.mouse.dblclick(t.leafScreen.x, t.leafScreen.y);
        const closed = await t.poll(async () => ((await openOf(t, id)) === false ? true : null), 4000);
        const inFrame = (await restingLeaf(t, id)).x > 4.95;
        const unchecked = !(await checkbox(t).isChecked());
        const steps1 = (await past(t)) - p0;
        await t.shot('Tür nach dem Doppelklick geschlossen');
        await page.keyboard.press('o');
        const reopened = await t.poll(async () => ((await openOf(t, id)) === true ? true : null), 4000);
        const swung = (await restingLeaf(t, id)).x < 4.7;
        const checked = await checkbox(t).isChecked();
        await page.keyboard.press('Control+z');
        const u1 = await t.poll(async () => ((await openOf(t, id)) === false ? true : null), 3000);
        await page.keyboard.press('Control+z');
        const u2 = await t.poll(async () => ((await openOf(t, id)) === true ? true : null), 3000);
        const back = (await past(t)) === p0;
        return {
          status: closed && inFrame && unchecked && steps1 === 1 && reopened && swung && checked && u1 && u2 && back ? 'ok' : 'fail',
          observed: `Doppelklick: Tür ${closed ? 'geschlossen' : 'nicht geschlossen'}, Türblatt ${inFrame ? 'in der Zarge' : 'nicht in der Zarge'}, Häkchen ${unchecked ? 'weg' : 'noch da'} (${steps1} Rückgängig-Schritt). O: ${reopened ? 'wieder offen' : 'nicht geöffnet'}, Türblatt ${swung ? 'in den Raum geschwenkt' : 'nicht geschwenkt'}, Häkchen ${checked ? 'da' : 'fehlt'}. Erstes Strg+Z: ${u1 ? 'wieder zu' : 'nicht zu'}, zweites Strg+Z: ${u2 ? 'wieder offen' : 'nicht offen'} – ${back ? 'jeder Schritt einzeln' : 'Schritte stimmen nicht'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Das Sofa im 2D-Plan mit Alt in die geöffnete Eingangstür schieben. Dann die Eingangstür auswählen und O drücken.',
      expected: 'Zuerst rote Markierung „Steht im geöffneten Türblatt“. Nach O verschwindet die rote Markierung, die gelbe Warnung „Blockiert den Türaufschlag“ bleibt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
        await page.waitForTimeout(1500);
        const sofa = await t.furniture((f) => f.catalogId === 'generic-sofa-3');
        const a = await t.planToScreen(sofa.x, sofa.y);
        const b = await t.planToScreen(1.7, sofa.y);
        await page.mouse.move(a.x, a.y);
        await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 25 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await page.waitForTimeout(800);
        const moved = await t.furniture((f) => f.id === sofa.id);
        const leafKey = `collision-issue:${sofa.id}:door-leaf:${t.entrance.id}`;
        const swingKey = `collision-issue:${sofa.id}:door-swing:${t.entrance.id}`;
        const m1 = await t.poll(async () => ((await markers(t)).includes(leafKey) ? await markers(t) : null), 4000);
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), sofa.id);
        await page.waitForTimeout(300);
        const hint1 = (await right(t).getByTestId('furniture-issues').innerText().catch(() => '')).replace(/\s+/g, ' ');
        await t.shot('Sofa mit Alt in der offenen Eingangstür');
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id: i }), t.entrance.id);
        await page.keyboard.press('o');
        await t.poll(async () => ((await openOf(t, t.entrance.id)) === false ? true : null), 4000);
        await page.waitForTimeout(800);
        const m2 = await markers(t);
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), sofa.id);
        await page.waitForTimeout(300);
        const hint2 = (await right(t).getByTestId('furniture-issues').innerText().catch(() => '')).replace(/\s+/g, ' ');
        await t.shot('Eingangstür geschlossen');
        const ok1 = !!m1 && /Steht im geöffneten Türblatt/.test(hint1);
        const ok2 = !m2.includes(leafKey) && m2.includes(swingKey) && /Blockiert den Türaufschlag/.test(hint2) && !/Steht im geöffneten Türblatt/.test(hint2);
        return {
          status: ok1 && ok2 ? 'ok' : 'fail',
          observed: `Sofa mit Alt auf x ${moved.x.toFixed(2).replace('.', ',')} m geschoben. Rote Markierung in 3D „im Türblatt“: ${m1 ? 'ja' : 'nein'}; Hinweis: „${hint1 || '–'}“. Nach O an der Eingangstür (zu): rote Markierung ${m2.includes(leafKey) ? 'noch da' : 'weg'}, Markierung „Türaufschlag“ ${m2.includes(swingKey) ? 'da' : 'fehlt'}; Hinweis: „${hint2 || '–'}“.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Begehen wählen, in die Ansicht klicken und ein Fenster ins Fadenkreuz nehmen. Dann einmal klicken, später auch mit O und mit E probieren.',
      expected: 'Ein Klick (oder O) öffnet die Flügel nach innen. Seit PR #143 öffnet und schließt auch E die Tür bzw. das Fenster im Fadenkreuz, O geht weiterhin.',
      async run(t) {
        const { page } = t;
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        const canvas = page.locator('[data-testid="scene3d"] canvas');
        await page.waitForTimeout(800);
        await canvas.click();
        await page.waitForTimeout(500);
        await page.evaluate(() => {
          const c = window.__wp.three.camera.position;
          c.x = 2.5;
          c.z = 2.2;
        });
        await page.waitForTimeout(300);
        const id = t.window.id;
        const glass = await restingLeaf(t, id);
        await lookAt(t, glass.x, glass.y, 1.5);
        const aimed = await t.poll(async () => ((await target(t)) === id ? true : null), 3000);
        const results = [];
        const press = async (label, fn) => {
          const before = await openOf(t, id);
          const now = await restingLeaf(t, id); // aim at the sash where it is now (open sashes stand in the room)
          await lookAt(t, now.x, now.y, 1.5);
          await t.poll(async () => ((await target(t)) === id ? true : null), 3000);
          await fn();
          const changed = await t.poll(async () => ((await openOf(t, id)) !== before ? true : null), 3000);
          await restingLeaf(t, id);
          results.push(`${label}: ${changed ? (before ? 'geschlossen' : 'geöffnet') : 'keine Wirkung'}`);
          return changed;
        };
        const c1 = await press('Klick', () => canvas.click());
        const inward = (await leafCenter(t, id)).y > 0.25;
        await t.shot('Fenster nach dem Klick (Begehen)');
        const c2 = await press('O', () => page.keyboard.press('o'));
        const c3 = await press('E', () => page.keyboard.press('e'));
        const c4 = await press('E nochmal', () => page.keyboard.press('e'));
        return {
          status: aimed && c1 && inward && c2 && c3 && c4 ? 'ok' : 'fail',
          observed: `Wohnzimmerfenster im Fadenkreuz: ${aimed ? 'ja' : 'nein'}. ${results.join(', ')}. Flügel nach dem Klick ${inward ? 'nach innen geöffnet' : 'nicht nach innen'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 6,
      action: 'In der Übersicht ein Möbel auswählen und E drücken.',
      expected: 'Das Möbel dreht sich um 15° (E bleibt in der Übersicht „Drehen“).',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.exitPointerLock());
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(800);
        const table = await t.furniture((f) => f.catalogId === 'generic-coffee-table');
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id: i }), table.id);
        await page.keyboard.press('e');
        await page.waitForTimeout(400);
        const after = await t.furniture((f) => f.id === table.id);
        const d = deg(after.rotation - table.rotation);
        return { status: Math.abs(Math.abs(d) - 15) < 1 ? 'ok' : 'fail', observed: `Couchtisch ausgewählt, E gedrückt: Drehung um ${d}°.` };
      },
    },
    {
      nr: 7,
      action: 'Eine Tür schließen und versuchen hindurchzugehen. Danach mit Klick, O oder E öffnen.',
      expected: 'Durch die geschlossene Tür kommst du nicht durch. Nach dem Öffnen schon.',
      async run(t) {
        const { page } = t;
        const id = t.inner.id;
        await page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id: i }), id);
        if (await openOf(t, id)) await page.keyboard.press('o');
        await t.poll(async () => ((await openOf(t, id)) === false ? true : null), 3000);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(800);
        await page.locator('[data-testid="scene3d"] canvas').click();
        await page.waitForTimeout(400);
        const walkThrough = async () => {
          await page.evaluate(() => {
            const c = window.__wp.three.camera.position;
            c.x = 4.3;
            c.z = 2.0;
          });
          await lookAt(t, 6.5, 2.0, 1.5); // straight through the doorway into the bedroom
          await page.waitForTimeout(300);
          await page.keyboard.down('KeyW');
          await page.waitForTimeout(3000);
          await page.keyboard.up('KeyW');
          await page.waitForTimeout(300);
          return page.evaluate(() => window.__wp.three.camera.position.x);
        };
        const x1 = await walkThrough();
        await restingLeaf(t, id);
        await lookAt(t, 5.06, 2.0, 1.0);
        const aimed = await t.poll(async () => ((await target(t)) === id ? true : null), 3000);
        await page.keyboard.press('e');
        await t.poll(async () => ((await openOf(t, id)) === true ? true : null), 3000);
        await restingLeaf(t, id);
        const x2 = await walkThrough();
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.exitPointerLock());
        const blocked = x1 < 5.0;
        const passed = x2 > 5.2;
        return {
          status: blocked && passed && aimed ? 'ok' : 'fail',
          observed: `Tür geschlossen, 3 s mit W auf die Tür zu (Start x 4,30 m, Wand bei 5,06 m): stehen geblieben bei x ${x1.toFixed(2).replace('.', ',')} m – ${blocked ? 'kein Durchkommen' : 'durchgegangen'}. Tür mit E geöffnet (im Fadenkreuz: ${aimed ? 'ja' : 'nein'}), gleicher Weg: bei x ${x2.toFixed(2).replace('.', ',')} m – ${passed ? 'im Schlafzimmer angekommen' : 'nicht durchgekommen'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 8,
      action: 'App neu laden.',
      expected: 'Offene und geschlossene Türen und Fenster sind gespeichert.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => {});
        const before = Object.fromEntries((await t.project()).openings.map((o) => [o.id, o.open]));
        await page.getByText('Gespeichert').waitFor({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const after = (await t.project()).openings;
        const same = after.every((o) => before[o.id] === o.open);
        const desc = after.map((o) => `${o.kind === 'door' ? 'Tür' : 'Fenster'} ${o.width.toFixed(1).replace('.', ',')} m ${o.open ? 'offen' : 'zu'}`).join(', ');
        return { status: same && after.length === Object.keys(before).length ? 'ok' : 'fail', observed: `Nach dem Neuladen: ${desc} – ${same ? 'wie vorher' : 'anders als vorher'}.` };
      },
    },
    {
      nr: 9,
      action: 'Das Öffnen ansehen.',
      expected: 'Es sieht gut aus (Drehung um das Scharnier, Griff an der richtigen Seite).',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        await t.lookAt({ x: 3.2, y: 1.7, z: 3.2 }, { x: 5.06, y: 1.0, z: 2.0 });
        await page.waitForTimeout(2000);
        return { status: 'look', observed: 'Innentür vom Wohnzimmer aus fotografiert. Scharnier und Griffseite bitte am Bild beurteilen.', caption: 'Innentür geöffnet (3D)' };
      },
    },
  ],
};
