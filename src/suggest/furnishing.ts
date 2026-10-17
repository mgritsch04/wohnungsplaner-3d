/**
 * Furnishing suggestion per room (#137): room type + wish list → a proposed placement of
 * generic catalogue items. First version is rule based (no AI): beds go against the longest
 * free wall, nightstands beside the bed, chairs around the table, the coffee table in front of
 * the sofa, the TV board opposite the sofa, wardrobes and shelves into corners …
 *
 * Every candidate pose is checked with the app's own placement rules (`placementIssues`: walls,
 * door leaves and swings, other furniture, space in front of doors/drawers), plus: the item
 * stays inside its room and keeps doorways and windows free. Only poses without any issue are
 * used, so a suggestion never contains a collision; items that do not fit are reported.
 *
 * Pure function on a project; nothing is changed until the caller applies the suggestion.
 */
import { GENERIC_CATALOG, findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import type { CatalogItem } from '../catalog/types';
import { footprintsOverlap, furnitureCorners } from '../editor2d/furnitureGeometry';
import { derivePlan, type DerivedPlan } from '../model/derived';
import { buildPlacementObstacles, placementIssues, type Obstacle } from '../model/placement';
import { frontClearance, isSurface } from '../model/placementRules';
import type { Furniture, Project } from '../model/schema';
import { add, boundsOf, dist, dot, normalize, perp, pointInPolygon, polygonCentroid, rotate, scale, sub, type Vec2 } from '../model/vec';

export type RoomType = 'living' | 'bedroom' | 'kids' | 'office' | 'dining' | 'kitchen' | 'bath' | 'hall' | 'other';

export const ROOM_TYPES: { id: RoomType; label: string }[] = [
  { id: 'living', label: 'Wohnzimmer' },
  { id: 'bedroom', label: 'Schlafzimmer' },
  { id: 'kids', label: 'Kinderzimmer' },
  { id: 'office', label: 'Arbeitszimmer' },
  { id: 'dining', label: 'Esszimmer' },
  { id: 'kitchen', label: 'Küche' },
  { id: 'bath', label: 'Bad' },
  { id: 'hall', label: 'Flur' },
  { id: 'other', label: 'Sonstiges' },
];

/** First matching rule wins: „Wohnküche“ is a kitchen, „Kinderschlafzimmer“ a kids' room. */
const NAME_RULES: [RegExp, RoomType][] = [
  [/kind/i, 'kids'],
  [/schlaf|gäste|gaeste/i, 'bedroom'],
  [/arbeit|büro|buero|office/i, 'office'],
  [/^ess|esszimmer|essbereich/i, 'dining'],
  [/küche|kueche|kochen/i, 'kitchen'],
  [/bad|wc|dusch|toilette/i, 'bath'],
  [/flur|diele|gang|eingang|vorraum|garderobe/i, 'hall'],
  [/wohn/i, 'living'],
];

/** Room type guessed from the room name; unknown names → 'other' (empty wish list). */
export function guessRoomType(name: string): RoomType {
  return NAME_RULES.find(([re]) => re.test(name))?.[1] ?? 'other';
}

export interface WishItem {
  catalogId: string;
  quantity: number;
}

/** Typical furnishing per room type, from the built-in generic catalogue (sizes/prices are guide values). */
const DEFAULT_WISHES: Record<RoomType, [string, number][]> = {
  living: [
    ['generic-sofa-3', 1],
    ['generic-coffee-table', 1],
    ['generic-rug-200', 1],
    ['generic-tv-sideboard', 1],
    ['generic-tv', 1],
    ['generic-armchair', 1],
    ['generic-floor-lamp', 1],
    ['generic-shelf-80', 1],
  ],
  bedroom: [
    ['generic-bed-160', 1],
    ['generic-nightstand', 2],
    ['generic-table-lamp', 2],
    ['generic-wardrobe-150', 1],
    ['generic-dresser', 1],
  ],
  kids: [
    ['generic-bed-90', 1],
    ['generic-wardrobe-100', 1],
    ['generic-desk-small', 1],
    ['generic-office-chair', 1],
    ['generic-shelf-cube', 1],
    ['generic-rug-160', 1],
  ],
  office: [
    ['generic-desk', 1],
    ['generic-office-chair', 1],
    ['generic-shelf-80', 2],
    ['generic-floor-lamp', 1],
  ],
  dining: [
    ['generic-dining-table-6', 1],
    ['generic-chair', 6],
    ['generic-pendant', 1],
    ['generic-sideboard', 1],
  ],
  kitchen: [
    ['generic-dining-table-4', 1],
    ['generic-chair', 4],
  ],
  bath: [
    ['generic-toilet', 1],
    ['generic-washbasin', 1],
    ['generic-shower', 1],
    ['generic-washer', 1],
  ],
  hall: [
    ['generic-dresser', 1],
    ['generic-shelf-80', 1],
  ],
  other: [],
};

export function defaultWishes(type: RoomType): WishItem[] {
  return DEFAULT_WISHES[type].map(([catalogId, quantity]) => ({ catalogId, quantity }));
}

/** Catalogue items offered for the wish list: everything generic except built-in kitchen modules (→ kitchen planner). */
export const WISH_CATALOG: CatalogItem[] = GENERIC_CATALOG.filter((c) => !c.kitchen);

export interface RoomRequest {
  roomId: string;
  type: RoomType;
  wishes: WishItem[];
}

export interface RoomSuggestion {
  roomId: string;
  roomName: string;
  type: RoomType;
  placed: Furniture[];
  /** Names of wished items that found no collision-free place (one entry per piece). */
  missing: string[];
}

export interface FurnishingSuggestion {
  rooms: RoomSuggestion[];
  /** All proposed items (= the rooms' `placed`), in placement order. */
  items: Furniture[];
}

/** Which room an item stands in (by its centre). */
export function roomIdAt(p: Project, d: DerivedPlan, pt: Vec2): string | null {
  return p.rooms.find((r) => {
    const g = d.rooms.get(r.id);
    return g && pointInPolygon(pt, g.interior);
  })?.id ?? null;
}

/** Wish list for a room type minus what already stands in the room (same catalogue id). */
export function wishesForRoom(p: Project, d: DerivedPlan, roomId: string, type: RoomType): WishItem[] {
  const existing = new Map<string, number>();
  for (const f of p.furniture) if (f.catalogId && roomIdAt(p, d, f) === roomId) existing.set(f.catalogId, (existing.get(f.catalogId) ?? 0) + 1);
  return defaultWishes(type).map((w) => ({ ...w, quantity: Math.max(0, w.quantity - (existing.get(w.catalogId) ?? 0)) }));
}

// ---------------------------------------------------------------------------------------------
// placement

type Role = 'bed' | 'sofa' | 'tv-board' | 'table' | 'wall' | 'corner' | 'nightstand' | 'coffee-table' | 'seat' | 'rug' | 'tv' | 'table-lamp' | 'pendant';

/** Placement order: anchors first, then what is placed relative to them. */
const ROLE_ORDER: Role[] = ['bed', 'sofa', 'tv-board', 'table', 'wall', 'corner', 'nightstand', 'coffee-table', 'seat', 'rug', 'tv', 'table-lamp', 'pendant'];

const shapeOf = (f: Pick<Furniture, 'model'>) => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);
const CORNER_SHAPES = new Set(['wardrobe', 'shelf', 'shower', 'bathtub', 'floor-lamp', 'washer', 'plant', 'k-fridge']);

