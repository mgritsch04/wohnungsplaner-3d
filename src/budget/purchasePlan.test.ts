import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget';
import { computePurchasePlan, devicePhase } from './purchasePlan';
import { createEmptyProject } from '../model/factory';
import { ProjectSchema, type Furniture, type SmartDevice } from '../model/schema';

const item = (id: string, amount: number, buyPhase?: Furniture['buyPhase']) =>
  ({ id, name: id, category: 'sofa', quantity: 1, width: 1, depth: 1, height: 1, price: { amount, status: 'user' }, buyPhase }) as unknown as Furniture;
const dev = (id: string, kind: SmartDevice['kind'], productId?: string, buyPhase?: SmartDevice['buyPhase']): SmartDevice =>
  ({ id, name: id, kind, productId, x: 0, y: 0, elevation: 1, rotation: 0, buyPhase }) as SmartDevice;

describe('Kaufplan in Phasen (#363)', () => {
  const furniture = [item('a', 500), item('b', 300, 'month2'), item('c', 200, 'later')];
  const lines = computeBudget(furniture).lines;
  const phaseOf = (id: string) => furniture.find((f) => f.id === id)!.buyPhase ?? 'movein';

  it('groups by phase with a sum each; the grand total stays the budget total', () => {
    const plan = computePurchasePlan(lines, phaseOf, [], {});
    expect(plan.phases.map((p) => p.total)).toEqual([500, 300, 200]);
    expect(plan.total).toBe(computeBudget(furniture).total);
  });

  it('warns only when a phase exceeds its budget', () => {
    const plan = computePurchasePlan(lines, phaseOf, [], { movein: 400, month2: 300 });
    expect(plan.phases[0].over).toBe(100);
    expect(plan.phases[1].over).toBeNull();
    expect(plan.phases[2].over).toBeNull();
  });

  it('moves a smart-home device to a later phase and keeps the sum consistent', () => {
    const d = dev('d1', 'motion', 'ikea-vallhorn');
    expect(devicePhase(d)).toBe('movein');
    const before = computePurchasePlan(lines, phaseOf, [d], {});
    const after = computePurchasePlan(lines, phaseOf, [{ ...d, buyPhase: 'later' }], {});
    expect(after.phases[2].items.map((i) => i.id)).toContain('d1');
    expect(after.phases[0].items.map((i) => i.id)).not.toContain('d1');
    expect(after.total).toBe(before.total);
    expect(after.total).toBe(1010);
  });

  it('defaults devices by concept phase and counts unknown prices as missing', () => {
    expect(devicePhase(dev('s', 'speaker'))).toBe('later');
    expect(devicePhase(dev('l', 'light'))).toBe('month2');
    const plan = computePurchasePlan([], () => 'movein', [dev('s', 'speaker')], {});
    expect(plan.phases[2].missing).toBe(1);
  });

  it('old projects without the new fields stay valid', () => {
    const p = JSON.parse(JSON.stringify(createEmptyProject()));
    delete p.purchaseBudgets;
    expect(ProjectSchema.parse(p).purchaseBudgets).toEqual({});
  });
});
