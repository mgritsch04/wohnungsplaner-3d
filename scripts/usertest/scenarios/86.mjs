// Fotos an Wänden (#86) – Testschritte aus dem Kommentar in #86.
import { loadFixtures } from './_fixtures.mjs';

const right = (t) => t.page.locator('.panel.right');
const sel = (t, s) => t.page.evaluate((x) => window.__wp.useUiStore.getState().setSelection(x), s);
const photo = async (t) => (await t.project()).photos?.[0];
/** World centre and material of the 3D photo (plan y = world z). */
const photo3d = (t) =>
  t.page.evaluate(() => {
    const { scene, camera } = window.__wp.three;
    let g = null;
    scene.traverse((o) => typeof o.userData?.photoId === 'string' && !g && (g = o));
    if (!g) return null;
    const v = camera.position.clone();
    let mesh = null;
    g.traverse((c) => c.isMesh && !mesh && (mesh = c));
    mesh.getWorldPosition(v);
    const mats = [];
    g.traverse((c) => c.isMesh && mats.push(...[].concat(c.material)));
    return { x: v.x, y: v.y, z: v.z, visible: g.visible && mats.some((m) => m.visible !== false), opacity: Math.min(...mats.map((m) => m.opacity)), transparent: mats.some((m) => m.transparent) };
  });
const wallInfo = async (t) => {
  const p = await t.project();
  const ph = p.photos[0];
  const w = p.walls.find((q) => q.id === ph.wallId);
  const a = p.nodes.find((n) => n.id === w.a);
  const b = p.nodes.find((n) => n.id === w.b);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { a, d, len, thick: w.thickness };
};
/** position of the 3D photo along the wall and signed distance from the wall axis */
const rel = (wi, c) => {
  const dx = c.x - wi.a.x;
  const dy = c.z - wi.a.y;
  return { along: dx * wi.d.x + dy * wi.d.y, off: dx * -wi.d.y + dy * wi.d.x };
};

