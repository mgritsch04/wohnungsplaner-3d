/**
 * Everything the solver keeps fixed about a room, prepared once from the stage-0 analysis:
 * walls, door swings, the free strips behind doors, the zones in front of windows, areas to
 * keep free, existing pieces and the walking grid.
 */
import { add, dot, scale, sub, type Vec2 } from '../../model/vec';
import { rotationFacing } from '../../suggest/roomGeometry';
import type { RoomAnalysis, Walkway, WallInfo, WallOpening } from '../types';
import { boxCorners, boxFromBack, type Box } from './geom';
import { WalkGrid } from './grid';
import { specOf, type Spec } from './items';
import type { CatalogItem } from '../../catalog/types';

/** An existing piece in the room (fitted bath, WC, existing kitchen): fixed obstacle and relation target. */
export interface FixedPiece {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  elevation?: number;
}

export interface FixedInfo {
  piece: FixedPiece;
  spec: Spec | undefined;
  box: Box;
  poly: Vec2[];
  /** Movement areas in front of it (WC, washbasin) that new pieces must leave free. */
  clear: Vec2[][];
  floor: boolean;
}

export interface WindowInfo {
  label: string;
  wall: number;
  t0: number;
  t1: number;
  sill: number;
  /** Strip in front of the window (0.5 m deep): nothing higher than the sill stands in it. */
  zone: Vec2[];
}

export interface DoorInfo {
  label: string;
  wall: number;
  opening: WallOpening;
  /** Middle of the opening on the wall face. */
  mid: Vec2;
  /** Strip right behind the opening that stays free of solid pieces (B5). */
  entry: Vec2[];
}

/** Depth of the free strip behind every door and passage. */
export const ENTRY_DEPTH = 0.5;
/** Depth of the strip in front of a window where nothing may be higher than the sill. */
export const WINDOW_DEPTH = 0.5;
/** Clear width a piece must be reachable with (B7): 50 cm. */
/** Extra distance of the walkways to placed pieces (m). */
export const WALK_PAD = 0.03;
export const REACH_RADIUS = 0.25;

export interface RoomCtx {
  analysis: RoomAnalysis;
  poly: Vec2[];
  walls: WallInfo[];
  wallIndex: Map<string, number>;
  height: number;
  doors: DoorInfo[];
  /** Areas door leaves sweep in this room, and the opened leaf itself with its handle. */
  swings: { label: string; poly: Vec2[] }[];
  /** Water and drain connections with a hand's width round them: no cabinet in front (#81). */
  connections: { id: string; poly: Vec2[] }[];
  windows: WindowInfo[];
  keepFree: { id: string; poly: Vec2[] }[];
  userZones: Map<string, Vec2[]>;
  fixed: FixedInfo[];
  fixedById: Map<string, FixedInfo>;
  walkways: Walkway[];
  /** Grid layers: one per walkway half width, the last one for reaching pieces. */
  grid: WalkGrid;
  walkLayers: Map<number, number>;
  reachLayer: number;
  catalog: CatalogItem[];
}

const pointOnWall = (w: WallInfo, t: number): Vec2 => add(w.a, scale(w.dir, t));

/** Half the leaf thickness (`DOOR_LEAF_THICKNESS`): the plan centres the opened leaf on hinge → tip. */
const LEAF_SIDE = 0.023;
/** Space kept free round a water or drain connection, as in the plan check (`coveredConnections`). */
const CONNECTION_ACCESS = 0.1;

/**
 * The opened door leaf: it stands along hinge → open tip and reaches beyond the swept quarter
 * circle by half its thickness. `swing` is [hinge, closed tip, …, open tip].
 */
export function leafStrip(swing: Vec2[]): Vec2[] {
  const hinge = swing[0];
  const open = swing[swing.length - 1];
  const closed = swing[1];
  const len = Math.hypot(closed.x - hinge.x, closed.y - hinge.y) || 1;
  const away = { x: ((hinge.x - closed.x) / len) * LEAF_SIDE, y: ((hinge.y - closed.y) / len) * LEAF_SIDE };
  return [hinge, open, add(open, away), add(hinge, away)];
}

/** Area round a water or drain connection on a wall (or round the point when it is off the walls). */
function connectionArea(f: RoomAnalysis['fixtures'][number], w: WallInfo | undefined): Vec2[] {
  const hw = f.width / 2 + CONNECTION_ACCESS;
  const dir = w?.dir ?? { x: 1, y: 0 };
  const inward = w?.inward ?? { x: 0, y: 1 };
  const base = w ? pointOnWall(w, f.t) : add(f.p, scale(inward, -CONNECTION_ACCESS));
  const depth = 0.08 + 2 * CONNECTION_ACCESS;
  const a = add(base, scale(dir, -hw));
  const b = add(base, scale(dir, hw));
  return [a, b, add(b, scale(inward, depth)), add(a, scale(inward, depth))];
}

/** Rectangle on the room side of a wall stretch, `depth` deep. */
export function wallStrip(w: WallInfo, t0: number, t1: number, depth: number): Vec2[] {
  const a = pointOnWall(w, t0);
  const b = pointOnWall(w, t1);
  return [a, b, add(b, scale(w.inward, depth)), add(a, scale(w.inward, depth))];
}

