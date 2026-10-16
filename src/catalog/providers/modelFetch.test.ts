import { describe, expect, it } from 'vitest';
import { checkModelBlob, compareDimensions } from './modelFetch';
import { boxGlb } from '../../test/glbFixture';

describe('retailer model checks', () => {
  it('compares model size with product dimensions, detecting 90° rotation', () => {
    const ok = compareDimensions({ x: 0.8, y: 2.02, z: 0.28 }, { width: 80, depth: 28, height: 202 });
    expect(ok.maxDeviation).toBeCloseTo(0, 9);
    expect(ok.rotated).toBe(false);
    const turned = compareDimensions({ x: 0.28, y: 2.02, z: 0.8 }, { width: 80, depth: 28, height: 202 });
    expect(turned.rotated).toBe(true);
    expect(turned.maxDeviation).toBeCloseTo(0, 9);
    const off = compareDimensions({ x: 0.9, y: 2.02, z: 0.28 }, { width: 80, depth: 28, height: 202 });
    expect(off.maxDeviation).toBeCloseTo(0.125, 6);
  });
  it('validates fetched blobs as glTF', async () => {
    const m = await checkModelBlob(new Blob([boxGlb(0.8, 2.02, 0.28)]));
    expect(m.info.size.y).toBeCloseTo(2.02, 6);
    await expect(checkModelBlob(new Blob(['<html>Access denied</html>']))).rejects.toThrow();
  });
});
