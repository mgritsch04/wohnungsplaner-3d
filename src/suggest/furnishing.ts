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
import { newId } from '../model/ids';
import type { Furniture, Project } from '../model/schema';
import { add, boundsOf, dist, dot, normalize, perp, pointInPolygon, polygonCentroid, rotate, scale, sub, type Vec2 } from '../model/vec';

export type RoomType = 'living' | 'bedroom' | 'kids' | 'office' | 'dining' | 'kitchen' | 'bath' | 'hall' | 'utility' | 'balcony' | 'other';

export const ROOM_TYPES: { id: RoomType; label: string }[] = [
  { id: 'living', label: 'Wohnzimmer' },
  { id: 'bedroom', label: 'Schlafzimmer' },
  { id: 'kids', label: 'Kinderzimmer' },
  { id: 'office', label: 'Arbeitszimmer' },
  { id: 'dining', label: 'Esszimmer' },
  { id: 'kitchen', label: 'Küche' },
  { id: 'bath', label: 'Bad' },
  { id: 'hall', label: 'Flur' },
  { id: 'utility', label: 'Abstellraum' },
  { id: 'balcony', label: 'Balkon' },
  { id: 'other', label: 'Sonstiges' },
];

/** First matching rule wins: „Wohnküche“ is a kitchen, „Kinderschlafzimmer“ a kids' room. */
const NAME_RULES: [RegExp, RoomType][] = [
  [/kind/i, 'kids'],
  [/schlaf|gäste|gaeste/i, 'bedroom'],
  [/arbeit|büro|buero|office/i, 'office'],
  [/^ess|esszimmer|essbereich/i, 'dining'],
  [/abstell|speisekammer|^speis$|vorrat|lager|kammer|waschküche|waschkueche|hauswirtschaft|technik/i, 'utility'],
  [/küche|kueche|kochen/i, 'kitchen'],
  [/bad|wc|dusch|toilette/i, 'bath'],
  [/flur|diele|gang|eingang|vorraum|garderobe/i, 'hall'],
  [/balkon|terrasse|loggia|veranda/i, 'balcony'],
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
    ['generic-picture-large', 1],
  ],
  bedroom: [
    ['generic-bed-160', 1],
    ['generic-nightstand', 2],
    ['generic-table-lamp', 2],
    ['generic-wardrobe-150', 1],
    ['generic-dresser', 1],
    ['generic-picture', 1],
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
    ['generic-bath-mirror', 1],
    ['generic-shower', 1],
    ['generic-washer', 1],
  ],
  hall: [
    ['generic-shoe-cabinet', 1],
    ['generic-coat-rack', 1],
    ['generic-mirror', 1],
    ['generic-picture', 1],
  ],
  utility: [
    ['generic-utility-shelf', 2],
    ['generic-broom-cabinet', 1],
    ['generic-vacuum', 1],
    ['generic-storage-box', 4],
  ],
  balcony: [
    ['generic-balcony-table', 1],
    ['generic-balcony-chair', 2],
    ['generic-planter', 2],
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
  /** Per missing piece: why there was no place and what helps (#350). */
  notes?: { name: string; why: string }[];
}

export interface FurnishingSuggestion {
  rooms: RoomSuggestion[];
  /** All proposed items (= the rooms' `placed`), in placement order. */
  items: Furniture[];
  /** Furniture of an earlier, applied suggestion that this one replaces (#350): hidden in the preview, removed when applied. */
  replaces?: string[];
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
// ---------------------------------------------------------------------------------------------
// placement

type Role =
  | 'bed'
  | 'sofa'
  | 'tv-board'
  | 'table'
  | 'wall'
  | 'corner'
  | 'nightstand'
  | 'coffee-table'
  | 'armchair'
  | 'seat'
  | 'floor-lamp'
  | 'rug'
  | 'tv'
  | 'table-lamp'
  | 'pendant'
  | 'mattress'
  | 'box'
  | 'curtain'
  | 'mirror'
  | 'coat-rack'
  | 'wall-art';

/** Placement order: anchors first, then what is placed relative to them; wall decor last (it goes above what stands there). */
const ROLE_ORDER: Role[] = ['bed', 'nightstand', 'sofa', 'tv-board', 'table', 'corner', 'wall', 'coffee-table', 'armchair', 'seat', 'floor-lamp', 'rug', 'tv', 'table-lamp', 'pendant', 'mattress', 'box', 'curtain', 'mirror', 'coat-rack', 'wall-art'];

const shapeOf = (f: Pick<Furniture, 'model'>) => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);
const CORNER_SHAPES = new Set(['wardrobe', 'shelf', 'shower', 'bathtub', 'washer', 'plant', 'k-fridge', 'vacuum']);
/** Rooms where a table is a work or side table against a wall, not a free-standing dining table (#350). */
const WALL_TABLE_ROOMS = new Set<RoomType>(['bedroom', 'kids', 'office', 'hall', 'utility', 'bath']);
/** Free floor in front of furniture standing at a wall: walking space (#350). Hall: 90 cm, elsewhere 60 cm. */
const walkway = (type: RoomType) => (type === 'hall' ? 0.9 : type === 'bath' || type === 'utility' || type === 'balcony' ? 0.55 : 0.6);

