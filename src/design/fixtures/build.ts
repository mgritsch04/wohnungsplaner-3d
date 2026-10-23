/**
 * Builder for the invented test flats (#436): outer walls, rooms from centreline polygons,
 * doors that swing into a given room, windows, existing sanitary objects and kitchens, marked
 * zones and stable ids (the same flat gives the same JSON every time).
 */
import { findCatalogItem } from '../../catalog/generic';
import { createFurnitureFromCatalog } from '../../catalog/instantiate';
import { generateCountertops, placeKitchenRunReport, usableFaceRange } from '../../kitchen/kitchen';
import { derivePlan } from '../../model/derived';
import { createEmptyProject } from '../../model/factory';
import { addOpening, addPolygonRoom, closestWall, insertWall, type WallProps } from '../../model/operations';
import type { Opening, OpeningKind, Project } from '../../model/schema';
import { boundsOf, dot, normalize, perp, sub, type Vec2 } from '../../model/vec';
import { rectPoints } from '../../model/zones';
import { rotationForSide } from '../coords';
import type { Side } from '../types';

export type P = [number, number];

const v = ([x, y]: P): Vec2 => ({ x, y });

export const newFlat = (name: string): Project => createEmptyProject(name);

/** Outer walls along a closed centreline (usually thicker than the inner walls); add them before the rooms. */
export function outline(p: Project, pts: P[], props: WallProps) {
  pts.forEach((a, i) => insertWall(p, v(a), v(pts[(i + 1) % pts.length]), props));
}

/** Single wall, e.g. the full-height side walls of a loggia. */
export const wall = (p: Project, a: P, b: P, props: WallProps) => insertWall(p, v(a), v(b), props);

export const room = (p: Project, name: string, pts: P[], props: WallProps) => addPolygonRoom(p, pts.map(v), name, props);

/** Opening at a point on a wall centreline; a door's leaf swings towards `into` (a point in the room it opens into). */
export function opening(p: Project, kind: OpeningKind, at: P, width: number, into?: P, extra: Partial<Opening> = {}): string {
  const hit = closestWall(p, v(at), 0.05);
  if (!hit) throw new Error(`keine Wand bei ${at}`);
  const a = p.nodes.find((n) => n.id === hit.wall.a)!;
  const b = p.nodes.find((n) => n.id === hit.wall.b)!;
  let swing: 'left' | 'right' = 'left';
  if (into) swing = dot(perp(normalize(sub(b, a))), sub(v(into), v(at))) >= 0 ? 'left' : 'right';
  const id = addOpening(p, hit.wall.id, kind, hit.s, { width, swing, ...(kind === 'window' ? { sillHeight: 0.9, height: 1.4 } : {}), ...extra });
  if (!id) throw new Error(`Öffnung bei ${at} nicht möglich`);
  return id;
}

export const door = (p: Project, at: P, width: number, into: P, extra: Partial<Opening> = {}) => opening(p, 'door', at, width, into, extra);
export const passage = (p: Project, at: P, width: number) => opening(p, 'passage', at, width);
export const window = (p: Project, at: P, width: number, extra: Partial<Opening> = {}) => opening(p, 'window', at, width, undefined, extra);

function existing(p: Project, catalogId: string, x: number, y: number, rotation: number) {
  const item = findCatalogItem(catalogId);
  if (!item) throw new Error(`Katalogeintrag ${catalogId} fehlt`);
  const f = createFurnitureFromCatalog(item, { x, y, rotation });
  f.existing = true;
  p.furniture.push(f);
}

/** Existing piece (fitted bath, WC) at a plan position. */
export const fixtureAt = (p: Project, catalogId: string, x: number, y: number, rotation: number) => existing(p, catalogId, x, y, rotation);

/**
 * Existing piece with its back against a wall of a room, front into the room. `along` is the
 * centre along that wall in plan coordinates (x for a north or south wall, y for a west or
 * east wall), or 'start'/'end' for the corner at the smaller or larger coordinate.
 */
