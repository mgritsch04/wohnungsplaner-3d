import type { Project } from './schema';
import { pointInPolygon, signedArea, type Vec2 } from './vec';

/**
 * Detect enclosed areas (faces) of the planar wall graph.
 * Dangling walls are pruned first. Returns node-id cycles of bounded faces,
 * each with its centerline polygon.
 */
export function detectFaces(p: Pick<Project, 'nodes' | 'walls'>): { nodeIds: string[]; polygon: Vec2[] }[] {
  const pos = new Map(p.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  const link = (u: string, v: string) => {
    if (!adj.has(u)) adj.set(u, new Set());
    adj.get(u)!.add(v);
  };
  for (const w of p.walls) {
    if (w.a === w.b || !pos.has(w.a) || !pos.has(w.b)) continue;
    link(w.a, w.b);
    link(w.b, w.a);
  }
  // prune filaments (degree ≤ 1)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, set] of adj) {
      if (set.size <= 1) {
        for (const o of set) adj.get(o)?.delete(id);
        adj.delete(id);
        changed = true;
      }
    }
  }
  const angle = (u: string, v: string) => {
    const a = pos.get(u)!;
    const b = pos.get(v)!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // outgoing neighbours sorted by angle
  const sorted = new Map<string, string[]>();
  for (const [id, set] of adj) sorted.set(id, [...set].sort((x, y) => angle(id, x) - angle(id, y)));

  const visited = new Set<string>();
  const faces: { nodeIds: string[]; polygon: Vec2[] }[] = [];
  for (const [u, outs] of sorted) {
    for (const v of outs) {
      const key = `${u}>${v}`;
      if (visited.has(key)) continue;
      const cycle: string[] = [];
      let a = u;
      let b = v;
      let guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 10000) {
        visited.add(`${a}>${b}`);
        cycle.push(a);
        // at b, coming from a: take the next edge clockwise from the reverse edge b→a
        const list = sorted.get(b)!;
        const i = list.indexOf(a);
        const next = list[(i - 1 + list.length) % list.length];
        a = b;
        b = next;
      }
      const polygon = cycle.map((id) => ({ x: pos.get(id)!.x, y: pos.get(id)!.y }));
      // With this traversal, bounded faces have positive signed area (y-down plan).
      if (cycle.length >= 3 && signedArea(polygon) > 1e-6) faces.push({ nodeIds: cycle, polygon });
    }
  }
  return faces;
}

/** Smallest enclosed face containing the point, if any. */
export function faceAtPoint(p: Pick<Project, 'nodes' | 'walls'>, point: Vec2) {
  const faces = detectFaces(p).filter((f) => pointInPolygon(point, f.polygon));
  faces.sort((x, y) => Math.abs(signedArea(x.polygon)) - Math.abs(signedArea(y.polygon)));
  return faces[0] ?? null;
}

/** True if two cycles describe the same face (same node set & size). */
export function sameCycle(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
