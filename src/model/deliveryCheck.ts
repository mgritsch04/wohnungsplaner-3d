/**
 * Delivery route check (#358)
 * ---------------------------
 * `checkDelivery(project, derived, furnitureId)` estimates whether a (large) piece of
 * furniture can be carried from the entrance door to its place in the plan.
 *
 * Simplifications – the result is an ESTIMATE, not a guarantee:
 * - The entrance is the first door that has a room on one side only.
 * - The piece is carried with one axis leading; what matters is its cross-section
 *   (horizontal × vertical). All six are tried, narrowest first: width × height and
 *   depth × height (upright) and every tilted variant (on its end or on its side,
 *   "hochkant"/gekippt).
 * - The route is the shortest walking path (#67) with the horizontal cross-section as
 *   body radius, so doors, corridors and furniture on the way must be at least that wide.
 *   All doors are treated as opened (the leaves can be taken off or swung open).
 *   Turning long pieces around corners is NOT simulated.
 * - Every door/passage the route crosses must be higher than the vertical cross-section.
 * - Stairs are not part of this check (the moving plan checks stairwell and lift, see movePlan.ts).
 */
import type { DerivedPlan } from './derived';
import { derivePlan } from './derived';
import type { Furniture, Opening, Project } from './schema';
import { isGlassDoor } from './schema';
import { add, dist, pointInPolygon, scale, type Vec2 } from './vec';
import { shortestWalkPath } from './walkPath';

/** Spare room left on each side while carrying (hands, wobble). */
export const CARRY_MARGIN = 0.02;

export type DeliveryOrientation = 'upright' | 'tilted';

export interface DeliveryBottleneck {
  /** What is tightest: an opening (door/passage) or the corridor/room layout. */
  kind: 'opening' | 'height' | 'path';
  label: string;
  /** Clear width (m) of the opening, when known. */
  width?: number;
  at?: Vec2;
}

export type DeliveryResult =
  | {
      ok: true;
      fits: boolean;
      orientation: DeliveryOrientation | null;
      /** Cross-section carried through (horizontal × vertical, m). */
      carry?: { w: number; h: number };
      entrance: Vec2;
      goal: Vec2;
      /** Route of the (best) attempt, entrance → place. */
      points: Vec2[];
      length: number;
      bottleneck: DeliveryBottleneck | null;
      message: string;
    }
  | { ok: false; reason: string };

interface DoorOnRoute {
  opening: Opening;
  a: Vec2;
  b: Vec2;
  center: Vec2;
  label: string;
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;
const isDoor = (o: Opening) => o.kind === 'door' || o.kind === 'passage' || isGlassDoor(o);

function allDoors(project: Project, derived: DerivedPlan): (DoorOnRoute & { wallThickness: number; normal: Vec2 })[] {
  const out: (DoorOnRoute & { wallThickness: number; normal: Vec2 })[] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    for (const r of derived.openings.get(w.id) ?? []) {
      if (!isDoor(r.opening)) continue;
      const a = add(fp.a, scale(fp.dir, r.s0));
      const b = add(fp.a, scale(fp.dir, r.s1));
      const kind = r.opening.kind === 'passage' ? 'Durchgang' : 'Tür';
      out.push({ opening: r.opening, a, b, center: scale(add(a, b), 0.5), label: kind, wallThickness: fp.thickness, normal: fp.normal });
    }
  }
  return out;
}

function inAnyRoom(derived: DerivedPlan, p: Vec2): boolean {
  for (const g of derived.rooms.values()) if (pointInPolygon(p, g.interior)) return true;
  return false;
}

