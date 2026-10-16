import { describe, expect, it } from 'vitest';
import designJson from './fixtures/ikea-pax-design.json';
import { IkeaPlanError, parseIkeaPlannerJson, placeIkeaPlan } from './ikeaPlanner';

// Reduced copy of a REAL design stored by the IKEA Austria PAX planner on 2026-10-16
// (anonymous test design created for this research: corner combination, 5 × 4 m room).
const design = JSON.stringify(designJson);

describe('IKEA planner design import', () => {
  it('reads room, top-level frames with transforms and their fittings', () => {
    const plan = parseIkeaPlannerJson(design);
    expect(plan.code).toBe('343J5TD-TEST');
    expect(plan.application).toBe('storageonepax');
    expect(plan.room?.height).toBeCloseTo(2.5, 6);
    const xs = plan.room!.corners.map((c) => c.x);
    const ys = plan.room!.corners.map((c) => c.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-2.5, 2.5, 0, 4]);
    expect(plan.items).toHaveLength(5);
    const back = plan.items.filter((i) => i.itemNo === '60458213');
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ width: 0.498, depth: 0.35, height: 2.364, elevation: 0, rotation: -0 });
    expect(back[0].y - back[0].depth / 2).toBeCloseTo(0, 3); // back against the back wall
    const corner = plan.items.find((i) => i.itemNo === '80458207')!;
    // rotated 270° → its back is at the right wall (x = 2.5)
    expect(corner.rotation).toBeCloseTo((-270 * Math.PI) / 180, 9);
    expect(corner.x + corner.depth / 2).toBeCloseTo(2.5, 3);
    expect(Object.keys(corner.fittings).length).toBeGreaterThan(0);
    expect(plan.itemList.length).toBeGreaterThan(5);
  });

  it('places the plan at an origin with wall centre lines around the clear interior', () => {
    const plan = parseIkeaPlannerJson(design);
    const placed = placeIkeaPlan(plan, { x: 10, y: 0 }, 0.12);
    const cx = placed.centerline!.map((p) => p.x);
    expect(Math.min(...cx)).toBeCloseTo(9.94, 6);
    expect(Math.max(...cx)).toBeCloseTo(15.06, 6);
    const f = placed.furniture.find((i) => i.articleNumber === '804.582.07')!;
    expect(f.x + f.depth / 2).toBeCloseTo(15, 3);
    expect(f.productUrl).toBe('https://www.ikea.com/at/de/p/-80458207/');
    expect(f.description).toMatch(/Planungscode 343J5TD-TEST\) · enthält: .*Kleiderstange/);
  });

  it('rejects unrelated JSON with a clear message', () => {
    expect(() => parseIkeaPlannerJson('{"a":1}')).toThrow(IkeaPlanError);
    expect(() => parseIkeaPlannerJson('kein json')).toThrow(/Kein gültiges JSON/);
  });
});

describe('IKEA design → project', () => {
  it('builds the room and places the frames inside it without wall collisions', async () => {
    const { applyIkeaPlan } = await import('../../import/ikeaPlanActions');
    const { createSampleProject } = await import('../../model/sample');
    const { derivePlan } = await import('../../model/derived');
    const { placementIssues } = await import('../../model/placement');
    const p = createSampleProject();
    const before = p.furniture.length;
    const res = applyIkeaPlan(p, parseIkeaPlannerJson(design));
    expect(res.roomId).toBeTruthy();
    expect(res.furniture).toBe(5);
    const d = derivePlan(p);
    const g = d.rooms.get(res.roomId!)!;
    const xs = g.interior.map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5, 3); // clear width as in IKEA's planner
    const added = p.furniture.slice(before);
    for (const f of added) {
      const issues = placementIssues(p, d, f).filter((i) => i.kind === 'wall' || i.kind === 'outside');
      expect(issues, f.name).toEqual([]);
    }
    // the added room lies right of the sample apartment
    expect(Math.min(...xs)).toBeGreaterThan(8.6);
  });
});
