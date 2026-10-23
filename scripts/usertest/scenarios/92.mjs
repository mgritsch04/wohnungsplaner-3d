// Blick von außen auf das Gebäude (#92) – Testschritte aus dem Kommentar in #92.
const btn = (t, name) => t.page.getByRole('button', { name, exact: true });
const pressed = async (t, name) => (await btn(t, name).getAttribute('aria-pressed')) === 'true';
const cam = (t) => t.page.evaluate(() => { const c = window.__wp.three.camera.position; return [c.x, c.y, c.z]; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export default {
  issue: 92,
  name: 'Blick von außen',
  title: 'Blick von außen auf das Gebäude mit Fassade, Fenstern und Eingang',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Ansicht „3D“ wählen, Kamera „Übersicht“ aktiv lassen.',
      expected: 'Oben in der Leiste gibt es neben „Schnitt“ eine Schaltfläche „Außen“ (Tooltip beginnt mit „Außen“).',
      async run(t) {
        await t.freshStart();
        await btn(t, '3D').click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1200);
        const b = btn(t, 'Außen');
        const vis = await b.isVisible();
        const tip = (await b.getAttribute('title')) ?? '';
        const schnitt = await btn(t, 'Schnitt').isVisible();
        return { status: vis && schnitt && /^Außen/.test(tip) ? 'ok' : 'fail', observed: `Schaltfläche „Außen“ sichtbar: ${vis}, „Schnitt“ daneben: ${schnitt}; Tooltip „${tip.slice(0, 60)}…“. Das Gebäude-Symbol selbst wurde nicht beurteilt.` };
      },
    },
    {
      nr: 2,
      action: '„Außen“ anklicken.',
      expected: 'Kamera blickt von der Eingangsseite auf die Wohnung; Wände mit Fenstern, ein Dach und halbtransparente Blöcke unter und über der Wohnung.',
      async run(t) {
        const c0 = await cam(t);
        await btn(t, 'Außen').click();
        await t.page.waitForTimeout(2500);
        const c1 = await cam(t);
        t.c1 = c1;
        await t.shot('92-aussen');
        return { status: 'look', observed: `Außenansicht an: ${await pressed(t, 'Außen')}; Kamera bewegt sich um ${dist(c0, c1).toFixed(1)} m. Ob Wände, Fenster, Dach und die halbtransparenten Nachbargeschosse stimmen und die Sicht von der Eingangsseite kommt, zeigt der Screenshot 92-aussen.` };
      },
    },
    {
      nr: 3,
      action: 'Markierungen ansehen.',
      expected: 'Ein rotes Zeichen mit „Ihre Wohnung“ über dem Gebäude, ein grüner Fleck mit „Eingang“ an der Außentür.',
      async run(t) {
        const home = await t.page.getByText('Ihre Wohnung', { exact: true }).first().isVisible().catch(() => false);
        const ent = await t.page.getByTestId('exterior-entrance-label').isVisible().catch(() => false);
        return { status: home && ent ? 'look' : 'fail', observed: `Beschriftung „Ihre Wohnung“ sichtbar: ${home}; Beschriftung „Eingang“ sichtbar: ${ent}. Farbe (rot/grün) und Lage am Gebäude und an der Tür siehe Screenshot 92-aussen.` };
      },
    },
    {
      nr: 4,
      action: 'Mit der linken Maustaste ziehen.',
      expected: 'Die Ansicht dreht sich um das Gebäude; Fassade und Fenster der anderen Seiten werden sichtbar.',
      async run(t) {
        const a = await cam(t);
        const box = await t.page.locator('[data-testid="scene3d"] canvas').boundingBox();
        const x = box.x + box.width * 0.5;
        const y = box.y + box.height * 0.55;
        await t.page.mouse.move(x, y);
        await t.page.mouse.down();
        await t.page.mouse.move(x + 200, y, { steps: 10 });
        await t.page.mouse.up();
        await t.page.waitForTimeout(1200);
        const b = await cam(t);
        await t.shot('92-gedreht');
        return { status: dist(a, b) > 1 ? 'look' : 'fail', observed: `Kamera hat sich beim Ziehen um ${dist(a, b).toFixed(1)} m bewegt (vorher ${a.map((v) => v.toFixed(1)).join('/')}, nachher ${b.map((v) => v.toFixed(1)).join('/')}). Ob man dabei die Fassade der anderen Seiten sieht, zeigt der Screenshot 92-gedreht.` };
      },
    },
    {
      nr: 5,
      action: '„Schnitt“ anklicken.',
      expected: 'Die Außenansicht schaltet sich aus, der Schnitt ist aktiv.',
      async run(t) {
        await btn(t, 'Schnitt').click();
        await t.page.waitForTimeout(800);
        const out = await pressed(t, 'Außen');
        const cut = await pressed(t, 'Schnitt');
        return { status: !out && cut ? 'ok' : 'fail', observed: `„Außen“ aktiv: ${out}; „Schnitt“ aktiv: ${cut}.` };
      },
    },
    {
      nr: 6,
      action: '„Außen“ erneut anklicken, dann noch einmal.',
      expected: 'An, dann aus: Dach, Blöcke und Beschriftungen verschwinden, die normale Übersicht kommt zurück.',
      async run(t) {
        await btn(t, 'Außen').click();
        await t.page.waitForTimeout(1500);
        const on = await pressed(t, 'Außen');
        const lab1 = await t.page.getByTestId('exterior-entrance-label').count();
        await btn(t, 'Außen').click();
        await t.page.waitForTimeout(1500);
        const off = !(await pressed(t, 'Außen'));
        const lab0 = await t.page.getByTestId('exterior-entrance-label').count();
        const home0 = await t.page.getByText('Ihre Wohnung', { exact: true }).count();
        return { status: on && lab1 === 1 && off && lab0 === 0 && home0 === 0 ? 'ok' : 'fail', observed: `Erster Klick: an=${on}, Beschriftung „Eingang“ da=${lab1}; zweiter Klick: aus=${off}, Beschriftungen „Eingang“/„Ihre Wohnung“ danach: ${lab0}/${home0}. Dach und Blöcke wurden nicht einzeln geprüft.` };
      },
    },
    {
      nr: 7,
      action: 'Optional: „Begehen“ wählen.',
      expected: 'Keine Außenmarkierungen, normale Begehung.',
      async run(t) {
        await btn(t, 'Außen').click();
        await t.page.waitForTimeout(800);
        await t.page.getByRole('button', { name: 'Begehen' }).click();
        await t.page.getByTestId('crosshair').waitFor({ timeout: 8000 });
        const lab = await t.page.getByTestId('exterior-entrance-label').count();
        const home = await t.page.getByText('Ihre Wohnung', { exact: true }).count();
        return { status: lab === 0 && home === 0 ? 'ok' : 'fail', observed: `Außenansicht vorher eingeschaltet; im Begehen sind Fadenkreuz da, „Eingang“-Beschriftungen ${lab}, „Ihre Wohnung“ ${home}.` };
      },
    },
  ],
};
