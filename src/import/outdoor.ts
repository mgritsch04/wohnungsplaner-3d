/**
 * Balconies, loggias and terraces in recognised plans (#214). They have no walls of
 * their own – only a light floor area (tiles, decking) behind the outer wall and a
 * railing drawn with thin lines – so the wall detection leaves them out. When the plan
 * names such an area ("Balkon 7,82 m²") and its floor is a filled area next to the
 * recognised walls, the open sides get railings (low, thin walls). The room proposal
 * then finds the balcony as a closed area like any other room.
 */
import { newId } from '../model/ids';
import { pointInPolygon, type Vec2 } from '../model/vec';
import type { DraftOpening, DraftWall } from './draft';
import type { PlacedText } from './rooms';

const OUTDOOR = /(balkon|loggia|terrasse)/i;

/** Plausible floor area of a balcony/terrace (m²). */
const MIN_AREA = 1;
const MAX_AREA = 60;
/** A wall counts as one side of the area if its centre line is this far (m) beyond its half thickness at most. */
const SIDE_TOL = 0.3;
/** Open sides are pulled onto the end of a neighbouring wall over at most this distance (m). */
const CLAMP = 0.5;

export const RAILING_HEIGHT = 1.0;
export const RAILING_THICKNESS = 0.1;

/** Outline of a filled area of the plan (plan metres). */
export type AreaOutline = Vec2[];

/** An axis-aligned wall: orientation, centre line, extent along, thickness. */
interface WallBand {
  o: 'h' | 'v';
  c: number;
  a0: number;
  a1: number;
  t: number;
}

interface Side {
  /** Wall centre line coordinate across the side, or null if the side is open. */
  c: number | null;
  /** Extent of the covering wall along the side. */
  a0: number;
  a1: number;
}

function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/**
 * Railing walls that close the balconies/terraces named in the plan texts.
 * `walls` are the recognised walls; areas already enclosed by them are left alone
 * (`isEnclosed` tells whether a text lies inside a proposed room).
 */
export function outdoorRailings(walls: DraftWall[], texts: PlacedText[], areas: AreaOutline[], isEnclosed: (p: Vec2) => boolean): DraftWall[] {
  const accepted = walls.filter((w) => w.accepted);
  const out: DraftWall[] = [];
  const done = new Set<AreaOutline>();
  for (const t of texts) {
    if (!OUTDOOR.test(t.str) || isEnclosed(t)) continue;
    const area = areas
      .filter((a) => !done.has(a) && a.length >= 3 && pointInPolygon(t, a))
      .map((a) => ({ a, size: polygonArea(a) }))
      .filter((x) => x.size >= MIN_AREA && x.size <= MAX_AREA)
      .sort((p, q) => p.size - q.size)[0];
    if (!area) continue;
    const xs = area.a.map((p) => p.x);
    const ys = area.a.map((p) => p.y);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const railings = railingsForBox(box, accepted);
    if (!railings.length) continue;
    done.add(area.a);
    out.push(...railings);
  }
  return out;
}

