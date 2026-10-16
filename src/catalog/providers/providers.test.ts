import { describe, expect, it } from 'vitest';
import { dimsFromText, parseProductPage } from './structuredData';
import { IKEA_AT, providerForUrl } from './registry';
import { productToCatalogItem } from './toCatalog';

// SYNTHETIC test fixtures modelled on the schema.org Product/Offer vocabulary.
// They are NOT copies of real retailer pages; names, numbers and prices are made up for tests.
const page = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"TESTREGAL Bücherregal, weiß","sku":"12345678",
"brand":{"@type":"Brand","name":"Testmarke"},"image":["https://example.com/regal.jpg"],
"offers":{"@type":"Offer","price":"59.99","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script>
</head><body><h2>Maße</h2><p>Breite: 80 cm</p><p>Tiefe: 28 cm</p><p>Höhe: 202 cm</p></body></html>`;

describe('product page parsing (structured data)', () => {
  it('reads name, price, image, availability and dimensions without guessing', () => {
    const p = parseProductPage(page, 'https://www.ikea.com/at/de/p/testregal-weiss-00263850/');
    expect(p.provider).toBe('ikea-at');
    expect(p.name).toBe('TESTREGAL Bücherregal, weiß');
    expect(p.articleNumber).toBe('002.638.50');
    expect(p.price).toEqual({ amount: 59.99, currency: 'EUR', status: 'source' });
    expect(p.dimensions).toMatchObject({ width: 80, depth: 28, height: 202, status: { width: 'source', depth: 'source', height: 'source' } });
    expect(p.imageUrl).toBe('https://example.com/regal.jpg');
    expect(p.availability).toBe('InStock');
    expect(p.quality).toBe('complete-from-source');
  });

  it('leaves missing values empty and warns', () => {
    const p = parseProductPage('<script type="application/ld+json">{"@type":"Product","name":"Sessel X","offers":{"price":"199"}}</script>', 'https://www.moebelix.at/p/sessel-x');
    expect(p.provider).toBe('moebelix-at');
    expect(p.price).toBeNull(); // no currency → not taken
    expect(p.dimensions.width).toBeNull();
    expect(p.dimensions.status.height).toBe('missing');
    expect(p.quality).toBe('partial');
    expect(p.warnings.join(' ')).toMatch(/Maße nicht/);
  });

  it('handles @graph, ProductGroup variants and QuantitativeValue units', () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage' },
        {
          '@type': 'ProductGroup',
          name: 'Gruppe',
          hasVariant: [{ '@type': 'Product', name: 'Tisch 140', width: { value: 1400, unitCode: 'MMT' }, depth: { value: 0.8, unitCode: 'MTR' }, height: { value: 75, unitCode: 'CMT' }, offers: { price: '1.299,00', priceCurrency: 'EUR' } }],
        },
      ],
    });
    const p = parseProductPage(json);
    expect(p.name).toBe('Tisch 140');
    expect(p.dimensions).toMatchObject({ width: 140, depth: 80, height: 75 });
    expect(p.price?.amount).toBe(1299);
  });

  it('parses combined dimension notations and ignores unknown units', () => {
    expect(dimsFromText('Maße: 200 x 90 x 82 cm')).toMatchObject({ width: 200, depth: 90, height: 82 });
    expect(dimsFromText('Breite 1,2 m, Höhe 750 mm')).toMatchObject({ width: 120, depth: null, height: 75 });
    expect(parseProductPage('<script type="application/ld+json">{"@type":"Product","name":"A","width":{"value":3,"unitCode":"INH"}}</script>').dimensions.width).toBeNull();
  });

  it('rejects non-http links and invalid JSON gracefully', () => {
    const p = parseProductPage('<script type="application/ld+json">{oops</script><script type="application/ld+json">{"@type":"Product","name":"B","image":"javascript:alert(1)"}</script>');
    expect(p.name).toBe('B');
    expect(p.imageUrl).toBeNull();
    expect(parseProductPage('kein produkt').quality).toBe('insufficient');
  });
});

describe('providers', () => {
  it('recognises retailers by host and extracts IKEA article numbers', () => {
    expect(providerForUrl('https://www.ikea.com/at/de/p/x-s49385862/').id).toBe('ikea-at');
    expect(IKEA_AT.articleNumberFromUrl!(new URL('https://www.ikea.com/at/de/p/x-s49385862/'))).toBe('S493.858.62');
    expect(providerForUrl('https://www.moebelix.at/p/abc').id).toBe('moebelix-at');
    expect(providerForUrl('nonsense').id).toBe('generic');
  });

  it('marks dimensions as from-source only when unchanged', () => {
    const p = parseProductPage(page, 'https://www.ikea.com/at/de/p/testregal-weiss-00263850/');
    const a = productToCatalogItem({ product: p, width: 80, depth: 28, height: 202, name: p.name!, category: 'storage', shape: 'shelf' });
    expect(a.tags).toContain('maße-aus-quelle');
    expect(a.width).toBeCloseTo(0.8, 9);
    expect(a.retailer).toBe('IKEA Österreich');
    expect(a.price?.status).toBe('user');
    const b = productToCatalogItem({ product: p, width: 81, depth: 28, height: 202, name: 'x', category: 'storage', shape: 'shelf' });
    expect(b.tags).toContain('maße-teilweise-manuell');
  });
});
