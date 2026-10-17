// Engstellen: Warnung bei zu schmalen Durchgängen (#68) – Testschritte aus dem Kommentar in #68.
const plan = (t) => t.page.locator('[data-testid="editor2d"]');
const left = (t) => t.page.locator('.panel.left');
/** 2D markers with their width and end points (plan metres). */
const markers = (t) =>
  plan(t)
    .locator('[data-testid="narrow-passage"]')
    .evaluateAll((gs) =>
      gs.map((g) => {
        const l = g.querySelector('line');
        const n = (k) => Number(l.getAttribute(k));
        return { cm: Number(g.dataset.widthCm), kind: g.dataset.kind, a: { x: n('x1'), y: n('y1') }, b: { x: n('x2'), y: n('y2') } };
      }),
    );
const markers3d = (t) => t.page.evaluate(() => window.__wp.three?.scene?.getObjectByName('narrow-passages')?.children.length ?? -1);
const list = (ms) => ms.map((m) => `${m.cm} cm`).join(', ') || 'keine';
/** Distance (m) from a plan point to a furniture footprint (rotation 0 or 90°, like the sample). */
function distTo(f, p) {
  const r = (((f.rotation ?? 0) % Math.PI) + Math.PI) % Math.PI;
  const [w, d] = Math.abs(r - Math.PI / 2) < 0.01 ? [f.depth, f.width] : [f.width, f.depth];
  return Math.hypot(Math.max(Math.abs(p.x - f.x) - w / 2, 0), Math.max(Math.abs(p.y - f.y) - d / 2, 0));
}
const touching = (fs, p) => fs.filter((f) => distTo(f, p) < 0.02).map((f) => f.name);

async function openGroup(t) {
  const field = left(t).getByRole('textbox', { name: 'Durchgang mindestens cm' });
  if (!(await field.isVisible().catch(() => false))) await left(t).getByRole('button', { name: 'Engstellen' }).click();
  return field;
}
async function setMin(t, cm) {
  const field = await openGroup(t);
  await field.fill(String(cm));
  await field.press('Enter');
}