type RoleInput = Pick<CatalogItem, 'name' | 'category' | 'model'> & { tags?: string[]; catalogId?: string; elevation?: number; height?: number };

function roleOf(f: RoleInput): Role {
  // placed items carry no tags: take them from their generic catalogue entry
  const item: RoleInput = (f.catalogId && findCatalogItem(f.catalogId)) || f;
  const shape = shapeOf(item);
  const tags = item.tags ?? [];
  if (shape === 'mattress') return 'mattress';
  if (item.category === 'bed') return shape === 'bed' ? 'bed' : 'nightstand';
  if (item.category === 'chair') return 'seat';
  if (shape === 'rug') return 'rug';
  if (shape === 'curtain') return 'curtain';
  if (shape === 'picture' || shape === 'wall-shelf') return 'wall-art';
  if (shape === 'coat-rack') return 'coat-rack';
  // a small mirror hangs (bath: above the washbasin); a tall one stands on the floor against a wall
  if (shape === 'panel' && (item.elevation ?? 0) >= 0.8) return 'mirror';
  if (shape === 'box' && item.category === 'storage' && (item.height ?? 1) <= 0.45) return 'box';
  if (shape === 'tv') return 'tv';
  if (shape === 'pendant') return 'pendant';
  if (shape === 'table-lamp') return 'table-lamp';
  if (shape === 'floor-lamp') return 'floor-lamp';
  if (item.category === 'table') return tags.includes('couchtisch') || /couchtisch|beistelltisch/i.test(item.name) ? 'coffee-table' : 'table';
  if (item.category === 'storage' && (tags.includes('tv') || /tv|lowboard/i.test(item.name))) return 'tv-board';
  if (shape === 'armchair') return 'armchair';
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

interface Span {
  t0: number;
  t1: number;
  window: boolean;
  /** Window: underside and top above the floor. */
  bottom: number;
  top: number;
}

interface Edge {
  a: Vec2;
  dir: Vec2;
  inward: Vec2;
  length: number;
  /** Doors and windows in this wall stretch (positions along the edge). */
  openings: Span[];
}

function roomEdges(poly: Vec2[], d?: DerivedPlan): Edge[] {
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
    const openings: Span[] = [];
    if (d) {
      for (const [wallId, list] of d.openings) {
        const fp = d.footprints.get(wallId);
        if (!fp) continue;
        for (const r of list) {
          const pa = add(fp.a, scale(fp.dir, r.s0));
          const pb = add(fp.a, scale(fp.dir, r.s1));
          // the opening lies in this edge's wall: its centre line is about half a wall thickness behind the edge
          const off = (p: Vec2) => Math.abs(dot(sub(p, a), inward));
          if (off(pa) > fp.thickness / 2 + 0.06 || off(pb) > fp.thickness / 2 + 0.06) continue;
          const ta = dot(sub(pa, a), dir);
          const tb = dot(sub(pb, a), dir);
          const t0 = Math.min(ta, tb);
          const t1 = Math.max(ta, tb);
          if (t1 < 0 || t0 > length) continue;
          openings.push({ t0: Math.max(0, t0), t1: Math.min(length, t1), window: r.opening.kind === 'window', bottom: r.bottom, top: r.top });
        }
      }
    }
    out.push({ a, dir, inward, length, openings });
  }
  return out;
}

const hasWindow = (e: Edge) => e.openings.some((o) => o.window);
const hasDoor = (e: Edge) => e.openings.some((o) => !o.window);

