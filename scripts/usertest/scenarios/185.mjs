// Begehen: Klick wählt das Möbel im Fadenkreuz, nicht die Wand dahinter (#185) – Testschritte aus dem Kommentar in #185.
// Die Maus bleibt gefangen (echte Mauserfassung). Wie beim Fehler aus #185 wird sie am linken Rand gefangen,
// danach klickt der Test ohne Mausbewegung: der Browser meldet weiter die Position am Rand, zählen muss das Fadenkreuz.
const canvas = (t) => t.page.locator('[data-testid="scene3d"] canvas');
const locked = (t) => t.page.evaluate(() => document.pointerLockElement?.tagName === 'CANVAS');
const walkTarget = (t) => t.page.evaluate(() => window.__wp.walk.target());

/** Point the walk camera at a floor point (x, y) at height h. */
const aim = (t, x, y, h) =>
  t.page.evaluate(
    ([tx, ty, th]) => {
      const wp = window.__wp;
      const c = wp.three.camera.position;
      wp.walk.look(Math.atan2(-(tx - c.x), -(ty - c.z)), Math.atan2(th - c.y, Math.hypot(tx - c.x, ty - c.z)));
    },
    [x, y, h],
  );

/** Capture click near the left edge of the 3D view (on the floor or a wall, not at the crosshair). */
async function captureClick(t) {
  const b = await canvas(t).boundingBox();
  await t.page.mouse.click(b.x + b.width * 0.08, b.y + b.height * 0.55);
}
/** Click with the captured mouse: no movement, so the view does not turn. */
async function clickHere(t) {
  await t.page.mouse.down();
  await t.page.mouse.up();
}

/** Aim at a piece of furniture, wait until the crosshair is on it, click; returns the selection after the click. */
async function pick(t, f) {
  await aim(t, f.x, f.y, Math.min(0.4, (f.height ?? 0.8) / 2));
  const on = await t.poll(async () => ((await walkTarget(t)) === f.id ? true : null), 4000);
  if (!on) return { on: false };
  await t.page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
  await clickHere(t);
  await t.page.waitForTimeout(400);
  return { on: true, selection: await t.selection() };
}

/** Distance from a furniture centre to the first wall behind it, seen from the camera (plan coordinates), or null. */
async function wallBehind(t, f) {
  const p = await t.project();
  const c = await t.page.evaluate(() => {
    const v = window.__wp.three.camera.position;
    return { x: v.x, y: v.z };
  });
  const node = (id) => p.nodes.find((n) => n.id === id);
  const d = { x: f.x - c.x, y: f.y - c.y };
  const len = Math.hypot(d.x, d.y);
  let best = null;
  for (const w of p.walls) {
    const a = node(w.a);
    const b = node(w.b);
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((a.x - c.x) * e.y - (a.y - c.y) * e.x) / den; // along the view ray (1 = furniture centre)
    const u = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den; // along the wall
    if (s > 1 && u >= 0 && u <= 1 && (best === null || s < best)) best = s;
  }
  return best === null ? null : (best - 1) * len;
}

