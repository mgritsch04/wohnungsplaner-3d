// Allgemeiner Quelltext-Import (#304) – Testschritte aus dem Kommentar in #304.
// Vorprüfung mit SYNTHETISCHEN Seiten (kein echter Shop); die App ruft nichts ab, der Quelltext wird eingefügt.
const left = (t) => t.page.locator('.panel.left');
const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (n, price) => `{"@type":"Product","name":"${n}","offers":{"price":${price},"priceCurrency":"EUR"}}`;

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
  await t.page.waitForTimeout(600);
  const text = (await dlg.innerText()).replace(/\s+/g, ' ');
  const name = await dlg.locator('label.field').filter({ hasText: /^Name/ }).locator('input').inputValue().catch(() => '');
  return { name, text, dlg };
}
const after = (text, from) => text.slice(Math.max(0, text.indexOf(from)));

export default {
  issue: 304,
  name: 'Quelltext-Import ohne schema.org',
  title: 'Allgemeiner Quelltext-Import überarbeiten (Seiten ohne schema.org, mehrere Produkte, JS-Shops)',
  device: 'desktop',
  pc: false,
  realDevice: [],
  steps: [
    {
      nr: 1,
      action: 'Produktseite ohne schema.org-Daten: Quelltext einfügen und „Produktdaten auslesen“.',
      expected: 'Name aus der Überschrift/dem Titel mit Hinweis „bitte prüfen“; Maße aus dem Text; Preis nur, wenn genau ein Preis auf der Seite steht (sonst Hinweis „mehrere Preise“).',
      async run(t) {
        await t.freshStart();
        await open(t);
        const one = await read(t, 'https://shop.example/p/sessel-testa', page('<h1>Sessel Testa</h1><p>Nur 129,00 €</p><ul><li>Breite: 70 cm</li><li>Tiefe: 80 cm</li><li>Höhe: 90 cm</li></ul>'));
        const warn1 = (await one.dlg.locator('.warn-text').allInnerTexts()).join(' | ');
        const dimsOf = (dlg) => dlg.locator('label.field').evaluateAll((ls) => ls.filter((l) => /^(Breite|Tiefe|Höhe)/.test(l.innerText.trim())).map((l) => `${l.innerText.trim().split('\n')[0]} ${l.querySelector('input')?.value}`));
        const dims = await dimsOf(one.dlg);
        await t.shot('Seite ohne schema.org, ein Preis');
        const o = after(one.text, 'Erkannt als');
        const two = await read(t, 'https://shop.example/p/regal', page('<h1>Regal Zwei</h1><p>199,00 € statt 249,00 €</p><p>Breite: 60 cm Tiefe: 30 cm Höhe: 180 cm</p>'));
        const t2 = after(two.text, 'Erkannt als');
        const warn2 = (await two.dlg.locator('.warn-text').allInnerTexts()).join(' | ');
        const dims2 = await dimsOf(two.dlg);
        const okOne = /Sessel Testa/.test(one.name) && /Preis € 129,00/.test(o) && /prüfen/i.test(warn1) && /70/.test(dims.join(' ')) && /80/.test(dims.join(' ')) && /90/.test(dims.join(' '));
        const okTwo = /Regal Zwei/.test(two.name) && /kein Preis gefunden/.test(t2) && /2 verschiedene Preise|mehrere Preise/.test(warn2) && /60/.test(dims2.join(' '));
        return { status: okOne && okTwo ? 'ok' : 'fail', observed: `Ein Preis: Name „${one.name}“, Maßfelder ${dims.join(', ')}; Preis 129,00 € übernommen; Hinweise: „${warn1.slice(0, 260)}“. Zwei Preise (199 und 249 €): Name „${two.name}“, Maßfelder ${dims2.join(', ')}, „kein Preis gefunden“; Hinweise: „${warn2.slice(0, 260)}“.` };
      },
    },
    {
      nr: 2,
      action: 'Quelltext einer Seite einfügen, die ihre Inhalte per JavaScript nachlädt (kaum Produkttext).',
      expected: 'Klare Fehlermeldung, dass der Quelltext keine Produktdaten enthält.',
      async run(t) {
        const r = await read(t, 'https://shop.example/p/js', page(`<div id="app"></div><script>window.__X__="${'a'.repeat(25_000)}"</script>`));
        const msg = (await r.dlg.locator('.error-text').allInnerTexts()).join(' | ');
        await t.shot('JavaScript-Shop: Fehlermeldung');
        return { status: /JavaScript/.test(msg) ? 'ok' : 'fail', observed: `Fehlermeldung: „${msg.slice(0, 300)}“; Name-Feld: „${r.name}“.` };
      },
    },
    {
      nr: 3,
      action: 'Quelltext einer Seite mit mehreren Produkten einfügen.',
      expected: 'Hinweis, welches Produkt verwendet wird.',
      async run(t) {
        const r = await read(t, 'https://shop.example/p/tische', page(`<script type="application/ld+json">[${ld('Tisch A', 100)},${ld('Tisch B', 200)}]</script>`));
        const warn = (await r.dlg.locator('.warn-text').allInnerTexts()).join(' | ');
        await t.shot('Mehrere Produkte');
        return { status: r.name === 'Tisch A' && /2 Produkte/.test(warn) && /„Tisch A“/.test(warn) ? 'ok' : 'fail', observed: `Verwendet: „${r.name}“; Hinweise: „${warn.slice(0, 300)}“. (Eine Auswahl-Oberfläche gibt es laut Testschritt noch nicht.)` };
      },
    },
    {
      nr: 4,
      action: 'Eine bisher funktionierende Seite mit schema.org (IKEA-Stil, synthetisch) erneut einfügen.',
      expected: 'Ergebnis unverändert: Name, Maße, Preis aus der Quelle.',
      async run(t) {
        const html = page('<h1>TESTREGAL Synthetisch</h1><p>Breite: 80 cm Tiefe: 30 cm Höhe: 200 cm</p>', `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"TESTREGAL Synthetisch","sku":"T-9","offers":{"@type":"Offer","price":"79.9","priceCurrency":"EUR"}}</script>`);
        const r = await read(t, 'https://www.ikea.com/at/de/p/testregal-synthetisch-00000000/', html);
        const o = after(r.text, 'Erkannt als');
        await t.shot('schema.org-Seite');
        return { status: /TESTREGAL Synthetisch/.test(r.name) && /79,90|79,9/.test(o) && /aus Quelle|vollständig/.test(o) ? 'ok' : 'fail', observed: `Name „${r.name}“; Anzeige: „${o.slice(0, 260)}“.` };
      },
    },
  ],
};