interface Zone {
  polygon: Vec2[];
  z0: number;
  z1: number;
  window: boolean;
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
      out.push({ polygon: [sub(pa, n), sub(pb, n), add(pb, n), add(pa, n)], z0: window ? r.bottom : 0, z1: r.top, window });
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

/** Why poses of the current item were rejected (for the „no place“ note). */
type Reject = 'outside' | 'opening' | 'walkway' | 'collision';

interface RoomCtx extends Ctx {
  roomId: string;
  type: RoomType;
  interior: Vec2[];
  edges: Edge[];
  centroid: Vec2;
  rejects: Set<Reject>;
  /** Living room with a dining place (#350): the half of the room the current piece's zone may use. */
  zone?: Vec2[];
}

/** Pieces of the seating group and of the dining place: a living room with both is split into two zones (#350). */
const LOUNGE_ROLES = new Set<Role>(['sofa', 'coffee-table', 'armchair', 'tv-board', 'tv', 'rug', 'floor-lamp']);
const DINING_ROLES = new Set<Role>(['table', 'seat', 'pendant']);

/** The part of `poly` on the side of the line through `p` where dot(x - p, n) <= 0 (Sutherland–Hodgman, one half-plane). */
function clipHalf(poly: Vec2[], p: Vec2, n: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const side = (x: Vec2) => dot(sub(x, p), n);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) out.push(add(a, scale(sub(b, a), sa / (sa - sb))));
  }
  return out;
}

/** The two halves of a room across its longest wall direction. */
function roomHalves(interior: Vec2[], edges: Edge[]): [Vec2[], Vec2[]] | null {
  const main = longestFirst(edges)[0];
  if (!main) return null;
  const ts = interior.map((q) => dot(sub(q, main.a), main.dir));
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  if (hi - lo < 4) return null;
  const mid = add(main.a, scale(main.dir, (lo + hi) / 2));
  return [clipHalf(interior, mid, main.dir), clipHalf(interior, mid, scale(main.dir, -1))];
}

const inRoom = (c: RoomCtx, f: Pick<Furniture, 'x' | 'y'>) => pointInPolygon({ x: f.x, y: f.y }, c.interior);
const roomItems = (c: RoomCtx) => c.draft.furniture.filter((f) => inRoom(c, f));

/** Whether the floor `need` metres in front of a floor item is still inside the room (walking space, #350). */
function frontFree(c: RoomCtx, f: Furniture, need: number): boolean {
  const fwd = frontOf(f);
  const right = rightOf(f);
  const front = add(f, scale(fwd, f.depth / 2 + need));
  for (const s of [-0.45, 0, 0.45]) {
    const p = add(front, scale(right, s * f.width));
    if (!pointInPolygon(p, c.interior)) return false;
  }
  return true;
}

