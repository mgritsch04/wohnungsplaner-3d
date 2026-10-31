/**
 * Rundgang (guided tour)
 * ----------------------
 * `planTour` builds an automatic first-person walk through all reachable rooms of the active
 * storey: start in the first room, then always to the nearest unvisited room; in every room the
 * camera stops at the most open spot and looks around once. Routes use `shortestWalkPath`
 * (open doors and passages only – a room behind a closed door is skipped and reported).
 * `tourPoseAt` turns the plan into a camera pose for any time `t` (pure, no animation state).
 */
import type { DerivedPlan } from './derived';
import { furnitureFootprint, isPassageObstacle } from './passages';
import type { Project } from './schema';
import { shortestWalkPath } from './walkPath';
import { closestPointOnSegment, dist, pointInPolygon, type Vec2 } from './vec';

export interface TourStop {
  roomId: string;
  name: string;
  /** Where the camera stops to look around. */
  stand: Vec2;
  /** Walk from the previous stop (starts at the previous stand point); empty for the first stop. */
  path: Vec2[];
  /** Length of the look-around in seconds. */
  lookSeconds: number;
}

export interface TourPlan {
  stops: TourStop[];
  /** Rooms left out (closed door, no free spot) – names. */
  skipped: string[];
  segments: TourSegment[];
  duration: number;
}

export type TourSegment =
  | { kind: 'walk'; t0: number; dur: number; pts: Vec2[]; len: number; stop: number }
  | { kind: 'turn'; t0: number; dur: number; at: Vec2; from: number; to: number; stop: number }
  | { kind: 'look'; t0: number; dur: number; at: Vec2; yaw0: number; stop: number };

export interface TourPose {
  x: number;
  z: number;
  yaw: number;
  /** Index into `stops` of the room being visited / walked to. */
  stop: number;
}

/** Walking speed of the tour (m/s) – calm, a little slower than the free walk. */
export const TOUR_SPEED = 1.1;
/** Turn rate when changing direction (rad/s). */
const TURN_RATE = 1.4;
/** How far ahead (m) the camera looks along the path. */
const LOOK_AHEAD = 0.9;
const MIN_WALL_GAP = 0.45;
const MIN_FURNITURE_GAP = 0.45;

const ease = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

/** Camera yaw (rad) for looking along a plan direction; matches `anglesOf` (yaw 0 = towards −y). */
export const yawOfDirection = (dx: number, dy: number): number => Math.atan2(-dx, -dy);

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function distToPolyline(p: Vec2, poly: Vec2[], closed: boolean): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, closestPointOnSegment(p, poly[i], poly[(i + 1) % n]).distance);
  return best;
}

/** Candidate stand points of a room, most open first. */
export function standCandidates(project: Project, interior: Vec2[], centroid: Vec2, count = 6): Vec2[] {
  const obstacles = project.furniture.filter(isPassageObstacle).map(furnitureFootprint);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of interior) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const scored: { p: Vec2; score: number }[] = [];
  for (const [wallGap, furnGap] of [
    [MIN_WALL_GAP, MIN_FURNITURE_GAP],
    [0.3, 0.3],
  ]) {
    for (let x = minX; x <= maxX; x += 0.2) {
      for (let y = minY; y <= maxY; y += 0.2) {
        const p = { x, y };
        if (!pointInPolygon(p, interior)) continue;
        const w = distToPolyline(p, interior, true);
        if (w < wallGap) continue;
        let f = Infinity;
        let inside = false;
        for (const fp of obstacles) {
          if (pointInPolygon(p, fp)) {
            inside = true;
            break;
          }
          f = Math.min(f, distToPolyline(p, fp, true));
        }
        if (inside || f < furnGap) continue;
        // open space first, a slight pull towards the middle of the room
        scored.push({ p, score: Math.min(w, 2) + Math.min(f, 2) - 0.15 * dist(p, centroid) });
      }
    }
    if (scored.length) break;
  }
  scored.sort((a, b) => b.score - a.score);
  // keep the best spots that are apart from each other (alternatives if the first is not reachable)
  const out: Vec2[] = [];
  for (const s of scored) {
    if (out.every((o) => dist(o, s.p) > 0.8)) out.push(s.p);
    if (out.length >= count) break;
  }
  return out;
}

function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Point and walking direction on a polyline after `s` metres. */
function onPolyline(pts: Vec2[], s: number): { p: Vec2; dir: Vec2 } {
  let rest = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (l < 1e-9) continue;
    if (rest <= l || i === pts.length - 1) {
      const u = Math.min(1, rest / l);
      return {
        p: { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u },
        dir: { x: (pts[i].x - pts[i - 1].x) / l, y: (pts[i].y - pts[i - 1].y) / l },
      };
    }
    rest -= l;
  }
  return { p: pts[pts.length - 1], dir: { x: 0, y: -1 } };
}

/** Direction of a path at `s`, looking `LOOK_AHEAD` metres further (a smooth turn into corners). */
function headingAt(pts: Vec2[], s: number, total: number): number {
  const a = onPolyline(pts, s).p;
  const b = onPolyline(pts, Math.min(total, s + LOOK_AHEAD)).p;
  if (dist(a, b) < 0.05) {
    const d = onPolyline(pts, Math.max(0, total - 0.01)).dir;
    return yawOfDirection(d.x, d.y);
  }
  return yawOfDirection(b.x - a.x, b.y - a.y);
}

