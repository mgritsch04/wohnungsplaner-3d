// Küchenzeile automatisch platzieren: Module ragen nicht durch Wände (#220) – Testschritte aus dem Kommentar in #220.
const left = (t) => t.page.locator('.panel.left');
const blockedBox = (t) => t.page.getByTestId('kitchen-run-blocked');
const kitchenItems = async (t) => (await t.project()).furniture.filter((f) => f.kitchen);

/** Page-side check: kitchen modules inside a wall rectangle or inside other furniture (axis-aligned plan only). */
const overlaps = (t) =>
  t.page.evaluate(() => {
    const p = window.__wp.useProjectStore.getState().project;
    const node = (id) => p.nodes.find((n) => n.id === id);
    const box = (f) => {
      const swap = Math.abs(Math.sin(f.rotation)) > 0.5;
      const w = (swap ? f.depth : f.width) / 2;
      const d = (swap ? f.width : f.depth) / 2;
      return { x0: f.x - w, x1: f.x + w, y0: f.y - d, y1: f.y + d };
    };
    const hit = (a, b, eps) => a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.y0 < b.y1 - eps && a.y1 > b.y0 + eps;
    const out = [];
    for (const f of p.furniture.filter((q) => q.kitchen && !q.kitchen.type?.includes('wall') && q.elevation < 0.1)) {
      const b = box(f);
      for (const w of p.walls) {
        const a = node(w.a);
        const c = node(w.b);
        const h = w.thickness / 2;
        const r = { x0: Math.min(a.x, c.x) - h, x1: Math.max(a.x, c.x) + h, y0: Math.min(a.y, c.y) - h, y1: Math.max(a.y, c.y) + h };
        if (hit(b, r, 0.004)) out.push(`${f.name} in Wand`);
      }
      for (const g of p.furniture) if (g.id !== f.id && !g.kitchen && g.elevation < 0.1 && hit(b, box(g), 0.004)) out.push(`${f.name} in ${g.name}`);
    }
    return out;
  });

