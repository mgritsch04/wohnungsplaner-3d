// Audio-Setup: Katalog mit eigenen Geräten (#336) – Testschritte aus dem Kommentar in #336.
const panel = (t) => t.page.locator('.panel.left').getByTestId('smarthome-panel');
const audioSec = (t) => t.page.locator('section.panel-section').filter({ has: t.page.getByRole('heading', { name: 'Eigene Audio-Geräte' }) });
const field = (t, label) => audioSec(t).locator('label.field').filter({ has: t.page.locator('.field-label', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }) });
const speakers = async (t) => (await t.project()).devices.filter((d) => d.kind === 'speaker');
const hints = (t) => t.page.getByTestId('speaker-hints').locator('li').allTextContents();
const select = (t, id) => t.page.evaluate((i) => window.__wp.useUiStore.getState().setSelection({ type: 'device', id: i }), id);
const setDev = (t, id, patch) => t.page.evaluate(([i, p]) => window.__wp.useProjectStore.getState().apply((d) => Object.assign(d.devices.find((x) => x.id === i), p)), [id, patch]);
/** Edge lengths (m) of the speaker's box in the 3D scene, sorted. */
const boxSize = (t, id) =>
  t.page.evaluate((i) => {
    let size = null;
    window.__wp.three?.scene.traverse((o) => {
      if (o.userData?.smartDevice === i && o.geometry?.parameters && !size) {
        const p = o.geometry.parameters;
        const s = o.getWorldScale(o.position.clone());
        size = [p.width * s.x, p.height * s.y, p.depth * s.z].map((v) => +v.toFixed(3)).sort((a, b) => a - b);
      }
    });
    return size;
  }, id);

