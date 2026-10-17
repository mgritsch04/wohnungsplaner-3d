// Grafik realistischer (#192): Glas, Boden, Spiegelungen je Tageszeit, Grafikstufe – Testschritte aus dem Kommentar in #192.
const canvas = (t) => t.page.locator('[data-testid="scene3d"] canvas');
const tierSelect = (t) => t.page.getByLabel('Grafikqualität');
const WINDOW = { x: 2.5, y: 1.5, z: 0 }; // living-room window, north wall (1,8 m wide)
const HANDLE = { x: 5.06, y: 1.05, z: 2 }; // door between living room and bedroom

async function openMore(t) {
  if (!(await tierSelect(t).isVisible().catch(() => false))) await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await tierSelect(t).waitFor({ timeout: 5000 });
}
async function closeMore(t) {
  await t.page.keyboard.press('Escape');
  await t.page.waitForTimeout(200);
  if (await tierSelect(t).isVisible().catch(() => false)) await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await t.page.waitForTimeout(200);
}
async function setTime(t, hour) {
  await t.page.evaluate((h) => window.__wp.useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = h)), hour);
  await t.page.waitForTimeout(2500); // the reflection map is rebuilt for the new time
}
async function view(t, position, target) {
  await t.lookAt(position, target);
  await t.page.waitForTimeout(2000);
}
/** Mean brightness (0–255) and colour of the 3D picture. */
async function brightness(t) {
  const png = (await canvas(t).screenshot({ type: 'png' })).toString('base64');
  return t.page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((img.height / img.width) * 160);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gr = 0, bl = 0;
    for (let i = 0; i < d.length; i += 4) [r, gr, bl] = [r + d[i], gr + d[i + 1], bl + d[i + 2]];
    const n = d.length / 4;
    return { l: Math.round((0.2126 * r + 0.7152 * gr + 0.0722 * bl) / n), r: Math.round(r / n), g: Math.round(gr / n), b: Math.round(bl / n) };
  }, png);
}
const fpsText = async (t) => Number(((await t.page.locator('footer').innerText()).match(/(\d+) FPS/) ?? [])[1] ?? NaN);
/** Frames per second over `ms`, measured in the page (plus the longest gap between two frames). */
const measureFps = (t, ms = 3000) =>
  t.page.evaluate(
    (dur) =>
      new Promise((res) => {
        const times = [];
        const t0 = performance.now();
        const tick = (now) => {
          times.push(now);
          if (now - t0 < dur) requestAnimationFrame(tick);
          else if (times.length < 2) res({ fps: 0, maxGap: Math.round(now - t0) });
          else {
            const gaps = times.slice(1).map((x, i) => x - times[i]);
            res({ fps: Math.round(((times.length - 1) * 1000) / (times.at(-1) - times[0])), maxGap: Math.round(Math.max(...gaps)) });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

export default {
  issue: 192,
  name: 'Grafik realistischer',
  title: 'Grafik realistischer machen – zuerst Plan erarbeiten',
  device: 'desktop',
  pc: true, // beurteilt Glas, Boden und Spiegelungen in 3D
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, oben „3D“ und dann „Realismus“ wählen.',
      expected: 'Die 3D-Ansicht zeigt den Realismusmodus ohne Fehlermeldung, Helligkeit wie bisher.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('group', { name: 'Qualität' }).getByRole('button', { name: 'Realismus' }).click();
        await canvas(t).waitFor({ timeout: 20000 });
        await page.waitForTimeout(4000);
        const realism = (await t.project()).settings.quality === 'realism';
        const error = await page.getByRole('alert').count();
        const b = await brightness(t);
        t.overview = b;
        return {
          status: realism && !error ? 'look' : 'fail',
          observed: `Realismusmodus ${realism ? 'an' : 'nicht an'}, Fehlermeldung: ${error ? 'ja' : 'keine'}. Mittlere Bildhelligkeit ${b.l} von 255 (Tageszeit ${(await t.project()).settings.timeOfDay} Uhr). Ob die Helligkeit wie bisher ist, bitte am Bild beurteilen.`,
          caption: 'Realismus, Übersicht',
        };
      },
    },
    {
      nr: 2,
      action: 'Oben „Mehr“ öffnen und unter „Licht (Realismus)“ das Feld „Grafik“ ansehen.',
      expected: 'Auf dem PC mit Grafikkarte steht „Grafik: automatisch (hoch)“.',
      async run(t) {
        await openMore(t);
        const text = (await tierSelect(t).locator('option:checked').textContent()).trim();
        const heading = await t.page.getByText('Licht (Realismus)').count();
        await t.shot('Menü „Mehr“ mit dem Feld „Grafik“');
        await closeMore(t);
        return {
          status: heading && text.includes('Grafik: automatisch (hoch)') ? 'ok' : 'fail',
          observed: `Unter „Licht (Realismus)“ steht: „${text}“.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'Tageszeit „Mittag (13:00)“ wählen und im Wohnzimmer von innen auf das Fenster schauen.',
      expected: 'Das Fensterglas ist durchsichtig und zeigt eine leichte Spiegelung, schräg angesehen stärker als von vorn.',
      async run(t) {
        await openMore(t);
        await t.page.getByLabel('Tageszeit-Voreinstellung').selectOption({ label: 'Mittag (13:00)' });
        await closeMore(t);
        await t.page.waitForTimeout(2500);
        const hour = (await t.project()).settings.timeOfDay;
        await view(t, { x: 2.5, y: 1.5, z: 2.6 }, WINDOW);
        await t.shot('Fenster von vorn (13:00)');
        await view(t, { x: 0.5, y: 1.4, z: 1.2 }, WINDOW);
        await t.shot('Fenster schräg (13:00)');
        return {
          status: hour === 13 ? 'look' : 'fail',
          observed: `Tageszeit ${hour} Uhr. Fenster im Wohnzimmer von vorn (2,6 m Abstand) und schräg von links fotografiert. Durchsicht und Spiegelung bitte an den Bildern beurteilen.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Den Holzboden aus der Nähe und schräg ansehen.',
      expected: 'Fugen und Maserung wirken matter als die Dielenflächen, ein leichtes Relief ist zu sehen, und der Boden ist nicht heller oder dunkler als vorher.',
      async run(t) {
        await view(t, { x: 1.0, y: 0.6, z: 3.2 }, { x: 2.2, y: 0, z: 2.2 });
        const b = await brightness(t);
        return {
          status: 'look',
          observed: `Holzboden im Wohnzimmer aus 60 cm Höhe schräg fotografiert (mittlere Helligkeit ${b.l} von 255). Fugen, Maserung und Relief bitte am Bild beurteilen.`,
          caption: 'Holzboden schräg aus der Nähe (13:00)',
        };
      },
    },
    {
      nr: 5,
      action: 'Die Tageszeit auf „Sonnenuntergang (19:30)“ und dann auf „Nacht (23:30)“ stellen und dabei Boden, Glas und einen Türgriff ansehen. Danach den Tageszeit-Regler langsam ziehen.',
      expected: 'Spiegelungen und Glanz werden bei Sonnenuntergang wärmer und sind nachts dunkel mit warmem Lampenlicht. Metall wirkt nicht kupferfarben, und der Regler ruckelt nicht.',
      async run(t) {
        const { page } = t;
        const colours = [];
        for (const [label, hour] of [['Mittag', 13], ['Sonnenuntergang', 19.5], ['Nacht', 23.5]]) {
          await setTime(t, hour);
          await view(t, { x: 1.2, y: 1.2, z: 2.8 }, { x: 2.5, y: 0.6, z: 0.2 });
          const b = await brightness(t);
          colours.push(`${label}: Helligkeit ${b.l}, Rot/Blau ${(b.r / Math.max(1, b.b)).toFixed(2).replace('.', ',')}`);
          await t.shot(`Boden und Fenster – ${label}`);
          await view(t, { x: 4.3, y: 1.15, z: 2.4 }, HANDLE);
          await t.shot(`Türgriff – ${label}`);
        }
        // drag the time slider slowly and measure the frame rate meanwhile
        await setTime(t, 15);
        const slider = page.getByLabel('Tageszeit', { exact: true });
        const box = await slider.boundingBox();
        const measuring = measureFps(t, 3500);
        await page.mouse.move(box.x + box.width * (15 / 24), box.y + box.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 30; i++) {
          await page.mouse.move(box.x + box.width * ((15 + (i / 30) * 6) / 24), box.y + box.height / 2);
          await page.waitForTimeout(100);
        }
        await page.mouse.up();
        const f = await measuring;
        const smooth = f.fps >= 45 && f.maxGap < 120;
        return {
          status: smooth ? 'look' : 'fail',
          observed: `Bild auf Boden und Fenster (Rot/Blau über 1 = wärmer) – ${colours.join('; ')}. Beim langsamen Ziehen des Reglers von 15 auf 21 Uhr: ${f.fps} Bilder pro Sekunde, längste Pause zwischen zwei Bildern ${f.maxGap} ms (${smooth ? 'ruckelt nicht' : 'ruckelt'}). Wärme der Spiegelungen und Farbe des Türgriffs bitte an den Bildern beurteilen.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 6,
      action: 'Unter „Mehr“ erst „Grafik: normal“, dann „Grafik: hoch“ und dann wieder „automatisch“ wählen; dabei die FPS-Anzeige unten in der Statusleiste ansehen.',
      expected: 'Das Umschalten klappt ohne Fehler, und auch mit „hoch“ bleibt die Bildrate flüssig (etwa 50 FPS oder mehr).',
      async run(t) {
        await setTime(t, 13);
        await view(t, { x: 1.0, y: 1.6, z: 3.5 }, { x: 3, y: 0.8, z: 1 });
        const out = [];
        let low = false;
        for (const [value, name] of [['normal', 'normal'], ['high', 'hoch'], ['auto', 'automatisch']]) {
          await openMore(t);
          await tierSelect(t).selectOption(value);
          await closeMore(t);
          await t.page.waitForTimeout(2500);
          const f = await measureFps(t, 3000);
          const shown = await fpsText(t);
          if (value === 'high' && !(f.fps >= 50)) low = true;
          out.push(`„${name}“: ${f.fps} FPS gemessen, Statusleiste ${Number.isNaN(shown) ? '–' : shown} FPS`);
        }
        return {
          status: low ? 'fail' : 'ok',
          observed: `${out.join('; ')}.`,
        };
      },
    },
    {
      nr: 7,
      optional: true,
      action: 'Optional: Die App auf dem Handy öffnen, unter „Mehr“ „Realismus“ wählen, das Feld „Grafik“ ansehen und die 3D-Ansicht drehen.',
      expected: 'Dort steht „Grafik: automatisch (normal)“, und das Drehen ist so flüssig wie vor dieser Änderung.',
      async run() {
        return { status: 'skip', observed: 'Optionaler Handy-Schritt, hier nicht geprüft.', noFinalShot: true };
      },
    },
  ],
};
