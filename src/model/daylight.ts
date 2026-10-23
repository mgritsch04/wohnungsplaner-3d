import type { DerivedPlan } from './derived';
import { findWallBetween } from './graph';
import { add, dist, lerp, normalize, perp, pointInPolygon, scale, signedArea, sub, type Vec2 } from './vec';
import type { Project, Room } from './schema';

/**
 * Rough daylight and sun orientation per room (#69) and balcony/terrace (#93).
 * An estimate for orientation only: no shading, no sun path of a real place, no light calculation.
 */

export const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;
export type Compass = (typeof COMPASS)[number];

const COMPASS_NAME: Record<Compass, string> = {
  N: 'Norden',
  NO: 'Nordosten',
  O: 'Osten',
  SO: 'Südosten',
  S: 'Süden',
  SW: 'Südwesten',
  W: 'Westen',
  NW: 'Nordwesten',
};

export const compassName = (c: Compass): string => COMPASS_NAME[c];

/** Compass point (8 sectors) of a bearing in degrees (0 = north, 90 = east). */
export function compassOf(bearing: number): Compass {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8];
}

/**
 * Compass bearing (0–360°) in which a plan direction points. Plan y runs downwards, so plan "up"
 * (-y) points to `north` (settings.northDirection: the bearing of the plan's upper edge).
 */
export function planBearing(dir: Vec2, north: number): number {
  const deg = (Math.atan2(dir.x, -dir.y) * 180) / Math.PI;
  return (((deg + north) % 360) + 360) % 360;
}

/** Angle between two bearings, 0–180°. */
const angleBetween = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** Hours (local clock time, whole hours) with sun on a facade facing `bearing`. */
export const SUN_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;
const SUN_HALF_ANGLE = 60;

/** Rough sun azimuth (northern hemisphere, around noon at 13:00 summer time): east at 7:00, south at 13:00, west at 19:00. */
export const sunAzimuth = (hour: number): number => 180 + 15 * (hour - 13);

export function sunHoursFor(bearing: number): number[] {
  return SUN_HOURS.filter((h) => angleBetween(sunAzimuth(h), bearing) <= SUN_HALF_ANGLE);
}

/** "ca. 8–13 Uhr (Vormittag bis Mittag)", "kaum direkte Sonne" when no hour qualifies. */
export function sunSpanLabel(hours: number[]): string {
  if (hours.length === 0) return 'kaum direkte Sonne';
  const first = hours[0];
  const last = hours[hours.length - 1] + 1;
  const part = (h: number) => (h < 11 ? 'Vormittag' : h < 14 ? 'Mittag' : h < 18 ? 'Nachmittag' : 'Abend');
  const a = part(first);
  const b = part(last - 1);
  return `ca. ${first}–${last} Uhr (${a === b ? a : `${a} bis ${b}`})`;
}

export type DaylightLevel = 'none' | 'low' | 'medium' | 'high';

export const DAYLIGHT_LABEL: Record<DaylightLevel, string> = {
  none: 'kein Tageslicht',
  low: 'wenig Tageslicht',
  medium: 'mittleres Tageslicht',
  high: 'viel Tageslicht',
};

export interface RoomDaylight {
  roomId: string;
  name: string;
  /** Glazed area (windows and glass doors) facing the outside, m². */
  glassArea: number;
  /** Compass points with glazing, sorted by glazed area (largest first). */
  directions: Compass[];
  level: DaylightLevel;
  /** Hours with direct sun through at least one window. */
  sunHours: number[];
}

export interface OutdoorSun {
  roomId: string;
  name: string;
  /** Direction the open side faces; null if it cannot be told. */
  facing: Compass | null;
  sunHours: number[];
}

export interface Daylight {
  rooms: RoomDaylight[];
  outdoor: OutdoorSun[];
}

const OUTDOOR = /(balkon|loggia|terrasse)/i;
export const isOutdoorRoom = (r: Pick<Room, 'name'>): boolean => OUTDOOR.test(r.name);

/** Brightness weight of a facade by its direction (south brightest, north least). */
const directionFactor = (bearing: number): number => 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(((bearing - 180) * Math.PI) / 180));

