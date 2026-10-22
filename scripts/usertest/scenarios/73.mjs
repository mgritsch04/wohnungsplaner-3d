// Dunkelmodus für die Bedienoberfläche (#73) – Testschritte aus dem Kommentar in #73.
import { expect } from '@playwright/test';

/** Relative luminance (0 = black, 1 = white) of the computed background of a selector. */
const lum = (t, sel) =>
  t.page.evaluate((s) => {
    const [r, g, b] = getComputedStyle(document.querySelector(s)).backgroundColor.match(/[\d.]+/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }, sel);
const right = (t) => t.page.locator('.panel.right');
const group = (t) => right(t).getByRole('group', { name: 'Farbschema' });
const pct = (v) => `${Math.round(v * 100)} %`;
const bookmarks = (t) => t.page.getByTestId('bookmarks-menu');

export default {
  issue: 73,
  name: 'Dunkelmodus',
  title: 'Dunkelmodus für die Bedienoberfläche',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '(Teil A) Rechts den Tab Projekt öffnen.',
      expected: 'Ganz oben steht „Oberfläche → Farbschema“ mit Hell / Dunkel / System; ausgewählt ist „System“.',
      async run(t) {
        await t.page.emulateMedia({ colorScheme: 'light' });
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const sys = await group(t).getByRole('button', { name: 'System', exact: true }).getAttribute('aria-pressed');
        const buttons = await group(t).getByRole('button').allInnerTexts();
        return { status: sys === 'true' && ['Hell', 'Dunkel', 'System'].every((b) => buttons.includes(b)) ? 'ok' : 'fail', observed: `Schalter ${buttons.join(' / ')}; „System“ ausgewählt: ${sys}.` };
      },
    },
    {
      nr: 2,
      action: '(Teil A) Dunkel wählen.',
      expected: 'Symbolleiste, Panels, Menüs und Dialoge werden dunkel und bleiben gut lesbar. Der 2D-Plan bleibt hell, 3D bleibt unverändert.',
      async run(t) {
        await group(t).getByRole('button', { name: 'Dunkel', exact: true }).click();
        await t.page.waitForTimeout(400);
        const l = { seite: await lum(t, 'html'), panel: await lum(t, '.panel.right'), leiste: await lum(t, '.toolbar') };
        const plan = await t.page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="editor2d"] svg')).backgroundColor);
        const dark = l.seite < 0.15 && l.panel < 0.15 && l.leiste < 0.15;
        // readable text: text colour much lighter than panel background
        const textLum = await t.page.evaluate(() => {
          const [r, g, b] = getComputedStyle(document.querySelector('.panel.right')).color.match(/[\d.]+/g).map(Number);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        });
        return {
          status: dark && textLum > 0.6 ? 'ok' : 'fail',
          observed: `Helligkeit: Seite ${pct(l.seite)}, Panel ${pct(l.panel)}, Symbolleiste ${pct(l.leiste)}, Panel-Text ${pct(textLum)}. Hintergrund des 2D-Plans: ${plan}.`,
        };
      },
    },
    {
      nr: 3,
      action: '(Teil A) Neu laden.',
      expected: 'Die Oberfläche ist sofort dunkel, ohne hellen Blitz.',
      async run(t) {
        // look at the very first paint: the inline script must set the theme before the page is shown
        await t.page.reload({ waitUntil: 'commit' });
        const early = await t.page.waitForFunction(() => document.documentElement.dataset.theme, null, { timeout: 5000 }).then((h) => h.jsonValue());
        await t.page.locator('input.project-name').waitFor();
        const l = await lum(t, 'html');
        return { status: early === 'dark' && l < 0.15 ? 'ok' : 'fail', observed: `Beim Laden schon data-theme „${early}“, Seitenhelligkeit ${pct(l)}.` };
      },
    },
    {
      nr: 4,
      action: '(Teil A) Export ▾ → „Plan drucken“.',
      expected: 'Das Blatt bleibt weiß.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Mehr', exact: true }).click();
        await page.getByRole('button', { name: /Plan drucken/ }).click();
        await page.locator('.print-page').waitFor();
        const l = await lum(t, '.print-page');
        await t.shot('Druckblatt im Dunkelmodus');
        await page.getByRole('button', { name: 'Schließen', exact: true }).click();
        return { status: l > 0.99 ? 'ok' : 'fail', observed: `Druckblatt-Helligkeit ${pct(l)} (Export steht unter „Mehr ▾“).` };
      },
    },
    {
      nr: 5,
      action: '(Teil A) System wählen und Windows bzw. den Browser auf hell oder dunkel stellen.',
      expected: 'Die App folgt.',
      async run(t) {
        const { page } = t;
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        await group(t).getByRole('button', { name: 'System', exact: true }).click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForTimeout(300);
        const dark = await lum(t, 'html');
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForTimeout(300);
        const light = await lum(t, 'html');
        return { status: dark < 0.15 && light > 0.8 ? 'ok' : 'fail', observed: `System dunkel: Helligkeit ${pct(dark)}; System hell: ${pct(light)}.` };
      },
    },
    {
      nr: 6,
      action: '(Teil B) Im 2D-Plan den Couchtisch mit gedrückter Maustaste ziehen.',
      expected: 'Blaue Maßlinien zu Wänden und Nachbarmöbeln zeigen die Abstände in cm, live. Nach dem Loslassen verschwinden sie.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        const plan = page.getByTestId('editor2d');
        const table = await t.furniture((f) => f.catalogId === 'generic-coffee-table');
        t.table = table;
        const a = await t.planToScreen(table.x, table.y);
        const b = await t.planToScreen(table.x - 0.6, table.y);
        const before = await plan.getByTestId('clearances').count();
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
        const lines = plan.locator('[data-testid="clearance"]');
        await lines.first().waitFor({ timeout: 4000 });
        const texts = await lines.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-side')} ${e.textContent}`));
        await t.shot('Maßlinien beim Ziehen');
        await page.mouse.up();
        await page.waitForTimeout(200);
        const after = await plan.getByTestId('clearances').count();
        return { status: before === 0 && texts.length > 0 && texts.every((x) => /\d+ cm$/.test(x)) && after === 0 ? 'ok' : 'fail', observed: `Vorher ${before} Anzeigen; beim Ziehen ${texts.length} Linien (${texts.join(', ')}); nach dem Loslassen ${after}.` };
      },
    },
    {
      nr: 7,
      action: '(Teil B) Ein Möbel anklicken und Alt halten.',
      expected: 'Die Linien erscheinen, ohne dass etwas bewegt wird.',
      async run(t) {
        const { page } = t;
        const plan = page.getByTestId('editor2d');
        const cur = await t.furniture((f) => f.id === t.table.id);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), cur.id);
        await page.keyboard.down('Alt');
        await page.waitForTimeout(200);
        const shown = await plan.getByTestId('clearances').count();
        const lines = await plan.locator('[data-testid="clearance"]').count();
        await page.keyboard.up('Alt');
        await page.waitForTimeout(200);
        const gone = await plan.getByTestId('clearances').count();
        const still = await t.furniture((f) => f.id === cur.id);
        const moved = Math.hypot(still.x - cur.x, still.y - cur.y);
        return { status: shown === 1 && lines > 0 && gone === 0 && moved < 1e-9 ? 'ok' : 'fail', observed: `Mit Alt: ${lines} Maßlinien, ohne Alt: ${gone} Anzeigen; Möbel um ${moved.toFixed(3)} m bewegt.` };
      },
    },
    {
      nr: 8,
      action: '(Teil B) Einen Teppich ziehen; zwei Möbel auswählen.',
      expected: 'Ein Teppich misst nur zu Wänden. Bei zwei ausgewählten Möbeln gibt es keine Linien.',
      async run(t) {
        const { page } = t;
        const plan = page.getByTestId('editor2d');
        const p = await t.project();
        const rug = p.furniture.find((f) => /teppich|rug/i.test(`${f.name} ${f.catalogId}`));
        if (!rug) return { status: 'fail', observed: 'Kein Teppich im Beispielprojekt gefunden.' };
        // drag the rug by a point not covered by other furniture, so that the rug (and not the sofa on it) is moved
        const others = p.furniture.filter((f) => f.id !== rug.id && f.z + 0 < 99);
        const free = [];
        for (let dx = -rug.width / 2 + 0.1; dx <= rug.width / 2 - 0.1; dx += 0.1)
          for (let dy = -rug.depth / 2 + 0.1; dy <= rug.depth / 2 - 0.1; dy += 0.1) {
            const x = rug.x + dx;
            const y = rug.y + dy;
            if (!others.some((f) => Math.abs(x - f.x) < f.width / 2 + 0.05 && Math.abs(y - f.y) < f.depth / 2 + 0.05)) free.push({ x, y });
          }
        const spot = free[0];
        const a = await t.planToScreen(spot.x, spot.y);
        const b = await t.planToScreen(spot.x + 0.2, spot.y + 0.2);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 5 });
        const sel = await t.selection();
        const hits = await plan.locator('[data-testid="clearance"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-hit')));
        await page.mouse.up();
        const rugOk = sel?.id === rug.id && hits.length > 0 && hits.every((h) => h === 'wall');
        // two pieces of furniture selected: no lines while idle
        const two = p.furniture.filter((f) => f.id !== rug.id).slice(0, 2).map((f) => f.id);
        for (let i = 0; i < two.length; i++) {
          const f = p.furniture.find((x) => x.id === two[i]);
          const s = await t.planToScreen(f.x, f.y);
          if (i) await page.keyboard.down('Shift');
          await page.mouse.click(s.x, s.y);
          if (i) await page.keyboard.up('Shift');
        }
        await page.mouse.move(2, 2);
        const note = await page.getByTestId('multi-note').innerText().catch(() => '');
        const lines = await plan.locator('[data-testid="clearance"]').count();
        return {
          status: rugOk && lines === 0 ? 'ok' : 'fail',
          observed: `Teppich „${rug.name}“ gezogen (ausgewählt: ${sel?.id === rug.id ? 'der Teppich' : 'ein anderes Möbel'}): Maßlinien enden an ${hits.join(', ') || '–'}. Zwei Möbel gewählt („${note}“): ${lines} Linien im Ruhezustand (mit Alt/beim Ziehen zeigt die Mehrfachauswahl seit #94 absichtlich ihre Abstände).`,
        };
      },
    },
    {
      nr: 9,
      action: '(Teil C) 3D öffnen, Ansicht drehen und hineinzoomen. Dann oben rechts „Ansichten ▾“ → „Aktuelle Ansicht speichern …“, Name „Eingang“, Enter.',
      expected: 'Das Lesezeichen „Eingang“ ist gespeichert.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1000);
        for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom 3D: hineinzoomen' }).click();
        await page.waitForTimeout(600);
        t.saved = await page.evaluate(() => {
          const c = window.__wp.three.camera.position;
          return { x: c.x, y: c.y, z: c.z };
        });
        await bookmarks(t).getByRole('button', { name: /^Ansichten/ }).click();
        await bookmarks(t).getByRole('button', { name: 'Aktuelle Ansicht speichern …' }).click();
        await bookmarks(t).getByLabel('Name der Ansicht').fill('Eingang');
        await page.keyboard.press('Enter');
        const names = (await t.project()).cameraBookmarks.map((b) => b.name);
        return { status: names.includes('Eingang') ? 'ok' : 'fail', observed: `Gespeicherte Ansichten im Projekt: ${names.join(', ') || '–'}.` };
      },
    },
    {
      nr: 10,
      action: '(Teil C) Kamera stark verändern und auf „Eingang“ klicken; danach Kamera erneut verändern und Alt+1 drücken.',
      expected: 'Die Kamera fliegt zurück zu „Eingang“, bei Alt+1 springt sie wieder dorthin.',
      async run(t) {
        const { page } = t;
        const pos = () => page.evaluate(() => { const c = window.__wp.three.camera.position; return { x: c.x, y: c.y, z: c.z }; });
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Zoom 3D: herauszoomen' }).click();
        await page.waitForTimeout(600);
        const far1 = d(await pos(), t.saved);
        await bookmarks(t).getByRole('button', { name: /^Eingang/ }).click();
        const back1 = await t.poll(async () => d(await pos(), t.saved) < 0.05, 5000);
        const menuOpen = await bookmarks(t).getByRole('dialog').count();
        if (menuOpen) await bookmarks(t).getByRole('button', { name: /^Ansichten/ }).click();
        for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Zoom 3D: herauszoomen' }).click();
        await page.waitForTimeout(600);
        const far2 = d(await pos(), t.saved);
        await page.keyboard.press('Alt+1');
        const back2 = await t.poll(async () => d(await pos(), t.saved) < 0.05, 6000);
        return { status: far1 > 1 && back1 && far2 > 1 && back2 ? 'ok' : 'fail', observed: `Abstand vor Klick ${far1.toFixed(2)} m → zurück: ${back1 ? 'ja' : 'nein'}; vor Alt+1 ${far2.toFixed(2)} m → zurück: ${back2 ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 11,
      action: '(Teil C) Begehen wählen, ein Stück gehen und die Ansicht als „Flur“ speichern. Zur Übersicht wechseln und auf „Flur“ klicken.',
      expected: 'Du stehst wieder im Begehen-Modus an derselben Stelle.',
      async run(t) {
        const { page } = t;
        const pos = () => page.evaluate(() => { const c = window.__wp.three.camera.position; return { x: c.x, y: c.y, z: c.z }; });
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(800);
        await page.evaluate(() => {
          const c = window.__wp.three.camera;
          c.position.x += 0.6;
          c.position.z -= 0.4;
          window.__wp.walk.look(1.2, -0.1);
        });
        await page.waitForTimeout(300);
        const walkPos = await pos();
        await bookmarks(t).getByRole('button', { name: /^Ansichten/ }).click();
        await bookmarks(t).getByRole('button', { name: 'Aktuelle Ansicht speichern …' }).click();
        await bookmarks(t).getByLabel('Name der Ansicht').fill('Flur');
        await page.keyboard.press('Enter');
        await bookmarks(t).getByRole('button', { name: /^Ansichten/ }).click();
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.waitForTimeout(800);
        const away = d(await pos(), walkPos);
        await bookmarks(t).getByRole('button', { name: /^Ansichten/ }).click();
        await bookmarks(t).getByRole('button', { name: /^Flur/ }).click();
        const mode = await t.poll(async () => (await t.ui()).cameraMode === 'walk', 5000);
        const same = await t.poll(async () => d(await pos(), walkPos) < 0.05, 5000);
        return { status: away > 1 && mode && same ? 'ok' : 'fail', observed: `In der Übersicht ${away.toFixed(2)} m entfernt; nach Klick auf „Flur“: Begehen-Modus ${mode ? 'ja' : 'nein'}, an derselben Stelle ${same ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 12,
      action: '(Teil C) Umbenennen (✎) und löschen (✕), dann Strg+Z. Danach neu laden.',
      expected: 'Das Lesezeichen ist wieder da. Nach dem Neuladen sind die Lesezeichen noch vorhanden.',
      async run(t) {
        const { page } = t;
        const m = bookmarks(t);
        if (!(await m.getByRole('dialog').count())) await m.getByRole('button', { name: /^Ansichten/ }).click();
        await m.getByRole('button', { name: '„Flur“ umbenennen' }).click();
        await m.getByLabel('Neuer Name für „Flur“').fill('Gang');
        await m.getByRole('button', { name: 'OK' }).click();
        const renamed = await m.getByRole('button', { name: /^Gang/ }).count();
        await m.getByRole('button', { name: '„Gang“ löschen' }).click();
        const deleted = (await m.getByRole('button', { name: /^Gang/ }).count()) === 0;
        await page.keyboard.press('Control+z');
        const undone = await t.poll(async () => (await m.getByRole('button', { name: /^Gang/ }).count()) > 0, 3000);
        await page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.reload();
        const names = await t.poll(async () => {
          const n = (await t.project()).cameraBookmarks.map((b) => b.name);
          return n.length === 2 ? n : null;
        }, 6000);
        return { status: renamed && deleted && undone && names?.join() === 'Eingang,Gang' ? 'ok' : 'fail', observed: `Umbenannt: ${renamed ? 'ja' : 'nein'}, gelöscht: ${deleted ? 'ja' : 'nein'}, Strg+Z stellt wieder her: ${undone ? 'ja' : 'nein'}; nach Neuladen: ${names?.join(', ') ?? 'nicht gefunden'}.` };
      },
    },
  ],
};
