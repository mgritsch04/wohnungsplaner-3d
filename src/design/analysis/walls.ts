/**
 * Walls of one room as a person sees them (#438): one wall per straight side of the outline,
 * however many model walls and T-junctions it consists of, with its openings (labelled T1 …
 * and F1 …), free stretches, the rooms behind it, and the corners between the walls.
 */
import type { DerivedPlan } from '../../model/derived';
import { doorSwingAreas } from '../../model/placement';
import { isGlassDoor, type Project } from '../../model/schema';
import { add, cross, dist, dot, normalize, perp, pointInPolygon, polygonCentroid, scale, sub, type Vec2 } from '../../model/vec';
import { wallSide } from '../coords';
import type { CornerInfo, RoomFixture, WallInfo, WallOpening } from '../types';

/** Shortest wall stretch worth naming as free (m). */
export const MIN_FREE = 0.6;

/** Model walls lying along the side a→b of a room outline, with their station range on it. */
function wallsAlong(p: Project, d: DerivedPlan, a: Vec2, dir: Vec2, inward: Vec2, length: number) {
  const out: { wallId: string; thickness: number; height: number }[] = [];
  for (const w of p.walls) {
    const fp = d.footprints.get(w.id);
    if (!fp || Math.abs(dot(fp.dir, dir)) < Math.cos(Math.PI / 90)) continue;
    // the centre line runs half a wall thickness behind the face
    if (Math.abs(dot(sub(fp.a, a), inward) + fp.thickness / 2) > 0.03) continue;
    const ta = dot(sub(fp.a, a), dir);
    const tb = dot(sub(fp.b, a), dir);
    if (Math.min(Math.max(ta, tb), length) - Math.max(Math.min(ta, tb), 0) < 0.05) continue;
    out.push({ wallId: w.id, thickness: fp.thickness, height: w.height });
  }
  return out;
}

export interface RoomWalls {
  walls: WallInfo[];
  corners: CornerInfo[];
}

/**
 * Walls and corners of the room with outline `outline` (from `wallOutline`). `rooms` maps the
 * other rooms to their outlines, for what lies behind a wall or an opening.
 */
