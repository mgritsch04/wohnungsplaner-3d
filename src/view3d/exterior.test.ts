import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createSampleProject } from '../model/sample';
import { apartmentBox, exteriorWalls, facadeViewDirection, findEntrance } from './exterior';

describe('Blick von außen (#92)', () => {
  const project = createSampleProject();
  const derived = derivePlan(project);

  it('finds exterior walls but not every wall', () => {
    const ext = exteriorWalls(project, derived);
    expect(ext.length).toBeGreaterThan(0);
    expect(ext.length).toBeLessThanOrEqual(project.walls.length);
    for (const e of ext) expect(Math.hypot(e.outward.x, e.outward.y)).toBeCloseTo(1, 5);
  });

  it('outward normals point away from the apartment', () => {
    const box = apartmentBox(project, derived)!;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    for (const e of exteriorWalls(project, derived)) {
      const fp = derived.footprints.get(e.wallId)!;
      const mx = (fp.a.x + fp.b.x) / 2;
      const my = (fp.a.y + fp.b.y) / 2;
      const away = (mx - cx) * e.outward.x + (my - cy) * e.outward.y;
      expect(away).toBeGreaterThan(-0.01);
    }
  });

  it('the entrance is a door in an exterior wall, if the plan has one', () => {
    const ext = exteriorWalls(project, derived);
    const entrance = findEntrance(project, derived, ext);
    if (entrance) {
      const door = project.openings.find((o) => o.id === entrance.openingId)!;
      expect(door.kind).toBe('door');
      expect(ext.some((e) => e.wallId === door.wallId)).toBe(true);
    }
  });

  it('has no entrance without exterior doors, and the facade view still has a direction', () => {
    const dir = facadeViewDirection(null);
    expect(Math.hypot(dir.x, dir.y, dir.z)).toBeGreaterThan(0.5);
    expect(dir.y).toBeGreaterThan(0);
  });
});
