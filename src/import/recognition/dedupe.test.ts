import { describe, expect, it } from 'vitest';
import { dedupeOpenings } from './dedupe';

const door = (x: number, confidence: number, extra: { swingSide?: { x: number; y: number } } = {}) => ({ center: { x, y: 0 }, width: 0.9, kind: 'door' as const, confidence, ...extra });

describe('dedupeOpenings', () => {
  it('merges two doors on the same spot and keeps the surer one', () => {
    const r = dedupeOpenings([door(1, 0.45), door(1.05, 0.7)]);
    expect(r.removed).toBe(1);
    expect(r.openings).toHaveLength(1);
    expect(r.openings[0].confidence).toBe(0.7);
  });
  it('keeps neighbouring doors that do not overlap', () => {
    expect(dedupeOpenings([door(1, 0.7), door(2.2, 0.7)]).removed).toBe(0);
  });
  it('prefers the door with a swing side at equal confidence', () => {
    const r = dedupeOpenings([door(1, 0.6), door(1.1, 0.6, { swingSide: { x: 0, y: 1 } })]);
    expect(r.openings[0].swingSide).toBeDefined();
  });
});
