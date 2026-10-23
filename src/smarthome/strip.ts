import type { Project, SmartDevice } from '../model/schema';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import type { Segment } from '../model/visibility';
import type { Vec2 } from '../model/vec';
import type { EntityState } from './simulation';

/** LED strips (#238): geometry, colour and snapping – pure helpers, no store access. */

export const STRIP_DIRECTIONS = { down: 'nach unten', back: 'nach hinten zur Wand', up: 'nach oben (Voute)' } as const;
/** a strip snaps to a wall face / furniture edge closer than this (m) */
export const SNAP_M = 0.15;
const DEFAULT_KELVIN = 2700;

/** Path of a strip; a strip without stored points is a 1 m line from its position. */
export function stripPoints(d: Pick<SmartDevice, 'x' | 'y' | 'points'>): Vec2[] {
  return d.points && d.points.length >= 2 ? d.points : [{ x: d.x, y: d.y }, { x: d.x + 1, y: d.y }];
}

export function stripLengthM(points: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

/** "2,4 m" */
export const formatLength = (m: number) => `${m.toFixed(m < 10 ? 2 : 1).replace('.', ',')} m`;

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** Colour temperature → #rrggbb (Tanner Helland's approximation of a black body). */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(10000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Colour a strip shines in: set by a rule (simulation), else its planned colour, else warm white. */
export function stripColor(d: Pick<SmartDevice, 'color' | 'kelvin'>, e?: Pick<EntityState, 'color'>): string {
  return e?.color ?? d.color ?? kelvinToHex(d.kelvin ?? DEFAULT_KELVIN);
}

/** Closest point of segment a→b to p. */
function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Snap `p` to the nearest wall face or furniture edge within SNAP_M (a strip under a
 * cabinet or along a wall locks in); returns `p` unchanged when nothing is near.
 */
export function snapToEdges(p: Vec2, project: Pick<Project, 'furniture'>, wallFaces: readonly Segment[]): Vec2 {
  let best: Vec2 | null = null;
  let bestD = SNAP_M;
  const test = (a: Vec2, b: Vec2) => {
    const c = closestOnSegment(p, a, b);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  };
  for (const s of wallFaces) test(s.a, s.b);
  for (const f of project.furniture) {
    const c = furnitureCorners(f);
    for (let i = 0; i < c.length; i++) test(c[i], c[(i + 1) % c.length]);
  }
  return best ?? p;
}
