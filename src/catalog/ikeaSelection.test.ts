import { describe, expect, it } from 'vitest';
import { addIkeaArticles, IKEA_SELECTION_MAX, isIkeaItem, type IkeaFetchDeps } from './ikeaSelection';
import { fetchHelperProduct, helperAvailable } from './providers/ikeaHelper';
import type { CatalogItem } from './types';

// synthetic helper answers (no real product data)
const entry = (art: string, modelFile?: string) => ({
  name: `Testregal ${art}`,
  category: 'storage',
  width: 80,
  depth: 40,
  height: 120,
  price: 49.99,
  priceDate: '2026-10-17',
  brand: 'IKEA',
  retailer: 'IKEA Österreich',
  productUrl: `https://www.ikea.com/at/de/p/-${art.replace(/\./g, '')}/`,
  articleNumber: art,
  ...(modelFile ? { modelFile } : {}),
});

function deps(over: Partial<IkeaFetchDeps> = {}) {
  const added: CatalogItem[] = [];
  const d: IkeaFetchDeps = {
    fetchProduct: async (a, opts) => {
      const art = `${a.digits.slice(0, 3)}.${a.digits.slice(3, 6)}.${a.digits.slice(6)}`;
      const model = opts.model ? `${a.digits}.glb` : null;
      return { article: art, entry: entry(art, model ?? undefined), model };
    },
    fetchModel: async (file) => new File([new Uint8Array([1])], file),
    store: async () => 'asset_1',
    check: (async (blob: Blob) => ({ blob, info: { size: { x: 0.8, y: 1.2, z: 0.4 } } })) as never,
    addItems: async (items) => (added.push(...items), items.length),
    ...over,
  };
  return { d, added };
}

describe('IKEA-Auswahl über den lokalen Helfer', () => {
  it('übernimmt Links und Artikelnummern samt 3D-Modell in den Katalog', async () => {
    const { d, added } = deps();
    const progress: string[] = [];
    const res = await addIkeaArticles('https://www.ikea.com/at/de/p/test-regal-weiss-10409932/\n106.230.36', { model: true, onProgress: (n, t, c) => progress.push(`${n}/${t} ${c}`) }, d);
    expect(res.outcomes.map((o) => [o.article, o.ok, o.withModel])).toEqual([
      ['104.099.32', true, true],
      ['106.230.36', true, true],
    ]);
    expect(added).toHaveLength(2);
    expect(added[0].id).toBe('import-ikea-auswahl-104.099.32');
    expect(added[0].model).toEqual({ type: 'gltf', assetId: 'asset_1', fallbackShape: 'cabinet' });
    expect(added[0].width).toBeCloseTo(0.8);
    expect(added.every(isIkeaItem)).toBe(true);
    expect(progress).toEqual(['0/2 104.099.32', '1/2 106.230.36', '2/2 ']);
  });

  it('ohne Modell bleibt die maßhaltige Näherung', async () => {
    const { d, added } = deps();
    const res = await addIkeaArticles('104.099.32', { model: false }, d);
    expect(res.outcomes[0].withModel).toBe(false);
    expect(added[0].model.type).toBe('procedural');
  });

  it('meldet Fehler je Artikel und macht mit den übrigen weiter', async () => {
    const { d, added } = deps({
      fetchProduct: async (a) => {
        if (a.digits === '10409932') return { article: '104.099.32', entry: null, model: null, reason: 'HTTP 404' };
        if (a.digits === '20000000') throw new Error('Der IKEA-Helfer antwortet nicht.');
        return { article: '106.230.36', entry: entry('106.230.36'), model: null };
      },
    });
    const res = await addIkeaArticles('104.099.32 200.000.00 106.230.36', { model: true }, d);
    expect(res.outcomes.map((o) => [o.ok, o.message])).toEqual([
      [false, 'HTTP 404'],
      [false, 'Der IKEA-Helfer antwortet nicht.'],
      [true, undefined],
    ]);
    expect(added).toHaveLength(1);
  });

  it('lässt ein fehlerhaftes Modell zurück auf die Näherung fallen', async () => {
    const { d, added } = deps({ fetchModel: async () => Promise.reject(new Error('HTTP 404')) });
    const res = await addIkeaArticles('104.099.32', { model: true }, d);
    expect(res.outcomes[0]).toMatchObject({ ok: true, withModel: false });
    expect(res.outcomes[0].message).toMatch(/Näherungsmodell/);
    expect(added[0].model.type).toBe('procedural');
  });

  it(`begrenzt einen Durchgang auf ${IKEA_SELECTION_MAX} Artikel`, async () => {
    const { d } = deps();
    const many = Array.from({ length: IKEA_SELECTION_MAX + 3 }, (_, i) => `100.000.${String(i).padStart(2, '0')}`).join(' ');
    const res = await addIkeaArticles(many, { model: false }, d);
    expect(res.outcomes).toHaveLength(IKEA_SELECTION_MAX);
    expect(res.skipped).toBe(3);
  });

  it('weist ungültige Produktdaten des Helfers zurück', async () => {
    const { d, added } = deps({ fetchProduct: async () => ({ article: '104.099.32', entry: { name: 'x', width: -1 }, model: null }) });
    const res = await addIkeaArticles('104.099.32', { model: false }, d);
    expect(res.outcomes[0].ok).toBe(false);
    expect(added).toHaveLength(0);
  });
});

describe('Helfer-Client', () => {
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('erkennt den Helfer nur an seiner Kennung', async () => {
    expect(await helperAvailable('http://x', fake(200, { ok: true, name: 'wohnungsplaner-ikea-helper' }))).toBe(true);
    expect(await helperAvailable('http://x', fake(200, { ok: true, name: 'anderer-dienst' }))).toBe(false);
    expect(await helperAvailable('http://x', (async () => Promise.reject(new TypeError('offline'))) as typeof fetch)).toBe(false);
  });

  it('fragt genau eine Artikelnummer ab und filtert unsichere Modellnamen', async () => {
    let asked = '';
    const f = (async (url: string) => ((asked = url), new Response(JSON.stringify({ article: '104.099.32', entry: {}, model: '../x.glb' })))) as unknown as typeof fetch;
    const r = await fetchHelperProduct({ digits: '10409932', combination: false, quantity: 1 }, { model: true }, 'http://h', f);
    expect(asked).toBe('http://h/product?article=104.099.32&model=1');
    expect(r.model).toBeNull();
  });

  it('gibt die Fehlermeldung des Helfers weiter', async () => {
    await expect(fetchHelperProduct({ digits: '10409932', combination: false, quantity: 1 }, { model: false }, 'http://h', fake(400, { error: 'Keine IKEA-Artikelnummer erkannt' }))).rejects.toThrow(
      /Keine IKEA-Artikelnummer/,
    );
  });
});
