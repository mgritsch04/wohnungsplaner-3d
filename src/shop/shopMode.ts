/**
 * Laden-Modus (#361): what you need in the shop – free wall lengths and niches per room, a quick
 * "does B × T × H fit here?" check and the shopping list. Everything is derived from the plan
 * (`derivePlan`); nothing is stored in the project.
 */
import { derivePlan, type DerivedPlan } from '../model/derived';
import { findWallBetween } from '../model/graph';
import { projectOnLevel, sortedLevels } from '../model/levels';
import { isTextile } from '../model/placementRules';
import type { Furniture, Project } from '../model/schema';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { add, dot, normalize, perp, pointInPolygon, scale, sub, type Vec2 } from '../model/vec';

/** Furniture closer to the wall than this counts as standing at it (a smaller gap is unusable anyway). */
const AT_WALL = 0.12;
/** Shorter free stretches are not worth listing. */
export const MIN_SPAN = 0.2;
/** Depth is measured up to this far into the room. */
export const MAX_DEPTH = 3;
const RAY_STEP = 0.05;
const EPS = 1e-6;

export interface Blocker {
  from: number;
  to: number;
  label: string;
}

/** A free stretch of wall (between corners, openings and furniture) with the room depth in front of it. */
export interface FreeSpan {
  roomId: string;
  roomName: string;
  wallId: string | null;
  /** Free length along the wall in m. */
  length: number;
  /** Free depth in front of the whole stretch in m (capped at MAX_DEPTH). */
  depth: number;
  /** Clear ceiling height in m (lowest wall of the room). */
  height: number;
  /** What bounds the stretch: "Ecke", "Tür", "Fenster", "Durchgang" or the name of a furniture item. */
  start: string;
  end: string;
  /** Bounded on both sides by something else than a corner. */
  niche: boolean;
  /** Length of the whole wall face, for context. */
  wallLength: number;
}

export interface RoomSpans {
  roomId: string;
  name: string;
  area: number;
  height: number;
  spans: FreeSpan[];
}

type Seg = [Vec2, Vec2];

function polygonEdges(poly: Vec2[]): Seg[] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as Seg);
}

/** Distance along ray (origin o, unit direction d) to the segment, or null when it is not hit. */
function rayHit(o: Vec2, d: Vec2, [a, b]: Seg): number | null {
  const e = sub(b, a);
  const denom = d.x * e.y - d.y * e.x;
  if (Math.abs(denom) < EPS) return null;
  const w = sub(a, o);
  const t = (w.x * e.y - w.y * e.x) / denom;
  const u = (w.x * d.y - w.y * d.x) / denom;
  return t > EPS && u >= -EPS && u <= 1 + EPS ? t : null;
}

/** Whether a furniture item takes up floor space for something of height `h` (undefined = anything counts). */
function blocksAtHeight(f: Furniture, h: number | undefined): boolean {
  if (isTextile(f) || f.height < 0.05) return false;
  return h === undefined || f.elevation < h;
}

function mergeBlockers(list: Blocker[], length: number): Blocker[] {
  const sorted = list
    .map((b) => ({ ...b, from: Math.max(0, b.from), to: Math.min(length, b.to) }))
    .filter((b) => b.to > b.from)
    .sort((a, b) => a.from - b.from);
  const out: Blocker[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.from <= last.to + EPS) {
      if (b.to > last.to) out.push({ ...b, from: last.to });
    } else out.push(b);
  }
  return out;
}

/**
 * Free stretches along one wall edge of a room: [0, length] minus openings and furniture standing at the wall.
 * `height` = height of the thing that is supposed to fit; windows above it and furniture raised above it do not block.
 */
