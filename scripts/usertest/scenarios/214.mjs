// Start-Popup im leeren Projekt: „Grundriss importieren“ (#214) – Testschritte aus dem Kommentar in #214.
import { loadFixtures } from './_fixtures.mjs';

const card = (t) => t.page.getByTestId('start-card');

export default {
  issue: 214,
  name: 'Startkarte: Grundriss importieren',
  title: 'Bug: Start-Popup im leeren Projekt – „Grundriss importieren“ macht nichts',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Projekt ▾ › Neues leeres Projekt › Neu anlegen.',
      expected: 'Die Startkarte „Los geht’s – das Projekt ist noch leer“ erscheint.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        await card(t).waitFor({ timeout: 5000 });
        const txt = await card(t).innerText();
        return { status: /Los geht/.test(txt) && /noch leer/.test(txt) ? 'ok' : 'fail', observed: `Startkarte sichtbar: „${txt.split('\n')[0]}“.` };
      },
    },
    {
      nr: 2,
      action: 'In der Startkarte auf „Grundriss importieren“ klicken.',
      expected: 'Sofort öffnet sich die Dateiauswahl (PDF, PNG, JPG); links ist der Reiter „Import“ aktiv.',
      async run(t) {
        const { page } = t;
        const chooserP = page.waitForEvent('filechooser', { timeout: 5000 });
        await card(t).getByRole('button', { name: 'Grundriss importieren' }).click();
        t.chooser = await chooserP.catch(() => null);
        const accept = await page.locator('input[type=file]').evaluateAll((els) => els.map((e) => e.accept).filter(Boolean));
        const tab = await page.locator('.panel.left .tabs').getByRole('button', { name: /^Import/ }).getAttribute('class');
        return { status: t.chooser && /active/.test(tab ?? '') ? 'ok' : 'fail', observed: `Dateiauswahl geöffnet: ${!!t.chooser}; erlaubte Typen: ${accept.join(' | ')}; Reiter „Import“ aktiv: ${/active/.test(tab ?? '')}.` };
      },
    },
    {
      nr: 3,
      action: 'Eine Plan-Datei auswählen.',
      expected: 'Der Plan erscheint als Hintergrund, „Nicht kalibriert“ wird angezeigt, und die Startkarte ist verschwunden (sie liegt nicht mehr über dem Plan).',
      async run(t) {
        const { page } = t;
        const fx = await loadFixtures();
        await t.chooser.setFiles({ name: 'grundriss.png', mimeType: 'image/png', buffer: fx.syntheticPlanPng() });
        await page.getByText('Nicht kalibriert', { exact: true }).waitFor({ timeout: 8000 });
        const under = await t.poll(async () => !!(await t.project()).underlay, 5000);
        await page.waitForTimeout(500);
        const cards = await card(t).count();
        await t.shot('Plan als Hintergrund');
        return { status: under && cards === 0 ? 'ok' : 'fail', observed: `Hintergrundplan im Projekt: ${!!under}; „Nicht kalibriert“ sichtbar; Startkarte noch da: ${cards}.` };
      },
    },
    {
      nr: 4,
      optional: true,
      action: 'Optional: Projekt ▾ › „Plan als PDF/Bild importieren…“ wählen.',
      expected: 'Auch hier öffnet sich direkt die Dateiauswahl.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        const chooserP = page.waitForEvent('filechooser', { timeout: 5000 });
        await page.getByRole('button', { name: /Plan als PDF\/Bild importieren/ }).click();
        const c = await chooserP.catch(() => null);
        return { status: c ? 'ok' : 'fail', observed: `Dateiauswahl geöffnet: ${!!c}.` };
      },
    },
  ],
};