/** The first real door that has a room on one side only (= leads outside / to the stairwell). */
export function findEntrance(project: Project, derived: DerivedPlan): (DoorOnRoute & { inside: Vec2 }) | null {
  for (const d of allDoors(project, derived)) {
    if (d.opening.kind === 'passage') continue;
    const off = d.wallThickness / 2 + 0.15;
    const p1 = add(d.center, scale(d.normal, off));
    const p2 = add(d.center, scale(d.normal, -off));
    const in1 = inAnyRoom(derived, p1);
    const in2 = inAnyRoom(derived, p2);
    if (in1 !== in2) return { ...d, inside: in1 ? p1 : p2 };
  }
  return null;
}

function segmentsCross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const o = (u: Vec2, v: Vec2, w: Vec2) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = o(p, q, a);
  const d2 = o(p, q, b);
  const d3 = o(a, b, p);
  const d4 = o(a, b, q);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

function doorsOnRoute(doors: DoorOnRoute[], points: Vec2[]): DoorOnRoute[] {
  return doors.filter((d) => {
    for (let i = 1; i < points.length; i++) if (segmentsCross(points[i - 1], points[i], d.a, d.b)) return true;
    return false;
  });
}

/** Copy of the project with every door opened and the piece itself removed. */
function prepared(project: Project, furnitureId: string): Project {
  const p = structuredClone(project);
  p.furniture = p.furniture.filter((f) => f.id !== furnitureId);
  for (const o of p.openings) if (o.kind === 'door' || isGlassDoor(o)) o.open = true;
  return p;
}

interface Attempt {
  orientation: DeliveryOrientation;
  w: number;
  h: number;
}

function attempts(f: Furniture): Attempt[] {
  const list: Attempt[] = [
    { orientation: 'upright', w: f.width, h: f.height },
    { orientation: 'upright', w: f.depth, h: f.height },
    { orientation: 'tilted', w: Math.max(f.width, f.depth), h: Math.min(f.width, f.depth) },
    { orientation: 'tilted', w: Math.min(f.width, f.depth), h: Math.max(f.width, f.depth) },
    { orientation: 'tilted', w: f.height, h: f.width },
    { orientation: 'tilted', w: f.height, h: f.depth },
  ];
  // upright carrying is preferred; within that the narrowest horizontal cross-section first
  return list.sort((x, y) => Number(x.orientation === 'tilted') - Number(y.orientation === 'tilted') || x.w - y.w);
}

export function checkDelivery(project: Project, derived: DerivedPlan, furnitureId: string): DeliveryResult {
  const f = project.furniture.find((x) => x.id === furnitureId);
  if (!f) return { ok: false, reason: 'Möbel nicht gefunden' };
  return checkPieceDelivery(project, derived, f);
}

