// [USERTEST] Handy-Ansicht überarbeitet (#164) – Schritte aus Issue #173, in einer iPhone-Emulation
// (390 × 664, Touch, mobiles Chromium). Finger-Gesten laufen über das DevTools-Protokoll.
const nav = (t) => t.page.getByRole('navigation', { name: 'Panels' });
const cam = (t) => t.page.evaluate(() => {
  const c = window.__wp.three.camera;
  return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.rotation.y, fov: c.fov };
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const box = async (t, sel) => t.page.locator(sel).boundingBox();
const mid = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const isBed = (f) => f.catalogId === 'generic-bed-160';

export default {
  issue: 173,
  name: 'Handy-Ansicht',
  title: '[USERTEST] Handy-Ansicht überarbeitet: keine Textmarkierung, Gesten, Begehen (#164)',
  device: 'phone',
  realDevice: [
    'Ob iOS-Safari beim langen Drücken wirklich kein „Kopieren / Nachschlagen“-Fenster zeigt und die Seite nicht zoomt (Chromium kennt diese iOS-Fenster nicht).',
    'Ob die iPhone-Tastatur beim Tippen ins Suchfeld die Seite hineinzoomt (geprüft wird nur die Schriftgröße ≥ 16 px, die das verhindert).',
    'Wie sich echte Finger anfühlen (Tempo, Trägheit, Treffsicherheit); hier sind die Gesten simuliert.',
    'Das Verhalten innerhalb der Claude-App bzw. des Artefakt-Rahmens auf dem iPhone.',
  ],
  steps: [
    {
      nr: 1,
      action: 'App hochkant öffnen.',
      expected: 'Oben zwei schmale Leisten (Projekt/Rückgängig/⋯ und 2D/3D/Kamera), darunter groß der Raum in 3D, unten „Werkzeuge“ und „Details“.',
      async run(t) {
        await t.freshStart();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1500);
        const phone = await t.page.locator('.app.phone').count();
        const tb = await box(t, '.toolbar');
        const ws = await box(t, '.workspace');
        const tools = await nav(t).getByRole('button', { name: 'Werkzeuge' }).isVisible();
        const details = await nav(t).getByRole('button', { name: 'Details' }).isVisible();
        const ok = phone && tb.height < 110 && ws.height > 400 && tools && details;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Handy-Layout ${phone ? 'aktiv' : 'nicht aktiv'}; Leisten oben ${Math.round(tb.height)} px hoch, 3D-Bereich ${Math.round(ws.height)} px; unten „Werkzeuge“ ${tools ? 'da' : 'fehlt'}, „Details“ ${details ? 'da' : 'fehlt'}.`,
        };
      },
    },
    {
      nr: 2,
      action: 'Lange auf Raum, Knöpfe und Texte drücken und darüber wischen.',
      expected: 'Nirgends wird Text blau markiert, kein „Kopieren / Nachschlagen“-Fenster, die Seite zoomt nicht.',
      async run(t) {
        const { page } = t;
        await nav(t).getByRole('button', { name: 'Details' }).tap();
        const text = page.locator('.panel.right').getByText('Gesamtfläche');
        await text.waitFor();
        const tb = await text.boundingBox();
        await page.mouse.move(tb.x + 2, tb.y + tb.height / 2);
        await page.mouse.down();
        await page.mouse.move(tb.x + 300, tb.y + 60, { steps: 5 });
        await page.mouse.up();
        const selected = await page.evaluate(() => String(window.getSelection()));
        const checks = await page.evaluate(() => {
          const sel = (s) => getComputedStyle(document.querySelector(s)).userSelect;
          const blocked = (s) => {
            const el = document.querySelector(s);
            const ev = new Event('selectstart', { bubbles: true, cancelable: true });
            (el.firstChild ?? el).dispatchEvent(ev);
            return ev.defaultPrevented;
          };
          const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
          document.querySelector('.scene3d canvas').dispatchEvent(menu);
          return { panel: sel('.panel.right .panel-scroll'), toolbar: sel('.toolbar'), selectPanel: blocked('.panel.right .panel-scroll'), select3d: blocked('.scene3d'), menu3d: menu.defaultPrevented, scale: window.visualViewport?.scale ?? 1 };
        });
        await t.shot('Nach dem Wischen über den Text „Gesamtfläche“');
        await page.getByRole('button', { name: 'Panel schließen' }).tap();
        const ok = selected === '' && checks.panel === 'none' && checks.toolbar === 'none' && checks.selectPanel && checks.select3d && checks.menu3d && checks.scale === 1;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Markierter Text nach dem Wischen: ${selected ? `„${selected.slice(0, 40)}“` : 'keiner'}. Textauswahl in Panels/Leisten gesperrt: ${checks.panel === 'none' && checks.toolbar === 'none' ? 'ja' : 'nein'}; Browser-Menü beim langen Drücken auf 3D unterdrückt: ${checks.menu3d ? 'ja' : 'nein'}; Seitenzoom ${checks.scale}. Das iOS-Fenster selbst nur am iPhone prüfbar.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'In 3D mit einem Finger über den Raum wischen; zwei Finger auseinander/zusammen.',
      expected: 'Ein Finger dreht die Ansicht, zwei Finger zoomen.',
      async run(t) {
        const c = await box(t, '[data-testid="scene3d"] canvas');
        const c0 = await cam(t);
        await t.touch([{ x: c.x + 60, y: c.y + 110 }], [{ x: c.x + 260, y: c.y + 110 }]);
        await t.page.waitForTimeout(800);
        const c1 = await cam(t);
        const m = mid(c);
        await t.touch([{ x: m.x - 20, y: m.y + 120 }, { x: m.x + 20, y: m.y + 120 }], [{ x: m.x - 110, y: m.y + 120 }, { x: m.x + 110, y: m.y + 120 }]);
        await t.page.waitForTimeout(800);
        const c2 = await cam(t);
        const target = await t.page.evaluate(() => window.__wp.useCameraRig.getState().orbit?.get().target);
        const d1 = dist(c1, target);
        const d2 = dist(c2, target);
        const turned = Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.5;
        const zoomed = d2 < d1 * 0.9;
        return {
          status: turned && zoomed ? 'ok' : 'fail',
          observed: `Ein Finger: Kamera um ${Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1)} m um den Raum gewandert (${turned ? 'gedreht' : 'nicht gedreht'}). Zwei Finger auseinander: Abstand ${d1.toFixed(1)} → ${d2.toFixed(1)} m (${zoomed ? 'hineingezoomt' : 'kein Zoom'}).`,
        };
      },
    },
    {
      nr: 4,
      action: 'Auf ein Möbelstück (Bett) tippen, „Drehen“ antippen, dann ✕.',
      expected: 'Unten eine Leiste mit Namen und Knöpfen Drehen, Duplizieren, Löschen, Details; Drehen dreht das Möbel; ✕ hebt die Auswahl auf.',
      async run(t) {
        const { page } = t;
        // bring the bed into view again (step 3 zoomed in): camera above the bed, looking down at it
        const bed = await t.furniture(isBed);
        await t.lookAt({ x: bed.x - 1.5, y: 4.5, z: bed.y + 3.5 }, { x: bed.x, y: 0.3, z: bed.y });
        await page.waitForTimeout(1500);
        const p = await t.worldToScreen(bed.x, 0.5, bed.y);
        await t.touch([p], [p], 1);
        const selected = await t.poll(async () => (await t.selection())?.id === bed.id);
        const bar = page.getByRole('toolbar', { name: 'Auswahl' });
        const barText = selected ? (await bar.innerText()).replace(/\s+/g, ' ') : '';
        const buttons = selected ? await bar.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent.trim())) : [];
        await t.shot('Bett angetippt: Auswahl-Leiste');
        let rotated = false;
        let cleared = false;
        if (selected) {
          await bar.getByRole('button', { name: /Nach rechts drehen/ }).tap();
          rotated = await t.poll(async () => (await t.furniture(isBed)).rotation !== bed.rotation);
          await bar.getByRole('button', { name: 'Auswahl aufheben' }).tap();
          cleared = (await t.selection()) === null;
        }
        return {
          status: selected && rotated && cleared ? 'ok' : 'fail',
          observed: `Bett ausgewählt: ${selected ? 'ja' : 'nein'}. Leiste: „${barText}“, Knöpfe: ${buttons.join(', ') || '–'}. Gedreht: ${rotated ? 'ja' : 'nein'}. ✕ hebt Auswahl auf: ${cleared ? 'ja' : 'nein'}.`,
        };
      },
    },
    {
      nr: 5,
      action: 'Möbelstück mit dem Finger festhalten und ziehen.',
      expected: 'Es verschiebt sich, die Ansicht dreht sich dabei nicht.',
      async run(t) {
        const bed = await t.furniture(isBed);
        const p = await t.worldToScreen(bed.x, 0.5, bed.y);
        await t.touch([p], [p], 1);
        await t.poll(async () => (await t.selection())?.id === bed.id);
        const c0 = await cam(t);
        await t.touch([p], [{ x: p.x - 40, y: p.y + 10 }], 10);
        const moved = await t.poll(async () => (await t.furniture(isBed)).x !== bed.x);
        const c1 = await cam(t);
        const after = await t.furniture(isBed);
        return {
          status: moved && dist(c0, c1) < 0.01 ? 'ok' : 'fail',
          observed: `Bett von ${bed.x.toFixed(2)}/${bed.y.toFixed(2)} nach ${after.x.toFixed(2)}/${after.y.toFixed(2)} m verschoben; Kamera bewegt um ${dist(c0, c1).toFixed(3)} m (${dist(c0, c1) < 0.01 ? 'Ansicht blieb stehen' : 'Ansicht hat sich bewegt'}).`,
        };
      },
    },
    {
      nr: 6,
      action: '„Werkzeuge“ antippen, am grauen Griff ziehen, Tabs wischen.',
      expected: 'Blatt kommt von unten, Raum rutscht nach oben und bleibt sichtbar; Griff ändert die Höhe; Tabs lassen sich wischen.',
      async run(t) {
        const { page } = t;
        const ws0 = await box(t, '.workspace');
        await nav(t).getByRole('button', { name: 'Werkzeuge' }).tap();
        const panel = page.locator('.panel.left');
        await panel.waitFor();
        await page.waitForTimeout(600);
        const ws1 = await box(t, '.workspace');
        const p1 = await panel.boundingBox();
        await t.shot('Blatt „Werkzeuge“ offen');
        const grip = mid(await box(t, '.panel.left .sheet-grip'));
        await t.touch([grip], [{ x: grip.x, y: grip.y - 150 }]);
        await page.waitForTimeout(500);
        const p2 = await panel.boundingBox();
        await t.shot('Nach dem Hochziehen am Griff');
        const tabs = page.locator('.panel.left .tabs');
        const scrollable = await tabs.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        await tabs.getByRole('button', { name: 'Import' }).scrollIntoViewIfNeeded();
        const importVisible = await tabs.getByRole('button', { name: 'Import' }).isVisible();
        const above = ws1.y + ws1.height <= p1.y + 1;
        const ok = above && ws1.height < ws0.height * 0.65 && p2.height > p1.height + 100 && importVisible;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `3D-Bereich ${Math.round(ws0.height)} → ${Math.round(ws1.height)} px hoch, liegt ${above ? 'über' : 'unter'} dem Blatt. Griff hochziehen: Blatt ${Math.round(p1.height)} → ${Math.round(p2.height)} px. Tab-Reihe ${scrollable ? 'wischbar' : 'passt ganz'}, „Import“ erreichbar: ${importVisible ? 'ja' : 'nein'}.`,
        };
      },
    },
    {
      nr: 7,
      action: 'Im Katalog in das Suchfeld tippen.',
      expected: 'Tastatur kommt, die Seite zoomt nicht hinein; im Feld lässt sich Text normal markieren.',
      async run(t) {
        const { page } = t;
        await page.locator('.panel.left .tabs button', { hasText: 'Katalog' }).tap();
        const input = page.locator('.panel.left input').first();
        await input.tap();
        await input.fill('Sofa');
        const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        const selectable = await input.evaluate((el) => {
          el.select();
          return el.selectionEnd - el.selectionStart;
        });
        return {
          status: size >= 16 && selectable === 4 ? 'ok' : 'fail',
          observed: `Schriftgröße im Suchfeld ${size} px (ab 16 px zoomt iOS nicht). Text „Sofa“ eingetippt und markierbar: ${selectable === 4 ? 'ja' : 'nein'}. Tastatur und Zoom selbst nur am iPhone prüfbar.`,
        };
      },
    },
    {
      nr: 8,
      action: 'Blatt schließen, auf 2D wechseln; zwei Finger auseinander ziehen und verschieben; ein Finger auf leerer Fläche ziehen.',
      expected: 'Plan zoomt und verschiebt sich, kein Möbel bewegt sich; ein Finger auf leerer Fläche verschiebt den Plan.',
      async run(t) {
        const { page } = t;
        await page.locator('.panel.left input').first().fill('');
        await page.getByRole('button', { name: 'Panel schließen' }).tap();
        await page.getByRole('button', { name: '2D', exact: true }).tap();
        await page.locator('[data-testid="editor2d"] svg').waitFor();
        await page.waitForTimeout(600);
        const view = () => page.evaluate(() => window.__wp.useUiStore.getState().view2d);
        const sofa = await t.furniture((f) => f.catalogId === 'generic-sofa-3');
        // one finger on empty space (above the plan) pans the plan
        const v0 = await view();
        const e = await t.planToScreen(sofa.x, -1.2);
        await t.touch([e], [{ x: e.x + 100, y: e.y }]);
        await page.waitForTimeout(500);
        const vPan = await view();
        // two fingers on the sofa spread apart: zoom in, the sofa stays where it is
        const s = await t.planToScreen(sofa.x, sofa.y);
        await t.touch([{ x: s.x - 15, y: s.y }, { x: s.x + 15, y: s.y }], [{ x: s.x - 90, y: s.y + 30 }, { x: s.x + 90, y: s.y + 30 }]);
        await page.waitForTimeout(500);
        const v1 = await view();
        await t.shot('Nach dem Zoomen mit zwei Fingern');
        const still = await t.furniture((f) => f.id === sofa.id);
        const v2 = vPan;
        const ok = v1.zoom > v0.zoom * 2 && still.x === sofa.x && still.y === sofa.y && Math.abs(v2.cx - v0.cx) > 0.3;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Zoom ${v0.zoom.toFixed(0)} → ${v1.zoom.toFixed(0)} px/m; Sofa ${still.x === sofa.x && still.y === sofa.y ? 'unverändert' : 'verschoben'}. Ein Finger auf leerer Fläche: Plan um ${Math.abs(v2.cx - v0.cx).toFixed(2)} m verschoben.`,
        };
      },
    },
    {
      nr: 9,
      action: 'Zurück auf 3D, oben das Männchen (Begehen); Stick nach oben schieben, loslassen; woanders wischen.',
      expected: 'Unten links ein runder Stick, rechts „Ducken“ und „Tragen“; Stick vor → vorwärts gehen; loslassen → stehen; wischen → umsehen.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '3D', exact: true }).tap();
        await page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Begehen' }).tap();
        const stick = page.getByTestId('touch-stick');
        await stick.waitFor();
        await page.waitForTimeout(800);
        const duck = await page.getByRole('button', { name: 'Ducken' }).isVisible();
        const carry = await page.getByRole('button', { name: 'Tragen' }).isVisible();
        await t.shot('Begehen: Stick und Knöpfe');
        const p0 = await cam(t);
        const c = mid(await stick.boundingBox());
        const cdp = (t._cdp ??= await t.context.newCDPSession(page));
        const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
        await send('touchStart', [c]);
        for (let i = 1; i <= 5; i++) await send('touchMove', [{ x: c.x, y: c.y - 12 * i }]);
        await page.waitForTimeout(1200);
        await send('touchEnd', []);
        await page.waitForTimeout(300);
        const p1 = await cam(t);
        await page.waitForTimeout(500);
        const p2 = await cam(t);
        const canvas = await box(t, '[data-testid="scene3d"] canvas');
        const m = mid(canvas);
        await t.touch([{ x: m.x + 60, y: m.y }], [{ x: m.x - 60, y: m.y }]);
        await page.waitForTimeout(500);
        const p3 = await cam(t);
        const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const stood = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const looked = Math.abs(p3.yaw - p2.yaw);
        const ok = duck && carry && walked > 0.3 && stood < 0.02 && looked > 0.2;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Stick, „Ducken“ ${duck ? 'da' : 'fehlt'}, „Tragen“ ${carry ? 'da' : 'fehlt'}. Stick vor: ${walked.toFixed(2)} m gegangen; nach dem Loslassen ${stood.toFixed(3)} m (steht). Wischen: Blick um ${((looked * 180) / Math.PI).toFixed(0)}° gedreht.`,
        };
      },
    },
    {
      nr: 10,
      action: 'Ein Möbel ins Fadenkreuz nehmen und tippen; „Tragen“, dann „Absetzen“. Tür im Fadenkreuz antippen.',
      expected: 'Möbel ausgewählt; Tragen → es wandert mit dem Blick; Absetzen → abgestellt; Tür geht auf/zu.',
      async run(t) {
        const { page } = t;
        const sofa = await t.furniture((f) => f.catalogId === 'generic-sofa-3');
        await page.evaluate(([sx, sy]) => {
          const wp = window.__wp;
          const c = wp.three.camera.position;
          wp.walk.look(Math.atan2(-(sx - c.x), -(sy - c.z)), -Math.atan2(c.y - 0.3, Math.hypot(sx - c.x, sy - c.z)));
        }, [sofa.x, sofa.y]);
        await page.waitForTimeout(400);
        const m = mid(await box(t, '[data-testid="scene3d"] canvas'));
        await page.touchscreen.tap(m.x, m.y);
        const selected = await t.poll(async () => (await t.selection())?.id === sofa.id);
        await page.getByRole('button', { name: 'Tragen' }).tap();
        const carrying = await t.poll(() => page.evaluate(() => window.__wp.useUiStore.getState().walkCarry));
        await t.shot('Sofa wird getragen');
        await page.getByRole('button', { name: 'Absetzen' }).tap();
        const dropped = await t.poll(async () => (await page.evaluate(() => window.__wp.useUiStore.getState().walkCarry)) === null);
        return {
          status: selected && carrying === sofa.id && dropped ? 'ok' : 'fail',
          observed: `Sofa im Fadenkreuz angetippt → ausgewählt: ${selected ? 'ja' : 'nein'}. „Tragen“: ${carrying === sofa.id ? 'trägt das Sofa' : 'trägt nichts'}; „Absetzen“: ${dropped ? 'abgestellt' : 'nicht abgestellt'}. Tür öffnen per Antippen wurde automatisch nicht geprüft (bitte selbst testen).`,
        };
      },
    },
    {
      nr: 11,
      action: 'Oben „⋯“ antippen.',
      expected: 'Menü in voller Breite, oben „Darstellung: Planung / Realismus“, nichts abgeschnitten.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Übersicht' }).tap();
        await page.getByRole('button', { name: 'Mehr', exact: true }).tap();
        const menu = page.locator('.toolbar .menu');
        await menu.waitFor();
        const b = await menu.boundingBox();
        const vw = page.viewportSize().width;
        const first = (await menu.locator('.menu-heading').first().textContent())?.trim();
        const quality = await menu.getByRole('group', { name: 'Qualität' }).isVisible();
        const outside = await menu.locator('button').evaluateAll((els, w) => els.filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > w + 0.5; }).length, vw);
        const ok = b.width >= vw - 24 && first === 'Darstellung' && quality && outside === 0;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Menü ${Math.round(b.width)} von ${vw} px breit; erste Überschrift „${first}“, Planung/Realismus ${quality ? 'sichtbar' : 'fehlt'}; abgeschnittene Knöpfe: ${outside}.`,
        };
      },
    },
    {
      nr: 12,
      action: 'Handy quer halten; „Details“ antippen.',
      expected: 'Werkzeugleiste in einer Zeile; „Details“ öffnet das Blatt rechts neben dem Raum.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Mehr', exact: true }).tap();
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(1000);
        const tb = await box(t, '.toolbar');
        await nav(t).getByRole('button', { name: 'Details' }).tap();
        const panel = page.locator('.panel.right');
        await panel.waitFor();
        await page.waitForTimeout(600);
        const p = await panel.boundingBox();
        const ws = await box(t, '.workspace');
        const oneRow = tb.height < 60;
        const beside = p.x >= ws.x + ws.width - 1 && p.height > 200;
        return {
          status: oneRow && beside ? 'ok' : 'fail',
          observed: `Quer (844 × 390): Leiste ${Math.round(tb.height)} px hoch (${oneRow ? 'eine Zeile' : 'mehrzeilig'}). „Details“-Blatt ${beside ? 'rechts neben dem Raum' : `bei x=${Math.round(p.x)}, ${Math.round(p.width)}×${Math.round(p.height)} px`}.`,
        };
      },
    },
    {
      nr: 13,
      action: 'Am PC öffnen.',
      expected: 'Alles wie bisher: kein Stick, keine Auswahl-Leiste, Qualität oben in der Leiste.',
      async run(t) {
        const ctx = await t.context.browser().newContext({ baseURL: new URL(t.page.url()).origin, viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto('/?e2e');
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(1500);
        const phone = await page.locator('.app.phone').count();
        const quality = await page.locator('.toolbar').getByRole('group', { name: 'Qualität' }).isVisible();
        const sofa = await page.evaluate(() => window.__wp.useProjectStore.getState().project.furniture[0].id);
        await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), sofa);
        await page.waitForTimeout(300);
        const bar = await page.getByRole('toolbar', { name: 'Auswahl' }).count();
        await page.getByRole('button', { name: 'Begehen' }).click();
        await page.waitForTimeout(600);
        const stick = await page.getByTestId('touch-stick').count();
        await page.getByRole('button', { name: 'Übersicht' }).click();
        await page.mouse.move(1, 1);
        await page.screenshot({ path: `${t.outDir}/step-13.jpg`, type: 'jpeg', quality: 72 });
        await ctx.close();
        t.extraShots.push({ file: 'step-13.jpg', caption: 'Desktop-Ansicht (1440 × 900)' });
        const ok = !phone && quality && bar === 0 && stick === 0;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `Desktop 1440 × 900: Handy-Layout ${phone ? 'aktiv (falsch)' : 'aus'}, Qualität oben ${quality ? 'in der Leiste' : 'fehlt'}, Auswahl-Leiste ${bar ? 'da (falsch)' : 'keine'}, Stick beim Begehen ${stick ? 'da (falsch)' : 'keiner'}.`,
          noFinalShot: true,
        };
      },
    },
  ],
};