export default {
  issue: 185,
  name: 'Begehen: Auswahl im Fadenkreuz',
  title: 'Begehen (Ich-Ansicht): Klick wählt oft die Wand dahinter statt des Möbels',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Oben auf „3D“ und dann auf „Begehen“ klicken.',
      expected: 'Ein Fadenkreuz erscheint in der Mitte der 3D-Ansicht.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await canvas(t).waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Begehen' }).click();
        const visible = await page.getByTestId('crosshair').waitFor({ timeout: 8000 }).then(() => true, () => false);
        return visible
          ? { status: 'ok', observed: 'Begehen ist an, das Fadenkreuz steht in der Mitte der 3D-Ansicht.' }
          : { status: 'fail', observed: 'Nach „Begehen“ ist kein Fadenkreuz zu sehen.' };
      },
    },
    {
      nr: 2,
      action: 'Einmal in die 3D-Ansicht klicken, damit die Maus gefangen wird.',
      expected: 'Der Mauszeiger verschwindet, mit der Maus schaust du dich um. Durch diesen ersten Klick wird nichts ausgewählt.',
      async run(t) {
        await t.page.evaluate(() => window.__wp.useUiStore.getState().setSelection(null));
        await captureClick(t);
        // like a user: if the browser refuses the capture, click once more
        let ok = await t.poll(async () => ((await locked(t)) ? true : null), 2500);
        let tries = 1;
        if (!ok) {
          await captureClick(t);
          tries = 2;
          ok = await t.poll(async () => ((await locked(t)) ? true : null), 2500);
        }
        const sel = await t.selection();
        await t.shot('Nach dem ersten Klick (Maus gefangen)');
        return {
          status: ok && !sel ? 'ok' : 'fail',
          observed: `Erster Klick am linken Rand der 3D-Ansicht. Maus gefangen: ${ok ? 'ja' : 'nein'}${tries > 1 ? ' (beim zweiten Klick)' : ''}. Auswahl nach dem Klick: ${sel ? `${sel.type} ${sel.id}` : 'keine'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 3,
      action: 'Mit dem Fadenkreuz auf ein Möbel schauen, hinter dem eine Wand steht, und klicken.',
      expected: 'Das Möbel ist ausgewählt (Rahmen um das Möbel, Eigenschaften rechts) und nicht die Wand dahinter.',
      async run(t) {
        // a piece of furniture in sight with a wall close behind it (seen from where you stand)
        let f = null;
        let gap = null;
        for (const x of (await t.project()).furniture) {
          await aim(t, x.x, x.y, Math.min(0.4, (x.height ?? 0.8) / 2));
          if (!(await t.poll(async () => ((await walkTarget(t)) === x.id ? true : null), 2000))) continue;
          const g = await wallBehind(t, x);
          if (g !== null && g < 1.0) {
            [f, gap] = [x, g];
            break;
          }
        }
        if (!f) return { status: 'fail', observed: 'Kein Möbel im Blick, hinter dem nah eine Wand steht.' };
        const r = await pick(t, f);
        await t.shot(`Nach dem Klick auf „${f.name}“`);
        const ok = r.on && r.selection?.type === 'furniture' && r.selection.id === f.id;
        return {
          status: ok ? 'ok' : 'fail',
          observed: !r.on
            ? `Das Fadenkreuz ließ sich nicht auf „${f.name}“ richten.`
            : `Fadenkreuz auf „${f.name}“, dahinter steht ${Math.round(gap * 100)} cm hinter seiner Mitte eine Wand. Ausgewählt: ${r.selection ? `${r.selection.type === 'furniture' ? 'Möbel' : r.selection.type} ${r.selection.id === f.id ? `„${f.name}“` : r.selection.id}` : 'nichts'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 4,
      action: 'Den Blick auf ein anderes Möbel richten und erneut klicken, mehrmals mit verschiedenen Möbeln.',
      expected: 'Jedes Mal wird genau das Möbel im Fadenkreuz ausgewählt, und nichts verschiebt sich.',
      async run(t) {
        const before = (await t.project()).furniture;
        const first = (await t.selection())?.id;
        const tried = [];
        for (const f of before) {
          if (f.id === first || tried.length >= 3) continue;
          const r = await pick(t, f);
          if (!r.on) continue; // not in sight from here (other room, hidden)
          tried.push({ f, ...r, ok: r.selection?.type === 'furniture' && r.selection.id === f.id });
          await t.shot(`Fadenkreuz auf „${f.name}“, danach geklickt`);
        }
        const after = (await t.project()).furniture;
        const moved = before.filter((b) => {
          const a = after.find((x) => x.id === b.id);
          return !a || a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation;
        });
        const ok = tried.length >= 2 && tried.every((x) => x.ok) && !moved.length;
        return {
          status: ok ? 'ok' : 'fail',
          observed: `${tried.length} weitere Möbel angepeilt: ${tried.map((x) => `„${x.f.name}“ → ${x.ok ? 'ausgewählt' : `stattdessen ${x.selection ? x.selection.id : 'nichts'}`}`).join(', ') || 'keins im Blick'}. Verschoben: ${moved.length ? moved.map((m) => m.name).join(', ') : 'nichts'}.`,
          noFinalShot: true,
        };
      },
    },
    {
      nr: 5,
      action: 'Auf eine Tür schauen und klicken.',
      expected: 'Die Tür öffnet bzw. schließt sich wie bisher.',
      async run(t) {
        const { page } = t;
        const door = (await t.project()).openings.find((o) => o.kind === 'door' && Math.abs(o.width - 0.9) < 1e-6);
        const leaf = await page.evaluate((oid) => {
          const th = window.__wp.three;
          const v = th.scene.getObjectByName(`leaf:${oid}:0`).children[0].getWorldPosition(th.camera.position.clone());
          return { x: v.x, y: v.z };
        }, door.id);
        await aim(t, leaf.x, leaf.y, 1.0);
        const on = await t.poll(async () => ((await page.evaluate(() => window.__wp.walk.targetOpening())) === door.id ? true : null), 4000);
        if (!on) return { status: 'fail', observed: 'Das Fadenkreuz ließ sich nicht auf die Innentür richten.' };
        const was = door.open;
        await clickHere(t);
        const now = await t.poll(async () => {
          const o = (await t.project()).openings.find((x) => x.id === door.id);
          return o.open !== was ? o.open : null;
        }, 4000);
        await page.waitForTimeout(1200);
        await t.shot('Innentür nach dem Klick');
        return {
          status: now !== null ? 'ok' : 'fail',
          observed: now !== null ? `Innentür war ${was ? 'offen' : 'zu'}, nach dem Klick ${now ? 'offen' : 'zu'}.` : `Innentür bleibt ${was ? 'offen' : 'zu'}, der Klick hat nichts bewirkt.`,
          noFinalShot: true,
        };
      },
    },
  ],
};