export function roomWalls(p: Project, d: DerivedPlan, roomId: string, outline: Vec2[], rooms: Map<string, Vec2[]>): RoomWalls {
  const roomAt = (q: Vec2): string | null => {
    for (const [id, poly] of rooms) if (id !== roomId && pointInPolygon(q, poly)) return id;
    return null;
  };
  const solids = [...[...d.footprints.values()].map((f) => f.polygon), ...d.hubs.map((h) => h.polygon)];
  const inWall = (q: Vec2) => solids.some((poly) => poly.length >= 3 && pointInPolygon(q, poly));
  const swings = doorSwingAreas(d);
  const n = outline.length;
  let doors = 0;
  let windows = 0;
  const walls: WallInfo[] = outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    const length = dist(a, b);
    const dir = normalize(sub(b, a));
    let inward = perp(dir);
    if (!pointInPolygon(add(scale(add(a, b), 0.5), scale(inward, 0.02)), outline)) inward = scale(inward, -1);
    const along = wallsAlong(p, d, a, dir, inward, length);
    const thickness = along.length ? Math.max(...along.map((w) => w.thickness)) : 0;
    const openings: (Omit<WallOpening, 'id'> & { glass: boolean })[] = [];
    for (const { wallId } of along) {
      const fp = d.footprints.get(wallId)!;
      for (const r of d.openings.get(wallId) ?? []) {
        const ta = dot(sub(add(fp.a, scale(fp.dir, r.s0)), a), dir);
        const tb = dot(sub(add(fp.a, scale(fp.dir, r.s1)), a), dir);
        const t0 = Math.max(0, Math.min(ta, tb));
        const t1 = Math.min(length, Math.max(ta, tb));
        if (t1 - t0 < 0.05) continue;
        const o = r.opening;
        const mid = add(a, scale(dir, (t0 + t1) / 2));
        const toRoomId = roomAt(sub(mid, scale(inward, fp.thickness + 0.15)));
        const base = { openingId: o.id, kind: o.kind, t0, t1, toRoomId, passable: o.kind !== 'window', glass: isGlassDoor(o) };
        if (o.kind === 'window') openings.push({ ...base, sill: r.bottom, top: r.top });
        else if (o.kind === 'door') {
          const s = swings.find((x) => x.openingId === o.id);
          const swingsIn = !!s && pointInPolygon(polygonCentroid(s.polygon), outline);
          openings.push({ ...base, swingsIn, ...(swingsIn && s ? { swing: s.polygon } : {}) });
        } else openings.push(base);
      }
    }
    openings.sort((x, y) => x.t0 - y.t0);
    const labelled: WallOpening[] = openings.map(({ glass, ...o }) => {
      void glass;
      return { id: o.kind === 'window' ? `F${++windows}` : `T${++doors}`, ...o };
    });
    const free: { t0: number; t1: number }[] = [];
    let at = 0;
    for (const o of labelled) {
      if (o.t0 - at >= MIN_FREE) free.push({ t0: at, t1: o.t0 });
      at = Math.max(at, o.t1);
    }
    if (length - at >= MIN_FREE) free.push({ t0: at, t1: length });
    // rooms behind the wall: probes every half metre, past the wall thickness; a probe that
    // lands in another wall (a junction behind this one) says nothing
    const behind: (string | null)[] = [];
    const count = Math.max(2, Math.ceil((length - 0.6) / 0.5) + 1);
    const ts = length < 0.6 ? [length / 2] : Array.from({ length: count }, (_, k) => 0.3 + ((length - 0.6) * k) / (count - 1));
    for (const t of ts) {
      const q = sub(add(a, scale(dir, t)), scale(inward, (thickness || 0.2) + 0.15));
      const id = roomAt(q);
      if (id === null && inWall(q)) continue;
      if (behind.length === 0 || behind[behind.length - 1] !== id) behind.push(id);
    }
    return {
      id: `W${i + 1}`,
      side: wallSide(inward),
      a,
      b,
      dir,
      inward,
      length,
      openings: labelled,
      free,
      thickness,
      height: along.length ? Math.max(...along.map((w) => w.height)) : 0,
      behind,
    };
  });
  // a glazed door counts as a way into the room behind it only when no door or passage leads there
  for (const w of walls)
    for (const o of w.openings) {
      const model = p.openings.find((x) => x.id === o.openingId);
      if (o.kind !== 'window' || !o.toRoomId || !model || !isGlassDoor(model)) continue;
      o.passable = !walls.some((x) => x.openings.some((y) => y.kind !== 'window' && y.toRoomId === o.toRoomId));
    }

  // corners: Ek is where wall Wk ends; distances to openings along the outline
  const start: number[] = [];
  let perimeter = 0;
  for (const w of walls) {
    start.push(perimeter);
    perimeter += w.length;
  }
  const spans = (window: boolean) => walls.flatMap((w, i) => w.openings.filter((o) => (o.kind === 'window') === window).map((o) => [start[i] + o.t0, start[i] + o.t1] as const));
  const doorSpans = spans(false);
  const windowSpans = spans(true);
  const along = (c: number, list: readonly (readonly [number, number])[]) => {
    let best = Infinity;
    for (const [s0, s1] of list) {
      const into = (((c - s0) % perimeter) + perimeter) % perimeter;
      if (into <= s1 - s0) return 0;
      best = Math.min(best, (((s0 - c) % perimeter) + perimeter) % perimeter, (((c - s1) % perimeter) + perimeter) % perimeter);
    }
    return best;
  };
  const corners: CornerInfo[] = walls.map((w, i) => {
    const next = walls[(i + 1) % n];
    const c = start[i] + w.length;
    return {
      id: `E${i + 1}`,
      p: w.b,
      walls: [w.id, next.id],
      reflex: cross(w.dir, next.dir) < 0,
      doorDist: along(c, doorSpans),
      windowDist: along(c, windowSpans),
    };
  });
  return { walls, corners };
}

/** Radiators, sockets and connections in the room, with the wall they sit on. */
export function roomFixtures(p: Project, outline: Vec2[], walls: WallInfo[]): RoomFixture[] {
  const out: RoomFixture[] = [];
  for (const f of p.fixtures) {
    if (!pointInPolygon(f, outline)) continue;
    let best: { w: WallInfo; t: number; off: number } | null = null;
    for (const w of walls) {
      const t = dot(sub(f, w.a), w.dir);
      const off = dot(sub(f, w.a), w.inward);
      if (t < -0.05 || t > w.length + 0.05 || off < -0.05 || off > 0.4) continue;
      if (!best || off < best.off) best = { w, t: Math.max(0, Math.min(w.length, t)), off };
    }
    out.push({
      id: f.id,
      kind: f.kind,
      wall: best?.w.id ?? null,
      t: best?.t ?? 0,
      p: { x: f.x, y: f.y },
      width: f.width ?? (f.kind === 'radiator' ? 0.8 : 0.08),
      elevation: f.elevation,
      ...(f.height !== undefined ? { height: f.height } : {}),
    });
  }
  return out;
}