type RoleInput = Pick<CatalogItem, 'name' | 'category' | 'model'> & { tags?: string[]; catalogId?: string };

function roleOf(f: RoleInput): Role {
  // placed items carry no tags: take them from their generic catalogue entry
  const item: RoleInput = (f.catalogId && findCatalogItem(f.catalogId)) || f;
  const shape = shapeOf(item);
  const tags = item.tags ?? [];
  if (item.category === 'bed') return shape === 'bed' ? 'bed' : 'nightstand';
  if (item.category === 'chair') return 'seat';
  if (shape === 'rug') return 'rug';
  if (shape === 'tv') return 'tv';
  if (shape === 'pendant') return 'pendant';
  if (shape === 'table-lamp') return 'table-lamp';
  if (item.category === 'table') return tags.includes('couchtisch') || /couchtisch|beistelltisch/i.test(item.name) ? 'coffee-table' : 'table';
  if (item.category === 'storage' && (tags.includes('tv') || /tv|lowboard/i.test(item.name))) return 'tv-board';
  if (shape === 'sofa' || shape === 'sofa-corner') return 'sofa';
  if (CORNER_SHAPES.has(shape)) return 'corner';
  return 'wall';
}

/** Rotation whose local front (+y, see `frontClearance`) points along `fwd`. */
const rotationFacing = (fwd: Vec2) => Math.atan2(-fwd.x, fwd.y);
const frontOf = (f: Pick<Furniture, 'rotation'>): Vec2 => ({ x: -Math.sin(f.rotation), y: Math.cos(f.rotation) });
const rightOf = (f: Pick<Furniture, 'rotation'>): Vec2 => ({ x: Math.cos(f.rotation), y: Math.sin(f.rotation) });
const mm = (v: number) => Math.round(v * 1000) / 1000;

