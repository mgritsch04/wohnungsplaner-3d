import { furnitureCorners, footprintsOverlap } from '../editor2d/furnitureGeometry';
import { closestWall } from './operations';
import type { Fixture, FixtureKind, Furniture, Project } from './schema';
import { add, cross, dist, lerp, normalize, perp, scale, sub, type Vec2 } from './vec';

/**
 * Installation plan (#64, #81): sockets, light switches, radiators and water / waste-water
 * connections on the walls. Pure helpers – sizes, wall snapping and the rule that furniture
 * must not stand in front of a water connection.
 */

export const FIXTURE_KINDS: FixtureKind[] = ['socket', 'switch', 'radiator', 'water', 'drain'];

export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  socket: 'Steckdose',
  switch: 'Lichtschalter',
  radiator: 'Heizkörper',
  water: 'Wasseranschluss',
  drain: 'Abwasseranschluss',
};

/** Usual mounting heights (centre; radiator: lower edge) – guide values, editable per item. */
export const FIXTURE_ELEVATION: Record<FixtureKind, number> = {
  socket: 0.3,
  switch: 1.05,
  radiator: 0.15,
  water: 0.55,
  drain: 0.45,
};

export const RADIATOR_DEFAULT = { width: 0.8, height: 0.6, depth: 0.1 };

/** Box of one outlet / switch / connection: width along the wall, depth out of the wall, height. */
const SIZE: Record<Exclude<FixtureKind, 'radiator'>, { width: number; depth: number; height: number }> = {
  socket: { width: 0.08, depth: 0.02, height: 0.08 },
  switch: { width: 0.08, depth: 0.015, height: 0.08 },
  water: { width: 0.06, depth: 0.06, height: 0.06 },
  drain: { width: 0.08, depth: 0.08, height: 0.08 },
};

/** Size of a fixture in metres (sockets grow with the number of outlets). */
export function fixtureSize(f: Pick<Fixture, 'kind' | 'width' | 'height' | 'count'>): { width: number; depth: number; height: number } {
  if (f.kind === 'radiator') return { width: f.width ?? RADIATOR_DEFAULT.width, depth: RADIATOR_DEFAULT.depth, height: f.height ?? RADIATOR_DEFAULT.height };
  const s = SIZE[f.kind];
  return f.kind === 'socket' ? { ...s, width: s.width * Math.max(1, f.count) } : s;
}

/** Vertical centre of the fixture above the floor. */
export function fixtureCenterZ(f: Pick<Fixture, 'kind' | 'elevation' | 'width' | 'height' | 'count'>): number {
  return f.kind === 'radiator' ? f.elevation + fixtureSize(f).height / 2 : f.elevation;
}

export const isWaterConnection = (kind: FixtureKind) => kind === 'water' || kind === 'drain';

export function fixtureLabel(f: Pick<Fixture, 'kind' | 'count'>): string {
  return f.kind === 'socket' && f.count > 1 ? `${f.count}-fach-Steckdose` : FIXTURE_LABEL[f.kind];
}

export function fixtureCorners(f: Pick<Fixture, 'kind' | 'x' | 'y' | 'rotation' | 'width' | 'height' | 'count'>): Vec2[] {
  const s = fixtureSize(f);
  return furnitureCorners({ x: f.x, y: f.y, width: s.width, depth: s.depth, rotation: f.rotation });
}

export interface WallSnap {
  x: number;
  y: number;
  rotation: number;
  wallId: string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Nearest wall face for a fixture at `p` (within `maxDistance` of the wall centreline): the
 * fixture sits flat on the face on the side of `p`, its front facing into the room. Along the
 * wall it stays inside the wall's length. Null when no wall is near.
 */
export function snapFixtureToWall(d: Pick<Project, 'nodes' | 'walls'>, f: Pick<Fixture, 'kind' | 'width' | 'height' | 'count'>, p: Vec2, maxDistance = 0.6): WallSnap | null {
  const hit = closestWall(d, p, maxDistance);
  if (!hit || hit.length < 1e-6) return null;
  const a = d.nodes.find((n) => n.id === hit.wall.a)!;
  const b = d.nodes.find((n) => n.id === hit.wall.b)!;
  const dir = normalize(sub(b, a));
  const side = cross(dir, sub(p, a)) >= 0 ? 1 : -1;
  const n = scale(perp(dir), side);
  const size = fixtureSize(f);
  const half = Math.min(size.width / 2, hit.length / 2);
  const s = Math.max(half, Math.min(hit.length - half, hit.s));
  const onLine = lerp(a, b, s / hit.length);
  const c = add(onLine, scale(n, hit.wall.thickness / 2 + size.depth / 2));
  return { x: r3(c.x), y: r3(c.y), rotation: Math.atan2(-n.x, n.y), wallId: hit.wall.id };
}

/** Distance (m) of the fixture's back from the nearest wall face – 0 when it sits on a wall. */
export function fixtureWallGap(d: Pick<Project, 'nodes' | 'walls'>, f: Fixture): number | null {
  const snap = snapFixtureToWall(d, f, f, 1);
  return snap ? dist(snap, f) : null;
}

/** Furniture meant to stand at a water connection (sink, dishwasher, washbasin, WC, shower, washing machine …). */
export function usesWater(item: Pick<Furniture, 'category' | 'name' | 'kitchen'>): boolean {
  if (item.kitchen && (item.kitchen.type === 'sink' || item.kitchen.type === 'dishwasher')) return true;
  if (item.category === 'bathroom') return true;
  return /spül|wasch|wc|toilette|dusch|wanne|bidet|urinal|boiler|therme/i.test(item.name);
}

/** Area kept free in front of a connection (m): the box itself plus a hand's width. */
const ACCESS = 0.1;

/**
 * Water / waste-water connections an item covers (#81): its footprint overlaps the connection
 * plus a small access zone and it reaches the floor (wall cabinets above are fine). Items
 * that use water (sink, washbasin, WC …) belong there and are never marked.
 */
export function coveredConnections(p: Pick<Project, 'fixtures'>, item: Furniture): Fixture[] {
  if (!p.fixtures.length || !item.solid || item.category === 'textile' || usesWater(item)) return [];
  if (item.elevation > 0.4) return [];
  const fc = furnitureCorners(item);
  return p.fixtures.filter((f) => {
    if (!isWaterConnection(f.kind)) return false;
    const s = fixtureSize(f);
    const zone = furnitureCorners({ x: f.x, y: f.y, width: s.width + 2 * ACCESS, depth: s.depth + 2 * ACCESS, rotation: f.rotation });
    return footprintsOverlap(fc, zone, 1e-3) && item.elevation < fixtureCenterZ(f);
  });
}
