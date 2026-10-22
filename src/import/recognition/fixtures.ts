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

export type FixtureKind = 'bathtub' | 'washbasin' | 'toilet';

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
} as const;

/** Symbol pieces are short; longer lines are walls, dimension lines or furniture outlines. */
const MAX_PIECE = 1.5;
const JOIN_TOL = 0.03;
const SANITARY_ROOM = /bad|wc|toilet|dusch|wasch|sanit/i;
const WC_ROOM = /wc|toilet/i;

interface Component {
  segs: FixtureSegment[];
}

function components(segs: FixtureSegment[]): Component[] {
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
function orientedBox(points: Vec2[]): { l: number; w: number; phi: number; center: Vec2 } {
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
  const symbolLines = segments.filter((s) => {
    if (s.areaFill || s.darkFill || s.faint) return false;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len < 1e-4 || len > MAX_PIECE) return false;
    const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    return !walls.some((w) => closestPointOnSegment(mid, w.a, w.b).distance <= w.thickness / 2 + 0.03);
  });
  const found: (FixtureCandidate & { area: number })[] = [];
  for (const { segs } of components(symbolLines)) {
    if (segs.length < 4) continue;
    const pts = segs.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]);
    // closed: nearly every end has a partner
    const open = pts.filter((p, i) => !pts.some((q, j) => j !== i && Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL)).length;
    if (open > 0.1 * pts.length) continue;
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
  // an inner outline (tub basin) lies inside a bigger symbol: keep only the outermost
  return found
    .filter((f) => !found.some((g) => g !== f && g.area > f.area && Math.hypot(g.center.x - f.center.x, g.center.y - f.center.y) < Math.max(g.width, g.depth) / 2))
    .map(({ area: _area, ...f }) => f);
}
