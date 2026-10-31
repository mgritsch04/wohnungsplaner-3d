import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { createSampleProject } from './sample';
import { planTour, tourPoseAt } from './tour';

const props = { thickness: 0.12, height: 2.6 };

function twoRooms(door: boolean) {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3.5, name: 'A', ...props });
  addRectRoom(p, { x: 4.12, y: 0, width: 4, depth: 3.5, name: 'B', ...props });
  if (door) {
    const w = closestWall(p, { x: 4.06, y: 1.75 })!;
    addOpening(p, w.wall.id, 'door', w.s, { width: 0.9 });
  }
  return p;
}

describe('planTour', () => {
  it('visits both rooms joined by a door and stops inside each', () => {
    const p = twoRooms(true);
    const plan = planTour(p, derivePlan(p));
    expect(plan.stops.map((s) => s.name)).toEqual(['A', 'B']);
    expect(plan.skipped).toEqual([]);
    expect(plan.duration).toBeGreaterThan(10);
    const end = tourPoseAt(plan, plan.duration)!;
    expect(end.stop).toBe(1);
    expect(end.x).toBeGreaterThan(4.12);
  });

  it('skips a room that cannot be reached', () => {
    const p = twoRooms(false);
    const plan = planTour(p, derivePlan(p));
    expect(plan.stops).toHaveLength(1);
    expect(plan.skipped).toEqual(['B']);
  });

  it('has a continuous camera and no jumps on the sample flat', () => {
    const p = createSampleProject();
    const plan = planTour(p, derivePlan(p));
    expect(plan.stops.length).toBeGreaterThan(1);
    let prev = tourPoseAt(plan, 0)!;
    for (let t = 0.1; t < plan.duration; t += 0.1) {
      const q = tourPoseAt(plan, t)!;
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.3);
      prev = q;
    }
  });

  it('is empty without rooms', () => {
    const p = createEmptyProject();
    expect(planTour(p, derivePlan(p)).stops).toEqual([]);
  });
});
