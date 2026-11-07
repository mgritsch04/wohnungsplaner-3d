/**
 * Checked places for the anchor pieces (#436): for sofa, bed, desk and dining table the code
 * works out 3–6 candidate places (wall plus stretch, or free in the room for the table), keeps
 * the ones where the piece fits, the door swings and the ways between the doors stay free, and
 * says what each looks at. Claude picks by ID and gives the reason, it does not have to find a
 * wall by itself. The wrong wall was the most frequent flaw of the programmes (the sofa on the
 * wall with three doors, FirePlace: the language model picks the wrong anchor surface); picking
 * from a list of checked places is the cure the literature suggests for it.
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { rotationFacing } from '../../suggest/roomGeometry';
import { sideOfVector, toRoomCm } from '../coords';
import { footprint, localRect, overlaps, pointPolyDist, type Pose } from '../review/geom';
import type { RoomAnalysis, Side, WallInfo } from '../types';
import { gazeOf, type GazePiece } from './gaze';
import { checkWalkways } from './walk';

export type AnchorKind = 'sofa' | 'bed' | 'desk' | 'dining';

export interface AnchorSize {
  kind: AnchorKind;
  /** Everyday name for the prompt („Sofa“, „Doppelbett“). */
  name: string;
  /** Nominal footprint (m): a smaller piece fits every place that fits this one. */
  width: number;
  depth: number;
}

export interface Slot {
  /** `SOFA-1`, `BETT-2`, `SCHREIBTISCH-1`, `ESSTISCH-1`: best first. */
  id: string;
  kind: AnchorKind;
  /** Wall the back of the piece stands against; null for a table in the middle of the room. */
  wall: string | null;
  /** Stretch of the piece along its wall in room cm (x on north/south walls, y on east/west walls). */
  along: { from: number; to: number } | null;
  /** Stretch of the nominal piece along its wall, measured from the wall start (m). */
  span: { t0: number; t1: number } | null;
  /** Centre of the nominal piece, plan coordinates (m). */
  x: number;
  y: number;
  rotation: number;
  /** Side the front points to. */
  facing: Side | null;
  score: number;
  /** One line for the prompt. */
  text: string;
}

/** Space a piece needs beyond its body: in front (legs, table, chair pulled out) and at the ends. */
const ALLOWANCE: Record<AnchorKind, { front: number; side: number }> = {
  sofa: { front: 0.45, side: 0 },
  bed: { front: 0.5, side: 0 },
  desk: { front: 0.7, side: 0 },
  dining: { front: 0.75, side: 0.5 },
};
/** Free distance to the next thing in front (m): coffee table and legs, the foot of the bed, the chair, the table. */
const MIN_FRONT: Record<AnchorKind, number> = { sofa: 1.6, bed: 0.9, desk: 1.0, dining: 1.4 };
const WORD: Record<AnchorKind, string> = { sofa: 'SOFA', bed: 'BETT', desk: 'SCHREIBTISCH', dining: 'ESSTISCH' };
const SIDE_WORD: Record<Side, string> = { N: 'Nordwand', O: 'Ostwand', S: 'Südwand', W: 'Westwand' };
const MAX_SLOTS = 6;
/** Depth of the zone in front of a door or passage that stays free (m). */
const ENTRY_DEPTH = 0.6;
/** Depth of the working area in front of a kitchen run (m). */
const KITCHEN_FRONT = 1.2;

const cm = (m: number) => Math.round(m * 100);

export interface SlotInput {
  room: RoomAnalysis;
  /** Pieces that are there already (kitchen modules included): obstacles. */
  existing: readonly GazePiece[];
  /** Walls one would rather not sleep or work against (bath or kitchen behind, outside without window). */
  loud?: ReadonlySet<string>;
}

const isObstacle = (p: GazePiece) => p.elevation < 0.5 && p.height >= 0.1 && p.role !== 'rug' && p.role !== 'curtain' && p.role !== 'mattress';

/** Footprint of a piece with its back to `w` at position `t` along the wall. */
function wallPose(w: WallInfo, t: number, size: AnchorSize): Pose {
  const x = w.a.x + w.dir.x * t + w.inward.x * (size.depth / 2);
  const y = w.a.y + w.dir.y * t + w.inward.y * (size.depth / 2);
  return { x, y, rotation: rotationFacing(w.inward), width: size.width, depth: size.depth };
}

