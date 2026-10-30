/**
 * The solver's working model of one room programme. Pieces are grouped into units: a unit is
 * one main piece the search moves (bed, sofa, table, wardrobe …) together with the pieces
 * derived from it (chairs round the table, nightstands, rug, picture above, lamp on top). A
 * kitchen run is one unit, a picture on its own wall is one, and pieces bound to something that
 * never moves (a window, an existing washbasin, the ceiling) form fixed units.
 */
import type { Vec2 } from '../../model/vec';
import type { ProgramItem, ProgramZone, Relation, RoomProgram } from '../types';
import type { Box } from './geom';
import { specOf, type Spec, type WallBound } from './items';
import type { RoomCtx } from './room';

/** How a dependent piece follows its parent. */
export type Rule =
  | { kind: 'around'; index: number; count: number }
  | { kind: 'beside'; side: 'left' | 'right'; gap: number; pair: boolean }
  | { kind: 'front'; gap: number }
  /** At one end of the parent (armchair at the coffee table), turned towards it. */
  | { kind: 'flank'; side: 'left' | 'right' | null; gap: number }
  | { kind: 'under-front' | 'under-all' }
  | { kind: 'above'; height?: number }
  | { kind: 'on'; index: number; count: number }
  | { kind: 'sill'; window: string; index: number; count: number }
  | { kind: 'curtain'; window: string; index: number; count: number }
  | { kind: 'ceiling' };

export interface Node {
  id: string;
  catalogId: string;
  spec: Spec;
  prog: ProgramItem | null;
  zone: string;
  /** Parent: a piece id, an existing piece id, a window label or a kitchen run id. */
  parent: string | null;
  rule: Rule | null;
  unit: number;
  /** Current pose. */
  box: Box;
  elevation: number;
  poly: Vec2[];
  /**
   * Movement areas (hard, `min` deep) and the comfortable ones (soft). `strict` marks the strip
   * the plan itself insists on (doors and drawers have to open, `frontClearance`); the others are
   * guide values that take a few centimetres. `z0`/`z1` is the height band the strip blocks.
   */
  clear: { poly: Vec2[]; either: boolean; strict?: boolean; z0: number; z1: number }[];
  comfort: Vec2[][];
  /** Radius round the centre that holds the piece and its movement areas. */
  reach: number;
  /** Box registered in the walking grid (floor pieces only). */
  gridBox: Box | null;
  /** Kitchen module: run index. */
  run?: number;
  replaces?: string;
}

export interface KitchenState {
  index: number;
  wall: number;
  /** Module catalogue ids in program order (from `from` to `to`). */
  modules: string[];
  /** Start of the block along the wall (m from the wall start) and its preferred value. */
  s: number;
  preferred: number;
  /** Modules run against the wall direction (program goes from the wall end to its start). */
  backwards: boolean;
  reversed: boolean;
  length: number;
}

export interface Unit {
  index: number;
  id: string;
  kind: 'piece' | 'wall-item' | 'kitchen' | 'fixed';
  nodes: Node[];
  main: Node | null;
  bound: WallBound;
  /** Wall the programme asks for (`wall` relation), by index. */
  wantWall: number | null;
  mode: 'wall' | 'free';
  wall: number;
  t: number;
  x: number;
  y: number;
  rot: number;
  hint: { x: number; y: number; rotation: number } | null;
  zoneRect: ProgramZone['rect'] | null;
  required: boolean;
  active: boolean;
  /** Bounds of its pieces with their movement areas (to skip far pairs). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  kitchen?: KitchenState;
}

export interface SoftRelation {
  rel: Relation;
  item: string;
  target: string | null;
  /** Factor on the relation's cost (default 1). */
  weight?: number;
}

export interface Model {
  ctx: RoomCtx;
  program: RoomProgram;
  units: Unit[];
  nodes: Map<string, Node>;
  /** Relations kept as soft costs (the others became derivation rules). */
  soft: SoftRelation[];
  dropped: { id: string; catalogId: string; reason: string }[];
  zones: Map<string, ProgramZone>;
  /** Living and sleeping rooms from 12 m²: the search avoids large patches without furniture (E6). */
  spread?: boolean;
}

