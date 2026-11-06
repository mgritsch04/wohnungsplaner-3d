/**
 * Mirrors and turns a furnished room for the metamorphic test of the walk-through (Q5): the room, its
 * openings and its pieces move together, so every rule must give the same points as before. A
 * difference points at a rule with a hidden left/right or axis assumption.
 */
import type { Vec2 } from '../../model/vec';
import type { CornerInfo, PlacedItem, RoomAnalysis, RoomFixture, RoomProgram, UserZone, WallInfo, WallOpening, Walkway } from '../types';
import type { ReviewInput } from './context';

/** A symmetry of the plane: `mirror` is x → −x, `turns` quarter turns (counter-clockwise on screen) follow. */
export interface Symmetry {
  mirror: boolean;
  turns: number;
}

type Map2 = (p: Vec2) => Vec2;

function mapOf(s: Symmetry): { point: Map2; vec: Map2; angle: (a: number) => number } {
  const q = ((s.turns % 4) + 4) % 4;
  const turn = (p: Vec2): Vec2 => {
    let { x, y } = p;
    for (let k = 0; k < q; k++) [x, y] = [-y, x];
    return { x, y };
  };
  const vec: Map2 = (p) => turn(s.mirror ? { x: -p.x, y: p.y } : p);
  return { point: vec, vec, angle: (a) => (s.mirror ? -a : a) + (q * Math.PI) / 2 };
}

function opening(o: WallOpening, len: number, point: Map2, mirror: boolean): WallOpening {
  return { ...o, t0: mirror ? len - o.t1 : o.t0, t1: mirror ? len - o.t0 : o.t1, swing: o.swing?.map(point) };
}

/** The room analysis in the mirrored and turned plan. */
export function transformAnalysis(an: RoomAnalysis, s: Symmetry): RoomAnalysis {
  const { point, vec } = mapOf(s);
  const polygon = an.polygon.map(point);
  if (s.mirror) polygon.reverse();
  const walls: WallInfo[] = an.walls.map((w) =>
    s.mirror
      ? { ...w, side: null, a: point(w.b), b: point(w.a), dir: vec({ x: -w.dir.x, y: -w.dir.y }), inward: vec(w.inward), openings: w.openings.map((o) => opening(o, w.length, point, true)).reverse(), free: w.free.map((f) => ({ t0: w.length - f.t1, t1: w.length - f.t0 })).reverse(), behind: [...w.behind].reverse() }
      : { ...w, side: null, a: point(w.a), b: point(w.b), dir: vec(w.dir), inward: vec(w.inward), openings: w.openings.map((o) => opening(o, w.length, point, false)) },
  );
  if (s.mirror) walls.reverse();
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const origin = { x: Math.min(...xs), y: Math.min(...ys) };
  const corners: CornerInfo[] = an.corners.map((c) => ({ ...c, p: point(c.p) }));
  const walkways: Walkway[] = an.walkways.map((w) => ({ ...w, path: w.path.map(point) }));
  const fixtures: RoomFixture[] = an.fixtures.map((f) => ({ ...f, p: point(f.p) }));
  const userZones: UserZone[] = an.userZones.map((z) => ({ ...z, points: z.points.map(point) }));
  return {
    ...an,
    polygon,
    origin,
    size: { x: Math.max(...xs) - origin.x, y: Math.max(...ys) - origin.y },
    walls,
    corners,
    walkways,
    fixtures,
    userZones,
    entryView: an.entryView ? { ...an.entryView, at: point(an.entryView.at), dir: vec(an.entryView.dir) } : null,
  };
}

/** Pieces in the mirrored and turned plan (the front of a piece turns with it). */
export function transformItems(items: PlacedItem[], s: Symmetry): PlacedItem[] {
  const { point, angle } = mapOf(s);
  return items.map((i) => ({ ...i, ...point(i), rotation: angle(i.rotation) }));
}

/** The programme as far as the walk-through reads its geometry: the zones (axis-aligned rectangles stay rectangles). */
function transformProgram(prog: RoomProgram, s: Symmetry): RoomProgram {
  const { point } = mapOf(s);
  return {
    ...prog,
    zones: prog.zones.map((z) => {
      const a = point({ x: z.rect.x0, y: z.rect.y0 });
      const b = point({ x: z.rect.x1, y: z.rect.y1 });
      return { ...z, rect: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) } };
    }),
  };
}

export function transformInput(input: ReviewInput, s: Symmetry): ReviewInput {
  return {
    ...input,
    program: input.program ? transformProgram(input.program, s) : undefined,
    analysis: transformAnalysis(input.analysis, s),
    layout: { ...input.layout, items: transformItems(input.layout.items, s) },
    existing: input.existing ? transformItems(input.existing, s) : undefined,
  };
}