function edgeBlockers(d: DerivedPlan, wallId: string | null, a: Vec2, b: Vec2, nrm: Vec2, furniture: Furniture[], height: number | undefined): Blocker[] {
  const dir = normalize(sub(b, a));
  const out: Blocker[] = [];
  const alongOf = (pt: Vec2) => dot(sub(pt, a), dir);
  if (wallId) {
    const wall = d.index.walls.get(wallId);
    const wa = wall ? d.index.nodes.get(wall.a) : undefined;
    const wb = wall ? d.index.nodes.get(wall.b) : undefined;
    if (wall && wa && wb) {
      const wdir = normalize(sub(wb, wa));
      for (const o of d.index.openingsByWall.get(wallId) ?? []) {
        if (o.kind === 'window' && height !== undefined && o.sillHeight >= height) continue;
        const s0 = alongOf(add(wa, scale(wdir, o.offset - o.width / 2)));
        const s1 = alongOf(add(wa, scale(wdir, o.offset + o.width / 2)));
        out.push({ from: Math.min(s0, s1), to: Math.max(s0, s1), label: o.kind === 'door' ? 'Tür' : o.kind === 'window' ? 'Fenster' : 'Durchgang' });
      }
    }
  }
  for (const f of furniture) {
    if (!blocksAtHeight(f, height)) continue;
    const cs = furnitureCorners(f);
    const off = cs.map((c) => dot(sub(c, a), nrm));
    if (Math.min(...off) > AT_WALL || Math.max(...off) < -AT_WALL) continue;
    const along = cs.map(alongOf);
    out.push({ from: Math.min(...along), to: Math.max(...along), label: f.name || 'Möbel' });
  }
  return mergeBlockers(out, Math.hypot(b.x - a.x, b.y - a.y));
}

function spansBetween(blockers: Blocker[], length: number): { from: number; to: number; start: string; end: string }[] {
  const res: { from: number; to: number; start: string; end: string }[] = [];
  let cursor = 0;
  let startLabel = 'Ecke';
  for (const b of blockers) {
    if (b.from - cursor >= MIN_SPAN) res.push({ from: cursor, to: b.from, start: startLabel, end: b.label });
    cursor = Math.max(cursor, b.to);
    startLabel = b.label;
  }
  if (length - cursor >= MIN_SPAN) res.push({ from: cursor, to: length, start: startLabel, end: 'Ecke' });
  return res;
}

/** Free depth in front of the stretch [from, to] of the edge a→b (room on the `nrm` side). */
function depthInFront(a: Vec2, dir: Vec2, nrm: Vec2, from: number, to: number, edges: Seg[], skip: Seg, obstacles: Vec2[][]): number {
  let depth = MAX_DEPTH;
  const steps = Math.max(1, Math.ceil((to - from) / RAY_STEP));
  const obstacleEdges = obstacles.flatMap(polygonEdges);
  for (let i = 0; i <= steps; i++) {
    // keep the outermost rays 1 cm inside, so neighbours that end exactly at the stretch do not count
    const s = Math.min(to - 0.01, Math.max(from + 0.01, from + ((to - from) * i) / steps));
    const o = add(a, scale(dir, s));
    for (const e of [...edges, ...obstacleEdges]) {
      if (e === skip) continue;
      const t = rayHit(o, nrm, e);
      if (t !== null && t < depth) depth = t;
    }
  }
  return depth;
}

