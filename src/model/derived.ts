import { buildIndex, type PlanIndex } from './graph';
import { computeRoomGeometry, type RoomGeometry } from './geometry/rooms';
import { buildWallPieces, computeJunctionHubs, computeWallFootprint, resolveOpenings, type JunctionHub, type ResolvedOpening, type WallFootprint, type WallPiece } from './geometry/walls';
import type { Project } from './schema';

/**
 * Derived (never stored) geometry for one project state. Both the 2D editor
 * and the 3D renderer consume this, so they always show the same geometry.
 */
export interface DerivedPlan {
  index: PlanIndex;
  footprints: Map<string, WallFootprint>;
  openings: Map<string, ResolvedOpening[]>;
  pieces: Map<string, WallPiece[]>;
  rooms: Map<string, RoomGeometry>;
  /** Fill prisms where 3+ walls meet. */
  hubs: JunctionHub[];
}

export function derivePlan(p: Pick<Project, 'nodes' | 'walls' | 'openings' | 'rooms'>): DerivedPlan {
  const index = buildIndex(p);
  const footprints = new Map<string, WallFootprint>();
  const openings = new Map<string, ResolvedOpening[]>();
  const pieces = new Map<string, WallPiece[]>();
  for (const w of p.walls) {
    const fp = computeWallFootprint(w, index);
    if (!fp) continue;
    footprints.set(w.id, fp);
    const res = resolveOpenings(w, fp, index.openingsByWall.get(w.id) ?? []);
    openings.set(w.id, res);
    pieces.set(w.id, buildWallPieces(w, fp, res));
  }
  const rooms = new Map<string, RoomGeometry>();
  for (const r of p.rooms) {
    const g = computeRoomGeometry(r, index);
    if (g) rooms.set(r.id, g);
  }
  return { index, footprints, openings, pieces, rooms, hubs: computeJunctionHubs(index, footprints) };
}

/** Cheap structural key of the architectural part of a project (for memoization). */
export function architectureKey(p: Project): string {
  return JSON.stringify([p.nodes, p.walls, p.openings, p.rooms, p.materials]);
}
