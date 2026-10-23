import { describe, expect, it } from 'vitest';
import { isPanelPair, normalizeShapeDims } from './shapeDims';
import { foundToCatalog } from '../assistant/productSearch';
import { GENERIC_CATALOG } from './generic';

describe('normalizeShapeDims', () => {
  it('curtain: length 250 becomes the height, depth a few cm', () => {
    expect(normalizeShapeDims('curtain', { width: 1.549, depth: 2.5, height: 1.65 })).toEqual({ width: 1.549, depth: 0.06, height: 2.5 });
  });
  it('curtain: drop reported as width', () => {
    expect(normalizeShapeDims('curtain', { width: 2.5, depth: 0.01, height: 1.4 })).toEqual({ width: 1.4, depth: 0.06, height: 2.5 });
  });
  it('correct curtain stays and is idempotent', () => {
    const d = { width: 1.4, depth: 0.02, height: 2.5 };
    expect(normalizeShapeDims('curtain', d)).toEqual(d);
    const once = normalizeShapeDims('curtain', { width: 1.5, depth: 2.5, height: 1.6 });
    expect(normalizeShapeDims('curtain', once)).toEqual(once);
  });
  it('rug: flat, long side as width', () => {
    expect(normalizeShapeDims('rug', { width: 1.7, depth: 0.012, height: 2.4 })).toEqual({ width: 2.4, depth: 1.7, height: 0.012 });
    expect(normalizeShapeDims('rug', { width: 1.7, depth: 2.4, height: 1.2 }).height).toBe(0.02);
  });
  it('picture: thickness is the smallest side', () => {
    expect(normalizeShapeDims('picture', { width: 0.5, depth: 0.7, height: 0.03 })).toEqual({ width: 0.5, depth: 0.03, height: 0.7 });
    const ok = { width: 0.5, depth: 0.03, height: 0.7 };
    expect(normalizeShapeDims('picture', ok)).toEqual(ok);
  });
  it('other shapes untouched', () => {
    const d = { width: 1, depth: 2, height: 3 };
    expect(normalizeShapeDims('sofa', d)).toBe(d);
  });
});

describe('found curtain', () => {
  it('SANELA 2 Gardinenschals 140x250 hangs 280 wide, 250 high, thin', () => {
    expect(isPanelPair('SANELA 2 Gardinenschals')).toBe(true);
    const ph = GENERIC_CATALOG.find((i) => i.id === 'generic-curtain')!;
    const item = foundToCatalog({ name: 'SANELA 2 Gardinenschals', url: 'https://www.ikea.com/at/de/p/sanela-1', shop: 'IKEA', price: 40, packSize: 1, width: 1.549, depth: 2.5, height: 1.65, why: '' }, ph);
    expect(item.height).toBe(2.5);
    expect(item.depth).toBeLessThanOrEqual(0.1);
    expect(item.width).toBeCloseTo(3.098, 3);
  });
});
