// Sanfte Übergänge und Schalter „Animationen“ (#101) – Testschritte aus dem Kommentar in #101.
const right = (t) => t.page.locator('.panel.right');
const motion = (t) => t.page.evaluate(() => document.documentElement.getAttribute('data-motion'));
const choose = async (t, name) => {
  await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
  await right(t).getByRole('group', { name: 'Animationen' }).getByRole('button', { name, exact: true }).click();
};
const dur = (t, sel) => t.page.locator(sel).first().evaluate((e) => getComputedStyle(e).animationDuration);
const camPos = (t) => t.page.evaluate(() => { const c = window.__wp.three.camera.position; return [c.x, c.y, c.z]; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Camera positions sampled while the jump runs (about 1 s, every ~40 ms inside the page). */
const sampleJump = async (t, click) => {
  await t.page.evaluate(() => {
    window.__samples = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      try {
        const c = window.__wp.three.camera.position;
        window.__samples.push([performance.now() - t0, c.x, c.y, c.z]);
      } catch (e) {
        window.__sampleErr = String(e);
      }
      if (performance.now() - t0 > 1600) clearInterval(id);
    }, 30);
  });
  await click();
  await t.page.waitForTimeout(1500);
  const out = await t.page.evaluate(() => window.__samples);
  if (!out.length) throw new Error(`keine Messwerte: ${await t.page.evaluate(() => window.__sampleErr)}`);
  return out;
};

