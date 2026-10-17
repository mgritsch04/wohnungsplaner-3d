import { describe, expect, it } from 'vitest';
import { assembleWalls, type Band } from './bands';

const opts = { mergeGap: 12, minOpening: 50, maxOpening: 260, joinTol: 8, maxThickness: 60 };
const door = () => ({ kind: 'door' as const, confidence: 0.6 });
const band = (o: 'h' | 'v', c: number, a0: number, a1: number, t: number): Band => ({ o, c, a0, a1, t, conf: 0.7 });

describe('wall assembly', () => {
  it('closes a door between a partition and an outer wall that ends just beside it (#214)', () => {
    // 1 px = 1 cm: an outer wall (32 cm) turns a corner at x = 788; a 13 cm partition at x = 771
    // ends 1.5 m before the horizontal wall – a door next to the corner
    const out = assembleWalls([band('h', 1457, 800, 1500, 32), band('v', 788, 1457, 2300, 32), band('v', 771, 1219, 1291, 13)], opts, door);
    const partition = out.walls.find((w) => w.a.x === 771 && w.b.x === 771)!;
    expect(partition.b.y).toBe(1457);
    // the horizontal wall reaches the partition, so the corner is closed
    const h = out.walls.find((w) => w.a.y === 1457 && w.b.y === 1457)!;
    expect(Math.min(h.a.x, h.b.x)).toBeLessThanOrEqual(771);
    expect(out.openings).toHaveLength(1);
    expect(out.openings[0].kind).toBe('door');
    expect(out.openings[0].width).toBeCloseTo(150, 0);
  });
});
