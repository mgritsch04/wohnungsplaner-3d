import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { furnitureCorners, footprintsOverlap } from '../editor2d/furnitureGeometry';
import { derivePlan, type DerivedPlan } from '../model/derived';
import { newId } from '../model/ids';
import type { Furniture, Project } from '../model/schema';
import { roundMm } from '../model/units';
import { add, dot, scale, sub, type Vec2 } from '../model/vec';
import { pruneGroups } from '../model/groups';
import type { ResolvedOpening, WallFootprint } from '../model/geometry/walls';
import { buildPlacementObstacles, collidingObstacles, furnitureObstacles, type Obstacle } from '../model/placement';

/**
 * Modular kitchen planning on top of the shared furniture model.
 * Kitchen modules are ordinary furniture items with a `kitchen` descriptor,
 * so they appear in 2D, 3D, collisions and the budget automatically.
 * This is a design aid – it does not check electrical, plumbing or ventilation rules.
 */
export const COUNTERTOP_THICKNESS = 0.04;
export const COUNTERTOP_DEPTH = 0.62;
export const COUNTERTOP_PRICE_PER_M = 120;

export interface RunModule {
  catalogId: string;
  /** Optional width override in meters. */
  width?: number;
}

export interface PlaceRunInput {
  wallId: string;
  /** +1 = left side of the wall (a→b), -1 = right side. */
  side: 1 | -1;
  /**
   * Start position along the wall (meters), measured from the start of the wall face on
   * `side` – at a room corner that is the inner corner, not the centreline node (#16).
   */
  start: number;
  modules: RunModule[];
  frontColor?: string;
}

/**
 * Where the face of the wall on `side` begins and ends along the wall direction, measured from
 * the centreline start `a` (meters). At a corner the face is shorter than the centreline by
 * the connected wall's thickness: starting there keeps the first module out of that wall.
 */
export function wallFaceRange(fp: Pick<WallFootprint, 'a' | 'dir' | 'polygon'>, side: 1 | -1): { s0: number; s1: number } {
  // polygon = [leftA, leftB, rightB, rightA], "left" = +normal = side 1
  const [p0, p1] = side === 1 ? [fp.polygon[0], fp.polygon[1]] : [fp.polygon[3], fp.polygon[2]];
  return { s0: dot(sub(p0, fp.a), fp.dir), s1: dot(sub(p1, fp.a), fp.dir) };
}

/** Modules that hang above the run (or sit in the countertop) and do not advance it. */
const ABOVE_TYPES = new Set(['wall', 'hood', 'cooktop']);
/** Allowed penetration (m) before a module counts as blocked – covers mm rounding at flush corners. */
const TOUCH_TOL = 0.002;

export interface RunSlot {
  catalogId: string;
  name: string;
  /** The module at its place along the wall (not yet in the project). */
  furniture: Furniture;
  /** Why the module cannot be placed there, or null when it stands free. */
  problem: string | null;
}

export interface RunLayout {
  slots: RunSlot[];
  /** Usable face range along the wall (from the centreline start, metres), unconnected cross walls excluded. */
  range: { s0: number; s1: number };
}

/** Wall obstacles that do not belong to the wall the run stands on. */
function otherWallObstacles(derived: DerivedPlan, wallId: string): Obstacle[] {
  return buildPlacementObstacles(derived).filter((o) => o.kind === 'wall' && o.refId !== wallId);
}

/** Projection interval of a polygon onto a direction. */
function projRange(poly: Vec2[], origin: Vec2, dir: Vec2): [number, number] {
  const ps = poly.map((q) => dot(sub(q, origin), dir));
  return [Math.min(...ps), Math.max(...ps)];
}

/**
 * Usable range of the wall face on `side` (#220): the face range from the wall polygon, further
 * shortened by cross walls that stand in front of it without being connected in the plan
 * (typical after a floor-plan import, where walls only touch or overlap).
 */
