// Materialien und Farben für Wände, Böden und Möbel (#63) – Testschritte aus dem Kommentar in #63.
// Die Schritte 5 und 6 beurteilen Glanz und Spiegelungen im 3D-Bild: die automatische Prüfung liest nur die Material-Werte und macht ein Bild, das Urteil bleibt bei G.
const right = (t) => t.page.locator('.panel.right');
const mat = (t) => right(t).getByRole('combobox', { name: /^Material/ });
const autoBtn = (t) => right(t).getByRole('button', { name: 'Automatisch', exact: true });
const furn = (t, id) => t.furniture((f) => f.id === id);
async function selectIn2d(t, f) {
  const s = await t.planToScreen(f.x, f.y);
  await t.page.mouse.click(s.x, s.y);
  return t.poll(async () => ((await t.selection())?.id === f.id ? true : null), 3000);
}

export default {
  issue: 63,
  name: 'Materialien und Farben',
  title: 'Materialien und Farben für Wände, Böden und Möbel auswählen',
  device: 'desktop',
  pc: false,
  realDevice: ['Glanz und Spiegelungen am Bildschirm einer echten Grafikkarte'],
  steps: [
    {
      nr: 1,
      action: 'Klicke im 2D-Plan auf das Sofa. Rechts unter „Eigenschaften“ › „Aussehen“ steht neben dem Farbwähler der Knopf Automatisch.',
      expected: 'Der Knopf ist markiert und ausgegraut, weil das Sofa seine Originalfarbe hat.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(600);
        const sofa = await t.furniture((f) => f.catalogId === 'generic-sofa-3');
        t.sofa = sofa;
        const sel = await selectIn2d(t, sofa);
        const pressed = await autoBtn(t).getAttribute('aria-pressed');
        const disabled = await autoBtn(t).isDisabled();
        return { status: sel && pressed === 'true' && disabled ? 'ok' : 'fail', observed: `Sofa ausgewählt: ${!!sel}; Knopf „Automatisch“ markiert: ${pressed}, ausgegraut: ${disabled}; Material-Feld: „${await mat(t).inputValue()}“.` };
      },
    },
    {
      nr: 2,
      action: 'Klicke auf das Standardmaterial Leder Cognac.',
      expected: 'Das Sofa wird cognacbraun, das Feld „Material“ zeigt „Leder“, der Knopf Automatisch neben der Farbe ist jetzt anklickbar.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Leder Cognac' }).click();
        const f = await furn(t, t.sofa.id);
        const matVal = await mat(t).evaluate((s) => s.selectedOptions[0].textContent);
        const enabled = await autoBtn(t).isEnabled();
        return { status: f.finish === 'leather' && f.color === '#8a4f2a' && /Leder/.test(matVal) && enabled ? 'ok' : 'fail', observed: `Farbe ${f.color} (Cognac-Braun), Material „${matVal}“, Knopf „Automatisch“ anklickbar: ${enabled}.` };
      },
    },
    {
      nr: 3,
      action: 'Stelle das Feld Material auf „Automatisch (Modell)“ und klicke danach neben der Farbe auf Automatisch.',
      expected: 'Das Sofa hat wieder seine ursprüngliche Farbe und Stoffstruktur, der Farb-Knopf ist wieder markiert und ausgegraut.',
      async run(t) {
        await mat(t).selectOption('auto');
        await autoBtn(t).click();
        const f = await furn(t, t.sofa.id);
        const pressed = await autoBtn(t).getAttribute('aria-pressed');
        const disabled = await autoBtn(t).isDisabled();
        return { status: f.color === t.sofa.color && !('finish' in f) && pressed === 'true' && disabled ? 'ok' : 'fail', observed: `Farbe ${f.color} (Original ${t.sofa.color}), Material-Eintrag entfernt: ${!('finish' in f)}, Knopf markiert und ausgegraut: ${pressed === 'true' && disabled}. Die Stoffstruktur im 3D-Bild habe ich nicht angesehen.` };
      },
    },
    {
      nr: 4,
      action: 'Wähle eine eigene Farbe im Farbwähler, lade die Seite neu (F5), wähle das Sofa erneut und klicke auf Automatisch.',
      expected: 'Auch nach dem Neuladen springt die Farbe auf die Originalfarbe zurück.',
      async run(t) {
        const { page } = t;
        // a custom colour through the colour input of the panel
        await right(t).locator('input[type="color"]').first().fill('#336699');
        await page.waitForTimeout(400);
        const custom = (await furn(t, t.sofa.id)).color;
        await page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.getByRole('button', { name: '2D', exact: true }).click().catch(() => undefined);
        await page.waitForTimeout(600);
        const sel = await selectIn2d(t, await furn(t, t.sofa.id));
        await autoBtn(t).click();
        const after = (await furn(t, t.sofa.id)).color;
        return { status: custom === '#336699' && sel && after === t.sofa.color ? 'ok' : 'fail', observed: `Eigene Farbe ${custom}; nach Neuladen und Klick auf „Automatisch“ wieder ${after} (Original ${t.sofa.color}).` };
      },
    },
    {
      nr: 5,
      action: 'Wähle den Kleiderschrank, wähle Edelstahl. Wechsle auf 3D › Realismus und zoome an den Schrank heran, Tageszeit etwa 14:00.',
      expected: 'Der Schrank wirkt klar metallisch: helle Spiegelungen und Glanzkanten der Umgebung, kein mattes Hellgrau.',
      async run(t) {
        const { page } = t;
        const w = await t.furniture((f) => f.catalogId === 'generic-wardrobe-150' || /Kleiderschrank/.test(f.name));
        await selectIn2d(t, w);
        await right(t).getByRole('button', { name: 'Edelstahl' }).click();
        const f = await furn(t, w.id);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Realismus', exact: true }).click();
        await page.waitForTimeout(2500);
        await t.lookAt({ x: w.x - 1.6, y: 1.4, z: w.y - 1.8 }, { x: w.x, y: 1, z: w.y });
        await page.waitForTimeout(4000);
        await t.shot('Edelstahl-Schrank im Realismus');
        const mats = await page.evaluate((id) => {
          const out = [];
          window.__wp.three.scene.traverse((g) => {
            if (g.userData?.furnitureId !== id) return;
            g.traverse((o) => o.isMesh && out.push({ metalness: o.material.metalness, roughness: o.material.roughness, env: !!(o.material.envMap || window.__wp.three.scene.environment) }));
          });
          return out;
        }, w.id);
        await t.shot('Kleiderschrank aus Edelstahl im Realismusmodus');
        const metal = mats.filter((m) => m.metalness > 0.5).length;
        return { status: 'look', observed: `Material „${f.finish}“ gesetzt. In 3D (Realismus): ${mats.length} Flächen am Schrank, davon ${metal} mit Metallwert > 0,5${metal ? ` (Rauheit ${mats.find((m) => m.metalness > 0.5).roughness})` : ''}, Umgebungsspiegelung der Szene: ${mats.some((m) => m.env)}. Ob er am Bildschirm „klar metallisch“ wirkt, beurteilt nur ein Mensch (Software-Grafik der Cloud, keine echte GPU).` };
      },
    },
    {
      nr: 6,
      action: 'Optional: Ziehe die Tageszeit auf den Abend (etwa 21:00).',
      expected: 'Das Metall wird dunkler, bleibt aber als Metall erkennbar und wird nicht schwarz.',
      async run(t) {
        const { page } = t;
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await right(t).locator('select').filter({ has: page.locator('option', { hasText: 'Abend (21:00)' }) }).first().selectOption({ label: 'Abend (21:00)' });
        await page.waitForTimeout(2000);
        await t.shot('Edelstahl am Abend (21:00)');
        return { status: 'skip', observed: 'Optionaler Optik-Schritt, nicht bewertet (Bild liegt bei).' };
      },
    },
  ],
};
