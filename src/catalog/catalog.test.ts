import { describe, expect, it } from 'vitest';
import { parseCatalogCsv, parseCatalogJson, parseCatalogJsonWithModels, parseCsv } from './catalogFormat';
import { attachModelFiles } from './catalogImport';
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

describe('product list with model files', () => {
  const list = JSON.stringify({
    format: 'wohnungsplaner-catalog',
    version: 1,
    name: 'IKEA-Auswahl',
    units: 'cm',
    items: [
      { name: 'Regal A', category: 'storage', width: 111.5, depth: 39, height: 146.5, articleNumber: '104.099.32', modelFile: 'regal-a.glb' },
      { name: 'Schrank B', category: 'storage', width: 30, depth: 32.1, height: 180, modelFile: 'fehlt.glb' },
      { name: 'Ohne Modell', category: 'decor', width: 10, depth: 10, height: 10 },
    ],
  });
  const fakeCheck = (size: { x: number; y: number; z: number }) => (async (blob: Blob) => ({ blob, info: { size } })) as never;

  it('rejects paths in modelFile', () => {
    const bad = list.replace('regal-a.glb', '../x/regal-a.glb');
    expect(() => parseCatalogJsonWithModels(bad, 'x.json')).toThrow();
  });

  it('attaches matching .glb files, keeps substitutes for missing ones and reports both', async () => {
    const { items, modelFiles } = parseCatalogJsonWithModels(list, 'liste.json');
    expect(modelFiles.size).toBe(2);
    const stored: Blob[] = [];
    const res = await attachModelFiles(items, modelFiles, [new File([new Uint8Array([1])], 'Regal-A.GLB')], async (b) => (stored.push(b), 'asset_1'), fakeCheck({ x: 1.118, y: 1.471, z: 0.403 }));
    expect(res.attached).toBe(1);
    expect(stored).toHaveLength(1);
    expect(res.items[0].model).toEqual({ type: 'gltf', assetId: 'asset_1', fallbackShape: 'cabinet' });
    expect(res.items[0].approximate).toBe(false);
    expect(res.items[0].width).toBeCloseTo(1.115, 6); // listed dimensions stay authoritative
    expect(res.items[1].model.type).toBe('procedural');
    expect(res.items[2].model.type).toBe('procedural');
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/fehlt\.glb/);
  });

  it('warns about rotated or clearly deviating models', async () => {
    const { items, modelFiles } = parseCatalogJsonWithModels(list, 'liste.json');
    const files = [new File([new Uint8Array([1])], 'regal-a.glb')];
    const rotated = await attachModelFiles(items.slice(0, 1), modelFiles, files, async () => 'a', fakeCheck({ x: 0.403, y: 1.471, z: 1.118 }));
    expect(rotated.warnings[0]).toMatch(/gedreht/);
    const off = await attachModelFiles(items.slice(0, 1), modelFiles, files, async () => 'a', fakeCheck({ x: 1.6, y: 1.471, z: 0.4 }));
    expect(off.warnings[0]).toMatch(/weichen um \d+ %/);
  });
});
