import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { furnitureCorners, footprintsOverlap } from '../editor2d/furnitureGeometry';
import { derivePlan } from '../model/derived';
import { newId } from '../model/ids';
import type { Furniture, Project } from '../model/schema';
import { roundMm } from '../model/units';
import { add, dot, scale, sub } from '../model/vec';

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
  /** Start position along the wall measured from node a (meters). */
  start: number;
  modules: RunModule[];
  frontColor?: string;
}

/** Place a row of kitchen modules flush against a wall face. Returns created item ids. */
export function placeKitchenRun(d: Project, input: PlaceRunInput): string[] {
  const derived = derivePlan(d);
  const fp = derived.footprints.get(input.wallId);
  if (!fp) throw new Error('Wand nicht gefunden');
  const rotation = Math.atan2(fp.dir.y, fp.dir.x) + (input.side === 1 ? 0 : Math.PI);
  const normal = scale(fp.normal, input.side);
  const ids: string[] = [];
  let along = input.start;
  for (const m of input.modules) {
    const item = findCatalogItem(m.catalogId);
    if (!item) continue;
    const width = m.width ?? item.width;
    const center = add(add(fp.a, scale(fp.dir, along + width / 2)), scale(normal, fp.thickness / 2 + item.depth / 2 + 0.002));
    const f = createFurnitureFromCatalog({ ...item, width }, { x: roundMm(center.x), y: roundMm(center.y), rotation });
    if (f.kitchen && input.frontColor) f.kitchen.frontColor = input.frontColor;
    d.furniture.push(f);
    ids.push(f.id);
    // wall cabinets and hoods hang above base cabinets and do not advance the run
    if (!(item.kitchen?.type === 'wall' || item.kitchen?.type === 'hood' || item.kitchen?.type === 'cooktop')) along += width;
  }
  return ids;
}

const FLOOR_TYPES = new Set(['base', 'sink', 'dishwasher', 'oven']);

/** Remove previously generated countertops and create new ones over contiguous base modules. */
export function generateCountertops(d: Project): number {
  d.furniture = d.furniture.filter((f) => !(f.kitchen?.type === 'countertop' && f.kitchen.generated));
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
export function wallFaceLength(p: Project, wallId: string): number {
  const fp = derivePlan(p).footprints.get(wallId);
  if (!fp) return 0;
  // usable face length ≈ centerline length minus the thickness of connected walls
  const f = fp.polygon;
  const left = Math.abs(dot(sub(f[1], f[0]), fp.dir));
  const right = Math.abs(dot(sub(f[2], f[3]), fp.dir));
  return Math.min(left, right);
}
