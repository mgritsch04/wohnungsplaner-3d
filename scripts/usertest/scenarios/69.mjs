// Tageslicht pro Raum (#69) – Testschritte aus dem Kommentar in #69.
const right = (t) => t.page.locator('.panel.right');
const section = (t) => right(t).locator('section, div').filter({ has: t.page.getByRole('heading', { name: 'Tageslicht & Himmelsrichtung' }) }).last();
const rows = async (t) => {
  const txt = await right(t).innerText();
  const part = txt.slice(txt.indexOf('Tageslicht & Himmelsrichtung'), txt.indexOf('Heizkosten'));
  return part;
};

export default {
  issue: 69,
  name: 'Tageslicht pro Raum',
  title: 'Tageslicht pro Raum: welche Räume über Fenster Licht bekommen, nach Himmelsrichtung',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Rechtes Panel „Projekt" öffnen und zum Abschnitt „Tageslicht & Himmelsrichtung" scrollen.',
      expected: 'Pro Raum eine Zeile mit Tageslicht-Stufe, Fensterrichtung und Sonnenzeit; darunter der Hinweis, dass es nur eine grobe Schätzung ist.',
      async run(t) {
        await t.freshStart();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const part = await rows(t);
        t.before = part;
        const rooms = (await t.project()).rooms.map((r) => r.name);
        const lines = rooms.map((n) => part.split('\n').find((l) => l.startsWith(`${n}:`)));
        const ok = lines.every((l) => l && /Tageslicht/.test(l) && /Fenster nach/.test(l) && /Sonne/.test(l)) && /Grobe Schätzung/.test(part) && /Keine Lichtberechnung/.test(part);
        return { status: ok ? 'ok' : 'fail', observed: `Zeilen: ${lines.join(' || ')}. Hinweis „Grobe Schätzung … Keine Lichtberechnung“: ${/Grobe Schätzung/.test(part)}.` };
      },
    },
    {
      nr: 2,
      action: '„Oben im Plan ist" von 0° auf 180° stellen (oder Knopf „Süden").',
      expected: 'Die Fensterrichtungen und Sonnenzeiten drehen sich entsprechend (Nord- und Südfenster tauschen).',
      async run(t) {
        await right(t).getByRole('button', { name: 'Süden', exact: true }).click();
        await t.page.waitForTimeout(300);
        const part = await rows(t);
        t.after = part;
        const dir = (txt, n) => (txt.split('\n').find((l) => l.startsWith(`${n}:`)) ?? '').replace(/^.*Fenster nach /, '').split(' · ')[0];
        const changed = ['Wohnzimmer', 'Schlafzimmer'].map((n) => `${n}: ${dir(t.before, n)} → ${dir(part, n)}`);
        const wz = dir(t.before, 'Wohnzimmer') === 'Norden' && dir(part, 'Wohnzimmer') === 'Süden';
        const sz = dir(part, 'Schlafzimmer') !== dir(t.before, 'Schlafzimmer');
        return { status: wz && sz && /liegt Süden \(180°\)/.test(part) ? 'ok' : 'fail', observed: `${changed.join('; ')}.`, };
      },
    },
    {
      nr: 3,
      action: 'Projekt neu laden.',
      expected: 'Die eingestellte Himmelsrichtung bleibt erhalten.',
      async run(t) {
        await t.page.getByText('Gespeichert').waitFor({ timeout: 5000 });
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.page.locator('input.project-name').waitFor();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const part = await rows(t);
        const north = (await t.project()).northAngle ?? (await t.project()).north;
        return { status: /liegt Süden \(180°\)/.test(part) ? 'ok' : 'fail', observed: `Nach dem Neuladen: „${part.split('\n').find((l) => l.startsWith('Oben im Plan liegt'))}“ (Projektwert ${JSON.stringify(north)}).` };
      },
    },
    {
      nr: 4,
      action: 'Einen Raum ohne Fenster ansehen.',
      expected: '„kein Tageslicht".',
      async run(t) {
        const { page } = t;
        // Neuer Raum ohne Fenster über Räume anlegen (Werkzeug „Raum mit Maßen anlegen“)
        const before = (await t.project()).rooms.length;
        await page.getByRole('button', { name: 'Raum anlegen' }).click();
        await page.waitForTimeout(500);
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const p = await t.project();
        const part = await rows(t);
        const added = p.rooms.length - before;
        const newRoom = p.rooms.at(-1);
        const line = part.split('\n').find((l) => l.startsWith(`${newRoom.name}:`)) ?? '';
        return { status: added === 1 && /kein Tageslicht/.test(line) ? 'ok' : 'fail', observed: `Neuer fensterloser Raum „${newRoom.name}“: „${line}“.` };
      },
    },
  ],
};
