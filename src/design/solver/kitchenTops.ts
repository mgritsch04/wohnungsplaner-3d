/**
 * Cooktop, hood and wall cabinets of the kitchen runs (#440, #442). The programme lists only the
 * floor modules (`KitchenRun.modules`), the app adds the rest: one cooktop for the whole kitchen
 * (an L-shaped kitchen has two runs, but one cooktop), on the oven, else on a base module, where
 * it keeps 60 cm of worktop to the sink, 30 cm beside it free of tall units and walls, and stays
 * out from under a window (A4). The hood hangs above it unless a window is there. Wall cabinets
 * hang over the other base modules wherever the wall above the worktop is free, each with a light
 * strip under its front edge (K5: work light in front of the cook, not a ceiling light behind).
 */
import { add, pointInPolygon, scale } from '../../model/vec';
import type { PlacedItem, WallInfo } from '../types';
import { boxCorners, overlapDepth, wrapAngle, type Box } from './geom';
import { specOf, type Spec } from './items';
import type { Model, Node, Unit } from './model';
import { alongWall, boxOnWall } from './room';

const COOKTOP = 'generic-k-cooktop';
const HOOD = 'generic-k-hood-60';
const WALL_60 = 'generic-k-wall-60';
const WALL_80 = 'generic-k-wall-80';
const WALL_40 = 'generic-k-wall-40';
const LIGHT = 'generic-k-light';
/** Floor modules a wall cabinet may hang over. */
const UNDER_WALL = new Set(['base', 'sink', 'dishwasher', 'oven']);

const typeOf = (n: Node) => n.spec.item.kitchen?.type ?? '';

interface Run {
  u: Unit;
  w: WallInfo;
  /** Floor modules along the wall. */
  mods: Node[];
}

/** Everything hung on or set into the kitchen runs of the room (none without a kitchen). */
export function kitchenTops(m: Model): PlacedItem[] {
  const ctx = m.ctx;
  const runs: Run[] = m.units
    .filter((u) => u.kitchen && u.active)
    .map((u) => {
      const w = ctx.walls[u.kitchen!.wall];
      return { u, w, mods: u.nodes.filter((n) => n.run !== undefined).sort((a, b) => alongWall(w, a.box) - alongWall(w, b.box)) };
    });
  if (!runs.length) return [];
  // pictures, shelves and mirrors the solver hung: a cabinet or hood never hangs into them
  const hangers = m.units.filter((u) => u.active).flatMap((u) => u.nodes.filter((n) => n.spec.base === 'wall' && !n.spec.item.kitchen));
  const clash = (box: Box, z0: number, z1: number) => {
    const poly = boxCorners(box);
    return hangers.some((h) => Math.min(z1, h.elevation + h.spec.height) - Math.max(z0, h.elevation) > 0.005 && overlapDepth(poly, h.poly) > 0.002);
  };
  const out: PlacedItem[] = [];
  const hung = new Set<string>();
  const cook = runs.some((r) => r.mods.some((n) => typeOf(n) === 'cooktop')) ? null : cooktopHost(m, runs);
  if (cook) {
    const { run, host } = cook;
    const spec = specOf(COOKTOP, ctx.catalog)!;
    const id = `${run.u.id}-cooktop`;
    out.push(placed(id, COOKTOP, spec, host, { x: host.box.x, y: host.box.y, rotation: host.box.rotation }, spec.elevation, host.id));
    hung.add(host.id);
    const hood = specOf(HOOD, ctx.catalog)!;
    const t = alongWall(run.w, host.box);
    const box = boxOnWall(run.w, t, hood.width, hood.depth, 0.002);
    if (wallFree(run.w, t, hood.width, hood.elevation, hood.elevation + hood.height) && !clash(box, hood.elevation, hood.elevation + hood.height)) out.push(placed(`${run.u.id}-hood`, HOOD, hood, host, box, hood.elevation, id));
  }
  for (const run of runs) {
    let k = 0;
    for (const n of run.mods) {
      if (hung.has(n.id) || !UNDER_WALL.has(typeOf(n)) || n.spec.width < 0.39) continue;
      const spec = specOf(n.spec.width >= 0.79 ? WALL_80 : n.spec.width >= 0.59 ? WALL_60 : WALL_40, ctx.catalog);
      if (!spec || spec.elevation + spec.height > ctx.analysis.height - 0.02) continue;
      const t = alongWall(run.w, n.box);
      const box = boxOnWall(run.w, t, spec.width, spec.depth, 0.002);
      if (!wallFree(run.w, t, spec.width, spec.elevation, spec.elevation + spec.height) || clash(box, spec.elevation, spec.elevation + spec.height)) continue;
      const id = `${run.u.id}-wall${++k}`;
      out.push(placed(id, spec.item.id, spec, n, box, spec.elevation, n.id));
      const light = specOf(LIGHT, ctx.catalog);
      if (!light) continue;
      const width = spec.width - 0.04;
      const strip = boxOnWall(run.w, t, width, light.depth, spec.depth - light.depth - 0.02);
      out.push(placed(`${id}-licht`, LIGHT, { ...light, width }, n, strip, spec.elevation - light.height, id));
    }
  }
  return out;
}

