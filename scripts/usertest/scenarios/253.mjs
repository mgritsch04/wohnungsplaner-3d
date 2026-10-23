// Smart Home: WLAN-Abdeckung im Plan anzeigen (#253) – Testschritte aus dem Issue-Text von #253.
const left = (t) => t.page.locator('.panel.left');
const panel = (t) => left(t).getByTestId('smarthome-panel');
const dbm = async (t, room) => Number(await panel(t).locator(`[data-testid="wifi-room"][data-room="${room}"]`).getAttribute('data-dbm'));
const routers = async (t) => (await t.project()).devices.filter((d) => d.kind === 'router');
const in3d = (t, id) =>
  t.page.evaluate((i) => {
    let n = 0;
    window.__wp.three.scene.traverse((o) => { if (o.userData?.smartDevice === i || o.userData?.device === i) n++; });
    return n;
  }, id);

export default {
  issue: 253,
  name: 'WLAN-Abdeckung',
  title: 'Smart Home: WLAN-Abdeckung im Plan anzeigen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, Projekt mit mehreren Räumen (Beispielwohnung). Mindestens eine Wand trennt zwei Räume.',
      expected: 'Mehrere Räume, getrennt durch eine Wand.',
      async run(t) {
        await t.freshStart();
        const p = await t.project();
        return { status: p.rooms.length >= 2 ? 'ok' : 'fail', observed: `Räume: ${p.rooms.map((r) => r.name).join(', ')}; Wände: ${p.walls.length}.` };
      },
    },
    {
      nr: 2,
      action: 'Smart-Home-Reiter › Geräte: „Router“ wählen und in den Plan setzen (Beispielwohnung hat keinen Flur: Wohnzimmer).',
      expected: 'Das Gerät erscheint in 2D und 3D.',
      async run(t) {
        const { page } = t;
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        await panel(t).locator('[data-testid="device-kind"][data-kind="router"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(400);
        const r = (await routers(t))[0];
        const in2d = await page.locator(`[data-testid="device-2d"][data-device-id="${r?.id}"]`).count();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        const n3 = r ? await in3d(t, r.id) : 0;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(500);
        return { status: r && in2d === 1 && n3 > 0 ? 'ok' : 'fail', observed: `Gerät „${r?.name}“ bei (${r?.x.toFixed(2)} / ${r?.y.toFixed(2)}) m; in 2D: ${in2d}; in der 3D-Szene: ${n3} Objekt(e).` };
      },
    },
    {
      nr: 3,
      action: 'Die Anzeige „WLAN-Abdeckung“ („Abdeckung im Plan anzeigen“) einschalten.',
      expected: 'Farbfläche über dem 2D-Plan, nahe am Router am stärksten, hinter der Wand schwächer. Je Raum steht ein Wert.',
      async run(t) {
        const { page } = t;
        const was = await page.getByTestId('wifi-overlay').count();
        await panel(t).getByLabel('Abdeckung im Plan anzeigen').check();
        await page.getByTestId('wifi-overlay').waitFor({ timeout: 5000 });
        const rooms = (await t.project()).rooms.map((r) => r.name);
        const values = Object.fromEntries(await Promise.all(rooms.map(async (n) => [n, await dbm(t, n)])));
        const levels = await panel(t).getByTestId('wifi-room').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-room')}: ${e.getAttribute('data-level')} (${e.getAttribute('data-dbm')} dBm)`));
        const hint = await panel(t).getByTestId('wifi-hint').innerText();
        const rs = (await routers(t))[0];
        // Signalstärke in der Farbfläche: Zellen direkt am Router gegen weit entfernte
        const cells = await page.getByTestId('wifi-overlay').evaluate((svg) => svg.querySelectorAll('rect,path').length);
        t.values = values;
        await t.shot('WLAN-Abdeckung im Plan');
        const near = values.Wohnzimmer;
        const others = rooms.filter((n) => n !== 'Wohnzimmer').map((n) => values[n]);
        return { status: was === 0 && cells > 0 && near > Math.min(...others) && /Messen mit dem Handy ersetzt das nicht/.test(hint) ? 'ok' : 'fail', observed: `Vorher aus: ${was === 0}; Farbflächen-Elemente: ${cells}; Werte je Raum: ${levels.join(' · ')}; Hinweis: „${hint.replace(/\n/g, ' ').slice(0, 120)}“; Router im Wohnzimmer, Raum dahinter schwächer: ${near > Math.min(...others)}.` };
      },
    },
    {
      nr: 4,
      action: 'Den Router in den anderen Raum ziehen.',
      expected: 'Die Abdeckung rechnet neu, entfernte Räume werden schwächer.',
      async run(t) {
        const { page } = t;
        const r = (await routers(t))[0];
        const before = { ...t.values };
        const hit = page.locator(`[data-testid="device-2d"][data-device-id="${r.id}"] [data-testid="device-hit"]`);
        const b = await hit.boundingBox();
        const to = await t.planToScreen(8.0, 3.2);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const r2 = (await routers(t))[0];
        const rooms = (await t.project()).rooms.map((x) => x.name);
        const after = Object.fromEntries(await Promise.all(rooms.map(async (n) => [n, await dbm(t, n)])));
        t.values = after;
        return { status: r2.x > 6 && after.Wohnzimmer < before.Wohnzimmer - 3 && after.Schlafzimmer > before.Schlafzimmer + 3 ? 'ok' : 'fail', observed: `Router jetzt bei (${r2.x.toFixed(2)} / ${r2.y.toFixed(2)}) m; Wohnzimmer ${before.Wohnzimmer} → ${after.Wohnzimmer} dBm, Schlafzimmer ${before.Schlafzimmer} → ${after.Schlafzimmer} dBm.` };
      },
    },
    {
      nr: 5,
      action: 'Einen zweiten Access Point in den schwachen Raum setzen.',
      expected: 'Dieser Raum wird besser.',
      async run(t) {
        const { page } = t;
        const before = { ...t.values };
        const weak = before.Wohnzimmer < before.Schlafzimmer ? 'Wohnzimmer' : 'Schlafzimmer';
        await panel(t).getByLabel('Raum').selectOption({ label: weak });
        await panel(t).locator('[data-testid="device-kind"][data-kind="router"]').click();
        await panel(t).getByTestId('device-add').click();
        await page.waitForTimeout(400);
        const now = await dbm(t, weak);
        t.weak = weak;
        t.after = now;
        await t.shot('Zweiter Access Point');
        return { status: now > before[weak] + 3 ? 'ok' : 'fail', observed: `Zweiter Access Point im schwachen Raum „${weak}“: ${before[weak]} → ${now} dBm; Router gesamt: ${(await routers(t)).length}.` };
      },
    },
    {
      nr: 6,
      action: 'Projekt speichern und neu laden.',
      expected: 'Router und Access Point sind noch da, die Anzeige rechnet gleich.',
      async run(t) {
        const { page } = t;
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        await left(t).getByRole('button', { name: 'Smart Home' }).click();
        const n = (await routers(t)).length;
        await panel(t).getByLabel('Abdeckung im Plan anzeigen').check();
        const band = await panel(t).getByLabel('Band').inputValue().catch(() => '');
        const same = await dbm(t, t.weak);
        return { status: n === 2 && same === t.after ? 'ok' : 'fail', observed: `Nach dem Neuladen: ${n} Router/Access Points; „${t.weak}“: ${same} dBm (vorher ${t.after} dBm); Band ${band}.` };
      },
    },
  ],
};
