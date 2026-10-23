import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { loadChecked, progress, saveChecked, shoppingGroups } from './shopList';

describe('Einkaufsliste im Laden-Modus (#361)', () => {
  beforeEach(() => localStorage.clear());

  it('groups the items by room with their size', () => {
    const groups = shoppingGroups(createSampleProject());
    expect(groups.map((g) => g.label)).toEqual(expect.arrayContaining(['Wohnzimmer', 'Schlafzimmer']));
    const sofa = groups.flatMap((g) => g.items).find((i) => i.name === 'Sofa 3-Sitzer')!;
    expect(sofa.size).toBe('210 × 90 × ' + sofa.size.split(' × ')[2]);
    expect(sofa.quantity).toBe(1);
  });

  it('keeps ticks per project, also after a reload', () => {
    saveChecked('p1', new Set(['a', 'b']));
    saveChecked('p2', new Set(['c']));
    expect([...loadChecked('p1')].sort()).toEqual(['a', 'b']);
    expect([...loadChecked('p2')]).toEqual(['c']);
    saveChecked('p1', new Set());
    expect(loadChecked('p1').size).toBe(0);
  });

  it('survives broken stored data and counts only existing items', () => {
    localStorage.setItem('wohnungsplaner-shop-checked:p', '{kaputt');
    expect(loadChecked('p').size).toBe(0);
    const groups = shoppingGroups(createSampleProject());
    const first = groups[0].items[0].id;
    expect(progress(groups, new Set([first, 'gelöscht']))).toEqual({ done: 1, total: groups.flatMap((g) => g.items).length });
  });
});
