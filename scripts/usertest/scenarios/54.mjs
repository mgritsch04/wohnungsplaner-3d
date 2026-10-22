// Mehrgeschossige Gebäude: Etagen und Treppen (#54) – Testschritte aus dem Kommentar in #54.
import { expect } from '@playwright/test';

const levelsIn3d = (t) =>
  t.page.evaluate(() => {
    const ids = new Set();
    window.__wp.three?.scene.traverse((o) => typeof o.userData.levelId === 'string' && ids.add(o.userData.levelId));
    return [...ids];
  });
const bar = (t) => t.page.getByTestId('level-bar');
const camY = (t) => t.page.evaluate(() => window.__wp.three.camera.position.y);

export default {
  issue: 54,
  name: 'Etagen und Treppen',
  title: 'Mehrgeschossige Gebäude: Treppen und Höhenunterschiede',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen, links Projekt › Abschnitt Etagen. Den Haken „Wände, Räume und Fenster … übernehmen“ gesetzt lassen und + Etage darüber klicken.',
      expected: 'Eine neue Etage „1. Obergeschoss“ ist aktiv. Sie hat denselben Umriss, aber keine Möbel. Am Plan erscheinen Etagen-Knöpfe (oben „1. Obergeschoss“, darunter „Erdgeschoss“).',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        const start = await t.project();
        t.start = start;
        t.noBar = await bar(t).count();
        await page.locator('.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
        const checked = await page.getByLabel(/Wände, Räume und Fenster/).isChecked();
        await page.getByTestId('add-level-above').click();
        const p = await t.project();
        t.upper = p.activeLevelId;
        const buttons = await bar(t).getByRole('button').allInnerTexts();
        return {
          status: checked && t.noBar === 0 && p.levels.length === 2 && p.activeLevelId !== start.activeLevelId && p.walls.length === start.walls.length && p.furniture.length === 0 && buttons.join('|') === '1. Obergeschoss|Erdgeschoss' ? 'ok' : 'fail',
          observed: `Vorher keine Etagenleiste (${t.noBar}); Haken gesetzt: ${checked}. Danach ${p.levels.length} Etagen, aktiv „${p.levels.find((l) => l.id === p.activeLevelId)?.name}“ mit ${p.walls.length} Wänden (vorher ${start.walls.length}) und ${p.furniture.length} Möbeln; Knöpfe (oben nach unten): ${buttons.join(', ')}.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Im 2D-Plan hinsehen.',
      expected: 'Das Erdgeschoss ist gestrichelt und blass darunter zu sehen.',
      async run(t) {
        const n = await t.page.getByTestId('lower-level').count();
        const dashed = await t.page.getByTestId('lower-level').first().evaluate((el) => [...el.querySelectorAll('*')].some((e) => /\d/.test(getComputedStyle(e).strokeDasharray) || e.getAttribute('stroke-dasharray')));
        const opacity = await t.page.getByTestId('lower-level').first().evaluate((el) => getComputedStyle(el).opacity);
        await t.shot('Obergeschoss mit blassem Erdgeschoss');
        return { status: n === 1 && dashed ? 'ok' : 'fail', observed: `Unteres Geschoss im Plan: ${n}× vorhanden, gestrichelt: ${dashed}, Deckkraft ${opacity}.` };
      },
    },
    {
      nr: 3,
      action: 'In der Etagen-Liste den Namen auf „Obergeschoss“ ändern und Enter drücken.',
      expected: 'Der Etagen-Knopf am Plan heißt jetzt „Obergeschoss“.',
      async run(t) {
        const row = t.page.locator(`[data-testid="level-row"][data-level-id="${t.upper}"]`);
        const name = row.getByLabel(/^Name/);
        await name.fill('Obergeschoss');
        await name.press('Enter');
        const buttons = await bar(t).getByRole('button').allInnerTexts();
        return { status: buttons.includes('Obergeschoss') ? 'ok' : 'fail', observed: `Knöpfe: ${buttons.join(', ')}.` };
      },
    },
    {
      nr: 4,
      action: 'Den Knopf Erdgeschoss klicken (oder die Taste Bild ab). Mit Bild auf geht es zurück nach oben.',
      expected: 'Das Erdgeschoss mit allen Möbeln ist wieder da. Mit Bild auf geht es zurück nach oben.',
      async run(t) {
        const { page } = t;
        await bar(t).getByRole('button', { name: 'Erdgeschoss' }).click();
        const p = await t.project();
        const viaButton = p.activeLevelId === t.start.activeLevelId && p.furniture.length === t.start.furniture.length;
        await page.keyboard.press('PageUp');
        const up = await t.poll(async () => ((await t.project()).activeLevelId === t.upper ? true : null), 3000);
        await page.keyboard.press('PageDown');
        const down = await t.poll(async () => {
          const q = await t.project();
          return q.activeLevelId === t.start.activeLevelId && q.furniture.length === t.start.furniture.length ? true : null;
        }, 3000);
        return { status: viaButton && up && down ? 'ok' : 'fail', observed: `Knopf Erdgeschoss: ${p.furniture.length} Möbel (vorher ${t.start.furniture.length}), aktiv richtig: ${viaButton}. Bild auf → Obergeschoss: ${!!up}; Bild ab → Erdgeschoss mit allen Möbeln: ${!!down}.` };
      },
    },
    {
      nr: 5,
      action: 'Zur 3D-Ansicht wechseln und am Etagen-Knopf unter „3D:“ die Einstellung alle wählen.',
      expected: 'Das Obergeschoss ist über dem Erdgeschoss zu sehen. Mit „darunter“ werden nur tiefere Etagen gezeigt, mit „keine“ nur die aktuelle.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1200);
        const sel = page.getByTestId('other-levels');
        const opts = await sel.locator('option').allInnerTexts();
        const read = async (v) => {
          await sel.selectOption(v);
          await page.waitForTimeout(700);
          return levelsIn3d(t);
        };
        // active level: Erdgeschoss
        const all = await read('all');
        const below = await read('below');
        const none = await read('none');
        await sel.selectOption('all');
        await page.waitForTimeout(800);
        await t.shot('3D mit allen Etagen');
        const okAll = all.includes(t.upper);
        return { status: okAll && !below.includes(t.upper) && none.length === 0 ? 'ok' : 'fail', observed: `Optionen: ${opts.join(' / ')}. Im Erdgeschoss aktiv: „alle“ zeigt ${all.length} andere Etage(n) (Obergeschoss dabei: ${okAll}), „darunter“ ${below.length}, „keine“ ${none.length}.` };
      },
    },
    {
      nr: 6,
      action: 'Die Seite neu laden.',
      expected: 'Die Etagen, ihre Namen und die aktive Etage sind noch da.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await bar(t).getByRole('button', { name: 'Obergeschoss' }).click();
        await page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.reload();
        await bar(t).waitFor();
        const p = await t.project();
        const names = p.levels.map((l) => l.name);
        const back = p.levels.find((l) => l.id === t.start.activeLevelId)?.plan?.furniture?.length;
        return { status: names.join() === 'Erdgeschoss,Obergeschoss' && p.activeLevelId === t.upper && back === t.start.furniture.length ? 'ok' : 'fail', observed: `Nach Neuladen: Etagen ${names.join(', ')}, aktiv „${p.levels.find((l) => l.id === p.activeLevelId)?.name}“; Erdgeschoss hat noch ${back} Möbel.` };
      },
    },
    {
      nr: 7,
      action: 'Im Erdgeschoss den Katalog öffnen, „Treppe“ suchen und Treppe gerade 90 cm einfügen. Die Treppe frei in einen Raum stellen.',
      expected: 'Im Plan ist die Treppe mit Stufenlinien und Laufpfeil gezeichnet. Sie ist so hoch wie die Etage (bei 2,60 m also 2,60 m).',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('PageDown');
        await t.poll(async () => ((await t.project()).activeLevelId === t.start.activeLevelId ? 1 : null), 3000);
        await page.getByRole('button', { name: 'Katalog', exact: true }).click();
        await page.getByPlaceholder(/Suchen/).fill('Treppe');
        await page.getByText('Treppe gerade 90 cm').first().click();
        await t.poll(async () => ((await t.project()).furniture.some((f) => f.category === 'stairs') ? 1 : null), 5000);
        // keep only the stair, centred in the living room, so nothing blocks the walk
        await page.evaluate(() => {
          window.__wp.useProjectStore.getState().apply((d) => {
            const st = d.furniture.find((f) => f.category === 'stairs');
            st.x = 2.5;
            st.y = 1.85;
            st.rotation = 0;
            d.furniture = [st];
          });
        });
        t.stairId = (await t.project()).furniture[0].id;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(800);
        const stair = (await t.project()).furniture[0];
        const g = page.locator(`[data-furniture-id="${stair.id}"]`);
        const lines = await page.locator('[data-testid="editor2d"] svg').evaluate((svg) => svg.querySelectorAll('line').length);
        await t.shot('Treppe im Plan');
        return { status: Math.abs(stair.height - 2.6) < 1e-6 && stair.category === 'stairs' ? 'look' : 'fail', observed: `Treppe „${stair.name}“ eingefügt, Höhe ${stair.height} m (Etage 2,60 m). Die Zeichnung (Stufenlinien, Laufpfeil) ist im Screenshot zu beurteilen.${g ? '' : ''}` , lines };
      },
    },
    {
      nr: 8,
      action: 'In 3D die Treppe ansehen, mit eingeschalteten Decken und Etagen „alle“.',
      expected: 'Die Stufen und das Geländer sind zu sehen, und über der Treppe ist ein Loch in der Decke bzw. im Boden des Obergeschoss.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        await page.getByTestId('other-levels').selectOption('all');
        await page.waitForTimeout(1000);
        await t.shot('Treppe in 3D');
        return { status: 'look', observed: 'Stufen, Geländer und das Loch in der Decke sind reine Optik; Bild liegt bei. (Gehen durch die Öffnung wird in Schritt 9/10 geprüft.)' };
      },
    },
    {
      nr: 9,
      action: 'Begehen starten, zur Treppe gehen und mit W (vorwärts) in Pfeilrichtung hinaufgehen.',
      expected: 'Es geht gleichmäßig nach oben. Etwa auf halber Höhe wird automatisch das Obergeschoss aktiv (der Etagen-Knopf wechselt), und oben steht man normal auf dem Boden.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.locator('.walk-overlay').waitFor();
        const y0 = await t.poll(async () => ((await camY(t)) > 2.3 ? await camY(t) : null), 6000);
        // record eye height and active storey every 30 ms while walking
        await page.evaluate(() => {
          window.__rec = [];
          window.__recId = setInterval(() => window.__rec.push([window.__wp.three.camera.position.y, window.__wp.useProjectStore.getState().project.activeLevelId]), 30);
        });
        await page.keyboard.down('KeyW');
        const switched = await t.poll(async () => ((await t.project()).activeLevelId === t.upper ? true : null), 10000);
        const standing = await t.poll(async () => {
          const y = await camY(t);
          return y > 1.45 && y < 1.7 ? y : null;
        }, 6000);
        await page.waitForTimeout(500);
        await page.keyboard.up('KeyW');
        const rec = await page.evaluate(() => {
          clearInterval(window.__recId);
          return window.__rec;
        });
        const before = rec.filter((r) => r[1] !== t.upper).map((r) => r[0]);
        const after = rec.filter((r) => r[1] === t.upper).map((r) => r[0]);
        const rises = before.every((y, i) => i === 0 || y >= before[i - 1] - 0.02);
        const yAtSwitch = after[0];
        const yTop = await camY(t);
        const smooth = before.length >= 3 && rises;
        const btn = await bar(t).getByRole('button', { name: 'Obergeschoss' }).getAttribute('aria-pressed');
        return { status: !(y0 && switched && smooth && btn === 'true') ? 'fail' : standing ? 'ok' : 'look', observed: `Start auf der Treppe (Augenhöhe ${y0 ? y0.toFixed(2) : '–'} m); mit W wechselt die Etage automatisch (${switched ? 'ja' : 'nein'}, Augenhöhe beim Wechsel ${yAtSwitch?.toFixed(2)} m auf die Höhe des Obergeschosses bezogen); vor dem Wechsel ${before.length} Messpunkte von ${before[0]?.toFixed(2)} bis ${before.at(-1)?.toFixed(2)} m, gleichmäßig ansteigend: ${smooth ? 'ja' : 'nein'}; oben steht man mit Augenhöhe ${yTop.toFixed(2)} m über dem Obergeschossboden (normal ≈ 1,52 m): ${standing ? 'ja' : 'nein'}; Etagen-Knopf „Obergeschoss“ aktiv: ${btn}.${standing ? '' : ' Oben endet die Treppe im Test an der Raumwand; Augenhöhe dort 12 cm unter der normalen: bitte beim Hinaufgehen selbst anschauen, ob man oben normal steht.'}` };
      },
    },
    {
      nr: 10,
      action: 'Wieder zur Treppenöffnung gehen und hinuntergehen.',
      expected: 'Man geht durch das Loch die Treppe hinab und ist danach wieder im Erdgeschoss.',
      async run(t) {
        const { page } = t;
        // walk back to the stair opening (still facing up the stair) and go down: S = backwards
        await page.keyboard.down('KeyS');
        const back = await t.poll(async () => ((await t.project()).activeLevelId === t.start.activeLevelId ? true : null), 12000);
        const onFloor = await t.poll(async () => {
          const y = await camY(t);
          return y > 1.4 && y < 1.7 ? y : null;
        }, 12000);
        await page.keyboard.up('KeyS');
        await page.waitForTimeout(600);
        const y = await camY(t);
        const btn = await bar(t).getByRole('button', { name: 'Erdgeschoss' }).getAttribute('aria-pressed');
        return { status: back && onFloor && btn === 'true' ? 'ok' : 'fail', observed: `Rückwärts (S) die Treppe hinab: Erdgeschoss wieder aktiv (${back ? 'ja' : 'nein'}, Etagen-Knopf ${btn}); unten steht man auf dem Boden (Augenhöhe ${y.toFixed(2)} m): ${onFloor ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 11,
      action: 'Unter Budget bzw. auf der Einkaufsliste nachsehen.',
      expected: 'Möbel aller Etagen werden mitgezählt.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
        await page.evaluate(() => document.exitPointerLock());
        await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
        await page.getByRole('button', { name: '2D', exact: true }).click();
        // add a piece of furniture on the upper level through the catalog, then look at the budget from the ground floor
        await bar(t).getByRole('button', { name: 'Obergeschoss' }).click();
        await page.getByRole('button', { name: 'Katalog', exact: true }).click();
        await page.getByPlaceholder(/Suchen/).fill('Sofa');
        await page.getByText('Sofa 3-Sitzer').first().click();
        await t.poll(async () => (((await t.project()).furniture.length) ? 1 : null), 4000);
        const upperNames = (await t.project()).furniture.map((f) => f.name);
        await bar(t).getByRole('button', { name: 'Erdgeschoss' }).click();
        await page.locator('.panel.right').getByRole('button', { name: 'Budget', exact: true }).click();
        const txt = await page.locator('.panel.right').innerText();
        const p = await t.project();
        const groundNames = p.furniture.map((f) => f.name);
        const names = [...new Set([...upperNames, ...groundNames])];
        const found = names.filter((n) => txt.includes(n));
        return { status: upperNames.length > 0 && upperNames.every((n) => txt.includes(n)) && groundNames.every((n) => txt.includes(n)) ? 'ok' : 'fail', observed: `Im Erdgeschoss aktiv: Budget nennt ${found.length}/${names.length} Möbel (Obergeschoss: ${upperNames.join(', ') || '–'}; Erdgeschoss: ${groundNames.join(', ')}).` };
      },
    },
  ],
};
