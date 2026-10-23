/**
 * Judges a furnished room like an interior designer would (#350): are the pieces reachable, does
 * anything stand lost in the middle of the room, is the bed under the window, does the TV face
 * the sofa, does a picture hang over the TV …? 100 points minus a penalty per finding.
 *
 * The placement (`suggestFurnishing`) tries several arrangements and keeps the best one; Claude's
 * second round („gründlich“) gets the findings as text. Pure; nothing is changed.
 */
import { derivePlan } from '../model/derived';
import type { Furniture, Project } from '../model/schema';
import { add, closestPointOnSegment, dist, dot, normalize, pointInPolygon, rotate, scale, sub, type Vec2 } from '../model/vec';
import { frontOf, rightOf, roleOf, roomEdges, shapeOf, type Edge, type Role } from './roomGeometry';
import type { RoomType } from './furnishing';

export interface ScoreIssue {
  text: string;
  penalty: number;
}

export interface RoomScore {
  /** 0–100. */
  score: number;
  issues: ScoreIssue[];
}

export interface LayoutInput {
  type: RoomType;
  interior: Vec2[];
  edges: Edge[];
  /** Everything standing in the room (existing and proposed). */
  items: Furniture[];
  /** Pieces that found no place. */
  missing?: number;
}

/** Penalty per piece that found no place: a missing wardrobe is worse than most awkward poses. */
export const MISSING_PENALTY = 12;
/** Half the width of a walking person: 2 × 0.28 m ≈ the 55–60 cm a passage needs at least. */
const PERSON = 0.28;
const CELL = 0.1;

/** Pieces that may stand free in the room (around a table, in front of the sofa, on the floor as rug …). */
const FREE_ROLES = new Set<Role>(['table', 'coffee-table', 'seat', 'armchair', 'rug', 'mattress', 'pendant', 'floor-lamp', 'table-lamp', 'tv', 'box', 'curtain', 'wall-art', 'mirror', 'coat-rack']);
const WALL_TABLE_ROOMS = new Set<RoomType>(['bedroom', 'kids', 'office', 'hall', 'utility', 'bath']);
/** Pieces one has to get to: their front (bed: foot or sides) must be reachable from a door. */
const REACH_ROLES = new Set<Role>(['bed', 'sofa', 'corner', 'wall', 'tv-board', 'table', 'nightstand']);
const HANGING_SHAPES = new Set(['tv', 'panel', 'picture', 'wall-shelf', 'coat-rack']);

const isFloor = (f: Furniture) => f.elevation < 0.05 && f.height > 0.05;
const blocks = (f: Furniture) => isFloor(f) && f.solid !== false;
/** Chairs are pulled out when one walks past; they do not block a way. */
const blocksWay = (f: Furniture) => blocks(f) && f.category !== 'chair';
/** Small rooms are entered sideways: 50 cm suffice there. */
const personIn = (type: RoomType) => (type === 'bath' || type === 'utility' || type === 'balcony' ? 0.25 : PERSON);
const label = (f: Furniture) => f.name.replace(/\s*\((Platzhalter|IKEA|Möbelix)\)\s*$/i, '');

/** Distance from `p` to the footprint of `f` (0 inside). */
function distToItem(p: Vec2, f: Furniture): number {
  const l = rotate(sub(p, f), -f.rotation);
  const dx = Math.max(Math.abs(l.x) - f.width / 2, 0);
  const dy = Math.max(Math.abs(l.y) - f.depth / 2, 0);
  return Math.hypot(dx, dy);
}

const distToWalls = (p: Vec2, poly: Vec2[]) => Math.min(...poly.map((a, i) => closestPointOnSegment(p, a, poly[(i + 1) % poly.length]).distance));

/** The four side midpoints of a footprint with their outward directions. */
function sides(f: Furniture): { mid: Vec2; out: Vec2; length: number; side: 'front' | 'back' | 'left' | 'right' }[] {
  const fw = frontOf(f);
  const r = rightOf(f);
  return [
    { mid: add(f, scale(fw, f.depth / 2)), out: fw, length: f.width, side: 'front' },
    { mid: sub(f, scale(fw, f.depth / 2)), out: scale(fw, -1), length: f.width, side: 'back' },
    { mid: add(f, scale(r, f.width / 2)), out: r, length: f.depth, side: 'right' },
    { mid: sub(f, scale(r, f.width / 2)), out: scale(r, -1), length: f.depth, side: 'left' },
  ];
}