export default {
  issue: 220,
  name: 'Küchenzeile: nichts in Wänden',
  title: 'Küchenzeile automatisch platzieren: Module ragen durch eine Wand',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im Wohnzimmer die Nordwand anklicken (oben, auf der Höhe des TV-Lowboards) und links den Tab „Küche“ öffnen.',
      expected: 'Unter der Modulliste steht „Diese Module passen hier nicht und werden nicht gesetzt:“. Mehrere Module sind dort mit „überschneidet sich mit „TV-Lowboard““ aufgeführt.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(700);
        t.p0 = await t.project();
        const s = await t.planToScreen(1.0, -0.06);
        await page.mouse.click(s.x, s.y);
        const sel = await t.selection();
        await left(t).getByRole('button', { name: 'Küche', exact: true }).click();
        const box = blockedBox(t);
        await box.waitFor({ timeout: 5000 }).catch(() => undefined);
        const txt = (await box.count()) ? await box.innerText() : '';
        const n = (txt.match(/überschneidet sich mit „TV-Lowboard“/g) ?? []).length;
        await t.shot('Warnliste vor dem Platzieren');
        return { status: sel?.type === 'wall' && /Diese Module passen hier nicht und werden nicht gesetzt:/.test(txt) && n >= 2 ? 'ok' : 'fail', observed: `Auswahl: ${sel?.type}; Überschrift: „${txt.split('\n')[0]}“; Einträge mit „überschneidet sich mit „TV-Lowboard““: ${n}.` };
      },
    },
    {
      nr: 2,
      action: '„Küchenzeile platzieren“ klicken.',
      expected: 'Nur die freien Module (Hochschrank, Schubladenschrank) werden gesetzt, keins steht im Lowboard oder in einer Wand. Die Meldung nennt, wie viele nicht passten, und die Liste heißt jetzt „Nicht gesetzt, weil sie hier nicht passen:“.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        await page.waitForTimeout(500);
        const k = await kitchenItems(t);
        const names = k.filter((f) => f.kitchen.type !== 'countertop').map((f) => f.name);
        const toast = await page.locator('.toast, [role=status], [role=alert]').allInnerTexts();
        const txt = await blockedBox(t).innerText();
        const ov = await overlaps(t);
        await t.shot('nach dem Platzieren, Wand mit Lowboard');
        const free = names.length === 2 && names.some((n) => /Hochschrank/.test(n)) && names.some((n) => /Schubladen/.test(n));
        return { status: free && ov.length === 0 && /Nicht gesetzt, weil sie hier nicht passen:/.test(txt) && toast.some((x) => /passten nicht/.test(x)) ? 'ok' : 'fail', observed: `Gesetzt: ${names.join(', ')}; Überschneidungen mit Wand/Möbeln: ${ov.length ? ov.join(', ') : 'keine'}; Meldung: „${toast.find((x) => /Küchenmodule/.test(x)) ?? toast.join(' / ')}“; Liste: „${txt.split('\n')[0]}“.` };
      },
    },
    {
      nr: 3,
      action: 'Mit Strg+Z zurück, das TV-Lowboard löschen, die Nordwand wieder anklicken und „Küchenzeile platzieren“ klicken.',
      expected: 'Vorher erscheint keine Warnliste. Alle sechs Module stehen bündig vor der Wand und beginnen an der Innenecke, dazu eine Arbeitsplatte. Im Abschnitt „Konflikte“ steht nichts.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        const afterUndo = (await kitchenItems(t)).length;
        // TV lowboard: click it in the plan and delete it with the Delete key
        const tv = (await t.project()).furniture.find((f) => f.name === 'TV-Lowboard');
        const tvp = await t.planToScreen(tv.x, tv.y);
        await page.mouse.click(tvp.x, tvp.y);
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        const tvGone = !(await t.project()).furniture.some((f) => f.name === 'TV-Lowboard');
        const s = await t.planToScreen(1.0, -0.06);
        await page.mouse.click(s.x, s.y);
        await left(t).getByRole('button', { name: 'Küche', exact: true }).click();
        await page.waitForTimeout(400);
        const warn = await blockedBox(t).count();
        t.warnTxt = warn ? (await blockedBox(t).innerText()).replace(/\n/g, ' / ') : '';
        await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        await page.waitForTimeout(500);
        const k = await kitchenItems(t);
        const mods = k.filter((f) => f.kitchen.type !== 'countertop');
        const top = k.filter((f) => f.kitchen.type === 'countertop');
        const west = Math.min(...mods.map((f) => f.x - f.width / 2));
        const ov = await overlaps(t);
        const konflikte = await page.getByText(/^Konflikte \(/).count();
        await t.shot('Küchenzeile an der Nordwand');
        return { status: afterUndo === 0 && warn === 0 && mods.length === 6 && top.length >= 1 && west >= 0.0 && west < 0.25 && ov.length === 0 && konflikte === 0 ? 'ok' : 'fail', observed: `Nach Strg+Z Küchenmodule: ${afterUndo}; TV-Lowboard angeklickt und mit Entf gelöscht: ${tvGone}; Warnliste vorher: ${warn === 0 ? 'keine' : `ja („${t.warnTxt}“)`}; platziert: ${mods.length} Module + ${top.length} Arbeitsplatte(n); westlichstes Modul beginnt bei x=${west.toFixed(2)} m (Innenecke); Überschneidungen mit Wand/Möbeln: ${ov.length ? ov.join(', ') : 'keine'}; Abschnitt „Konflikte“: ${konflikte === 0 ? 'nicht vorhanden' : 'vorhanden'}.` };
      },
    },
    {
      nr: 4,
      action: 'Eine Wand mit Tür wählen und die Zeile so legen, dass sie über die Tür reichen würde (z. B. „Start ab Wandecke“ erhöhen).',
      expected: 'Module vor der Tür stehen in der Liste mit „steht vor einer Tür“ und werden nicht gesetzt. Die übrigen behalten ihren Platz.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        // keep the door wall free of other furniture so that only the door decides what fits
        await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void (d.furniture = [])));
        const p = await t.project();
        const door = p.openings.find((o) => o.kind === 'door' && o.width >= 0.99);
        const w = p.walls.find((x) => x.id === door.wallId);
        const a = p.nodes.find((n) => n.id === w.a);
        const b = p.nodes.find((n) => n.id === w.b);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        const at = Math.max(0.3, door.offset - door.width / 2 - 0.4);
        const s = await t.planToScreen(a.x + u.x * at, a.y + u.y * at);
        await page.mouse.click(s.x, s.y);
        const sel = await t.selection();
        await left(t).getByRole('button', { name: 'Küche', exact: true }).click();
        const startField = page.getByLabel('Start ab Wandecke');
        const before = (await t.project()).furniture.length;
        let txt = '';
        const tried = [];
        for (const side of ['Seite A', 'Seite B']) {
          await page.getByLabel('Wandseite').selectOption({ label: side });
          await startField.fill(String(Math.round(Math.max(0, door.offset - door.width / 2 - 1.25) * 100)));
          await startField.press('Tab');
          await page.waitForTimeout(300);
          txt = (await blockedBox(t).count()) ? await blockedBox(t).innerText() : '';
          tried.push(`${side}: ${/vor einer Tür/.test(txt) ? 'Tür erkannt' : 'keine Tür-Warnung'}`);
          if (/vor einer Tür/.test(txt)) break;
        }
        await t.shot('Warnung „steht vor einer Tür“');
        const doorLines = txt.split('\n').filter((l) => /vor einer Tür/.test(l));
        await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        await page.waitForTimeout(500);
        const placed = (await t.project()).furniture.filter((f) => f.kitchen && f.kitchen.type !== 'countertop');
        const doorLo = door.offset - door.width / 2;
        const inDoor = placed.some((f) => {
          // module spans along the wall: project its centre on the wall axis
          const c = (f.x - a.x) * u.x + (f.y - a.y) * u.y;
          const half = (Math.abs(u.x) > 0.5 ? (Math.abs(Math.sin(f.rotation)) > 0.5 ? f.depth : f.width) : Math.abs(Math.sin(f.rotation)) > 0.5 ? f.width : f.depth) / 2;
          return c + half > doorLo + 0.01 && c - half < door.offset + door.width / 2 - 0.01;
        });
        return { status: sel?.type === 'wall' && doorLines.length >= 1 && !inDoor && placed.length >= 1 ? 'ok' : 'fail', observed: `Wand mit Tür (Tür bei ${door.offset.toFixed(2)} m, ${door.width} m breit), ${tried.join('; ')}; Liste: „${doorLines.join(' | ')}“; vollständige Liste: „${txt.replace(/\n/g, ' / ')}“; danach gesetzt: ${placed.map((f) => f.name).join(', ') || '–'}; davon vor der Tür: ${inDoor ? 'ja' : 'nein'}.` };
      },
    },
    {
      nr: 5,
      action: 'Viele Unterschränke hinzufügen (+ Unterschrank), bis die Zeile länger ist als die Wand.',
      expected: 'Das Badge „zu lang“ erscheint. Die überzähligen Module stehen mit „passt nicht mehr auf die Wand (Zeile zu lang)“ in der Liste und werden nicht in die Querwand gesetzt.',
      async run(t) {
        const { page } = t;
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        await page.getByLabel('Start ab Wandecke').fill('0');
        await page.getByLabel('Start ab Wandecke').press('Tab');
        const add = page.getByRole('button', { name: '+ Unterschrank' });
        let n = 0;
        while (!(await left(t).getByText('zu lang', { exact: true }).count()) && n < 30) {
          await add.click();
          n++;
        }
        const badge = await left(t).getByText('zu lang', { exact: true }).count();
        const txt = (await blockedBox(t).count()) ? await blockedBox(t).innerText() : '';
        const hits = (txt.match(/passt nicht mehr auf die Wand \(Zeile zu lang\)/g) ?? []).length;
        const before = (await t.project()).furniture.length;
        await page.getByRole('button', { name: 'Küchenzeile platzieren' }).click();
        await page.waitForTimeout(500);
        const ov = await overlaps(t);
        await t.shot('Zeile zu lang');
        return { status: badge >= 1 && hits >= 1 && ov.length === 0 ? 'ok' : 'fail', observed: `Nach ${n} zusätzlichen Unterschränken: Badge „zu lang“ ×${badge}; Liste mit „passt nicht mehr auf die Wand (Zeile zu lang)“ ×${hits}; nach dem Platzieren Überschneidungen mit Wand/Möbeln: ${ov.length ? ov.join(', ') : 'keine'}.` };
      },
    },
    {
      nr: 6,
      optional: true,
      action: 'Optional: Einen Grundriss importieren, bei dem sich Wände an den Ecken nur berühren oder überlappen, und dort eine Küchenzeile platzieren.',
      expected: 'Die Zeile beginnt an der Innenseite der Querwand, und kein Modul ragt in eine Wand.',
      async run() {
        return { status: 'skip', observed: 'Nicht geprüft (braucht einen realen Grundriss-Import; die Logik deckt der Modultest „starts at the inner face of an unconnected cross wall“ ab).' };
      },
    },
  ],
};
