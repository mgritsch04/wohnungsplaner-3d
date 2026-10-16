import { describe, expect, it } from 'vitest';
import { describeIkeaModelUrl, pickIkeaModel } from './ikeaModels';

// URL shapes as declared on real IKEA Austria product pages (2026-10-16); hashes shortened.
const u = (q: string, f: string, item = '10409932') => `https://web-api.ikea.com/dimma/assets/1.2/${item}/PS01_S01_NV01/${q}/${f}/abc-${item}_PS01_S01_NV01_${q}.${f === 'gltf' ? 'gltf' : 'glb'}?cn=pip`;

describe('IKEA model variants', () => {
  it('describes item number, quality and format', () => {
    expect(describeIkeaModelUrl(u('iqp3', 'glb_draco'))).toMatchObject({ itemNo: '10409932', quality: 'iqp3', format: 'glb_draco' });
    expect(describeIkeaModelUrl('https://example.com/x.glb')).toMatchObject({ itemNo: null, quality: null, format: null });
  });

  it('prefers a mid-quality Draco GLB, falls back to reduced variants, never picks multi-file glTF', () => {
    const kallax = [u('iqp3', 'glb_draco'), u('iqp2', 'glb_draco'), u('iqp1', 'glb_draco'), u('rqp3', 'glb_draco'), u('iqp2', 'glb'), u('iqp2', 'gltf')];
    expect(pickIkeaModel(kallax)).toBe(u('iqp2', 'glb_draco'));
    // ENHET 106.230.36 only offers rqp variants
    const enhet = [u('rqp3', 'glb_draco', '10623036'), u('rqp2', 'glb_draco', '10623036'), u('rqp1', 'glb_draco', '10623036')];
    expect(pickIkeaModel(enhet)).toBe(enhet[0]);
    expect(pickIkeaModel([u('iqp2', 'gltf')])).toBeNull();
    expect(pickIkeaModel([])).toBeNull();
  });
});

describe('IKEA article lists', () => {
  it('finds article numbers with quantities, combinations and URLs, merging duplicates', async () => {
    const { parseArticleList, ikeaProductUrl, formatArticle, guessCategory } = await import('./ikeaList');
    const list = parseArticleList('KALLAX 104.099.32\n2 x 106.230.36\nS895.792.19 ×1\nhttps://www.ikea.com/at/de/p/kallax-regal-weiss-10409932/\nPreis 99,00');
    expect(list.map((a) => [formatArticle(a), a.quantity])).toEqual([
      ['104.099.32', 2],
      ['106.230.36', 2],
      ['S895.792.19', 1],
    ]);
    expect(ikeaProductUrl(list[2])).toBe('https://www.ikea.com/at/de/p/-s89579219/');
    expect(guessCategory('SALTSJÖBADEN 3er-Bettsofa mit Récamiere')).toBe('sofa');
    expect(guessCategory('ENHET Hochschrank mit Tür')).toBe('storage');
    expect(guessCategory('MICKE Schreibtisch')).toBe('desk');
  });
});
