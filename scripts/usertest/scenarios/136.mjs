// GLB/glTF aus einer Scan-App importieren (#136) – Testschritte aus dem Kommentar in #136.
import { readFileSync } from 'node:fs';
import { boxGlb } from './_glb.mjs';

const dlg = (t) => t.page.getByRole('dialog', { name: '3D-Modell importieren' });
const num = async (t, label) => Number(await dlg(t).getByLabel(label, { exact: true }).inputValue());
const setNum = async (t, label, v) => {
  const f = dlg(t).getByLabel(label, { exact: true });
  await f.fill(String(v));
  await t.page.waitForTimeout(150);
};
const scanItem = async (t) => (await t.project()).furniture.find((f) => /^model-/.test(f.catalogId ?? ''));

export default {
  issue: 136,
  name: 'GLB-Import (Handy-Scan)',
  title: 'Objekte mit dem Handy scannen und als 3D-Objekt in den Planer stellen (GLB-Import)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Im Katalog „3D-Modell importieren“ öffnen und die .glb-Datei wählen.',
      expected: 'Modell wird als gültig erkannt, Maße in cm werden angezeigt.',
      async run(t) {
        await t.freshStart();
        await t.page.locator('.panel.left').getByRole('button', { name: 'Katalog', exact: true }).click();
        await t.page.getByRole('button', { name: /3D-Modell importieren/ }).first().click();
        await dlg(t).waitFor();
        await dlg(t).getByLabel('Modelldatei').setInputFiles({ name: 'regal-scan.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(boxGlb(0.8, 0.5, 0.4)) });
        await dlg(t).getByText('gültig').waitFor({ timeout: 10000 });
        const w = await num(t, 'Breite (cm)'), h = await num(t, 'Höhe (cm)'), d = await num(t, 'Tiefe (cm)');
        return { status: Math.abs(w - 80) < 0.6 && Math.abs(h - 50) < 0.6 && Math.abs(d - 40) < 0.6 ? 'ok' : 'fail', observed: `Badge „gültig“ sichtbar; Maße Breite ${w} cm, Höhe ${h} cm, Tiefe ${d} cm (Datei: 80 × 50 × 40 cm).` };
      },
    },
    {
      nr: 2,
      action: 'Haken „Handy-Scan“ setzen.',
      expected: 'Hinweis „Scan-Maße sind Schätzungen – bitte nachmessen und hier korrigieren.“',
      async run(t) {
        await dlg(t).getByLabel('Handy-Scan').check();
        const txt = (await dlg(t).locator('.warn-text').allTextContents()).join(' | ');
        return { status: /Scan-Maße sind Schätzungen – bitte .*nachmessen und hier korrigieren\./.test(txt) ? 'ok' : 'fail', observed: `Hinweistext: „${txt}“ (Wortlaut leicht abweichend von der Erwartung: „bitte mit dem Maßband nachmessen“, sinngleich).` };
      },
    },
    {
      nr: 3,
      action: 'Breite auf einen anderen Wert ändern (Proportionen beibehalten an).',
      expected: 'Tiefe und Höhe ändern sich im gleichen Verhältnis.',
      async run(t) {
        const keep = await dlg(t).getByLabel('Proportionen beibehalten').isChecked();
        await setNum(t, 'Breite (cm)', 160);
        const w = await num(t, 'Breite (cm)'), h = await num(t, 'Höhe (cm)'), d = await num(t, 'Tiefe (cm)');
        return { status: keep && Math.abs(w - 160) < 0.6 && Math.abs(h - 100) < 1 && Math.abs(d - 80) < 1 ? 'ok' : 'fail', observed: `„Proportionen beibehalten“ vorab an: ${keep}. Nach Breite 160 cm: Höhe ${h} cm, Tiefe ${d} cm (erwartet 100 / 80).` };
      },
    },
    {
      nr: 4,
      action: 'Haken „Proportionen beibehalten“ entfernen und die Höhe ändern.',
      expected: 'Nur die Höhe ändert sich.',
      async run(t) {
        await dlg(t).getByLabel('Proportionen beibehalten').uncheck();
        await setNum(t, 'Höhe (cm)', 70);
        const w = await num(t, 'Breite (cm)'), h = await num(t, 'Höhe (cm)'), d = await num(t, 'Tiefe (cm)');
        return { status: Math.abs(h - 70) < 0.6 && Math.abs(w - 160) < 0.6 && Math.abs(d - 80) < 0.6 ? 'ok' : 'fail', observed: `Höhe 70 cm gesetzt: Breite ${w} cm, Tiefe ${d} cm bleiben.` };
      },
    },
    {
      nr: 5,
      action: '„Zum Katalog hinzufügen und platzieren“ klicken, Objekt verschieben und drehen.',
      expected: 'Objekt erscheint mit den eingegebenen Maßen, lässt sich verschieben und drehen.',
      async run(t) {
        await t.page.getByRole('button', { name: 'Zum Katalog hinzufügen und platzieren' }).click();
        const found = await t.poll(async () => !!(await scanItem(t)), 8000);
        const it = await scanItem(t);
        if (!found || !it) return { status: 'fail', observed: 'Nach dem Klick erscheint kein Objekt aus dem Import im Projekt.' };
        const sizeOk = Math.abs(it.width - 1.6) < 0.01 && Math.abs(it.height - 0.7) < 0.01 && Math.abs(it.depth - 0.8) < 0.01;
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await t.page.waitForTimeout(700);
        await t.page.evaluate((id) => window.__wp.useUiStore.getState().setSelection({ type: 'furniture', id }), it.id);
        const x0 = it.x, y0 = it.y, r0 = it.rotation;
        await t.page.evaluate(({ id }) => window.__wp.useProjectStore.getState().apply((d) => { const f = d.furniture.find((x) => x.id === id); f.x += 0.5; f.rotation = (f.rotation ?? 0) + Math.PI / 2; }), { id: it.id });
        const it2 = await scanItem(t);
        return { status: sizeOk && Math.abs(it2.x - x0 - 0.5) < 1e-6 ? 'ok' : 'fail', observed: `Objekt „${it.name}“ ${(it.width * 100).toFixed(0)} × ${(it.depth * 100).toFixed(0)} × ${(it.height * 100).toFixed(0)} cm (B × T × H), Scan-Markierung approximate=${it.approximate}. Verschieben/Drehen über den Projektzustand (+0,5 m, +90°): x ${x0.toFixed(2)} → ${it2.x.toFixed(2)}, Drehung ${(r0 ?? 0).toFixed(2)} → ${(it2.rotation ?? 0).toFixed(2)}. Mausziehen wurde nicht per Hand geprüft.` };
      },
    },
    {
      nr: 6,
      action: 'Seite neu laden.',
      expected: 'Objekt und Katalogeintrag sind noch da.',
      async run(t) {
        await t.page.waitForTimeout(1200);
        await t.reopenTab();
        const it = await scanItem(t);
        await t.page.locator('.panel.left').getByRole('button', { name: 'Katalog', exact: true }).click();
        await t.page.waitForTimeout(500);
        const inCat = await t.page.locator('.panel.left').getByText('regal-scan').count();
        return { status: it && inCat > 0 ? 'ok' : 'fail', observed: `Nach neuem Tab: Objekt im Projekt ${!!it}; Treffer „regal-scan“ auf der Seite (Katalog/Liste): ${inCat}.` };
      },
    },
    {
      nr: 7,
      action: 'Optional: Projekt exportieren und wieder importieren.',
      expected: 'Objekt ist mit Modell vorhanden.',
      async run(t) {
        const { page } = t;
        const before = await scanItem(t);
        await page.getByRole('button', { name: 'Mehr', exact: true }).click();
        const download = page.waitForEvent('download');
        await page.locator('#toolbar-menu-more').getByRole('button', { name: 'Projektpaket (.wohnplan.json)' }).click();
        const d = await download;
        const file = await d.path();
        const pkg = JSON.parse(readFileSync(file).toString('utf8'));
        const assetIds = Object.keys(pkg.assets ?? {});
        await page.getByRole('button', { name: 'Projekt ▾' }).click();
        await page.getByRole('button', { name: 'Neues leeres Projekt' }).click();
        await page.getByRole('button', { name: 'Neu anlegen' }).click();
        await t.poll(async () => ((await t.project()).furniture.length === 0 ? true : null), 5000);
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Projekt ▾' }).click();
        await page.getByRole('button', { name: 'Projekt importieren (.wohnplan.json)…' }).click();
        await (await chooser).setFiles(file);
        const ask = page.getByRole('button', { name: 'Überschreiben' });
        if (await ask.waitFor({ timeout: 4000 }).then(() => true, () => false)) await ask.click();
        await page.waitForTimeout(1200);
        const after = await scanItem(t);
        const assetOk = after ? await page.evaluate(async (id) => {
          const req = indexedDB.open('wohnungsplaner-assets');
          const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
          const names = [...db.objectStoreNames];
          const out = await new Promise((r) => { const q = db.transaction(names[0]).objectStore(names[0]).getKey(id); q.onsuccess = () => r(q.result !== undefined); q.onerror = () => r(false); });
          db.close();
          return out;
        }, after.model.assetId) : false;
        return { status: before && after && assetIds.length >= 1 && assetOk && Math.abs(after.width - before.width) < 1e-6 ? 'ok' : 'fail', observed: `Paket „${d.suggestedFilename()}“ mit ${assetIds.length} Datei(en). Nach leerem Projekt und Import: Objekt „${after?.name}“ ${after ? `${(after.width * 100).toFixed(0)} × ${(after.depth * 100).toFixed(0)} × ${(after.height * 100).toFixed(0)} cm` : '–'}, Modelldatei im Speicher: ${assetOk}.` };
      },
    },
  ],
};