/** Body plus the space it needs around it, as a polygon. */
function withAllowance(p: Pose, kind: AnchorKind): Vec2[] {
  const a = ALLOWANCE[kind];
  return localRect(p, -p.width / 2 - a.side, p.width / 2 + a.side, -p.depth / 2, p.depth / 2 + a.front);
}

/** Does the whole polygon lie inside the room? Corners are tested slightly inside, the room's own corners must not poke into it. */
function insideRoom(room: RoomAnalysis, poly: readonly Vec2[]): boolean {
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  if (!poly.every((p) => pointInPolygon({ x: p.x + (c.x - p.x) * 0.02, y: p.y + (c.y - p.y) * 0.02 }, room.polygon))) return false;
  return !room.polygon.some((v) => pointInPolygon(v, shrink(poly, 0.02)));
}

function shrink(poly: readonly Vec2[], f: number): Vec2[] {
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  return poly.map((p) => ({ x: p.x + (c.x - p.x) * f, y: p.y + (c.y - p.y) * f }));
}

/** Distance of a polygon from the centre line of a way (m), minus half the way's width. */
function wayClearance(poly: readonly Vec2[], path: readonly Vec2[], width: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    for (let k = 0; k <= n; k++) best = Math.min(best, pointPolyDist({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, poly));
  }
  return best - width / 2;
}

interface Scene {
  room: RoomAnalysis;
  /** Footprints that block a place: furniture and the working area in front of a kitchen run. */
  blockers: Vec2[][];
  /** Footprints that block walking. */
  obstacles: Vec2[][];
  /** Zones in front of doors and passages. */
  entries: Vec2[][];
  swings: Vec2[][];
  base: Map<string, number>;
  existing: readonly GazePiece[];
  loud: ReadonlySet<string>;
}

function sceneOf(input: SlotInput): Scene {
  const { room } = input;
  const obstacles = input.existing.filter(isObstacle);
  const blockers = obstacles.map((p) => p.poly);
  // the working area in front of a kitchen run is no place for a sofa or a table (WK3)
  for (const k of obstacles.filter((p) => p.kitchen && p.elevation < 0.1)) blockers.push(localRect({ x: k.x, y: k.y, rotation: Math.atan2(-k.front.x, k.front.y), width: k.width, depth: k.depth }, -k.width / 2, k.width / 2, k.depth / 2, k.depth / 2 + KITCHEN_FRONT));
  const entries: Vec2[][] = [];
  const swings: Vec2[][] = [];
  for (const w of room.walls)
    for (const o of w.openings) {
      if (!o.passable) continue;
      const p = (t: number, d: number) => ({ x: w.a.x + w.dir.x * t + w.inward.x * d, y: w.a.y + w.dir.y * t + w.inward.y * d });
      entries.push([p(o.t0, 0), p(o.t1, 0), p(o.t1, ENTRY_DEPTH), p(o.t0, ENTRY_DEPTH)]);
      if (o.swing) swings.push(o.swing);
    }
  const obstaclePolys = obstacles.map((p) => p.poly);
  const base = new Map(checkWalkways(room, obstaclePolys).map((w) => [`${w.from}>${w.to}`, w.fits]));
  return { room, blockers, obstacles: obstaclePolys, entries, swings, base, existing: input.existing, loud: input.loud ?? new Set() };
}

interface Verdict {
  ok: boolean;
  /** Distance of the nearest way's centre line from the piece minus half its width, with the way's label. */
  way: { label: string; clearance: number } | null;
  front: number;
  gaze: ReturnType<typeof gazeOf>;
}

