import { describe, expect, it } from 'vitest';
import type { PendingDraft } from './ikeaDrafts';
import { addIkeaArticles, completePending, estimateFromModel, IKEA_SELECTION_MAX, isIkeaItem, takeInbox, type IkeaFetchDeps } from './ikeaSelection';
import { fetchHelperProduct, helperAvailable, readDraft } from './providers/ikeaHelper';
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

describe('Lesezeichen-Eingang (#221)', () => {
  it('übernimmt gesendete Seiten, meldet ungültige und bestätigt alle beim Helfer', async () => {
    const { d, added } = deps();
    const acked: string[][] = [];
    const outcomes = await takeInbox({
      ...d,
      fetchInbox: async () => [
        { id: 'a', receivedAt: '', product: { article: '104.099.32', entry: entry('104.099.32', '10409932.glb'), model: '10409932.glb' } },
        { id: 'b', receivedAt: '', product: { article: 'mx1', entry: null, model: null } },
      ],
      ackInbox: async (ids) => void acked.push(ids),
    });
    expect(outcomes.map((o) => [o.ok, o.withModel])).toEqual([
      [true, true],
      [false, undefined],
    ]);
    expect(outcomes[0].id).toBe('import-ikea-auswahl-104.099.32');
    expect(added).toHaveLength(1);
    expect(acked).toEqual([['a', 'b']]);
  });
});

describe('Maße fehlen (#269)', () => {
  // SYNTHETIC plant page result: name and price known, only a height
  const draft = readDraft({ name: 'TESTPFLANZE Synthetisch', category: 'decor', width: null, depth: null, height: 120, price: 19.99, articleNumber: '000.000.69', modelFile: '00000069.glb', retailer: 'IKEA Österreich' })!;

  it('liest Entwürfe vom Helfer vorsichtig ein', () => {
    expect(draft.missing).toEqual(['width', 'depth']);
    expect(readDraft({ name: '' })).toBeUndefined();
    expect(readDraft({ name: 'X', width: -3, modelFile: '../böse.glb' })).toMatchObject({ width: null, modelFile: undefined, missing: ['width', 'depth', 'height'] });
  });

  it('legt Produkte ohne vollständige Maße zurück, statt sie zu verwerfen', async () => {
    const parked: PendingDraft[] = [];
    const { d, added } = deps({ addDraft: (p) => void parked.push(p) });
    const acked: string[][] = [];
    const outcomes = await takeInbox({
      ...d,
      fetchInbox: async () => [{ id: 'p', receivedAt: '', product: { article: '000.000.69', entry: null, draft, model: '00000069.glb' } }],
      ackInbox: async (ids) => void acked.push(ids),
    });
    expect(outcomes[0]).toMatchObject({ ok: false, pending: true, name: 'TESTPFLANZE Synthetisch' });
    expect(parked.map((p) => [p.article, p.model])).toEqual([['000.000.69', '00000069.glb']]);
    expect(added).toHaveLength(0);
    expect(acked).toEqual([['p']]);
  });

  it('übernimmt den Entwurf erst mit allen Maßen, samt 3D-Modell', async () => {
    const removed: string[] = [];
    const { d, added } = deps();
    const pending: PendingDraft = { article: '000.000.69', draft, model: '00000069.glb', receivedAt: '' };
    const missing = await completePending(pending, { width: 24 }, { ...d, removeDraft: (a) => void removed.push(a) });
    expect(missing).toMatchObject({ ok: false });
    expect(missing.message).toMatch(/Breite, Tiefe und Höhe/);
    const o = await completePending(pending, { width: 24, depth: 24 }, { ...d, removeDraft: (a) => void removed.push(a) });
    expect(o).toMatchObject({ ok: true, withModel: true, name: 'TESTPFLANZE Synthetisch' });
    expect(added[0].width).toBeCloseTo(0.24);
    expect(added[0].height).toBeCloseTo(1.2);
    expect(removed).toEqual(['000.000.69']);
  });

  it('schätzt Maße aus dem schon geladenen 3D-Modell (cm, gerundet)', async () => {
    const { d } = deps({ check: (async (blob: Blob) => ({ blob, info: { size: { x: 0.553, y: 1.304, z: 0.48 } } })) as never });
    expect(await estimateFromModel('00000069.glb', {}, d)).toEqual({ width: 55, depth: 48, height: 130 });
  });

  it('nimmt bei Pflanzen Breite und Tiefe vom Topf, nicht von den Blättern (#269)', async () => {
    const { d } = deps({ check: (async (blob: Blob) => ({ blob, info: { size: { x: 0.553, y: 1.304, z: 0.48 }, base: { x: 0.19, z: 0.19 } } })) as never });
    expect(await estimateFromModel('00000069.glb', { plant: true }, d)).toEqual({ width: 19, depth: 19, height: 130 });
  });
});