const emptyBox = (): Box => ({ x: 0, y: 0, hw: 0, hd: 0, rotation: 0 });

/** How far from a table's edge a chair of Claude's still counts as one of its seats (m). */
const CHAIR_REACH = 0.9;

/**
 * Chairs placed `front-of`, `left-of` or `right-of` a dining table each on their own would all
 * land on the same spot: seats at a table are one `around` group (several per table, or one
 * that is not an office chair).
 */

function withChairGroups(relations: readonly Relation[], nodes: Map<string, Node>): Relation[] {
  const isChair = (id: string) => {
    const s = nodes.get(id)?.spec;
    return !!s && s.role === 'seat' && !/büro/i.test(s.name);
  };
  const byTable = new Map<string, string[]>();
  for (const r of relations) {
    if ((r.kind === 'front-of' || r.kind === 'left-of' || r.kind === 'right-of') && isChair(r.item) && nodes.get(r.target)?.spec.role === 'table') {
      byTable.set(r.target, [...(byTable.get(r.target) ?? []), r.item]);
    }
  }
  // chairs without any relation, placed by Claude round the only table of their zone: they belong to
  // it, else each one wanders off on its own (#443: F's dining chairs in a heap beside the table)
  const related = new Set(relations.flatMap((r) => ('items' in r ? r.items : 'item' in r ? [r.item] : [])));
  for (const n of nodes.values()) {
    if (!isChair(n.id) || related.has(n.id)) continue;
    const tables = [...nodes.values()].filter((t) => t.spec.role === 'table' && t.zone === n.zone);
    const t = tables[0];
    const h = n.prog?.hint;
    const th = t?.prog?.hint;
    if (tables.length !== 1 || (h && th && Math.hypot(h.x - th.x, h.y - th.y) > Math.max(t.spec.width, t.spec.depth) / 2 + CHAIR_REACH)) continue;
    byTable.set(t.id, [...(byTable.get(t.id) ?? []), n.id]);
  }
  if (!byTable.size) return [...relations];
  const grouped = new Set([...byTable.values()].flat());
  const out: Relation[] = [...byTable].map(([target, items]) => ({ kind: 'around', items, target }));
  for (const r of relations) {
    if ((r.kind === 'front-of' || r.kind === 'left-of' || r.kind === 'right-of') && grouped.has(r.item)) continue;
    if (r.kind === 'around' && byTable.has(r.target)) {
      // chairs listed twice: one group per table
      const g = out.find((x) => x.kind === 'around' && x.target === r.target) as Extract<Relation, { kind: 'around' }>;
      for (const i of r.items) if (!g.items.includes(i)) g.items.push(i);
      continue;
    }
    out.push(r);
  }
  return out;
}

const DERIVED_FRONT_ROLES = new Set(['coffee-table', 'seat', 'rug']);
/** Largest gap between a runner or mat and the piece it lies in front of. */
const RUG_GAP = 0.05;
const SCREENS = new Set(['tv', 'tv-board']);
const VIEWERS = new Set(['sofa', 'armchair', 'bed']);
/** Weight of „the seat looks at the screen“: a sofa with its back to the TV is never meant (C3). */
const VIEWER_WEIGHT = 3;
const small = (s: Spec) => Math.max(s.width, s.depth) <= 0.6 && s.base === 'floor';

/**
 * Where a kitchen run starts that meets another one at a corner: past the other run's 60 cm depth
 * and its gap to the wall, with a few millimetres to spare for the plan's own overlap check.
 */
export const CORNER_START = 0.615;

/** Kitchen run ids as relation targets: `kitchen` (first run), `kitchen1`, `kitchen2` … */
export const runId = (i: number) => `kitchen${i + 1}`;
export function runIndexOf(target: string, runs: number): number | null {
  if (target === 'kitchen' && runs > 0) return 0;
  const m = /^kitchen(\d+)$/.exec(target);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i >= 0 && i < runs ? i : null;
}

function newNode(id: string, spec: Spec, prog: ProgramItem | null, zone: string): Node {
  return { id, catalogId: spec.catalogId, spec, prog, zone, parent: null, rule: null, unit: -1, box: emptyBox(), elevation: spec.elevation, poly: [], clear: [], comfort: [], reach: 0, gridBox: null };
}