export function usableFaceRange(derived: DerivedPlan, wallId: string, side: 1 | -1, depth = 0.6, height = 2.1): { s0: number; s1: number } | null {
  const fp = derived.footprints.get(wallId);
  if (!fp) return null;
  const face = wallFaceRange(fp, side);
  let s0 = Math.min(face.s0, face.s1);
  let s1 = Math.max(face.s0, face.s1);
  const walls = otherWallObstacles(derived, wallId);
  const normal = scale(fp.normal, side);
  const rotation = Math.atan2(fp.dir.y, fp.dir.x) + (side === 1 ? 0 : Math.PI);
  // a probe strip in front of the face between stations a and b (shrunk by the touch tolerance)
  const probe = (a: number, b: number) => {
    const c = add(add(fp.a, scale(fp.dir, (a + b) / 2)), scale(normal, fp.thickness / 2 + depth / 2 + TOUCH_TOL));
    return { x: c.x, y: c.y, rotation, width: Math.max(0.001, b - a - 2 * TOUCH_TOL), depth: depth - 2 * TOUCH_TOL, elevation: 0, height };
  };
  // cross walls covering the start push it past them; the first one further along ends the face
  for (let i = 0; i < 8 && s1 > s0; i++) {
    const hits = collidingObstacles(probe(s0, s1), walls).map((o) => projRange(o.polygon, fp.a, fp.dir));
    const covering = hits.filter(([lo]) => lo <= s0 + TOUCH_TOL);
    if (covering.length) {
      s0 = Math.max(...covering.map(([, hi]) => hi));
      continue;
    }
    if (hits.length) s1 = Math.min(s1, ...hits.map(([lo]) => lo));
    break;
  }
  return { s0, s1: Math.max(s0, s1) };
}

/**
 * Lay out a row of kitchen modules flush against a wall face (back side on the face, wall
 * thickness taken into account), starting at the face's inner corner – also when the cross wall
 * is not connected (#16, #220). Nothing is changed: every module gets its place and, if it does
 * not stand free there, the reason (wall, door/window opening, door leaf, other furniture, or
 * past the end of the wall). Blocked modules keep their slot, so the rest of the run stays put.
 */
export function layoutKitchenRun(d: Project, input: PlaceRunInput, derived: DerivedPlan = derivePlan(d)): RunLayout {
  const fp = derived.footprints.get(input.wallId);
  if (!fp) throw new Error('Wand nicht gefunden');
  const rotation = Math.atan2(fp.dir.y, fp.dir.x) + (input.side === 1 ? 0 : Math.PI);
  const normal = scale(fp.normal, input.side);
  const range = usableFaceRange(derived, input.wallId, input.side) ?? wallFaceRange(fp, input.side);
  const walls = buildPlacementObstacles(derived).filter((o) => o.kind !== 'furniture');
  const openings = derived.openings.get(input.wallId) ?? [];
  const accepted: Furniture[] = [];
  const slots: RunSlot[] = [];
  let along = range.s0 + input.start;
  for (const m of input.modules) {
    const item = findCatalogItem(m.catalogId);
    if (!item) continue;
    const width = m.width ?? item.width;
    const center = add(add(fp.a, scale(fp.dir, along + width / 2)), scale(normal, fp.thickness / 2 + item.depth / 2 + 0.002));
    const f = createFurnitureFromCatalog({ ...item, width }, { x: roundMm(center.x), y: roundMm(center.y), rotation });
    if (f.kitchen && input.frontColor) f.kitchen.frontColor = input.frontColor;
    slots.push({ catalogId: m.catalogId, name: f.name, furniture: f, problem: runProblem(d, f, along, width, range, walls, openings, accepted) });
    if (!slots[slots.length - 1].problem) accepted.push(f);
    // wall cabinets and hoods hang above base cabinets and do not advance the run
    if (!(item.kitchen && ABOVE_TYPES.has(item.kitchen.type))) along += width;
  }
  return { slots, range };
}

