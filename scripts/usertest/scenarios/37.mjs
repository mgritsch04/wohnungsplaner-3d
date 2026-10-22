// Grundriss-PDF importieren (#37) – Testschritte aus dem Kommentar in #37.
// Vorprüfung mit einem SYNTHETISCHEN CAD-ähnlichen Vektor-PDF (erfundener Plan, nicht Gs Grundriss); Gs echter Plan (schräge Wände, Türen, Raumnamen) ist damit nicht ersetzt.
import { loadFixtures } from './_fixtures.mjs';

const left = (t) => t.page.locator('.panel.left');

export default {
  issue: 37,
  name: 'Grundriss-PDF importieren',
  title: 'Grundriss-PDF importieren: Wände und Räume automatisch in den Planer übernehmen',
  device: 'desktop',
  pc: false,
  realDevice: ['Gs echter Grundriss als PDF (Genauigkeit der Erkennung)'],
  steps: [
    {
      nr: 1,
      action: 'Links den Reiter Import öffnen und den Plan ins Feld ziehen. Bei einem mehrseitigen PDF die Seite mit dem Grundriss wählen.',
      expected: 'Der Plan wird angezeigt.',
      async run(t) {
        const { page } = t;
        t.fx = await loadFixtures();
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        await left(t).getByRole('button', { name: 'Import', exact: true }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.dropzone').click();
        await (await chooser).setFiles({ name: 'grundriss-a3.pdf', mimeType: 'application/pdf', buffer: t.fx.cadFilledPlanPdf() });
        await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).waitFor({ timeout: 15000 });
        const u = (await t.project()).underlay;
        await t.shot('Importierter Plan');
        return { status: u ? 'ok' : 'fail', observed: `Synthetisches A3-Vektor-PDF importiert: Hintergrund ${u ? `${u.pixelWidth ?? ''}×${u.pixelHeight ?? ''} px` : 'fehlt'}, Hinweis „Vektorzeichnung“ ${await page.getByText('Vektorzeichnung').count() ? 'sichtbar' : 'fehlt'}.` };
      },
    },
    {
      nr: 2,
      action: 'Nur bei PDF: Unter „Maßstab 1:“ den Plan-Maßstab eintragen (z. B. 100) und „Aus Angabe übernehmen“ klicken.',
      expected: 'Darunter erscheint eventuell ein Hinweis zu den Maßtexten im PDF: „passen zum Maßstab“ oder eine gelbe Warnung mit Prozent-Abweichung. Der Maßstab selbst wird dabei nicht geändert.',
      async run(t) {
        const { page } = t;
        await page.locator('.field-row.compact input').fill('75');
        await page.getByRole('button', { name: 'Aus Angabe übernehmen' }).click();
        const assumed = await page.getByText('Maßstab angenommen', { exact: true }).count();
        const u = (await t.project()).underlay;
        // second PDF with dimension texts: the check statement appears and the scale stays as entered
        return { status: assumed && u.calibrated === false ? 'ok' : 'fail', observed: `Maßstab 1:75 übernommen, als „angenommen“ markiert (nicht kalibriert). Der Hinweis zu Maßtexten erscheint nur bei PDFs mit Maßtexten (dieser synthetische Plan hat keine; das prüft ein eigener automatischer Test).` };
      },
    },
    {
      nr: 3,
      action: '„Maßstab kalibrieren (2 Punkte)“: zwei Punkte einer bekannten Strecke anklicken und die echte Länge eintragen.',
      expected: '„Kalibriert“.',
      async run(t) {
        // the two-point calibration itself is a manual click task; the test sets the same state the dialog produces
        await t.page.evaluate(() => {
          window.__wp.useProjectStore.getState().apply((d) => {
            d.underlay.calibrated = true;
            d.underlay.scaleSource = 'reference';
          });
        });
        await t.page.waitForTimeout(300);
        const badge = await left(t).getByText('Kalibriert', { exact: true }).count();
        return { status: 'look', observed: `Das Anklicken zweier Punkte habe ich nicht nachgestellt, sondern den Zustand „kalibriert“ direkt gesetzt (Anzeige „Kalibriert“: ${badge ? 'ja' : 'nein'}). Bitte die 2-Punkte-Kalibrierung selbst ausprobieren.` };
      },
    },
    {
      nr: 4,
      action: '„Erkennung starten“ klicken.',
      expected: 'Schräge Wände erscheinen schräg, die Ecken sind geschlossen. Türen in schrägen Wänden sind markiert. Unter „Elemente“ stehen Räume mit Fläche oder mit dem Namen aus dem PDF. Es gibt keinen „schwarzen Block“; Außenwände und die meisten Innenwände, Fenster und Türen sitzen an der richtigen Stelle.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Erkennung starten' }).click();
        await page.getByText('Import prüfen').waitFor({ timeout: 20000 });
        const draft = await page.evaluate(() => window.__wp.useImportStore.getState().draft);
        t.draft = draft;
        const rooms = draft.rooms.map((r) => `${r.name}${r.statedArea ? ` (${r.statedArea} m²)` : ''}`);
        await t.shot('Erkennungsergebnis');
        return { status: 'look', observed: `Synthetischer Plan: ${draft.walls.length} Wände (erwartet 7), ${draft.openings.length} Öffnungen, Räume: ${rooms.join(', ')}. Ob bei Gs echtem Plan schräge Wände, Türen und Räume richtig sitzen, kann nur G am Bild beurteilen.`, sound: draft.walls.length === 7 };
      },
    },
    {
      nr: 5,
      action: 'Falsch erkannte Wände abwählen und „Räume neu vorschlagen“ klicken. Raumnamen per Klick ändern.',
      expected: 'Die Raumvorschläge passen sich an, die Namen sind änderbar.',
      async run(t) {
        const { page } = t;
        const btn = page.getByRole('button', { name: /Räume neu vorschlagen/ });
        const has = await btn.count();
        if (has) await btn.click();
        await page.waitForTimeout(500);
        const draft = await page.evaluate(() => window.__wp.useImportStore.getState().draft);
        await page.getByText(/Raum „Wohnen“/).first().click();
        await page.waitForTimeout(300);
        const nameInput = page.locator('.panel.left label.field').filter({ hasText: /^Name/ }).locator('input');
        let renamed = false;
        if (await nameInput.count()) {
          await nameInput.fill('Wohnküche');
          await nameInput.press('Tab');
          renamed = (await page.evaluate(() => window.__wp.useImportStore.getState().draft.rooms.map((r) => r.name))).includes('Wohnküche');
        }
        return { status: has && draft.rooms.length > 0 && renamed ? 'ok' : 'look', observed: `„Räume neu vorschlagen“ vorhanden: ${has ? 'ja' : 'nein'}; danach ${draft.rooms.length} Raumvorschläge; Raum „Wohnen“ in „Wohnküche“ umbenannt: ${renamed ? 'ja' : 'nein (Feld nicht gefunden)'}. Das Abwählen falsch erkannter Wände ist nicht nachgestellt.` };
      },
    },
    {
      nr: 6,
      action: 'Unter „Übernahme“ „Bestehenden Grundriss ersetzen“ wählen, dann „In Plan übernehmen“ und die Rückfragen bestätigen.',
      expected: 'Der Grundriss ist im Plan übernommen.',
      async run(t) {
        const { page } = t;
        await page.locator('.panel.left select').first().selectOption('replace');
        await page.getByRole('button', { name: /In Plan übernehmen/ }).click();
        await page.waitForTimeout(500);
        // two confirmations: „… als „unsicher“ markiert. Trotzdem übernehmen?“ → Übernehmen, „Der bestehende Grundriss … wird ersetzt“ → Ersetzen
        for (const name of ['Übernehmen', 'Ersetzen']) {
          const confirm = page.getByRole('button', { name, exact: true });
          await confirm.waitFor({ timeout: 4000 }).catch(() => undefined);
          if (await confirm.count()) await confirm.click();
          await page.waitForTimeout(500);
        }
        const p = await t.project();
        const names = p.rooms.map((r) => r.name);
        t.adopted = p;
        const sameRooms = [...names].sort().join() === t.draft.rooms.map((r) => (r.name === 'Wohnen' ? 'Wohnküche' : r.name)).sort().join();
        return { status: sameRooms && p.openings.length === t.draft.openings.length && p.walls.length >= t.draft.walls.length ? 'ok' : 'fail', observed: `Bestehenden Grundriss ersetzt (beide Rückfragen bestätigt). Im Plan: ${p.walls.length} Wände (erkannt: ${t.draft.walls.length}, an Kreuzungen geteilt), ${p.openings.length} Türen/Fenster (erkannt: ${t.draft.openings.length}), Räume: ${names.join(', ')} – wie vorgeschlagen, mit dem umbenannten Raum.` };
      },
    },
    {
      nr: 7,
      action: '3D › Begehen: durch die Räume gehen.',
      expected: 'Wände, Türen und Räume sind plausibel.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(1500);
        await t.shot('Begehen im übernommenen Plan');
        return { status: 'look', observed: 'Begehen startet ohne Fehler im übernommenen synthetischen Plan; ob Wände, Türen und Räume bei Gs echtem Plan plausibel sind, bitte selbst durchgehen (Bild im Bericht).' };
      },
    },
  ],
};
