// Beim Ziehen aus dem Katalog das Möbel-Modell als Vorschau zeigen (#217) – Testschritte aus dem Kommentar in #217.
import { boxGlb } from './_glb.mjs';

const ghost3d = (t) =>
  t.page.evaluate(() => {
    const o = window.__wp.three.scene.getObjectByName('catalog-drop-ghost');
    if (!o) return null;
    let meshes = 0;
    let translucent = 0;
    const verts = [];
    o.updateWorldMatrix(true, true);
    o.traverse((m) => {
      if (m.isMesh) {
        meshes++;
        verts.push(m.geometry?.attributes?.position?.count ?? 0);
        for (const mat of [m.material].flat()) if (mat.transparent && mat.opacity < 1) translucent++;
      }
    });
    return { x: o.position.x, z: o.position.z, meshes, translucent, verts };
  });

export default {
  issue: 217,
  name: 'Katalog-Vorschau mit Modell',
  title: 'Beim Ziehen aus dem Katalog gleich das Möbel-Modell als Vorschau zeigen statt Produktfoto',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Ein Produkt mit eigenem 3D-Modell (z. B. aus dem IKEA-Bereich) in die 3D-Ansicht auf den Boden ziehen, nicht loslassen.',
      expected: 'Halbtransparent das echte Modell, keine Standardform (ggf. kurz die Standardform, bis das Modell geladen ist).',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        // stand-in for an IKEA product: an own GLB model (80 × 200 × 60 cm) in the catalog
        await page.locator('.panel.left').getByRole('button', { name: 'Katalog' }).click();
        await page.getByRole('button', { name: /3D-Modell importieren/ }).click();
        const dlg = page.getByRole('dialog', { name: '3D-Modell importieren' });
        await dlg.getByLabel('Modelldatei').setInputFiles({ name: 'testschrank.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(80, 200, 60)) });
        await dlg.getByText('gültig').waitFor();
        await dlg.getByRole('button', { name: 'Zum Katalog hinzufügen und platzieren' }).click();
        await t.poll(async () => ((await t.project()).furniture.some((f) => f.name === 'testschrank') ? 1 : null), 8000);
        const placed = (await t.project()).furniture.find((f) => f.name === 'testschrank');
        t.glb = placed;
        await page.evaluate((id) => window.__wp.useProjectStore.getState().apply((d) => void (d.furniture = [])), placed.id);
        await page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        t.count = async () => (await t.project()).furniture.filter((f) => f.name === 'testschrank').length;
        await page.getByLabel('Katalog durchsuchen').fill('testschrank');
        t.entry = page.locator('.catalog-item', { hasText: 'testschrank' });
        await t.entry.first().waitFor();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        const eb = await t.entry.first().boundingBox();
        const s = await t.worldToScreen(2.5, 0, 2);
        await page.mouse.move(eb.x + 20, eb.y + eb.height / 2);
        await page.mouse.down();
        await page.mouse.move(eb.x + 40, eb.y + eb.height / 2, { steps: 3 });
        await page.mouse.move(s.x, s.y, { steps: 8 });
        const g = await t.poll(() => ghost3d(t), 8000);
        t.g = g;
        await t.shot('Vorschau beim Ziehen in 3D');
        return { noFinalShot: true, status: g && g.meshes > 0 && g.translucent > 0 && g.verts.includes(8) ? 'ok' : 'fail', observed: g ? `Vorschau-Objekt „catalog-drop-ghost“ vorhanden: ${g.meshes} Teil(e), davon halbtransparent ${g.translucent}; Eckpunkte je Teil: ${g.verts.join('/')} (das eigene Modell ist ein Quader mit 8 Eckpunkten, die Standardform hätte 24); Position x=${g.x.toFixed(2)} z=${g.z.toFixed(2)}.` : 'Keine Vorschau in 3D.' };
      },
    },
    {
      nr: 2,
      action: 'Loslassen.',
      expected: 'Das platzierte Möbel sieht genauso aus wie die Vorschau.',
      async run(t) {
        const { page } = t;
        const g = (await ghost3d(t)) ?? t.g;
        await page.mouse.up();
        await t.poll(async () => ((await t.count()) === 1 ? 1 : null), 5000);
        const f = (await t.project()).furniture.find((x) => x.name === 'testschrank');
        const gone = await t.poll(async () => ((await ghost3d(t)) === null ? 1 : null), 4000);
        const sizeOk = Math.abs(f.width - 0.8) < 1e-3 && Math.abs(f.height - 2) < 1e-3 && f.model.type === 'gltf';
        // same model: the placed item uses the glTF model and stands where the ghost was
        const there = Math.abs(f.x - g.x) < 0.02 && Math.abs(f.y - g.z) < 0.02;
        await page.waitForTimeout(800);
        await t.shot('Platziert');
        return { status: sizeOk && there && gone ? 'ok' : 'fail', observed: `Platziert: Modelltyp ${f.model.type}, ${f.width}×${f.depth}×${f.height} m, an der Stelle der Vorschau (Δx ${(f.x - g.x).toFixed(3)}, Δy ${(f.y - g.z).toFixed(3)}); Vorschau danach weg: ${!!gone}. Dass beide gleich aussehen, folgt daraus: dasselbe Modell, dieselbe Größe; Screenshots liegen vor.` };
      },
    },
    {
      nr: 3,
      action: 'Dasselbe in den 2D-Plan ziehen.',
      expected: 'Möbel-Symbol in echter Größe als Vorschau.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(800);
        const eb = await t.entry.first().boundingBox();
        const target = await t.planToScreen(2.5, 2.05);
        await page.mouse.move(eb.x + 20, eb.y + eb.height / 2);
        await page.mouse.down();
        await page.mouse.move(eb.x + 40, eb.y + eb.height / 2, { steps: 3 });
        await page.mouse.move(target.x, target.y, { steps: 8 });
        const ghost = page.getByTestId('drop-ghost');
        await ghost.waitFor({ timeout: 5000 });
        const level = await ghost.getAttribute('data-level');
        const gb = await ghost.boundingBox();
        const zoom = await page.evaluate(() => window.__wp.useUiStore.getState().view2d.zoom);
        const tag = await ghost.evaluate((el) => el.tagName + ':' + (el.querySelector('image') ? 'enthält Bild' : 'kein Bild'));
        await t.shot('Vorschau im 2D-Plan');
        await page.mouse.move(eb.x + 20, eb.y + eb.height / 2, { steps: 8 });
        await page.mouse.up();
        const after = await ghost.count();
        const nAfter = await t.count();
        const wantW = 0.8 * zoom;
        const wantH = 0.6 * zoom;
        const big = gb && Math.abs(gb.width - wantW) < Math.max(12, wantW * 0.25) && Math.abs(gb.height - wantH) < Math.max(12, wantH * 0.25);
        return { status: level === 'ok' && big && after === 0 && nAfter === 1 ? 'ok' : 'fail', observed: `Vorschau im Plan (${tag}), Zustand „${level}“; Größe auf dem Bildschirm ${gb?.width.toFixed(0)}×${gb?.height.toFixed(0)} px, erwartet für 80×60 cm bei Zoom ${zoom.toFixed(1)}: ${wantW.toFixed(0)}×${wantH.toFixed(0)} px; nach Zurückziehen in den Katalog Vorschau weg (${after === 0}) und nichts hinzugefügt (Möbel testschrank: ${nAfter}).` };
      },
    },
  ],
};
