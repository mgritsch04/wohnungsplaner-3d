import { describe, expect, it } from 'vitest';
import { parseCatalogCsv, parseCatalogJson, parseCsv } from './catalogFormat';
import { GENERIC_CATALOG } from './generic';
import { FileFormatError } from '../formats/zodErrors';

describe('generic catalog', () => {
  it('has unique ids, positive dimensions and only estimate prices', () => {
    const ids = new Set(GENERIC_CATALOG.map((c) => c.id));
    expect(ids.size).toBe(GENERIC_CATALOG.length);
    for (const c of GENERIC_CATALOG) {
      expect(c.width * c.depth * c.height).toBeGreaterThan(0);
      expect(c.approximate).toBe(true);
      if (c.price) expect(c.price.status).toBe('estimate');
    }
  });
});

describe('catalog import', () => {
  it('parses quoted CSV with ; separator', () => {
    expect(parseCsv('a;b\n"x;y";"he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x;y', 'he said "hi"'],
    ]);
  });

  it('imports products from CSV with German headers and comma decimals', () => {
    const csv = 'name;kategorie;breite_cm;tiefe_cm;hoehe_cm;preis_eur;haendler;url\nSofa Test;sofa;200;90;80;499,00;Möbelhaus;https://example.com/p\nKaputt;sofa;abc;90;80;;;\n';
    const { items, errors } = parseCatalogCsv(csv, 'liste.csv');
    expect(items).toHaveLength(1);
    expect(items[0].width).toBeCloseTo(2, 9);
    expect(items[0].price).toEqual({ amount: 499, currency: 'EUR', status: 'user', recordedAt: undefined });
    expect(items[0].model).toEqual({ type: 'procedural', shape: 'sofa' });
    expect(errors).toHaveLength(1);
  });

  it('imports the JSON format and ignores non-http links', () => {
    const json = JSON.stringify({
      format: 'wohnungsplaner-catalog',
      version: 1,
      units: 'mm',
      items: [{ name: 'Regal', category: 'storage', width: 800, depth: 300, height: 1900, productUrl: 'javascript:alert(1)', modelUrl: 'https://example.com/m.glb' }],
    });
    const items = parseCatalogJson(json, 'x.json');
    expect(items[0].height).toBeCloseTo(1.9, 9);
    expect(items[0].productUrl).toBeUndefined();
    expect(items[0].model.type).toBe('gltf');
    expect(() => parseCatalogJson('{"format":"x"}', 'x')).toThrow(FileFormatError);
  });
});
