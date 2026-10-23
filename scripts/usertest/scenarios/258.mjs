// Plan-Hintergrund schnell ein- und ausblenden (#258) – Testschritte aus dem Kommentar in #258 (Stand nach Fix mgritsch04/wohnungsplaner-3d#333).
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
      action: 'App öffnen, 2D-Ansicht, einen Grundriss (PDF oder Bild) importieren.',
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
      action: 'Unten rechts den Schalter „Plan-Hintergrund“ mit der Maus anklicken (er liegt über dem Zoomregler).',
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
      action: 'Erneut klicken (oder P drücken).',
      expected: 'Der Grundriss ist mit gleicher Deckkraft wieder da; der Haken „Anzeigen“ im Import-Reiter folgt.',
      async run(t) {
        const { page } = t;
        const offBefore = (await vis(t)) === false;
        const box = await toggle(t).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
        const onByClick = (await vis(t)) === true && (await under(t)) > 0;
        const cbOn = await left(t).getByLabel('Anzeigen').isChecked();
        const op = (await t.project()).underlay.opacity;
        await t.shot('Plan wieder eingeblendet');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);
        const offAgain = (await vis(t)) === false;
        const cbOff = await left(t).getByLabel('Anzeigen').isChecked();
        await pressP(t);
        await page.waitForTimeout(300);
        const onByP = (await vis(t)) === true && (await under(t)) > 0;
        return { status: offBefore && onByClick && cbOn === true && op === t.opacity && offAgain && cbOff === false && onByP ? 'ok' : 'fail', observed: `Ausgangszustand aus: ${offBefore}; Mausklick ein: ${onByClick} (Haken „Anzeigen“: ${cbOn}, Deckkraft ${t.opacity} → ${op}); zweiter Mausklick aus: ${offAgain} (Haken: ${cbOff}); P ein: ${onByP}.` };
      },
    },
    {
      nr: 4,
      optional: true,
      action: 'Optional: Zoomregler benutzen.',
      expected: 'Der Regler ist unverändert bedienbar und wird nicht vom Schalter verdeckt.',
      async run(t) {
        const { page } = t;
        const slider = page.getByTestId('zoom-2d').locator('input[type=range]').first();
        const wrap = page.getByTestId('zoom-2d');
        const tb = await toggle(t).boundingBox();
        const zb = await wrap.boundingBox();
        const sb = await slider.boundingBox();
        const overlap = zb.x < tb.x + tb.width && zb.x + zb.width > tb.x && zb.y < tb.y + tb.height && zb.y + zb.height > tb.y;
        const read = () => page.evaluate(() => { const px = document.querySelector('[data-testid="editor2d"] svg').getBoundingClientRect().width; return px; });
        const v0 = await slider.inputValue();
        await page.mouse.click(sb.x + sb.width * 0.9, sb.y + sb.height / 2);
        await page.waitForTimeout(400);
        const v1 = await slider.inputValue();
        await t.shot('Ecke unten rechts', { x: 760, y: 740, width: 360, height: 140 });
        return { status: !overlap && v0 !== v1 ? 'ok' : 'fail', observed: `Schalter bei x ${Math.round(tb.x)}–${Math.round(tb.x + tb.width)}, y ${Math.round(tb.y)}–${Math.round(tb.y + tb.height)}; Zoomregler bei x ${Math.round(zb.x)}–${Math.round(zb.x + zb.width)}, y ${Math.round(zb.y)}–${Math.round(zb.y + zb.height)}; überlappen: ${overlap}. Reglerwert nach Klick auf den Regler: ${v0} → ${v1}.` };
      },
    },
  ],
};
