// Plan-Hintergrund schnell ein- und ausblenden (#258) – Testschritte aus dem Kommentar in #258.
import { pdfOf, roomWalls } from './_pdf.mjs';

const left = (t) => t.page.locator('.panel.left');
const toggle = (t) => t.page.getByTestId('underlay-toggle');
const under = (t) => t.page.locator('[data-testid="editor2d"] svg image').count();
const pressP = async (t) => {
  await t.page.evaluate(() => document.activeElement?.blur?.());
  await t.page.keyboard.press('p');
};
const vis = async (t) => (await t.project()).underlay?.visible;

export default {
  issue: 258,
  name: 'Plan-Hintergrund schalten',
  title: 'Plan-Hintergrund schnell ein- und ausblenden (Schalter in der 2D-Ansicht)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen und einen Grundriss (PDF) importieren.',
      expected: 'Der Plan liegt als Hintergrund im 2D-Plan.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await left(t).getByRole('button', { name: 'Import' }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.dropzone').click();
        await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdfOf(roomWalls()) });
        await page.getByText('Vektorzeichnung', { exact: false }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
        await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
        const u = (await t.project()).underlay;
        t.opacity = u.opacity;
        const n = await under(t);
        await t.shot('Plan als Hintergrund');
        return { status: u && u.visible && n > 0 ? 'ok' : 'fail', observed: `Unterlage „${u?.fileName}“ sichtbar: ${u?.visible}; Bild im 2D-Plan: ${n}; Deckkraft ${u?.opacity}.` };
      },
    },
    {
      nr: 2,
      action: 'In der 2D-Ansicht unten rechts „Plan-Hintergrund“ ausschalten.',
      expected: 'Der Grundriss verschwindet, Wände und Möbel bleiben.',
      async run(t) {
        const { page } = t;
        const furnBefore = (await t.project()).furniture.length;
        const box = await toggle(t).boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''}` : 'nichts'; }, [cx, cy]);
        // wie ein Nutzer: echter Mausklick auf die Mitte des Schalters
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(400);
        const clicked = (await vis(t)) === false;
        const zoomBox = await page.getByTestId('zoom-2d').boundingBox();
        const overlap = zoomBox.x < box.x + box.width && zoomBox.x + zoomBox.width > box.x && zoomBox.y < box.y + box.height && zoomBox.y + zoomBox.height > box.y;
        await t.shot('Ecke unten rechts: Schalter hinter dem Zoomregler', { x: 760, y: 780, width: 360, height: 100 });
        if (!clicked) await pressP(t); // Rückfallweg, damit die folgenden Schritte geprüft werden können
        await page.waitForTimeout(300);
        const p = await t.project();
        return { status: clicked && !p.underlay.visible && p.walls.length > 0 && p.furniture.length === furnBefore ? 'ok' : 'fail', observed: `Schalter „Plan-Hintergrund“ liegt bei x ${Math.round(box.x)}–${Math.round(box.x + box.width)}, y ${Math.round(box.y)}–${Math.round(box.y + box.height)}; der Zoomregler liegt bei x ${Math.round(zoomBox.x)}–${Math.round(zoomBox.x + zoomBox.width)}, y ${Math.round(zoomBox.y)}–${Math.round(zoomBox.y + zoomBox.height)} (überlappt: ${overlap}). Unter der Mitte des Schalters liegt: ${hit}. Echter Mausklick schaltet den Hintergrund aus: ${clicked}. ${clicked ? '' : 'Mit der Taste P ließ er sich ausschalten (Rückfallweg); '}Danach: Unterlage sichtbar ${p.underlay.visible}, Bild im Plan ${await under(t)}, Wände ${p.walls.length}, Möbel ${p.furniture.length}.` };
      },
    },
    {
      nr: 3,
      action: 'Wieder einschalten oder P drücken.',
      expected: 'Der Grundriss ist mit gleicher Deckkraft wieder da. Der Haken „Anzeigen“ im Import-Reiter zeigt denselben Zustand.',
      async run(t) {
        const { page } = t;
        const offBefore = (await vis(t)) === false;
        await pressP(t);
        await page.waitForTimeout(300);
        const onByClick = (await vis(t)) === true && (await under(t)) > 0;
        await pressP(t);
        await page.waitForTimeout(300);
        const offByP = (await vis(t)) === false;
        const cbOff = await left(t).getByLabel('Anzeigen').isChecked();
        await pressP(t);
        await page.waitForTimeout(300);
        const onByP = (await vis(t)) === true && (await under(t)) > 0;
        const cbOn = await left(t).getByLabel('Anzeigen').isChecked();
        const op = (await t.project()).underlay.opacity;
        return { status: offBefore && onByClick && offByP && onByP && cbOff === false && cbOn === true && op === t.opacity ? 'ok' : 'fail', observed: `Ausgangszustand aus: ${offBefore}; P ein (Schalter selbst nicht klickbar, siehe Schritt 2): ${onByClick}; P aus: ${offByP} (Haken „Anzeigen“: ${cbOff}); P ein: ${onByP} (Haken: ${cbOn}); Deckkraft ${t.opacity} → ${op}.` };
      },
    },
    {
      nr: 4,
      action: 'Projekt speichern und neu laden.',
      expected: 'Der Zustand bleibt erhalten.',
      async run(t) {
        const { page } = t;
        await pressP(t); // aus
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const v = await vis(t);
        return { status: v === false ? 'ok' : 'fail', observed: `Nach dem Neuladen: Unterlage sichtbar = ${v} (vorher ausgeschaltet).` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Optional: In der Ich-Ansicht P drücken.',
      expected: 'P bleibt dort die Referenzfigur, der Plan-Hintergrund wird nicht umgeschaltet.',
      async run(t) {
        const { page } = t;
        const before = await vis(t);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.getByTestId('crosshair').waitFor();
        await page.waitForTimeout(800);
        await page.evaluate(() => window.__wp.walk?.look(0, -0.4));
        await pressP(t);
        await page.waitForTimeout(500);
        const after = await vis(t);
        const fig = (await t.project()).settings.refFigure ?? (await t.ui()).refFigure;
        return { status: before === after ? 'ok' : 'fail', observed: `Unterlage sichtbar vor/nach P in der Ich-Ansicht: ${before}/${after} (unverändert); Referenzfigur-Zustand: ${JSON.stringify(fig)?.slice(0, 80)}.` };
      },
    },
  ],
};