function runProblem(
  d: Project,
  f: Furniture,
  along: number,
  width: number,
  range: { s0: number; s1: number },
  walls: Obstacle[],
  openings: ResolvedOpening[],
  accepted: Furniture[],
): string | null {
  if (along + width > range.s1 + TOUCH_TOL) return 'passt nicht mehr auf die Wand (Zeile zu lang)';
  const z0 = f.elevation;
  const z1 = f.elevation + f.height;
  // a door or window in the wall the run stands on: the module would stand in front of the opening
  for (const r of openings) {
    const lo = Math.min(r.s0, r.s1);
    const hi = Math.max(r.s0, r.s1);
    if (Math.min(along + width, hi) - Math.max(along, lo) > TOUCH_TOL && Math.min(z1, r.top) - Math.max(z0, r.bottom) > 0.005) {
      return r.opening.kind === 'window' ? 'steht vor einem Fenster' : 'steht vor einer Tür';
    }
  }
  // shrink by the touch tolerance so flush neighbours and corners (mm rounding) do not count
  const probe = { ...f, width: f.width - 2 * TOUCH_TOL, depth: f.depth - 2 * TOUCH_TOL };
  const hit = collidingObstacles(probe, walls)[0];
  if (hit) return hit.kind === 'wall' ? 'würde in eine Wand ragen' : 'steht im geöffneten Türblatt';
  if (f.solid !== false) {
    const others = furnitureObstacles({ ...d, furniture: [...d.furniture, ...accepted] }, f);
    const o = collidingObstacles(probe, others)[0];
    if (o) {
      const other = [...d.furniture, ...accepted].find((x) => x.id === o.refId);
      return `überschneidet sich mit „${other?.name ?? 'einem Möbel'}“`;
    }
  }
  return null;
}

/**
 * Place a row of kitchen modules (see `layoutKitchenRun`). Only modules that stand free are
 * added; the others are returned in `skipped` with the reason (#220). Returns created item ids.
 */
export function placeKitchenRun(d: Project, input: PlaceRunInput): string[] {
  return placeKitchenRunReport(d, input).ids;
}

export function placeKitchenRunReport(d: Project, input: PlaceRunInput): { ids: string[]; skipped: { name: string; problem: string }[] } {
  const layout = layoutKitchenRun(d, input);
  const ids: string[] = [];
  const skipped: { name: string; problem: string }[] = [];
  for (const s of layout.slots) {
    if (s.problem) {
      skipped.push({ name: s.name, problem: s.problem });
      continue;
    }
    d.furniture.push(s.furniture);
    ids.push(s.furniture.id);
  }
  return { ids, skipped };
}

const FLOOR_TYPES = new Set(['base', 'sink', 'dishwasher', 'oven']);

/** Remove previously generated countertops and create new ones over contiguous base modules. */
export function generateCountertops(d: Project): number {
  d.furniture = d.furniture.filter((f) => !(f.kitchen?.type === 'countertop' && f.kitchen.generated));
  pruneGroups(d);
  const base = d.furniture.filter((f) => f.kitchen && FLOOR_TYPES.has(f.kitchen.type) && f.elevation < 0.01);
  const groups: Furniture[][] = [];
  for (const f of base) {
    const g = groups.find((grp) => {
      const r = grp[0];
      const sameRot = Math.abs(Math.sin(f.rotation - r.rotation)) < 1e-3 && Math.cos(f.rotation - r.rotation) > 0;
      if (!sameRot) return false;
      const n = { x: -Math.sin(r.rotation), y: Math.cos(r.rotation) };
      const backF = dot({ x: f.x, y: f.y }, n) - f.depth / 2;
      const backR = dot({ x: r.x, y: r.y }, n) - r.depth / 2;
      return Math.abs(backF - backR) < 0.02;
    });
    if (g) g.push(f);
    else groups.push([f]);
  }
  let created = 0;
  for (const grp of groups) {
    const r = grp[0];
    const dir = { x: Math.cos(r.rotation), y: Math.sin(r.rotation) };
    const n = { x: -Math.sin(r.rotation), y: Math.cos(r.rotation) };
    const items = grp
      .map((f) => ({ f, s0: dot({ x: f.x, y: f.y }, dir) - f.width / 2, s1: dot({ x: f.x, y: f.y }, dir) + f.width / 2 }))
      .sort((p, q) => p.s0 - q.s0);
    let run: typeof items = [];
    const flush = () => {
      if (!run.length) return;
      const s0 = run[0].s0;
      const s1 = Math.max(...run.map((x) => x.s1));
      const back = dot({ x: r.x, y: r.y }, n) - r.depth / 2;
      const top = Math.max(...run.map((x) => x.f.elevation + x.f.height));
      const len = s1 - s0;
      const centerAlong = (s0 + s1) / 2;
      const centerAcross = back + COUNTERTOP_DEPTH / 2;
      const c = add(scale(dir, centerAlong), scale(n, centerAcross));
      d.furniture.push({
        id: newId('item'),
        name: `Arbeitsplatte ${Math.round(len * 100)} cm`,
        category: 'kitchen',
        x: roundMm(c.x),
        y: roundMm(c.y),
        elevation: roundMm(top),
        rotation: r.rotation,
        width: roundMm(len),
        depth: COUNTERTOP_DEPTH,
        height: COUNTERTOP_THICKNESS,
        color: '#d6d0c4',
        model: { type: 'procedural', shape: 'countertop' },
        quantity: 1,
        price: { amount: Math.round(len * COUNTERTOP_PRICE_PER_M), currency: 'EUR', status: 'estimate' },
        approximate: true,
        solid: true,
        kitchen: { type: 'countertop', front: 'open', generated: true },
        locked: false,
      });
      created++;
      run = [];
    };
    for (const it of items) {
      if (run.length && it.s0 - Math.max(...run.map((x) => x.s1)) > 0.01) flush();
      run.push(it);
    }
    flush();
  }
  return created;
}