export default {
  issue: 86,
  name: 'Fotos an Wänden',
  title: 'Fotos an Wänden anbringen (zum Vergleich mit dem Plan)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im 2D-Plan eine Wand anklicken.',
      expected: 'Rechts unter „Eigenschaften“ erscheint der Abschnitt „Fotos“ mit dem Knopf „+ Foto“.',
      async run(t) {
        t.fx = await loadFixtures();
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        const w = p.walls[0];
        t.wid = w.id;
        const a = p.nodes.find((n) => n.id === w.a);
        const b = p.nodes.find((n) => n.id === w.b);
        const s = await t.planToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
        await t.page.mouse.click(s.x, s.y);
        const sl = await t.selection();
        let how = 'per Mausklick';
        if (sl?.id !== w.id) {
          await sel(t, { type: 'wall', id: w.id });
          how = 'per Auswahl gesetzt';
        }
        const ok = await right(t).getByRole('button', { name: '+ Foto' }).isVisible();
        return { status: ok ? 'ok' : 'fail', observed: `Wand ${how} ausgewählt; Abschnitt „Fotos“ mit „+ Foto“ sichtbar: ${ok}.` };
      },
    },
    {
      nr: 2,
      action: '„+ Foto“ klicken und ein Bild wählen.',
      expected: 'Das Bild erscheint als Vorschau in der Liste, ohne Fehlermeldung.',
      async run(t) {
        const chooser = t.page.waitForEvent('filechooser');
        await right(t).getByRole('button', { name: '+ Foto' }).click();
        await (await chooser).setFiles({ name: 'test.png', mimeType: 'image/png', buffer: t.fx.encodeGrayPng(60, 40, (x, y) => (x + y) % 256) });
        await t.page.getByTestId('photo-row').waitFor({ timeout: 8000 });
        const img = await t.page.getByTestId('photo-row').locator('img').isVisible();
        const ph = await photo(t);
        return { status: img && ph ? 'ok' : 'fail', observed: `Vorschau in der Liste sichtbar: ${img}; Foto im Projekt: Seite ${ph?.side}, Breite ${Math.round(ph?.width * 100)} cm, Seitenverhältnis ${ph?.aspect?.toFixed(2)}. Es wurde ein synthetisches Graustufenbild verwendet.` };
      },
    },
    {
      nr: 3,
      action: 'Auf „3D“ wechseln und die Wand betrachten.',
      expected: 'Das Foto hängt auf der Wand, mittig auf Augenhöhe.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1500);
        const c = await photo3d(t);
        const wi = await wallInfo(t);
        const ph = await photo(t);
        const r = rel(wi, c);
        t.r0 = r;
        const mid = r.along;
        const expectedMid = ph.along + ph.width / 2;
        const nearWall = Math.abs(r.off) < wi.thick / 2 + 0.05;
        const eyeHeight = c.y > 1.2 && c.y < 1.8;
        const centered = Math.abs(mid - wi.len / 2) < 0.1;
        await t.shot('86-3d');
        return { status: nearWall && eyeHeight && centered && Math.abs(mid - expectedMid) < 0.02 ? 'ok' : 'fail', observed: `Foto-Mitte in 3D: ${c.y.toFixed(2)} m hoch, ${mid.toFixed(2)} m vom Wandanfang (Wand ${wi.len.toFixed(2)} m lang, Mitte ${(wi.len / 2).toFixed(2)} m), ${Math.abs(r.off).toFixed(3)} m von der Wandachse (Wandstärke ${wi.thick} m). Screenshot 86-3d.` };
      },
    },
    {
      nr: 4,
      action: 'Deckkraft auf etwa 40 % stellen.',
      expected: 'Das Foto wird durchscheinend, die Wand ist dahinter erkennbar.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await sel(t, { type: 'wall', id: t.wid });
        await right(t).getByLabel('Deckkraft des Fotos').fill('40');
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(1200);
        const c = await photo3d(t);
        const ph = await photo(t);
        await t.shot('86-deckkraft');
        return { status: Math.abs(ph.opacity - 0.4) < 0.01 && c.transparent && Math.abs(c.opacity - 0.4) < 0.02 ? 'ok' : 'fail', observed: `Deckkraft im Projekt ${ph.opacity}; Material in 3D: transparent ${c.transparent}, opacity ${c.opacity}. Ob die Wand dahinter „erkennbar“ ist, sieht man im Screenshot 86-deckkraft.` };
      },
    },
    {
      nr: 5,
      action: '„Sichtbar“ abwählen, dann wieder anwählen.',
      expected: 'Das Foto verschwindet und kommt wieder.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await sel(t, { type: 'wall', id: t.wid });
        await t.page.getByLabel('Sichtbar').uncheck();
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(800);
        const off = await photo3d(t);
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await sel(t, { type: 'wall', id: t.wid });
        await t.page.getByLabel('Sichtbar').check();
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(800);
        const on = await photo3d(t);
        const hiddenOk = !off || !off.visible;
        return { status: hiddenOk && on?.visible ? 'ok' : 'fail', observed: `Ausgeblendet: Foto in der 3D-Szene ${off ? 'noch vorhanden, aber unsichtbar=' + !off.visible : 'entfernt'}; wieder eingeblendet: sichtbar ${on?.visible}.` };
      },
    },
    {
      nr: 6,
      action: 'Wandseite auf die andere Seite stellen.',
      expected: 'Das Foto springt auf die gegenüberliegende Seite der Wand (die Auswahl nennt den Raum).',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await sel(t, { type: 'wall', id: t.wid });
        const opts = await right(t).getByLabel('Wandseite').locator('option').allInnerTexts();
        const before = await photo(t);
        await right(t).getByLabel('Wandseite').selectOption(before.side === 'left' ? 'right' : 'left');
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(1000);
        const wi = await wallInfo(t);
        const r = rel(wi, await photo3d(t));
        const flipped = Math.sign(r.off) === -Math.sign(t.r0.off) && Math.abs(r.off) > 0.001;
        return { status: flipped && opts.some((o) => /\(.+\)/.test(o)) ? 'ok' : 'fail', observed: `Auswahl: ${opts.join(" / ")} (die Außenseite hat keinen Raum, daher ohne Namen); Abstand von der Wandachse (mit Vorzeichen) vorher ${t.r0.off.toFixed(3)} m, nachher ${r.off.toFixed(3)} m.` };
      },
    },
    {
      nr: 7,
      action: 'Breite, Abstand vom Wandanfang und Unterkante ändern.',
      expected: 'Das Foto wandert und wächst entsprechend.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await sel(t, { type: 'wall', id: t.wid });
        const set = async (label, v) => {
          const f = right(t).getByRole('textbox', { name: new RegExp(`^${label}`) }).first();
          await f.fill(String(v));
          await f.press('Enter');
        };
        const b = await photo(t);
        await set('Breite', 100);
        await set('Von Wandanfang', 50);
        await set('Unterkante', 60);
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(1000);
        const a = await photo(t);
        const c = await photo3d(t);
        const wi = await wallInfo(t);
        const r = rel(wi, c);
        const h = a.width / a.aspect;
        const ok = Math.abs(a.width - 1) < 0.001 && Math.abs(a.along - 0.5) < 0.001 && Math.abs(a.bottom - 0.6) < 0.001 && Math.abs(r.along - (0.5 + 0.5)) < 0.03 && Math.abs(c.y - (0.6 + h / 2)) < 0.03;
        return { status: ok ? 'ok' : 'fail', observed: `Breite ${Math.round(b.width * 100)} → ${Math.round(a.width * 100)} cm, Abstand ${Math.round(b.along * 100)} → ${Math.round(a.along * 100)} cm, Unterkante ${Math.round(b.bottom * 100)} → ${Math.round(a.bottom * 100)} cm; Foto-Mitte in 3D: ${r.along.toFixed(2)} m vom Wandanfang, ${c.y.toFixed(2)} m hoch (Soll 1,00 m / ${(0.6 + h / 2).toFixed(2)} m).` };
      },
    },
    {
      nr: 8,
      action: 'Seite neu laden (F5).',
      expected: 'Das Foto ist mit allen Einstellungen noch da.',
      async run(t) {
        const before = await photo(t);
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await t.project()).photos?.length === 1);
        const after = await photo(t);
        await sel(t, { type: 'wall', id: t.wid });
        const img = await t.page.getByTestId('photo-row').locator('img').isVisible();
        const same = ['width', 'along', 'bottom', 'opacity', 'side', 'visible'].every((k) => before[k] === after[k]);
        return { status: same && img ? 'ok' : 'fail', observed: `Einstellungen gleich: ${same}; Vorschaubild nach Neuladen sichtbar: ${img}.` };
      },
    },
    {
      nr: 9,
      action: '„Entfernen“ klicken; Rückgängig (Strg+Z).',
      expected: 'Das Foto ist weg; Rückgängig bringt es zurück.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Entfernen' }).click();
        await t.page.waitForTimeout(300);
        const gone = (await t.project()).photos.length === 0;
        await t.page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await t.page.keyboard.press('Control+z');
        await t.page.waitForTimeout(500);
        const back = (await t.project()).photos.length === 1;
        return { status: gone && back ? 'ok' : 'fail', observed: `Nach „Entfernen“ keine Fotos im Projekt: ${gone}; nach Strg+Z wieder 1 Foto: ${back}.` };
      },
    },
  ],
};