/** Builds units from a programme. Pieces with an unknown catalogue id are dropped with a reason. */
export function buildModel(ctx: RoomCtx, program: RoomProgram): Model {
  const dropped: Model['dropped'] = [];
  const nodes = new Map<string, Node>();
  for (const it of program.items) {
    if (nodes.has(it.id)) {
      dropped.push({ id: it.id, catalogId: it.catalogId, reason: 'kommt im Raumprogramm doppelt vor' });
      continue;
    }
    const spec = specOf(it.catalogId, ctx.catalog);
    if (!spec) {
      dropped.push({ id: it.id, catalogId: it.catalogId, reason: 'unbekanntes Teil, nicht im Katalog' });
      continue;
    }
    nodes.set(it.id, newNode(it.id, spec, it, it.zone));
  }
  const runs = program.kitchen ?? [];
  const windows = new Set(ctx.windows.map((w) => w.label));
  const isTarget = (id: string) => nodes.has(id) || ctx.fixedById.has(id) || runIndexOf(id, runs.length) !== null;

  // derivation rules: the first fitting relation of each piece decides its parent
  const soft: SoftRelation[] = [];
  const parentOf = (id: string): string | null => nodes.get(id)?.parent ?? null;
  const createsCycle = (item: string, target: string) => {
    for (let p: string | null = target, n = 0; p && n < 50; p = parentOf(p), n++) if (p === item) return true;
    return false;
  };
  const setRule = (item: string, target: string, rule: Rule): boolean => {
    const n = nodes.get(item);
    if (!n || n.parent || item === target || createsCycle(item, target)) return false;
    const run = runIndexOf(target, runs.length);
    n.parent = run === null ? target : runId(run);
    n.rule = rule;
    return true;
  };
  for (const rel of withChairGroups(program.relations, nodes)) {
    let used = false;
    switch (rel.kind) {
      case 'around':
        if (isTarget(rel.target)) {
          const items = rel.items.filter((i) => nodes.has(i) && !nodes.get(i)!.parent);
          items.forEach((i, k) => setRule(i, rel.target, { kind: 'around', index: k, count: items.length }));
          used = true;
        }
        break;
      case 'pair':
        if (isTarget(rel.target)) {
          setRule(rel.item, rel.target, { kind: 'beside', side: 'left', gap: 0.03, pair: true });
          setRule(rel.item2, rel.target, { kind: 'beside', side: 'right', gap: 0.03, pair: true });
          used = true;
        }
        break;
      case 'on':
        if (windows.has(rel.target)) used = setRule(rel.item, rel.target, { kind: 'sill', window: rel.target, index: 0, count: 1 });
        else if (isTarget(rel.target)) used = setRule(rel.item, rel.target, { kind: 'on', index: 0, count: 1 });
        break;
      case 'above':
        if (isTarget(rel.target)) used = setRule(rel.item, rel.target, { kind: 'above', height: rel.height });
        break;
      case 'under-front':
      case 'under-all':
        if (isTarget(rel.target)) used = setRule(rel.item, rel.target, { kind: rel.kind });
        break;
      case 'flank':
        if (nodes.has(rel.target)) used = setRule(rel.item, rel.target, { kind: 'flank', side: rel.side ?? null, gap: rel.gap ?? 0.4 });
        break;
      case 'window':
        if (windows.has(rel.window) && (rel.place === 'over' || nodes.get(rel.item)?.spec.base === 'curtain')) {
          used = setRule(rel.item, rel.window, { kind: 'curtain', window: rel.window, index: 0, count: 1 });
        }
        break;
      case 'front-of': {
        const n = nodes.get(rel.item);
        if (n && isTarget(rel.target) && (DERIVED_FRONT_ROLES.has(n.spec.role) || n.spec.base === 'rug' || (small(n.spec) && n.spec.wall !== 'always'))) {
          const defGap = n.spec.role === 'coffee-table' ? 0.45 : 0;
          // a runner or mat lies right in front of its piece, whatever distance the programme names
          const gap = n.spec.base === 'rug' ? Math.min(rel.gap ?? 0, RUG_GAP) : (rel.gap ?? defGap);
          used = setRule(rel.item, rel.target, { kind: 'front', gap });
        }
        break;
      }
      case 'left-of':
      case 'right-of': {
        const n = nodes.get(rel.item);
        if (n && isTarget(rel.target) && (small(n.spec) || n.spec.role === 'nightstand' || n.spec.role === 'floor-lamp')) {
          used = setRule(rel.item, rel.target, { kind: 'beside', side: rel.kind === 'left-of' ? 'left' : 'right', gap: rel.gap ?? 0.05, pair: false });
        }
        break;
      }
      default:
        break;
    }
    if (!used) soft.push({ rel, item: 'item' in rel ? rel.item : rel.items[0], target: 'target' in rel ? rel.target : null });
  }

  soft.push(...viewerRelations(nodes, soft));

  // pieces that still have no parent but need one: curtains to the nearest window, small pieces onto a surface
  for (const n of nodes.values()) {
    if (n.parent) continue;
    const hint = n.prog?.hint;
    if (n.spec.base === 'curtain') {
      const w = nearestWindow(ctx, hint ?? centroid(ctx.poly));
      if (w) setRule(n.id, w, { kind: 'curtain', window: w, index: 0, count: 1 });
    } else if (n.spec.base === 'stack') {
      const surface = nearestSurface(nodes, n);
      if (surface) setRule(n.id, surface, { kind: 'on', index: 0, count: 1 });
      else {
        const w = nearestWindow(ctx, hint ?? centroid(ctx.poly), true);
        if (w) setRule(n.id, w, { kind: 'sill', window: w, index: 0, count: 1 });
      }
    } else if (n.spec.base === 'ceiling') {
      n.rule = { kind: 'ceiling' };
    }
  }
  for (const n of nodes.values()) {
    if (n.spec.base === 'curtain' && !n.parent) {
      dropped.push({ id: n.id, catalogId: n.catalogId, reason: 'kein Fenster im Raum, an das der Vorhang passt' });
      nodes.delete(n.id);
    }
  }
  // spread several pieces with the same parent and rule kind (two lamps on the sideboard, two curtains)
  const groups = new Map<string, Node[]>();
  for (const n of nodes.values()) {
    if (!n.rule || !n.parent || !['on', 'sill', 'curtain'].includes(n.rule.kind)) continue;
    const key = `${n.parent}|${n.rule.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  for (const list of groups.values()) {
    const key = (n: Node) => (n.prog?.hint ? n.prog.hint.x + n.prog.hint.y : 0);
    list.sort((a, b) => key(a) - key(b));
    list.forEach((n, k) => {
      const r = n.rule as Extract<Rule, { index: number }>;
      r.index = k;
      r.count = list.length;
    });
  }

  // units: roots are pieces without a parent (or with a parent outside the programme)
  const units: Unit[] = [];
  const zones = new Map(program.zones.map((z) => [z.id, z]));
  const rootOf = (n: Node): string => {
    let cur: Node = n;
    for (let k = 0; k < 50; k++) {
      const p = cur.parent ? nodes.get(cur.parent) : undefined;
      if (!p) {
        if (!cur.parent) return cur.id;
        return runIndexOf(cur.parent, runs.length) !== null ? cur.parent : `fixed:${cur.parent}`;
      }
      cur = p;
    }
    return cur.id;
  };
  const unitByRoot = new Map<string, Unit>();
  const makeUnit = (id: string, kind: Unit['kind'], main: Node | null): Unit => {
    const z = main ? zones.get(main.zone) : undefined;
    const u: Unit = {
      index: units.length,
      id,
      kind,
      nodes: [],
      main,
      bound: main?.spec.wall ?? 'free',
      wantWall: null,
      mode: 'free',
      wall: 0,
      t: 0,
      x: 0,
      y: 0,
      rot: 0,
      hint: main?.prog?.hint ?? null,
      zoneRect: z?.rect ?? null,
      required: !!main?.prog?.required,
      active: true,
      bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
    };
    units.push(u);
    unitByRoot.set(id, u);
    return u;
  };
  runs.forEach((run, i) => {
    const wall = ctx.wallIndex.get(run.wall);
    if (wall === undefined) {
      dropped.push({ id: runId(i), catalogId: 'kitchen', reason: `Küchenzeile an unbekannter Wand ${run.wall}` });
      return;
    }
    const w = ctx.walls[wall];
    const modules = run.modules.filter((m) => {
      if (specOf(m, ctx.catalog)) return true;
      dropped.push({ id: runId(i), catalogId: m, reason: 'unbekanntes Küchenmodul' });
      return false;
    });
    const t0 = alongWallPt(w, run.from);
    const t1 = alongWallPt(w, run.to);
    const length = modules.reduce((s, m) => s + specOf(m, ctx.catalog)!.width, 0);
    const backwards = t1 < t0;
    const span = Math.max(0, w.length - length);
    // a run meant to start just past the other run of an L starts exactly there (#443)
    const snap = (v: number) => (Math.abs(v - CORNER_START) < 0.1 ? CORNER_START : Math.abs(v - (span - CORNER_START)) < 0.1 ? span - CORNER_START : v);
    const preferred = snap(backwards ? t0 - length : t0);
    const u = makeUnit(runId(i), 'kitchen', null);
    u.required = true;
    u.mode = 'wall';
    u.wall = wall;
    u.kitchen = { index: i, wall, modules, s: preferred, preferred, backwards, reversed: false, length };
    modules.forEach((m, k) => {
      const node = newNode(`${runId(i)}-${k + 1}`, specOf(m, ctx.catalog)!, null, zoneAt(program, add2(w, (t0 + t1) / 2)));
      node.run = i;
      node.unit = u.index;
      nodes.set(node.id, node);
      u.nodes.push(node);
    });
  });
  for (const n of nodes.values()) {
    if (n.run !== undefined) continue;
    const root = rootOf(n);
    let u = unitByRoot.get(root);
    if (!u) {
      if (root.startsWith('fixed:') || (n.rule?.kind === 'ceiling' && !n.parent)) u = makeUnit(root.startsWith('fixed:') ? root : `fixed:${n.id}`, 'fixed', null);
      else {
        const main = nodes.get(root)!;
        u = makeUnit(root, main.spec.base === 'wall' ? 'wall-item' : main.spec.base === 'ceiling' ? 'fixed' : 'piece', main);
      }
    }
    n.unit = u.index;
  }
  // nodes of each unit in derivation order: parents before children
  for (const u of units) {
    const members = [...nodes.values()].filter((n) => n.unit === u.index && n.run === undefined);
    const ordered: Node[] = u.kind === 'kitchen' ? [...u.nodes] : [];
    const seen = new Set<string>();
    const visit = (n: Node) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      const p = n.parent ? nodes.get(n.parent) : undefined;
      if (p && p.unit === u.index) visit(p);
      ordered.push(n);
    };
    members.forEach(visit);
    u.nodes = ordered;
    if (u.main) u.required = u.nodes.some((n) => n === u.main && !!n.prog?.required);
  }
  // wanted walls
  for (const s of soft) {
    if (s.rel.kind !== 'wall' && s.rel.kind !== 'corner') continue;
    const n = nodes.get(s.item);
    if (!n || n.parent) continue;
    const u = units[n.unit];
    const wallId = s.rel.kind === 'wall' ? s.rel.wall : s.rel.walls[0];
    const wi = ctx.wallIndex.get(wallId);
    if (wi !== undefined && u.main === n) {
      u.wantWall = wi;
      if (u.bound === 'free') u.bound = 'prefer';
    }
  }
  for (const s of soft) {
    if (s.rel.kind === 'center') {
      const u = units[nodes.get(s.item)?.unit ?? -1];
      if (u && u.main?.id === s.item && u.bound !== 'always') u.bound = 'free';
    }
  }
  return { ctx, program, units, nodes, soft, dropped, zones };
}

/**
 * The seat looks at the screen. Claude names one direction („tv facing sofa“) and means both, so
 * the other one is added, weighted. Without any relation between them the only sofa of the room
 * faces the TV (C3).
 */
function viewerRelations(nodes: Map<string, Node>, soft: SoftRelation[]): SoftRelation[] {
  const out: SoftRelation[] = [];
  const facing = (a: string, b: string) => [...soft, ...out].some((s) => s.rel.kind === 'facing' && s.rel.item === a && s.rel.target === b);
  const add = (viewer: string, screen: string) => {
    if (!facing(viewer, screen)) out.push({ rel: { kind: 'facing', item: viewer, target: screen }, item: viewer, target: screen, weight: VIEWER_WEIGHT });
  };
  for (const s of soft) {
    if (s.rel.kind !== 'facing') continue;
    const a = nodes.get(s.rel.item);
    const b = nodes.get(s.rel.target);
    if (!a || !b) continue;
    if (SCREENS.has(a.spec.role) && VIEWERS.has(b.spec.role)) add(b.id, a.id);
    else if (VIEWERS.has(a.spec.role) && SCREENS.has(b.spec.role)) s.weight = Math.max(s.weight ?? 1, VIEWER_WEIGHT);
  }
  const sofas = [...nodes.values()].filter((n) => n.spec.role === 'sofa');
  const screens = [...nodes.values()].filter((n) => SCREENS.has(n.spec.role));
  const tv = screens.find((n) => n.spec.role === 'tv') ?? screens[0];
  const linked = (a: Node) => screens.some((sc) => facing(a.id, sc.id) || facing(sc.id, a.id));
  if (sofas.length === 1 && tv && !linked(sofas[0])) add(sofas[0].id, tv.id);
  return out;
}

/** A new unit for a piece that lost its parent (the parent was left out): it is placed on its own. */
export function detachUnit(m: Model, main: Node, members: Node[]): Unit {
  const z = m.zones.get(main.zone);
  const kind: Unit['kind'] = main.spec.base === 'wall' ? 'wall-item' : main.spec.base === 'ceiling' ? 'fixed' : 'piece';
  const u: Unit = {
    index: m.units.length,
    id: main.id,
    kind,
    nodes: [],
    main,
    bound: main.spec.wall,
    wantWall: null,
    mode: 'free',
    wall: 0,
    t: 0,
    x: 0,
    y: 0,
    rot: 0,
    hint: main.prog?.hint ?? null,
    zoneRect: z?.rect ?? null,
    required: !!main.prog?.required,
    active: true,
    bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
  };
  main.parent = null;
  main.rule = kind === 'fixed' ? { kind: 'ceiling' } : null;
  for (const n of members) n.unit = u.index;
  u.nodes = [main, ...members.filter((n) => n !== main)];
  m.units.push(u);
  return u;
}

const centroid = (poly: Vec2[]): Vec2 => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

function add2(w: { a: Vec2; dir: Vec2 }, t: number): Vec2 {
  return { x: w.a.x + w.dir.x * t, y: w.a.y + w.dir.y * t };
}
function alongWallPt(w: { a: Vec2; dir: Vec2 }, p: Vec2): number {
  return (p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y;
}

function zoneAt(program: RoomProgram, p: Vec2): string {
  const z = program.zones.find((z) => p.x >= z.rect.x0 - 0.3 && p.x <= z.rect.x1 + 0.3 && p.y >= z.rect.y0 - 0.3 && p.y <= z.rect.y1 + 0.3);
  return z?.id ?? '';
}

/** Window label nearest to a point; `sill` only windows with a sill one can put something on. */
export function nearestWindow(ctx: RoomCtx, p: Vec2, sill = false): string | null {
  let best: string | null = null;
  let bd = Infinity;
  for (const w of ctx.windows) {
    if (sill && w.sill < 0.3) continue;
    const wall = ctx.walls[w.wall];
    const c = add2(wall, (w.t0 + w.t1) / 2);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) {
      bd = d;
      best = w.label;
    }
  }
  return best;
}

/** A surface piece for a small piece without a parent: same zone first, nearest to its hint. */
function nearestSurface(nodes: Map<string, Node>, n: Node): string | null {
  const hint = n.prog?.hint;
  let best: string | null = null;
  let bd = Infinity;
  for (const m of nodes.values()) {
    if (m === n || !m.spec.surface || m.parent === n.id) continue;
    const h = m.prog?.hint;
    const d = (hint && h ? Math.hypot(h.x - hint.x, h.y - hint.y) : 3) + (m.zone === n.zone ? 0 : 2);
    if (d < bd && d < 2.5) {
      bd = d;
      best = m.id;
    }
  }
  return best;
}
