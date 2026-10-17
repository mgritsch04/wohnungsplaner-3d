// Messlinie im neuen Projekt (#133) und Hilfe & Tastenkürzel (#59) – Testschritte aus dem Kommentar in #133.
const plan = (t) => t.page.locator('[data-testid="editor2d"]');
const measureLines = (t) => plan(t).getByTestId('measure-line').count();
const measurements = (t) => t.page.evaluate(() => window.__wp.useUiStore.getState().measurements.length);
const helpDialog = (t) => t.page.getByRole('dialog', { name: 'Hilfe & Tastenkürzel' });

async function clickPlan(t, x, y) {
  const s = await t.planToScreen(x, y);
  await t.page.mouse.click(s.x, s.y);
}

export default {
  issue: 133,
  name: 'Messlinie und Hilfe',
  title: 'Messlinie bleibt in einem neuen leeren Projekt sichtbar',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Teil A (#133): In 2D links Werkzeuge › „Messen“ wählen (oder Taste M) und zwei Punkte anklicken.',
      expected: 'Eine Messlinie mit Länge erscheint.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: /^Messen/ }).first().click();
        await clickPlan(t, 1, 0.8);
        await clickPlan(t, 3, 0.8);
        const n = await t.poll(async () => ((await measureLines(t)) === 1 ? 1 : null), 4000);
        const label = n ? ((await plan(t).getByTestId('measure-line').first().textContent()) ?? '').trim() : '';
        return {
          status: n && /\d/.test(label) ? 'ok' : 'fail',
          observed: n ? `Eine Messlinie ist da, Beschriftung „${label}“ (2 m gemessen).` : 'Nach zwei Klicks mit „Messen“ ist keine Messlinie zu sehen.',
        };
      },
    },
    {
      nr: 2,
      action: 'Teil A (#133): Oben Projekt ▾ › „Neues leeres Projekt“.',
      expected: 'Das neue Projekt ist leer, es ist keine Messlinie zu sehen.',
      async run(t) {
        const { page } = t;
        await page.locator('.save-state').getByText('Gespeichert').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        const empty = await t.poll(async () => ((await t.project()).walls.length === 0 ? true : null), 5000);
        const lines = await measureLines(t);
        const stored = await measurements(t);
        return {
          status: empty && lines === 0 && stored === 0 ? 'ok' : 'fail',
          observed: `Neues Projekt ${empty ? 'ist leer (keine Wände)' : 'ist nicht leer'}. Messlinien im Plan: ${lines}, gespeicherte Messungen: ${stored}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Teil A (#133): Über Projekt ▾ › „Projekte öffnen…“ wieder die Beispielwohnung öffnen (ohne die Seite neu zu laden).',
      expected: 'Die Messlinie aus Schritt 1 ist dort wieder da.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await page.getByRole('button', { name: 'Projekte öffnen…' }).click();
        const row = page.locator('.project-list li').filter({ hasText: 'Beispielwohnung' });
        await row.getByRole('button', { name: 'Öffnen' }).click();
        const opened = await t.poll(async () => ((await t.project()).name === 'Beispielwohnung' ? true : null), 5000);
        const n = await t.poll(async () => ((await measureLines(t)) === 1 ? 1 : null), 4000);
        return {
          status: opened && n === 1 ? 'ok' : 'fail',
          observed: `${opened ? 'Beispielwohnung ist wieder offen' : 'Beispielwohnung ließ sich nicht öffnen'}. Messlinien im Plan: ${await measureLines(t)}.`,
        };
      },
    },
    {
      nr: 4,
      action: 'Teil B (#59): Oben auf das ?-Symbol klicken oder die Taste ? drücken.',
      expected: 'Das Fenster „Hilfe & Tastenkürzel“ öffnet sich mit einer Liste der Tasten.',
      async run(t) {
        const { page } = t;
        await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
        await page.keyboard.press('?');
        const open = await helpDialog(t).waitFor({ timeout: 4000 }).then(() => true, () => false);
        const keys = open ? await helpDialog(t).locator('dl.kbd-list dt').count() : 0;
        return {
          status: open && keys >= 10 ? 'ok' : 'fail',
          observed: open ? `Das Fenster „Hilfe & Tastenkürzel“ ist offen und listet ${keys} Tasten.` : 'Nach „?“ öffnet sich kein Fenster „Hilfe & Tastenkürzel“.',
        };
      },
    },
    {
      nr: 5,
      action: 'Teil B (#59): Esc drücken.',
      expected: 'Das Fenster schließt sich.',
      async run(t) {
        await t.page.keyboard.press('Escape');
        const closed = await helpDialog(t).waitFor({ state: 'hidden', timeout: 4000 }).then(() => true, () => false);
        return { status: closed ? 'ok' : 'fail', observed: closed ? 'Das Fenster ist nach Esc geschlossen.' : 'Das Fenster bleibt nach Esc offen.' };
      },
    },
  ],
};