/** Free wall stretches of every room of one storey; `height` as in `edgeBlockers`. */
export function roomSpans(p: Project, d: DerivedPlan, opts: { height?: number; roomPrefix?: string } = {}): RoomSpans[] {
  const result: RoomSpans[] = [];
  const furniture = p.furniture;
  for (const room of p.rooms) {
    const geo = d.rooms.get(room.id);
    if (!geo) continue;
    const poly = geo.interior;
    const n = poly.length;
    const edges = polygonEdges(poly);
    const wallHeights = room.nodeIds.map((id, i) => {
      const next = room.nodeIds[(i + 1) % room.nodeIds.length];
      return p.walls.find((w) => (w.a === id && w.b === next) || (w.b === id && w.a === next))?.height;
    });
    const roomHeight = Math.min(...wallHeights.filter((h): h is number => h !== undefined), Infinity);
    const obstacles = furniture.filter((f) => blocksAtHeight(f, opts.height)).map(furnitureCorners);
    const roomName = opts.roomPrefix ? `${opts.roomPrefix} · ${room.name}` : room.name;
    const spans: FreeSpan[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < MIN_SPAN) continue;
      const dir = normalize(sub(b, a));
      // normal that points into the room
      let nrm = perp(dir);
      const mid = add(add(a, scale(dir, length / 2)), scale(nrm, 0.02));
      if (!pointInPolygon(mid, poly)) nrm = scale(nrm, -1);
      const wallId = findWallBetween(d.index.walls.values(), room.nodeIds[i], room.nodeIds[(i + 1) % n])?.id ?? null;
      const blockers = edgeBlockers(d, wallId, a, b, nrm, furniture, opts.height);
      for (const s of spansBetween(blockers, length)) {
        const depth = depthInFront(a, dir, nrm, s.from, s.to, edges, edges[i], obstacles);
        spans.push({
          roomId: room.id,
          roomName,
          wallId,
          length: s.to - s.from,
          depth,
          height: roomHeight,
          start: s.start,
          end: s.end,
          niche: s.start !== 'Ecke' && s.end !== 'Ecke',
          wallLength: length,
        });
      }
    }
    spans.sort((x, y) => y.length - x.length);
    result.push({ roomId: room.id, name: roomName, area: geo.area, height: roomHeight, spans });
  }
  return result;
}

/** All storeys: rooms with their free stretches (storey name in front of the room name when there are several). */
export function buildingSpans(project: Project, height?: number): RoomSpans[] {
  const multi = project.levels.length > 1;
  return sortedLevels(project).flatMap((level) => {
    const view = projectOnLevel(project, level.id);
    return roomSpans(view, derivePlan(view), { height, roomPrefix: multi ? level.name : undefined });
  });
}

export interface FitResult {
  span: FreeSpan;
  /** Which side of the item runs along the wall. */
  orientation: 'width' | 'depth';
  /** Free length left over along the wall, in m. */
  slackAlong: number;
  /** Free depth left over, in m. */
  slackDepth: number;
}

export interface FitAnswer {
  fits: FitResult[];
  /** Rooms without a fitting place, with the closest miss (smallest overshoot) as a hint. */
  nearest: { span: FreeSpan; missBy: number } | null;
  tooHigh: boolean;
}

/**
 * "Does width × depth × height (m) fit?": checked against every free stretch, both ways round
 * (width or depth along the wall). The item stands at the wall, so depth is measured from it.
 */
export function fitCheck(rooms: RoomSpans[], width: number, depth: number, height: number): FitAnswer {
  const fits: FitResult[] = [];
  let nearest: FitAnswer['nearest'] = null;
  let tooHigh = false;
  for (const room of rooms) {
    for (const span of room.spans) {
      if (height > span.height + EPS) {
        tooHigh = true;
        continue;
      }
      const tries: { orientation: FitResult['orientation']; along: number; into: number }[] = [
        { orientation: 'width', along: width, into: depth },
        { orientation: 'depth', along: depth, into: width },
      ];
      let best: FitResult | null = null;
      for (const t of tries) {
        const slackAlong = span.length - t.along;
        const slackDepth = span.depth - t.into;
        if (slackAlong >= -EPS && slackDepth >= -EPS) {
          if (!best || slackAlong + slackDepth < best.slackAlong + best.slackDepth) best = { span, orientation: t.orientation, slackAlong, slackDepth };
        } else {
          const miss = Math.max(0, -slackAlong) + Math.max(0, -slackDepth);
          if (!nearest || miss < nearest.missBy) nearest = { span, missBy: miss };
        }
      }
      if (best) fits.push(best);
    }
  }
  fits.sort((x, y) => x.slackAlong + x.slackDepth - (y.slackAlong + y.slackDepth));
  return { fits, nearest: fits.length ? null : nearest, tooHigh: tooHigh && fits.length === 0 };
}

/** Meters → "2,35 m" for the shop display (German decimal comma, cm precision). */
export function formatMeters(m: number): string {
  return `${m.toFixed(2).replace('.', ',')} m`;
}

/** "B × T × H" in cm from metres. */
export function formatCm(m: number): string {
  return String(Math.round(m * 100));
}
