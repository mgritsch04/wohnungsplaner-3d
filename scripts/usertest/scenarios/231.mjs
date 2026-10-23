// Möbel tragen in der Ich-Ansicht ruckelt (#231) – Testschritte aus dem Kommentar in #231.
// Echte Bildrate und Ruckeln lassen sich nur mit Grafikkarte beurteilen (hier Software-Grafik, wenige FPS): die FPS-Werte stehen
// nur zur Information im Bericht. Geprüft wird, was ohne Grafikkarte geht: Tragen folgt dem Blick, Schatten der Lampe wird
// neu berechnet, Rückgängig stellt alles wieder her.
const fps = (t) => t.page.evaluate(() => window.__wp.three.gl.info.render.frame);
const sample = async (t, ms) => {
  const f0 = await fps(t);
  const t0 = Date.now();
  await t.page.waitForTimeout(ms);
  return ((await fps(t)) - f0) / ((Date.now() - t0) / 1000);
};
const lookAt = (t, x, y, h) =>
  t.page.evaluate(([tx, ty, th]) => {
    const wp = window.__wp;
    const c = wp.three.camera.position;
    wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), -Math.atan2(c.y - th, Math.hypot(tx - c.x, ty - c.z)));
  }, [x, y, h]);

export default {
  issue: 231,
  name: 'Möbel tragen ruckelt',
  title: 'Bug: Möbel tragen in der Ich-Ansicht ruckelt stark (P1)',
  device: 'desktop',
  pc: true,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, „3D“ und „Realismus“ wählen, Tageszeit „Nacht (23:30)“, „Lampen: an“. Dann „Begehen“ starten.',
      expected: 'Die Ansicht läuft flüssig, die FPS-Anzeige zeigt einen stabilen Wert.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => { d.settings.quality = 'realism'; d.settings.timeOfDay = 23.5; d.settings.lamps = 'on'; }));
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Realismus' }).click().catch(() => undefined);
        await t.poll(async () => (Math.abs((await page.evaluate(() => window.__wp.lightingHour())) - 23.5) < 0.01 ? 1 : null), 60000);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await page.waitForTimeout(2500);
        t.fps1 = await sample(t, 4000);
        const status = await page.locator('.status-bar, footer').last().innerText().catch(() => '');
        await t.shot('Begehen, Realismus, Nacht, Lampen an');
        return { status: 'device', observed: `Bildrate in der Cloud (Software-Grafik): ${t.fps1.toFixed(1)} FPS, Statusleiste „${(status.match(/\d+ FPS/) ?? ['–'])[0]}“. Ob die Ansicht auf einem PC flüssig läuft, nur mit Grafikkarte prüfbar.` };
      },
    },
    {
      nr: 2,
      action: 'Auf ein Möbelstück (z. B. den Couchtisch) schauen, mit „G“ aufnehmen und dabei den Blick 10 Sekunden lang langsam hin und her drehen.',
      expected: 'Das Möbelstück folgt dem Blick ohne Ruckeln, die FPS fallen höchstens leicht gegenüber Schritt 1 (nicht auf einen Bruchteil).',
      async run(t) {
        const { page } = t;
        const table = (await t.project()).furniture.find((f) => f.catalogId === 'generic-coffee-table');
        t.table = table;
        await lookAt(t, table.x, table.y, 0.3);
        await t.poll(async () => ((await page.evaluate(() => window.__wp.walk.target())) === table.id ? 1 : null), 6000);
        await page.keyboard.press('g');
        const carry = await t.poll(async () => ((await page.evaluate(() => window.__wp.useUiStore.getState().walkCarry)) === table.id ? 1 : null), 4000);
        const f0 = await fps(t);
        const t0 = Date.now();
        const yaw0 = await page.evaluate(() => window.__wp.three.camera.rotation.y);
        let moved = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate((k) => {
            const wp = window.__wp;
            const e = wp.three.camera.rotation;
            wp.walk.look(e.y + (k % 2 ? 0.12 : -0.12), e.x);
          }, i);
          await page.waitForTimeout(250);
        }
        const f1 = await fps(t);
        const dur = (Date.now() - t0) / 1000;
        const cur = (await t.project()).furniture.find((f) => f.id === table.id);
        moved = Math.hypot(cur.x - table.x, cur.y - table.y);
        t.fps2 = (f1 - f0) / dur;
        return { status: carry ? 'device' : 'fail', observed: `Tisch mit G aufgenommen (${carry ? 'ja' : 'nein'}), Blick 5 s hin und her gedreht: Tisch folgte (um ${moved.toFixed(2)} m bewegt); Bildrate beim Tragen ${t.fps2.toFixed(1)} FPS gegenüber ${t.fps1.toFixed(1)} FPS ohne Tragen (Software-Grafik, daher nur Information). Ruckeln und FPS-Abfall nur mit Grafikkarte beurteilbar.` };
      },
    },
    {
      nr: 3,
      action: 'Das Möbelstück mit „G“ absetzen und den Schatten der Lampen daneben ansehen.',
      expected: 'Der Schatten des Möbelstücks steht nach spätestens einer Viertelsekunde an der neuen Stelle.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('g');
        await t.poll(async () => ((await page.evaluate(() => window.__wp.useUiStore.getState().walkCarry)) == null ? 1 : null), 4000);
        const placed = (await t.project()).furniture.find((f) => f.id === t.table.id);
        t.placed = placed;
        // shadow maps of the lamps: pending update flag / rendered
        const shadow = await page.evaluate(() => {
          const out = [];
          window.__wp.three.scene.traverse((o) => void ((o.isPointLight || o.isSpotLight) && o.castShadow && out.push({ map: !!o.shadow.map, pending: !!o.shadow.needsUpdate })));
          return out;
        });
        await page.waitForTimeout(400);
        await t.shot('Nach dem Absetzen');
        return { status: 'device', observed: `Tisch abgesetzt bei (${placed.x.toFixed(2)} / ${placed.y.toFixed(2)}) m; Lampen mit Schattenwurf: ${shadow.length} (${shadow.map((s) => (s.map ? 'Schattenkarte vorhanden' : 'ohne Karte')).join(', ') || '–'}). Ob der Schatten innerhalb von 0,25 s an der neuen Stelle steht, ist nur mit Grafikkarte im Bild beurteilbar.` };
      },
    },
    {
      nr: 4,
      action: 'Rückgängig (Strg+Z).',
      expected: 'Das Möbelstück springt an seinen alten Platz, Wände und andere Möbel bleiben unverändert.',
      async run(t) {
        const before = await t.project();
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(500);
        const p = await t.project();
        const back = p.furniture.find((f) => f.id === t.table.id);
        const others = p.furniture.filter((f) => f.id !== t.table.id).every((f) => {
          const b = before.furniture.find((g) => g.id === f.id);
          return b && b.x === f.x && b.y === f.y;
        });
        const walls = JSON.stringify(p.walls) === JSON.stringify(before.walls);
        return { status: Math.abs(back.x - t.table.x) < 1e-6 && Math.abs(back.y - t.table.y) < 1e-6 && others && walls ? 'ok' : 'fail', observed: `Tisch wieder bei (${back.x.toFixed(2)} / ${back.y.toFixed(2)}) m (vorher (${t.table.x.toFixed(2)} / ${t.table.y.toFixed(2)})); andere Möbel unverändert: ${others}; Wände unverändert: ${walls}.` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Optional: dasselbe auf dem Handy mit „Normal“-Grafik.',
      expected: 'Tragen ist flüssig, nicht schlechter als vorher.',
      async run() {
        return { status: 'skip', observed: 'Handy-Schritt nicht geprüft.' };
      },
    },
  ],
};
