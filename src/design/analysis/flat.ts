/**
 * Stage 0, read the flat (#438): every room with its walls, openings, corners and ways, how the
 * rooms connect, where one comes in and which rooms one walks through to reach others.
 */
import { derivePlan, type DerivedPlan } from '../../model/derived';
import { furnitureFootprint, isPassageObstacle } from '../../model/passages';
import type { Project } from '../../model/schema';
import { add, dot, pointInPolygon, scale, sub, type Vec2 } from '../../model/vec';
import { isKeepFree, zoneLabels, zonesInRoom } from '../../model/zones';
import { guessRoomType } from '../../suggest/furnishing';
import type { FlatAnalysis, RoomAnalysis, RoomLink, UserZone, WallInfo, WallOpening, Walkway } from '../types';
import { wallOutline } from './outline';
import { widestRoute, walkGrid, wayEnds } from './walk';
import { roomFixtures, roomWalls } from './walls';

/** Clear width of the ways in halls and pass-through rooms, and elsewhere (m). */
export const WAY_WIDTH = { main: 0.9, other: 0.7 };

/** Up to this many doors a room gets a way between every two of them. */
const MAX_ALL_PAIRS = 4;

const openingsOf = (walls: WallInfo[]) => walls.flatMap((w) => w.openings);

/** First wall hit by a ray from `p` along `dir`. */
function wallAhead(walls: WallInfo[], p: Vec2, dir: Vec2): string | null {
  let best: { id: string; t: number } | null = null;
  for (const w of walls) {
    const denom = dot(dir, w.inward);
    if (denom >= -1e-9) continue; // the ray must run towards the wall face
    const t = dot(sub(w.a, p), w.inward) / denom;
    const s = dot(sub(add(p, scale(dir, t)), w.a), w.dir);
    if (t > 0 && s >= -0.01 && s <= w.length + 0.01 && (!best || t < best.t)) best = { id: w.id, t };
  }
  return best?.id ?? null;
}

