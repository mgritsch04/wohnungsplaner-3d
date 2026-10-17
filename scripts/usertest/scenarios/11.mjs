// Projekt speichern und wieder öffnen (#11) – Testschritte aus dem Kommentar in #11.
import { readFileSync } from 'node:fs';

const isSofa = (f) => f.catalogId === 'generic-sofa-3';
const ROOM_NAME = 'Arbeitszimmer Test';
/** What must survive saving, reopening and the package round trip (ids included). */
const content = (p) => JSON.stringify({ walls: p.walls, nodes: p.nodes, openings: p.openings, rooms: p.rooms, furniture: p.furniture });

async function menu(t, entry) {
  await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
  await t.page.getByRole('button', { name: entry }).click();
}
async function state(t) {
  const p = await t.project();
  const sofa = p.furniture.find((f) => f.id === t.sofa.id);
  const room = p.rooms.find((r) => r.id === t.roomId);
  return { p, sofa, room, same: !!sofa && Math.abs(sofa.x - t.sofa.x) < 1e-6 && Math.abs(sofa.y - t.sofa.y) < 1e-6 && room?.name === ROOM_NAME };
}
const describe = (s) => `Sofa bei x ${s.sofa ? s.sofa.x.toFixed(2) : '–'} m, y ${s.sofa ? s.sofa.y.toFixed(2) : '–'} m, Raum „${s.room?.name ?? '–'}“`;

