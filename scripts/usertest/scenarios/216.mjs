// Um 0 Uhr ist der Raum ohne Lampen dunkel (#216) – Testschritte aus dem Kommentar in #216.
const lights = (t) =>
  t.page.evaluate(() => {
    let n = 0;
    window.__wp.three.scene.traverse((o) => void ((o.isPointLight || o.isSpotLight) && o.visible !== false && o.intensity > 0.01 && n++));
    return n;
  });
const lightSum = (t) =>
  t.page.evaluate(() => {
    let n = 0;
    window.__wp.three.scene.traverse((o) => void ((o.isPointLight || o.isSpotLight) && o.visible !== false && (n += o.intensity)));
    return n;
  });
const reflections = (t) =>
  t.page.evaluate(() => {
    let max = 0;
    window.__wp.three.scene.traverse((o) => {
      for (const m of [o.material].flat()) if (m?.envMap) max = Math.max(max, m.envMapIntensity);
    });
    return max;
  });
const setHour = async (t, h) => {
  await t.page.evaluate((x) => window.__wp.useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = x)), h);
  await t.poll(async () => (Math.abs((await t.page.evaluate(() => window.__wp.lightingHour())) - h) < 0.01 ? 1 : null), 60000);
  const f0 = await t.page.evaluate(() => window.__wp.three.gl.info.render.frame);
  await t.poll(async () => ((await t.page.evaluate(() => window.__wp.three.gl.info.render.frame)) - f0 >= 8 ? 1 : null), 60000);
};
const setLamps = async (t, v) => {
  await t.page.evaluate((x) => window.__wp.useProjectStore.getState().apply((d) => void (d.settings.lamps = x)), v);
  await t.page.waitForTimeout(500);
};
const page_wait = (t) => t.page.waitForTimeout(1500);
const luma = async (t) => {
  // only where the apartment is on screen (the dark sky around it would dilute the difference)
  const clip = await t.page.evaluate(() => {
    const wp = window.__wp;
    const p = wp.useProjectStore.getState().project;
    const xs = p.nodes.map((n) => n.x);
    const ys = p.nodes.map((n) => n.y);
    const cam = wp.three.camera;
    const r = wp.three.canvas.getBoundingClientRect();
    const pts = [];
    for (const x of [Math.min(...xs), Math.max(...xs)])
      for (const y of [Math.min(...ys), Math.max(...ys)])
        for (const z of [0, p.settings.defaultWallHeight]) {
          const v = cam.position.clone().set(x, z, y).project(cam);
          pts.push({ x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height });
        }
    const x0 = Math.max(r.left, Math.min(...pts.map((q) => q.x)));
    const y0 = Math.max(r.top, Math.min(...pts.map((q) => q.y)));
    return { x: x0, y: y0, width: Math.min(r.right, Math.max(...pts.map((q) => q.x))) - x0, height: Math.min(r.bottom, Math.max(...pts.map((q) => q.y))) - y0 };
  });
  const png = await t.page.screenshot({ clip });
  return t.page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, png.toString('base64'));
};