/** Same check for a piece with other dimensions than the placed furniture (a package of it, #487); `f` keeps the place and id. */
export function checkPieceDelivery(project: Project, derived: DerivedPlan, f: Furniture): DeliveryResult {
  const furnitureId = f.id;
  const entrance = findEntrance(project, derived);
  if (!entrance) return { ok: false, reason: 'Keine Eingangstür gefunden (eine Tür, die von einem Raum nach außen führt)' };
  const goal: Vec2 = { x: f.x, y: f.y };
  const work = prepared(project, furnitureId);
  const wd = derivePlan(work);
  const doors = allDoors(work, wd);

  let best: { att: Attempt; points: Vec2[]; length: number } | null = null; // reaches the place, but a door is too low
  let lowDoor: { door: DoorOnRoute; att: Attempt } | null = null;
  for (const att of attempts(f)) {
    const radius = att.w / 2 + CARRY_MARGIN;
    const res = shortestWalkPath(work, wd, entrance.inside, goal, { radius });
    if (!res.ok) continue;
    const crossed = withEntrance(doorsOnRoute(doors, res.points), doors, entrance.opening.id);
    const narrowDoor = crossed.find((d) => d.opening.width < att.w + 2 * CARRY_MARGIN);
    if (narrowDoor) continue;
    const low = crossed.find((d) => d.opening.height < att.h + CARRY_MARGIN);
    if (low) {
      best ??= { att, points: res.points, length: res.length };
      lowDoor ??= { door: low, att };
      continue;
    }
    const upright = att.orientation === 'upright';
    return {
      ok: true,
      fits: true,
      orientation: att.orientation,
      carry: { w: att.w, h: att.h },
      entrance: entrance.inside,
      goal,
      points: res.points,
      length: res.length,
      bottleneck: tightest(crossed, att),
      message: upright
        ? `Passt (Schätzung): aufrecht tragbar, Querschnitt ${cm(att.w)} × ${cm(att.h)}.`
        : `Passt nur hochkant/gekippt (Schätzung): Querschnitt ${cm(att.w)} × ${cm(att.h)}.`,
    };
  }

  // does not fit: find out why with a slim person-sized route
  const slim = shortestWalkPath(work, wd, entrance.inside, goal, { radius: 0.2 });
  const points = best?.points ?? (slim.ok ? slim.points : [entrance.inside, goal]);
  const length = best?.length ?? (slim.ok ? slim.length : dist(entrance.inside, goal));
  const narrow = attempts(f).reduce((m, a) => (a.w < m.w ? a : m));
  let bottleneck: DeliveryBottleneck | null;
  let why: string;
  if (lowDoor) {
    const d = lowDoor.door;
    bottleneck = { kind: 'height', label: `${d.label} ist nur ${cm(d.opening.height)} hoch`, width: d.opening.width, at: d.center };
    why = `${d.label} nur ${cm(d.opening.height)} hoch, das Möbel braucht ${cm(lowDoor.att.h)}.`;
  } else if (slim.ok || entranceTooNarrow(doors, entrance.opening.id, narrow.w)) {
    const tight = withEntrance(slim.ok ? doorsOnRoute(doors, slim.points) : [], doors, entrance.opening.id)
      .filter((d) => d.opening.width < narrow.w + 2 * CARRY_MARGIN)
      .sort((a, b) => a.opening.width - b.opening.width)[0];
    if (tight) {
      bottleneck = { kind: 'opening', label: `${tight.label} ${cm(tight.opening.width)} breit`, width: tight.opening.width, at: tight.center };
      why = `${tight.label} nur ${cm(tight.opening.width)} breit, das Möbel braucht mindestens ${cm(narrow.w + 2 * CARRY_MARGIN)}.`;
    } else {
      bottleneck = { kind: 'path', label: 'Gang oder Möbel im Weg' };
      why = `Ein Gang oder andere Möbel auf dem Weg sind zu eng (nötig: ${cm(narrow.w + 2 * CARRY_MARGIN)}).`;
    }
  } else {
    bottleneck = { kind: 'path', label: slim.reason };
    why = slim.reason + '.';
  }
  return {
    ok: true,
    fits: false,
    orientation: null,
    entrance: entrance.inside,
    goal,
    points,
    length,
    bottleneck,
    message: `Passt voraussichtlich nicht (Schätzung): ${why}`,
  };
}

/** The entrance is crossed by every delivery, even though the route starts just inside it. */
function withEntrance(crossed: DoorOnRoute[], doors: DoorOnRoute[], entranceId: string): DoorOnRoute[] {
  if (crossed.some((d) => d.opening.id === entranceId)) return crossed;
  const e = doors.find((d) => d.opening.id === entranceId);
  return e ? [e, ...crossed] : crossed;
}

function entranceTooNarrow(doors: DoorOnRoute[], entranceId: string, w: number): boolean {
  const e = doors.find((d) => d.opening.id === entranceId);
  return !!e && e.opening.width < w + 2 * CARRY_MARGIN;
}

function tightest(crossed: DoorOnRoute[], att: Attempt): DeliveryBottleneck | null {
  const d = [...crossed].sort((a, b) => a.opening.width - b.opening.width)[0];
  if (!d) return null;
  return { kind: 'opening', label: `engste Stelle: ${d.label} ${cm(d.opening.width)} breit (Möbel ${cm(att.w)})`, width: d.opening.width, at: d.center };
}
