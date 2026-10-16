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
    expect(dimsFromText('B/T/H: 200 x 90 x 82 cm')).toMatchObject({ width: 200, depth: 90, height: 82 });
    expect(dimsFromText('Maße: 200 x 90 x 82 cm')).toMatchObject({ width: null, depth: null, height: null }); // order unknown → not guessed
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

describe('robust page-source import (regressions)', () => {
  const ld = (o: unknown, attrs = 'type="application/ld+json"') => `<script ${attrs}>${JSON.stringify(o)}</script>`;

  it('detects the input kind and explains URL-only or empty input', () => {
    expect(parseProductPage('').errors[0]).toMatch(/einfügen/);
    const u = parseProductPage('https://www.ikea.com/at/de/p/x-00263850/');
    expect(u.inputKind).toBe('url');
    expect(u.errors[0]).toMatch(/CORS/);
  });

  it('reports broken JSON-LD instead of failing silently', () => {
    const r = parseProductPage('<html><body><script type="application/ld+json">{"@type":"Product", "name": }</script></body></html>');
    expect(r.errors.join(' ')).toMatch(/JSON-LD-Block 1 ist fehlerhaftes JSON/);
    expect(parseProductPage('{"@type": "Product", ').inputKind).toBe('invalid-json');
  });

  it('accepts namespaced types, unquoted/uppercase attributes, comments and trailing commas', () => {
    const html = `<html><head><SCRIPT TYPE=application/ld+json><!--{"@context":"http://schema.org","@type":"http://schema.org/Product","name":"A","offers":{"@type":"Offer","price":10,"priceCurrency":"EUR",},}--></SCRIPT></head><body></body></html>`;
    const r = parseProductPage(html);
    expect(r.errors).toEqual([]);
    expect(r.name).toBe('A');
    expect(r.price?.amount).toBe(10);
  });

  it('does not confuse seat height/depth with the product height/depth', () => {
    const html = '<html><body><dl><dt>Sitzhöhe:</dt><dd>45 cm</dd><dt>Sitztiefe:</dt><dd>54 cm</dd><dt>Breite:</dt><dd>218 cm</dd><dt>Tiefe:</dt><dd>88 cm</dd><dt>Höhe:</dt><dd>83 cm</dd></dl></body></html>';
    expect(parseProductPage(html).dimensions).toMatchObject({ width: 218, depth: 88, height: 83 });
    expect(dimsFromText('Sitzhöhe: 45 cm, Sitztiefe 54 cm')).toMatchObject({ height: null, depth: null });
    expect(dimsFromText('Gesamthöhe: 202 cm')).toMatchObject({ height: 202 });
  });

  it('falls back to Open Graph / product meta tags and microdata', () => {
    const html = '<html><head><meta property="og:title" content="Kommode Test"><meta property="product:price:amount" content="149,00"><meta property="product:price:currency" content="EUR"><meta property="og:image" content="https://example.com/k.jpg"></head><body><span itemprop="sku">999</span><p>Breite: 80 cm Tiefe: 48 cm Höhe: 90 cm</p></body></html>';
    const r = parseProductPage(html);
    expect(r.name).toBe('Kommode Test');
    expect(r.price).toEqual({ amount: 149, currency: 'EUR', status: 'source' });
    expect(r.articleNumber).toBe('999');
    expect(r.quality).toBe('complete-from-source');
    expect(r.sources).toContain('Meta-Angaben');
  });

  it('finds dimensions inside embedded page data (JSON-escaped)', () => {
    const html = `<html><body>${ld({ '@type': 'Product', name: 'B', offers: { price: '5', priceCurrency: 'EUR' } })}<script type="application/json">{"specs":"Breite: 60 cm, Tiefe: 40 cm, H\u00f6he: 75 cm"}</script></body></html>`;
    expect(parseProductPage(html).dimensions).toMatchObject({ width: 60, depth: 40, height: 75 });
  });

  it('never executes scripts in pasted HTML', () => {
    (globalThis as unknown as { __pwned?: boolean }).__pwned = false;
    parseProductPage('<html><body><script>globalThis.__pwned = true</script><img src=x onerror="globalThis.__pwned=true"></body></html>');
    expect((globalThis as unknown as { __pwned?: boolean }).__pwned).toBe(false);
  });

  it('supports the simple JSON fallback format and visible-text input', () => {
    const j = parseProductPage(JSON.stringify({ name: 'Regal X', width: 80, depth: 30, height: 200, price: 79.9, url: 'https://example.com/x' }));
    expect(j.inputKind).toBe('json-simple');
    expect(j.quality).toBe('complete-from-source');
    expect(j.productUrl).toBe('https://example.com/x');
    const t = parseProductPage('Regal X\nBreite: 80 cm\nTiefe: 30 cm\nHöhe: 200 cm\n79,90 €');
    expect(t.inputKind).toBe('text');
    expect(t.dimensions.width).toBe(80);
    expect(t.warnings.join(' ')).toMatch(/sichtbarem Seitentext/);
  });

  it('handles large inputs without pathological slow-downs', () => {
    // ~1 MB of markup; jsdom is much slower than a real browser, so the bound is generous
    const big = `<html><body>${'<div>Lorem ipsum dolor sit amet 12 x 34 cm Breite</div>'.repeat(20000)}${ld({ '@type': 'Product', name: 'Groß', offers: { price: '1', priceCurrency: 'EUR' } })}</body></html>`;
    const t0 = performance.now();
    const r = parseProductPage(big);
    expect(r.name).toBe('Groß');
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});

describe('3D model references in page source', () => {
  it('reads the IKEA viewer embed (pip-xr-viewer-model) – synthetic fixture', () => {
    const html = '<html><body><script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"1","priceCurrency":"EUR"}}</script><script type="text/template" id="pip-xr-viewer-model">{"url":"https://example.com/models/x_0123.glb","type":"glb"}</script></body></html>';
    const r = parseProductPage(html, 'https://www.ikea.com/at/de/p/x-00263850/');
    expect(r.modelUrl).toBe('https://example.com/models/x_0123.glb');
    expect(r.sources).toContain('3D-Modell-Verweis (experimentell)');
  });
  it('finds JSON-escaped .glb URLs and ignores non-https ones', () => {
    expect(parseProductPage('<html><body><script>var a={"m":"https:\\/\\/cdn.example.com\\/a\\/b.glb?v=2"}</script></body></html>').modelUrl).toBe('https://cdn.example.com/a/b.glb?v=2');
    expect(parseProductPage('<html><body><a href="http://example.com/a.glb">x</a></body></html>').modelUrl).toBeNull();
  });
});
