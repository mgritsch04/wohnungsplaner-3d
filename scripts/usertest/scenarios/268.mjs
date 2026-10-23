// Rote Markierung bleibt an der alten Stelle (doppelte Möbel-ID) (#268) – Testschritte aus dem Kommentar in #268.
const left = (t) => t.page.locator('.panel.left');
const markerIds = (t) =>
  t.page.evaluate(() => {
    const out = [];
    window.__wp.three?.scene.traverse((o) => typeof o.name === 'string' && /^collision:/.test(o.name) && out.push(o.name.slice('collision:'.length)));
    return out;
  });
const storeProject = (page, json) =>
  page.evaluate(async (j) => {
    const put = (dbName, store, key, value) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onupgradeneeded = () => open.result.createObjectStore(store);
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite');
          tx.objectStore(store).put(value, key);
          tx.oncomplete = () => resolve(null);
          tx.onerror = () => reject(tx.error);
        };
      });
    const proj = JSON.parse(j);
    await put('wohnungsplaner-projects', 'projects', proj.id, j);
    await put('wohnungsplaner-meta', 'meta', 'lastProjectId', proj.id);
  }, json);

export default {
  issue: 268,
  name: 'Doppelte Möbel-ID',
  title: 'Rote Markierung bleibt an der alten Stelle, nachdem ein Möbel aus dem Einrichtungsvorschlag verschoben wurde',
  device: 'desktop',
  pc: false,
  realDevice: [],
  ignoreConsole: [/FileFormatError|inkonsistente Daten/],
  steps: [
    {
      nr: 1,
      action: 'Einen gespeicherten Plan mit einem doppelt vorhandenen Möbel (gleiche ID) laden (F5).',
      expected: 'Der zuletzt geöffnete Plan erscheint; unten steht „Projekt beim Laden repariert: …“.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        const p = await t.project();
        const dup = structuredClone(p.furniture[0]);
        dup.x += 1.2; // die Kopie liegt verschoben woanders
        t.n0 = p.furniture.length;
        t.dupId = p.furniture[0].id;
        await storeProject(page, JSON.stringify({ ...p, name: 'Kaputter Plan', furniture: [...p.furniture, dup] }));
        await page.goto('/?e2e');
        await page.locator('input.project-name').waitFor();
        const name = await page.locator('input.project-name').inputValue();
        const notice = await page.getByText(/Projekt beim Laden repariert/).first().innerText({ timeout: 5000 }).catch(() => '');
        await t.shot('Hinweis „Projekt beim Laden repariert“');
        return { status: name === 'Kaputter Plan' && notice ? 'ok' : 'fail', observed: `Geladener Plan: „${name}“; Hinweis: „${notice.replace(/\n/g, ' ').slice(0, 200)}“.` };
      },
    },
    {
      nr: 2,
      action: 'Im reparierten Plan: kein roter Kasten an einer Stelle ohne Möbel; die verschobene Kopie ist ein normales, löschbares Möbel.',
      expected: 'Jede Markierung gehört zu einem vorhandenen Möbel; die Kopie lässt sich löschen.',
      async run(t) {
        const { page } = t;
        const p = await t.project();
        const ids = new Set(p.furniture.map((f) => f.id));
        const unique = ids.size === p.furniture.length;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const marks = await markerIds(t);
        const orphan = marks.filter((m) => !ids.has(m));
        await page.getByRole('button', { name: '2D', exact: true }).click();
        await page.waitForTimeout(500);
        // die Kopie: das Möbel mit dem Namen des Originals, das nicht die Original-Position hat
        const orig = p.furniture.find((f) => f.id === t.dupId);
        const copy = p.furniture.find((f) => f.id !== t.dupId && f.name === orig.name && Math.abs(f.x - orig.x - 1.2) < 0.01);
        let deleted = false;
        if (copy) {
          await page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), copy.id);
          await page.waitForTimeout(200);
          await page.locator('.panel.right').getByRole('button', { name: /Löschen/ }).first().click().catch(() => page.keyboard.press('Delete'));
          await page.waitForTimeout(400);
          deleted = !(await t.project()).furniture.some((f) => f.id === copy.id);
        }
        return { status: unique && orphan.length === 0 && copy && deleted ? 'ok' : 'fail', observed: `Möbel ${p.furniture.length} (vorher ${t.n0 + 1} gespeichert, eins mit doppelter ID umbenannt), alle IDs eindeutig: ${unique}; Markierungen ohne zugehöriges Möbel: ${orphan.length}; Kopie „${orig.name}“ verschoben gefunden: ${!!copy}, löschbar: ${deleted}.` };
      },
    },
    {
      nr: 3,
      action: 'Reiter „Einrichten“: Vorschlag erstellen und auf „Übernehmen“ schnell mehrmals klicken. Danach ein Möbel verschieben.',
      expected: 'Es bleibt kein roter Kasten zurück.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await left(t).getByRole('button', { name: 'Einrichten' }).click();
        await left(t).getByLabel('Umfang').selectOption({ label: 'Wohnzimmer' });
        await left(t).getByLabel('Möbel hinzufügen').selectOption({ label: 'Zimmerpflanze groß' }).catch(() => undefined);
        await left(t).getByRole('button', { name: 'Vorschlag erstellen' }).click();
        await page.getByTestId('furnish-preview').waitFor();
        const before = (await t.project()).furniture.length;
        // schnell mehrmals hintereinander auf „Übernehmen“ (vier Klicks, bevor die Seite neu zeichnet)
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('.panel.left button')].find((b) => b.textContent.trim() === 'Übernehmen');
          for (let i = 0; i < 4; i++) btn.click();
        });
        await page.waitForTimeout(800);
        const p = await t.project();
        const ids = p.furniture.map((f) => f.id);
        const unique = new Set(ids).size === ids.length;
        const added = p.furniture.length - before;
        // ein Möbel aus dem Vorschlag verschieben (Plan 2D, Ziehen)
        const f = p.furniture.at(-1);
        const a = await t.planToScreen(f.x, f.y);
        const b = await t.planToScreen(f.x + 0.6, f.y + 0.5);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1800);
        const marks = await markerIds(t);
        const ids2 = new Set((await t.project()).furniture.map((q) => q.id));
        const orphan = marks.filter((m) => !ids2.has(m));
        t.ids = ids2.size;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        return { status: unique && orphan.length === 0 && added > 0 ? 'ok' : 'fail', observed: `Mehrfach auf „Übernehmen“ geklickt (4 Klicks): ${added} Möbel neu, alle IDs eindeutig: ${unique}; nach dem Verschieben Markierungen ohne zugehöriges Möbel: ${orphan.length}.` };
      },
    },
    {
      nr: 4,
      action: 'F5: Der Plan lädt ohne Fehlermeldung.',
      expected: 'Plan geladen, kein Reparaturhinweis.',
      async run(t) {
        const { page } = t;
        await page.waitForTimeout(1800);
        const n = (await t.project()).furniture.length;
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const n2 = (await t.project()).furniture.length;
        const hint = await page.getByText(/Projekt beim Laden repariert|konnte nicht geladen/).count();
        return { status: n2 === n && hint === 0 ? 'ok' : 'fail', observed: `Möbel vor/nach F5: ${n}/${n2}; Fehler- oder Reparaturhinweis: ${hint}.` };
      },
    },
    {
      nr: 5,
      optional: true,
      action: 'Falls das Laden doch scheitert: Die Meldung nennt jetzt einen Grund.',
      expected: 'Bei einem unbrauchbaren Plan steht ein Grund in der Meldung.',
      async run(t) {
        const { page } = t;
        const p = await t.project();
        // wirklich unbrauchbar: eine Wand verweist auf einen nicht vorhandenen Knoten
        const bad = structuredClone(p);
        bad.name = 'Unbrauchbarer Plan';
        bad.walls[0].a = 'node_gibt_es_nicht';
        await storeProject(page, JSON.stringify(bad));
        await page.goto('/?e2e');
        await page.waitForTimeout(1500);
        const body = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
        const m = body.match(/(konnte nicht|nicht geladen|abgelehnt|ungültig|Fehler)[^|]{0,200}/i);
        return { status: m ? 'ok' : 'skip', observed: m ? `Meldung: „${m[0].trim()}“.` : 'Der absichtlich kaputte Plan wurde ohne Meldung repariert oder ersetzt; kein Fehlerfall zum Prüfen. Seite: ' + body.slice(0, 160) };
      },
    },
  ],
};
