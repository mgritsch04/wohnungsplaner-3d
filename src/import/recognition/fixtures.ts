import type { Vec2 } from '../../model/vec';
import { closestPointOnSegment, pointInPolygon } from '../../model/vec';

/** Straight piece of a drawing symbol in plan metres. */
export interface FixtureSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Piece of a curve (rounded corner, oval). */
  curve?: boolean;
  areaFill?: boolean;
  darkFill?: boolean;
  faint?: boolean;
}

export type FixtureKind = 'bathtub' | 'washbasin' | 'toilet' | 'washer' | 'dishwasher';

export interface FixtureCandidate {
  kind: FixtureKind;
  catalogId: string;
  center: Vec2;
  /** Plan rotation (radians) for the catalog object: local -y is its back. */
  rotation: number;
  /** Measured size along the object's local x / y (metres). */
  width: number;
  depth: number;
  confidence: number;
  note: string;
}

interface Wall {
  a: Vec2;
  b: Vec2;
  thickness: number;
}

const CATALOG = {
  bathtub: { id: 'generic-bathtub', w: 1.7, d: 0.75 },
  washbasin: { id: 'generic-washbasin', w: 0.6, d: 0.46 },
  toilet: { id: 'generic-toilet', w: 0.37, d: 0.54 },
  washer: { id: 'generic-washer', w: 0.6, d: 0.6 },
  dishwasher: { id: 'generic-k-dishwasher', w: 0.6, d: 0.6 },
} as const;

/** Symbol pieces are short; longer lines are walls, dimension lines or furniture outlines. */
const MAX_PIECE = 1.5;
/** A tub's long edge is one straight piece of 1.6–1.9 m. */
const MAX_EDGE = 2.2;
const KITCHEN_ROOM = /küche|kueche|kochen|essk/i;
const JOIN_TOL = 0.03;
const SANITARY_ROOM = /bad|wc|toilet|dusch|wasch|sanit/i;
const WC_ROOM = /wc|toilet/i;

interface Component {
  segs: FixtureSegment[];
}

