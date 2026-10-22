import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { add, boundsOf, pointInPolygon, scale, type Vec2 } from '../model/vec';

/** Height of one storey of the neighbouring floors shown around the apartment (m). */
export const STOREY_HEIGHT = 2.8;

export interface ExteriorWall {
  wallId: string;
  /** Unit vector pointing away from the apartment, perpendicular to the wall. */
  outward: Vec2;
}

export interface Entrance {
  openingId: string;
  /** Centre of the door on the outside face of the wall. */
  position: Vec2;
  outward: Vec2;
}

/**
 * Walls with a room on one side only face the outside (#92). Derived from the existing
 * walls and rooms – nothing is stored in the project.
 */
export function exteriorWalls(project: Project, derived: DerivedPlan): ExteriorWall[] {
  const rooms = project.rooms.map((r) => derived.rooms.get(r.id)).filter((g): g is NonNullable<typeof g> => !!g);
  const result: ExteriorWall[] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    const mid = scale(add(fp.a, fp.b), 0.5);
    const inside = (sign: 1 | -1) => {
      const probe = add(mid, scale(fp.normal, sign * (fp.thickness / 2 + 0.05)));
      return rooms.some((r) => pointInPolygon(probe, r.interior));
    };
    const left = inside(1);
    const right = inside(-1);
    if (left === right) continue; // interior wall (both sides) or free-standing wall (none)
    result.push({ wallId: w.id, outward: scale(fp.normal, left ? -1 : 1) });
  }
  return result;
}

/** The entrance: the first door in an exterior wall (windows and passages do not count). */
export function findEntrance(project: Project, derived: DerivedPlan, exterior: ExteriorWall[]): Entrance | null {
  for (const ext of exterior) {
    const fp = derived.footprints.get(ext.wallId);
    const door = project.openings.find((o) => o.wallId === ext.wallId && o.kind === 'door');
    if (!fp || !door) continue;
    const centre = add(fp.a, scale(fp.dir, door.offset));
    return { openingId: door.id, position: add(centre, scale(ext.outward, fp.thickness / 2)), outward: ext.outward };
  }
  return null;
}

/** Outline of the apartment (all room centre lines) as a bounding box with its storey height. */
export function apartmentBox(project: Project, derived: DerivedPlan): { minX: number; minY: number; maxX: number; maxY: number; height: number } | null {
  const pts = project.rooms.flatMap((r) => derived.rooms.get(r.id)?.centerline ?? []);
  const b = boundsOf(pts);
  if (!b) return null;
  const height = Math.max(2.2, ...project.walls.map((w) => w.height));
  return { ...b, height };
}

/** Camera direction (unit, pointing from the building towards the camera) for the facade view. */
export function facadeViewDirection(entrance: Entrance | null): { x: number; y: number; z: number } {
  const o = entrance?.outward ?? { x: 0.35, y: 1 };
  const len = Math.hypot(o.x, o.y) || 1;
  // a little to the side of the entrance, so the facade is seen at an angle with a slightly raised view
  const side = 0.35;
  const x = o.x / len + (-o.y / len) * side;
  const z = o.y / len + (o.x / len) * side;
  const h = Math.hypot(x, z);
  const elevation = 0.28;
  return { x: (x / h) * (1 - elevation), y: elevation * 1.6, z: (z / h) * (1 - elevation) };
}
