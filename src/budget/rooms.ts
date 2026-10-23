import { derivePlan, type DerivedPlan } from '../model/derived';
import { projectOnLevel, sortedLevels } from '../model/levels';
import type { Furniture, Project } from '../model/schema';
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

/**
 * Furniture of the whole building (#54): every storey, lowest first, with the room each item
 * stands in; with several storeys the room name carries the storey ("Obergeschoss · Bad").
 */
export function buildingFurniture(project: Project): { furniture: Furniture[]; roomOf: RoomOf } {
  const multi = project.levels.length > 1;
  const rooms = new Map<string, { id: string; name: string } | null>();
  const furniture: Furniture[] = [];
  for (const level of sortedLevels(project)) {
    const view = projectOnLevel(project, level.id);
    if (view.furniture.length === 0) continue;
    const lookup = furnitureRoomLookup(view, derivePlan(view));
    for (const f of view.furniture) {
      furniture.push(f);
      const r = lookup(f);
      rooms.set(f.id, r && multi ? { id: r.id, name: `${level.name} · ${r.name}` } : r);
    }
  }
  return { furniture, roomOf: (f) => rooms.get(f.id) ?? null };
}