function verticalOverlap(a: Furniture, b: Furniture) {
  return Math.min(a.elevation + a.height, b.elevation + b.height) - Math.max(a.elevation, b.elevation) > 0.005;
}

/** Overlap and wall-collision warnings for one item (used for kitchen modules). */
export function kitchenChecksForItem(p: Project, id: string): string[] {
  const f = p.furniture.find((x) => x.id === id);
  if (!f) return [];
  const out: string[] = [];
  const fc = furnitureCorners(f);
  for (const o of p.furniture) {
    if (o.id === f.id || !verticalOverlap(f, o)) continue;
    if (o.category === 'textile') continue;
    if (footprintsOverlap(fc, furnitureCorners(o), 0.003)) out.push(`Überschneidet sich mit „${o.name}“.`);
  }
  const derived = derivePlan(p);
  for (const fp of derived.footprints.values()) {
    if (footprintsOverlap(fc, fp.polygon, 0.003)) {
      out.push('Ragt in eine Wand.');
      break;
    }
  }
  return out;
}

export interface KitchenComponent {
  label: string;
  count: number;
  total: number;
  missingPrices: number;
}

const TYPE_LABEL: Record<string, string> = {
  base: 'Unterschränke',
  wall: 'Oberschränke',
  tall: 'Hochschränke',
  sink: 'Spülenschränke',
  oven: 'Backöfen',
  cooktop: 'Kochfelder',
  fridge: 'Kühlgeräte',
  dishwasher: 'Geschirrspüler',
  countertop: 'Arbeitsplatten',
  hood: 'Dunstabzüge',
};

export function kitchenComponents(p: Project): { components: KitchenComponent[]; total: number; countertopLength: number } {
  const map = new Map<string, KitchenComponent>();
  let countertopLength = 0;
  for (const f of p.furniture) {
    if (!f.kitchen) continue;
    const label = TYPE_LABEL[f.kitchen.type] ?? f.kitchen.type;
    const c = map.get(label) ?? { label, count: 0, total: 0, missingPrices: 0 };
    c.count += f.quantity;
    if (f.price) c.total += f.price.amount * f.quantity;
    else c.missingPrices++;
    map.set(label, c);
    if (f.kitchen.type === 'countertop') countertopLength += f.width;
  }
  const components = [...map.values()];
  return { components, total: components.reduce((s, c) => s + c.total, 0), countertopLength };
}

/** Kitchen modules placed along a wall face: length used vs. available. */
export function wallFaceLength(p: Project, wallId: string, side?: 1 | -1): number {
  const derived = derivePlan(p);
  if (!derived.footprints.get(wallId)) return 0;
  // usable face length = centerline length minus connected walls and unconnected cross walls (#220)
  const len = (sd: 1 | -1) => {
    const r = usableFaceRange(derived, wallId, sd);
    return r ? r.s1 - r.s0 : 0;
  };
  return side ? len(side) : Math.min(len(1), len(-1));
}
