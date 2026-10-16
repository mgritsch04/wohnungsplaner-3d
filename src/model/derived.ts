import { buildIndex, type PlanIndex } from './graph';
import { computeRoomGeometry, type RoomGeometry } from './geometry/rooms';
import { buildWallPieces, computeJunctionHubs, computeWallFootprint, resolveOpenings, type JunctionHub, type ResolvedOpening, type WallFootprint, type WallPiece } from './geometry/walls';
import { computeOpeningLeaves, type OpeningLeaf } from './geometry/leaves';
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
  /** Door leaves / window sashes per opening id (#21). */
  leaves: Map<string, OpeningLeaf[]>;
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
  const roomPolys = [...rooms.values()].map((g) => g.interior);
  const leaves = new Map<string, OpeningLeaf[]>();
  for (const [wallId, list] of openings) {
    const fp = footprints.get(wallId)!;
    for (const r of list) {
      const ls = computeOpeningLeaves(fp, r, roomPolys);
      if (ls.length) leaves.set(r.opening.id, ls);
    }
  }
  return { index, footprints, openings, pieces, rooms, hubs: computeJunctionHubs(index, footprints), leaves };
}

/** Cheap structural key of the architectural part of a project (for memoization). */
export function architectureKey(p: Project): string {
  return JSON.stringify([p.nodes, p.walls, p.openings, p.rooms, p.materials]);
}