/** Gap between an item's back and the wall (rounding must never push it into the wall). */
const WALL_GAP = 0.01;
const STEP = 0.05;

interface Edge {
  a: Vec2;
  dir: Vec2;
  inward: Vec2;
  length: number;
}

function roomEdges(poly: Vec2[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const length = dist(a, b);
    if (length < 0.3) continue;
    const dir = normalize(sub(b, a));
    let inward = perp(dir);
    const mid = add(scale(add(a, b), 0.5), scale(inward, 0.02));
    if (!pointInPolygon(mid, poly)) inward = scale(inward, -1);
    out.push({ a, dir, inward, length });
  }
  return out;
}

interface Zone {
  polygon: Vec2[];
  z0: number;
  z1: number;
}

/** Areas that must stay free: in front of and behind every door/passage (walking) and directly in front of windows (above the sill). */
function openingZones(d: DerivedPlan): Zone[] {
  const out: Zone[] = [];
  for (const [wallId, list] of d.openings) {
    const fp = d.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      const window = r.opening.kind === 'window';
      const reach = fp.thickness / 2 + (window ? 0.25 : 0.7);
      const pa = add(fp.a, scale(fp.dir, r.s0));
      const pb = add(fp.a, scale(fp.dir, r.s1));
      const n = scale(fp.normal, reach);
      out.push({ polygon: [sub(pa, n), sub(pb, n), add(pb, n), add(pa, n)], z0: window ? r.bottom : 0, z1: r.top });
    }
  }
  return out;
}

interface Ctx {
  draft: Project;
  derived: DerivedPlan;
  obstacles: Obstacle[];
  zones: Zone[];
}

interface RoomCtx extends Ctx {
  roomId: string;
  interior: Vec2[];
  edges: Edge[];
  centroid: Vec2;
}

const inRoom = (c: RoomCtx, f: Pick<Furniture, 'x' | 'y'>) => pointInPolygon({ x: f.x, y: f.y }, c.interior);
const roomItems = (c: RoomCtx) => c.draft.furniture.filter((f) => inRoom(c, f));

/** Whether `f` can stand there: inside the room, openings free, no placement issue for it or caused by it. */
function fits(c: RoomCtx, f: Furniture): boolean {
  const fc = furnitureCorners(f);
  const inset = fc.map((p) => add(p, scale(normalize(sub({ x: f.x, y: f.y }, p)), 0.003)));
  if (!inset.every((p) => pointInPolygon(p, c.interior))) return false;
  const rug = f.category === 'textile' && f.height < 0.05;
  if (!rug) {
    for (const z of c.zones) {
      if (f.elevation >= z.z1 || f.elevation + f.height <= z.z0 + 0.02) continue;
      if (footprintsOverlap(fc, z.polygon, 1e-3)) return false;
    }
  }
  c.draft.furniture.push(f);
  try {
    if (placementIssues(c.draft, c.derived, f, c.obstacles).length) return false;
    // the new item must not take the space in front of doors/drawers of what is already there
    for (const o of c.draft.furniture) {
      if (o === f || frontClearance(o) <= 0 || dist(o, f) > 4) continue;
      if (placementIssues(c.draft, c.derived, o, c.obstacles).some((i) => i.refId === f.id)) return false;
    }
    return true;
  } finally {
    c.draft.furniture.pop();
  }
}

function withPose(item: CatalogItem, x: number, y: number, rotation: number, elevation?: number): Furniture {
  const f = createFurnitureFromCatalog(item, { x: mm(x), y: mm(y), rotation });
  if (elevation !== undefined) f.elevation = mm(elevation);
  return f;
}

