import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import type { CatalogItem } from '../catalog/types';
import { completeRoom, guidePrompt, implausibleSize } from './designGuide';

const lookup = (id: string) => findCatalogItem(id);
const pick = (catalogId: string, quantity = 1) => ({ catalogId, quantity, placeholder: true });

describe('design guide per room type (#350)', () => {
  it('bath without washbasin and washing machine: the planner adds them (and the mirror)', () => {
    const r = completeRoom({ type: 'bath', picks: [pick('generic-toilet'), pick('generic-shower')], existing: [], area: 5, hasWindow: false, lookup });
    expect(r.add.map((a) => a.catalogId)).toEqual(expect.arrayContaining(['generic-washbasin', 'generic-washer', 'generic-bath-mirror']));
    expect(r.fixes.every((f) => f.kind === 'added' && /vom Planer ergänzt/.test(f.why))).toBe(true);
  });

  it('a tiny bath gets no washing machine; what already stands is not added twice', () => {
    const basin = findCatalogItem('generic-washbasin')!;
    const r = completeRoom({ type: 'bath', picks: [], existing: [{ ...basin, elevation: 0 }], area: 3, hasWindow: false, lookup });
    const ids = r.add.map((a) => a.catalogId);
    expect(ids).not.toContain('generic-washer');
    expect(ids).not.toContain('generic-washbasin');
  });

  it('storeroom: loose boxes on the floor are not enough – shelves come in', () => {
    const r = completeRoom({ type: 'utility', picks: [pick('generic-storage-box', 4)], existing: [], area: 3, hasWindow: false, lookup });
    expect(r.add.map((a) => a.catalogId)).toContain('generic-utility-shelf');
  });

  it('hall: a floor lamp is dropped, shoe cabinet and coat rack added', () => {
    const r = completeRoom({ type: 'hall', picks: [pick('generic-wardrobe-150'), pick('generic-floor-lamp')], existing: [], area: 6, hasWindow: false, lookup });
    expect(r.drop).toEqual([1]);
    expect(r.add.map((a) => a.catalogId)).toEqual(expect.arrayContaining(['generic-shoe-cabinet', 'generic-coat-rack']));
  });

  it('bedroom: curtain only with a window; an imported bed frame gets a mattress', () => {
    const frame: CatalogItem = { ...findCatalogItem('generic-bed-160')!, id: 'imp-bed', name: 'MALM Bettgestell', model: { type: 'gltf', url: 'x.glb', fallbackShape: 'bed' } } as CatalogItem;
    const look = (id: string) => (id === 'imp-bed' ? frame : lookup(id));
    const noWindow = completeRoom({ type: 'bedroom', picks: [pick('imp-bed')], existing: [], area: 12, hasWindow: false, lookup: look });
    expect(noWindow.add.map((a) => a.catalogId)).not.toContain('generic-curtain');
    expect(noWindow.add.map((a) => a.catalogId)).toContain('generic-mattress');
    const withWindow = completeRoom({ type: 'bedroom', picks: [pick('imp-bed')], existing: [], area: 12, hasWindow: true, lookup: look });
    expect(withWindow.add.map((a) => a.catalogId)).toContain('generic-curtain');
  });

  it('every room type has rules for the prompt', () => {
    for (const t of ['living', 'bedroom', 'kids', 'office', 'dining', 'bath', 'hall', 'utility', 'balcony'] as const) expect(guidePrompt(t).length, t).toBeGreaterThan(0);
  });

  it('implausible product sizes are recognised (seat height instead of chair, top instead of desk)', () => {
    const chair = findCatalogItem('generic-office-chair')!;
    expect(implausibleSize({ ...chair, height: 0.45 })).toMatch(/Bürostuhl/);
    expect(implausibleSize(chair)).toBeNull();
    const desk = findCatalogItem('generic-desk')!;
    expect(implausibleSize({ ...desk, height: 0.04 })).toMatch(/Schreibtisch/);
    expect(implausibleSize(desk)).toBeNull();
  });
});
