// [USERTEST] Material für Möbel wählen (#63) – Schritte aus Issue #166.
const right = (t) => t.page.locator('.panel.right');
const material = (t) => right(t).getByRole('combobox', { name: /^Material/ });
const isSofa = (f) => f.catalogId === 'generic-sofa-3';
const isWardrobe = (f) => f.catalogId === 'generic-wardrobe-150';

async function select(t, pred) {
  const f = await t.furniture(pred);
  await t.page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
  await t.page.waitForTimeout(400);
  const s = await t.planToScreen(f.x, f.y);
  await t.page.mouse.click(s.x, s.y);
  return (await t.selection())?.id === f.id ? f : null;
}

/** Close-up of a piece of furniture in 3D: camera in front of it, returns a clip around it. */
async function closeUp(t, f, distance = Math.max(2.2, (f.height ?? 0.8) * 1.45), height = 1.4) {
  const fx = Math.sin(f.rotation ?? 0);
  const fz = Math.cos(f.rotation ?? 0);
  await t.lookAt({ x: f.x + fx * distance, y: height, z: f.y + fz * distance }, { x: f.x, y: (f.height ?? 0.8) / 2, z: f.y });
  await t.page.waitForTimeout(3000);
  return undefined; // whole 3D view
}

export default {
  issue: 166,
  name: 'Möbel-Material',
  title: '[USERTEST] Material für Möbel wählen (#63)',
  device: 'desktop',
  realDevice: [
    'Wie hochwertig Leder-, Holz- und Lackoberflächen aussehen: in der Cloud rechnet eine Software-Grafik ohne echte Grafikkarte, Glanz und Struktur wirken auf deinem PC schärfer.',
  ],
  steps: [
    {
      nr: 1,
      action: 'App öffnen und im 2D-Plan auf das Sofa klicken.',
      expected: 'Das Sofa ist ausgewählt, rechts erscheinen seine Eigenschaften.',
      async run(t) {
        await t.freshStart();
        const f = await select(t, isSofa);
        return f
          ? { status: 'ok', observed: `„${f.name}“ ist ausgewählt, rechts stehen die Eigenschaften.` }
          : { status: 'fail', observed: 'Nach dem Klick auf das Sofa ist es nicht ausgewählt.' };
      },
    },
    {
      nr: 2,
      action: 'Rechts unter „Eigenschaften“ › „Aussehen“ das Feld „Material“ und die Standardmaterialien ansehen.',
      expected: 'Feld „Material“ steht auf „Automatisch (Modell)“, darunter eine Reihe Farbfelder; sichtbar und lesbar.',
      async run(t) {
        const m = material(t);
        await m.scrollIntoViewIfNeeded();
        const value = await m.inputValue();
        const shown = await m.locator('option:checked').textContent();
        const swatches = await right(t).getByRole('button', { name: 'Leder Cognac' }).locator('xpath=..').getByRole('button').count();
        const box = await m.boundingBox();
        const clip = { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 60), width: 420, height: 230 };
        const ok = value === 'auto' && swatches >= 6 && (await m.isVisible());
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Feld „Material“ zeigt „${shown?.trim()}“, darunter ${swatches} Farbfelder.`,
          clip,
          caption: 'Ausschnitt rechte Leiste (Aussehen)',
        };
      },
    },
    {
      nr: 3,
      action: 'Über die Farbfelder fahren (Tooltip) und „Leder Cognac“ anklicken.',
      expected: 'Tooltip nennt das Material; das Feld ist umrandet, „Material“ zeigt „Leder“, Farbe cognacbraun.',
      async run(t) {
        const btn = right(t).getByRole('button', { name: 'Leder Cognac' });
        const tip = (await btn.getAttribute('title')) ?? (await btn.getAttribute('aria-label'));
        await btn.hover();
        await btn.click();
        const pressed = await btn.getAttribute('aria-pressed');
        const shown = (await material(t).locator('option:checked').textContent())?.trim();
        const f = await t.poll(async () => {
          const s = await t.furniture(isSofa);
          return s.finish === 'leather' ? s : null;
        });
        const box = await material(t).boundingBox();
        const ok = pressed === 'true' && shown === 'Leder' && f?.color === '#8a4f2a';
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Tooltip: „${tip}“. Feld umrandet: ${pressed === 'true' ? 'ja' : 'nein'}. „Material“ zeigt „${shown}“, gespeicherte Farbe ${f?.color ?? '–'} (Cognac = #8a4f2a).`,
          clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 60), width: 420, height: 230 },
          caption: 'Leder Cognac gewählt',
        };
      },
    },
    {
      nr: 4,
      action: 'Oben auf „3D“, dann „Realismus“; das Sofa aus der Nähe ansehen.',
      expected: 'Sofa braun, leicht glänzend, feine Lederstruktur statt Stoffmuster; Holzfüße bleiben Holz.',
      async run(t) {
        const { page } = t;
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('group', { name: 'Qualität' }).getByRole('button', { name: 'Realismus' }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        const realism = (await t.project()).settings.quality === 'realism';
        const clip = await closeUp(t, await t.furniture(isSofa));
        return {
          status: realism ? 'look' : 'fail',
          observed: realism
            ? '3D im Modus „Realismus“ ist an, das Sofa ist herangezoomt. Farbe, Glanz und Struktur bitte am Bild beurteilen.'
            : 'Der Modus „Realismus“ ließ sich nicht einschalten.',
          clip,
          caption: 'Sofa in 3D, Realismus, Nahansicht',
        };
      },
    },
    {
      nr: 5,
      action: 'Den Kleiderschrank auswählen, „Nussbaum“ und danach „Weiß lackiert“ wählen.',
      expected: 'Nussbaum: dunkelbraun mit Maserung. Weiß lackiert: weiß, glatt, glänzender, ohne Maserung.',
      async run(t) {
        const { page } = t;
        const f = await select(t, isWardrobe);
        if (!f) return { status: 'fail', observed: 'Der Kleiderschrank ließ sich im Plan nicht auswählen.' };
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '3D', exact: true }).click();
        await right(t).getByRole('button', { name: 'Nussbaum' }).click();
        const walnut = await t.poll(async () => ((await t.furniture(isWardrobe)).finish === 'wood' ? t.furniture(isWardrobe) : null));
        await t.shot('Schrank mit Nussbaum (3D, Realismus)', await closeUp(t, f));
        await right(t).getByRole('button', { name: 'Weiß lackiert' }).click();
        const white = await t.poll(async () => ((await t.furniture(isWardrobe)).finish === 'lacquer' ? t.furniture(isWardrobe) : null));
        const clip = await closeUp(t, f);
        return {
          status: walnut?.color === '#6e4b31' && white?.color === '#f1f0ec' ? 'look' : 'fail',
          observed: `Gespeichert: Nussbaum = ${walnut?.finish}/${walnut?.color}, danach Weiß lackiert = ${white?.finish}/${white?.color}. Maserung und Glanz bitte an den beiden Bildern vergleichen.`,
          clip,
          caption: 'Schrank Weiß lackiert (3D, Realismus)',
        };
      },
    },
    {
      nr: 6,
      action: 'Beim Schrank nur das Feld „Material“ auf „Metall“ stellen, ohne die Farbe anzufassen.',
      expected: 'Die Farbe bleibt gleich und der Schrank wirkt metallisch.',
      async run(t) {
        const before = (await t.furniture(isWardrobe)).color;
        await material(t).selectOption({ label: 'Metall' });
        const f = await t.poll(async () => {
          const w = await t.furniture(isWardrobe);
          return w.finish === 'metal' ? w : null;
        });
        const clip = await closeUp(t, f);
        return {
          status: f && f.color === before ? 'look' : 'fail',
          observed: `Material jetzt „${f?.finish}“, Farbe vorher ${before}, nachher ${f?.color} (${f?.color === before ? 'unverändert' : 'verändert'}). Metall-Optik bitte am Bild beurteilen.`,
          clip,
          caption: 'Schrank Metall (3D, Realismus)',
        };
      },
    },
    {
      nr: 7,
      action: 'Seite neu laden (F5), Sofa und Schrank erneut auswählen.',
      expected: 'Material und Farbe sind nach dem Neuladen unverändert.',
      async run(t) {
        const { page } = t;
        await page.locator('.save-state').getByText('Gespeichert').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(1000);
        const sofa = await t.furniture(isSofa);
        const wardrobe = await t.furniture(isWardrobe);
        await select(t, isWardrobe);
        await t.shot('Schrank nach dem Neuladen ausgewählt');
        await select(t, isSofa);
        const shown = (await material(t).locator('option:checked').textContent())?.trim();
        const ok = sofa.finish === 'leather' && sofa.color === '#8a4f2a' && wardrobe.finish === 'metal' && wardrobe.color === '#f1f0ec';
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Nach dem Neuladen: Sofa ${sofa.finish}/${sofa.color} (Feld zeigt „${shown}“), Schrank ${wardrobe.finish}/${wardrobe.color}.`,
          caption: 'Sofa nach dem Neuladen ausgewählt',
        };
      },
    },
    {
      nr: 8,
      action: 'Beim Sofa das Material wieder auf „Automatisch (Modell)“ stellen.',
      expected: 'Das Sofa sieht wieder aus wie vorher (Stoffstruktur), die zuletzt gewählte Farbe bleibt.',
      async run(t) {
        const { page } = t;
        await material(t).selectOption('auto');
        const f = await t.poll(async () => {
          const s = await t.furniture(isSofa);
          return !('finish' in s) ? s : null;
        });
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '3D', exact: true }).click();
        const clip = await closeUp(t, await t.furniture(isSofa));
        return {
          status: f && f.color === '#8a4f2a' ? 'look' : 'fail',
          observed: f
            ? `Material entfernt (Automatisch), Farbe bleibt ${f.color}. Stoffstruktur bitte am Bild beurteilen.`
            : 'Das Material ließ sich nicht auf „Automatisch“ zurückstellen.',
          clip,
          caption: 'Sofa wieder „Automatisch (Modell)“, Nahansicht',
        };
      },
    },
  ],
};