function firstFit(c: RoomCtx, poses: Iterable<Furniture>): Furniture | null {
  for (const f of poses) if (fits(c, f)) return f;
  return null;
}

/** Poses with the back against a wall: walls in the given order, stations ordered by `stationOrder`. */
function* wallPoses(item: CatalogItem, edges: Edge[], stationOrder: 'center' | 'corner' | ((e: Edge, t: number) => number)): Generator<Furniture> {
  for (const e of edges) {
    const lo = item.width / 2 + WALL_GAP;
    const hi = e.length - item.width / 2 - WALL_GAP;
    if (hi < lo) continue;
    const ts: number[] = [];
    for (let t = lo; t <= hi + 1e-9; t += STEP) ts.push(t);
    if (hi - ts[ts.length - 1] > 1e-6) ts.push(hi);
    const key =
      stationOrder === 'center' ? (t: number) => Math.abs(t - e.length / 2) : stationOrder === 'corner' ? (t: number) => Math.min(t - lo, hi - t) : (t: number) => stationOrder(e, t);
    ts.sort((p, q) => key(p) - key(q));
    const rotation = rotationFacing(e.inward);
    for (const t of ts) {
      const c = add(add(e.a, scale(e.dir, t)), scale(e.inward, item.depth / 2 + WALL_GAP));
      yield withPose(item, c.x, c.y, rotation);
    }
  }
}

const longestFirst = (edges: Edge[]) => [...edges].sort((a, b) => b.length - a.length);

/** Free-standing poses near the room centre (grid, both orientations along the longest wall). */
function* centerPoses(c: RoomCtx, item: CatalogItem, around: Vec2 = c.centroid): Generator<Furniture> {
  const b = boundsOf(c.interior);
  if (!b) return;
  const pts: Vec2[] = [];
  for (let x = Math.ceil(b.minX / 0.1) * 0.1; x <= b.maxX; x += 0.1)
    for (let y = Math.ceil(b.minY / 0.1) * 0.1; y <= b.maxY; y += 0.1) if (pointInPolygon({ x, y }, c.interior)) pts.push({ x, y });
  pts.sort((p, q) => dist(p, around) - dist(q, around));
  const main = longestFirst(c.edges)[0];
  const r0 = main ? Math.atan2(main.dir.y, main.dir.x) : 0;
  for (const p of pts.slice(0, 600)) for (const r of [r0, r0 + Math.PI / 2]) yield withPose(item, p.x, p.y, r);
}

const findIn = (c: RoomCtx, pred: (f: Furniture) => boolean) => roomItems(c).filter(pred);

