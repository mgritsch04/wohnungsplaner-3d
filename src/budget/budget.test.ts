import { describe, expect, it } from 'vitest';
import { budgetToCsv, computeBudget, groupBudgetLines } from './budget';
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

  it('shopping list CSV: sizes column, identical items merged into one line with quantity (#57)', () => {
    const a = item('generic-chair', {});
    const b = item('generic-chair', {});
    const c = item('generic-chair', { quantity: 2 });
    const table = item('generic-dining-table-4', {});
    const csv = budgetToCsv(computeBudget([a, b, c, table]));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Maße B × T × H (cm)');
    const chair = lines.filter((l) => l.includes(a.name));
    expect(chair).toHaveLength(1);
    expect(chair[0]).toContain('45 × 52 × 86');
    expect(chair[0]).toContain(';4;1;4;70,00;70,00;280,00;');
  });
});


describe('shopping list by room (#75)', () => {
  const rooms = { k: { id: 'k', name: 'Küche' }, b: { id: 'b', name: 'Bad' } };
  const where: Record<string, { id: string; name: string } | null> = {};
  const roomOf = (f: { id: string }) => where[f.id] ?? null;
  const a = item('generic-chair', { id: 'a', quantity: 2 }); // 2 × 70
  const a2 = item('generic-chair', { id: 'a2' }); // same chair, other room
  const c = item('generic-desk', { id: 'c', price: { amount: 150, currency: 'EUR', status: 'user' } });
  const d = item('generic-rug-200', { id: 'd', price: undefined });
  Object.assign(where, { a: rooms.k, a2: rooms.b, c: rooms.k, d: null });

  it('subtotals per room, rooms alphabetically, "Ohne Raum" last', () => {
    const b = computeBudget([a, a2, c, d], roomOf);
    expect(b.byRoom.map((r) => r.label)).toEqual(['Bad', 'Küche', 'Ohne Raum']);
    expect(b.byRoom.map((r) => r.total)).toEqual([70, 290, 0]);
    expect(b.byRoom[2]).toMatchObject({ roomId: null, missing: 1 });
    // without a lookup everything is "Ohne Raum"
    expect(computeBudget([a, c]).byRoom).toEqual([{ roomId: null, label: 'Ohne Raum', total: 290, count: 3, missing: 0 }]);
  });

  it('keeps identical items in different rooms apart only when grouping by room', () => {
    const b = computeBudget([a, a2], roomOf);
    expect(groupBudgetLines(b.lines).map((l) => l.quantity)).toEqual([3]);
    expect(groupBudgetLines(b.lines, { byRoom: true }).map((l) => [l.room, l.quantity])).toEqual([
      ['Küche', 2],
      ['Bad', 1],
    ]);
  });

  it('CSV by room: room column, sorted by room, subtotal row per room, grand total', () => {
    const rows = budgetToCsv(computeBudget([a, a2, c, d], roomOf), { byRoom: true }).slice(1).split('\r\n');
    expect(rows[0].startsWith('Raum;Kategorie;Artikel')).toBe(true);
    const firstCol = rows.slice(1).map((r) => r.split(';')[0]);
    expect(firstCol).toEqual(['Bad', 'Bad', 'Küche', 'Küche', 'Küche', 'Ohne Raum', 'Ohne Raum', '', '']);
    expect(rows).toContain('Bad;;Zwischensumme Bad;;;;;;;;70,00;;');
    expect(rows).toContain('Küche;;Zwischensumme Küche;;;;;;;;290,00;;');
    expect(rows.at(-2)).toBe(';;Gesamt (bekannte Preise);;;;;;;;360,00;;');
    expect(rows.at(-1)).toBe(';;1 Position(en) ohne Preis;;;;;;;;;;');
  });
});

describe('room lookup (#75)', () => {
  it('assigns sample furniture to the room it stands in', async () => {
    const { createSampleProject } = await import('../model/sample');
    const { derivePlan } = await import('../model/derived');
    const { furnitureRoomLookup } = await import('./rooms');
    const p = createSampleProject();
    const roomOf = furnitureRoomLookup(p, derivePlan(p));
    const names = new Set(p.furniture.map((f) => roomOf(f)?.name));
    expect(names).toEqual(new Set(['Wohnzimmer', 'Schlafzimmer']));
    expect(roomOf({ ...p.furniture[0], x: -50, y: -50 })).toBeNull();
  });
});
