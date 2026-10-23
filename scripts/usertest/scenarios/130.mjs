// Lampen-Schatten in der Nachtszene (#130) – Testschritte aus dem Kommentar in #130.
const lights = (t) =>
  t.page.evaluate(() => {
    const out = [];
    window.__wp.three.scene.traverse((o) => {
      if (o.isLight && o.visible) out.push({ type: o.type, shadow: !!o.castShadow, intensity: +o.intensity.toFixed(2) });
    });
    return out;
  });
const setTime = (t, h) => t.page.evaluate((v) => window.__wp.useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = v)), h);

export default {
  issue: 130,
  name: 'Lampen-Schatten nachts',
  title: 'Lampenlicht stoppt nachts an Wänden und geschlossenen Türen (Schatten)',
  device: 'desktop',
  pc: false,
  realDevice: ['Schritt 6: Flüssigkeit beim Drehen und Zoomen am echten Rechner'],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen, 3D und Realismus einschalten.',
      expected: 'Die Szene lädt ohne Fehlermeldung.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.getByRole('button', { name: 'Realismus' }).click();
        await t.page.waitForTimeout(3000);
        const on = (await t.page.getByRole('button', { name: 'Realismus' }).getAttribute('aria-pressed')) === 'true';
        const ls = await lights(t);
        return { status: on && ls.length > 0 ? 'ok' : 'fail', observed: `Realismus an: ${on}; ${ls.length} Lichtquellen in der Szene (${ls.map((l) => l.type).join(', ')}); Fehler in der Browser-Konsole bricht der Lauf automatisch ab (keine gemeldet).` };
      },
    },
    {
      nr: 2,
      action: 'Tageszeit auf etwa 23:30, unter ⋯ › Licht die Lampen auf „An“.',
      expected: 'Die Stehlampe im Wohnzimmer leuchtet ihren Raum aus.',
      async run(t) {
        await setTime(t, 23.5);
        await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
        await t.page.locator('#toolbar-menu-more').getByLabel('Lampen', { exact: true }).selectOption('on');
        await t.page.keyboard.press('Escape');
        await t.page.waitForTimeout(2500);
        const lamps = (await t.project()).settings.lamps;
        const ls = await lights(t);
        const pts = ls.filter((l) => l.type === 'PointLight' || l.type === 'SpotLight');
        const sh = pts.filter((l) => l.shadow).length;
        t.sh = sh;
        const lamp = (await t.project()).furniture.find((f) => f.catalogId === 'generic-floor-lamp');
        await t.lookAt({ x: lamp.x + 2.2, y: 2.2, z: lamp.y + 2.8 }, { x: lamp.x, y: 0.9, z: lamp.y });
        await t.page.waitForTimeout(1500);
        await t.shot('130-lampe-nacht');
        return { status: lamps === 'on' && pts.length > 0 ? 'look' : 'fail', observed: `Zeit 23:30 und Lampen „${lamps}“; ${pts.length} Punkt-/Spotlichter in der Szene, davon ${sh} mit Schatten (Hinweis im Issue: höchstens 6). Ob die Stehlampe ihren Raum sichtbar ausleuchtet, zeigt der Screenshot 130-lampe-nacht.` };
      },
    },
    {
      nr: 3,
      action: 'Ansicht drehen, auf die Wand zwischen Wohn- und Schlafzimmer und den Boden vor der Wohnung schauen.',
      expected: 'Hinter den Wänden kommt kein Lichtschein der Lampe an; der Boden draußen bleibt dunkel.',
      async run(t) {
        await t.lookAt({ x: 9, y: 3.5, z: 6.5 }, { x: 5, y: 1.2, z: 2.5 });
        await t.page.waitForTimeout(1500);
        await t.shot('130-wand');
        return { status: 'look', observed: 'Ob hinter der Wand und draußen kein Lichtschein sichtbar ist, ist eine Bildbeurteilung: Screenshots 130-wand (und 130-lampe-nacht). Software-Grafik im Test, Schatten können dort anders aussehen als auf deiner Grafikkarte.' };
      },
    },
    {
      nr: 4,
      action: 'Die Zimmertür öffnen und schließen (Tür anklicken, Taste O).',
      expected: 'Bei offener Tür fällt Licht in den Nachbarraum, bei geschlossener nicht.',
      async run(t) {
        const p = await t.project();
        const nodes = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
        const door = p.openings.find((o) => o.kind === 'door' && p.walls.some((w) => w.id === o.wallId && Math.abs(nodes[w.a].x - 5) < 0.2 && Math.abs(nodes[w.b].x - 5) < 0.2));
        await t.page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'opening', id }), door.id);
        const was = door.open;
        await t.page.keyboard.press('o');
        await t.page.waitForTimeout(800);
        const now = (await t.project()).openings.find((o) => o.id === door.id).open;
        await t.shot(`130-tuer-${now ? 'offen' : 'zu'}`);
        await t.page.keyboard.press('o');
        await t.page.waitForTimeout(800);
        const back = (await t.project()).openings.find((o) => o.id === door.id).open;
        await t.shot(`130-tuer-${back ? 'offen' : 'zu'}`);
        return { status: 'look', observed: `Taste O schaltet die Tür: vorher ${was ? 'offen' : 'zu'}, danach ${now ? 'offen' : 'zu'}, dann ${back ? 'offen' : 'zu'} (Tür per Auswahl gesetzt). Wie das Licht im Nachbarraum dabei aussieht, steht in den Screenshots 130-tuer-offen und 130-tuer-zu.` };
      },
    },
    {
      nr: 5,
      action: 'Die Stehlampe direkt an die Wand zum Nachbarraum ziehen.',
      expected: 'Auf der anderen Seite der Wand bleibt es dunkel, auch an der Ecke.',
      async run(t) {
        const lamp = (await t.project()).furniture.find((f) => f.catalogId === 'generic-floor-lamp');
        await t.page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => { const f = d.furniture.find((q) => q.id === id); f.x = 4.8; }), lamp.id);
        await t.page.waitForTimeout(1500);
        await t.lookAt({ x: 8.5, y: 3.2, z: lamp.y + 4 }, { x: 5.5, y: 1, z: lamp.y });
        await t.page.waitForTimeout(1200);
        await t.shot('130-lampe-an-wand');
        return { status: 'look', observed: `Stehlampe bei x = 4,8 m (Wand zum Schlafzimmer bei x = 5 m; per Store gesetzt, nicht gezogen). Ob dahinter dunkel bleibt, zeigt der Screenshot 130-lampe-an-wand.` };
      },
    },
    {
      nr: 6,
      action: 'Mit der Maus die Ansicht drehen und zoomen.',
      expected: 'So flüssig wie vorher.',
      async run(t) {
        const f0 = await t.page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(n / 1.5); }; requestAnimationFrame(tick); }));
        return { status: 'device', observed: `Im Test (Software-Grafik ohne Grafikkarte) laufen ca. ${Math.round(f0)} Bilder pro Sekunde; das sagt nichts über deine Grafikkarte. Das Gefühl „so flüssig wie vorher“ lässt sich nur am echten Rechner beurteilen.` };
      },
    },
    {
      nr: 7,
      action: 'Den Regler auf 13:00 und auf 19:00 stellen.',
      expected: 'Tag- und Abendlicht sehen aus wie vorher.',
      async run(t) {
        await t.lookAt({ x: 9, y: 6, z: 7.5 }, { x: 3.5, y: 0.5, z: 2.2 });
        for (const h of [13, 19]) {
          await setTime(t, h);
          await t.page.waitForTimeout(2000);
          await t.shot(`130-${h}-uhr`);
        }
        return { status: 'look', observed: 'Zeit auf 13:00 und 19:00 gestellt, Screenshots 130-13-uhr und 130-19-uhr aufgenommen. „Wie vorher“ braucht den Vergleich mit dem früheren Stand und ist eine Bildbeurteilung.' };
      },
    },
  ],
};
