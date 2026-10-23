// Steckdosen, Schalter und Heizkörper platzieren (#64) – Testschritte aus dem Kommentar in #64.
import { expect } from '@playwright/test';

const right = (t) => t.page.locator('.panel.right');
const buttons = (t) => t.page.getByTestId('fixture-buttons');
const fixtures = async (t) => (await t.project()).fixtures;
/** A point 25 cm inside the first room, in front of the wall `edge`. */
async function nearWall(t, edge, along = 0.5) {
  const p = await t.project();
  const pts = p.rooms[0].nodeIds.map((id) => p.nodes.find((n) => n.id === id));
  const a = pts[edge % pts.length];
  const b = pts[(edge + 1) % pts.length];
  const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  const m = { x: a.x + (b.x - a.x) * along, y: a.y + (b.y - a.y) * along };
  const l = Math.hypot(c.x - m.x, c.y - m.y);
  return { x: m.x + ((c.x - m.x) / l) * 0.25, y: m.y + ((c.y - m.y) / l) * 0.25, mid: c };
}
async function place(t, label, at) {
  await buttons(t).getByRole('button', { name: `+ ${label}`, exact: true }).click();
  await t.page.getByTestId('fixture-placing').waitFor();
  const s = await t.planToScreen(at.x, at.y);
  await t.page.mouse.click(s.x, s.y);
  await expect(t.page.getByTestId('fixture-placing')).toHaveCount(0);
}
const in3d = (t) =>
  t.page.evaluate(() => {
    const ids = new Set();
    window.__wp.three.scene.traverse((o) => typeof o.userData?.fixtureId === 'string' && ids.add(o.userData.fixtureId));
    return [...ids];
  });

