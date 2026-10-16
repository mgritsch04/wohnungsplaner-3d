import type { DerivedPlan } from '../derived';
import type { Project } from '../schema';
import { detectFaces } from '../roomDetection';
import { add, dist, dot, normalize, pointInPolygon, scale, sub, type Vec2 } from '../vec';

/** Baseboard dimensions (meters). */
export const BASEBOARD_HEIGHT = 0.06;
export const BASEBOARD_THICKNESS = 0.015;

export interface BaseboardSegment {
  /** Wall the board is fixed to (or the room it belongs to). */
  wallId: string;
  a: Vec2;
  b: Vec2;
  /** Unit normal pointing away from the wall into the room. */
  inward: Vec2;
}

/**
 * Skirting boards on every wall face that borders an interior space – a room
 * record or any enclosed wall area – including free-standing wall stubs and
 * their end faces. Boards are interrupted by doors/passages and windows reaching
 * the floor, and extended by their thickness at both ends so corners close
 * without notches (the overhang disappears inside the neighbouring wall).
 */
export function computeBaseboards(p: Project, d: DerivedPlan): BaseboardSegment[] {
  const out: BaseboardSegment[] = [];
  const areas: Vec2[][] = [...[...d.rooms.values()].map((g) => g.interior), ...detectFaces(p).map((f) => f.polygon)];
  const isInterior = (q: Vec2) => areas.some((poly) => pointInPolygon(q, poly));
  const T = BASEBOARD_THICKNESS;
  for (const [wallId, fp] of d.footprints) {
    const wall = d.index.walls.get(wallId);
    if (!wall) continue;
    const ops = (d.openings.get(wallId) ?? []).filter((r) => !(r.opening.kind === 'window' && r.bottom > BASEBOARD_HEIGHT));
    for (const side of [1, -1] as const) {
      const inward = scale(fp.normal, side);
      // face segment of the footprint on this side
      const [fa, fb] = side === 1 ? [fp.polygon[0], fp.polygon[1]] : [fp.polygon[3], fp.polygon[2]];
      const len = dist(fa, fb);
      if (len < 0.02) continue;
      const mid = scale(add(fa, fb), 0.5);
      if (!isInterior(add(mid, scale(inward, 0.05)))) continue;
      const dir = normalize(sub(fb, fa));
      // opening intervals in face coordinates
      const cuts = ops
        .map((r) => {
          const t0 = dot(sub(add(fp.a, scale(fp.dir, r.s0)), fa), dir);
          const t1 = dot(sub(add(fp.a, scale(fp.dir, r.s1)), fa), dir);
          return [Math.min(t0, t1), Math.max(t0, t1)] as [number, number];
        })
        .sort((x, y) => x[0] - y[0]);
      const ranges: [number, number][] = [];
      let cursor = -T; // extend into the corner
      for (const [c0, c1] of cuts) {
        if (c0 > cursor) ranges.push([cursor, c0]);
        cursor = Math.max(cursor, c1);
      }
      ranges.push([cursor, len + T]);
      for (const [t0, t1] of ranges) {
        if (t1 - t0 > 0.02) out.push({ wallId, a: add(fa, scale(dir, t0)), b: add(fa, scale(dir, t1)), inward });
      }
    }
    // end faces of free wall ends (e.g. a partition stub inside a room)
    for (const [nodeId, end] of [
      [wall.a, 'a'],
      [wall.b, 'b'],
    ] as const) {
      if ((d.index.wallsAtNode.get(nodeId)?.length ?? 0) !== 1) continue;
      const out1 = end === 'a' ? scale(fp.dir, -1) : fp.dir;
      const [c0, c1] = end === 'a' ? [fp.polygon[3], fp.polygon[0]] : [fp.polygon[1], fp.polygon[2]];
      const mid = scale(add(c0, c1), 0.5);
      if (!isInterior(add(mid, scale(out1, 0.05)))) continue;
      const dir = normalize(sub(c1, c0));
      out.push({ wallId, a: add(c0, scale(dir, -T)), b: add(c1, scale(dir, T)), inward: out1 });
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
