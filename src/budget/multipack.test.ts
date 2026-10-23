import { describe, expect, it } from 'vitest';
import { budgetToCsv, computeBudget, groupBudgetLines } from './budget';
import { computePurchasePlan } from './purchasePlan';
import { detectPackSize, normalizePackSize, packsNeeded } from '../catalog/packSize';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import type { CatalogItem } from '../catalog/types';
import { parseFound } from '../assistant/productSearch';

const item = (price?: CatalogItem['price']): CatalogItem => ({
  id: 'x',
  name: 'Kerzenhalter 3er-Set',
  category: 'decor',
  width: 0.1,
  depth: 0.1,
  height: 0.2,
  color: '#aaaaaa',
  model: { type: 'procedural', shape: 'box' },
  price,
  approximate: true,
  solid: true,
  tags: [],
  source: 'imported',
} as CatalogItem);

const furniture = (qty: number, packSize?: number, amount = 9) => {
  const f = createFurnitureFromCatalog(item({ amount, currency: 'EUR', status: 'user', ...(packSize ? { packSize } : {}) }), { x: 0, y: 0 });
  f.quantity = qty;
  return f;
};

describe('Multipacks', () => {
  it('rundet die Packungen auf und rechnet den Gesamtpreis pro Packung', () => {
    const b = computeBudget([furniture(4, 3)]);
    expect(b.lines[0]).toMatchObject({ quantity: 4, packSize: 3, packs: 2, unitPrice: 9, piecePrice: 3, total: 18 });
    expect(b.total).toBe(18);
  });
  it('ohne Packungsgröße wie bisher (Standard 1)', () => {
    const b = computeBudget([furniture(4)]);
    expect(b.lines[0]).toMatchObject({ packSize: 1, packs: 4, piecePrice: 9, total: 36 });
  });
  it('Gruppierung summiert Packungen und Preis; Einkaufsplan kennt die Packungen', () => {
    const lines = computeBudget([furniture(1, 3), furniture(1, 3)]).lines;
    const g = groupBudgetLines(lines);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ quantity: 2, packs: 2, total: 18 });
    const plan = computePurchasePlan(lines, () => 'movein', [], {});
    expect(plan.total).toBe(18);
    expect(plan.phases[0].items[0]).toMatchObject({ packs: 1, packSize: 3 });
  });
  it('CSV enthält Stück pro Packung, Packungen und Stückpreis', () => {
    const csv = budgetToCsv(computeBudget([furniture(4, 3)]));
    expect(csv).toContain('Stück pro Packung');
    expect(csv).toContain(';4;3;2;9,00;3,00;18,00;');
  });
  it('erkennt Multipack-Hinweise im Namen', () => {
    expect(detectPackSize('FÖRENKLA Kerzenhalter, 3er-Set')).toBe(3);
    expect(detectPackSize('Glas 6 Stück')).toBe(6);
    expect(detectPackSize('Becher 4-pack')).toBe(4);
    expect(detectPackSize('Packung à 12')).toBe(12);
    expect(detectPackSize('Sofa 3-Sitzer')).toBeNull();
    expect(detectPackSize('Regal 1 Stück')).toBeNull();
  });
  it('prüft Packungsgrößen', () => {
    expect(normalizePackSize('3')).toBe(3);
    expect(normalizePackSize(1)).toBeUndefined();
    expect(normalizePackSize(2.5)).toBeUndefined();
    expect(packsNeeded(7, 3)).toBe(3);
  });
  it('liest pack_size aus dem Bericht von Claude', () => {
    const [p] = parseFound([{ name: 'Gläser 6er', url: 'https://www.ikea.com/at/de/p/x-1/', price: 12, pack_size: 6, width_cm: 8, depth_cm: 8, height_cm: 10 }]);
    expect(p.packSize).toBe(6);
    const [q] = parseFound([{ name: 'Tisch', url: 'https://www.ikea.com/at/de/p/y-2/', price: 12, width_cm: 80, depth_cm: 80, height_cm: 70 }]);
    expect(q.packSize).toBe(1);
  });
});
