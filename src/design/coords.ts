/**
 * Coordinate conventions between the app and Claude (#436). The app works in plan coordinates
 * (metres, x east, y south). Claude reads and answers in room coordinates: whole cm from the
 * north-west corner of the room's bounding box (`RoomAnalysis.origin`), x to the east, y to the
 * south, and directions as compass sides N, O, S, W.
 */
import type { Vec2 } from '../model/vec';
import { rotationFacing } from '../suggest/roomGeometry';
import type { Side } from './types';

export const SIDES: readonly Side[] = ['N', 'O', 'S', 'W'];

/** Unit vector towards a side; north is at the top of the plan (−y). */
export const SIDE_VECTOR: Readonly<Record<Side, Vec2>> = { N: { x: 0, y: -1 }, O: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };

/** Plan point → room coordinates in whole cm. */
export function toRoomCm(origin: Vec2, p: Vec2): { x: number; y: number } {
  return { x: Math.round((p.x - origin.x) * 100), y: Math.round((p.y - origin.y) * 100) };
}

/** Room coordinates in cm → plan point. */
export function fromRoomCm(origin: Vec2, x: number, y: number): Vec2 {
  return { x: origin.x + x / 100, y: origin.y + y / 100 };
}

/** Side a direction points to; null when it is more than `tolDeg` off the nearest axis. */
export function sideOfVector(v: Vec2, tolDeg = 45): Side | null {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return null;
  let best: Side = 'N';
  let bestDot = -Infinity;
  for (const s of SIDES) {
    const d = (v.x * SIDE_VECTOR[s].x + v.y * SIDE_VECTOR[s].y) / len;
    if (d > bestDot) {
      bestDot = d;
      best = s;
    }
  }
  return Math.acos(Math.min(1, bestDot)) <= (tolDeg * Math.PI) / 180 + 1e-9 ? best : null;
}

/** Rotation of a piece whose front faces `side` (a sofa against the south wall faces N). */
export const rotationForSide = (side: Side): number => rotationFacing(SIDE_VECTOR[side]);

/** Side the front of a piece with this rotation faces, rounded to the nearest axis. */
export const sideOfRotation = (rotation: number): Side => sideOfVector({ x: -Math.sin(rotation), y: Math.cos(rotation) })!;

/**
 * Side of a wall, named after where it lies in the room: the room lies away from it, so the
 * inward normal of the north wall points south. Null for a wall more than `tolDeg` off the axes.
 */
export const wallSide = (inward: Vec2, tolDeg = 20): Side | null => sideOfVector({ x: -inward.x, y: -inward.y }, tolDeg);

const SIDE_WORDS: Record<string, Side> = {
  n: 'N',
  nord: 'N',
  norden: 'N',
  north: 'N',
  o: 'O',
  e: 'O',
  ost: 'O',
  osten: 'O',
  east: 'O',
  s: 'S',
  süd: 'S',
  sued: 'S',
  süden: 'S',
  sueden: 'S',
  south: 'S',
  w: 'W',
  west: 'W',
  westen: 'W',
};

/** A side as Claude may write it (N, O, E, Nord, Ost, east …, any case); null when unknown. */
export function parseSide(s: string): Side | null {
  return SIDE_WORDS[s.trim().toLowerCase()] ?? null;
}
