import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { pointInPolygon } from '../model/vec';
import type { RoomOf } from './budget';

/** Which room an item stands in, by its centre point (#75). */
export function furnitureRoomLookup(project: Pick<Project, 'rooms'>, derived: DerivedPlan): RoomOf {
  const rooms = project.rooms.flatMap((r) => {
    const g = derived.rooms.get(r.id);
    return g ? [{ id: r.id, name: r.name, interior: g.interior }] : [];
  });
  return (f) => {
    const r = rooms.find((x) => pointInPolygon({ x: f.x, y: f.y }, x.interior));
    return r ? { id: r.id, name: r.name } : null;
  };
}
