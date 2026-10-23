// Umzugs-Checkliste (#91) – Testschritte aus dem Kommentar in #91.
const right = (t) => t.page.locator('.panel.right');
const list = (t) => right(t).getByTestId('task-list').last();
const rows = (t) => list(t).getByTestId('task-row');
const progress = (t) => list(t).getByTestId('task-progress').textContent();
const moveTasks = async (t) => (await t.project()).tasks.filter((x) => !x.roomId);

export default {
  issue: 91,
  name: 'Umzugs-Checkliste',
  title: 'Umzugs-Checkliste mit Terminen',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Reiter „Projekt“ öffnen, zum Abschnitt „Umzugs-Checkliste“ blättern.',
      expected: 'Leere Liste mit Hinweis und Knopf „Vorlage einfügen“.',
      async run(t) {
        await t.freshStart();
        await t.page.getByRole('button', { name: '2D', exact: true }).click();
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const hint = await progress(t);
        const btn = await right(t).getByRole('button', { name: 'Vorlage einfügen' }).isVisible();
        return { status: /Leer/.test(hint) && btn ? 'ok' : 'fail', observed: `Hinweis: „${hint}“; Knopf „Vorlage einfügen“ sichtbar: ${btn}.` };
      },
    },
    {
      nr: 2,
      action: '„Vorlage einfügen“ klicken, danach nochmals.',
      expected: '12 allgemeine Standardschritte; nochmaliges Klicken fügt nichts doppelt ein.',
      async run(t) {
        await right(t).getByRole('button', { name: 'Vorlage einfügen' }).click();
        const n1 = (await moveTasks(t)).length;
        await right(t).getByRole('button', { name: 'Vorlage einfügen' }).click();
        const n2 = (await moveTasks(t)).length;
        const names = (await moveTasks(t)).map((x) => x.text);
        t.names = names;
        return { status: n1 === 12 && n2 === 12 && new Set(names).size === 12 ? 'ok' : 'fail', observed: `Nach dem 1. Klick ${n1} Schritte, nach dem 2. Klick ${n2}; Beispiele: ${names.slice(0, 3).join(' | ')} … ${names.slice(-2).join(' | ')}.` };
      },
    },
    {
      nr: 3,
      action: 'Bei einem Schritt ein Datum wählen und ihn abhaken; ein Datum in der Vergangenheit bei einem offenen Schritt setzen.',
      expected: 'Datum bleibt, Schritt durchgestrichen, Fortschritt zählt hoch; ein vergangenes Datum bei offenem Schritt wird orange umrandet.',
      async run(t) {
        const step = t.names[0];
        const other = t.names[1];
        await list(t).getByLabel(`Datum für ${step}`).fill('2026-11-15');
        await list(t).getByLabel(`${step} erledigt`).check();
        await list(t).getByLabel(`Datum für ${other}`).fill('2025-01-10');
        await t.page.waitForTimeout(300);
        const task = (await moveTasks(t)).find((x) => x.text === step);
        const strike = await list(t).getByTestId('task-row').filter({ hasText: step }).locator('span').first().evaluate((e) => getComputedStyle(e).textDecorationLine);
        const pr = await progress(t);
        const bc = (text) => list(t).getByLabel(`Datum für ${text}`).evaluate((e) => getComputedStyle(e).borderTopColor);
        const warn = await bc(other);
        const normal = await bc(t.names[2]);
        return { status: task.due === '2026-11-15' && task.done && strike.includes('line-through') && pr === '1 von 12 erledigt' && warn !== normal ? 'ok' : 'fail', observed: `Datum ${task.due}, erledigt ${task.done}, Text ${strike}; Anzeige „${pr}“; Rahmenfarbe bei vergangenem offenem Datum ${warn} gegenüber normal ${normal}. Ob der Rahmen „orange“ wirkt, ist ein Farbeindruck (Screenshot nicht angefertigt).` };
      },
    },
    {
      nr: 4,
      action: 'Eigenen Punkt hinzufügen, einen anderen entfernen (✕).',
      expected: 'Liste passt sich an.',
      async run(t) {
        const f = list(t).getByLabel('Neuer Punkt');
        await f.fill('Möbelwagen buchen');
        await f.press('Enter');
        const n1 = await rows(t).count();
        await list(t).getByLabel(`${t.names[5]} entfernen`).click();
        const n2 = await rows(t).count();
        const tasks = (await moveTasks(t)).map((x) => x.text);
        return { status: n1 === 13 && n2 === 12 && tasks.includes('Möbelwagen buchen') && !tasks.includes(t.names[5]) ? 'ok' : 'fail', observed: `Nach Hinzufügen ${n1} Zeilen, nach Entfernen von „${t.names[5]}“ ${n2}; „Möbelwagen buchen“ vorhanden: ${tasks.includes('Möbelwagen buchen')}.` };
      },
    },
    {
      nr: 5,
      action: 'Seite neu laden.',
      expected: 'Alles noch da.',
      async run(t) {
        const before = JSON.stringify(await moveTasks(t));
        await t.page.waitForTimeout(1500);
        await t.page.reload();
        await t.poll(async () => (await moveTasks(t)).length === 12);
        const after = JSON.stringify(await moveTasks(t));
        await t.page.getByRole('button', { name: '2D', exact: true }).click().catch(() => {});
        await right(t).getByRole('button', { name: 'Projekt', exact: true }).click();
        const pr = await progress(t);
        return { status: before === after && pr === '1 von 12 erledigt' ? 'ok' : 'fail', observed: `Aufgaben gleich: ${before === after}; Anzeige „${pr}“.` };
      },
    },
  ],
};
