import { describe, expect, it } from 'vitest';
import { budgetToCsv, computeBudget } from './budget';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';

const item = (id: string, patch: Record<string, unknown> = {}) => ({ ...createFurnitureFromCatalog(findCatalogItem(id)!, { x: 0, y: 0 }), ...patch });

describe('budget', () => {
  it('sums prices × quantity and separates price states', () => {
    const lines = [
      item('generic-chair', { quantity: 4 }), // 4 × 70 estimate
      item('generic-sofa-3', { price: { amount: 999.9, currency: 'EUR', status: 'confirmed' }, retailer: 'IKEA' }),
      item('generic-desk', { price: { amount: 150, currency: 'EUR', status: 'user' } }),
      item('generic-rug-200', { price: undefined }),
    ];
    const b = computeBudget(lines);
    expect(b.total).toBeCloseTo(280 + 999.9 + 150, 6);
    expect(b.estimated).toBe(280);
    expect(b.confirmed).toBeCloseTo(999.9, 6);
    expect(b.userEntered).toBe(150);
    expect(b.missingCount).toBe(1);
    expect(b.byRetailer.find((r) => r.retailer === 'IKEA')?.total).toBeCloseTo(999.9, 6);
    expect(b.byCategory.find((c) => c.category === 'textile')?.missing).toBe(1);
  });

  it('exports a semicolon CSV with German decimals and escaping', () => {
    const csv = budgetToCsv(computeBudget([item('generic-chair', { name: 'Stuhl "Anna"; Eiche', quantity: 2 })]));
    expect(csv.startsWith('﻿Kategorie;Artikel')).toBe(true);
    expect(csv).toContain('"Stuhl ""Anna""; Eiche"');
    expect(csv).toContain('70,00;140,00;Schätzung');
    expect(csv).toContain('Gesamt (bekannte Preise)');
  });
});