function placeItem(c: RoomCtx, item: CatalogItem, role: Role, companions: CatalogItem[]): Furniture | null {
  const edges = longestFirst(c.edges);
  switch (role) {
    case 'bed': {
      // keep room for the wished nightstands on both sides; without them if that does not fit
      const ns = companions.find((x) => roleOf(x) === 'nightstand');
      if (ns) {
        const extra = 2 * (ns.width + 0.03);
        const probe: CatalogItem = { ...item, width: item.width + extra };
        for (const pose of wallPoses(probe, edges, 'center')) {
          if (!fits(c, pose)) continue;
          const bed = withPose(item, pose.x, pose.y, pose.rotation);
          if (fits(c, bed)) return bed;
        }
      }
      return firstFit(c, wallPoses(item, edges, 'center'));
    }
    case 'sofa':
      return firstFit(c, wallPoses(item, edges, 'center'));
    case 'corner':
      return firstFit(c, wallPoses(item, edges, 'corner'));
    case 'wall':
      return firstFit(c, wallPoses(item, edges, 'center'));
    case 'tv-board': {
      const sofa = findIn(c, (f) => roleOf(f) === 'sofa')[0];
      if (!sofa) return firstFit(c, wallPoses(item, edges, 'center'));
      // opposite the sofa, centred on its axis
      const fwd = frontOf(sofa);
      const facing = [...c.edges].sort((a, b) => dot(a.inward, fwd) - dot(b.inward, fwd));
      const axis = (e: Edge, t: number) => Math.abs(dot(sub(add(e.a, scale(e.dir, t)), sofa), rightOf(sofa)));
      return firstFit(c, wallPoses(item, facing, axis));
    }
    case 'table':
      return firstFit(c, tablePoses(c, item));
    case 'nightstand': {
      const beds = findIn(c, (f) => roleOf(f) === 'bed');
      return firstFit(c, (function* () {
        for (const bed of beds) {
          const back = sub(bed, scale(frontOf(bed), bed.depth / 2));
          for (const s of [-1, 1]) {
            const p = add(add(back, scale(rightOf(bed), s * (bed.width / 2 + item.width / 2 + 0.03))), scale(frontOf(bed), item.depth / 2));
            yield withPose(item, p.x, p.y, bed.rotation);
          }
        }
      })());
    }
    case 'coffee-table': {
      const sofa = findIn(c, (f) => roleOf(f) === 'sofa')[0];
      const poses = function* () {
        if (sofa) {
          for (const gap of [0.45, 0.4, 0.5, 0.35, 0.6]) {
            const p = add(sofa, scale(frontOf(sofa), sofa.depth / 2 + gap + item.depth / 2));
            yield withPose(item, p.x, p.y, sofa.rotation);
          }
        }
        yield* centerPoses(c, item);
      };
      return firstFit(c, poses());
    }
    case 'seat':
      return firstFit(c, seatPoses(c, item));
    case 'rug': {
      const ct = findIn(c, (f) => roleOf(f) === 'coffee-table')[0];
      const sofa = findIn(c, (f) => roleOf(f) === 'sofa')[0];
      const bed = findIn(c, (f) => roleOf(f) === 'bed')[0];
      const poses = function* () {
        if (ct && sofa) {
          // long side parallel to the sofa, under the coffee table
          for (const r of [sofa.rotation + Math.PI / 2, sofa.rotation]) yield withPose(item, ct.x, ct.y, r);
        }
        yield* centerPoses(c, item, bed ? add(bed, scale(frontOf(bed), bed.depth / 2)) : c.centroid);
      };
      return firstFit(c, poses());
    }
    case 'tv': {
      const boards = findIn(c, (f) => roleOf(f) === 'tv-board');
      const poses = function* () {
        for (const b of boards) {
          const p = add(sub(b, scale(frontOf(b), b.depth / 2)), scale(frontOf(b), item.depth / 2 + 0.04));
          yield withPose(item, p.x, p.y, b.rotation, Math.max(item.elevation ?? 0, b.elevation + b.height + 0.02));
        }
        yield* wallPoses(item, edges, 'center');
      };
      return firstFit(c, poses());
    }
    case 'table-lamp': {
      const surfaces = findIn(c, (f) => isSurface(f) && f.width >= item.width && f.depth >= item.depth).sort((a, b) => Number(roleOf(b) === 'nightstand') - Number(roleOf(a) === 'nightstand'));
      return firstFit(c, (function* () {
        for (const s of surfaces) yield withPose(item, s.x, s.y, s.rotation, s.elevation + s.height);
      })());
    }
    case 'pendant': {
      const tables = findIn(c, (f) => roleOf(f) === 'table');
      return firstFit(c, (function* () {
        for (const t of tables) yield withPose(item, t.x, t.y, t.rotation);
        if (!tables.length) yield* centerPoses(c, item);
      })());
    }
  }
}

/** Table poses near the centre that leave room for chairs on the long sides (~60 cm). */
function* tablePoses(c: RoomCtx, item: CatalogItem): Generator<Furniture> {
  const round = shapeOf(item) === 'table-round';
  const probe: CatalogItem = { ...item, width: item.width + (round ? 1.2 : 0.3), depth: item.depth + 1.2, category: 'table' };
  for (const pose of centerPoses(c, item)) {
    // the enlarged footprint must fit, too: walls, doors and other furniture leave room for chairs
    if (!fits(c, createFurnitureFromCatalog(probe, pose))) continue;
    yield pose;
  }
}

