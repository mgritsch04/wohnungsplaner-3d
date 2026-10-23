// Grundriss-Import: Türen zu breit (Rohbaumaß, verlorenes Wandstück) – Türaufschlag (#267) – Testschritte aus dem Kommentar in #267.
// Plan: SYNTHETISCHES PDF (Raum 5 × 4 m, Zimmertür mit 90 cm Rohbaulücke, Beschriftung „80 / 200“, 20 cm Wandstück an der Ecke).
import { line, pdfOf, quarterArc, roomWalls, text } from './_pdf.mjs';

const T = 0.1;
const plan = () =>
  pdfOf([
    // Nord-, West- und Ostwand wie in roomWalls, Südwand mit Lücke von x = 3,7 bis 4,6
    line(-T, -T, 5 + T, -T), line(T, T, 5 - T, T),
    line(-T, -T, -T, 4 + T), line(T, T, T, 4 - T),
    line(5 + T, -T, 5 + T, 4 + T), line(5 - T, T, 5 - T, 4 - T),
    line(-T, 4 + T, 3.7, 4 + T), line(T, 4 - T, 3.7, 4 - T), line(3.7, 4 - T, 3.7, 4 + T),
    line(4.6, 4 + T, 5 + T, 4 + T), line(4.6, 4 - T, 5 - T, 4 - T), line(4.6, 4 - T, 4.6, 4 + T),
    // Türblatt (Angel bei x = 3,7, Blatt nach innen) und Schwenkbogen
    line(3.7, 4, 3.7, 3.2),
    quarterArc(3.7, 4, 0.8, -Math.PI / 2),
    text(4.0, 3.45, '80 / 200', 8),
    text(2.0, 2.0, 'Zimmer', 14),
  ]);
const left = (t) => t.page.locator('.panel.left');
const draft = (t) => t.page.evaluate(() => window.__wp.useImportStore.getState().draft);
const markers = (t) =>
  t.page.evaluate(() => {
    const out = [];
    window.__wp.three?.scene.traverse((o) => typeof o.name === 'string' && /^collision(-issue)?:/.test(o.name) && out.push(o.name));
    return out;
  });
const board = (name, x, y, w = 1.4, d = 0.4) => ({ category: 'storage', name, color: '#8a8a84', model: { type: 'procedural', shape: 'box' }, quantity: 1, approximate: true, locked: false, existing: false, solid: true, elevation: 0, height: 0.5, rotation: 0, width: w, depth: d, x, y });
const setBoard = (t, b) => t.page.evaluate((it) => window.__wp.useProjectStore.getState().apply((d) => { d.furniture = [{ ...it, id: 'item_ut_board' }]; }), b);
const issuesOf = async (t) => (await markers(t)).filter((n) => /^collision-issue:item_ut_board:/.test(n)).map((n) => n.split(':')[2]);