export default {
  issue: 68,
  name: 'Engstellen',
  title: 'Mindestbreiten prüfen: Warnung bei zu schmalen Durchgängen (z. B. 90 cm für Rollstuhl)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Beispielwohnung öffnen. Links unter „Werkzeuge“ den Abschnitt „Durchgänge“ ansehen.',
      expected: '„Durchgang mindestens 90 cm“ mit dem Hinweis „Richtwert, keine Norm“; „Engstellen anzeigen“ ist eingeschaltet. Im Schlafzimmer zeigt eine rote Linie „42 cm“ zwischen Bett und rechter Wand.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const field = await openGroup(t);
        const value = await field.inputValue();
        const hint = await left(t).getByText(/Richtwert, keine Norm/).count();
        const on = await left(t).getByLabel('Engstellen anzeigen').isChecked();
        const ms = await markers(t);
        const p = await t.project();
        const bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        const m42 = ms.find((m) => m.cm === 42);
        const atBed = m42 && (touching([bed], m42.a).length || touching([bed], m42.b).length);
        const bedroom = p.rooms.find((r) => r.name === 'Schlafzimmer');
        return {
          status: value === '90' && hint && on && m42 && atBed ? 'ok' : 'fail',
          observed: `Der Abschnitt heißt jetzt „Engstellen“ (seit #122 eingeklappt, hier aufgeklappt). „Durchgang mindestens“: ${value} cm, Hinweis „Richtwert, keine Norm“ ${hint ? 'da' : 'fehlt'}, „Engstellen anzeigen“ ${on ? 'eingeschaltet' : 'aus'}. Rote Linien im Plan: ${list(ms)}${m42 ? `; die 42-cm-Linie geht ${atBed ? 'vom Bett' : 'nicht vom Bett'} zur ${m42.kind === 'wall' ? 'Wand' : m42.kind}` : ''}.${bedroom ? '' : ' (Raum „Schlafzimmer“ nicht gefunden)'}`,
        };
      },
    },
    {
      nr: 2,
      action: 'Den Kleiderschrank zum Bett ziehen.',
      expected: 'Während des Ziehens sind keine Markierungen zu sehen. Nach dem Loslassen erscheint eine rote Linie mit der Breite in cm, wenn weniger als 90 cm frei bleiben.',
      async run(t) {
        const { page } = t;
        const p = await t.project();
        const wardrobe = p.furniture.find((f) => f.catalogId === 'generic-wardrobe-150');
        const bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        // leave about 60 cm between bed and wardrobe
        const ty = bed.y + bed.depth / 2 + 0.6 + wardrobe.depth / 2;
        const s = await t.planToScreen(wardrobe.x, wardrobe.y);
        const e = await t.planToScreen(wardrobe.x, ty);
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await page.mouse.move(s.x, (s.y + e.y) / 2, { steps: 6 });
        await page.mouse.move(e.x, e.y, { steps: 6 });
        await page.waitForTimeout(300);
        const during = await markers(t);
        await t.shot('Während des Ziehens (Maus noch gedrückt)');
        await page.mouse.up();
        await page.waitForTimeout(300);
        const after = await markers(t);
        const moved = await t.furniture((f) => f.id === wardrobe.id);
        const gap = moved.y - moved.depth / 2 - (bed.y + bed.depth / 2);
        const between = after.find((m) => {
          const names = [...touching([bed, moved], m.a), ...touching([bed, moved], m.b)];
          return names.includes(bed.name) && names.includes(moved.name);
        });
        t.betweenCm = between?.cm;
        return {
          status: during.length === 0 && between && between.cm < 90 && Math.abs(between.cm - Math.round(gap * 100)) <= 1 ? 'ok' : 'fail',
          observed: `Kleiderschrank Richtung Bett gezogen, danach ${Math.round(gap * 100)} cm frei. Rote Linien während des Ziehens: ${list(during)}. Nach dem Loslassen: ${list(after)}${between ? ` – zwischen Bett und Kleiderschrank „${between.cm} cm“` : ' – keine Linie zwischen Bett und Kleiderschrank'}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Den Wert auf 60 cm stellen.',
      expected: 'Engstellen ab 60 cm verschwinden, die 42 cm bleiben.',
      async run(t) {
        const before = await markers(t);
        await setMin(t, 60);
        await t.page.waitForTimeout(300);
        const after = await markers(t);
        const ok = after.every((m) => m.cm < 60) && after.some((m) => m.cm === 42) && before.some((m) => m.cm >= 60);
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Vorher: ${list(before)}. Bei 60 cm: ${list(after)}.`,
        };
      },
    },
    {
      nr: 4,
      action: '3D (Übersicht, „Schnitt“ an) öffnen.',
      expected: 'An den Engstellen liegt ein roter Streifen am Boden.',
      async run(t) {
        const { page } = t;
        // with 60 cm only the 42 cm spot is left; back to 90 cm so the bed/wardrobe spot shows too
        await setMin(t, 90);
        const n2d = (await markers(t)).length;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        const cut = page.getByRole('button', { name: 'Schnitt' });
        if ((await cut.getAttribute('aria-pressed')) !== 'true') await cut.click();
        const n3d = await t.poll(async () => {
          const n = await markers3d(t);
          return n > 0 ? n : null;
        }, 8000);
        const red = await page.evaluate(() => {
          const g = window.__wp.three.scene.getObjectByName('narrow-passages');
          let c = null;
          g?.traverse((o) => {
            if (!c && o.material?.color) c = o.material.color.getHexString();
          });
          return c;
        });
        // look from above at the bedroom
        const p = await t.project();
        const bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        await t.lookAt({ x: bed.x - 1.5, y: 5.5, z: bed.y + 3.5 }, { x: bed.x, y: 0, z: bed.y + 0.8 });
        await page.waitForTimeout(1200);
        return {
          status: n3d === n2d && red === 'dc2626' ? 'ok' : 'fail',
          observed: `Mindestbreite wieder auf 90 cm gestellt (sonst bliebe nur eine Stelle). Engstellen im 2D-Plan: ${n2d}, rote Bodenstreifen in 3D: ${n3d ?? 0}, Farbe #${red ?? '–'}. „Schnitt“ ist an.`,
          caption: '3D-Übersicht mit Schnitt: rote Streifen am Boden',
        };
      },
    },
    {
      nr: 5,
      action: '„Engstellen anzeigen“ ausschalten.',
      expected: 'Alle Markierungen in 2D und 3D sind weg.',
      async run(t) {
        const { page } = t;
        await openGroup(t);
        await left(t).getByLabel('Engstellen anzeigen').uncheck();
        const n3d = await t.poll(async () => ((await markers3d(t)) === 0 ? 0 : null), 4000);
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const n2d = (await markers(t)).length;
        return {
          status: n3d === 0 && n2d === 0 ? 'ok' : 'fail',
          observed: `Ausgeschaltet: rote Streifen in 3D ${n3d ?? (await markers3d(t))}, rote Linien in 2D ${n2d}.`,
        };
      },
    },
    {
      nr: 6,
      action: 'Sofa und Couchtisch sowie Möbel direkt an der Wand ansehen.',
      expected: 'Sie werden nicht markiert.',
      async run(t) {
        await left(t).getByLabel('Engstellen anzeigen').check();
        await t.page.waitForTimeout(300);
        const ms = await markers(t);
        const p = await t.project();
        const sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3');
        const table = p.furniture.find((f) => f.catalogId === 'generic-coffee-table');
        const sofaTable = ms.filter((m) => {
          const names = [...touching([sofa, table], m.a), ...touching([sofa, table], m.b)];
          return names.includes(sofa.name) && names.includes(table.name);
        });
        // furniture standing at a wall would show up as a line of (almost) 0 cm
        const tiny = ms.filter((m) => m.cm < 5);
        const desc = ms.map((m) => `${m.cm} cm (${[...new Set([...touching(p.furniture, m.a), ...touching(p.furniture, m.b)])].join(' – ') || m.kind})`).join(', ');
        return {
          status: !sofaTable.length && !tiny.length ? 'ok' : 'fail',
          observed: `Anzeige wieder eingeschaltet (90 cm). Markiert: ${desc || 'nichts'}. Zwischen Sofa und Couchtisch: ${sofaTable.length ? 'markiert' : 'nicht markiert'}. Möbel direkt an der Wand (Linie unter 5 cm): ${tiny.length ? `markiert (${list(tiny)})` : 'nicht markiert'}.`,
        };
      },
    },
    {
      nr: 7,
      action: 'Passt die Einschätzung für deine echte Wohnung?',
      expected: 'Keine Stellen, die fälschlich markiert werden oder fehlen (Auffälligkeiten bitte hier notieren).',
      async run() {
        return { status: 'device', observed: 'Nur mit deiner eigenen Wohnung beurteilbar – bitte selbst in deinem Projekt ansehen.', noFinalShot: true };
      },
    },
  ],
};