/** Chairs around a table (long sides alternating, then the ends), an office chair at the desk. */
function* seatPoses(c: RoomCtx, item: CatalogItem): Generator<Furniture> {
  const office = shapeOf(item) === 'office-chair';
  const desks = findIn(c, (f) => f.category === 'desk');
  const tables = findIn(c, (f) => f.category === 'table' && roleOf(f) === 'table');
  const hosts = office ? [...desks, ...tables] : [...tables, ...desks];
  const under = 0.15;
  for (const t of hosts) {
    if (t.category === 'desk') {
      const p = add(t, scale(frontOf(t), t.depth / 2 + item.depth / 2 - 0.25));
      yield withPose(item, p.x, p.y, t.rotation + Math.PI);
      continue;
    }
    if (shapeOf(t) === 'table-round') {
      const r = t.width / 2 + item.depth / 2 - under;
      for (let k = 0; k < 8; k++) {
        const dir = rotate({ x: 0, y: 1 }, t.rotation + (k < 4 ? (k * Math.PI) / 2 : Math.PI / 4 + ((k - 4) * Math.PI) / 2));
        const p = add(t, scale(dir, r));
        yield withPose(item, p.x, p.y, rotationFacing(scale(dir, -1)));
      }
      continue;
    }
    const perSide = Math.max(1, Math.floor(t.width / 0.55));
    const slots: { local: Vec2; fwd: Vec2 }[] = [];
    for (let i = 0; i < perSide; i++) {
      const x = -t.width / 2 + ((i + 0.5) * t.width) / perSide;
      slots.push({ local: { x, y: t.depth / 2 + item.depth / 2 - under }, fwd: { x: 0, y: -1 } });
      slots.push({ local: { x, y: -(t.depth / 2 + item.depth / 2 - under) }, fwd: { x: 0, y: 1 } });
    }
    slots.push({ local: { x: t.width / 2 + item.depth / 2 - under, y: 0 }, fwd: { x: -1, y: 0 } });
    slots.push({ local: { x: -(t.width / 2 + item.depth / 2 - under), y: 0 }, fwd: { x: 1, y: 0 } });
    for (const s of slots) {
      const p = add(t, rotate(s.local, t.rotation));
      yield withPose(item, p.x, p.y, rotationFacing(rotate(s.fwd, t.rotation)));
    }
  }
  if (!hosts.length) yield* wallPoses(item, longestFirst(c.edges), 'corner');
}

/**
 * Builds a suggestion for the requested rooms. Existing furniture stays and is respected;
 * items are placed one after another, so later items avoid the earlier proposed ones.
 */
export function suggestFurnishing(project: Project, requests: RoomRequest[], catalog: CatalogItem[] = []): FurnishingSuggestion {
  const derived = derivePlan(project);
  const ctx: Ctx = { draft: structuredClone(project), derived, obstacles: buildPlacementObstacles(derived), zones: openingZones(derived) };
  const rooms: RoomSuggestion[] = [];
  for (const req of requests) {
    const room = project.rooms.find((r) => r.id === req.roomId);
    const g = derived.rooms.get(req.roomId);
    if (!room) continue;
    const pieces: { item: CatalogItem; role: Role }[] = [];
    for (const w of req.wishes) {
      const item = findCatalogItem(w.catalogId, catalog);
      if (!item) continue;
      for (let i = 0; i < w.quantity; i++) pieces.push({ item, role: roleOf(item) });
    }
    pieces.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.item.width * b.item.depth - a.item.width * a.item.depth);
    const out: RoomSuggestion = { roomId: room.id, roomName: room.name, type: req.type, placed: [], missing: [] };
    rooms.push(out);
    if (!g) {
      out.missing.push(...pieces.map((p) => p.item.name));
      continue;
    }
    const rc: RoomCtx = { ...ctx, roomId: room.id, interior: g.interior, edges: roomEdges(g.interior), centroid: polygonCentroid(g.interior) };
    for (const { item, role } of pieces) {
      const f = placeItem(rc, item, role, pieces.map((p) => p.item));
      if (f) {
        ctx.draft.furniture.push(f);
        out.placed.push(f);
      } else out.missing.push(item.name);
    }
  }
  return { rooms, items: rooms.flatMap((r) => r.placed) };
}

/** Adds the proposed items to the project (call inside one `apply` → one undo step). Returns their ids. */
export function applyFurnishing(d: Project, s: FurnishingSuggestion): string[] {
  for (const f of s.items) d.furniture.push(structuredClone(f));
  return s.items.map((f) => f.id);
}

/** Sum of the proposed items' prices (guide values of the generic catalogue). */
export function suggestionTotal(s: FurnishingSuggestion): number {
  return s.items.reduce((sum, f) => sum + (f.price?.amount ?? 0) * f.quantity, 0);
}