export function fixture(p: Project, roomName: string, catalogId: string, side: Side, along: number | 'start' | 'end') {
  const item = findCatalogItem(catalogId);
  const r = p.rooms.find((x) => x.name === roomName);
  if (!item || !r) throw new Error(`${catalogId} oder Raum ${roomName} fehlt`);
  const g = derivePlan(p).rooms.get(r.id);
  const bb = g && boundsOf(g.interior);
  if (!bb) throw new Error(`Raum ${roomName} hat keine Fläche`);
  const gap = 0.002;
  const horizontal = side === 'N' || side === 'S';
  const [lo, hi] = horizontal ? [bb.minX, bb.maxX] : [bb.minY, bb.maxY];
  const c = along === 'start' ? lo + item.width / 2 + gap : along === 'end' ? hi - item.width / 2 - gap : along;
  const back = { N: bb.minY + item.depth / 2 + gap, S: bb.maxY - item.depth / 2 - gap, W: bb.minX + item.depth / 2 + gap, O: bb.maxX - item.depth / 2 - gap }[side];
  const facing: Side = ({ N: 'S', S: 'N', W: 'O', O: 'W' } as const)[side];
  existing(p, catalogId, horizontal ? c : back, horizontal ? back : c, rotationForSide(facing));
}

/**
 * Existing kitchen run (fitted kitchen of a new flat) on the wall at `wallAt`, facing the room
 * around `roomAt`, starting at the corner nearest `startAt`. `groups` lists the modules from the
 * start; a wall cabinet, hood or cooktop goes in front of the floor module it hangs above.
 */
export function existingKitchen(p: Project, wallAt: P, roomAt: P, startAt: P, groups: string[][]) {
  const hit = closestWall(p, v(wallAt), 0.05);
  if (!hit) throw new Error(`keine Wand bei ${wallAt}`);
  const d = derivePlan(p);
  const fp = d.footprints.get(hit.wall.id)!;
  const side: 1 | -1 = dot(fp.normal, sub(v(roomAt), v(wallAt))) >= 0 ? 1 : -1;
  const range = usableFaceRange(d, hit.wall.id, side)!;
  const fromA = dot(sub(v(startAt), fp.a), fp.dir) < fp.length / 2;
  const floorWidth = groups.flat().reduce((s, id) => s + (isAbove(id) ? 0 : findCatalogItem(id)!.width), 0);
  const modules = (fromA ? groups : [...groups].reverse()).flat().map((catalogId) => ({ catalogId }));
  const start = fromA ? 0 : range.s1 - range.s0 - floorWidth;
  const before = new Set(p.furniture.map((f) => f.id));
  const { skipped } = placeKitchenRunReport(p, { wallId: hit.wall.id, side, start, modules });
  if (skipped.length) throw new Error(`Küche passt nicht: ${skipped.map((s) => `${s.name} ${s.problem}`).join(', ')}`);
  generateCountertops(p);
  for (const f of p.furniture) if (!before.has(f.id) && f.kitchen) f.existing = true;
}

const isAbove = (id: string) => ['wall', 'hood', 'cooktop'].includes(findCatalogItem(id)?.kitchen?.type ?? '');

/** Area the user marked with a purpose (#416), as an axis-aligned rectangle. */
export function zone(p: Project, purpose: string, a: P, b: P) {
  p.zones.push({ id: `zone_${p.zones.length + 1}`, purpose, points: rectPoints(v(a), v(b)) });
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Readable, stable ids (room_a_wohnzimmer, wall_a007 …) and fixed dates, so a flat always gives the same JSON. */
export function finish(p: Project, key: string): Project {
  const k = key.toLowerCase();
  const map = new Map<string, string>();
  const number = (prefix: string, list: { id: string }[]) => list.forEach((x, i) => map.set(x.id, `${prefix}_${k}${String(i + 1).padStart(3, '0')}`));
  number('node', p.nodes);
  number('wall', p.walls);
  number('item', p.furniture);
  number('zone', p.zones);
  number('group', p.groups);
  for (const kind of ['door', 'window', 'passage'] as const) number(kind === 'window' ? 'win' : kind === 'door' ? 'door' : 'pass', p.openings.filter((o) => o.kind === kind));
  for (const r of p.rooms) map.set(r.id, `room_${k}_${slug(r.name)}`);
  const m = (id: string) => map.get(id) ?? id;
  for (const n of p.nodes) n.id = m(n.id);
  for (const w of p.walls) Object.assign(w, { id: m(w.id), a: m(w.a), b: m(w.b) });
  for (const o of p.openings) Object.assign(o, { id: m(o.id), wallId: m(o.wallId) });
  for (const r of p.rooms) Object.assign(r, { id: m(r.id), nodeIds: r.nodeIds.map(m) });
  for (const f of p.furniture) Object.assign(f, { id: m(f.id), ...(f.groupId ? { groupId: m(f.groupId) } : {}) });
  for (const z of p.zones) z.id = m(z.id);
  for (const g of p.groups) g.id = m(g.id);
  p.id = `proj_test_${k}`;
  p.createdAt = p.updatedAt = '2026-10-23T00:00:00.000Z';
  return p;
}
