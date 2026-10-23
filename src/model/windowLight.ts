import { isOutdoorRoom, planBearing } from './daylight';
import type { DerivedPlan } from './derived';
import type { Furniture, Project } from './schema';
import { curtainShownWidth, transmission } from './shading';
import { add, dot, pointInPolygon, polygonArea, rotate, scale, sub, type Vec2 } from './vec';

/**
 * Daylight that enters through the windows (#420), for the 3D lighting.
 * Per window: glass area, the room it lights, the compass bearing it faces and how much light the
 * covering lets through – blind/roller shutter on the opening (#413) and curtains hung in front of it.
 * A rough guide, not a light simulation; the transmission values are assumptions.
 */

/** Share of the daylight a closed curtain lets through: an ordinary, not blackout fabric (assumption). */
export const CURTAIN_TRANSMISSION = 0.25;
/** A curtain counts for a window when it hangs at most this far (m) from the wall's inside face. */
const CURTAIN_REACH = 0.5;
/** Glass area per floor area at which a room counts as fully daylit (a common planning value is 1/8 … 1/6). */
export const FULL_DAYLIGHT_RATIO = 0.15;

/** Closing degrees driven by the running smart-home simulation (see smarthome/simulation blindOverrides). */
export interface CoverOverrides {
  openings: Map<string, number>;
  furniture: Map<string, number>;
}

export interface WindowLight {
  openingId: string;
  roomId: string;
  /** Plan point 0.6 m inside the room in front of the window. */
  inside: Vec2;
  /** Height of the window centre above the floor (m). */
  midHeight: number;
  /** Glass area (m²). */
  glass: number;
  /** Compass bearing the window faces (outwards, 0 = north, 90 = east). */
  bearing: number;
  /** Share of the daylight that gets through blind and curtains (0..1). */
  transmission: number;
}

const shapeOf = (f: Furniture): string => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);

/** Covered share (0..1) of the window span s0..s1 on the inside face of a wall by the curtains in front of it. */
function curtainCover(curtains: Furniture[], closedOf: (f: Furniture) => number | undefined, origin: Vec2, dir: Vec2, inward: Vec2, faceOffset: number, s0: number, s1: number): number {
  const spans: [number, number][] = [];
  for (const c of curtains) {
    const axis = rotate({ x: 1, y: 0 }, c.rotation);
    if (Math.abs(dot(axis, dir)) < 0.9) continue;
    const off = dot(sub({ x: c.x, y: c.y }, origin), inward) - faceOffset;
    if (off < -0.05 || off > CURTAIN_REACH) continue;
    // drawn open, a curtain is gathered at its -x end (see FurnitureObject)
    const shown = curtainShownWidth(c.width, closedOf(c));
    const a = add({ x: c.x, y: c.y }, scale(axis, -c.width / 2));
    const b = add(a, scale(axis, shown));
    const sa = dot(sub(a, origin), dir);
    const sb = dot(sub(b, origin), dir);
    const lo = Math.max(s0, Math.min(sa, sb));
    const hi = Math.min(s1, Math.max(sa, sb));
    if (hi > lo) spans.push([lo, hi]);
  }
  // union of the covered spans
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0;
  let end = s0;
  for (const [lo, hi] of spans) {
    const from = Math.max(lo, end);
    if (hi > from) covered += hi - from;
    end = Math.max(end, hi);
  }
  return s1 > s0 ? Math.min(1, covered / (s1 - s0)) : 0;
}

/** All windows that bring daylight into an indoor room. */
export function windowLights(project: Project, plan: DerivedPlan, overrides?: CoverOverrides): WindowLight[] {
  const indoor = project.rooms
    .filter((r) => !isOutdoorRoom(r))
    .map((r) => ({ id: r.id, poly: plan.rooms.get(r.id)?.interior }))
    .filter((r): r is { id: string; poly: Vec2[] } => !!r.poly && r.poly.length >= 3);
  const roomAt = (p: Vec2) => indoor.find((r) => pointInPolygon(p, r.poly))?.id;
  const curtains = project.furniture.filter((f) => shapeOf(f) === 'curtain');
  const curtainClosed = (f: Furniture) => overrides?.furniture.get(f.id) ?? f.closed;
  const out: WindowLight[] = [];
  for (const [wallId, list] of plan.openings) {
    const fp = plan.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      const o = r.opening;
      if (o.kind !== 'window') continue;
      const mid = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
      const sides = ([1, -1] as const).map((s) => ({ s, room: roomAt(add(mid, scale(fp.normal, s * (fp.thickness / 2 + 0.3)))) }));
      for (const { s, room } of sides) {
        // daylight only comes in from outside: the other side is no indoor room (open air or a balcony)
        if (!room || sides.some((o2) => o2.s !== s && o2.room)) continue;
        const inward = scale(fp.normal, s);
        const shading = o.shading ? { ...o.shading, closed: overrides?.openings.get(o.id) ?? o.shading.closed } : undefined;
        const cover = curtainCover(curtains, curtainClosed, fp.a, fp.dir, inward, fp.thickness / 2, r.s0, r.s1);
        out.push({
          openingId: o.id,
          roomId: room,
          inside: add(mid, scale(inward, fp.thickness / 2 + 0.6)),
          midHeight: (r.bottom + r.top) / 2,
          glass: (r.s1 - r.s0) * (r.top - r.bottom),
          bearing: planBearing(scale(inward, -1), project.settings.northDirection),
          transmission: transmission(shading) * (1 - cover * (1 - CURTAIN_TRANSMISSION)),
        });
      }
    }
  }
  return out;
}

/**
 * How well the apartment as a whole is daylit (0..1): effective glass area (after blinds and curtains)
 * per indoor floor area, relative to FULL_DAYLIGHT_RATIO. Scales the light that is not bound to a
 * window (sky and environment fill), so drawn curtains darken the rooms and windowless flats stay dim.
 */
export function apartmentDaylight(project: Project, plan: DerivedPlan, windows: WindowLight[]): number {
  let floor = 0;
  for (const r of project.rooms) {
    if (isOutdoorRoom(r)) continue;
    const poly = plan.rooms.get(r.id)?.interior;
    if (poly && poly.length >= 3) floor += polygonArea(poly);
  }
  if (floor <= 0) return 1;
  const glass = windows.reduce((s, w) => s + w.glass * w.transmission, 0);
  return Math.min(1, glass / floor / FULL_DAYLIGHT_RATIO);
}

/** Angle between two compass bearings, 0–180°. */
const angleBetween = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * Brightness of the daylight through one window (0.6 under a dull sky … 2 facing a bright sun): a window
 * facing the sun gets more, one on the shaded side less.
 */
export function facadeFactor(bearing: number, sunBearing: number, sunStrength: number): number {
  const facing = Math.max(0, Math.cos((angleBetween(bearing, sunBearing) * Math.PI) / 180));
  return 0.6 + sunStrength * (0.4 + facing);
}