export default {
  issue: 267,
  name: 'Türbreite beim Import',
  title: 'Grundriss-Import: Türen zu breit (Rohbaumaß, verlorenes Wandstück) – Türaufschlag markiert dadurch Möbel rot',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Neues leeres Projekt, Grundriss importieren, „Erkennung starten“.',
      expected: 'Die Erkennung läuft durch.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        await page.waitForTimeout(500);
        await left(t).getByRole('button', { name: 'Import' }).click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.dropzone').click();
        await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: plan() });
        await page.getByText('Vektorzeichnung', { exact: false }).waitFor({ timeout: 15000 });
        const btn = page.getByRole('button', { name: 'Aus Angabe übernehmen' });
        if (await btn.count()) await btn.click();
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void ((d.underlay.calibrated = true), (d.underlay.scaleSource = 'reference'))));
        await page.getByRole('button', { name: 'Erkennung starten' }).click();
        await page.getByText('Import prüfen').waitFor({ timeout: 25000 });
        return { status: 'ok', observed: 'Erkennung durchgelaufen (synthetisches PDF 1:100).' };
      },
    },
    {
      nr: 2,
      action: 'In „Import prüfen“ die Zimmertür anklicken.',
      expected: 'Breite ca. 0,80 m, Position deckt sich mit der gezeichneten Tür. Das kurze Wandstück zwischen Tür und Ecke ist vorhanden.',
      async run(t) {
        const { page } = t;
        const d = await draft(t);
        t.draft = d;
        const doors = d.openings.filter((o) => o.kind === 'door');
        const o = doors[0];
        if (o) await left(t).getByRole('button', { name: /Tür/ }).first().click().catch(() => undefined);
        // Wand mit der Tür: das Stück zwischen Türrand und Wandende muss Wand bleiben (nicht verloren gehen)
        const wall = o && d.walls.filter((w) => Math.abs((w.a.y + w.b.y) / 2 - o.center.y) < 0.3 && Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 3)[0];
        const wlen = wall ? Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) : 0;
        const ux = wall ? (wall.b.x - wall.a.x) / wlen : 1;
        const s0 = wall ? (o.center.x - wall.a.x) * ux + (o.center.y - wall.a.y) * ((wall.b.y - wall.a.y) / wlen) : 0;
        const gapLeft = s0 - o.width / 2;
        const gapRight = wlen - s0 - o.width / 2;
        const stub = Math.min(gapLeft, gapRight);
        await t.shot('Import prüfen: Tür');
        return { status: doors.length === 1 && Math.abs(o.width - 0.8) < 0.03 && wall && stub > 0.2 && stub < 0.7 ? 'ok' : 'fail', observed: `Türen im Entwurf: ${doors.length}; Breite ${o ? o.width.toFixed(2) : '–'} m (Lücke im Plan 0,90 m, Beschriftung „80 / 200“); Wand mit der Tür ${wlen.toFixed(2)} m lang, Abstand Türrand–Wandende links ${gapLeft.toFixed(2)} m / rechts ${gapRight.toFixed(2)} m (das Wandstück an der Ecke ist da).` };
      },
    },
    {
      nr: 3,
      action: '„In Plan übernehmen“, ein TV-Board an die Türwand stellen, so dass es laut Plan neben dem Türflügel frei steht.',
      expected: 'Keine Rot-Markierung.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'In Plan übernehmen' }).click();
        await page.waitForTimeout(600);
        const dialog = page.getByRole('alertdialog');
        if (await dialog.count()) await dialog.getByRole('button').last().click();
        await page.waitForTimeout(600);
        const p = await t.project();
        const door = p.openings.find((o) => o.kind === 'door');
        const wall = p.walls.find((w) => w.id === door.wallId);
        const node = (id) => p.nodes.find((n) => n.id === id);
        const a = node(wall.a), b = node(wall.b);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        const cx = p.nodes.reduce((q, n) => q + n.x, 0) / p.nodes.length, cy = p.nodes.reduce((q, n) => q + n.y, 0) / p.nodes.length;
        let nx = -uy, ny = ux;
        if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; }
        const xs = p.nodes.map((n) => n.x), ys = p.nodes.map((n) => n.y);
        const bounds = { x0: Math.min(...xs) + 0.1, x1: Math.max(...xs) - 0.1, y0: Math.min(...ys) + 0.1, y1: Math.max(...ys) - 0.1 };
        const at = (s, d) => ({ x: a.x + ux * s + nx * d, y: a.y + uy * s + ny * d });
        const inside = (c) => c.x > bounds.x0 && c.x < bounds.x1 && c.y > bounds.y0 && c.y < bounds.y1;
        t.geo = { door, at, inside };
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        // frei: 2 m links der Tür an der Türwand (Mitte des Boards 0,35 m von der Wandmitte, nach innen)
        const doorS = door.offset;
        let free = null;
        for (const sgn of [-1, 1]) {
          const c = at(doorS + sgn * 1.9, 0.4);
          await setBoard(t, board('TV-Board', c.x, c.y));
          await page.waitForTimeout(700);
          const m = await issuesOf(t);
          if (m.length === 0 && inside(c)) { free = c; break; }
        }
        t.free = free;
        await t.shot('3D: TV-Board neben der Tür');
        return { status: free ? 'ok' : 'fail', observed: `Tür bei ${doorS.toFixed(2)} m auf der Wand, Breite ${door.width.toFixed(2)} m; TV-Board 1,4 × 0,4 m an der Türwand bei ${free ? `(${free.x.toFixed(2)} / ${free.y.toFixed(2)})` : 'keiner geprüften Stelle'} ohne Markierung: ${!!free}.` };
      },
    },
    {
      nr: 4,
      action: 'Das Board in den Schwenkbereich des Türflügels schieben.',
      expected: 'Es wird rot mit „blockiert den Türaufschlag“.',
      async run(t) {
        const { page } = t;
        const { door, at } = t.geo;
        let hit = null;
        for (const [sh, d] of [[0, 0.45], [-0.2, 0.45], [0.2, 0.45], [0, 0.7]]) {
          const c = at(door.offset + sh, d);
          await setBoard(t, board('TV-Board', c.x, c.y, 0.5, 0.3));
          await page.waitForTimeout(600);
          const m = await issuesOf(t);
          if (m.includes('door-swing')) { hit = { c, m }; break; }
        }
        t.swing = hit?.c;
        await t.shot('3D: Board im Schwenkbereich');
        return { status: hit ? 'ok' : 'fail', observed: hit ? `Board bei (${hit.c.x.toFixed(2)} / ${hit.c.y.toFixed(2)}): Markierung(en) ${hit.m.join(', ')} (door-swing = „blockiert den Türaufschlag“).` : 'Keine Stelle im Türbereich löst „blockiert den Türaufschlag“ aus.' };
      },
    },
    {
      nr: 5,
      action: 'Ein Möbel in die Ecke des Türbereichs außerhalb des Viertelkreises stellen.',
      expected: 'Keine Markierung.',
      async run(t) {
        const { page } = t;
        const { door, at } = t.geo;
        // kleines Möbel (0,2 × 0,2 m) in der Türecke: ganz am Rand der Lücke, nahe der Wand, auf der der Flügel nicht schwenkt
        let ok = null;
        const tried = [];
        const { inside } = t.geo;
        for (const d of [0.85, 0.75, 0.65]) {
          for (const sh of [0.45, -0.45, 0.35, -0.35]) {
            const c = at(door.offset + sh, d);
            await setBoard(t, board('Kiste', c.x, c.y, 0.2, 0.2));
            await page.waitForTimeout(500);
            const m = await issuesOf(t);
            tried.push(`${sh}/${d}:${m.join('+') || '–'}`);
            if (!m.length && inside(c)) { ok = { c, sh, d }; break; }
          }
          if (ok) break;
        }
        return { status: ok ? 'ok' : 'fail', observed: `Kleines Möbel in der Türecke ohne Markierung bei ${ok ? `${ok.sh > 0 ? '+' : ''}${ok.sh} m neben der Türmitte, ${ok.d} m von der Wand` : 'keiner Stelle'}; geprüft: ${tried.slice(0, 6).join(' ')}. (Abstand zur Türachse und Wand per Rastersuche, nicht von Hand.)` };
      },
    },
  ],
};