/** The module the cooktop goes on: the oven, else a base module, by the rules of A4. */
function cooktopHost(m: Model, runs: Run[]): { run: Run; host: Node } | null {
  const poly = m.ctx.poly;
  const span = (w: WallInfo, n: Node) => {
    const t = alongWall(w, n.box);
    return { lo: t - n.spec.width / 2, hi: t + n.spec.width / 2 };
  };
  const gap = (w: WallInfo, a: Node, b: Node) => {
    const p = span(w, a);
    const q = span(w, b);
    return Math.max(q.lo - p.hi, p.lo - q.hi, 0);
  };
  let best: { run: Run; host: Node; score: number } | null = null;
  for (const run of runs) {
    const { w, mods } = run;
    const sink = mods.find((n) => typeOf(n) === 'sink');
    const windows = w.openings.filter((o) => o.kind === 'window');
    for (const h of mods) {
      if (typeOf(h) !== 'oven' && !(typeOf(h) === 'base' && h.spec.width >= 0.59)) continue;
      const s = span(w, h);
      let score = typeOf(h) === 'oven' ? 0 : 1;
      if (sink && gap(w, h, sink) < 0.59) score += 2;
      const tall = mods.some((x) => x !== h && (typeOf(x) === 'tall' || typeOf(x) === 'fridge') && gap(w, h, x) < 0.29);
      const side = [-1, 1].some((d) => !pointInPolygon(add(h.box, scale(w.dir, d * (h.spec.width / 2 + 0.29))), poly));
      if (tall || side) score += 1;
      if (windows.some((o) => o.t0 < s.hi - 0.05 && o.t1 > s.lo + 0.05 && (o.sill ?? 0.9) < 1.4)) score += 1.5;
      if (!best || score < best.score - 1e-9) best = { run, host: h, score };
    }
  }
  return best && { run: best.run, host: best.host };
}

/** No door, passage or window in the wall between heights `z0` and `z1` over `width` round `t`. */
function wallFree(w: WallInfo, t: number, width: number, z0: number, z1: number): boolean {
  const lo = t - width / 2;
  const hi = t + width / 2;
  return !w.openings.some((o) => o.t0 < hi && o.t1 > lo && (o.kind !== 'window' || ((o.sill ?? 0.9) < z1 && (o.top ?? 2.1) > z0)));
}

function placed(id: string, catalogId: string, spec: Spec, host: Node, box: { x: number; y: number; rotation: number }, elevation: number, parent: string): PlacedItem {
  return {
    id,
    catalogId,
    zone: host.zone,
    x: box.x,
    y: box.y,
    rotation: wrapAngle(box.rotation),
    elevation,
    width: spec.width,
    depth: spec.depth,
    height: spec.height,
    parent,
    kitchenRun: host.run,
  };
}
