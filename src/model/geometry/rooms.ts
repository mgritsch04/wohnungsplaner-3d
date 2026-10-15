import type { Room } from '../schema';
import { findWallBetween, roomCenterlinePolygon, type PlanIndex } from '../graph';
import { add, lineIntersection, normalize, perp, polygonArea, polygonCentroid, scale, signedArea, sub, type Vec2, dist } from '../vec';

export interface RoomGeometry {
  roomId: string;
  centerline: Vec2[];
  /** Clear interior outline (wall faces), used for floor, area and furniture bounds. */
  interior: Vec2[];
  /** Net floor area inside the wall faces in m². */
  area: number;
  /** Area inside the wall centerlines in m². */
  centerlineArea: number;
  perimeter: number;
  centroid: Vec2;
  /** Whether every edge of the cycle is backed by a wall. */
  closed: boolean;
}

/** Offset the centerline polygon inwards by half the thickness of each wall. */
export function computeRoomGeometry(room: Room, index: PlanIndex): RoomGeometry | null {
  const center = roomCenterlinePolygon(room, index.nodes);
  if (center.length < 3) return null;
  const n = center.length;
  const sign = signedArea(center) >= 0 ? 1 : -1;
  let closed = true;
  const lines: { p: Vec2; d: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const p = center[i];
    const q = center[(i + 1) % n];
    const wall = findWallBetween(index.walls.values(), room.nodeIds[i], room.nodeIds[(i + 1) % n]);
    if (!wall) closed = false;
    const t = wall ? wall.thickness : 0;
    const d = normalize(sub(q, p));
    const inward = scale(perp(d), sign);
    lines.push({ p: add(p, scale(inward, t / 2)), d });
  }
  const interior: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const x = lineIntersection(prev.p, prev.d, cur.p, cur.d);
    interior.push(x ?? cur.p);
  }
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += dist(interior[i], interior[(i + 1) % n]);
  return {
    roomId: room.id,
    centerline: center,
    interior,
    area: polygonArea(interior),
    centerlineArea: polygonArea(center),
    perimeter,
    centroid: polygonCentroid(interior),
    closed,
  };
}

/**
 * If the room is a rectangle (4 nodes, right angles), return its interior
 * width (first edge direction) and depth.
 */
export function rectangularRoomSize(geo: RoomGeometry): { width: number; depth: number } | null {
  const p = geo.interior;
  if (p.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = sub(p[(i + 1) % 4], p[i]);
    const b = sub(p[(i + 2) % 4], p[(i + 1) % 4]);
    const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
    if (Math.abs(cos) > 1e-3) return null;
  }
  return { width: dist(p[0], p[1]), depth: dist(p[1], p[2]) };
}
