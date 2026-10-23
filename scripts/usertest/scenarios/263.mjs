// Begehen: Räume wirken realistisch groß – „Gefühlt echt“ (#263, setzt #256 fort) – Testschritte aus dem Kommentar in #263.
const fovOf = (t) => t.page.evaluate(() => window.__wp.three?.camera.fov ?? NaN);
const toggle = (t) => t.page.locator('.toolbar').getByRole('button', { name: 'Gefühlt echt' });
const look = (t, yaw, pitch) => t.page.evaluate(([y, p]) => window.__wp.walk.look(y, p), [yaw, pitch]);
/** Blick auf einen Punkt der Wohnung (Weltkoordinaten x, Höhe, y) aus der aktuellen Kameraposition. */
const lookAt = (t, x, h, y) =>
  t.page.evaluate(([tx, th, ty]) => {
    const c = window.__wp.three.camera.position;
    const dist = Math.hypot(tx - c.x, ty - c.z);
    window.__wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, dist));
  }, [x, h, y]);
const readout = async (t) => (await t.page.getByTestId('aim-readout').innerText().catch(() => '')).replace(/\n/g, ' ').trim();

export default {
  issue: 263,
  name: 'Gefühlt echt',
  title: 'Begehen: Räume wirken realistisch groß, nicht nur Gänge (Echt-Maßstab weiterentwickeln)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'In 3D auf „Begehen“ gehen und oben auf „Gefühlt echt“ klicken.',
      expected: 'Das Sichtfeld wechselt auf 62°, der Raum ist ganz zu sehen und wirkt nicht wie durch ein Fenster.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        const f0 = await t.poll(async () => { const f = await fovOf(t); return Number.isFinite(f) ? f : null; });
        const was = await toggle(t).getAttribute('aria-pressed');
        await toggle(t).click();
        await page.waitForTimeout(400);
        const f1 = await fovOf(t);
        const now = await toggle(t).getAttribute('aria-pressed');
        await t.shot('Begehen mit „Gefühlt echt“ (62°)');
        return { status: f0 === 50 && was === 'false' && now === 'true' && f1 === 62 ? 'look' : 'fail', observed: `Sichtfeld ${f0}° → ${f1}° (Knopf ${was} → ${now}). Der Eindruck „wirkt nicht wie durch ein Fenster“ ist eine Bildbewertung und bleibt bei G.` };
      },
    },
    {
      nr: 2,
      action: 'Auf ein Möbelstück, ein Fenster und eine Wand schauen.',
      expected: 'Unter dem Fadenkreuz stehen Name, Höhe und Entfernung; bei Fenster Höhe und Brüstung; bei Tür Höhe und Breite; bei Wand/Boden Entfernung und Höhe des Punkts.',
      async run(t) {
        const p = await t.project();
        const sofa = p.furniture.find((f) => /Sofa/.test(f.name)) ?? p.furniture[0];
        await lookAt(t, sofa.x, sofa.elevation + sofa.height * 0.6, sofa.y);
        await t.page.waitForTimeout(500);
        const r1 = await readout(t);
        const win = p.openings.find((o) => o.kind === 'window');
        const wall = p.walls.find((w) => w.id === win.wallId);
        const node = (id) => p.nodes.find((n) => n.id === id);
        const a = node(wall.a), b = node(wall.b);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const u = (win.offset ?? win.position) / len;
        await lookAt(t, a.x + (b.x - a.x) * u, (win.sill ?? 0.9) + 0.5, a.y + (b.y - a.y) * u);
        await t.page.waitForTimeout(500);
        const r2 = await readout(t);
        await t.page.evaluate(() => window.__wp.walk.look(0, -0.5));
        await t.page.waitForTimeout(500);
        const r3 = await readout(t);
        const ok1 = /m hoch/.test(r1) && /m entfernt/.test(r1);
        const ok2 = /m/.test(r2) && /(Brüstung|Fenster)/i.test(r2);
        const ok3 = /m entfernt/.test(r3);
        return { status: ok1 && ok2 && ok3 ? 'ok' : 'fail', observed: `Möbel: „${r1}“; Fenster: „${r2}“; Boden: „${r3}“.` };
      },
    },
    {
      nr: 3,
      action: 'Türen und Durchgänge in Sichtweite zeigen oben ihre Durchgangshöhe; durch Wände hindurch erscheinen keine Schilder.',
      expected: 'Schilder „↕ 2,10 m“ an Türen in Sicht, nicht durch Wände.',
      async run(t) {
        const { page } = t;
        const doors = (await t.project()).openings.filter((o) => o.kind !== 'window').length;
        const visibleLabels = () =>
          page.getByTestId('door-height').evaluateAll((els) => els.filter((e) => {
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e.parentElement ?? e);
            return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && cs.display !== 'none' && cs.visibility !== 'hidden';
          }).map((e) => e.textContent.trim()));
        const setPose = (x, z, yaw) => page.evaluate(([px, pz, y]) => window.__wp.useCameraRig.getState().walk.set({ x: px, z: pz, eye: 1.6, yaw: y, pitch: 0 }), [x, z, yaw]);
        const counts = [];
        const texts = new Set();
        for (let i = 0; i < 16; i++) {
          await setPose(2.5, 2.0, (i * Math.PI) / 8);
          await page.waitForTimeout(350);
          const v = await visibleLabels();
          counts.push(v.length);
          v.forEach((x) => texts.add(x));
        }
        // aus dem Schlafzimmer zur Tür in der Südwand des Wohnzimmers schauen: die Trennwand liegt dazwischen
        const target = { x: 1.2, z: 3.9 };
        await setPose(7.5, 3.5, Math.atan2(-(target.x - 7.5), -(target.z - 3.5)));
        await page.waitForTimeout(600);
        const through = await visibleLabels();
        // welches Schild gehört zu welcher Tür? Bildschirmposition der beiden Türen (Höhe 2,0 m) mit den Schildern vergleichen
        const southScreen = await t.worldToScreen(1.2, 2.0, 3.9);
        const sharedScreen = await t.worldToScreen(5.06, 2.0, 2.0);
        const labelXs = await page.getByTestId('door-height').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
        const nearestSouth = labelXs.filter((l) => Math.hypot(l.x - southScreen.x, l.y - southScreen.y) < Math.hypot(l.x - sharedScreen.x, l.y - sharedScreen.y));
        await t.shot('Blick aus dem Schlafzimmer zur Tür hinter der Trennwand');
        const ok = Math.max(...counts) > 0 && Math.max(...counts) <= doors && counts.some((c) => c === 0) && [...texts].every((s) => /↕ \d,\d\d m/.test(s)) && nearestSouth.length === 0;
        return { status: ok ? 'ok' : 'fail', observed: `Türen im Plan: ${doors}; sichtbare Schilder im Wohnzimmer je Blickrichtung (16 Richtungen): ${counts.join(' ')}; Texte: ${[...texts].join(' | ')}; aus dem Schlafzimmer in Richtung der Tür hinter der Trennwand: ${through.length} Schild(er), davon an der Tür hinter der Wand: ${nearestSouth.length} (das sichtbare gehört zur offenen Tür in der Trennwand).` };
      },
    },
    {
      nr: 4,
      action: 'Mausrad zoomt von 62° aus, Z springt zurück.',
      expected: 'Zoom unter 62°, Z zurück auf 62°.',
      async run(t) {
        const { page } = t;
        const box = await page.locator('canvas').first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(400);
        const z = await fovOf(t);
        await page.keyboard.press('KeyZ');
        await page.waitForTimeout(400);
        const back = await fovOf(t);
        return { status: z < 62 && back === 62 ? 'ok' : 'fail', observed: `Nach Mausrad ${z.toFixed(1)}°, nach Z ${back}°.` };
      },
    },
    {
      nr: 5,
      action: 'Erneut auf „Gefühlt echt“ klicken.',
      expected: 'Das Sichtfeld vom Regler gilt wieder (Standard 50°), die Hinweise verschwinden.',
      async run(t) {
        await toggle(t).click();
        await t.page.waitForTimeout(500);
        const f = await fovOf(t);
        const ro = await t.page.getByTestId('aim-readout').count();
        const dh = await t.page.getByTestId('door-height').count();
        return { status: f === 50 && ro === 0 && dh === 0 ? 'ok' : 'fail', observed: `Sichtfeld ${f}°; Fadenkreuz-Hinweis: ${ro}; Türschilder: ${dh}.` };
      },
    },
    {
      nr: 6,
      action: 'Im Projekt-Panel › Steuerung (3D): Bildschirmdiagonale bei neuen Projekten 27 Zoll, darunter der Hinweis zur engen Echtgröße.',
      expected: '27 Zoll; Hinweis „… nur …° (bildschirmhoch)“ (bei 27 Zoll aus 60 cm etwa 31°).',
      async run(t) {
        const { page } = t;
        await page.evaluate(() => document.exitPointerLock?.());
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.locator('.panel.right').getByRole('button', { name: 'Projekt', exact: true }).click();
        const diag = await page.getByLabel('Bildschirmdiagonale').inputValue().catch(() => '?');
        const txt = await page.locator('.panel.right').innerText();
        const m = txt.match(/zeigt dein Bildschirm nur (\d+)°/);
        const s = (await t.project()).settings;
        return { status: Number(diag) === 27 && s.screenDiagonal === 27 && m ? 'look' : 'fail', observed: `Bildschirmdiagonale ${diag} Zoll (Projekt: ${s.screenDiagonal}), Sitzabstand ${s.viewingDistance} cm; Hinweis: „… nur ${m?.[1]}° …“. Die Gradzahl hängt von der Bildschirmgröße des Testrechners ab (hier ein virtueller Bildschirm), „etwa 31°“ ist deshalb nur am eigenen Gerät nachprüfbar. Hinweis: Das Beispielprojekt ist ein bestehendes Projekt; der Standardwert für neue Projekte wurde über den Projektwert gelesen.` };
      },
    },
    {
      nr: 7,
      action: 'Die Einstellung bleibt nach dem Neuladen erhalten.',
      expected: '„Gefühlt echt“ ist nach dem Neuladen noch an (62°).',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Übersicht' }).click().catch(() => undefined);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await toggle(t).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const saved = (await t.project()).settings.walkTrueScale;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        const f = await t.poll(async () => { const v = await fovOf(t); return v === 62 ? v : null; });
        return { status: saved === true && f === 62 ? 'ok' : 'fail', observed: `Nach dem Neuladen walkTrueScale = ${saved}, Sichtfeld beim Begehen ${f}°.` };
      },
    },
  ],
};