interface Edge {
  a: Vec2;
  b: Vec2;
  mid: Vec2;
  outward: Vec2;
  /** True if no other room lies just behind this wall edge. */
  exterior: boolean;
  wallId?: string;
}

function roomEdges(room: Room, plan: DerivedPlan): Edge[] {
  const geo = plan.rooms.get(room.id);
  if (!geo) return [];
  const c = geo.centerline;
  const sign = signedArea(c) >= 0 ? 1 : -1;
  const others = [...plan.rooms.values()].filter((g) => g.roomId !== room.id).map((g) => g.interior);
  const edges: Edge[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    if (dist(a, b) < 1e-6) continue;
    const outward = scale(perp(normalize(sub(b, a))), -sign);
    const mid = lerp(a, b, 0.5);
    const wall = findWallBetween(plan.index.walls.values(), room.nodeIds[i], room.nodeIds[(i + 1) % c.length]);
    const probe = add(mid, scale(outward, (wall?.thickness ?? 0.12) / 2 + 0.3));
    edges.push({ a, b, mid, outward, exterior: !others.some((poly) => pointInPolygon(probe, poly)), wallId: wall?.id });
  }
  return edges;
}

export interface RoomWindow {
  /** Centre of the window in the wall (plan metres). */
  pos: Vec2;
  /** Glazed area, m². */
  area: number;
}

/** Windows in the outer walls of a room with their position (#360), for the light estimate. */
export function roomWindows(plan: DerivedPlan, room: Room): RoomWindow[] {
  const out: RoomWindow[] = [];
  for (const e of roomEdges(room, plan)) {
    if (!e.exterior || !e.wallId) continue;
    const fp = plan.footprints.get(e.wallId);
    if (!fp) continue;
    for (const r of plan.openings.get(e.wallId) ?? []) {
      if (r.opening.kind !== 'window') continue;
      out.push({ pos: add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2)), area: r.opening.width * r.opening.height });
    }
  }
  return out;
}

export function computeDaylight(project: Project, plan: DerivedPlan): Daylight {
  const north = project.settings.northDirection;
  const rooms: RoomDaylight[] = [];
  const outdoor: OutdoorSun[] = [];
  for (const room of project.rooms) {
    const geo = plan.rooms.get(room.id);
    if (!geo) continue;
    const edges = roomEdges(room, plan);
    if (isOutdoorRoom(room)) {
      let sum: Vec2 = { x: 0, y: 0 };
      for (const e of edges) if (e.exterior) sum = add(sum, scale(e.outward, dist(e.a, e.b)));
      const len = Math.hypot(sum.x, sum.y);
      const bearing = len > 1e-6 ? planBearing(sum, north) : null;
      outdoor.push({
        roomId: room.id,
        name: room.name,
        facing: bearing === null ? null : compassOf(bearing),
        sunHours: bearing === null ? [] : sunHoursFor(bearing),
      });
      continue;
    }
    const byDirection = new Map<Compass, number>();
    const hours = new Set<number>();
    let effective = 0;
    let glassArea = 0;
    for (const e of edges) {
      if (!e.exterior || !e.wallId) continue;
      const bearing = planBearing(e.outward, north);
      for (const o of project.openings) {
        if (o.wallId !== e.wallId || o.kind !== 'window') continue;
        const area = o.width * o.height;
        glassArea += area;
        effective += area * directionFactor(bearing);
        const dir = compassOf(bearing);
        byDirection.set(dir, (byDirection.get(dir) ?? 0) + area);
        for (const h of sunHoursFor(bearing)) hours.add(h);
      }
    }
    const ratio = geo.area > 0 ? effective / geo.area : 0;
    const level: DaylightLevel = glassArea === 0 ? 'none' : ratio >= 0.1 ? 'high' : ratio >= 0.05 ? 'medium' : 'low';
    rooms.push({
      roomId: room.id,
      name: room.name,
      glassArea,
      directions: [...byDirection.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d),
      level,
      sunHours: [...hours].sort((x, y) => x - y),
    });
  }
  return { rooms, outdoor };
}
