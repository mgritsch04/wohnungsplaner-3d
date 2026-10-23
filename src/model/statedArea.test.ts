import { describe, expect, it } from 'vitest';
import { statedAreaSummary } from './statedArea';
import type { Room } from './schema';

const room = (id: string, statedArea?: number): Room => ({ id, name: id, nodeIds: ['a', 'b', 'c'], statedArea });

describe('statedAreaSummary', () => {
  it('compares only rooms that state an area', () => {
    const geo = new Map([['r1', { area: 20.4 }], ['r2', { area: 11.1 }], ['hall', { area: 5 }]]);
    const s = statedAreaSummary([room('r1', 21), room('r2', 12), room('hall')], geo)!;
    expect(s.stated).toBeCloseTo(33);
    expect(s.computed).toBeCloseTo(31.5);
    expect(s.diff).toBeCloseTo(-1.5);
    expect(s.withStated).toBe(2);
  });
  it('is null without stated areas', () => {
    expect(statedAreaSummary([room('r1')], new Map([['r1', { area: 5 }]]))).toBeNull();
  });
});