export default {
  issue: 336,
  name: 'Eigene Audio-Geräte',
  title: 'Audio-Setup: Katalog mit Lautsprecher-Arten und eigenen Geräten',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Wohnung mit Raum und Sofa öffnen, Tab „Smart Home“.',
      expected: 'Abschnitt „Eigene Audio-Geräte“. Hinweis, dass keine Modelle oder Preise erfunden werden; Liste leer.',
      async run(t) {
        const { page } = t;
        await t.freshStart();
        await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: '2D + 3D' }).click();
        await page.locator('.panel.left').getByRole('button', { name: 'Smart Home' }).click();
        await panel(t).getByLabel('Raum').selectOption({ label: 'Wohnzimmer' });
        const sec = panel(t).locator('section, .section, div').filter({ has: page.getByText('Eigene Audio-Geräte') }).last();
        const txt = await panel(t).innerText();
        const hasTitle = txt.includes('Eigene Audio-Geräte');
        const note = /keine erfundenen Modelle oder Preise/.test(txt);
        const n = await page.getByTestId('audio-def').count();
        const sofa = (await t.project()).furniture.some((f) => /sofa/i.test(f.name));
        return { status: hasTitle && note && n === 0 && sofa ? 'ok' : 'fail', observed: `Abschnitt „Eigene Audio-Geräte“: ${hasTitle}; Hinweis „keine erfundenen Modelle oder Preise“: ${note}; Einträge in der Liste: ${n}; Sofa im Raum vorhanden: ${sofa}.` };
      },
    },
    {
      nr: 2,
      action: 'Name „Mein Regal“, Art Regallautsprecher, Breite 20, Tiefe 30, Höhe 35 cm, Abstrahlwinkel 60 eingeben, „Gerät anlegen“.',
      expected: 'Eintrag mit „20 × 30 × 35 cm · 60° · eigene Eingabe“.',
      async run(t) {
        const p = panel(t);
        await field(t, 'Name').locator('input').fill('Mein Regal');
        await field(t, 'Art').locator('select').selectOption({ label: 'Regallautsprecher' });
        for (const [label, v] of [['Breite', '20'], ['Tiefe', '30'], ['Höhe', '35'], ['Abstrahlwinkel (0 = unbekannt)', '60']]) {
          const f = field(t, label).locator('input');
          await f.fill(v);
          await f.press('Tab');
        }
        await p.getByTestId('audio-def-add').click();
        await t.page.waitForTimeout(400);
        const txt = await t.page.getByTestId('audio-def').first().innerText().catch(() => '');
        const def = (await t.project()).audioCatalog[0];
        const flat = txt.replace(/\s+/g, ' ');
        const ok = /Mein Regal/.test(flat) && /20 × 30 × 35 cm/.test(flat) && /60°/.test(flat) && /eigene Eingabe/.test(flat);
        await t.shot('Eintrag im Katalog');
        return { status: ok ? 'ok' : 'fail', observed: `Eintrag: „${flat}“. Im Projekt: ${def ? `${def.name}, ${def.speakerType}, ${def.widthM}×${def.depthM}×${def.heightM} m, ${def.coverageDeg}°, Quelle „${def.source}“` : 'kein Eintrag'}.` };
      },
    },
    {
      nr: 3,
      action: '„Platzieren“ klicken.',
      expected: 'Lautsprecher im Raum, ausgewählt; in 3D als Box in den eingegebenen Maßen; unter Eigenschaften „Eigenes Gerät …“ und Abstandshinweise.',
      async run(t) {
        const { page } = t;
        await page.getByTestId('audio-def-place').first().click();
        await page.waitForTimeout(800);
        const sp = (await speakers(t))[0];
        const sel = await t.selection();
        const own = await page.getByTestId('speaker-own').innerText().catch(() => '');
        const h = await hints(t);
        const size = sp ? await t.poll(async () => await boxSize(t, sp.id), 4000) : null;
        t.sp = sp;
        await t.shot('Platziert, Eigenschaften');
        const ok = !!sp && sel?.type === 'device' && sel.id === sp.id && /Eigenes Gerät/.test(own) && h.length >= 1 && size && Math.abs(size[0] - 0.2) < 0.005 && Math.abs(size[1] - 0.3) < 0.005 && Math.abs(size[2] - 0.35) < 0.005;
        return { status: ok ? 'ok' : 'fail', observed: `Lautsprecher im Projekt: ${!!sp}; ausgewählt: ${sel?.type === 'device' && sel.id === sp?.id}; Eigenschaften: „${own}“; Hinweise: ${h.join(' | ')}; Box in 3D (Kantenlängen sortiert): ${size ? size.join(' × ') + ' m' : 'nicht gefunden'}.` };
      },
    },
    {
      nr: 4,
      action: 'Lautsprecher so drehen, dass er vom Sofa wegschaut.',
      expected: 'Hinweis ⚠ „außerhalb des Abstrahlwinkels“; zum Sofa gedreht ✓ „im Abstrahlwinkel“.',
      async run(t) {
        const p = await t.project();
        const sofa = p.furniture.find((f) => /sofa/i.test(f.name));
        const sp = t.sp;
        // put the speaker 1.5 m from the sofa in the same room, then face away / toward it
        const at = { x: sofa.x, y: sofa.y - 1.5 };
        const toward = Math.atan2(sofa.y - at.y, sofa.x - at.x);
        await setDev(t, sp.id, { x: at.x, y: at.y, rotation: toward + Math.PI });
        await select(t, sp.id);
        await t.page.waitForTimeout(400);
        const away = await hints(t);
        await setDev(t, sp.id, { rotation: toward });
        await t.page.waitForTimeout(400);
        const toSofa = await hints(t);
        const outside = away.find((h) => /außerhalb des Abstrahlwinkels/.test(h));
        const inside = toSofa.find((h) => /im Abstrahlwinkel/.test(h));
        return { status: outside && /^⚠/.test(outside.trim()) && inside && /^✓/.test(inside.trim()) ? 'ok' : 'fail', observed: `Vom „${sofa.name}“ weggedreht (Drehung über den Projektzustand gesetzt, nicht mit der Maus): ${away.join(' | ')}. Zum Sofa gedreht: ${toSofa.join(' | ')}.` };
      },
    },
    {
      nr: 5,
      action: 'Nahe an die Wand ziehen.',
      expected: 'Wandabstand wird ab Gehäusekante gemessen, ⚠ unter 30 cm.',
      async run(t) {
        const sp = t.sp;
        const p = await t.project();
        const sofa = p.furniture.find((f) => /sofa/i.test(f.name));
        // north wall of the living room is at y≈0 (inner face a few cm below): centre 18 cm away = housing edge 3 cm (depth 30 cm)
        await setDev(t, sp.id, { x: sofa.x, y: 0.18 + 0.05, rotation: Math.PI / 2 });
        await select(t, sp.id);
        await t.page.waitForTimeout(400);
        const h = await hints(t);
        const wall = h.find((x) => /Wand/.test(x)) ?? '';
        const m = /(\d+,\d+) m/.exec(wall);
        const cm = m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) : null;
        const centreDist = (await t.poll(async () => { const q = (await speakers(t))[0]; return q ? q.y : null; }, 2000));
        await t.shot('Nahe an der Wand');
        return { status: /^⚠/.test(wall.trim()) && cm !== null && cm < 30 ? 'ok' : 'fail', observed: `Hinweis: „${wall}“ (genannter Abstand ${cm} cm). Mittelpunkt des Lautsprechers bei y = ${centreDist} m; bei Tiefe 30 cm liegt die Gehäusekante 15 cm näher an der Wand als der Mittelpunkt (Messung ab Mittelpunkt wäre größer). Verschoben über den Projektzustand, nicht mit der Maus gezogen.` };
      },
    },
    {
      nr: 6,
      action: '„Entfernen“ beim Eintrag, dann Strg+Z.',
      expected: 'Lautsprecher bleibt stehen (ohne Eigenschaften); Strg+Z bringt den Eintrag zurück.',
      async run(t) {
        const { page } = t;
        await page.getByTestId('audio-def-remove').first().click();
        await page.waitForTimeout(400);
        const n1 = await page.getByTestId('audio-def').count();
        const sp1 = (await speakers(t)).length;
        const own1 = await page.getByTestId('speaker-own').count();
        await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(500);
        const n2 = await page.getByTestId('audio-def').count();
        const linked = (await speakers(t))[0]?.audioDefId;
        return { status: n1 === 0 && sp1 === 1 && own1 === 0 && n2 === 1 && linked ? 'ok' : 'fail', observed: `Nach „Entfernen“: Katalogeinträge ${n1}, Lautsprecher im Plan ${sp1}, Zeile „Eigenes Gerät“ ${own1}. Nach Strg+Z: Katalogeinträge ${n2}, Lautsprecher wieder verknüpft: ${!!linked}.` };
      },
    },
    {
      nr: 7,
      action: 'Projekt speichern und neu laden.',
      expected: 'Katalog und platziertes Gerät bleiben erhalten.',
      async run(t) {
        const { page } = t;
        await page.getByText('Gespeichert').first().waitFor({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(1800);
        await page.reload();
        await page.locator('input.project-name').waitFor();
        await page.waitForTimeout(800);
        const p = await t.project();
        const sp = p.devices.find((d) => d.kind === 'speaker');
        return { status: p.audioCatalog.length === 1 && p.audioCatalog[0].name === 'Mein Regal' && p.audioCatalog[0].widthM === 0.2 && sp && sp.audioDefId === p.audioCatalog[0].id ? 'ok' : 'fail', observed: `Nach Neuladen: Katalog ${p.audioCatalog.map((d) => `${d.name} ${d.widthM}×${d.depthM}×${d.heightM} m ${d.coverageDeg}°`).join(', ') || '–'}; Lautsprecher ${sp ? `„${sp.name}“ verknüpft: ${sp.audioDefId === p.audioCatalog[0]?.id}` : 'fehlt'}.` };
      },
    },
  ],
};
