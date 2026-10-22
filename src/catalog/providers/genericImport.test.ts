import { describe, expect, it } from 'vitest';
import { dimsFromText, parseProductPage, pricesFromText } from './structuredData';

// synthetic pages – no real shop content
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('Quelltext-Import ohne schema.org (IDEAS 19)', () => {
  it('nimmt Name aus h1 und einen einzigen Preis aus dem Text, mit Hinweisen', () => {
    const p = parseProductPage(page('<h1>Sessel Testa</h1><p>Nur 129,00 €</p><ul><li>Breite: 70 cm</li><li>Tiefe: 80 cm</li><li>Höhe: 90 cm</li></ul>'));
    expect(p.name).toBe('Sessel Testa');
    expect(p.price).toMatchObject({ amount: 129, currency: 'EUR' });
    expect(p.dimensions).toMatchObject({ width: 70, depth: 80, height: 90 });
    expect(p.warnings.join(' ')).toMatch(/Preis stammt aus dem Seitentext/);
    expect(p.errors).toEqual([]);
  });

  it('nimmt keinen Preis, wenn die Seite mehrere verschiedene zeigt', () => {
    const p = parseProductPage(page('<h1>Regal</h1><p>199,00 € statt 249,00 €</p>'));
    expect(p.price).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/2 verschiedene Preise/);
  });

  it('fällt für den Namen auf den Seitentitel zurück und kürzt den Shopnamen', () => {
    const p = parseProductPage(page('<p>Breite: 50 cm</p>', '<title>Hocker Mini | Beispielshop</title>'));
    expect(p.name).toBe('Hocker Mini');
  });

  it('liest Maße mit Einheit im Label', () => {
    expect(dimsFromText('Breite (cm): 80 Tiefe (cm): 40,5 Höhe in mm: 1200')).toMatchObject({ width: 80, depth: 40.5, height: 120 });
  });

  it('erkennt Preisformate', () => {
    expect(pricesFromText('ab € 1.299,- oder 49,90 EUR, 49,90 €').sort((a, b) => a - b)).toEqual([49.9, 1299]);
  });
});

describe('Mehrprodukt-Seiten', () => {
  const ld = (n: string, price: number) => `{"@type":"Product","name":"${n}","offers":{"price":${price},"priceCurrency":"EUR"}}`;
  const html = page(`<script type="application/ld+json">[${ld('Tisch A', 100)},${ld('Tisch B', 200)}]</script>`);

  it('listet alle Produkte und erlaubt die Auswahl per Index', () => {
    const auto = parseProductPage(html);
    expect(auto.productCandidates).toEqual(['Tisch A', 'Tisch B']);
    expect(auto.name).toBe('Tisch A');
    const second = parseProductPage(html, undefined, { productIndex: 1 });
    expect(second.name).toBe('Tisch B');
    expect(second.price?.amount).toBe(200);
  });

  it('findet Produkte in eingebettetem JSON-Seitenstatus (z. B. __NEXT_DATA__)', () => {
    const state = JSON.stringify({ props: { pageProps: { product: { '@type': 'Product', name: 'Bank Next', offers: { price: '79.90', priceCurrency: 'EUR' } } } } });
    const p = parseProductPage(page(`<script id="__NEXT_DATA__" type="application/json">${state}</script>`));
    expect(p.name).toBe('Bank Next');
    expect(p.price?.amount).toBe(79.9);
    expect(p.sources.join(' ')).toMatch(/eingebetteten Seitendaten/);
  });
});

describe('JavaScript-Shops', () => {
  it('meldet klar, wenn der Quelltext keine Produktdaten enthält', () => {
    const p = parseProductPage(page('<div id="app"></div><script>window.__X__="' + 'a'.repeat(25_000) + '"</script>'));
    expect(p.errors.join(' ')).toMatch(/JavaScript/);
    expect(p.quality).toBe('insufficient');
  });

  it('meldet bei Nicht-Produktseiten eine klare Fehlermeldung', () => {
    const p = parseProductPage(page('<p>' + 'Lorem ipsum dolor sit amet. '.repeat(30) + '</p>'));
    expect(p.errors.join(' ')).toMatch(/weder Produktdaten noch Maße/);
  });
});