/** Fits, doors and ways stay free, room in front? */
function judge(s: Scene, kind: AnchorKind, pose: Pose, body: Vec2[], space: Vec2[], front: Vec2 | null, walkSpace: Vec2[] = space): Verdict {
  const fail = { ok: false, way: null, front: 0, gaze: { targets: [], text: '' } } as Verdict;
  if (!insideRoom(s.room, body)) return fail;
  if (s.blockers.some((b) => overlaps(space, b, 0.01))) return fail;
  if (s.swings.some((sw) => overlaps(body, sw, 0.01))) return fail;
  if (s.entries.some((e) => overlaps(kind === 'dining' ? space : body, e, 0.01))) return fail;
  const ways = checkWalkways(s.room, [...s.obstacles, walkSpace]);
  if (ways.some((w) => w.fits < Math.min(s.base.get(`${w.from}>${w.to}`) ?? w.width, w.width) - 0.01)) return fail;
  let gaze: Verdict['gaze'] = { targets: [], text: '' };
  let ahead = Infinity;
  if (front) {
    const piece: GazePiece = { id: 'slot', ref: 'slot', x: pose.x, y: pose.y, front, width: pose.width, depth: pose.depth, height: 0.8, elevation: 0, poly: body, role: 'sofa', shape: 'sofa' };
    gaze = gazeOf(s.room, piece, s.existing);
    ahead = gaze.targets.length ? Math.min(...gaze.targets.map((t) => t.cm)) / 100 : Infinity;
    if (ahead < MIN_FRONT[kind]) return { ...fail, gaze, front: ahead };
  }
  let way: Verdict['way'] = null;
  for (const w of s.room.walkways) {
    const c = wayClearance(body, w.path, w.width);
    if (!way || c < way.clearance) way = { label: `${w.from}→${w.to}`, clearance: c };
  }
  return { ok: true, way, front: ahead, gaze };
}

function scoreOf(s: Scene, kind: AnchorKind, v: Verdict, wall: WallInfo | null, gaps: [number, number] | null, size: AnchorSize): number {
  let score = 100;
  const main = v.gaze.targets[0];
  const kinds = new Set(v.gaze.targets.slice(0, 2).map((t) => t.kind));
  if (kind === 'sofa' || kind === 'bed') {
    if (kinds.has('kitchen')) score -= kind === 'sofa' ? 45 : 20;
    if (kinds.has('door')) score -= kind === 'sofa' ? 25 : 12;
    if (kinds.has('tv')) score += 15;
    if (main?.kind === 'window') score += kind === 'sofa' ? 8 : 0;
    if (main?.kind === 'wall') score += 5;
  }
  // behind the sitter at a desk: a window throws glare on the screen, a door means people walking up from behind
  if (kind === 'desk') score -= main?.kind === 'window' ? 10 : main?.kind === 'door' ? 8 : 0;
  if (v.way) score += Math.min(Math.max(v.way.clearance, 0), 1) * 15;
  if (wall) {
    if (s.loud.has(wall.id) && (kind === 'bed' || kind === 'desk')) score -= 25;
    // longest stretch without openings (RF4/RF8): a large piece gets the largest wall piece
    const longest = Math.max(...wall.free.map((f) => f.t1 - f.t0));
    score += Math.min(longest, 4) * 4;
    // window on the same wall next to a desk: light from the side
    if (kind === 'desk' && wall.openings.some((o) => o.kind === 'window')) score += 10;
  }
  if (kind === 'bed' && gaps) {
    const double = size.width >= 1.35;
    const [l, r] = gaps;
    if (double && (l < 0.5 || r < 0.5)) score -= 15;
    if (double && l >= 0.5 && r >= 0.5) score += 8;
    if (!double && Math.max(l, r) >= 0.5) score += 4;
  }
  return score;
}

const roomRange = (room: RoomAnalysis, w: WallInfo, t0: number, t1: number) => {
  const p0 = toRoomCm(room.origin, { x: w.a.x + w.dir.x * t0, y: w.a.y + w.dir.y * t0 });
  const p1 = toRoomCm(room.origin, { x: w.a.x + w.dir.x * t1, y: w.a.y + w.dir.y * t1 });
  return w.side === 'N' || w.side === 'S' ? { from: Math.min(p0.x, p1.x), to: Math.max(p0.x, p1.x) } : { from: Math.min(p0.y, p1.y), to: Math.max(p0.y, p1.y) };
};