/** The wall a side of `f` stands against (within 10 cm, parallel), if any. */
function wallAt(edges: Edge[], mid: Vec2, out: Vec2): Edge | null {
  for (const e of edges) {
    if (dot(out, e.inward) > -0.9) continue;
    const t = dot(sub(mid, e.a), e.dir);
    if (t < -0.05 || t > e.length + 0.05) continue;
    if (Math.abs(dot(sub(mid, e.a), e.inward)) <= 0.1) return e;
  }
  return null;
}

/** Whether a window lies in the wall a side stands against (along at least 10 cm of the side). */
function windowAt(edges: Edge[], mid: Vec2, out: Vec2, length: number): boolean {
  const e = wallAt(edges, mid, out);
  if (!e) return false;
  const t = dot(sub(mid, e.a), e.dir);
  return e.openings.some((o) => o.window && Math.min(o.t1, t + length / 2) - Math.max(o.t0, t - length / 2) > 0.1);
}

/** Whether a window lies behind the back of `f`. */
function windowBehind(edges: Edge[], f: Furniture): boolean {
  const back = sides(f)[1];
  return windowAt(edges, back.mid, back.out, back.length);
}

/** Cells reachable from the doors of the room for a walking person (flood fill on a 10 cm grid). */
function reachable(input: LayoutInput): ((p: Vec2) => boolean) | null {
  const { interior, edges, items } = input;
  const PERSON = personIn(input.type);
  const doors = edges.flatMap((e) => e.openings.filter((o) => !o.window).map((o) => add(add(e.a, scale(e.dir, (o.t0 + o.t1) / 2)), scale(e.inward, PERSON + 0.05))));
  if (!doors.length) return null;
  const xs = interior.map((p) => p.x);
  const ys = interior.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const nx = Math.ceil((Math.max(...xs) - x0) / CELL) + 1;
  const ny = Math.ceil((Math.max(...ys) - y0) / CELL) + 1;
  const solid = items.filter(blocksWay);
  const free = new Uint8Array(nx * ny);
  const at = (i: number, j: number): Vec2 => ({ x: x0 + i * CELL, y: y0 + j * CELL });
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p = at(i, j);
      if (!pointInPolygon(p, interior) || distToWalls(p, interior) < PERSON - 0.04) continue;
      if (solid.some((f) => distToItem(p, f) < PERSON)) continue;
      free[i * ny + j] = 1;
    }
  const seen = new Uint8Array(nx * ny);
  const queue: number[] = [];
  for (const d of doors) {
    const i = Math.round((d.x - x0) / CELL);
    const j = Math.round((d.y - y0) / CELL);
    // the cell right behind the door may touch a wall corner: take the nearest free cell around it
    let best = -1;
    for (let di = -2; di <= 2 && best < 0; di++) for (let dj = -2; dj <= 2 && best < 0; dj++) {
      const k = (i + di) * ny + (j + dj);
      if (i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < ny && free[k]) best = k;
    }
    if (best >= 0 && !seen[best]) {
      seen[best] = 1;
      queue.push(best);
    }
  }
  while (queue.length) {
    const k = queue.pop()!;
    const i = Math.floor(k / ny);
    const j = k % ny;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = a * ny + b;
      if (free[q] && !seen[q]) {
        seen[q] = 1;
        queue.push(q);
      }
    }
  }
  return (p: Vec2) => {
    const i = Math.round((p.x - x0) / CELL);
    const j = Math.round((p.y - y0) / CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const a = i + di;
      const b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < ny && seen[a * ny + b]) return true;
    }
    return false;
  };
}