export default {
  issue: 11,
  name: 'Projekt speichern und öffnen',
  title: 'Projekt speichern und wieder öffnen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Projekt › „Neues Beispielprojekt“. Ein Möbelstück verschieben, einen Raum umbenennen (Eigenschaften › Name).',
      expected: 'Änderungen sind sichtbar.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await menu(t, 'Neues Beispielprojekt');
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(600);
        const sofa = await t.furniture(isSofa);
        const s = await t.planToScreen(sofa.x, sofa.y);
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await page.mouse.move(s.x + 30, s.y + 15, { steps: 5 });
        await page.mouse.move(s.x + 60, s.y + 30, { steps: 5 });
        await page.mouse.up();
        const moved = await t.furniture((f) => f.id === sofa.id);
        // rename the room the sofa stands in via Eigenschaften › Name
        const room = (await t.project()).rooms.find((r) => r.name === 'Wohnzimmer');
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'room', id }), room.id);
        const right = page.locator('.panel.right');
        await right.getByRole('button', { name: 'Eigenschaften' }).click();
        const name = right.locator('label.field').filter({ has: page.locator('.field-label', { hasText: /^Name$/ }) }).locator('input');
        await name.fill(ROOM_NAME);
        await name.press('Tab');
        t.sofa = moved;
        t.roomId = room.id;
        const label = await page.locator('[data-testid="editor2d"]').getByText(ROOM_NAME).count();
        const dist = Math.hypot(moved.x - sofa.x, moved.y - sofa.y);
        const s1 = await state(t);
        return {
          status: dist > 0.3 && s1.room?.name === ROOM_NAME && label > 0 ? 'ok' : 'fail',
          observed: `Neues Beispielprojekt angelegt. „${sofa.name}“ im Plan um ${Math.round(dist * 100)} cm verschoben. Raum „Wohnzimmer“ über Eigenschaften › Name in „${s1.room?.name}“ umbenannt, im Plan ${label ? 'sichtbar' : 'nicht sichtbar'}.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Oben links auf die Anzeige achten (nach ein, zwei Sekunden).',
      expected: 'Oben links steht „Gespeichert“.',
      async run(t) {
        const text = await t.poll(async () => {
          const v = (await t.page.locator('.save-state').innerText()).trim();
          return v === 'Gespeichert' ? v : null;
        }, 6000);
        await t.page.waitForTimeout(1200);
        return {
          status: text ? 'ok' : 'fail',
          observed: `Anzeige oben links: „${(await t.page.locator('.save-state').innerText()).trim()}“.`,
          clip: { x: 0, y: 0, width: 720, height: 70 },
          caption: 'Kopfzeile mit der Speicheranzeige',
        };
      },
    },
    {
      nr: 3,
      action: 'Den Browser-Tab schließen und die App neu öffnen.',
      expected: 'Möbelposition und Raumname sind wie vorher.',
      async run(t) {
        await t.reopenTab();
        const s = await state(t);
        return {
          status: s.same ? 'ok' : 'fail',
          observed: `Tab geschlossen, App in einem neuen Tab geöffnet: Projekt „${s.p.name}“, ${describe(s)}${s.same ? ' – wie vorher' : ' – nicht wie vorher'}.`,
        };
      },
    },
    {
      nr: 4,
      action: 'Projekt › „Projekte öffnen…“ – dein Projekt auswählen.',
      expected: 'Möbelposition und Raumname sind wie vorher.',
      async run(t) {
        const { page } = t;
        const before = await t.project();
        // first switch to another project (the sample from the start), so that opening really loads yours from storage
        const openable = () => page.locator('.project-list li').filter({ has: page.getByRole('button', { name: 'Öffnen' }) });
        await menu(t, 'Projekte öffnen…');
        await openable().first().waitFor({ timeout: 5000 });
        const count = await page.locator('.project-list li').count();
        await openable().first().getByRole('button', { name: 'Öffnen' }).click();
        await t.poll(async () => ((await t.project()).id !== before.id ? true : null), 5000);
        const otherShown = (await t.project()).id !== before.id;
        // now yours is the only other entry with „Öffnen“
        await menu(t, 'Projekte öffnen…');
        await openable().first().getByRole('button', { name: 'Öffnen' }).click();
        await t.poll(async () => ((await t.project()).id === before.id ? true : null), 5000);
        await page.waitForTimeout(500);
        const s = await state(t);
        return {
          status: otherShown && s.p.id === before.id && s.same ? 'ok' : 'fail',
          observed: `Projektliste mit ${count} Projekten (beide heißen „Beispielwohnung“). Erst das andere Projekt geöffnet${otherShown ? '' : ' (hat nicht geklappt)'}, dann wieder deins: ${describe(s)}${s.same ? ' – wie vorher' : ' – nicht wie vorher'}.`,
        };
      },
    },
    {
      nr: 5,
      action: 'Export › „Projektpaket (.wohnplan.json)“ – Datei speichern. Dann Projekt › „Neues leeres Projekt“ und Projekt › „Projekt importieren (.wohnplan.json)…“ mit dieser Datei.',
      expected: 'Das importierte Projekt ist identisch (auch eigene GLB-Modelle, falls verwendet).',
      async run(t) {
        const { page } = t;
        const before = await t.project();
        await page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const download = page.waitForEvent('download');
        await page.locator('#toolbar-menu-more').getByRole('button', { name: 'Projektpaket (.wohnplan.json)' }).click();
        const d = await download;
        const file = await d.path();
        const raw = readFileSync(file);
        const size = raw.length;
        const assets = Object.keys(JSON.parse(raw.toString('utf8')).assets ?? {}).length;
        await menu(t, 'Neues leeres Projekt');
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        const empty = await t.poll(async () => ((await t.project()).walls.length === 0 ? true : null), 5000);
        const chooser = page.waitForEvent('filechooser');
        await menu(t, 'Projekt importieren (.wohnplan.json)…');
        await (await chooser).setFiles(file);
        // the same project is still in the list → the app asks; overwrite keeps it identical
        const ask = page.getByRole('button', { name: 'Überschreiben' });
        const asked = await ask.waitFor({ timeout: 4000 }).then(() => true, () => false);
        if (asked) await ask.click();
        await t.poll(async () => ((await t.project()).id === before.id ? true : null), 5000);
        await page.waitForTimeout(500);
        const after = await t.project();
        const same = content(after) === content(before) && after.name === before.name;
        return {
          status: empty && same ? 'ok' : 'fail',
          observed: `Paket „${d.suggestedFilename()}“ (${Math.round(size / 1024)} KB) heruntergeladen. Neues leeres Projekt ${empty ? 'angelegt' : 'nicht leer'}. Import${asked ? ' (Rückfrage „Überschreiben“ bestätigt, weil das Projekt noch gespeichert ist)' : ''}: Projekt „${after.name}“ mit ${after.walls.length} Wänden, ${after.rooms.length} Räumen, ${after.furniture.length} Möbeln – ${same ? 'Wände, Räume, Öffnungen und Möbel genau wie vor dem Export' : 'weicht vom Stand vor dem Export ab'}. Eigene Dateien (GLB-Modelle, Grundriss-Bild) im Paket: ${assets ? assets : 'keine, das Beispielprojekt verwendet keine'}.`,
        };
      },
    },
  ],
};