export function buildRoom(analysis: RoomAnalysis, existing: FixedPiece[], catalog: CatalogItem[]): RoomCtx {
  const walls = analysis.walls;
  const wallIndex = new Map(walls.map((w, i) => [w.id, i]));
  const doors: DoorInfo[] = [];
  const windows: WindowInfo[] = [];
  const solid: [Vec2, Vec2][] = [];
  const swings: { label: string; poly: Vec2[] }[] = [];
  walls.forEach((w, wi) => {
    // the wall face minus its doors, passages and glazed doors: what a person cannot walk through
    const gaps: { t0: number; t1: number }[] = [];
    for (const o of w.openings) {
      if (o.swingsIn && o.swing?.length) swings.push({ label: o.id, poly: o.swing }, { label: o.id, poly: leafStrip(o.swing) });
      if (o.passable) {
        gaps.push(o);
        const mid = pointOnWall(w, (o.t0 + o.t1) / 2);
        doors.push({ label: o.id, wall: wi, opening: o, mid, entry: wallStrip(w, o.t0, o.t1, ENTRY_DEPTH) });
      } else {
        if (o.kind === 'window') windows.push({ label: o.id, wall: wi, t0: o.t0, t1: o.t1, sill: o.sill ?? 0.9, zone: wallStrip(w, o.t0, o.t1, WINDOW_DEPTH) });
      }
    }
    gaps.sort((p, q) => p.t0 - q.t0);
    let t = 0;
    for (const g of gaps) {
      if (g.t0 > t + 1e-6) solid.push([pointOnWall(w, t), pointOnWall(w, g.t0)]);
      t = Math.max(t, g.t1);
    }
    if (w.length > t + 1e-6) solid.push([pointOnWall(w, t), w.b]);
  });
  const fixed: FixedInfo[] = existing.map((piece) => {
    const spec = specOf(piece.catalogId, catalog);
    const box: Box = { x: piece.x, y: piece.y, hw: piece.width / 2, hd: piece.depth / 2, rotation: piece.rotation };
    const floor = (piece.elevation ?? 0) < 0.3 && (spec ? spec.base === 'floor' || spec.item.kitchen?.type === 'countertop' : true);
    const clear = (spec?.clear ?? []).filter((c) => c.side === 'front').map((c) => frontStrip(box, c.min));
    return { piece, spec, box, poly: boxCorners(box), clear, floor };
  });
  const widths = [...new Set(analysis.walkways.map((w) => w.width))].sort((a, b) => a - b);
  const radii = [...widths.map((w) => w / 2), REACH_RADIUS];
  const walkLayers = new Map(widths.map((w, i) => [w, i]));
  const grid = new WalkGrid(
    analysis.polygon,
    solid,
    fixed.filter((f) => f.floor).map((f) => f.box),
    radii,
    // the check of stage 0 measures on 5 cm cells and may find a few cm less: keep that much more
    [...widths.map(() => WALK_PAD), 0],
  );
  return {
    analysis,
    poly: analysis.polygon,
    walls,
    wallIndex,
    height: analysis.height,
    doors,
    swings,
    connections: analysis.fixtures.filter((f) => f.kind === 'water' || f.kind === 'drain').map((f) => ({ id: f.id, poly: connectionArea(f, f.wall ? walls[wallIndex.get(f.wall)!] : undefined) })),
    windows,
    keepFree: analysis.userZones.filter((z) => z.keepFree).map((z) => ({ id: z.id, poly: z.points })),
    userZones: new Map(analysis.userZones.map((z) => [z.id, z.points])),
    fixed,
    fixedById: new Map(fixed.map((f) => [f.piece.id, f])),
    walkways: analysis.walkways,
    grid,
    walkLayers,
    reachLayer: radii.length - 1,
    catalog,
  };
}

/** Strip in front of a box, `depth` deep, over the part [from, to] of its width. */
export function frontStrip(b: Box, depth: number, from = 0, to = 1): Vec2[] {
  return sideStrip(b, 'front', depth, from, to);
}

/** Strip on one side of a box. Fractions run from the left (front/back) or from the back (left/right). */
export function sideStrip(b: Box, side: 'front' | 'back' | 'left' | 'right', depth: number, from = 0, to = 1): Vec2[] {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const ax = { x: c, y: s };
  const fy = { x: -s, y: c };
  const at = (u: number, v: number): Vec2 => ({ x: b.x + ax.x * u + fy.x * v, y: b.y + ax.y * u + fy.y * v });
  if (side === 'front' || side === 'back') {
    const sign = side === 'front' ? 1 : -1;
    const u0 = -b.hw + 2 * b.hw * from;
    const u1 = -b.hw + 2 * b.hw * to;
    return [at(u0, sign * b.hd), at(u1, sign * b.hd), at(u1, sign * (b.hd + depth)), at(u0, sign * (b.hd + depth))];
  }
  const sign = side === 'left' ? 1 : -1;
  const v0 = -b.hd + 2 * b.hd * from;
  const v1 = -b.hd + 2 * b.hd * to;
  return [at(sign * b.hw, v0), at(sign * b.hw, v1), at(sign * (b.hw + depth), v1), at(sign * (b.hw + depth), v0)];
}

/** Seed point of a door on a grid layer: in the room, half a width in front of the opening. */
export function doorSeed(ctx: RoomCtx, door: DoorInfo, radius: number): Vec2 {
  const w = ctx.walls[door.wall];
  return add(door.mid, scale(w.inward, radius + 0.05));
}

/** Box of a piece with its back against wall `w`, centred at `t` along it. */
export function boxOnWall(w: WallInfo, t: number, width: number, depth: number, gap = 0.005): Box {
  const back = add(pointOnWall(w, t), scale(w.inward, gap));
  return boxFromBack(back, rotationFacing(w.inward), width, depth);
}

/** Position of a point along a wall (projection, m from its start). */
export const alongWall = (w: WallInfo, p: Vec2): number => dot(sub(p, w.a), w.dir);
/** Distance of a point from the wall line, positive into the room. */
export const offWall = (w: WallInfo, p: Vec2): number => dot(sub(p, w.a), w.inward);

export { pointOnWall };