export default {
  issue: 101,
  name: 'Sanfte Übergänge',
  title: 'Sanfte Übergänge in der Oberfläche mit Schalter „Animationen“',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'App öffnen, Panel „Projekt“ → Abschnitt „Oberfläche“: Schalter „Animationen“ (System / An / Aus).',
      expected: 'Sichtbar, Standard „System“.',
      async run(t) {
        await t.freshStart();
        await t.page.evaluate(() => localStorage.clear()).catch(() => {});
        await t.page.reload();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const g = right(t).getByRole('group', { name: 'Animationen' });
        await g.scrollIntoViewIfNeeded();
        const names = await g.getByRole('button').allInnerTexts();
        const pressed = await g.locator('button[aria-pressed="true"]').innerText();
        return { status: names.join('/') === 'System/An/Aus' && pressed === 'System' ? 'ok' : 'fail', observed: `Knöpfe: ${names.join(' / ')}; ausgewählt: „${pressed}“ (nach geleertem lokalem Speicher).` };
      },
    },
    {
      nr: 2,
      action: 'Auf „An“ stellen, dann einen Dialog öffnen (z. B. „Projekte“).',
      expected: 'Hintergrund und Fenster blenden kurz (ca. 0,2 s) sanft ein, kein Springen.',
      async run(t) {
        await choose(t, 'An');
        const attr = await motion(t);
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Projekte öffnen…' }).click();
        await t.page.locator('.modal').first().waitFor();
        const d = [await dur(t, '.modal-backdrop'), await dur(t, '.modal')];
        const names = [await t.page.locator('.modal-backdrop').first().evaluate((e) => getComputedStyle(e).animationName), await t.page.locator('.modal').first().evaluate((e) => getComputedStyle(e).animationName)];
        await t.page.keyboard.press('Escape');
        await t.page.locator('.modal').first().waitFor({ state: 'detached' }).catch(() => {});
        return { status: attr === 'on' && d.every((x) => x === '0.18s') ? 'ok' : 'fail', observed: `data-motion=${attr}; Hintergrund: Animation ${names[0]} ${d[0]}, Fenster: ${names[1]} ${d[1]} (Soll ca. 0,2 s). Gemessen ist die Animation (CSS), nicht der Bildeindruck.` };
      },
    },
    {
      nr: 3,
      action: 'Eine Meldung auslösen (z. B. speichern/exportieren).',
      expected: 'Der Toast gleitet leicht von unten ein.',
      async run(t) {
        await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const dl = t.page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
        await t.page.locator('#toolbar-menu-more').getByRole('button', { name: 'Einkaufsliste (CSV)' }).click();
        await dl;
        await t.page.locator('.toast').first().waitFor({ timeout: 4000 });
        const d = await dur(t, '.toast');
        const n = await t.page.locator('.toast').first().evaluate((e) => getComputedStyle(e).animationName);
        return { status: d === '0.18s' ? 'ok' : 'fail', observed: `Meldung erschien beim CSV-Export; Animation ${n}, Dauer ${d}. Gemessen ist die Animation (CSS), nicht der Bildeindruck „gleitet von unten“.` };
      },
    },
    {
      nr: 4,
      action: 'Eine Kamera-Ansicht (Lesezeichen) in 3D anspringen.',
      expected: 'Die Kamera fährt weich dorthin.',
      async run(t) {
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.locator('[data-testid="scene3d"] canvas').waitFor({ timeout: 20000 });
        await t.page.waitForTimeout(1500);
        const menu = t.page.getByTestId('bookmarks-menu');
        const at = async (label, fn) => { try { return await fn(); } catch (e) { throw new Error(`${label}: ${String(e.message).split('\n')[0]} | ${(await t.page.getByTestId('bookmarks-menu').innerHTML().catch(() => '?')).slice(0, 700)}`); } };
        const saveView = async (name) => {
          await at('Ansichten öffnen', () => menu.getByRole('button', { name: /^Ansichten/ }).click({ timeout: 5000 }));
          await at('Speichern …', () => menu.getByRole('button', { name: 'Aktuelle Ansicht speichern …' }).click({ timeout: 5000 }));
          await at('Name', () => menu.getByLabel('Name der Ansicht').fill(name, { timeout: 5000 }));
          await at('Speichern', () => menu.getByRole('button', { name: 'Speichern', exact: true }).click({ timeout: 5000 }));
          await t.page.keyboard.press('Escape');
        };
        const p1 = await camPos(t);
        await saveView('Nah');
        await t.page.waitForTimeout(300);
        // an einen anderen Ort fahren, dann zur Ansicht „Nah“ springen
        t.jump = async () => {
          await t.lookAt({ x: p1[0] + 5, y: p1[1] + 6, z: p1[2] + 5 }, { x: 2.5, y: 0.5, z: 2 });
          await t.page.waitForTimeout(500);
          return sampleJump(t, async () => {
            const btn = menu.getByRole('button', { name: /^Ansichten/ });
            if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
            await menu.locator('.bookmarks-jump').first().click({ timeout: 5000 });
          });
        };
        const s = await t.jump();
        const start = s[0].slice(1);
        const end = s[s.length - 1].slice(1);
        const mid = s.filter((x) => dist(x.slice(1), start) > 0.05 * dist(end, start) && dist(x.slice(1), end) > 0.05 * dist(end, start));
        t.onCount = mid.length;
        await t.page.keyboard.press('Escape');
        return { status: mid.length >= 3 && dist(end, start) > 1 ? 'ok' : 'fail', observed: `Sprung über „Ansichten“ → „Nah“. Kamera fuhr ${dist(end, start).toFixed(1)} m; ${mid.length} Zwischenpositionen im Abstand von ca. 30 ms gemessen (weiche Fahrt = viele Zwischenschritte). Ob die Fahrt optisch weich wirkt, ist Eindruck.` };
      },
    },
    {
      nr: 5,
      action: 'Auf „Aus“ stellen und Schritte 2–4 wiederholen.',
      expected: 'Dialoge und Meldungen erscheinen sofort, die Kamera springt direkt.',
      async run(t) {
        await t.page.getByRole('button', { name: 'Planung', exact: true }).click().catch(() => {});
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await choose(t, 'Aus');
        const attr = await motion(t);
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Projekte öffnen…' }).click();
        await t.page.locator('.modal').first().waitFor();
        const d1 = [await dur(t, '.modal-backdrop'), await dur(t, '.modal')];
        await t.page.keyboard.press('Escape');
        await t.page.getByRole('button', { name: 'Mehr', exact: true }).click();
        await t.page.locator('#toolbar-menu-more').getByRole('button', { name: 'Einkaufsliste (CSV)' }).click();
        await t.page.locator('.toast').first().waitFor({ timeout: 4000 });
        const d2 = await dur(t, '.toast');
        await t.page.getByRole('button', { name: '3D', exact: true }).click();
        await t.page.waitForTimeout(1500);
        const s = await t.jump();
        const start = s[0].slice(1);
        const end = s[s.length - 1].slice(1);
        const mid = s.filter((x) => dist(x.slice(1), start) > 0.05 * dist(end, start) && dist(x.slice(1), end) > 0.05 * dist(end, start));
        return { status: attr === 'off' && d1.every((x) => x === '0s') && d2 === '0s' && mid.length <= 1 && dist(end, start) > 1 ? 'ok' : 'fail', observed: `data-motion=${attr}; Dialog-Animation ${d1.join('/')}, Toast ${d2}; Kamerasprung: ${dist(end, start).toFixed(1)} m mit ${mid.length} Zwischenpositionen (bei „An“ waren es ${t.onCount}).` };
      },
    },
    {
      nr: 6,
      action: 'Seite neu laden.',
      expected: 'Die Wahl bleibt erhalten.',
      async run(t) {
        await t.page.reload();
        await t.page.waitForTimeout(800);
        const attr = await motion(t);
        await t.page.getByRole('button', { name: '2D', exact: true }).click().catch(() => {});
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const pressed = await right(t).getByRole('group', { name: 'Animationen' }).locator('button[aria-pressed="true"]').innerText();
        return { status: attr === 'off' && pressed === 'Aus' ? 'ok' : 'fail', observed: `Nach Neuladen data-motion=${attr}, Schalter „${pressed}“.` };
      },
    },
    {
      nr: 7,
      action: 'Optional: „Bewegung reduzieren“ im System aktivieren, Schalter auf „System“.',
      expected: 'Wirkt wie „Aus“.',
      async run(t) {
        await t.page.emulateMedia({ reducedMotion: 'reduce' });
        await choose(t, 'System');
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Projekte öffnen…' }).click();
        await t.page.locator('.modal').first().waitFor();
        const d = await dur(t, '.modal');
        await t.page.keyboard.press('Escape');
        await t.page.emulateMedia({ reducedMotion: 'no-preference' });
        await t.page.getByRole('button', { name: /^Projekt ▾/ }).click();
        await t.page.getByRole('button', { name: 'Projekte öffnen…' }).click();
        await t.page.locator('.modal').first().waitFor();
        const d2 = await dur(t, '.modal');
        await t.page.keyboard.press('Escape');
        return { status: d === '0s' && d2 !== '0s' ? 'ok' : 'fail', observed: `„System“ mit Browser-Wunsch „Bewegung reduzieren“: Dialog-Animation ${d}; ohne diesen Wunsch: ${d2}.` };
      },
    },
  ],
};