/** Whether `f` can stand there: inside the room, openings free, no placement issue for it or caused by it. */
function fits(c: RoomCtx, f: Furniture, opts: { walkway?: number } = {}): boolean {
  const fc = furnitureCorners(f);
  const inset = fc.map((p) => add(p, scale(normalize(sub({ x: f.x, y: f.y }, p)), 0.003)));
  if (!inset.every((p) => pointInPolygon(p, c.interior)) || (c.zone && !inset.every((p) => pointInPolygon(p, c.zone!)))) {
    c.rejects.add('outside');
    return false;
  }
  const rug = f.category === 'textile' && f.height < 0.05;
  const curtain = shapeOf(f) === 'curtain';
  if (!rug) {
    // a small lamp on a nightstand next to a window does not block the window (#346); a curtain belongs there
    const lamp = shapeOf(f) === 'table-lamp';
    for (const z of c.zones) {
      if ((lamp || curtain) && z.window) continue;
      if (f.elevation >= z.z1 || f.elevation + f.height <= z.z0 + 0.02) continue;
      if (footprintsOverlap(fc, z.polygon, 1e-3)) {
        c.rejects.add('opening');
        return false;
      }
    }
  }
  if (opts.walkway && !frontFree(c, f, opts.walkway)) {
    c.rejects.add('walkway');
    return false;
  }
  c.draft.furniture.push(f);
  try {
    if (placementIssues(c.draft, c.derived, f, c.obstacles).length) {
      c.rejects.add('collision');
      return false;
    }
    // the new item must not take the space in front of doors/drawers of what is already there
    for (const o of c.draft.furniture) {
      if (o === f || frontClearance(o) <= 0 || dist(o, f) > 4) continue;
      if (placementIssues(c.draft, c.derived, o, c.obstacles).some((i) => i.refId === f.id)) {
        c.rejects.add('collision');
        return false;
      }
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

function firstFit(c: RoomCtx, poses: Iterable<Furniture>, opts?: { walkway?: number }): Furniture | null {
  for (const f of poses) if (fits(c, f, opts)) return f;
  return null;
}

/** Poses with the back against a wall: walls in the given order, stations ordered by `stationOrder`. */
function* wallPoses(item: CatalogItem, edges: Edge[], stationOrder: 'center' | 'corner' | ((e: Edge, t: number) => number), elevation?: number): Generator<Furniture> {
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
      yield withPose(item, c.x, c.y, rotation, elevation);
    }
  }
}

const longestFirst = (edges: Edge[]) => [...edges].sort((a, b) => b.length - a.length);
/** Walls without windows (and doors) first, each group longest first: beds, sofas and wardrobes need a closed wall. */
const closedFirst = (edges: Edge[]) => [...edges].sort((a, b) => Number(hasWindow(a)) + 0.5 * Number(hasDoor(a)) - (Number(hasWindow(b)) + 0.5 * Number(hasDoor(b))) || b.length - a.length);

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
/** A sized copy of a catalogue item (curtain to the window width, mattress to the bed). */
const sized = (item: CatalogItem, width: number, depth = item.depth, height = item.height): CatalogItem => ({ ...item, width: mm(width), depth: mm(depth), height: mm(height) });

/** Back-centre poses of `item` on the wall behind `anchor` (picture above the sofa, mirror above the washbasin). */
function* aboveAnchor(item: CatalogItem, anchors: Furniture[], elevation: (a: Furniture) => number): Generator<Furniture> {
  for (const a of anchors) {
    const back = sub(a, scale(frontOf(a), a.depth / 2));
    const p = add(back, scale(frontOf(a), item.depth / 2 + 0.005));
    yield withPose(item, p.x, p.y, a.rotation, elevation(a));
  }
}

function placeItem(c: RoomCtx, item: CatalogItem, role: Role, companions: CatalogItem[]): Furniture | null {
  const edges = longestFirst(c.edges);
  const walk = { walkway: walkway(c.type) };
  switch (role) {
    case 'bed': {
      const order = closedFirst(c.edges);
      // keep room for the wished nightstands on both sides; without them if that does not fit
      const ns = companions.find((x) => roleOf(x) === 'nightstand');
      if (ns) {
        const extra = 2 * (ns.width + 0.03);
        const probe: CatalogItem = { ...item, width: item.width + extra };
        for (const pose of wallPoses(probe, order, 'center')) {
          if (!fits(c, pose)) continue;
          const bed = withPose(item, pose.x, pose.y, pose.rotation);
          if (fits(c, bed, walk)) return bed;
        }
      }
      return firstFit(c, wallPoses(item, order, 'center'), walk);
    }
    case 'sofa': {
      // in a split living room the sofa faces along the room, so the TV wall lies in the same half
      const main = longestFirst(c.edges)[0];
      const order = c.zone && main ? [...closedFirst(c.edges)].sort((a, b) => Math.abs(dot(b.dir, main.dir)) - Math.abs(dot(a.dir, main.dir))) : closedFirst(c.edges);
      return firstFit(c, wallPoses(item, order, 'center'), walk);
    }
    case 'corner':
      return firstFit(c, wallPoses(item, c.type === 'utility' || c.type === 'bath' ? edges : closedFirst(c.edges), 'corner'), walk) ?? firstFit(c, wallPoses(item, edges, 'corner'));
    case 'wall': {
      // desks and work tables like the light of a window; everything else a closed wall
      const desk = item.category === 'desk' || item.category === 'table';
      const order = desk ? [...c.edges].sort((a, b) => Number(hasWindow(b)) - Number(hasWindow(a)) || b.length - a.length) : closedFirst(c.edges);
      return firstFit(c, wallPoses(item, order, 'center'), walk);
    }
    case 'tv-board': {
      const sofa = findIn(c, (f) => roleOf(f) === 'sofa')[0];
      if (!sofa) return firstFit(c, wallPoses(item, edges, 'center'), walk);
      // opposite the sofa, centred on its axis
      const fwd = frontOf(sofa);
      const facing = [...c.edges].sort((a, b) => dot(a.inward, fwd) - dot(b.inward, fwd));
      const axis = (e: Edge, t: number) => Math.abs(dot(sub(add(e.a, scale(e.dir, t)), sofa), rightOf(sofa)));
      return firstFit(c, wallPoses(item, facing, axis), walk);
    }
    case 'table':
      // bedroom, office … (#350): a table is a work or side table at a wall, never in the middle of the room
      if (WALL_TABLE_ROOMS.has(c.type)) return placeItem(c, item, 'wall', companions);
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
    case 'armchair': {
      // seating group (#350): beside the coffee table, turned towards it; otherwise at a wall facing the room
      const ct = findIn(c, (f) => roleOf(f) === 'coffee-table')[0];
      const poses = function* () {
        if (ct) {
          for (const s of [1, -1]) {
            for (const gap of [0.35, 0.45, 0.25]) {
              const side = scale(rightOf(ct), s);
              const p = add(ct, scale(side, ct.width / 2 + gap + item.depth / 2));
              yield withPose(item, p.x, p.y, rotationFacing(scale(side, -1)));
            }
          }
        }
        yield* wallPoses(item, closedFirst(c.edges), 'corner');
      };
      return firstFit(c, poses());
    }
    case 'seat':
      return firstFit(c, seatPoses(c, item));
    case 'floor-lamp': {
      // reading light beside the sofa or armchair, else a corner
      const seats = findIn(c, (f) => roleOf(f) === 'sofa' || roleOf(f) === 'armchair' || roleOf(f) === 'bed');
      const poses = function* () {
        for (const s of seats) {
          const back = sub(s, scale(frontOf(s), s.depth / 2));
          for (const side of [1, -1]) {
            const p = add(add(back, scale(rightOf(s), side * (s.width / 2 + item.width / 2 + 0.05))), scale(frontOf(s), item.depth / 2 + 0.02));
            yield withPose(item, p.x, p.y, s.rotation);
          }
        }
        yield* wallPoses(item, edges, 'corner');
      };
      return firstFit(c, poses());
    }
    case 'rug': {
      const ct = findIn(c, (f) => roleOf(f) === 'coffee-table')[0];
      const sofa = findIn(c, (f) => roleOf(f) === 'sofa')[0];
      const bed = findIn(c, (f) => roleOf(f) === 'bed')[0];
      const basin = findIn(c, (f) => shapeOf(f) === 'washbasin')[0];
      const table = findIn(c, (f) => roleOf(f) === 'table')[0];
      const poses = function* () {
        if (ct && sofa) {
          // long side parallel to the sofa, under the coffee table
          for (const r of [sofa.rotation + Math.PI / 2, sofa.rotation]) yield withPose(item, ct.x, ct.y, r);
        }
        if (basin) {
          const p = add(basin, scale(frontOf(basin), basin.depth / 2 + item.depth / 2 + 0.02));
          yield withPose(item, p.x, p.y, basin.rotation);
        }
        if (table && c.type === 'balcony') yield withPose(item, table.x, table.y, table.rotation);
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
    case 'mattress': {
      // on the bed frame (#350): sized to it, lying on the slats
      const beds = findIn(c, (f) => roleOf(f) === 'bed' && !findIn(c, (m) => roleOf(m) === 'mattress' && dist(m, f) < 0.2).length);
      return firstFit(c, (function* () {
        for (const b of beds) {
          const m = sized(item, Math.min(item.width, b.width - 0.04), Math.min(item.depth, b.depth - 0.06));
          const p = add(b, scale(frontOf(b), 0.02));
          yield withPose(m, p.x, p.y, b.rotation, Math.min(0.25, Math.max(0.08, b.height - m.height - 0.05)));
        }
      })());
    }
    case 'box':
      return firstFit(c, boxPoses(c, item));
    case 'curtain':
      return firstFit(c, curtainPoses(c, item));
    case 'mirror': {
      const basins = findIn(c, (f) => shapeOf(f) === 'washbasin');
      return firstFit(c, (function* () {
        yield* aboveAnchor(item, basins, (b) => Math.max(item.elevation ?? 0, b.elevation + b.height + 0.25));
        yield* wallPoses(item, closedFirst(c.edges), 'center', item.elevation ?? 1.15);
      })());
    }
    case 'coat-rack': {
      // close to the entrance door
      const doors = c.edges.flatMap((e) => e.openings.filter((o) => !o.window).map((o) => add(e.a, scale(e.dir, (o.t0 + o.t1) / 2))));
      const near = (e: Edge, t: number) => (doors.length ? Math.min(...doors.map((d) => dist(add(e.a, scale(e.dir, t)), d))) : Math.abs(t - e.length / 2));
      return firstFit(c, wallPoses(item, edges, near, item.elevation ?? 1.6));
    }
    case 'wall-art': {
      // above the sofa, the bed, a sideboard or desk; otherwise centred on a free wall
      const anchors = findIn(c, (f) => ['sofa', 'bed', 'tv-board'].includes(roleOf(f)) || ['dresser', 'cabinet', 'desk'].includes(shapeOf(f)) || f.category === 'desk')
        .filter((a) => a.height < 1.3 && a.elevation < 0.1)
        .sort((a, b) => ROLE_ORDER.indexOf(roleOf(a)) - ROLE_ORDER.indexOf(roleOf(b)) || b.width - a.width);
      return firstFit(c, (function* () {
        yield* aboveAnchor(item, anchors, (a) => Math.max(item.elevation ?? 1.35, a.elevation + a.height + (roleOf(a) === 'bed' ? 0.25 : 0.3)));
        yield* wallPoses(item, closedFirst(c.edges), 'center', item.elevation ?? 1.4);
      })());
    }
  }
}

/** Curtain in front of every window: a bit wider than the window, rod just above its top edge, hanging down to just below the sill (to the floor at a floor-length window). */
function* curtainPoses(c: RoomCtx, item: CatalogItem): Generator<Furniture> {
  const hung = findIn(c, (f) => roleOf(f) === 'curtain');
  for (const e of c.edges) {
    for (const o of e.openings) {
      if (!o.window) continue;
      const w = Math.min(e.length - 0.02, o.t1 - o.t0 + 0.3);
      const mid = Math.min(Math.max((o.t0 + o.t1) / 2, w / 2 + 0.01), e.length - w / 2 - 0.01);
      const p = add(add(e.a, scale(e.dir, mid)), scale(e.inward, item.depth / 2 + 0.06));
      if (hung.some((h) => dist(h, p) < 0.3)) continue;
      const floorLength = o.bottom < 0.05;
      const low = floorLength ? 0 : Math.max(0, o.bottom - 0.15);
      const rod = Math.max(low + 0.4, o.top + 0.1);
      yield withPose(sized(item, w, item.depth, rod - low), p.x, p.y, rotationFacing(e.inward), low);
    }
  }
}

/** Storage boxes go onto the free boards of open shelves (#350), else on a low surface – never loose on the floor. */
function* boxPoses(c: RoomCtx, item: CatalogItem): Generator<Furniture> {
  const shelves = findIn(c, (f) => shapeOf(f) === 'shelf' && f.depth >= item.depth - 0.02 && f.width >= item.width + 0.04);
  for (const s of shelves) {
    // board heights as drawn by `ProceduralModel` ('shelf'): n = round(h / 0.36) boards; books stand on the even ones
    const t = 0.018;
    const n = Math.max(2, Math.round(s.height / 0.36));
    const per = Math.max(1, Math.floor((s.width - 0.04) / (item.width + 0.02)));
    for (let i = 1; i < n; i += 2) {
      const y = s.elevation + Math.min(s.height - t, (i * (s.height - t)) / n) + t;
      if ((s.height - t) / n - t < item.height + 0.02) continue;
      for (let k = 0; k < per; k++) {
        const x = -s.width / 2 + 0.02 + (k + 0.5) * ((s.width - 0.04) / per);
        const p = add(add(s, scale(rightOf(s), x)), scale(frontOf(s), (s.depth - item.depth) / 2 - 0.005));
        yield withPose(item, p.x, p.y, s.rotation, y);
      }
    }
  }
  const surfaces = findIn(c, (f) => isSurface(f) && f.category !== 'table' && f.category !== 'desk' && f.width >= item.width && f.depth >= item.depth);
  for (const s of surfaces) yield withPose(item, s.x, s.y, s.rotation, s.elevation + s.height);
}

/** Table poses near the centre that leave room for chairs on the long sides (~60 cm). */
function* tablePoses(c: RoomCtx, item: CatalogItem): Generator<Furniture> {
  const round = shapeOf(item) === 'table-round';
  // balcony: two chairs at the ends are enough, the table stands along the balcony
  const probe: CatalogItem =
    c.type === 'balcony' ? { ...item, width: item.width + 1.0, category: 'table' } : { ...item, width: item.width + (round ? 1.2 : 0.3), depth: item.depth + 1.2, category: 'table' };
  // living room with a seating group (#350): the dining place is its own zone, not squeezed against the sofa
  const lounge = c.zone ? [] : findIn(c, (f) => roleOf(f) === 'sofa' || roleOf(f) === 'coffee-table');
  const center = c.zone ? polygonCentroid(c.zone) : lounge.length ? add(c.centroid, scale(normalize(sub(c.centroid, lounge[0])), 1)) : c.centroid;
  for (const pose of centerPoses(c, item, center)) {
    if (lounge.some((l) => dist(l, pose) < 1.2 + (l.width + item.width) / 4)) continue;
    // the enlarged footprint must fit, too: walls, doors and other furniture leave room for chairs
    if (!fits(c, createFurnitureFromCatalog(probe, pose))) continue;
    yield pose;
  }
  // small rooms (balcony, kitchen): a table at the wall still leaves room for chairs at its sides
  if (c.type === 'balcony' || c.type === 'kitchen' || round) yield* wallPoses(item, closedFirst(c.edges), 'center');
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
      // opposite pairs first: two chairs sit face to face (balcony, #350)
      for (const k of [1, 3, 0, 2, 4, 5, 6, 7]) {
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

const cmText = (v: number) => `${Math.round(v * 100)}`;

/** Why an item found no place, with a way out (#350). */
function missingReason(c: RoomCtx, item: CatalogItem, role: Role): string {
  const b = boundsOf(c.interior);
  const span = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 0;
  const narrow = b ? Math.min(b.maxX - b.minX, b.maxY - b.minY) : 0;
  const size = `${cmText(item.width)}×${cmText(item.depth)} cm`;
  if (role === 'box') return 'kein Regal mit freiem Fach im Raum – erst ein Regal einplanen oder die Box weglassen';
  if (role === 'mattress') return 'kein Bettgestell im Raum';
  if (role === 'curtain') return 'kein freies Fenster im Raum';
  if (Math.max(item.width, item.depth) > span || Math.min(item.width, item.depth) > narrow) return `zu groß für den Raum (${size}) – eine kleinere Alternative wählen`;
  if (c.rejects.has('walkway') && !c.rejects.has('collision')) return `würde den Laufweg zustellen (${cmText(walkway(c.type))} cm frei vor dem Möbel nötig) – schmaleres Modell wählen oder weglassen`;
  if (c.rejects.has('opening') && !c.rejects.has('collision')) return 'nur vor Türen oder Fenstern wäre Platz – weglassen oder kleiner wählen';
  return `zwischen Wänden, Türen, Fenstern und den anderen Möbeln ist kein Platz mehr (${size}) – kleinere Alternative wählen oder ein anderes Möbel weglassen`;
}

export interface SuggestOptions {
  /** Furniture of an earlier suggestion that this one replaces (#350): ignored while placing, removed when applied. */
  replace?: string[];
}

/** Items of an earlier, applied suggestion standing in the given rooms (#350): a new preview replaces them. */
export function suggestedIn(project: Project, roomIds: string[], d: DerivedPlan = derivePlan(project)): string[] {
  const rooms = new Set(roomIds);
  return project.furniture.filter((f) => f.suggested && !f.locked && rooms.has(roomIdAt(project, d, f) ?? '')).map((f) => f.id);
}

/**
 * Builds a suggestion for the requested rooms. Existing furniture stays and is respected;
 * items are placed one after another, so later items avoid the earlier proposed ones.
 */
export function suggestFurnishing(project: Project, requests: RoomRequest[], catalog: CatalogItem[] = [], opts: SuggestOptions = {}): FurnishingSuggestion {
  const derived = derivePlan(project);
  const replace = new Set(opts.replace ?? []);
  const draft = structuredClone(project);
  draft.furniture = draft.furniture.filter((f) => !replace.has(f.id));
  const ctx: Ctx = { draft, derived, obstacles: buildPlacementObstacles(derived), zones: openingZones(derived) };
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
    const out: RoomSuggestion = { roomId: room.id, roomName: room.name, type: req.type, placed: [], missing: [], notes: [] };
    rooms.push(out);
    if (!g) {
      out.missing.push(...pieces.map((p) => p.item.name));
      out.notes!.push(...pieces.map((p) => ({ name: p.item.name, why: 'der Raum hat keine geschlossenen Wände' })));
      continue;
    }
    const rc: RoomCtx = { ...ctx, roomId: room.id, type: req.type, interior: g.interior, edges: roomEdges(g.interior, derived), centroid: polygonCentroid(g.interior), rejects: new Set() };
    const companions = pieces.map((p) => p.item);
    const base = ctx.draft.furniture.length;
    const attempt = (zones: [Vec2[], Vec2[]] | null) => {
      ctx.draft.furniture.length = base;
      const placed: Furniture[] = [];
      const notes: { name: string; why: string }[] = [];
      for (const { item, role } of pieces) {
        rc.rejects = new Set();
        rc.zone = zones ? (LOUNGE_ROLES.has(role) ? zones[0] : DINING_ROLES.has(role) && shapeOf(item) !== 'office-chair' ? zones[1] : undefined) : undefined;
        const f = placeItem(rc, item, role, companions);
        rc.zone = undefined;
        if (f) {
          f.suggested = true;
          ctx.draft.furniture.push(f);
          placed.push(f);
        } else notes.push({ name: item.name, why: missingReason(rc, item, role) });
      }
      return { placed, notes, items: ctx.draft.furniture.slice(base) };
    };
    // living room with seating group and dining table (#350): one half each, both ways round, plain as fallback
    const halves = (req.type === 'living' || req.type === 'dining') && pieces.some((p) => p.role === 'sofa') && pieces.some((p) => p.role === 'table') ? roomHalves(g.interior, rc.edges) : null;
    const tries = halves ? [halves, [halves[1], halves[0]] as [Vec2[], Vec2[]], null] : [null];
    let best: ReturnType<typeof attempt> | null = null;
    for (const z of tries) {
      const r = attempt(z);
      if (!best || r.notes.length < best.notes.length) best = r;
      if (!r.notes.length) break;
    }
    ctx.draft.furniture.length = base;
    ctx.draft.furniture.push(...best!.items);
    out.placed.push(...best!.placed);
    out.notes!.push(...best!.notes);
    out.missing.push(...best!.notes.map((n) => n.name));
  }
  return { rooms, items: rooms.flatMap((r) => r.placed), replaces: [...replace] };
}

export function applyFurnishing(d: Project, s: FurnishingSuggestion): string[] {
  // taking the same suggestion twice must not create a second item with the same id (#268)
  const gone = new Set(s.replaces ?? []);
  if (gone.size) d.furniture = d.furniture.filter((f) => !gone.has(f.id));
  const taken = new Set(d.furniture.map((f) => f.id));
  const ids: string[] = [];
  for (const f of s.items) {
    const item = structuredClone(f);
    if (taken.has(item.id)) item.id = newId('item');
    taken.add(item.id);
    d.furniture.push(item);
    ids.push(item.id);
  }
  return ids;
}

/** Sum of the proposed items' prices (guide values of the generic catalogue). */
export function suggestionTotal(s: FurnishingSuggestion): number {
  return s.items.reduce((sum, f) => sum + (f.price?.amount ?? 0) * f.quantity, 0);
}

/** Where a plan edit (#415) wants a piece: at a room wall (interior edge a→b) and/or close to a point. */
export interface PlaceTarget {
  wall?: { a: Vec2; b: Vec2 };
  near?: Vec2;
}

/** Roles that stand free in the room rather than with the back against a wall. */
const FREE_ROLES = new Set<Role>(['table', 'coffee-table', 'rug', 'armchair', 'seat', 'pendant']);

/**
 * Plan edit by Claude (#415): the free place for `item` in room `roomId` closest to `target`, with
 * the checks of the furnishing suggestion (inside the room, doors and windows free, no collision,
 * space in front). `item` keeps its id and properties, only its pose changes; it is not
 * respected itself, nor is the furniture in `ignore`. `onTarget` is false when the wanted wall had
 * no place and another wall was taken. Nothing in `project` is changed.
 */
export function placeNear(project: Project, roomId: string, type: RoomType, item: Furniture, target: PlaceTarget, ignore: string[] = []): { furniture: Furniture; onTarget: boolean } | null {
  const derived = derivePlan(project);
  const g = derived.rooms.get(roomId);
  if (!g) return null;
  const skip = new Set([item.id, ...ignore]);
  const draft = structuredClone(project);
  draft.furniture = draft.furniture.filter((f) => !skip.has(f.id));
  const edges = roomEdges(g.interior, derived);
  const rc: RoomCtx = { draft, derived, obstacles: buildPlacementObstacles(derived), zones: openingZones(derived), roomId, type, interior: g.interior, edges, centroid: polygonCentroid(g.interior), rejects: new Set() };
  const wall = target.wall;
  const near = target.near ?? (wall ? scale(add(wall.a, wall.b), 0.5) : rc.centroid);
  const edgeEnd = (e: Edge) => add(e.a, scale(e.dir, e.length));
  const isWall = (e: Edge) => !!wall && dist(scale(add(e.a, edgeEnd(e)), 0.5), scale(add(wall.a, wall.b), 0.5)) < 0.05;
  const toEdge = (e: Edge) => {
    const t = Math.max(0, Math.min(e.length, dot(sub(near, e.a), e.dir)));
    return dist(add(e.a, scale(e.dir, t)), near);
  };
  const ordered = [...edges].sort((p, q) => toEdge(p) - toEdge(q));
  const wanted = ordered.filter(isWall);
  const rest = wall ? ordered.filter((e) => !isWall(e)) : ordered;
  const asItem: CatalogItem = { id: item.catalogId ?? item.id, name: item.name, category: item.category, width: item.width, depth: item.depth, height: item.height, color: item.color, model: item.model, elevation: item.elevation, solid: item.solid, approximate: item.approximate, tags: [], source: 'generic' };
  const station = (e: Edge, t: number) => dist(add(e.a, scale(e.dir, t)), near);
  const posed = function* (poses: Iterable<Furniture>) {
    for (const p of poses) yield { ...structuredClone(item), x: p.x, y: p.y, rotation: p.rotation };
  };
  const free = FREE_ROLES.has(roleOf({ ...item, tags: [] })) && !wall;
  const first = (poses: () => Iterable<Furniture>) => firstFit(rc, posed(poses()), { walkway: walkway(type) }) ?? firstFit(rc, posed(poses()));
  if (wanted.length) {
    const f = first(() => wallPoses(asItem, wanted, station, item.elevation));
    if (f) return { furniture: f, onTarget: true };
  }
  const f = first(function* () {
    if (free) yield* centerPoses(rc, asItem, near);
    yield* wallPoses(asItem, rest, station, item.elevation);
    if (!free) yield* centerPoses(rc, asItem, near);
  });
  return f ? { furniture: f, onTarget: !wall } : null;
}
