import type { Opening, PlanNode, Project, Room, Wall } from './schema';
import { dist, normalize, sub, type Vec2 } from './vec';

/** Read-only lookup helpers around the wall graph (nodes + walls). */
export interface PlanIndex {
  nodes: Map<string, PlanNode>;
  walls: Map<string, Wall>;
  /** node id → walls touching that node */
  wallsAtNode: Map<string, Wall[]>;
  /** wall id → openings in that wall */
  openingsByWall: Map<string, Opening[]>;
}

export function buildIndex(p: Pick<Project, 'nodes' | 'walls' | 'openings'>): PlanIndex {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const walls = new Map(p.walls.map((w) => [w.id, w]));
  const wallsAtNode = new Map<string, Wall[]>();
  for (const n of p.nodes) wallsAtNode.set(n.id, []);
  for (const w of p.walls) {
    wallsAtNode.get(w.a)?.push(w);
    wallsAtNode.get(w.b)?.push(w);
  }
  const openingsByWall = new Map<string, Opening[]>();
  for (const o of p.openings) {
    const list = openingsByWall.get(o.wallId) ?? [];
    list.push(o);
    openingsByWall.set(o.wallId, list);
  }
  return { nodes, walls, wallsAtNode, openingsByWall };
}

export function wallEndpoints(w: Wall, nodes: Map<string, PlanNode>): [Vec2, Vec2] | null {
  const a = nodes.get(w.a);
  const b = nodes.get(w.b);
  if (!a || !b) return null;
  return [a, b];
}

export function wallLength(w: Wall, nodes: Map<string, PlanNode>): number {
  const e = wallEndpoints(w, nodes);
  return e ? dist(e[0], e[1]) : 0;
}

export function wallDirection(w: Wall, nodes: Map<string, PlanNode>): Vec2 {
  const e = wallEndpoints(w, nodes);
  return e ? normalize(sub(e[1], e[0])) : { x: 1, y: 0 };
}

/** Find the wall connecting two nodes (either direction). */
export function findWallBetween(walls: Iterable<Wall>, n1: string, n2: string): Wall | undefined {
  for (const w of walls) {
    if ((w.a === n1 && w.b === n2) || (w.a === n2 && w.b === n1)) return w;
  }
  return undefined;
}

/** Room polygon along the wall centerlines. Missing nodes are skipped. */
export function roomCenterlinePolygon(room: Room, nodes: Map<string, PlanNode>): Vec2[] {
  const pts: Vec2[] = [];
  for (const id of room.nodeIds) {
    const n = nodes.get(id);
    if (n) pts.push({ x: n.x, y: n.y });
  }
  return pts;
}
