// Ruhigere Symbolleiste (#100, #103) und Möbelgruppen (#65) – Testschritte aus dem Kommentar in #100.
const toolbar = (t) => t.page.locator('header.toolbar');
const panel = (t) => t.page.locator('.panel.right');
const past = (t) => t.page.evaluate(() => window.__wp.useProjectStore.getState().past.length);
const sel = async (t) => t.page.evaluate(() => { const s = window.__wp.useUiStore.getState(); return s.selection?.type === 'furniture' ? [s.selection.id, ...s.multi] : []; });
const clickAt = async (t, f) => {
  const s = await t.planToScreen(f.x, f.y);
  await t.page.mouse.click(s.x, s.y);
};
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export default {
  issue: 100,
  name: 'Ruhigere Symbolleiste und Möbelgruppen',
  title: 'Ruhigere Symbolleiste (#100, #103) und Möbelgruppen (#65)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: '(A) Mit der Maus über die Icons fahren.',
      expected: 'Jedes zeigt seinen Namen, wo vorhanden mit Taste, z. B. „Rückgängig (Strg+Z)“.',
      async run(t) {
        await t.freshStart();
        const icons = toolbar(t).locator('button.icon-btn');
        const n = await icons.count();
        const bad = [];
        for (const b of await icons.all()) {
          const label = (await b.getAttribute('aria-label')) ?? '';
          const title = (await b.getAttribute('title')) ?? '';
          if (label.length < 2 || !title.includes(label.split(' ')[0])) bad.push(label || '(ohne Namen)');
        }
        const undo = await t.page.getByRole('button', { name: 'Rückgängig' }).getAttribute('title');
        return { status: n >= 8 && !bad.length && /Strg\+Z/.test(undo) ? 'ok' : 'fail', observed: `${n} Icon-Knöpfe, alle mit Namen und Tooltip-Text (Auffälligkeiten: ${bad.join(', ') || 'keine'}); Rückgängig-Tooltip „${undo}“. Gemessen wurde das Tooltip-Attribut, nicht das tatsächliche Einblenden bei der Maus.` };
      },
    },
    {
      nr: 2,
      action: '(A) Mit Tab durch die Leiste gehen; auf „⋯ (Mehr)“ Enter drücken, mit ↑/↓ wechseln, mit Esc schließen.',
      expected: 'Bei Fokus erscheint der Name unter dem Icon. Enter öffnet das Menü, ↑/↓ wechselt den Eintrag, Esc schließt.',
      async run(t) {
        const more = t.page.getByRole('button', { name: 'Mehr', exact: true });
        // per Tab zur Leiste: der Fokus muss das Mehr-Icon erreichen
        await t.page.locator('input.project-name').focus();
        let reached = false;
        for (let i = 0; i < 40 && !reached; i++) {
          await t.page.keyboard.press('Tab');
          reached = await more.evaluate((e) => e === document.activeElement);
        }
        await t.page.keyboard.press('Enter');
        const menu = t.page.locator('#toolbar-menu-more');
        const opened = (await more.getAttribute('aria-expanded')) === 'true';
        const first = await menu.getByRole('button').first().evaluate((e) => e === document.activeElement);
        await t.page.keyboard.press('ArrowDown');
        const second = await menu.getByRole('button').nth(1).evaluate((e) => e === document.activeElement);
        await t.page.keyboard.press('ArrowUp');
        const back = await menu.getByRole('button').first().evaluate((e) => e === document.activeElement);
        await t.page.keyboard.press('Escape');
        const closed = (await menu.count()) === 0;
        const backFocus = await more.evaluate((e) => e === document.activeElement);
        const cap = await more.evaluate((el) => getComputedStyle(el, '::after').content);
        return { status: reached && opened && first && second && back && closed && backFocus && cap === '"Mehr: Export"' ? 'ok' : 'fail', observed: `Mehr per Tab erreicht: ${reached}; Enter öffnet: ${opened}; Fokus auf erstem Eintrag: ${first}; ↓ → zweiter: ${second}; ↑ → erster: ${back}; Esc schließt: ${closed}, Fokus zurück auf Mehr: ${backFocus}; Beschriftung bei Fokus (::after) ${cap}. Wie die Beschriftung unter dem Icon aussieht, ist Optik.` };
      },
    },
    {
      nr: 3,
      action: '(A) ⋯ › Exportieren ausprobieren.',
      expected: 'Projektpaket, Grundriss, CSV, Drucken und GLB funktionieren wie vorher.',
      async run(t) {
        const more = t.page.getByRole('button', { name: 'Mehr', exact: true });
        const menu = t.page.locator('#toolbar-menu-more');
        const out = [];
        for (const [entry, ext] of [['Projektpaket (.wohnplan.json)', '.json'], ['Grundriss (apartment-plan.json)', '.json'], ['Einkaufsliste (CSV)', '.csv'], ['3D-Modell als GLB …', '.glb']]) {
          await more.click();
          const dl = t.page.waitForEvent('download', { timeout: 8000 });
          await menu.getByRole('button', { name: entry }).click();
          const d = await dl.catch(() => null);
          out.push([entry, d ? d.suggestedFilename() : null, !!d && d.suggestedFilename().endsWith(ext)]);
        }
        await more.click();
        await menu.getByRole('button', { name: 'Plan drucken / PDF / PNG…' }).click();
        const pv = await t.page.getByTestId('print-view').waitFor({ timeout: 5000 }).then(() => true, () => false);
        if (pv) await t.page.getByRole('button', { name: 'Schließen' }).click();
        return { status: out.every((o) => o[2]) && pv ? 'ok' : 'fail', observed: `${out.map((o) => `${o[0]} → ${o[1] ?? 'kein Download'}`).join('; ')}; Druckansicht öffnet: ${pv}. Der Inhalt der Dateien wurde nicht geprüft.` };
      },
    },
    {
      nr: 4,
      action: '(A) 3D und Realismus einschalten.',
      expected: 'In der Leiste steht nur der Tageszeit-Regler, ⋯ › Licht enthält Voreinstellung und Lampen.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.getByRole('button', { name: 'Realismus' }).click();
        const slider = await toolbar(t).getByLabel('Tageszeit', { exact: true }).isVisible();
        const lampsInBar = await toolbar(t).getByLabel('Lampen', { exact: true }).count();
        await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const menu = t.page.locator('#toolbar-menu-more');
        const lic = await menu.getByText('Licht (Realismus)').isVisible();
        const preset = await menu.getByLabel('Tageszeit-Voreinstellung').isVisible();
        const lamps = await menu.getByLabel('Lampen', { exact: true }).isVisible();
        await t.page.keyboard.press('Escape');
        return { status: slider && lampsInBar === 0 && lic && preset && lamps ? 'ok' : 'fail', observed: `Tageszeit-Regler in der Leiste: ${slider}; „Lampen“ in der Leiste: ${lampsInBar}; in Mehr: Abschnitt „Licht (Realismus)“ ${lic}, Voreinstellung ${preset}, Lampen ${lamps}.` };
      },
    },
    {
      nr: 5,
      action: '(A) „Begehen“ wählen.',
      expected: 'Daneben erscheint Stehen/Sitzen und wirkt wie die Taste X.',
      async run(t) {
        await t.page.getByRole('button', { name: 'Begehen' }).click();
        await t.page.getByTestId('crosshair').waitFor();
        const stand = t.page.getByRole('button', { name: 'Stehen', exact: true });
        const sit = t.page.getByRole('button', { name: 'Sitzen', exact: true });
        const s0 = (await stand.getAttribute('aria-pressed')) === 'true';
        await sit.click();
        const s1 = (await sit.getAttribute('aria-pressed')) === 'true' && (await t.page.getByTestId('walk-sit').count()) === 1;
        await t.page.locator('[data-testid="scene3d"]').hover();
        await t.page.keyboard.press('x');
        const s2 = (await stand.getAttribute('aria-pressed')) === 'true' && (await t.page.getByTestId('walk-sit').count()) === 0;
        await t.page.getByRole('button', { name: 'Übersicht' }).click();
        return { status: s0 && s1 && s2 ? 'ok' : 'fail', observed: `Start „Stehen“: ${s0}; Klick „Sitzen“ → sitzend: ${s1}; Taste X → wieder stehend: ${s2}.` };
      },
    },
    {
      nr: 6,
      action: '(A) Projekt ▾ › „Neues leeres Projekt“, die Startkarte schließen, dann Projekt ▾ › „Erste Schritte“.',
      expected: 'Die Karte ist wieder da.',
      async run(t) {
        await t.page.getByRole('button', { name: 'Projekt ▾' }).click();
        const dis = await t.page.getByRole('button', { name: /^Erste Schritte/ }).isDisabled();
        await t.page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await t.page.getByRole('button', { name: 'Neu anlegen' }).click();
        const card = t.page.getByTestId('start-card');
        await card.waitFor();
        await card.getByRole('button', { name: 'Startkarte schließen' }).click();
        const closed = (await card.count()) === 0;
        await t.page.getByRole('button', { name: 'Projekt ▾' }).click();
        await t.page.locator('#toolbar-menu-project').getByRole('button', { name: /^Erste Schritte/ }).click();
        await card.waitFor({ timeout: 3000 });
        return { status: dis && closed && (await card.count()) === 1 ? 'ok' : 'fail', observed: `„Erste Schritte“ beim Beispielprojekt deaktiviert: ${dis}; Karte geschlossen: ${closed}; nach „Erste Schritte“ wieder da: ${(await card.count()) === 1}.` };
      },
    },
    {
      nr: 7,
      action: '(A) Das Fenster auf etwa 1024 px Breite verkleinern.',
      expected: 'Die Leiste bleibt einzeilig.',
      async run(t) {
        await t.freshStart();
        const vp = t.page.viewportSize();
        await t.page.setViewportSize({ width: 1024, height: 800 });
        await t.page.waitForTimeout(500);
        const h = (await toolbar(t).boundingBox()).height;
        await t.shot('96-leiste-1024');
        await t.page.setViewportSize(vp);
        await t.page.waitForTimeout(300);
        return { status: h < 52 ? 'ok' : 'fail', observed: `Höhe der Leiste bei 1024 px Breite: ${Math.round(h)} px (einzeilig bei < 52 px).` };
      },
    },
    {
      nr: 8,
      action: '(B) 2D: Das Bett anklicken, mit Umschalt+Klick beide Nachttische dazunehmen und Strg+G drücken.',
      expected: 'Eine violette gestrichelte Umrandung „Gruppe 1“ mit Drehgriff.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const p = await t.project();
        t.p0 = p;
        t.bed = p.furniture.find((f) => f.catalogId === 'generic-bed-160');
        t.ns = p.furniture.filter((f) => f.catalogId === 'generic-nightstand');
        t.ids = [t.bed.id, ...t.ns.map((n) => n.id)];
        await clickAt(t, t.bed);
        for (const n of t.ns) {
          await t.page.keyboard.down('Shift');
          await clickAt(t, n);
          await t.page.keyboard.up('Shift');
        }
        const b = await past(t);
        await t.page.keyboard.press('Control+g');
        const q = await t.project();
        const whole = await t.page.getByTestId('group-outline').getAttribute('data-whole');
        const rect = t.page.getByTestId('group-outline').locator('rect');
        const dash = await rect.getAttribute('stroke-dasharray');
        const col = await rect.evaluate((e) => getComputedStyle(e).stroke);
        const [r, g, bl] = col.match(/[\d.]+/g).map(Number);
        const label = await t.page.getByTestId('group-label').textContent();
        const handle = await t.page.getByTestId('group-rotate-handle').count();
        t.gid = q.groups[0]?.id;
        await t.shot('100-gruppe');
        const purple = bl > g && r > g;
        return { status: q.groups.length === 1 && whole === 'true' && dash && label === 'Gruppe 1' && handle === 1 && (await past(t)) === b + 1 ? (purple ? 'ok' : 'look') : 'fail', observed: `Gruppe angelegt (${q.groups.length}), Beschriftung „${label}“, gestrichelt (${dash}), Drehgriff: ${handle}, Linienfarbe ${col}${purple ? ' (violett)' : ' (nicht eindeutig violett)'}; ein Rückgängig-Schritt.` };
      },
    },
    {
      nr: 9,
      action: '(B) Esc, dann einen Nachttisch anklicken; danach das Bett ziehen.',
      expected: 'Alle drei sind ausgewählt. Beim Ziehen bewegen sich alle drei gleich und stoppen gemeinsam an der Wand.',
      async run(t) {
        await t.page.keyboard.press('Escape');
        const none = (await sel(t)).length === 0;
        await clickAt(t, t.ns[0]);
        const all = eq(await sel(t), t.ids);
        const note = await panel(t).getByTestId('multi-note').innerText();
        const before = await past(t);
        const a = await t.planToScreen(t.bed.x, t.bed.y);
        const b = await t.planToScreen(t.bed.x, t.bed.y + 0.5);
        await t.page.mouse.move(a.x, a.y);
        await t.page.mouse.down();
        await t.page.mouse.move(b.x, b.y, { steps: 6 });
        await t.page.mouse.up();
        const p = await t.project();
        const d = (id, k) => p.furniture.find((f) => f.id === id)[k] - t.p0.furniture.find((f) => f.id === id)[k];
        const same = t.ids.every((id) => Math.abs(d(id, 'y') - d(t.bed.id, 'y')) < 0.005 && Math.abs(d(id, 'x') - d(t.bed.id, 'x')) < 0.005);
        // gemeinsam an der Wand stoppen: weit nach unten ziehen
        const far = await t.planToScreen(t.bed.x, t.bed.y + 4);
        const cur = await t.planToScreen(t.bed.x, t.bed.y + 0.5);
        await t.page.mouse.move(cur.x, cur.y);
        await t.page.mouse.down();
        await t.page.mouse.move(far.x, far.y, { steps: 10 });
        await t.page.mouse.up();
        const p2 = await t.project();
        const d2 = (id) => p2.furniture.find((f) => f.id === id).y - t.p0.furniture.find((f) => f.id === id).y;
        const stopped = d2(t.bed.id) < 3.9 && t.ids.every((id) => Math.abs(d2(id) - d2(t.bed.id)) < 0.005);
        t.dyStop = d2(t.bed.id);
        t.stopSteps = (await past(t)) - before;
        await t.page.keyboard.press('Control+z'); // nur der Wand-Test wird zurückgenommen, damit Schritt 10 genau einen Zug vorfindet
        return { status: none && all && same && d(t.bed.id, 'y') > 0.3 && stopped ? 'ok' : 'fail', observed: `Esc hebt die Auswahl auf: ${none}; Klick auf Nachttisch wählt alle 3 (${all}), Hinweis „${note.trim()}“; Ziehen um 0,5 m: alle bewegen sich gleich (${same}); weit nach unten gezogen (4 m): Bett stoppt bei ${d2(t.bed.id).toFixed(2)} m Verschiebung, alle gleich: ${stopped}.` };
      },
    },
    {
      nr: 10,
      action: '(B) Einmal Strg+Z.',
      expected: 'Alle drei stehen wieder am Ausgangspunkt.',
      async run(t) {
        await t.page.keyboard.press('Control+z');
        const p = await t.project();
        const away = t.ids.map((id) => Math.hypot(p.furniture.find((f) => f.id === id).x - t.p0.furniture.find((f) => f.id === id).x, p.furniture.find((f) => f.id === id).y - t.p0.furniture.find((f) => f.id === id).y));
        return { status: away.every((a) => a < 1e-6) ? 'ok' : 'fail', observed: `Ein Strg+Z: Abweichung vom Ausgang ${away.map((a) => a.toFixed(3)).join(' / ')} m.` };
      },
    },
    {
      nr: 11,
      action: '(B) Q/E drücken oder den Griff ziehen.',
      expected: 'Die Gruppe dreht sich um ihre Mitte.',
      async run(t) {
        const dist = (p, i, j) => { const f = p.furniture.find((x) => x.id === i); const g = p.furniture.find((x) => x.id === j); return Math.hypot(f.x - g.x, f.y - g.y); };
        const b = await past(t);
        await t.page.keyboard.press('e');
        const p = await t.project();
        const rot = p.furniture.find((f) => f.id === t.bed.id).rotation - t.bed.rotation;
        const keep = Math.abs(dist(p, t.bed.id, t.ns[0].id) - dist(t.p0, t.bed.id, t.ns[0].id)) < 0.01 && Math.abs(dist(p, t.ns[0].id, t.ns[1].id) - dist(t.p0, t.ns[0].id, t.ns[1].id)) < 0.01;
        const steps = (await past(t)) - b;
        await t.page.keyboard.press('Control+z');
        return { status: Math.abs(rot) > 0.05 && keep && steps === 1 ? 'ok' : 'fail', observed: `Taste E: Bett um ${(rot * 180 / Math.PI).toFixed(0)}° gedreht, Abstände zwischen den Mitgliedern gleich: ${keep}, ${steps} Rückgängig-Schritt. Den Griff selbst mit der Maus zu ziehen habe ich nicht getestet.` };
      },
    },
    {
      nr: 12,
      action: '(B) Noch einmal auf das Bett klicken, ohne zu ziehen.',
      expected: 'Jetzt ist nur das Bett ausgewählt.',
      async run(t) {
        await clickAt(t, t.bed);
        const one = eq(await sel(t), [t.bed.id]);
        const whole = await t.page.getByTestId('group-outline').getAttribute('data-whole');
        const txt = await panel(t).getByTestId('group-controls').innerText();
        return { status: one && whole === 'false' && /Teil der Gruppe „Gruppe 1“/.test(txt) ? 'ok' : 'fail', observed: `Nur das Bett ausgewählt: ${one}; Umrandung blass (data-whole=${whole}); Panel: „${txt.replace(/\s+/g, ' ').slice(0, 80)}“.` };
      },
    },
    {
      nr: 13,
      action: '(B) Im Panel den Gruppennamen ändern, z. B. „Schlafbereich“, und neu laden.',
      expected: 'Gruppe und Name sind noch da.',
      async run(t) {
        await panel(t).getByRole('button', { name: 'Ganze Gruppe auswählen' }).click();
        const f = panel(t).getByTestId('group-controls').getByLabel('Name der Gruppe');
        await f.fill('Schlafbereich');
        await f.press('Enter');
        await t.poll(async () => (await t.project()).groups[0]?.name === 'Schlafbereich');
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.page.getByRole('button', { name: '2D', exact: true }).click().catch(() => {});
        await t.page.waitForTimeout(700);
        const q = await t.project();
        const members = q.furniture.filter((f2) => f2.groupId === t.gid).length;
        return { status: q.groups.length === 1 && q.groups[0].name === 'Schlafbereich' && members === 3 ? 'ok' : 'fail', observed: `Nach Neuladen: Gruppen ${JSON.stringify(q.groups.map((g) => g.name))}, Mitglieder ${members}.` };
      },
    },
    {
      nr: 14,
      action: '(B) In 3D ein Mitglied anklicken und ziehen.',
      expected: 'Alle drei sind hervorgehoben, Ziehen bewegt alle.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"]').waitFor();
        await t.page.waitForTimeout(2000);
        const p = await t.project();
        const bed = p.furniture.find((f) => f.id === t.bed.id);
        const s = await t.worldToScreen(bed.x, 0.3, bed.y);
        await t.page.mouse.click(s.x, s.y);
        const all = eq(await sel(t), t.ids);
        const s1 = await t.worldToScreen(bed.x, 0.3, bed.y);
        const s2 = await t.worldToScreen(bed.x - 0.4, 0.3, bed.y);
        await t.page.mouse.move(s1.x, s1.y);
        await t.page.mouse.down();
        await t.page.mouse.move((s1.x + s2.x) / 2, (s1.y + s2.y) / 2, { steps: 5 });
        await t.page.mouse.move(s2.x, s2.y, { steps: 5 });
        await t.page.mouse.up();
        await t.page.waitForTimeout(400);
        const q = await t.project();
        const dxs = t.ids.map((id) => q.furniture.find((f) => f.id === id).x - p.furniture.find((f) => f.id === id).x);
        const moved = dxs.every((d) => Math.abs(d - dxs[0]) < 0.01) && Math.abs(dxs[0]) > 0.1;
        await t.shot('100-gruppe-3d');
        return { status: all && moved ? 'look' : 'fail', observed: `Klick auf das Bett in 3D wählt die ganze Gruppe: ${all}; Ziehen in 3D verschiebt alle um ${dxs.map((d) => (d * 100).toFixed(0) + ' cm').join(' / ')} (gleich: ${moved}). Ob alle drei sichtbar hervorgehoben sind, ist Optik: Screenshot 100-gruppe-3d.` };
      },
    },
    {
      nr: 15,
      action: '(B) Strg+C, Strg+V, dann Strg+Umschalt+G.',
      expected: 'Es entsteht eine neue Gruppe „… (Kopie)“; Strg+Umschalt+G löst die Gruppe auf.',
      async run(t) {
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        const q0 = await t.project();
        await t.page.keyboard.press('Escape');
        await clickAt(t, q0.furniture.find((f) => f.id === t.bed.id));
        const whole = eq(await sel(t), t.ids);
        await t.page.keyboard.press('Control+c');
        await t.page.keyboard.press('Control+v');
        await t.page.waitForTimeout(400);
        const q1 = await t.project();
        const names = q1.groups.map((g) => g.name);
        const copy = names.some((n) => /\(Kopie\)/.test(n));
        const total = q1.furniture.length - q0.furniture.length;
        await t.page.keyboard.press('Control+Shift+G');
        await t.page.waitForTimeout(300);
        const q2 = await t.project();
        return { status: whole && copy && total === 3 && q2.groups.length === q1.groups.length - 1 ? 'ok' : 'fail', observed: `Gruppe ausgewählt: ${whole}; nach Strg+C/V: Gruppen ${JSON.stringify(names)}, ${total} neue Möbel; nach Strg+Umschalt+G: ${q2.groups.length} statt ${q1.groups.length} Gruppen (die eingefügte Gruppe ist aufgelöst).` };
      },
    },
  ],
};