function railingsForBox(box: { x0: number; x1: number; y0: number; y1: number }, walls: DraftWall[]): DraftWall[] {
  // axis-aligned walls as bands: orientation, centre line, extent along
  const bands = walls.flatMap((w): WallBand[] => {
    if (Math.abs(w.a.y - w.b.y) < 1e-3) return [{ o: 'h', c: w.a.y, a0: Math.min(w.a.x, w.b.x), a1: Math.max(w.a.x, w.b.x), t: w.thickness }];
    if (Math.abs(w.a.x - w.b.x) < 1e-3) return [{ o: 'v', c: w.a.x, a0: Math.min(w.a.y, w.b.y), a1: Math.max(w.a.y, w.b.y), t: w.thickness }];
    return [];
  });
  const side = (o: 'h' | 'v', at: number, from: number, to: number): Side => {
    const len = to - from;
    let best: WallBand | null = null;
    for (const b of bands) {
      if (b.o !== o || Math.abs(b.c - at) > b.t / 2 + SIDE_TOL) continue;
      const overlap = Math.min(b.a1, to) - Math.max(b.a0, from);
      if (overlap < 0.5 * len) continue;
      if (!best || Math.abs(b.c - at) < Math.abs(best.c - at)) best = b;
    }
    return best ? { c: best.c, a0: best.a0, a1: best.a1 } : { c: null, a0: from, a1: to };
  };
  const top = side('h', box.y0, box.x0, box.x1);
  const bottom = side('h', box.y1, box.x0, box.x1);
  const left = side('v', box.x0, box.y0, box.y1);
  const right = side('v', box.x1, box.y0, box.y1);
  if (top.c === null && bottom.c === null && left.c === null && right.c === null) return [];
  if (top.c !== null && bottom.c !== null && left.c !== null && right.c !== null) return [];

  let x0 = left.c ?? box.x0;
  let x1 = right.c ?? box.x1;
  let y0 = top.c ?? box.y0;
  let y1 = bottom.c ?? box.y1;
  // an open side ends where the neighbouring wall ends, so the railing meets it in a corner
  const clampLow = (v: number, s: Side) => (s.c !== null && v < s.a0 && s.a0 - v <= CLAMP ? s.a0 : v);
  const clampHigh = (v: number, s: Side) => (s.c !== null && v > s.a1 && v - s.a1 <= CLAMP ? s.a1 : v);
  if (left.c === null) x0 = clampLow(clampLow(x0, top), bottom);
  if (right.c === null) x1 = clampHigh(clampHigh(x1, top), bottom);
  if (top.c === null) y0 = clampLow(clampLow(y0, left), right);
  if (bottom.c === null) y1 = clampHigh(clampHigh(y1, left), right);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return [];

  const railing = (a: Vec2, b: Vec2): DraftWall => ({
    id: newId('dw'),
    a,
    b,
    thickness: RAILING_THICKNESS,
    height: RAILING_HEIGHT,
    status: 'uncertain',
    confidence: 0.5,
    note: 'Balkon-/Terrassengeländer aus der Plan-Fläche – Lage und Höhe prüfen',
    accepted: true,
  });
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const P = (x: number, y: number) => ({ x: r(x), y: r(y) });
  const out: DraftWall[] = [];
  if (top.c === null) out.push(railing(P(x0, y0), P(x1, y0)));
  if (bottom.c === null) out.push(railing(P(x0, y1), P(x1, y1)));
  if (left.c === null) out.push(railing(P(x0, y0), P(x0, y1)));
  if (right.c === null) out.push(railing(P(x1, y0), P(x1, y1)));
  return out;
}

/** An opening this close (m, centre line to the floor edge) to a balcony/terrace leads onto it. */
const DOOR_REACH = 0.35;
export const BALCONY_DOOR_HEIGHT = 2.1;

function edgeDistance(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
    d = Math.min(d, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey));
  }
  return d;
}

/**
 * Openings onto a balcony, loggia or terrace are glazed balcony doors (#37): plans draw them like
 * windows (or with a leaf), but they reach down to the floor. They become windows down to the floor –
 * glass doors (see isGlassDoor). `interiors` are the floor outlines of the proposed rooms; those
 * holding an outdoor label are the outdoor areas. Converted openings stay "uncertain".
 */
export function balconyDoors(openings: DraftOpening[], texts: PlacedText[], interiors: Vec2[][]): DraftOpening[] {
  const outdoor = interiors.filter((poly) => texts.some((t) => OUTDOOR.test(t.str) && pointInPolygon(t, poly)));
  if (!outdoor.length) return openings;
  return openings.map((o) =>
    o.kind !== 'passage' && outdoor.some((poly) => !pointInPolygon(o.center, poly) && edgeDistance(o.center, poly) <= DOOR_REACH)
      ? { ...o, kind: 'window', sillHeight: 0, height: BALCONY_DOOR_HEIGHT, status: 'uncertain', note: 'Glas-Balkontür: Öffnung zum Balkon/zur Terrasse – Art und Höhe prüfen' }
      : o,
  );
}
