import type { DerivedPlan } from '../derived';
import type { Project } from '../schema';
import { findWallBetween } from '../graph';
import { add, dist, dot, normalize, perp, pointInPolygon, scale, signedArea, sub, type Vec2 } from '../vec';

/** Baseboard dimensions (meters). */
export const BASEBOARD_HEIGHT = 0.06;
export const BASEBOARD_THICKNESS = 0.015;

export interface BaseboardSegment {
  roomId: string;
  a: Vec2;
  b: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
}

/**
 * Baseboards along the clear interior outline of every room, interrupted
 * where doors and passages cut through the wall.
 */
export function computeBaseboards(p: Project, d: DerivedPlan): BaseboardSegment[] {
  const out: BaseboardSegment[] = [];
  for (const room of p.rooms) {
    const g = d.rooms.get(room.id);
    if (!g) continue;
    const poly = g.interior;
    const n = poly.length;
    const sign = signedArea(g.centerline) >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const len = dist(a, b);
      if (len < 0.02) continue;
      const dir = normalize(sub(b, a));
      const inward = scale(perp(dir), sign);
      // cut-outs from openings of the wall behind this edge
      const wall = findWallBetween(p.walls, room.nodeIds[i], room.nodeIds[(i + 1) % n]);
      const cuts: [number, number][] = [];
      if (wall) {
        const fp = d.footprints.get(wall.id);
        for (const r of fp ? (d.openings.get(wall.id) ?? []) : []) {
          if (r.opening.kind === 'window' && r.bottom > BASEBOARD_HEIGHT) continue;
          const t0 = dot(sub(add(fp!.a, scale(fp!.dir, r.s0)), a), dir);
          const t1 = dot(sub(add(fp!.a, scale(fp!.dir, r.s1)), a), dir);
          cuts.push([Math.min(t0, t1), Math.max(t0, t1)]);
        }
      }
      cuts.sort((x, y) => x[0] - y[0]);
      let cursor = 0;
      const push = (t0: number, t1: number) => {
        if (t1 - t0 > 0.02) out.push({ roomId: room.id, a: add(a, scale(dir, t0)), b: add(a, scale(dir, t1)), inward });
      };
      for (const [c0, c1] of cuts) {
        push(cursor, Math.min(len, Math.max(cursor, c0)));
        cursor = Math.max(cursor, c1);
      }
      push(cursor, len);
    }
  }
  return out;
}

export interface WindowSill {
  openingId: string;
  /** Center of the board in plan coordinates. */
  center: Vec2;
  /** Direction along the wall. */
  dir: Vec2;
  /** Unit normal pointing towards the side the board sticks out. */
  outward: Vec2;
  width: number;
  depth: number;
  /** Top surface height. */
  height: number;
  side: 'inside' | 'outside';
}

/**
 * Interior window boards on the room side (2 cm thick, 3 cm overhang) and
 * exterior sills on sides without a room. Purely derived from the model.
 */
export function computeWindowSills(p: Project, d: DerivedPlan): WindowSill[] {
  const out: WindowSill[] = [];
  const roomPolys = [...d.rooms.values()].map((g) => g.interior);
  for (const w of p.walls) {
    const fp = d.footprints.get(w.id);
    if (!fp) continue;
    for (const r of d.openings.get(w.id) ?? []) {
      if (r.opening.kind !== 'window' || r.bottom < 0.05) continue;
      const mid = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
      const width = r.s1 - r.s0 + 0.04;
      for (const s of [1, -1] as const) {
        const normal = scale(fp.normal, s);
        const probe = add(mid, scale(normal, fp.thickness / 2 + 0.1));
        const inside = roomPolys.some((poly) => pointInPolygon(probe, poly));
        const overhang = inside ? 0.03 : 0.05;
        const depth = fp.thickness / 2 + overhang;
        out.push({
          openingId: r.opening.id,
          center: add(mid, scale(normal, depth / 2)),
          dir: fp.dir,
          outward: normal,
          width,
          depth,
          height: r.bottom,
          side: inside ? 'inside' : 'outside',
        });
      }
    }
  }
  return out;
}