export default {
  issue: 216,
  name: 'Nacht ohne Lampen',
  title: 'Bug: Um 0 Uhr ist der Raum beleuchtet, obwohl keine Lampen drin sind',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, „3D“ und „Realismus“ wählen. In einem Raum ohne Stehlampe, Tischlampe oder platzierte Lichtquelle (z. B. Lampen dort löschen) die Tageszeit auf 0:00 stellen, „Lampen: automatisch“.',
      expected: 'Der Raum ist deutlich dunkel. Wände, Boden, Türgriffe und Fensterglas leuchten nicht.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.evaluate(() =>
          window.__wp.useProjectStore.getState().apply((d) => {
            d.settings.quality = 'realism';
            d.settings.lamps = 'auto';
            d.lights = [];
            d.furniture = d.furniture.filter((f) => !(f.model.type === 'procedural' && ['floor-lamp', 'table-lamp', 'pendant'].includes(f.model.shape)));
          }),
        );
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Realismus' }).click().catch(() => undefined);
        await setHour(t, 13);
        t.day = await luma(t);
        t.daySum = await lightSum(t);
        await setHour(t, 0);
        const n = await t.poll(async () => ((await lights(t)) === 0 ? 'ok' : null), 30000);
        const refl = await reflections(t);
        t.night = await luma(t);
        await t.shot('0:00 ohne Lampen');
        return { status: n && refl < 0.05 && t.night < t.day * 0.5 ? 'ok' : 'fail', observed: `Leuchtende Lichtquellen in der Szene: ${await lights(t)}; stärkste Spiegelung (Griffe/Fensterglas) ${refl.toFixed(3)} (Grenze 0,05); mittlere Helligkeit der Wohnung im Bild mittags ${t.day.toFixed(1)}, um 0:00 ${t.night.toFixed(1)}.` };
      },
    },
    {
      nr: 2,
      action: '„Lampen: an“ wählen.',
      expected: 'Der Raum bleibt dunkel, weil dort keine Lampe steht.',
      async run(t) {
        await setLamps(t, 'on');
        const n = await lights(t);
        const l = await luma(t);
        return { status: n === 0 && l < t.day * 0.5 ? 'ok' : 'fail', observed: `Lampen „an“: leuchtende Lichtquellen ${n}; Helligkeit der Wohnung im Bild ${l.toFixed(1)} (mittags ${t.day.toFixed(1)}).` };
      },
    },
    {
      nr: 3,
      action: 'In denselben Raum eine Stehlampe aus dem Katalog stellen.',
      expected: 'Die Lampe leuchtet warm, der Raum wird um sie herum hell, Griffe glänzen wieder leicht.',
      async run(t) {
        const { page } = t;
        await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
        await page.getByLabel('Katalog durchsuchen').fill('Stehlampe');
        const before = (await t.project()).furniture.length;
        await page.locator('.catalog-item', { hasText: /Stehlampe/ }).first().click();
        await t.poll(async () => ((await t.project()).furniture.length > before ? 1 : null), 5000);
        const f = (await t.project()).furniture.at(-1);
        await page.waitForTimeout(2500);
        const n = await t.poll(async () => ((await lights(t)) > 0 ? await lights(t) : null), 30000);
        const refl = await reflections(t);
        const l = await luma(t);
        await t.shot('Stehlampe leuchtet');
        const warm = await page.evaluate(() => {
          let c = null;
          window.__wp.three.scene.traverse((o) => void ((o.isPointLight || o.isSpotLight) && o.intensity > 0.01 && (c = c ?? o.color)));
          return c ? { r: c.r, g: c.g, b: c.b } : null;
        });
        return { status: n && warm && warm.r > warm.b && refl > 0.05 && l > t.night ? 'ok' : 'fail', observed: `„${f.name}“ gestellt; leuchtende Lichtquellen ${n ?? 0}, Lichtfarbe warm (R>B): ${warm ? `${warm.r.toFixed(2)}/${warm.b.toFixed(2)}` : '–'}; Spiegelungen wieder ${refl.toFixed(2)}; Helligkeit der Wohnung im Bild ${l.toFixed(1)} (ohne Lampe ${t.night.toFixed(1)}).` };
      },
    },
    {
      nr: 4,
      action: 'Tageszeit auf „Mittag (13:00)“ stellen.',
      expected: 'Der Raum ist wie gewohnt taghell, die Lampe ist aus (bei „automatisch“).',
      async run(t) {
        await setLamps(t, 'auto');
        await setHour(t, 13);
        await page_wait(t);
        const sum = await lightSum(t);
        const l = await luma(t);
        return { status: Math.abs(sum - t.daySum) / t.daySum < 0.05 && l > t.night * 2 && Math.abs(l - t.day) / t.day < 0.35 ? 'ok' : 'fail', observed: `Mittags, Lampen „automatisch“: Summe der Lichtstärken ${sum.toFixed(2)} (mittags ohne Lampe ${t.daySum.toFixed(2)} – gleich heißt: Stehlampe trägt nichts bei, nur das Tageslicht-Füllicht); Helligkeit der Wohnung im Bild ${l.toFixed(1)} (erste Messung mittags ${t.day.toFixed(1)}, nachts ${t.night.toFixed(1)}).` };
      },
    },
  ],
};
