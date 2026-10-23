// Mehrfachauswahl und schnelle Mausbewegung (#210) – Testschritte aus dem Kommentar in #210.
const half = (f) => (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.depth : f.width) / 2;

export default {
  issue: 210,
  name: 'Mehrfachauswahl, schneller Zug an die Wand',
  title: 'Mehrfachauswahl bleibt bei schneller Mausbewegung vor der Wand stehen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Das Bett anklicken, dann mit Umschalt+Klick beide Nachttische dazuwählen.',
      expected: 'Alle drei sind ausgewählt, rechts steht „3 Möbel ausgewählt …“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const p0 = await t.project();
        t.items = [p0.furniture.find((f) => f.catalogId === 'generic-bed-160'), ...p0.furniture.filter((f) => f.catalogId === 'generic-nightstand')];
        for (const [i, f] of t.items.entries()) {
          const s = await t.planToScreen(f.x, f.y);
          if (i) await page.keyboard.down('Shift');
          await page.mouse.click(s.x, s.y);
          if (i) await page.keyboard.up('Shift');
        }
        const txt = await page.locator('.panel.right').innerText();
        const sel = await t.selection();
        await t.shot('3 Möbel ausgewählt');
        return { status: t.items.length === 3 && /3 Möbel ausgewählt/.test(txt) ? 'ok' : 'fail', observed: `${t.items.length} Möbel gefunden; Panel: „${(txt.match(/\d+ Möbel ausgewählt[^\n]*/) ?? ['–'])[0]}“; Auswahl: ${JSON.stringify(sel)}` };
      },
    },
    {
      nr: 2,
      action: 'Das Bett greifen und die Maus mit einer sehr schnellen Bewegung (ein kurzer Ruck) weit nach links über die Wand hinaus ziehen, dann loslassen.',
      expected: 'Die Auswahl liegt mit ihrem linken Rand direkt an der Wand (kein Spalt von mehreren Zentimetern), kein Möbel steckt in der Wand.',
      async run(t) {
        const { page } = t;
        const bed = t.items[0];
        const a = await t.planToScreen(bed.x, bed.y);
        const b = await t.planToScreen(bed.x - 3, bed.y);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 2 });
        await page.mouse.up();
        const p1 = await t.project();
        t.after = t.items.map((f) => p1.furniture.find((g) => g.id === f.id));
        const leftEdge = Math.min(...t.after.map((f) => f.x - half(f)));
        const startEdge = Math.min(...t.items.map((f) => f.x - half(f)));
        const node = (id) => p1.nodes.find((n) => n.id === id);
        const inner = Math.max(
          ...p1.walls
            .map((w) => ({ w, a: node(w.a), b: node(w.b) }))
            .filter(({ a, b }) => Math.abs(a.x - b.x) < 1e-6 && a.x < startEdge && Math.min(a.y, b.y) < bed.y && Math.max(a.y, b.y) > bed.y)
            .map(({ w, a }) => a.x + w.thickness / 2),
        );
        const gap = leftEdge - inner;
        await t.shot('Auswahl an der Wand');
        return { status: gap >= -0.005 && gap < 0.02 ? 'ok' : 'fail', observed: `Linker Rand der Auswahl x=${leftEdge.toFixed(3)} m, Wandinnenseite x=${inner.toFixed(3)} m, Abstand ${(gap * 100).toFixed(1)} cm (erlaubt: 0 bis 2 cm).` };
      },
    },
    {
      nr: 3,
      action: 'Prüfen, wie die drei Möbel zueinander stehen.',
      expected: 'Alle drei haben sich um dieselbe Strecke bewegt; die Nachttische stehen weiter direkt neben dem Bett, nichts überlappt.',
      async run(t) {
        const dx = t.after.map((f, i) => f.x - t.items[i].x);
        const dy = t.after.map((f, i) => f.y - t.items[i].y);
        const same = dx.every((v) => Math.abs(v - dx[0]) < 0.002) && dy.every((v) => Math.abs(v - dy[0]) < 0.002);
        const marked = (await t.page.evaluate(() => window.__wp.derived?.()?.collisions?.length ?? null).catch(() => null));
        return { status: same ? 'ok' : 'fail', observed: `Verschiebung je Möbel (x): ${dx.map((v) => v.toFixed(3)).join(', ')} m; (y): ${dy.map((v) => v.toFixed(3)).join(', ')} m; gleiche Strecke: ${same}.` };
      },
    },
    {
      nr: 4,
      action: 'Strg+Z drücken.',
      expected: 'Alle drei springen in einem Schritt an ihren vorherigen Platz zurück.',
      async run(t) {
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(300);
        const p = await t.project();
        const back = t.items.every((f) => {
          const g = p.furniture.find((x) => x.id === f.id);
          return Math.abs(g.x - f.x) < 1e-6 && Math.abs(g.y - f.y) < 1e-6;
        });
        return { status: back ? 'ok' : 'fail', observed: `Nach einem Strg+Z stehen alle drei wieder auf den Ausgangspositionen: ${back}.` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Optional: Dasselbe langsam und gleichmäßig ziehen.',
      expected: 'Gleiches Ergebnis wie in Schritt 2 und 3.',
      async run(t) {
        const { page } = t;
        const bed = t.items[0];
        const a = await t.planToScreen(bed.x, bed.y);
        const b = await t.planToScreen(bed.x - 3, bed.y);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 60 });
        await page.mouse.up();
        const p1 = await t.project();
        const aft = t.items.map((f) => p1.furniture.find((g) => g.id === f.id));
        const leftEdge = Math.min(...aft.map((f) => f.x - half(f)));
        const dx = aft.map((f, i) => f.x - t.items[i].x);
        const same = dx.every((v) => Math.abs(v - dx[0]) < 0.002);
        const refGap = Math.min(...t.after.map((f) => f.x - half(f)));
        return { status: same && Math.abs(leftEdge - refGap) < 0.01 ? 'ok' : 'fail', observed: `Langsam: linker Rand ${leftEdge.toFixed(3)} m (schnell: ${refGap.toFixed(3)} m), gleiche Strecke für alle: ${same}.` };
      },
    },
  ],
};
