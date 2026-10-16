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