export function components(segs: FixtureSegment[]): Component[] {
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x / JOIN_TOL)},${Math.round(y / JOIN_TOL)}`;
  segs.forEach((s, i) => {
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const cx = Math.round(x / JOIN_TOL);
      const cy = Math.round(y / JOIN_TOL);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const t = segs[j];
            if (Math.min(Math.hypot(t.x1 - x, t.y1 - y), Math.hypot(t.x2 - x, t.y2 - y)) <= JOIN_TOL) parent[find(i)] = find(j);
          }
      const k = key(x, y);
      grid.set(k, [...(grid.get(k) ?? []), i]);
    }
  });
  const groups = new Map<number, FixtureSegment[]>();
  segs.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
  return [...groups.values()].map((segs) => ({ segs }));
}

/** Smallest enclosing rectangle (searched in 3° steps): long side `l` along direction `phi`, short side `w`. */
export function orientedBox(points: Vec2[]): { l: number; w: number; phi: number; center: Vec2 } {
  let best = { area: Infinity, l: 0, w: 0, phi: 0, center: { x: 0, y: 0 } };
  for (let deg = 0; deg < 90; deg += 3) {
    const phi = (deg * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of points) {
      const u = p.x * c + p.y * s;
      const v = -p.x * s + p.y * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const mu = (u0 + u1) / 2;
      const mv = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = { area, l: Math.max(u1 - u0, v1 - v0), w: Math.min(u1 - u0, v1 - v0), phi: long ? phi : phi + Math.PI / 2, center: { x: mu * c - mv * s, y: mu * s + mv * c } };
    }
  }
  return { l: best.l, w: best.w, phi: best.phi, center: best.center };
}

function classify(l: number, w: number, curveFrac: number, wcRoom: boolean): FixtureKind | null {
  if (l >= 1.4 && l <= 2.0 && w >= 0.65 && w <= 0.95 && curveFrac >= 0.03) return 'bathtub';
  const aspect = l / w;
  if (l >= 0.55 && l <= 0.9 && w >= 0.3 && w <= 0.48 && aspect >= 1.4 && curveFrac >= 0.15 && (l >= 0.62 || wcRoom)) return 'toilet';
  if (l >= 0.4 && l <= 0.9 && w >= 0.28 && w <= 0.6 && curveFrac >= 0.25) return 'washbasin';
  return null;
}

const near = (n: number, ref: number) => Math.abs(n - ref) / ref <= 0.25;

/**
 * Sanitary fixtures drawn as closed symbols (tub: rounded rectangle, basin: oval or half-round,
 * WC: oval with cistern). Thin symbol lines (not wall faces) are joined into connected shapes,
 * classified by size and share of curves, and turned to face away from the nearest wall.
 * `rooms` are the room interiors with their names: a fixture must stand in one of them; the name
 * only raises or lowers the confidence. Everything here is a proposal for the review.
 */
export function detectFixtures(segments: FixtureSegment[], walls: Wall[], rooms: { polygon: Vec2[]; name: string }[]): FixtureCandidate[] {
  const onWall = (s: FixtureSegment) => {
    const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    return walls.some((w) => closestPointOnSegment(mid, w.a, w.b).distance <= w.thickness / 2 + 0.03);
  };
  const candidates = segments.filter((s) => {
    if (s.areaFill || s.darkFill || s.faint) return false;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    return len >= 1e-4 && len <= MAX_EDGE;
  });
  const symbolLines = candidates.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) <= (s.curve ? MAX_PIECE : MAX_EDGE) && !onWall(s));
  // a tub or WC stands flush against the wall: its back edge lies on the wall face and only closes the shape
  const wallEdges = candidates.filter(onWall);
  const found: (FixtureCandidate & { area: number })[] = [];
  for (const comp of components(symbolLines)) {
    const segs = [...comp.segs];
    const touches = (p: Vec2) => segs.some((t) => Math.min(Math.hypot(t.x1 - p.x, t.y1 - p.y), Math.hypot(t.x2 - p.x, t.y2 - p.y)) <= JOIN_TOL);
    for (const e of wallEdges) if (touches({ x: e.x1, y: e.y1 }) && touches({ x: e.x2, y: e.y2 })) segs.push(e);
    if (segs.length < 4) continue;
    const pts = segs.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]);
    // closed: nearly every end has a partner
    const open = pts.filter((p, i) => !pts.some((q, j) => j !== i && Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL)).length;
    if (open > 0.15 * pts.length) continue;
    const total = segs.reduce((n, s) => n + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
    const curved = segs.filter((s) => s.curve).reduce((n, s) => n + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
    const box = orientedBox(pts);
    const room = rooms.find((r) => pointInPolygon(box.center, r.polygon));
    if (rooms.length > 0 && !room) continue;
    const kind = classify(box.l, box.w, curved / total, !!room && WC_ROOM.test(room.name));
    if (!kind) continue;
    const cat = CATALOG[kind];
    // local x runs along the long side for tub and basin, local y for the WC
    const longIsX = kind !== 'toilet';
    const theta0 = longIsX ? box.phi : box.phi - Math.PI / 2;
    const depth = longIsX ? box.w : box.l;
    const wallDist = (theta: number) => {
      const back = { x: Math.sin(theta), y: -Math.cos(theta) };
      const probe = { x: box.center.x + back.x * (depth / 2 + 0.1), y: box.center.y + back.y * (depth / 2 + 0.1) };
      return Math.min(...walls.map((w) => closestPointOnSegment(probe, w.a, w.b).distance), Infinity);
    };
    let rotation = wallDist(theta0) <= wallDist(theta0 + Math.PI) ? theta0 : theta0 + Math.PI;
    rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
    const [mw, md] = longIsX ? [box.l, box.w] : [box.w, box.l];
    const sanitary = room ? SANITARY_ROOM.test(room.name) : false;
    found.push({
      kind,
      catalogId: cat.id,
      center: box.center,
      rotation,
      width: near(mw, cat.w) ? mw : cat.w,
      depth: near(md, cat.d) ? md : cat.d,
      confidence: Math.round((0.5 + (sanitary ? 0.15 : room && room.name ? -0.1 : 0)) * 100) / 100,
      note: `Symbol im Plan (${Math.round(box.l * 100)} × ${Math.round(box.w * 100)} cm)${sanitary ? ` in „${room!.name}“` : ''} – Art, Lage und Drehung prüfen`,
      area: box.l * box.w,
    });
  }
  found.push(...detectWashers(candidates, walls, rooms, found));
  // an inner outline (tub basin) lies inside a bigger symbol: keep only the outermost
  return found
    .filter((f) => !found.some((g) => g !== f && g.area > f.area && Math.hypot(g.center.x - f.center.x, g.center.y - f.center.y) < Math.max(g.width, g.depth) / 2))
    .map(({ area: _area, ...f }) => f);
}

/**
 * Washing machine / dryer / dishwasher: a square outline (often dashed) with a circle (drum) in it.
 * Circles come from curve pieces; the square is searched around each circle in the frame of the nearest
 * wall, and must be covered on all four sides (dashes cover about half of a side).
 */
function detectWashers(segments: FixtureSegment[], walls: Wall[], rooms: { polygon: Vec2[]; name: string }[], found: { center: Vec2; area: number }[]): (FixtureCandidate & { area: number })[] {
  const curves = segments.filter((s) => s.curve);
  const lines = segments.filter((s) => !s.curve);
  const out: (FixtureCandidate & { area: number })[] = [];
  for (const { segs } of components(curves)) {
    if (segs.length < 6) continue;
    const pts = segs.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]);
    const box = orientedBox(pts);
    if (box.l < 0.25 || box.l > 0.65 || box.l / box.w > 1.25) continue;
    const c = box.center;
    if (found.some((f) => Math.hypot(f.center.x - c.x, f.center.y - c.y) < 0.4)) continue;
    const room = rooms.find((r) => pointInPolygon(c, r.polygon));
    if (rooms.length > 0 && !room) continue;
    // frame: direction of the nearest wall, else the plan axes
    let phi = 0;
    let best = Infinity;
    for (const w of walls) {
      const d = closestPointOnSegment(c, w.a, w.b).distance;
      if (d < best) {
        best = d;
        phi = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
      }
    }
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    const local = lines
      .filter((s) => Math.hypot((s.x1 + s.x2) / 2 - c.x, (s.y1 + s.y2) / 2 - c.y) < 0.75)
      .map((s) => ({
        a: { u: (s.x1 - c.x) * cs + (s.y1 - c.y) * sn, v: -(s.x1 - c.x) * sn + (s.y1 - c.y) * cs },
        b: { u: (s.x2 - c.x) * cs + (s.y2 - c.y) * sn, v: -(s.x2 - c.x) * sn + (s.y2 - c.y) * cs },
      }));
    const TOL = 0.03;
    let fit: { h: number; cover: number } | null = null;
    for (let h = 0.25; h <= 0.5001; h += 0.01) {
      const cover = [0, 0, 0, 0];
      for (const { a, b } of local) {
        const len = Math.hypot(b.u - a.u, b.v - a.v);
        // vertical piece (u const) on side ±h, horizontal piece (v const) on side ±h
        if (Math.abs(a.u - b.u) <= TOL && Math.abs(a.v) <= h + TOL && Math.abs(b.v) <= h + TOL) {
          if (Math.abs(a.u - h) <= TOL) cover[0] += len;
          else if (Math.abs(a.u + h) <= TOL) cover[1] += len;
        } else if (Math.abs(a.v - b.v) <= TOL && Math.abs(a.u) <= h + TOL && Math.abs(b.u) <= h + TOL) {
          if (Math.abs(a.v - h) <= TOL) cover[2] += len;
          else if (Math.abs(a.v + h) <= TOL) cover[3] += len;
        }
      }
      const min = Math.min(...cover) / (2 * h);
      if (min >= 0.4 && (!fit || min > fit.cover)) fit = { h, cover: min };
    }
    if (!fit) continue;
    const side = 2 * fit.h;
    if (side < 0.5 || side > 0.9) continue;
    const kitchen = !!room && KITCHEN_ROOM.test(room.name);
    const cat = kitchen ? CATALOG.dishwasher : CATALOG.washer;
    // front faces away from the wall: back (local -y) to the nearest wall
    const wallDist = (theta: number) => {
      const probe = { x: c.x + Math.sin(theta) * (side / 2 + 0.1), y: c.y - Math.cos(theta) * (side / 2 + 0.1) };
      return Math.min(...walls.map((w) => closestPointOnSegment(probe, w.a, w.b).distance), Infinity);
    };
    const thetas = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((t) => t + Math.round(phi / (Math.PI / 2)) * (Math.PI / 2));
    let rotation = thetas.reduce((bestT, t) => (wallDist(t) < wallDist(bestT) ? t : bestT), thetas[0]);
    rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
    out.push({
      kind: kitchen ? 'dishwasher' : 'washer',
      catalogId: cat.id,
      center: c,
      rotation,
      width: near(side, cat.w) ? side : cat.w,
      depth: near(side, cat.d) ? side : cat.d,
      confidence: 0.45,
      note: `Quadrat mit Kreis im Plan (${Math.round(side * 100)} × ${Math.round(side * 100)} cm)${room?.name ? ` in „${room.name}“` : ''} – Waschmaschine, Trockner oder Geschirrspüler? Art und Drehung prüfen`,
      area: side * side,
    });
  }
  return out;
}
