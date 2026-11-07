import { describe, expect, it } from 'vitest';
import { lampPlan } from './lightPlan';

describe('Lichtplan (L3, L9, L12)', () => {
  it('is warm where one lives, neutral at the desk and in a closed kitchen, Ra 90 where colours matter', () => {
    expect(lampPlan('living', 'floor-lamp', { on: 'sofa' })).toEqual({ kelvin: 2700, ra: 80, use: 'zone' });
    expect(lampPlan('bedroom', 'table-lamp', { on: 'desk' }).kelvin).toBe(4000);
    expect(lampPlan('kitchen', 'strip', { strip: true })).toMatchObject({ kelvin: 4000, ra: 90 });
    expect(lampPlan('living', 'strip', { strip: true, openKitchen: true }).kelvin).toBe(3000);
    expect(lampPlan('living', 'pendant', { on: 'table' })).toMatchObject({ kelvin: 2700, ra: 90 });
    expect(lampPlan('bath', 'pendant').ra).toBe(90);
    expect(lampPlan('living', 'table-lamp', { on: 'wall' }).use).toBe('stimmung');
  });
});
