// Möbelix-Import: richtiger Produkttyp (#8) – Testschritte aus dem Kommentar in #8.
// Vorprüfung mit SYNTHETISCHEN Seiten im Stil eines Möbelhauses (schema.org Product + BreadcrumbList), keine echten Möbelix-Seiten.
const shopPage = (name, crumbs, extra = '') => `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((n, i) => ({ '@type': 'ListItem', position: i + 1, name: n })) })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, sku: 'T-1', offers: { '@type': 'Offer', price: '299', priceCurrency: 'EUR' } })}</script>
</head><body><h1>${name}</h1><p>Breite: 80 cm</p><p>Tiefe: 85 cm</p><p>Höhe: 95 cm</p>${extra}</body></html>`;
const left = (t) => t.page.locator('.panel.left');

async function open(t) {
  await left(t).getByRole('button', { name: 'Katalog', exact: true }).click();
  await t.page.getByRole('button', { name: /Produkt von Händlerseite/ }).click();
  await t.page.getByRole('dialog').waitFor();
}
async function read(t, url, html) {
  const dlg = t.page.getByRole('dialog');
  await dlg.getByPlaceholder(/https:\/\//).fill(url);
  await dlg.getByLabel('Seitenquelltext oder JSON-LD').fill(html);
  await dlg.getByRole('button', { name: 'Produktdaten auslesen' }).click();
  await dlg.getByTestId('category-guess').waitFor({ timeout: 8000 }).catch(() => undefined);
  const name = await dlg.locator('label.field').filter({ hasText: /^Name/ }).locator('input').inputValue();
  const cat = await dlg.locator('select').first().evaluate((s) => s.selectedOptions[0]?.textContent ?? '');
  const guess = (await dlg.getByTestId('category-guess').innerText().catch(() => '')).replace(/\s+/g, ' ');
  return { name, cat, guess };
}

export default {
  issue: 8,
  name: 'Möbelix-Import: Produkttyp',
  title: 'Möbelix-Import: falscher Produkttyp (z. B. Regal statt Sessel)',
  device: 'desktop',
  pc: false,
  realDevice: ['Echte Möbelix-Seiten mit Quelltext aus dem eigenen Browser'],
  steps: [
    {
      nr: 1,
      action: 'Im Browser eine Möbelix-Produktseite eines Sessels öffnen. Adresse kopieren, dann Strg+U (Seitenquelltext), Strg+A, Strg+C.',
      expected: 'Adresse und Quelltext sind kopiert.',
      async run() {
        return { status: 'device', observed: 'Braucht eine echte Möbelix-Seite im eigenen Browser (Bot-Schutz wird nicht umgangen, Seiten werden nicht automatisch abgerufen). Die Schritte 2–5 habe ich stattdessen mit synthetischen Seiten im Möbelhaus-Stil geprüft.' };
      },
    },
    {
      nr: 2,
      action: 'In der App: links Katalog › „Produkt von Händlerseite übernehmen“. Adresse in „Produkt-URL“, Quelltext in das große Feld einfügen, „Produktdaten auslesen“.',
      expected: 'Name ist der Sessel (nicht ein anderes Produkt), Kategorie „Sofas & Sessel“, daneben „Produkttyp sicher“ (oder „unsicher“ mit Begründung).',
      async run(t) {
        await t.freshStart();
        await open(t);
        const r = await read(t, 'https://www.moebelix.at/p/sessel-testa-synthetisch', shopPage('Sessel Testa in Grau', ['Startseite', 'Wohnzimmer', 'Sessel']));
        t.armchair = r;
        return { status: /Sessel Testa/.test(r.name) && /Sofas & Sessel/.test(r.cat) && /Produkttyp (sicher|unsicher)/.test(r.guess) ? 'ok' : 'fail', observed: `Synthetische Sessel-Seite: Name „${r.name}“, Kategorie „${r.cat}“, Anzeige: „${r.guess}“.` };
      },
    },
    {
      nr: 3,
      action: '„Hinzufügen und platzieren“.',
      expected: 'In 3D erscheint ein Sessel (nicht ein Regal).',
      async run(t) {
        const { page } = t;
        await page.getByRole('dialog').getByRole('button', { name: 'Hinzufügen und platzieren' }).click();
        await page.waitForTimeout(800);
        const f = (await t.project()).furniture.find((x) => /Sessel Testa/.test(x.name));
        const shape = f?.model?.type === 'procedural' ? f.model.shape : f?.model?.fallbackShape;
        await page.getByRole('button', { name: '3D', exact: true }).click();
        await page.waitForTimeout(1500);
        await t.shot('Sessel aus synthetischer Möbelix-Seite in 3D');
        return { status: f && f.category === 'sofa' && shape === 'armchair' ? 'ok' : 'fail', observed: `Platziert: „${f?.name}“, Kategorie ${f?.category}, 3D-Näherung „${shape}“ (Sessel, kein Regal).` };
      },
    },
    {
      nr: 4,
      action: 'Dasselbe mit einem Regal und einem Tisch von Möbelix.',
      expected: 'Jeweils passende Kategorie.',
      async run(t) {
        const { page } = t;
        await page.getByRole('button', { name: '2D', exact: true }).click();
        const cases = [
          ['Bücherregal Weiß Nova', ['Startseite', 'Wohnen', 'Regale'], /Schränke & Regale/],
          ['Esstisch Eiche Alto', ['Startseite', 'Esszimmer', 'Tische'], /Tische/],
        ];
        const out = [];
        for (const [name, crumbs, re] of cases) {
          await open(t);
          const r = await read(t, `https://www.moebelix.at/p/${encodeURIComponent(name)}`, shopPage(name, crumbs));
          out.push(`${name} → ${r.cat} (${r.guess.replace(/ · .*/, '')})`);
          out.push(re.test(r.cat) ? 1 : 0);
          await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();
        }
        const good = out.filter((x) => typeof x === 'number').every(Boolean);
        return { status: good ? 'ok' : 'fail', observed: `Synthetische Seiten: ${out.filter((x) => typeof x === 'string').join('; ')}.` };
      },
    },
    {
      nr: 5,
      action: 'Falls bei einem Produkt „nicht erkannt“ steht, Hinzufügen versuchen.',
      expected: '„Hinzufügen“ ist gesperrt, bis du eine Kategorie wählst.',
      async run(t) {
        const { page } = t;
        await open(t);
        const r = await read(t, 'https://www.moebelix.at/p/xq-7000-synthetisch', shopPage('XQ-7000 Modell Delta', ['Startseite', 'Angebote']));
        const dlg = page.getByRole('dialog');
        const disabled = await dlg.getByRole('button', { name: 'Hinzufügen und platzieren' }).isDisabled();
        const disabled2 = await dlg.getByRole('button', { name: 'Zum Katalog hinzufügen' }).isDisabled();
        const selected = await dlg.locator('select').first().inputValue();
        await dlg.locator('select').first().selectOption({ label: 'Tische' });
        const enabledAfter = !(await dlg.getByRole('button', { name: 'Hinzufügen und platzieren' }).isDisabled());
        return { status: r.guess.includes('nicht erkannt') && disabled && disabled2 && enabledAfter ? 'ok' : 'fail', observed: `Seite ohne erkennbaren Typ: Anzeige „${r.guess}“, Kategorie vorbelegt: „${selected || 'keine'}“; beide Hinzufügen-Knöpfe gesperrt: ${disabled && disabled2}; nach Wahl einer Kategorie aktiv: ${enabledAfter}.` };
      },
    },
  ],
};
