import { describe, expect, it } from 'vitest';
import { classifyProduct } from './classify';
import { parseProductPage } from './structuredData';

// SYNTHETIC pages in the style of a furniture shop (schema.org Product + BreadcrumbList).
// Not copies of real Möbelix pages; names, prices and dimensions are made up.
const shopPage = (opts: { name: string; crumbs?: string[]; category?: string; extra?: string; h1?: string; url?: string }) => `<!doctype html><html><head>
<meta property="og:title" content="${opts.h1 ?? opts.name}">
${opts.crumbs ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: opts.crumbs.map((n, i) => ({ '@type': 'ListItem', position: i + 1, name: n })) })}</script>` : ''}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: opts.name, url: opts.url, category: opts.category, sku: 'T-1', offers: { '@type': 'Offer', price: '299', priceCurrency: 'EUR' } })}</script>
${opts.extra ?? ''}
</head><body><h1>${opts.h1 ?? opts.name}</h1><p>Breite: 80 cm</p><p>Tiefe: 85 cm</p><p>Höhe: 95 cm</p></body></html>`;

describe('product type from page data (#8)', () => {
  it('recognises common furniture types from the name, incl. the right 3D stand-in', () => {
    const c = (n: string) => {
      const g = classifyProduct(n);
      return [g.category, g.shape];
    };
    expect(c('Sessel Lisa in Grau')).toEqual(['sofa', 'armchair']);
    expect(c('Ohrensessel Vintage')).toEqual(['sofa', 'armchair']);
    expect(c('Relaxsessel mit Hocker')).toEqual(['sofa', 'armchair']);
    expect(c('Schlafsofa Nora')).toEqual(['sofa', 'sofa']);
    expect(c('Wohnlandschaft Malta')).toEqual(['sofa', 'sofa-corner']);
    expect(c('Couchtisch Eiche')).toEqual(['table', 'table']);
    expect(c('Esstisch ausziehbar')).toEqual(['table', 'table']);
    expect(c('Schreibtisch Work')).toEqual(['desk', 'desk']);
    expect(c('Nachttischlampe Glow')).toEqual(['lighting', 'table-lamp']);
    expect(c('Stehleuchte Arc')).toEqual(['lighting', 'floor-lamp']);
    expect(c('Nachtkästchen Bella')).toEqual(['bed', 'cabinet']);
    expect(c('Bürostuhl Ergo')).toEqual(['chair', 'office-chair']);
    expect(c('Stuhl 4er-Set')).toEqual(['chair', 'chair']);
    expect(c('Boxspringbett 180x200')).toEqual(['bed', 'bed']);
    expect(c('Bücherregal Weiß')).toEqual(['storage', 'shelf']);
    expect(c('Kleiderschrank 3-türig')).toEqual(['storage', 'wardrobe']);
    expect(c('Kommode Linus')).toEqual(['storage', 'cabinet']);
    expect(c('Teppich Shaggy')).toEqual(['textile', 'rug']);
  });

  it('says so instead of guessing when nothing matches', () => {
    const g = classifyProduct('Modell Aurora', []);
    expect(g).toMatchObject({ category: null, confidence: 'unbekannt' });
  });

  it('uses the page category when the name is not telling, and flags contradictions', () => {
    expect(classifyProduct('Aurora', ['Wohnzimmer', 'Sessel'])).toMatchObject({ category: 'sofa', shape: 'armchair', confidence: 'sicher' });
    expect(classifyProduct('Sessel Aurora', ['Wohnen', 'Sessel'])).toMatchObject({ category: 'sofa', confidence: 'sicher' });
    const odd = classifyProduct('Sessel Aurora', ['Wohnen', 'Regale']);
    expect(odd).toMatchObject({ category: 'sofa', shape: 'armchair', confidence: 'unsicher' });
    expect(odd.reason).toContain('Regal');
  });

  it('reads breadcrumb and schema.org category from a pasted page', () => {
    const p = parseProductPage(shopPage({ name: 'Aurora', crumbs: ['Startseite', 'Wohnzimmer', 'Sessel'], category: 'Möbel > Wohnzimmer > Sessel' }), 'https://www.moebelix.at/p/aurora-001');
    expect(p.categoryHints).toEqual(['Startseite', 'Wohnzimmer', 'Sessel', 'Möbel']);
    expect(classifyProduct(p.name, p.categoryHints)).toMatchObject({ category: 'sofa', shape: 'armchair' });
  });

  it('takes the product the page is about, not a recommended one listed first', () => {
    const recommended = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Standregal Kubus', url: 'https://www.moebelix.at/p/standregal-kubus-77', offers: { price: '89', priceCurrency: 'EUR' } })}</script>`;
    // the recommendation block comes BEFORE the main product in the source
    const html = shopPage({ name: 'Sessel Lisa', url: 'https://www.moebelix.at/p/sessel-lisa-001', extra: '' }).replace('<script type="application/ld+json">', `${recommended}<script type="application/ld+json">`);
    const byUrl = parseProductPage(html, 'https://www.moebelix.at/p/sessel-lisa-001?utm=x');
    expect(byUrl.name).toBe('Sessel Lisa');
    expect(byUrl.warnings.join(' ')).toContain('Seitenadresse');
    const byTitle = parseProductPage(html, '');
    expect(byTitle.name).toBe('Sessel Lisa');
    expect(byTitle.warnings.join(' ')).toContain('Seitenüberschrift');
  });
});
