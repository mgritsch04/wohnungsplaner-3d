/**
 * Tools for the tests of the walk-through (#441): a rectangular room with doors and windows as
 * `RoomAnalysis`, and a way to put catalogue pieces into it.
 */
import { findCatalogItem } from '../../catalog/generic';
import type { Vec2 } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import { rotationForSide } from '../coords';
import type { Layout, PlacedItem, RoomAnalysis, Side, WallInfo, WallOpening, Walkway } from '../types';
import { reviewRoom, type ReviewInput, type ReviewOptions } from './index';
import type { RoomProgram } from '../types';

type WallSide = 'N' | 'O' | 'S' | 'W';

export interface DoorSpec {
  wall: WallSide;
  /** Centre along the wall in the walking direction of W1…W4 (m from its start). */
  at: number;
  width?: number;
  /** Door leaf swings into the room (default true); false = passage or outward door. */
  swingsIn?: boolean;
  kind?: 'door' | 'passage';
}
export interface WindowSpec {
  wall: WallSide;
  at: number;
  width?: number;
  sill?: number;
}

const WALL_ORDER: WallSide[] = ['N', 'O', 'S', 'W'];

function swingPolygon(hinge: Vec2, along: Vec2, inward: Vec2, r: number): Vec2[] {
  const arc = Array.from({ length: 9 }, (_, k) => {
    const a = (k / 8) * (Math.PI / 2);
    return { x: hinge.x + along.x * r * Math.cos(a) + inward.x * r * Math.sin(a), y: hinge.y + along.y * r * Math.cos(a) + inward.y * r * Math.sin(a) };
  });
  return [hinge, ...arc];
}

/** Rectangular room from (0,0) to (w,d) with W1 north, W2 east, W3 south, W4 west. */
export function rectRoom(w: number, d: number, opts: { doors?: DoorSpec[]; windows?: DoorSpec[] | WindowSpec[]; name?: string; id?: string; passThrough?: boolean; entrance?: boolean; existing?: string[]; height?: number; walkwayWidth?: number } = {}): RoomAnalysis {
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  const dirs: Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const inw: Vec2[] = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];
  const sideOf: Side[] = ['N', 'O', 'S', 'W'];
  const lens = [w, d, w, d];
  let doorNo = 0;
  let winNo = 0;
  const walls: WallInfo[] = WALL_ORDER.map((ws, i) => {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const openings: WallOpening[] = [];
    for (const dd of (opts.doors ?? []).filter((x) => x.wall === ws)) {
      const width = dd.width ?? 0.9;
      const t0 = dd.at - width / 2;
      const hinge = { x: a.x + dirs[i].x * t0, y: a.y + dirs[i].y * t0 };
      const swingsIn = dd.swingsIn ?? (dd.kind !== 'passage');
      doorNo++;
      openings.push({
        id: `T${doorNo}`,
        openingId: `op_t${doorNo}`,
        kind: dd.kind ?? 'door',
        t0,
        t1: dd.at + width / 2,
        toRoomId: doorNo === 1 ? null : `room_other${doorNo}`,
        swingsIn,
        swing: swingsIn && (dd.kind ?? 'door') === 'door' ? swingPolygon(hinge, dirs[i], inw[i], width) : undefined,
      });
    }
    for (const ww of ((opts.windows ?? []) as WindowSpec[]).filter((x) => x.wall === ws)) {
      const width = ww.width ?? 1.2;
      winNo++;
      openings.push({ id: `F${winNo}`, openingId: `op_f${winNo}`, kind: 'window', t0: ww.at - width / 2, t1: ww.at + width / 2, toRoomId: null, sill: ww.sill ?? 0.9, top: 2.2 });
    }
    openings.sort((p, q) => p.t0 - q.t0);
    return { id: `W${i + 1}`, side: sideOf[i], a, b, dir: dirs[i], inward: inw[i], length: lens[i], openings, free: [{ t0: 0, t1: lens[i] }] };
  });
  // numbering in wall order: doors T1… and windows F1… must follow the walls
  const doors = walls.flatMap((x) => x.openings.filter((o) => o.kind !== 'window'));
  const wins = walls.flatMap((x) => x.openings.filter((o) => o.kind === 'window'));
  doors.forEach((o, k) => {
    o.id = `T${k + 1}`;
    o.openingId = `op_t${k + 1}`;
    o.toRoomId = k === 0 ? null : `room_other${k + 1}`;
  });
  wins.forEach((o, k) => {
    o.id = `F${k + 1}`;
    o.openingId = `op_f${k + 1}`;
  });
  const entry = (o: WallOpening, wall: WallInfo): Vec2 => ({
    x: wall.a.x + wall.dir.x * ((o.t0 + o.t1) / 2) + wall.inward.x * 0.5,
    y: wall.a.y + wall.dir.y * ((o.t0 + o.t1) / 2) + wall.inward.y * 0.5,
  });
  const doorList = walls.flatMap((wall) => wall.openings.filter((o) => o.kind !== 'window').map((o) => ({ o, wall })));
  const walkways: Walkway[] = [];
  for (let i = 0; i < doorList.length; i++)
    for (let k = i + 1; k < doorList.length; k++) {
      const p = entry(doorList[i].o, doorList[i].wall);
      const q = entry(doorList[k].o, doorList[k].wall);
      walkways.push({ from: doorList[i].o.id, to: doorList[k].o.id, path: [p, q], length: Math.hypot(p.x - q.x, p.y - q.y), width: opts.walkwayWidth ?? (opts.passThrough ? 0.9 : 0.7), main: !!opts.passThrough });
    }
  return {
    roomId: opts.id ?? 'room_test',
    name: opts.name ?? 'Testraum',
    area: w * d,
    polygon: corners,
    origin: { x: 0, y: 0 },
    size: { x: w, y: d },
    height: opts.height ?? 2.6,
    walls,
    corners: corners.map((p, i) => ({ id: `E${i + 1}`, p, walls: [`W${i + 1}`, `W${((i + 1) % 4) + 1}`] as [string, string], reflex: false, doorDist: 1, windowDist: 1 })),
    walkways,
    passThrough: !!opts.passThrough,
    entrance: opts.entrance ?? true,
    mainDoor: doorList.length ? doorList[0].o.id : null,
    existing: opts.existing ?? [],
    userZones: [],
  };
}

