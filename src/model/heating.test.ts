import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { derivePlan } from './derived';
import { estimateHeating, windowFactorOf } from './heating';

const props = { thickness: 0.12, height: 2.6 };

describe('heating estimate (#90)', () => {
  it('is zero without rooms', () => {
    const p = createEmptyProject();
    expect(estimateHeating(p, derivePlan(p)).eurPerYear).toBe(0);
  });
  it('scales with area, insulation and source', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnen', ...props });
    const a = estimateHeating(p, derivePlan(p));
    expect(a.area).toBeGreaterThan(15);
    expect(a.windowFactor).toBeCloseTo(0.85); // no windows
    p.settings.insulation = 'unrenovated';
    const b = estimateHeating(p, derivePlan(p));
    expect(b.eurPerYear).toBeCloseTo(a.eurPerYear * 2);
    p.settings.heatingSource = 'electric';
    expect(estimateHeating(p, derivePlan(p)).eurPerYear).toBeGreaterThan(b.eurPerYear);
  });
  it('ignores balconies and clamps the window factor', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnen', ...props });
    const base = estimateHeating(p, derivePlan(p)).area;
    addRectRoom(p, { x: 4, y: 0, width: 3, depth: 2, name: 'Balkon', ...props });
    expect(estimateHeating(p, derivePlan(p)).area).toBeCloseTo(base);
    expect(windowFactorOf(0.9)).toBe(1.3);
    expect(windowFactorOf(0.15)).toBe(1);
  });
  it('counts windows of outer walls', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnen', ...props });
    p.openings.push({ id: 'o1', wallId: p.walls[0].id, kind: 'window', offset: 2, width: 1.2, height: 1.2, sillHeight: 0.9, hinge: 'start', swing: 'left', open: false });
    expect(estimateHeating(p, derivePlan(p)).windowArea).toBeCloseTo(1.44);
  });
});