export function analyzeFlat(project: Project, d: DerivedPlan = derivePlan(project)): FlatAnalysis {
  const outlines = new Map<string, Vec2[]>();
  for (const r of project.rooms) {
    const g = d.rooms.get(r.id);
    if (g && g.interior.length >= 3) outlines.set(r.id, wallOutline(g.interior));
  }
  const walls = new Map([...outlines].map(([id, outline]) => [id, roomWalls(project, d, id, outline, outlines)]));

  // links between rooms through passable openings, once per opening
  const links: RoomLink[] = [];
  for (const [a, rw] of walls)
    for (const o of openingsOf(rw.walls)) {
      if (!o.passable || !o.toRoomId || links.some((l) => l.a === o.toRoomId && l.b === a && openingId(l, walls) === o.openingId)) continue;
      const other = walls.get(o.toRoomId) && openingsOf(walls.get(o.toRoomId)!.walls).find((x) => x.openingId === o.openingId);
      if (!other) continue;
      links.push({ a, b: o.toRoomId, openingA: o.id, openingB: other.id, kind: o.kind === 'passage' ? 'passage' : 'door' });
    }

  // the entrance: a door to the outside; with several, the one of a hall, else of the room with the most doors
  const outside: { roomId: string; o: WallOpening }[] = [];
  for (const [roomId, rw] of walls) for (const o of openingsOf(rw.walls)) if (o.passable && !o.toRoomId) outside.push({ roomId, o });
  const doorCount = (id: string) => openingsOf(walls.get(id)!.walls).filter((o) => o.passable).length;
  const nameOf = (id: string) => project.rooms.find((r) => r.id === id)!.name;
  const entranceDoor =
    [...outside].sort(
      (x, y) =>
        Number(y.o.kind === 'door') - Number(x.o.kind === 'door') ||
        Number(guessRoomType(nameOf(y.roomId)) === 'hall') - Number(guessRoomType(nameOf(x.roomId)) === 'hall') ||
        doorCount(y.roomId) - doorCount(x.roomId),
    )[0] ?? null;
  const entranceRoomId = entranceDoor?.roomId ?? null;

  // steps from the entrance; a room lies on a shortest route to another room when a neighbour is one step further
  const steps = new Map<string, number>();
  if (entranceRoomId) {
    steps.set(entranceRoomId, 0);
    for (const queue = [entranceRoomId]; queue.length; ) {
      const r = queue.shift()!;
      for (const l of links) {
        const next = l.a === r ? l.b : l.b === r ? l.a : null;
        if (next && !steps.has(next)) {
          steps.set(next, steps.get(r)! + 1);
          queue.push(next);
        }
      }
    }
  }
  /** Rooms behind the openings of a room, with the label in this room. */
  const neighbours = (id: string) => links.flatMap((l) => (l.a === id ? [{ room: l.b, label: l.openingA }] : l.b === id ? [{ room: l.a, label: l.openingB }] : []));
  const further = (id: string) => neighbours(id).filter((n) => steps.has(id) && steps.get(n.room) === steps.get(id)! + 1);

  const rooms: RoomAnalysis[] = [];
  for (const r of project.rooms) {
    const outline = outlines.get(r.id);
    const rw = walls.get(r.id);
    const g = d.rooms.get(r.id);
    if (!outline || !rw || !g) continue;
    const notes: string[] = [];
    const typeFromName = guessRoomType(r.name);
    const passThrough = further(r.id).length > 0;
    const entrance = r.id === entranceRoomId;
    const passable = openingsOf(rw.walls).filter((o) => o.passable);
    const back = neighbours(r.id).find((n) => steps.has(r.id) && steps.get(n.room) === steps.get(r.id)! - 1);
    const mainDoor = entrance ? entranceDoor!.o.id : (back?.label ?? passable[0]?.id ?? null);
    const onward = new Set(further(r.id).map((n) => n.label));

    // ways between all passable openings in the empty room (existing pieces block)
    const width = typeFromName === 'hall' || passThrough ? WAY_WIDTH.main : WAY_WIDTH.other;
    const existing = project.furniture.filter((f) => f.existing && pointInPolygon(f, outline));
    const grid = walkGrid(outline, existing.filter(isPassageObstacle).map(furnitureFootprint));
    const ends = wayEnds(rw);
    // every pair of openings; with more than four (a hall), from the main door to each other one:
    // when those stay free, every door still reaches every other one
    const pairs: [string, string][] = [];
    const hub = passable.find((o) => o.id === mainDoor) ?? passable[0];
    for (let i = 0; i < passable.length; i++)
      for (let k = i + 1; k < passable.length; k++) if (passable.length <= MAX_ALL_PAIRS || passable[i] === hub || passable[k] === hub) pairs.push([passable[i].id, passable[k].id]);
    const walkways: Walkway[] = [];
    for (const [from, to] of pairs) {
      const route = widestRoute(grid, ends.get(from)!, ends.get(to)!, width);
      if (!route) {
        notes.push(`Kein Weg von ${from} nach ${to}, auch nicht 50 cm breit.`);
        continue;
      }
      if (route.width < width) notes.push(`Weg ${from}–${to} ist schon leer nur ${Math.round(route.width * 100)} cm breit.`);
      const main = (from === mainDoor && onward.has(to)) || (to === mainDoor && onward.has(from));
      walkways.push({ from, to, path: route.path, length: route.length, width: route.width, main });
    }

    let entryView: RoomAnalysis['entryView'] = null;
    const door = rw.walls.find((w) => w.openings.some((o) => o.id === mainDoor));
    if (door && mainDoor) {
      const o = door.openings.find((x) => x.id === mainDoor)!;
      const at = add(add(door.a, scale(door.dir, (o.t0 + o.t1) / 2)), scale(door.inward, 0.5));
      entryView = { door: mainDoor, at, dir: door.inward, wall: wallAhead(rw.walls, at, door.inward) };
    }

    const labels = zoneLabels(project.zones);
    const userZones: UserZone[] = zonesInRoom(project, d, r.id).map((z) => ({ id: labels.get(z.id)!, zoneId: z.id, purpose: z.purpose, points: z.points, keepFree: isKeepFree(z.purpose) }));

    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const origin = { x: Math.min(...xs), y: Math.min(...ys) };
    rooms.push({
      roomId: r.id,
      name: r.name,
      area: g.area,
      polygon: outline,
      origin,
      size: { x: Math.max(...xs) - origin.x, y: Math.max(...ys) - origin.y },
      height: Math.max(0, ...rw.walls.map((w) => w.height)),
      walls: rw.walls,
      corners: rw.corners,
      walkways,
      passThrough,
      entrance,
      mainDoor,
      entryView,
      typeFromName,
      existing: existing.map((f) => f.id),
      userZones,
      fixtures: roomFixtures(project, outline, rw.walls),
      notes,
    });
  }
  return { rooms, links, entranceRoomId };
}

function openingId(l: RoomLink, walls: Map<string, { walls: WallInfo[] }>): string | undefined {
  return openingsOf(walls.get(l.a)!.walls).find((o) => o.id === l.openingA)?.openingId;
}
