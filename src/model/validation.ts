import { buildIndex, findWallBetween, wallLength } from './graph';
import { computeWallFootprint, resolveOpenings } from './geometry/walls';
import type { Project } from './schema';

export interface ModelIssue {
  severity: 'error' | 'warning';
  message: string;
  elementId?: string;
}

/** Semantic validation beyond the schema: references, geometry sanity, overlaps. */
export function validateModel(p: Project): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const ids = new Set<string>();
  const checkId = (id: string, what: string) => {
    if (ids.has(id)) issues.push({ severity: 'error', message: `Doppelte ID ${id} (${what})`, elementId: id });
    ids.add(id);
  };
  p.nodes.forEach((n) => checkId(n.id, 'Knoten'));
  p.walls.forEach((w) => checkId(w.id, 'Wand'));
  p.openings.forEach((o) => checkId(o.id, 'Öffnung'));
  p.rooms.forEach((r) => checkId(r.id, 'Raum'));
  p.furniture.forEach((f) => checkId(f.id, 'Objekt'));

  const index = buildIndex(p);
  // a wall with a missing node is reported below; then no footprints are built (their corners use the neighbours)
  const nodesOk = p.walls.every((w) => index.nodes.has(w.a) && index.nodes.has(w.b));
  const footprintOf = (w: Project['walls'][number]) => (nodesOk ? computeWallFootprint(w, index) : null);
  for (const w of p.walls) {
    if (!index.nodes.has(w.a) || !index.nodes.has(w.b)) {
      issues.push({ severity: 'error', message: `Wand ${w.id} verweist auf fehlende Knoten`, elementId: w.id });
      continue;
    }
    if (w.a === w.b || wallLength(w, index.nodes) < 0.01) {
      issues.push({ severity: 'error', message: `Wand ${w.id} hat (fast) keine Länge`, elementId: w.id });
    }
  }
  for (const o of p.openings) {
    const w = index.walls.get(o.wallId);
    if (!w) {
      issues.push({ severity: 'error', message: `Öffnung ${o.id} verweist auf fehlende Wand`, elementId: o.id });
      continue;
    }
    const fp = footprintOf(w);
    if (!fp) continue;
    if (o.offset - o.width / 2 < -1e-6 || o.offset + o.width / 2 > fp.length + 1e-6) {
      issues.push({ severity: 'warning', message: `Öffnung ${o.id} ragt über die Wand hinaus`, elementId: o.id });
    }
    if (o.sillHeight + o.height > w.height + 1e-6) {
      issues.push({ severity: 'warning', message: `Öffnung ${o.id} ist höher als die Wand`, elementId: o.id });
    }
  }
  for (const [wallId, list] of index.openingsByWall) {
    const w = index.walls.get(wallId);
    if (!w) continue;
    const fp = footprintOf(w);
    if (!fp) continue;
    const res = resolveOpenings(w, fp, list);
    for (let i = 1; i < res.length; i++) {
      if (res[i].s0 < res[i - 1].s1 - 1e-6) {
        issues.push({ severity: 'warning', message: `Öffnungen ${res[i - 1].opening.id} und ${res[i].opening.id} überlappen`, elementId: res[i].opening.id });
      }
    }
  }
  for (const r of p.rooms) {
    for (let i = 0; i < r.nodeIds.length; i++) {
      const u = r.nodeIds[i];
      const v = r.nodeIds[(i + 1) % r.nodeIds.length];
      if (!index.nodes.has(u)) {
        issues.push({ severity: 'error', message: `Raum „${r.name}“ verweist auf fehlenden Knoten`, elementId: r.id });
        break;
      }
      if (!findWallBetween(p.walls, u, v)) {
        issues.push({ severity: 'warning', message: `Raum „${r.name}“ ist nicht vollständig von Wänden umschlossen`, elementId: r.id });
        break;
      }
    }
  }
  return issues;
}