export default {
  issue: 64,
  name: 'Installationsplan',
  title: 'Steckdosen, Schalter und Heizkörper platzieren (einfacher Installationsplan)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Links „Werkzeuge" › Gruppe „Steckdosen & Anschlüsse" aufklappen und „+ Steckdose" klicken.',
      expected: 'Hinweis „Jetzt im 2D-Plan auf oder neben eine Wand klicken …" erscheint.',
      async run(t) {
        await t.freshStart();
        await t.page.locator('.panel.left').getByRole('button', { name: /Steckdosen & Anschlüsse/ }).click();
        await buttons(t).getByRole('button', { name: '+ Steckdose', exact: true }).click();
        const txt = await t.page.locator('.panel.left').innerText();
        const m = txt.match(/Jetzt im 2D-Plan auf oder neben eine Wand klicken[^\n]*/);
        return { status: m ? 'ok' : 'fail', observed: `Hinweis: „${m?.[0] ?? '–'}“.` };
      },
    },
    {
      nr: 2,
      action: 'Im 2D-Plan knapp neben eine Wand im Wohnzimmer klicken.',
      expected: 'Eine Steckdose (orangefarbenes Symbol) sitzt direkt an der Wand und ist ausgewählt; rechts stehen „Art", „Höhe 30 cm" und „Anzahl Dosen".',
      async run(t) {
        const at = await nearWall(t, 0, 0.3);
        const s = await t.planToScreen(at.x, at.y);
        await t.page.mouse.click(s.x, s.y);
        const f = (await fixtures(t))[0];
        const sel = await t.selection();
        const props = await t.page.getByTestId('fixture-props').innerText();
        const fill = await t.page.locator(`[data-fixture-id="${f?.id}"] *`).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill') || e.getAttribute('stroke')).filter(Boolean))]);
        return {
          status: f?.kind === 'socket' && sel?.id === f.id && /Art/.test(props) && /Höhe/.test(props) && /Anzahl Dosen/.test(props) && Math.round(f.elevation * 100) === 30 ? 'ok' : 'fail',
          observed: `Steckdose gesetzt (Höhe ${Math.round((f?.elevation ?? 0) * 100)} cm), ausgewählt: ${sel?.id === f?.id}; Eigenschaften zeigen: ${props.replace(/\n+/g, ' | ').slice(0, 120)}; Farben im Symbol: ${fill.join(', ')}.`,
        };
      },
    },
    {
      nr: 3,
      action: 'Mitten in einen Raum klicken, nachdem „+ Lichtschalter" gewählt wurde.',
      expected: 'Meldung „Bitte auf oder nahe an eine Wand klicken", nichts wird gesetzt; Esc beendet den Modus.',
      async run(t) {
        const { page } = t;
        const before = (await fixtures(t)).length;
        await buttons(t).getByRole('button', { name: '+ Lichtschalter', exact: true }).click();
        const at = await nearWall(t, 0);
        const s = await t.planToScreen(at.mid.x, at.mid.y);
        await page.mouse.click(s.x, s.y);
        const msg = await page.getByText('Bitte auf oder nahe an eine Wand klicken').count();
        await page.keyboard.press('Escape');
        const placing = await page.getByTestId('fixture-placing').count();
        const after = (await fixtures(t)).length;
        return { status: msg > 0 && before === after && placing === 0 ? 'ok' : 'fail', observed: `Meldung sichtbar: ${msg > 0}; Elemente ${before} → ${after}; Setzmodus nach Esc: ${placing ? 'aktiv' : 'beendet'}.` };
      },
    },
    {
      nr: 4,
      action: 'Einen Lichtschalter neben einer Tür und einen Heizkörper unter einem Fenster setzen.',
      expected: 'Beide rasten an der Wand ein; der Heizkörper ist als Fläche (80 cm breit) sichtbar.',
      async run(t) {
        const p = await t.project();
        const door = p.openings.find((o) => o.kind === 'door');
        const win = p.openings.find((o) => o.kind === 'window');
        const wallPt = (o, off) => {
          const w = p.walls.find((x) => x.id === o.wallId);
          const a = p.nodes.find((n) => n.id === w.a ?? w.nodeA ?? w.from);
          const b = p.nodes.find((n) => n.id === (w.b ?? w.nodeB ?? w.to));
          return { w, a, b };
        };
        void wallPt;
        // use the opening's world position (derived plan) and set the fixture a little inside the room
        const pos = await t.page.evaluate(([dId, wId]) => {
          const d = window.__wp.useProjectStore.getState().project;
          const find = (id) => d.openings.find((o) => o.id === id);
          const info = (o) => {
            const w = d.walls.find((x) => x.id === o.wallId);
            const ends = Object.values(w).filter((v) => typeof v === 'string' && d.nodes.some((n) => n.id === v));
            const [a, b] = ends.map((id) => d.nodes.find((n) => n.id === id));
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
            const t0 = o.offset ?? o.position ?? 0;
            const cx = a.x + u.x * (t0 + (o.width ?? 0.9) / 2);
            const cy = a.y + u.y * (t0 + (o.width ?? 0.9) / 2);
            return { cx, cy, u, width: o.width };
          };
          return { door: info(find(dId)), win: info(find(wId)) };
        }, [door.id, win.id]);
        // pick the side that is inside a room
        const inside = (x, y) => p.rooms.some((r) => {
          const pts = r.nodeIds.map((id) => p.nodes.find((n) => n.id === id));
          let c = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
          return c;
        });
        const spot = (g, along) => {
          for (const sgn of [1, -1]) {
            const nx = -g.u.y * sgn;
            const ny = g.u.x * sgn;
            const x = g.cx + g.u.x * along + nx * 0.2;
            const y = g.cy + g.u.y * along + ny * 0.2;
            if (inside(x, y)) return { x, y };
          }
          return { x: g.cx + g.u.x * along, y: g.cy + g.u.y * along };
        };
        await place(t, 'Lichtschalter', spot(pos.door, pos.door.width / 2 + 0.25));
        await place(t, 'Heizkörper', spot(pos.win, 0));
        const fx = await fixtures(t);
        const sw = fx.find((f) => f.kind === 'switch');
        const rad = fx.find((f) => f.kind === 'radiator');
        const dWall = (f) => {
          // distance from fixture to nearest wall line
          const q = fx;
          void q;
          return Math.min(...p.walls.map((w) => {
            const ends = Object.values(w).filter((v) => typeof v === 'string' && p.nodes.some((n) => n.id === v));
            const [a, b] = ends.map((id) => p.nodes.find((n) => n.id === id));
            const dx = b.x - a.x, dy = b.y - a.y;
            const tt = Math.max(0, Math.min(1, ((f.x - a.x) * dx + (f.y - a.y) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(f.x - (a.x + tt * dx), f.y - (a.y + tt * dy)) - (w.thickness ?? 0.2) / 2;
          }));
        };
        const gap = [sw, rad].map((f) => (f ? Math.round(dWall(f) * 100) : NaN));
        await t.shot('Schalter und Heizkörper');
        return {
          status: sw && rad && gap.every((g) => g >= -3 && g <= 8) && Math.abs(rad.width - 0.8) < 1e-6 ? 'ok' : 'fail',
          observed: `Lichtschalter ${sw ? 'gesetzt' : 'fehlt'}, Heizkörper ${rad ? `gesetzt (Breite ${Math.round(rad.width * 100)} cm)` : 'fehlt'}; Abstand der Mitte zur Wandfläche (halbe Gerätetiefe): Schalter ${gap[0]} cm, Heizkörper ${gap[1]} cm.`,
        };
      },
    },
    {
      nr: 5,
      action: 'Die Steckdose im Plan entlang der Wand ziehen, dann Strg+Z.',
      expected: 'Sie gleitet an der Wand entlang (springt um Ecken auf die nächste Wand) und kehrt mit Strg+Z zurück.',
      async run(t) {
        const { page } = t;
        const socket = (await fixtures(t)).find((f) => f.kind === 'socket');
        const dir = { x: Math.cos(socket.rotation), y: Math.sin(socket.rotation) };
        const knob = page.locator(`[data-fixture-id="${socket.id}"] circle[fill="#ffffff"]`);
        const kb = await knob.boundingBox();
        const from = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };
        const s0 = await t.planToScreen(socket.x, socket.y);
        const s1 = await t.planToScreen(socket.x + dir.x * 0.5, socket.y + dir.y * 0.5);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((s1.x - s0.x) * i) / 6, from.y + ((s1.y - s0.y) * i) / 6 + (i % 2 ? 6 : -6));
        await page.mouse.up();
        const moved = (await fixtures(t)).find((f) => f.id === socket.id);
        const along = Math.hypot(moved.x - socket.x - dir.x * 0.5, moved.y - socket.y - dir.y * 0.5);
        await page.keyboard.press('Control+z');
        const back = await t.poll(async () => Math.hypot(((await fixtures(t)).find((f) => f.id === socket.id)).x - socket.x, 0) < 1e-6);
        // around the corner: drag towards the neighbouring wall – the socket jumps to that wall and turns with it
        const nb = await nearWall(t, 1, 0.5);
        const c0 = await t.planToScreen(socket.x, socket.y);
        const c1 = await t.planToScreen(nb.x, nb.y);
        const kb2 = await knob.boundingBox();
        const f2 = { x: kb2.x + kb2.width / 2, y: kb2.y + kb2.height / 2 };
        await page.mouse.move(f2.x, f2.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(f2.x + ((c1.x - c0.x) * i) / 8, f2.y + ((c1.y - c0.y) * i) / 8);
        await page.mouse.up();
        const cornered = (await fixtures(t)).find((f) => f.id === socket.id);
        const turned = Math.abs(Math.sin((cornered.rotation - socket.rotation) / 2)) > 0.5; // roughly 90° (or more) different wall
        const distNb = Math.hypot(cornered.x - nb.x, cornered.y - nb.y);
        await page.keyboard.press('Control+z');
        await t.poll(async () => Math.abs(((await fixtures(t)).find((f) => f.id === socket.id)).rotation - socket.rotation) < 1e-6, 3000);
        return {
          status: along < 0.03 && Math.abs(moved.rotation - socket.rotation) < 1e-6 && back && turned && distNb < 0.6 ? 'ok' : 'fail',
          observed: `Um ${Math.round(Math.hypot(moved.x - socket.x, moved.y - socket.y) * 100)} cm entlang der Wand verschoben (Abweichung von der Wandrichtung ${Math.round(along * 100)} cm, Drehung unverändert); Strg+Z bringt sie zurück: ${back ? 'ja' : 'nein'}. Zur Nachbarwand gezogen: springt dorthin (Abstand zum Ziel ${Math.round(distNb * 100)} cm) und dreht sich um ${Math.round(((cornered.rotation - socket.rotation) * 180) / Math.PI)}°: ${turned ? 'ja' : 'nein'}.`,
        };
      },
    },
    {
      nr: 6,
      action: 'Heizkörper anklicken, rechts Breite auf 120 cm stellen; bei der Steckdose „Anzahl Dosen" auf 3.',
      expected: 'Größe ändert sich in 2D und 3D, Name lautet „3-fach-Steckdose".',
      async run(t) {
        const { page } = t;
        const fx = await fixtures(t);
        const rad = fx.find((f) => f.kind === 'radiator');
        const soc = fx.find((f) => f.kind === 'socket');
        await page.locator(`[data-fixture-id="${rad.id}"] circle[fill="#ffffff"]`).click({ force: true });
        const props = page.getByTestId('fixture-props');
        await props.getByRole('textbox', { name: 'Breite' }).fill('120');
        await props.getByRole('textbox', { name: 'Breite' }).press('Enter');
        await page.locator(`[data-fixture-id="${soc.id}"] circle[fill="#ffffff"]`).click({ force: true });
        await props.getByRole('textbox', { name: 'Anzahl Dosen' }).fill('3');
        await props.getByRole('textbox', { name: 'Anzahl Dosen' }).press('Enter');
        const now = await fixtures(t);
        const r2 = now.find((f) => f.id === rad.id);
        const s2 = now.find((f) => f.id === soc.id);
        const label = await page.getByTestId('fixture-props').innerText();
        const shown2d = await page.locator(`[data-fixture-id="${rad.id}"]`).first().boundingBox();
        return {
          status: Math.abs(r2.width - 1.2) < 1e-6 && s2.count === 3 && /3-fach-Steckdose/.test(label) ? 'ok' : 'fail',
          observed: `Heizkörper-Breite ${Math.round(r2.width * 100)} cm, Anzahl Dosen ${s2.count}; Eigenschaften nennen „${(label.match(/3-fach-Steckdose/) ?? ['–'])[0]}“. (Größenänderung in 3D wird im nächsten Schritt über die Szene geprüft.)`,
          shown2d,
        };
      },
    },
    {
      nr: 7,
      action: 'In die 3D-Ansicht schauen und „Begehen" starten.',
      expected: 'Steckdose, Schalter und Heizkörper sind an der Wand in passender Höhe zu sehen und verschwinden beim Begehen nicht.',
      async run(t) {
        const { page } = t;
        const fx = await fixtures(t);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.waitForTimeout(1500);
        const over = await in3d(t);
        // radiator width in 3D: bounding box of its objects
        const rad = fx.find((f) => f.kind === 'radiator');
        const w3 = await page.evaluate((id) => {
          const th = window.__wp.three;
          let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, miny = Infinity;
          th.scene.traverse((g) => {
            if (g.userData?.fixtureId !== id) return;
            g.updateWorldMatrix(true, true);
            g.traverse((o) => {
              if (!o.isMesh) return;
              o.geometry.computeBoundingBox();
              const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
              minx = Math.min(minx, b.min.x); maxx = Math.max(maxx, b.max.x); minz = Math.min(minz, b.min.z); maxz = Math.max(maxz, b.max.z); miny = Math.min(miny, b.min.y);
            });
          });
          return { span: Math.max(maxx - minx, maxz - minz), bottom: miny };
        }, rad.id);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(1500);
        const walk = await in3d(t);
        const want = fx.map((f) => f.id);
        await t.shot('Begehen mit Installationselementen');
        const ok = want.every((id) => over.includes(id)) && want.every((id) => walk.includes(id)) && Math.abs(w3.span - 1.2) < 0.06;
        return { status: ok ? 'ok' : 'fail', observed: `In 3D ${over.length}/${want.length} Elemente (Heizkörper-Breite ${Math.round(w3.span * 100)} cm, Unterkante ${Math.round(w3.bottom * 100)} cm), im Begehen ${walk.length}/${want.length}.` };
      },
    },
    {
      nr: 8,
      action: 'Ein Element anklicken und Entf drücken, dann Strg+Z; Seite neu laden.',
      expected: 'Löschen und Rückgängig funktionieren; nach dem Neuladen sind alle Elemente noch da.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const n0 = (await fixtures(t)).length;
        const f = (await fixtures(t))[1];
        await page.locator(`[data-fixture-id="${f.id}"] circle[fill="#ffffff"]`).click({ force: true });
        await page.keyboard.press('Delete');
        const n1 = (await fixtures(t)).length;
        await page.keyboard.press('Control+z');
        const n2 = await t.poll(async () => ((await fixtures(t)).length === n0 ? n0 : 0), 3000);
        await page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        const kinds = await t.poll(async () => {
          const k = (await fixtures(t)).map((x) => x.kind);
          return k.length === n0 ? k : null;
        }, 6000);
        const cnt = await page.getByTestId('fixture-2d').count();
        return { status: n1 === n0 - 1 && n2 === n0 && kinds && cnt === n0 ? 'ok' : 'fail', observed: `Elemente: ${n0} → nach Entf ${n1} → nach Strg+Z ${n2}; nach Neuladen ${kinds ? kinds.join(', ') : 'nicht vollständig'} (${cnt} im Plan).` };
      },
    },
  ],
};