function describe(s: Scene, kind: AnchorKind, w: WallInfo | null, along: Slot['along'], pose: Pose, v: Verdict, gaps: [number, number] | null): string {
  const c = toRoomCm(s.room.origin, pose);
  const facing = sideOfVector({ x: -Math.sin(pose.rotation), y: Math.cos(pose.rotation) }, 20);
  const parts: string[] = [];
  if (w) parts.push(`Rücken an ${w.id} (${w.side ? SIDE_WORD[w.side] : 'schräge Wand'}) ${w.side === 'N' || w.side === 'S' ? 'x' : 'y'}=${along!.from}–${along!.to}`);
  else parts.push(`frei im Raum, Mitte (${c.x},${c.y}), Längsachse ${Math.abs(Math.cos(pose.rotation)) > 0.5 ? 'West–Ost' : 'Nord–Süd'}`);
  if (w) parts.push(`Mitte (${c.x},${c.y})${facing ? `, Front nach ${facing}` : ''}`);
  // the front of a desk is the side one sits on: the sitter looks at the wall and has the room in the back
  if (kind !== 'dining') parts.push(kind === 'desk' ? v.gaze.text.replace(/^schaut auf/, 'im Rücken des Sitzenden') : v.gaze.text);
  if (Number.isFinite(v.front)) parts.push(`${cm(v.front)} cm frei davor`);
  if (kind === 'bed' && gaps) parts.push(`Platz neben dem Bett ${cm(gaps[0])}/${cm(gaps[1])} cm`);
  if (v.way) parts.push(v.way.clearance > 0.05 ? `Weg ${v.way.label} ${cm(v.way.clearance)} cm entfernt` : `Weg ${v.way.label} direkt daneben, bleibt frei`);
  if (w && s.loud.has(w.id)) parts.push('laute oder kalte Wand');
  return parts.join('; ');
}