function area(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function scoreLayout(input: LayoutInput): RoomScore {
  const { type, edges, items } = input;
  const issues: ScoreIssue[] = [];
  const add_ = (penalty: number, text: string) => issues.push({ penalty, text });
  if (input.missing) add_(MISSING_PENALTY * input.missing, `${input.missing} ${input.missing === 1 ? 'Möbel hat' : 'Möbel haben'} keinen Platz gefunden`);
  const role = new Map(items.map((f) => [f, roleOf(f)]));
  const ofRole = (r: Role) => items.filter((f) => role.get(f) === r);
  const touches = (f: Furniture, which?: 'back' | 'long') =>
    sides(f).some((s) => (which === 'back' ? s.side === 'back' : which === 'long' ? s.length >= Math.max(f.width, f.depth) - 1e-6 : true) && wallAt(edges, s.mid, s.out));

  // lost in the room: everything that belongs against a wall
  for (const f of items) {
    if (!isFloor(f)) continue;
    const r = role.get(f)!;
    if (FREE_ROLES.has(r) && !(r === 'table' && WALL_TABLE_ROOMS.has(type))) continue;
    if (r === 'bed' ? !touches(f) : !touches(f, 'back') && !(r === 'nightstand' && touches(f))) add_(8, `${label(f)} steht frei im Raum statt an der Wand`);
  }

  // beds
  for (const b of ofRole('bed')) {
    if (windowBehind(edges, b)) add_(10, `${label(b)} steht mit dem Kopfteil unter dem Fenster`);
    else if (sides(b).some((x) => x.side !== 'back' && windowAt(edges, x.mid, x.out, x.length))) add_(5, `${label(b)} steht vor dem Fenster`);
    if (b.width < 1.2) {
      if (!touches(b, 'long') && !touches(b, 'back')) add_(4, `${label(b)} lehnt an keiner Wand`);
      continue;
    }
    const others = items.filter((f) => f !== b && blocks(f) && role.get(f) !== 'nightstand');
    const open = sides(b)
      .filter((s) => s.side === 'left' || s.side === 'right')
      .filter((s) => {
        const p = add(s.mid, scale(s.out, 0.3));
        return pointInPolygon(p, input.interior) && distToWalls(p, input.interior) > 0.15 && !others.some((o) => distToItem(p, o) < 0.1);
      }).length;
    if (open < 2) add_(open ? 6 : 10, `${label(b)} ist nur von ${open ? 'einer Seite' : 'keiner Seite'} zugänglich`);
  }

  // sofa and TV
  const tv = items.find((f) => shapeOf(f) === 'tv') ?? ofRole('tv-board')[0];
  for (const s of ofRole('sofa')) {
    if (windowBehind(edges, s)) add_(6, `${label(s)} steht vor dem Fenster`);
    if (!tv) continue;
    const to = sub(tv, s);
    const d = Math.hypot(to.x, to.y);
    const cos = d > 0.01 ? dot(normalize(to), frontOf(s)) : 1;
    if (cos < 0.8) add_(10, `${label(tv)} steht nicht gegenüber vom Sofa`);
    else if (cos < 0.95) add_(3, `${label(tv)} steht schräg zum Sofa`);
    if (d < 1.6 || d > 5) add_(4, `${label(tv)} ist ${d < 1.6 ? 'zu nah am' : 'zu weit weg vom'} Sofa (${Math.round(d * 100)} cm)`);
    // nothing tall between sofa and TV (the coffee table is low enough)
    for (const f of items) {
      if (f === s || f === tv || !blocks(f) || f.height < 0.6 || role.get(f) === 'tv-board') continue;
      const k = Math.max(0, Math.min(1, dot(sub(f, s), to) / (d * d)));
      if (k > 0.15 && k < 0.85 && distToItem(add(s, scale(to, k)), f) < 0.05) {
        add_(8, `${label(f)} steht zwischen Sofa und Fernseher`);
        break;
      }
    }
  }
  for (const t of [...ofRole('tv-board'), ...items.filter((f) => shapeOf(f) === 'tv')]) if (windowBehind(edges, t)) add_(8, `${label(t)} steht vor dem Fenster (Blendung, verdeckt das Licht)`);

  // the coffee table belongs right in front of the sofa
  for (const t of ofRole('coffee-table')) {
    const s = ofRole('sofa')[0];
    if (!s) continue;
    const to = sub(t, s);
    const ahead = dot(to, frontOf(s));
    if (ahead < s.depth / 2 || ahead > s.depth / 2 + 1.1 || Math.abs(dot(to, rightOf(s))) > s.width / 2) add_(6, `${label(t)} steht nicht vor dem Sofa`);
  }

  // armchairs turned to the seating group
  const group = [...ofRole('coffee-table'), ...ofRole('sofa')][0];
  if (group)
    for (const a of ofRole('armchair')) {
      const to = sub(group, a);
      if (Math.hypot(to.x, to.y) > 0.01 && dot(normalize(to), frontOf(a)) < 0.3) add_(3, `${label(a)} ist nicht zur Sitzgruppe gedreht`);
    }

  // hanging things on top of each other (picture over the TV, mirror behind a picture)
  const hanging = items.filter((f) => f.elevation > 0.25 && HANGING_SHAPES.has(shapeOf(f)));
  for (let i = 0; i < hanging.length; i++)
    for (let k = i + 1; k < hanging.length; k++) {
      const a = hanging[i];
      const b = hanging[k];
      if (dist(a, b) > (Math.max(a.width, b.width) + 0.1) || Math.abs(dot(frontOf(a), frontOf(b))) < 0.9) continue;
      const along = Math.abs(dot(sub(a, b), rightOf(a)));
      const vertical = Math.min(a.elevation + a.height, b.elevation + b.height) - Math.max(a.elevation, b.elevation);
      if (along < (a.width + b.width) / 2 - 0.02 && vertical > -0.05 && Math.abs(dot(sub(a, b), frontOf(a))) < 0.25) add_(8, `${label(a)} und ${label(b)} hängen übereinander`);
    }

  // rug under the seating group
  const rug = ofRole('rug').find((r) => r.width * r.depth > 1.5);
  const ct = ofRole('coffee-table')[0];
  if (rug && ct && distToItem(ct, rug) > 0) add_(3, `${label(rug)} liegt nicht unter dem Couchtisch`);

  // hall: shoes and coats right at the door
  if (type === 'hall') {
    const doors = edges.flatMap((e) => e.openings.filter((o) => !o.window).map((o) => add(e.a, scale(e.dir, (o.t0 + o.t1) / 2))));
    for (const f of items.filter((x) => shapeOf(x) === 'coat-rack' || /schuh/i.test(x.name)))
      if (doors.length && Math.min(...doors.map((d) => dist(d, f))) > 2.5) add_(3, `${label(f)} ist weit weg von der Tür`);
  }

  // walkways: every piece one uses must be reachable from a door
  const reach = reachable(input);
  if (reach) {
    for (const f of items) {
      const r = role.get(f)!;
      if (!isFloor(f) || !REACH_ROLES.has(r) || ['plant', 'vacuum'].includes(shapeOf(f))) continue;
      // one sits down on a sofa and gets into bed from the side, too; a desk is reached past its chair
      const probes = sides(f)
        .filter((s) => (r === 'bed' || r === 'sofa' ? s.side !== 'back' : r === 'table' ? true : s.side === 'front'))
        .map((s) => add(s.mid, scale(s.out, personIn(type) + 0.05)));
      if (!probes.some(reach)) add_(6, `${label(f)} ist nicht erreichbar (Weg zugestellt)`);
    }
  }

  // crowded
  const a = area(input.interior);
  const covered = items.filter(blocks).reduce((s, f) => s + f.width * f.depth, 0) / Math.max(a, 0.1);
  const limit = type === 'utility' || type === 'bath' ? 0.6 : 0.5;
  if (covered > limit) add_(Math.round((covered - limit) * 40), `zu voll: ${Math.round(covered * 100)} % der Bodenfläche zugestellt`);

  const penalty = issues.reduce((s, i) => s + i.penalty, 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

/** Score of a room as it stands in `project`. */
export function scoreRoom(project: Project, roomId: string, type: RoomType, missing = 0): RoomScore {
  const d = derivePlan(project);
  const g = d.rooms.get(roomId);
  if (!g) return { score: 0, issues: [] };
  const items = project.furniture.filter((f) => pointInPolygon(f, g.interior));
  return scoreLayout({ type, interior: g.interior, edges: roomEdges(g.interior, d), items, missing });
}