export interface Put {
  /** Centre. */
  x: number;
  y: number;
  /** Side the front points to. */
  face?: Side;
  rotation?: number;
  id?: string;
  zone?: string;
  elevation?: number;
  parent?: string;
  width?: number;
  depth?: number;
  height?: number;
}

let counter = 0;

/** A catalogue piece as placed item. */
export function put(catalogId: string, at: Put): PlacedItem {
  const c = findCatalogItem(catalogId);
  if (!c) throw new Error(`unknown catalogue id ${catalogId}`);
  counter++;
  return {
    id: at.id ?? `${catalogId.replace('generic-', '')}_${counter}`,
    catalogId,
    zone: at.zone ?? 'z',
    x: at.x,
    y: at.y,
    rotation: at.rotation ?? (at.face ? rotationForSide(at.face) : 0),
    elevation: at.elevation ?? c.elevation ?? 0,
    width: at.width ?? c.width,
    depth: at.depth ?? c.depth,
    height: at.height ?? c.height,
    parent: at.parent,
  };
}

export const layoutOf = (roomId: string, items: PlacedItem[]): Layout => ({ roomId, items, dropped: [], cost: 0, unsolved: [], seed: 1 });

export interface Scenario {
  room: RoomAnalysis;
  type: RoomType;
  items: PlacedItem[];
  existing?: PlacedItem[];
  program?: RoomProgram;
  palette?: string[];
  options?: ReviewOptions;
  dropped?: Layout['dropped'];
}

export function review(s: Scenario) {
  const layout = layoutOf(s.room.roomId, s.items);
  layout.dropped = s.dropped ?? [];
  const input: ReviewInput = { analysis: s.room, type: s.type, layout, existing: s.existing, program: s.program, palette: s.palette, options: s.options };
  return reviewRoom(input);
}

/** Rule ids of all findings, optionally of one severity. */
export const rulesOf = (r: ReturnType<typeof review>, severity?: 'S' | 'M' | 'L'): string[] => r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.rule);