/** Places for one anchor piece, best first. Empty when nothing fits. */
export function anchorSlots(input: SlotInput, size: AnchorSize): Slot[] {
  const s = sceneOf(input);
  const kind = size.kind;
  const found: (Slot & { wallIndex: number; t: number })[] = [];
  const consider = (w: WallInfo, wi: number, t: number, f0: number, f1: number) => {
    const pose = wallPose(w, t, size);
    const body = footprint(pose);
    const space = withAllowance(pose, kind);
    const front = w.inward;
    const v = judge(s, kind, pose, body, space, front);
    if (!v.ok) return;
    const gaps: [number, number] = [t - size.width / 2 - f0, f1 - (t + size.width / 2)];
    const along = roomRange(s.room, w, t - size.width / 2, t + size.width / 2);
    const slot: Slot = {
      id: '',
      kind,
      wall: w.id,
      along,
      span: { t0: t - size.width / 2, t1: t + size.width / 2 },
      x: pose.x,
      y: pose.y,
      rotation: pose.rotation,
      facing: sideOfVector({ x: w.inward.x, y: w.inward.y }, 20),
      score: scoreOf(s, kind, v, w, gaps, size),
      text: describe(s, kind, w, along, pose, v, gaps),
    };
    found.push({ ...slot, wallIndex: wi, t });
  };
  if (kind !== 'dining') {
    s.room.walls.forEach((w, wi) => {
      if (!w.side) return;
      for (const f of w.free) {
        const L = f.t1 - f.t0;
        if (L < size.width - 0.001) continue;
        const half = size.width / 2;
        const ts = [f.t0 + half, f.t1 - half, (f.t0 + f.t1) / 2];
        if (kind === 'bed') ts.push(f.t0 + half + 0.6, f.t1 - half - 0.6);
        const uniq = ts.filter((t, i) => t >= f.t0 + half - 1e-6 && t <= f.t1 - half + 1e-6 && ts.findIndex((o) => Math.abs(o - t) < 0.15) === i);
        for (const t of uniq) consider(w, wi, t, f.t0, f.t1);
      }
    });
  } else {
    // table with its long side to a wall (benches or chairs on the other side) …
    s.room.walls.forEach((w, wi) => {
      if (!w.side) return;
      for (const f of w.free) {
        const half = size.width / 2 + ALLOWANCE.dining.side;
        if (f.t1 - f.t0 < 2 * half - 0.001) continue;
        for (const t of [f.t0 + half, f.t1 - half, (f.t0 + f.t1) / 2]) {
          const pose = wallPose(w, t, size);
          const body = footprint(pose);
          const space = withAllowance(pose, 'dining');
          const v = judge(s, 'dining', pose, body, space, w.inward, footprint(pose, 0.45));
          if (!v.ok || found.some((x) => x.wallIndex === wi && Math.abs(x.t - t) < 0.15)) continue;
          const along = roomRange(s.room, w, t - size.width / 2, t + size.width / 2);
          found.push({ id: '', kind, wall: w.id, along, span: { t0: t - size.width / 2, t1: t + size.width / 2 }, x: pose.x, y: pose.y, rotation: pose.rotation, facing: sideOfVector(w.inward, 20), score: scoreOf(s, kind, v, w, null, size) - 8, text: describe(s, kind, w, along, pose, v, null), wallIndex: wi, t });
        }
      }
    });
    // … or free in the room with room for the chairs all around
    const xs = s.room.polygon.map((p) => p.x);
    const ys = s.room.polygon.map((p) => p.y);
    const lengthX = s.room.size.x >= s.room.size.y;
    const rotation = lengthX ? 0 : Math.PI / 2;
    const centre = s.room.polygon.reduce((c, p) => ({ x: c.x + p.x / s.room.polygon.length, y: c.y + p.y / s.room.polygon.length }), { x: 0, y: 0 });
    const free: (Slot & { wallIndex: number; t: number })[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.2) {
        const pose: Pose = { x, y, rotation, width: size.width, depth: size.depth };
        const body = footprint(pose);
        const space = footprint(pose, 0.75);
        const v = judge(s, 'dining', pose, body, space, null, footprint(pose, 0.45));
        if (!v.ok) continue;
        const near = s.existing.filter((p) => p.kitchen).some((p) => Math.hypot(p.x - x, p.y - y) < 3);
        const score = scoreOf(s, kind, { ...v, gaze: { ...v.gaze, targets: [] } }, null, null, size) - Math.hypot(x - centre.x, y - centre.y) * 6 + (near ? 6 : 0);
        free.push({ id: '', kind, wall: null, along: null, span: null, x, y, rotation, facing: null, score, text: describe(s, kind, null, null, pose, v, null), wallIndex: -1, t: 0 });
      }
    free.sort((a, b) => b.score - a.score);
    const chosen: typeof free = [];
    for (const f of free) if (chosen.length < 2 && chosen.every((c) => Math.hypot(c.x - f.x, c.y - f.y) > 1.2)) chosen.push({ ...f, wallIndex: -1 - chosen.length });
    found.push(...chosen);
  }
  found.sort((a, b) => b.score - a.score);
  // at most two places on one wall, none of them within 50 cm of a better one; the rest only if fewer than three remain
  const picked: typeof found = [];
  const spread = (f: (typeof found)[number], perWall: number) =>
    picked.filter((p) => p.wallIndex === f.wallIndex).length < perWall && !picked.some((p) => p.wallIndex === f.wallIndex && Math.abs(p.t - f.t) < 0.5);
  // the table in the middle of the room is always among them when it fits
  const middle = found.find((f) => f.wall === null);
  if (middle) picked.push(middle);
  for (const f of found) if (picked.length < MAX_SLOTS && !picked.includes(f) && spread(f, 2)) picked.push(f);
  for (const f of found) if (picked.length < 3 && !picked.includes(f) && spread(f, 3)) picked.push(f);
  picked.sort((a, b) => b.score - a.score);
  return picked.map((f, i) => ({ id: `${WORD[kind]}-${i + 1}`, kind: f.kind, wall: f.wall, along: f.along, span: f.span, x: f.x, y: f.y, rotation: f.rotation, facing: f.facing, score: f.score, text: f.text }));
}

/** Prompt section for one anchor: size line and the places. */
export function slotLines(size: AnchorSize, slots: readonly Slot[]): string {
  const head = `${size.name} (Maß ${cm(size.width)} × ${cm(size.depth)} cm; ein kleineres Teil passt in jeden dieser Plätze):`;
  if (!slots.length) return `${head} kein geprüfter Wandplatz frei – lege es nach eigenem Urteil, schreibe in "why", warum.`;
  return [head, ...slots.map((x) => `- ${x.id}: ${x.text}.`)].join('\n');
}