/** Plans the tour of all rooms of the (active storey of the) project; `start` = where the walk begins. */
export function planTour(project: Project, derived: DerivedPlan, start?: Vec2): TourPlan {
  const rooms = project.rooms
    .map((r) => ({ room: r, g: derived.rooms.get(r.id) }))
    .filter((x): x is { room: (typeof project.rooms)[number]; g: NonNullable<typeof x.g> } => !!x.g && x.g.area >= 1.5);
  const skipped: string[] = [];
  const stops: TourStop[] = [];
  if (rooms.length === 0) return { stops, skipped, segments: [], duration: 0 };

  const cands = new Map(rooms.map((x) => [x.room.id, standCandidates(project, x.g.interior, x.g.centroid)]));
  const open = rooms.filter((x) => (cands.get(x.room.id) ?? []).length > 0);
  for (const x of rooms) if (!open.includes(x)) skipped.push(x.room.name || 'Raum');

  // first room: the one containing the start, else the first
  let cur: Vec2 | null = null;
  let remaining = [...open];
  const startRoomIdx = start ? remaining.findIndex((x) => pointInPolygon(start, x.g.interior)) : -1;
  const first = remaining.splice(startRoomIdx >= 0 ? startRoomIdx : 0, 1)[0];
  if (first) {
    const stand = cands.get(first.room.id)![0];
    stops.push({ roomId: first.room.id, name: first.room.name || 'Raum', stand, path: [], lookSeconds: lookSeconds(first.g.area) });
    cur = stand;
  }
  while (cur && remaining.length) {
    const from: Vec2 = cur;
    // the three nearest rooms by air line; choose by real walking length
    const near = [...remaining].sort((a, b) => dist(from, a.g.centroid) - dist(from, b.g.centroid)).slice(0, 3);
    let best: { x: (typeof near)[number]; stand: Vec2; path: Vec2[]; len: number } | null = null;
    for (const x of near) {
      for (const stand of cands.get(x.room.id)!.slice(0, 3)) {
        const res = shortestWalkPath(project, derived, from, stand);
        if (!res.ok) continue;
        if (!best || res.length < best.len) best = { x, stand, path: res.points, len: res.length };
        break; // best-ranked reachable spot of this room
      }
    }
    if (!best) {
      // the nearest rooms are not reachable: leave them out and go on with the rest
      for (const x of near) {
        skipped.push(x.room.name || 'Raum');
        remaining = remaining.filter((r) => r !== x);
      }
      continue;
    }
    remaining = remaining.filter((r) => r !== best!.x);
    stops.push({ roomId: best.x.room.id, name: best.x.room.name || 'Raum', stand: best.stand, path: best.path, lookSeconds: lookSeconds(best.x.g.area) });
    cur = best.stand;
  }
  return { stops, skipped, ...schedule(stops) };
}

const lookSeconds = (area: number) => Math.max(5, Math.min(11, 4 + area * 0.45));

function schedule(stops: TourStop[]): { segments: TourSegment[]; duration: number } {
  const segments: TourSegment[] = [];
  let t = 0;
  let yaw = 0;
  stops.forEach((s, i) => {
    if (s.path.length > 1) {
      const len = polylineLength(s.path);
      const heading0 = headingAt(s.path, 0, len);
      const turn = Math.abs(angleDelta(yaw, heading0));
      if (turn > 0.05) {
        const dur = Math.max(0.5, turn / TURN_RATE);
        segments.push({ kind: 'turn', t0: t, dur, at: s.path[0], from: yaw, to: heading0, stop: i });
        t += dur;
      }
      const dur = Math.max(0.5, len / TOUR_SPEED);
      segments.push({ kind: 'walk', t0: t, dur, pts: s.path, len, stop: i });
      t += dur;
      yaw = headingAt(s.path, len, len);
    }
    segments.push({ kind: 'look', t0: t, dur: s.lookSeconds, at: s.stand, yaw0: yaw, stop: i });
    t += s.lookSeconds;
    yaw += 2 * Math.PI;
  });
  return { segments, duration: t };
}

/** Camera pose `t` seconds into the tour (clamped to its end). */
export function tourPoseAt(plan: TourPlan, t: number): TourPose | null {
  const segs = plan.segments;
  if (segs.length === 0) return null;
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (t < s.t0 + s.dur) {
      seg = s;
      break;
    }
  }
  const u = Math.max(0, Math.min(1, (t - seg.t0) / seg.dur));
  if (seg.kind === 'walk') {
    const along = seg.len * u;
    const { p } = onPolyline(seg.pts, along);
    return { x: p.x, z: p.y, yaw: headingAt(seg.pts, along, seg.len), stop: seg.stop };
  }
  if (seg.kind === 'turn') return { x: seg.at.x, z: seg.at.y, yaw: seg.from + angleDelta(seg.from, seg.to) * ease(u), stop: seg.stop };
  return { x: seg.at.x, z: seg.at.y, yaw: seg.yaw0 + 2 * Math.PI * ease(u), stop: seg.stop };
}
