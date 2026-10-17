// Projektversionen: Stand benennen, zurückspringen, vergleichen, löschen (#66) – Testschritte aus dem Kommentar in #66.
const NAME = 'Sofa links';
const isSofa = (f) => f.catalogId === 'generic-sofa-3';
const dlg = (t) => t.page.getByRole('dialog', { name: 'Versionen' });
const items = (t) => dlg(t).getByTestId('version-item');
const itemTexts = async (t) => (await items(t).allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').replace(/ Öffnen Löschen$/, '').trim());
const sofa = async (t) => t.furniture(isSofa);
const at = (f) => `x ${f.x.toFixed(2)} m, y ${f.y.toFixed(2)} m`;
const near = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

async function openVersions(t) {
  await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await t.page.getByRole('button', { name: /^Versionen/ }).click();
  await dlg(t).waitFor({ timeout: 4000 });
}

export default {
  issue: 66,
  name: 'Projektversionen',
  title: 'Projektversionen: eigenen Zwischenstand benennen und später zurückspringen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Stand speichern: Menü Projekt ▾ › Versionen … öffnen, einen Namen eingeben (z. B. „Sofa links“) und „Aktuellen Stand speichern“ klicken.',
      expected: 'Der Stand erscheint mit Datum.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        t.start = await sofa(t);
        await openVersions(t);
        await dlg(t).getByLabel('Name des Stands').fill(NAME);
        await dlg(t).getByRole('button', { name: 'Aktuellen Stand speichern' }).click();
        await t.poll(async () => ((await items(t).count()) === 1 ? true : null), 4000);
        const [txt] = await itemTexts(t);
        const dated = /\d{2}\.\d{2}\.\d{4}/.test(txt ?? '');
        return {
          status: txt?.includes(NAME) && dated ? 'ok' : 'fail',
          observed: `Liste der Stände: ${txt ? `„${txt}“` : 'leer'}${dated ? ' (mit Datum)' : ' (ohne Datum)'}.`,
          clip: await dlg(t).boundingBox(),
          caption: 'Versionen mit dem gespeicherten Stand',
        };
      },
    },
    {
      nr: 2,
      action: 'Den Dialog schließen und im 2D-Plan ein Möbel verschieben.',
      expected: 'Das Möbel steht an der neuen Stelle.',
      async run(t) {
        const { page } = t;
        await dlg(t).getByRole('button', { name: 'Schließen' }).click();
        const s = await t.planToScreen(t.start.x, t.start.y);
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await page.mouse.move(s.x + 40, s.y + 10, { steps: 5 });
        await page.mouse.move(s.x + 80, s.y + 20, { steps: 5 });
        await page.mouse.up();
        t.moved = await sofa(t);
        const dist = Math.hypot(t.moved.x - t.start.x, t.moved.y - t.start.y);
        return {
          status: dist > 0.3 ? 'ok' : 'fail',
          observed: `„${t.start.name}“ von ${at(t.start)} nach ${at(t.moved)} verschoben (${Math.round(dist * 100)} cm).`,
        };
      },
    },
    {
      nr: 3,
      action: 'Stand öffnen: Unter Versionen bei „Sofa links“ auf Öffnen klicken.',
      expected: 'Das Möbel steht wieder an der alten Stelle. Eine Meldung nennt den automatisch gesicherten Stand „Automatisch vor dem Wechsel zu „Sofa links““.',
      async run(t) {
        const { page } = t;
        await openVersions(t);
        await items(t).filter({ hasText: NAME }).getByRole('button', { name: 'Öffnen' }).click();
        const toast = page.locator('.toast').filter({ hasText: `„${NAME}“ geöffnet` });
        const shown = await toast.waitFor({ timeout: 4000 }).then(() => true, () => false);
        const msg = shown ? (await toast.innerText()).trim() : '';
        const back = near(await sofa(t), t.start);
        const named = msg.includes(`Automatisch vor dem Wechsel zu „${NAME}“`);
        return {
          status: back && named ? 'ok' : 'fail',
          observed: `Sofa jetzt bei ${at(await sofa(t))} – ${back ? 'wieder an der alten Stelle' : 'nicht an der alten Stelle'}. Meldung: ${msg ? `„${msg}“` : 'keine'}.`,
        };
      },
    },
    {
      nr: 4,
      action: 'Rückgängig: Strg+Z drücken, dann Strg+Y.',
      expected: 'Strg+Z setzt das Möbel mit einem einzigen Schritt wieder an die verschobene Position, Strg+Y macht das wieder rückgängig.',
      async run(t) {
        const { page } = t;
        await page.locator('[data-testid="editor2d"]').hover();
        await page.keyboard.press('Control+z');
        const undone = await t.poll(async () => (near(await sofa(t), t.moved) ? true : null), 2000);
        const afterZ = await sofa(t);
        await page.keyboard.press('Control+y');
        const redone = await t.poll(async () => (near(await sofa(t), t.start) ? true : null), 2000);
        return {
          status: undone && redone ? 'ok' : 'fail',
          observed: `Nach einmal Strg+Z: Sofa bei ${at(afterZ)} (${undone ? 'verschobene Position' : 'nicht die verschobene Position'}). Nach Strg+Y: ${at(await sofa(t))} (${redone ? 'wieder alte Stelle' : 'nicht die alte Stelle'}).`,
        };
      },
    },
    {
      nr: 5,
      action: 'Vergleichen: In Versionen stehen zwei Stände, einer mit dem Badge „automatisch“. Unter „Zwei Stände vergleichen“ beide wählen.',
      expected: 'Die Tabelle zeigt Gesamtpreis, Anzahl Möbel, Bodenfläche belegt und frei (gesamt und je Raum) sowie die Differenz.',
      async run(t) {
        await openVersions(t);
        await t.poll(async () => ((await items(t).count()) === 2 ? true : null), 4000);
        const texts = await itemTexts(t);
        const badges = await items(t).locator('.version-badge').allInnerTexts();
        const option = async (sel, prefix) => (await dlg(t).getByLabel(sel).locator('option').allInnerTexts()).find((x) => x.startsWith(prefix));
        await dlg(t).getByLabel('Stand A').selectOption({ label: await option('Stand A', NAME) });
        await dlg(t).getByLabel('Stand B').selectOption({ label: await option('Stand B', 'Automatisch') });
        const table = dlg(t).getByTestId('versions-compare-table');
        await table.waitFor({ timeout: 4000 });
        const rows = (await table.locator('tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
        const has = (re) => rows.some((r) => re.test(r));
        const heads = (await table.locator('thead th').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
        const rooms = rows.filter((r) => !/\d/.test(r));
        const checks = {
          Gesamtpreis: has(/^Gesamtpreis.*€/),
          'Anzahl Möbel': has(/^Anzahl Möbel/),
          'Bodenfläche gesamt': has(/^Bodenfläche gesamt.*m²/),
          'belegt/frei gesamt': has(/^belegt.*m²/) && has(/^frei.*m²/),
          'je Raum': rooms.length >= 2,
          'Spalte Differenz': heads.some((h) => /B − A/.test(h)),
        };
        await table.scrollIntoViewIfNeeded();
        const missing = Object.entries(checks).filter(([, v]) => !v);
        return {
          status: texts.length === 2 && badges.includes('automatisch') && !missing.length ? 'ok' : 'fail',
          observed: `${texts.length} Stände, Badge: ${badges.length ? badges.map((b) => `„${b}“`).join(', ') : 'keins'}. Vergleich A „${NAME}“ mit B „Automatisch …“: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')}. Räume in der Tabelle: ${rooms.join(', ')}. Zeile „Anzahl Möbel“: ${rows.find((r) => r.startsWith('Anzahl Möbel'))}.`,
          clip: await dlg(t).boundingBox(),
          caption: 'Vergleich der beiden Stände',
        };
      },
    },
    {
      nr: 6,
      action: 'Löschen und Neuladen: Einen Stand löschen und die Rückfrage bestätigen. Dann die Seite neu laden.',
      expected: 'Die restlichen Stände sind noch da.',
      async run(t) {
        const { page } = t;
        await items(t).filter({ hasNotText: 'Automatisch' }).getByRole('button', { name: 'Löschen' }).click();
        const confirm = page.getByRole('alertdialog');
        const asked = await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false);
        if (asked) await confirm.getByRole('button', { name: 'Löschen' }).click();
        await t.poll(async () => ((await items(t).count()) === 1 ? true : null), 4000);
        const left = await itemTexts(t);
        await dlg(t).getByRole('button', { name: 'Schließen' }).click();
        await page.locator('.save-state').getByText('Gespeichert').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(1200);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        await openVersions(t);
        await t.poll(async () => ((await items(t).count()) >= 1 ? true : null), 4000);
        const after = await itemTexts(t);
        const same = after.length === left.length && after.every((x, i) => x === left[i]);
        return {
          status: asked && left.length === 1 && same ? 'ok' : 'fail',
          observed: `Rückfrage ${asked ? 'kam und wurde bestätigt' : 'kam nicht'}. Danach übrig: ${left.map((x) => `„${x}“`).join(', ') || 'nichts'}. Nach dem Neuladen: ${after.map((x) => `„${x}“`).join(', ') || 'nichts'}${same ? ' – unverändert' : ' – anders'}.`,
          clip: await dlg(t).boundingBox(),
          caption: 'Versionen nach dem Neuladen',
        };
      },
    },
    {
      nr: 7,
      action: 'Optional: Export › Projektpaket, danach das Paket als Kopie importieren.',
      expected: 'Das importierte Projekt hat dieselben Stände.',
      async run(t) {
        const { page } = t;
        const before = await itemTexts(t);
        await dlg(t).getByRole('button', { name: 'Schließen' }).click();
        const original = await t.project();
        await page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const download = page.waitForEvent('download');
        await page.locator('#toolbar-menu-more').getByRole('button', { name: 'Projektpaket (.wohnplan.json)' }).click();
        const file = await (await download).path();
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await page.getByRole('button', { name: 'Projekt importieren (.wohnplan.json)…' }).click();
        await (await chooser).setFiles(file);
        // same project id is already stored → „Abbrechen“ imports it as a copy
        const ask = page.getByRole('alertdialog').filter({ hasText: 'Überschreiben?' });
        const asked = await ask.waitFor({ timeout: 4000 }).then(() => true, () => false);
        if (asked) await ask.getByRole('button', { name: 'Abbrechen' }).click();
        await t.poll(async () => ((await t.project()).id !== original.id ? true : null), 5000);
        const copy = await t.project();
        await openVersions(t);
        await t.poll(async () => ((await items(t).count()) >= 1 ? true : null), 4000);
        const after = await itemTexts(t);
        const same = after.length === before.length && after.every((x, i) => x === before[i]);
        return {
          status: copy.id !== original.id && same ? 'ok' : 'fail',
          observed: `Paket exportiert und als Kopie importiert („${copy.name}“${copy.id !== original.id ? ', eigenes Projekt' : ', aber dasselbe Projekt'}). Stände der Kopie: ${after.map((x) => `„${x}“`).join(', ') || 'keine'}${same ? ' – dieselben wie im Original' : ` – Original hatte ${before.map((x) => `„${x}“`).join(', ')}`}.`,
          clip: await dlg(t).boundingBox(),
          caption: 'Versionen der importierten Kopie',
        };
      },
    },
  ],
};
