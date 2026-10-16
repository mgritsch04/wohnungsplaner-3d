import type { Project } from '../model/schema';
import { closestPointOnSegment, dist, type Vec2 } from '../model/vec';
import { snapAngle, snapToGrid } from '../model/operations';

export interface SnapResult {
  point: Vec2;
  kind: 'node' | 'wall' | 'align' | 'grid' | 'angle' | 'none';
  nodeId?: string;
  /** Alignment guide lines to draw (world coordinates). */
  guides: { a: Vec2; b: Vec2 }[];
}

export interface SnapOptions {
  /** Snap radius in meters. */
  radius: number;
  grid: number | null;
  /** Previous point (for angle snapping while drawing walls). */
  origin?: Vec2 | null;
  angleSnap?: boolean;
  excludeNodeIds?: Set<string>;
  snapToWalls?: boolean;
}

export function snapPoint(p: Project, raw: Vec2, o: SnapOptions): SnapResult {
  const nodes = p.nodes.filter((n) => !o.excludeNodeIds?.has(n.id));
  // 1. existing nodes
  let best: { id: string; d: number } | null = null;
  for (const n of nodes) {
    const d = dist(n, raw);
    if (d <= o.radius && (!best || d < best.d)) best = { id: n.id, d };
  }
  if (best) {
    const n = nodes.find((x) => x.id === best!.id)!;
    return { point: { x: n.x, y: n.y }, kind: 'node', nodeId: n.id, guides: [] };
  }
  // 2. angle snapping relative to origin
  let pt = raw;
  let kind: SnapResult['kind'] = 'none';
  if (o.origin && o.angleSnap) {
    pt = snapAngle(o.origin, raw, Math.PI / 12);
    const L = dist(o.origin, pt);
    if (o.grid) {
      const Lr = Math.round(L / o.grid) * o.grid;
      const s = L > 1e-9 ? Lr / L : 0;
      pt = { x: o.origin.x + (pt.x - o.origin.x) * s, y: o.origin.y + (pt.y - o.origin.y) * s };
    }
    kind = 'angle';
  } else if (o.grid) {
    pt = snapToGrid(raw, o.grid);
    kind = 'grid';
  }
  // 3. wall centerlines
  if (o.snapToWalls !== false) {
    const nmap = new Map(p.nodes.map((n) => [n.id, n]));
    for (const w of p.walls) {
      if (o.excludeNodeIds?.has(w.a) || o.excludeNodeIds?.has(w.b)) continue;
      const a = nmap.get(w.a);
      const b = nmap.get(w.b);
      if (!a || !b) continue;
      const c = closestPointOnSegment(raw, a, b);
      if (c.distance <= o.radius) return { point: c.point, kind: 'wall', guides: [] };
    }
  }
  // 4. axis alignment with existing nodes
  const guides: SnapResult['guides'] = [];
  let ax: number | null = null;
  let ay: number | null = null;
  for (const n of nodes) {
    if (ax === null && Math.abs(n.x - raw.x) <= o.radius * 0.6) {
      ax = n.x;
      guides.push({ a: { x: n.x, y: n.y }, b: { x: n.x, y: raw.y } });
    }
    if (ay === null && Math.abs(n.y - raw.y) <= o.radius * 0.6) {
      ay = n.y;
      guides.push({ a: { x: n.x, y: n.y }, b: { x: raw.x, y: n.y } });
    }
  }
  if ((ax !== null || ay !== null) && !(o.origin && o.angleSnap)) {
    return { point: { x: ax ?? pt.x, y: ay ?? pt.y }, kind: 'align', guides };
  }
  return { point: pt, kind, guides: [] };
}
