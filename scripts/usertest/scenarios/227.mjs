// Drag and Drop aus dem Katalog in der Ich-Ansicht (#227) – Testschritte aus dem Kommentar in #227.
const canvas = (t) => t.page.locator('[data-testid="scene3d"] canvas');
const plants = async (t) => (await t.project()).furniture.filter((f) => f.name === 'Zimmerpflanze groß');
const entry = (t) => t.page.locator('.catalog-item', { hasText: 'Zimmerpflanze groß' });
const lookAtFloor = (t, x, y) =>
  t.page.evaluate(([tx, ty]) => {
    const wp = window.__wp;
    const c = wp.three.camera.position;
    wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y, Math.hypot(tx - c.x, ty - c.z)));
  }, [x, y]);

export default {
  issue: 227,
  name: 'Katalog-Drag in der Ich-Ansicht',
  title: 'Drag and Drop aus dem Katalog funktioniert in der Ich-Ansicht nicht',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links den Tab „Katalog“ öffnen und nach „Zimmerpflanze“ suchen.',
      expected: 'Der Eintrag „Zimmerpflanze groß“ ist sichtbar.',
      async run(t) {
        await t.freshStart();
        await t.page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
        await t.page.getByLabel('Katalog durchsuchen').fill('Zimmerpflanze');
        t.before = (await plants(t)).length;
        const n = await entry(t).count();
        return { status: n === 1 ? 'ok' : 'fail', observed: `Einträge „Zimmerpflanze groß“: ${n}; Pflanzen im Projekt vorher: ${t.before}.` };
      },
    },
    {
      nr: 2,
      action: 'Auf „3D“ und dann auf „Begehen“ klicken, aber nicht in die Szene klicken (die Maus bleibt frei).',
      expected: 'Fadenkreuz und Begehen-Hinweis sind zu sehen.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        const hint = await page.locator('.walk-overlay').innerText().catch(() => '');
        const locked = await page.evaluate(() => !!document.pointerLockElement);
        return { status: !locked ? 'ok' : 'fail', observed: `Fadenkreuz sichtbar, Maus frei (Pointer-Lock: ${locked}); Hinweis: „${hint.replace(/\n/g, ' ').slice(0, 120)}“.` };
      },
    },
    {
      nr: 3,
      action: 'Den Blick leicht auf den Boden im Wohnzimmer richten … „Zimmerpflanze groß“ aus dem Katalog auf eine Bodenstelle im Wohnzimmer ziehen und loslassen.',
      expected: 'Die Pflanze steht an der Bodenstelle unter dem Mauszeiger und ist ausgewählt. Der Begehen-Modus bleibt aktiv.',
      async run(t) {
        const { page } = t;
        await lookAtFloor(t, 2.5, 2);
        await page.waitForTimeout(300);
        const cbox = await canvas(t).boundingBox();
        const s = await t.worldToScreen(2.5, 0, 2);
        await entry(t).dragTo(canvas(t), { targetPosition: { x: s.x - cbox.x, y: s.y - cbox.y } });
        await t.poll(async () => ((await plants(t)).length === t.before + 1 ? 1 : null), 6000);
        const pl = (await plants(t)).at(-1);
        const sel = await t.selection();
        const walking = await page.getByTestId('crosshair').count();
        await t.shot('Pflanze abgelegt');
        return { status: pl && Math.abs(pl.x - 2.5) < 0.1 && Math.abs(pl.y - 2) < 0.1 && sel?.id === pl.id && walking === 1 ? 'ok' : 'fail', observed: `Pflanze bei (${pl?.x.toFixed(2)} / ${pl?.y.toFixed(2)}) m, Mauszeiger zeigte auf (2,50 / 2,00); ausgewählt: ${sel?.id === pl?.id}; Begehen aktiv: ${walking === 1}.` };
      },
    },
    {
      nr: 4,
      action: 'Mit Strg+Z rückgängig machen.',
      expected: 'Die Pflanze ist wieder weg.',
      async run(t) {
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(400);
        const n = (await plants(t)).length;
        return { status: n === t.before ? 'ok' : 'fail', observed: `Pflanzen im Projekt: ${n} (vorher ${t.before}).` };
      },
    },
    {
      nr: 5,
      action: 'Den Blick nach oben richten und die Pflanze in den oberen Bildrand ziehen (kein Boden unter dem Mauszeiger).',
      expected: 'Hinweis „nicht abgelegt – bitte in einen Raum ziehen“, es wird nichts eingefügt.',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => window.__wp.walk.look(0, 1.2));
        await page.waitForTimeout(300);
        const cbox = await canvas(t).boundingBox();
        await entry(t).dragTo(canvas(t), { targetPosition: { x: cbox.width / 2, y: 10 } });
        const shown = await page.getByText('nicht abgelegt – bitte in einen Raum ziehen').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
        const n = (await plants(t)).length;
        await t.shot('Hinweis „nicht abgelegt“');
        return { status: shown && n === t.before ? 'ok' : 'fail', observed: `Hinweis sichtbar: ${shown}; Pflanzen im Projekt: ${n} (vorher ${t.before}).` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Mit gedrückter Alt-Taste auf eine Stelle direkt neben einem Möbel ziehen.',
      expected: 'Die Pflanze wird ohne Kollisionsprüfung genau dort abgelegt, wie in der Übersicht.',
      async run(t) {
        const { page } = t;
        const sofa = (await t.project()).furniture.find((f) => f.catalogId === 'generic-sofa-3');
        await lookAtFloor(t, sofa.x, sofa.y);
        await page.waitForTimeout(300);
        const cbox = await canvas(t).boundingBox();
        const s = await t.worldToScreen(sofa.x, 0, sofa.y);
        await page.keyboard.down('Alt');
        await entry(t).dragTo(canvas(t), { targetPosition: { x: s.x - cbox.x, y: s.y - cbox.y } });
        await page.keyboard.up('Alt');
        await t.poll(async () => ((await plants(t)).length === t.before + 1 ? 1 : null), 5000);
        const pl = (await plants(t)).at(-1);
        return { status: pl && Math.hypot(pl.x - sofa.x, pl.y - sofa.y) < 0.35 ? 'ok' : 'fail', observed: `Mit Alt mitten auf das Sofa (${sofa.x.toFixed(2)} / ${sofa.y.toFixed(2)}) gezogen: Pflanze bei (${pl?.x.toFixed(2)} / ${pl?.y.toFixed(2)}), ohne Kollisionsstopp abgelegt.` };
      },
    },
    {
      nr: 7,
      action: 'Auf „Übersicht“ wechseln und die Pflanze erneut in die 3D-Ansicht ziehen.',
      expected: 'Funktioniert wie bisher.',
      async run(t) {
        const { page } = t;
        const before = (await plants(t)).length;
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(1200);
        const cbox = await canvas(t).boundingBox();
        const s = await t.worldToScreen(2.5, 0, 3.4);
        await entry(t).dragTo(canvas(t), { targetPosition: { x: s.x - cbox.x, y: s.y - cbox.y } });
        const ok = await t.poll(async () => ((await plants(t)).length === before + 1 ? 1 : null), 5000);
        return { status: ok ? 'ok' : 'fail', observed: `Pflanzen vorher ${before}, nachher ${(await plants(t)).length}.` };
      },
    },
  ],
};
