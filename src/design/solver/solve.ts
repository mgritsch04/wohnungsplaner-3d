/**
 * Stage 3 (#440): place a room programme exactly. Deterministic for a seed, runs in the browser.
 *
 * 1. Starts: Claude's places snapped to walls and the 90° grid, „anchors first“ over wall slots,
 *    and Claude's places again with another seed.
 * 2. Repair hard violations with local moves (a move is kept only when the total improves).
 * 3. Simulated annealing, temperature 0.25 → 0.001.
 * 4. Best start; pieces still breaking a hard rule get a smaller variant, else they are left out
 *    with a reason (required pieces too, never silently: the reason says so).
 */
import type { CatalogItem } from '../../catalog/types';
import type { Project } from '../../model/schema';
import type { DroppedItem, Layout, PlacedItem, RoomAnalysis, RoomProgram } from '../types';
import { gridCost, HARD, pairCost, resetRelations, unitCost, type Violation } from './cost';
import { refreshUnit, resizeNode } from './derive';
import { wrapAngle } from './geom';
import { smallerOptions } from './items';
import { kitchenTops } from './kitchenTops';
import { buildModel, detachUnit, runId, type Model, type Node, type Unit } from './model';
import { Rng } from './rng';
import { buildRoom, type FixedPiece } from './room';
import { candidates, hintPose, poseOf, randomMove, setPose, State, type Pose } from './search';

export interface SolveOptions {
  /** Existing pieces of the room (fixed obstacles, relation targets). See `existingPieces`. */
  existing?: FixedPiece[];
  /** Products beyond the generic catalogue (the user's own or found ones). */
  catalog?: CatalogItem[];
  seed?: number;
  /** Annealing steps per start (default 600) and number of starts (default 3). */
  steps?: number;
  starts?: number;
  /** Debugging: receives the hard rules still broken before pieces are made smaller or left out. */
  trace?: (broken: string[]) => void;
  /** Living or sleeping room: avoid large patches without furniture (E6, from 12 m²). */
  spread?: boolean;
}

/** Existing pieces of a room from the project (`RoomAnalysis.existing`). */
export function existingPieces(project: Project, analysis: RoomAnalysis): FixedPiece[] {
  const ids = new Set(analysis.existing);
  return project.furniture
    .filter((f) => ids.has(f.id))
    .map((f) => ({ id: f.id, catalogId: f.catalogId ?? '', x: f.x, y: f.y, rotation: f.rotation, width: f.width, depth: f.depth, height: f.height, elevation: f.elevation }));
}

const movable = (u: Unit) => u.kind !== 'fixed' && u.active;

type Snapshot = Map<number, Pose>;
const snapshot = (m: Model): Snapshot => new Map(m.units.map((u) => [u.index, poseOf(u)]));
function restore(m: Model, s: Snapshot): void {
  for (const u of m.units) {
    const p = s.get(u.index);
    if (p) setPose(u, p);
  }
}

export function solveRoom(analysis: RoomAnalysis, program: RoomProgram, opts: SolveOptions = {}): Layout {
  const seed = opts.seed ?? 1;
  const ctx = buildRoom(analysis, opts.existing ?? [], opts.catalog ?? []);
  const m = buildModel(ctx, program);
  m.spread = !!opts.spread && analysis.area >= 12;
  const st = new State(m);
  const steps = opts.steps ?? 600;
  const starts = Math.max(1, opts.starts ?? 3);

  // fixed units never move: place them once
  for (const u of m.units) refreshUnit(m, u);

  let best: { snap: Snapshot; hard: number; total: number } | null = null;
  for (let k = 0; k < starts; k++) {
    const rng = new Rng(seed * 7919 + k * 104729 + 1);
    for (const u of m.units) if (movable(u)) setPose(u, u.kitchen ? { ...poseOf(u), s: u.kitchen.preferred, reversed: false } : hintPose(m, u));
    if (k === 1) anchorsFirst(st, rng);
    if (k === 2) for (const u of m.units) if (movable(u) && !u.kitchen && u.mode === 'free') setPose(u, { ...poseOf(u), x: u.x + rng.normal() * 0.15, y: u.y + rng.normal() * 0.15 });
    st.rebuild();
    repair(st, rng);
    anneal(st, rng, steps);
    repair(st, rng);
    const hard = st.hard();
    const total = st.total();
    if (!best || hard < best.hard - 1e-9 || (Math.abs(hard - best.hard) <= 1e-9 && total < best.total)) best = { snap: snapshot(m), hard, total };
  }
  restore(m, best!.snap);
  st.rebuild();
  opts.trace?.(violations(st).map((v) => `${v.rule}: ${v.text} [${v.items.join(', ')}]`));
  const dropped = settle(st, seed);
  return toLayout(st, dropped, seed);
}

// ---------------------------------------------------------------------------------------------

function anchorsFirst(st: State, rng: Rng): void {
  const m = st.m;
  const list = m.units.filter(movable);
  const area = (u: Unit) => (u.kitchen ? 10 : (u.main?.spec.width ?? 0) * (u.main?.spec.depth ?? 0));
  list.sort((a, b) => Number(b.required) - Number(a.required) || area(b) - area(a));
  for (const u of list) u.active = false;
  for (const u of list) {
    u.active = true;
    let bestPose = poseOf(u);
    let bestCost = Infinity;
    for (const pose of [hintPose(m, u), ...candidates(m, u, rng, 120)]) {
      setPose(u, pose);
      refreshUnit(m, u);
      let c = unitCost(m, u);
      let t = c.hard + c.soft;
      for (const v of m.units) {
        if (v === u || !v.active) continue;
        c = pairCost(m, u, v);
        t += c.hard + c.soft;
      }
      if (t < bestCost) {
        bestCost = t;
        bestPose = pose;
      }
    }
    setPose(u, bestPose);
    refreshUnit(m, u);
  }
}

const footprint = (u: Unit) => u.nodes.reduce((a, n) => a + (n.gridBox ? n.spec.width * n.spec.depth : 0), 0);

/** Try the candidate poses of units involved in hard violations; keep what improves the total. */
export function repair(st: State, rng: Rng, rounds = 4, only?: Unit[]): void {
  const m = st.m;
  for (let round = 0; round < rounds; round++) {
    if (st.hard() < 1e-9) return;
    let list = (only ?? m.units).filter((u) => movable(u) && st.unitHard(u) > 1e-9);
    // only a way is blocked: the big pieces on the floor are the ones to move, with a closer look
    const wayOnly = !list.length && st.grid > 0;
    if (wayOnly) list = (only ?? m.units).filter(movable).sort((a, b) => footprint(b) - footprint(a));
    else list.sort((a, b) => st.unitHard(b) - st.unitHard(a));
    // best single move over all units involved, so the right one of two clashing pieces gives way
    let best: { u: Unit; pose: Pose; delta: number } | null = null;
    for (const u of list.slice(0, 5)) {
      const old = poseOf(u);
      // own costs first, the pairs only for the most promising places
      const own: { pose: Pose; cost: number }[] = [];
      for (const pose of candidates(m, u, rng, 100)) {
        setPose(u, pose);
        refreshUnit(m, u);
        const c = unitCost(m, u);
        own.push({ pose, cost: c.hard + c.soft });
      }
      own.sort((a, b) => a.cost - b.cost);
      const scored: { pose: Pose; cost: number }[] = [];
      for (const o of own.slice(0, 30)) {
        setPose(u, o.pose);
        refreshUnit(m, u);
        let t = o.cost;
        for (const v of m.units) {
          if (v === u) continue;
          const p = pairCost(m, u, v);
          t += p.hard + p.soft;
        }
        scored.push({ pose: o.pose, cost: t });
      }
      setPose(u, old);
      refreshUnit(m, u);
      scored.sort((a, b) => a.cost - b.cost);
      for (const s of scored.slice(0, wayOnly ? 12 : 4)) {
        const res = st.propose([{ u, pose: s.pose }]);
        if (res.delta < (best?.delta ?? -1e-6)) best = { u, pose: s.pose, delta: res.delta };
        res.rollback();
      }
    }
    if (!best) return;
    st.propose([{ u: best.u, pose: best.pose }]).commit();
  }
}

export function anneal(st: State, rng: Rng, steps: number, only?: Unit[]): void {
  const m = st.m;
  const list = (only ?? m.units).filter(movable);
  if (!list.length || steps <= 0) return;
  const starts = new Map(list.map((u) => [u.index, u.kitchen ? { ...poseOf(u), s: u.kitchen.preferred, reversed: false } : hintPose(m, u)]));
  const T0 = 0.25;
  const T1 = 0.001;
  let cur = st.total();
  let bestTotal = cur;
  let bestSnap = snapshot(m);
  for (let i = 0; i < steps; i++) {
    const T = T0 * Math.pow(T1 / T0, i / steps);
    const u = list[Math.floor(rng.next() * list.length)];
    const changes: { u: Unit; pose: Pose }[] = [];
    if (rng.next() < 0.08 && u.main && !u.kitchen) {
      // swap with a piece of similar size
      const others = list.filter((v) => v !== u && v.main && !v.kitchen && v.kind === u.kind && Math.abs(v.main.spec.width - u.main!.spec.width) < 0.5 && Math.abs(v.main.spec.depth - u.main!.spec.depth) < 0.4);
      if (others.length) {
        const v = others[Math.floor(rng.next() * others.length)];
        const pu = poseOf(u);
        const pv = poseOf(v);
        changes.push({ u, pose: pv }, { u: v, pose: pu });
      }
    }
    if (!changes.length) changes.push({ u, pose: randomMove(m, u, rng, starts.get(u.index)!) });
    const threshold = -T * Math.log(Math.max(1e-12, rng.next()));
    const res = st.propose(changes, threshold);
    if (res.delta <= threshold) {
      res.commit();
      cur += res.delta;
      if (cur < bestTotal - 1e-9) {
        bestTotal = cur;
        bestSnap = snapshot(m);
      }
    } else res.rollback();
  }
  restore(m, bestSnap);
  st.rebuild();
}

// ---------------------------------------------------------------------------------------------
// what does not fit: smaller variant, else leave out with a reason
// ---------------------------------------------------------------------------------------------

function violations(st: State): Violation[] {
  const m = st.m;
  const out: Violation[] = [];
  const sink = (v: Violation) => out.push(v);
  for (const u of m.units) unitCost(m, u, sink);
  for (const u of m.units) for (const v of m.units) if (u.index < v.index) pairCost(m, u, v, sink);
  gridCost(m, sink);
  return out;
}

function reasonFor(v: Violation | undefined, required: boolean): string {
  const base = !v
    ? 'passt hier nicht hin, auch nicht in kleiner'
    : v.rule === 'walkway'
      ? `würde den Weg freihalten nicht zulassen (${v.text})`
      : v.rule === 'swing'
        ? 'stünde im Türschwenk, auch in kleiner'
        : v.rule === 'entry'
          ? 'stünde direkt hinter der Tür'
          : v.rule === 'window'
            ? 'stünde vor dem Fenster höher als die Brüstung'
            : v.rule === 'reach'
              ? 'wäre nicht erreichbar'
              : v.rule === 'keep-free' || v.rule === 'user-zone'
                ? 'passt nicht in den markierten Bereich'
                : v.rule === 'wall-opening'
                  ? 'kein freies Wandstück ohne Tür oder Fenster'
                  : 'passt hier nicht hin, auch nicht in kleiner';
  return required ? `Pflichtmöbel fehlt: ${base}` : base;
}

function dropNode(st: State, n: Node, reason: string, dropped: DroppedItem[]): Unit[] {
  const m = st.m;
  const u = m.units[n.unit];
  st.ungrid(u);
  const subtree = (root: Node): Node[] => {
    const out = [root];
    for (let k = 0; k < out.length; k++) for (const x of u.nodes) if (x.parent === out[k].id && !out.includes(x)) out.push(x);
    return out;
  };
  // pieces that can stand on their own (a cabinet beside the washer, a pendant above the runner) stay;
  // the pendant of a table goes with the table, it would hang over nothing
  const tableLike = ['table', 'coffee-table'].includes(n.spec.role) || n.spec.category === 'desk';
  const detached: Unit[] = [];
  for (const child of u.nodes.filter((x) => x.parent === n.id)) {
    const free = (child.spec.base === 'ceiling' && !tableLike) || child.spec.base === 'wall' || (child.spec.base === 'floor' && (child.rule?.kind === 'beside' || child.rule?.kind === 'front') && child.spec.role !== 'seat');
    if (!free || u.main !== n) continue;
    const members = subtree(child);
    u.nodes = u.nodes.filter((x) => !members.includes(x));
    const nu = detachUnit(m, child, members);
    if (nu.kind !== 'fixed') {
      setPose(nu, hintPose(m, nu));
      detached.push(nu);
    }
  }
  const gone = new Set(subtree(n).map((x) => x.id));
  for (const x of u.nodes.filter((y) => gone.has(y.id))) {
    dropped.push({ id: x.id, catalogId: x.replaces ?? x.catalogId, reason: x === n ? reason : `gehört zu ${n.spec.name}, das fehlt` });
    m.nodes.delete(x.id);
  }
  u.nodes = u.nodes.filter((x) => !gone.has(x.id));
  if (u.main && gone.has(u.main.id)) u.active = false;
  if (!u.nodes.length) u.active = false;
  resetRelations(m);
  st.rebuild();
  return detached;
}

/** How much a piece matters for the room: what is left out first when nothing else helps. */
function importance(u: Unit): number {
  if (u.kitchen) return 100;
  const n = u.main;
  if (!n) return 0;
  const role = n.spec.role;
  const base = role === 'bed' ? 8 : role === 'sofa' ? 6 : role === 'table' ? 6 : n.spec.category === 'desk' ? 5 : n.spec.shape === 'wardrobe' ? 4 : 0;
  return (u.required ? 20 : 0) + base + Math.min(2, n.spec.width * n.spec.depth);
}

/** Kitchen modules a run can do without when it does not fit (sink, cooker and fridge stay). */
const STORAGE_MODULES = new Set(['base', 'wall']);

/** Fresh starts per round before a required piece is given up. */
const RESTART_TRIES = 4;

/**
 * The module a kitchen run can do without: one named in a violation, else the widest plain module
 * of a run that is involved (its appliances cannot move aside, the run can only get shorter).
 */
function kitchenSpare(involved: Node[], m: Model): Node | undefined {
  const spare = (n: Node) => n.run !== undefined && STORAGE_MODULES.has(n.spec.item.kitchen?.type ?? '') && m.units[n.unit].nodes.length > 2;
  const direct = involved.find(spare);
  if (direct) return direct;
  for (const n of involved) {
    if (n.run === undefined) continue;
    const mods = m.units[n.unit].nodes.filter(spare).sort((a, b) => a.spec.width - b.spec.width);
    if (mods.length) return mods[mods.length - 1];
  }
  return undefined;
}

function settle(st: State, seed: number): DroppedItem[] {
  const m = st.m;
  const dropped: DroppedItem[] = m.dropped.map((d) => ({ ...d }));
  let round = 0;
  const fresh = () => new Rng(seed * 31 + 7 + round++ * 101);
  let restarted = 0;
  for (let guard = 0; guard < 40 && st.hard() > 1e-9; guard++) {
    const vs = violations(st);
    const involved = new Map<string, Violation>();
    for (const v of vs) for (const id of v.items) if (m.nodes.has(id) && !involved.has(id)) involved.set(id, v);
    // 1. a dependent piece that breaks a rule on its own: leave it out
    const dep = [...involved.keys()].map((id) => m.nodes.get(id)!).find((n) => m.units[n.unit].main !== n && !n.prog?.required && n.run === undefined);
    if (dep) {
      dropNode(st, dep, reasonFor(involved.get(dep.id), false), dropped);
      continue;
    }
    // a kitchen run in the way: it gets shorter by a plain storage module (drawers, cupboard), so the
    // run keeps clear of the other run's corner – sink, cooker and fridge stay
    const mod = kitchenSpare([...involved.keys()].map((id) => m.nodes.get(id)!), m);
    if (mod) {
      const k = m.units[mod.unit].kitchen!;
      k.length -= mod.spec.width;
      if (k.backwards) k.preferred += mod.spec.width;
      dropNode(st, mod, reasonFor(involved.get(mod.id), false), dropped);
      const rng = fresh();
      repair(st, rng, 3);
      anneal(st, rng, 200);
      continue;
    }
    // 2. main pieces involved (for blocked ways: every piece on the floor): a smaller variant first
    let units = [...new Set([...involved.keys()].map((id) => m.nodes.get(id)!.unit))].map((i) => m.units[i]).filter((u) => u.active);
    if (vs.some((v) => v.rule === 'walkway') || !units.length) units = [...new Set([...units, ...m.units.filter((u) => movable(u) && u.nodes.some((n) => n.gridBox))])];
    units.sort((a, b) => importance(a) - importance(b));
    if (units.some((u) => !u.required && u.main && u.kind !== 'fixed' && tryFallbacks(st, u, fresh()))) continue;
    // a required piece keeps its size when leaving out one optional piece clears every rule: a
    // designer gives up a nightstand or a shelf before the double bed (#443: F's 180 bed became a 90)
    const shrinks = units.some((u) => u.required && u.main && u.kind !== 'fixed' && smallerOptions(u.main.replaces ?? u.main.catalogId, u.main.prog?.fallbacks ?? []).some((id) => id !== u.main!.catalogId));
    // own random numbers: the trials leave the search after them as it was
    const spare = shrinks ? spareToLeaveOut(st, units, (k) => new Rng(seed * 97 + guard * 13 + k)) : null;
    if (spare) {
      dropNode(st, spare.node, reasonFor(vs[0], false), dropped);
      // the places the trial found without it
      restore(m, spare.places);
      st.rebuild();
      continue;
    }
    if (units.some((u) => u.required && u.main && u.kind !== 'fixed' && tryFallbacks(st, u, fresh()))) continue;
    // 3. leave out the least important piece whose removal clearly helps (trial with repair);
    //    what still breaks a rule afterwards gets its smaller variant in the next round
    const before = st.hard();
    let choice: { u: Unit; hard: number } | null = null;
    // the least important optional piece whose removal helps at all: before giving up a required one
    let optional: { u: Unit; hard: number } | null = null;
    for (const u of units.filter((x) => !x.kitchen).slice(0, 6)) {
      const snap = snapshot(m);
      u.active = false;
      st.rebuild();
      const rng = fresh();
      repair(st, rng, 3);
      anneal(st, rng, 200);
      const h = st.hard();
      u.active = true;
      restore(m, snap);
      st.rebuild();
      if (!choice || h < choice.hard - 1e-9) choice = { u, hard: h };
      if (!optional && !u.required && h < before - 1e-9) optional = { u, hard: h };
      if (h < 1e-9 || h <= before - HARD * 0.5) {
        choice = { u, hard: h };
        break;
      }
    }
    if (choice?.u.required && optional) choice = optional;
    // before a required piece goes: fresh starts with the pieces as they are now (smaller bed …).
    // A bed is worth several tries: in a tight room only one arrangement of the big pieces works.
    if (choice?.u.required && restarted < 2) {
      restarted++;
      const snap = snapshot(m);
      let best: ReturnType<typeof snapshot> | null = null;
      let bestHard = before;
      for (let attempt = 0; attempt < RESTART_TRIES; attempt++) {
        restore(m, snap);
        st.rebuild();
        const rng = fresh();
        // the big pieces somewhere else on their walls, then the usual search
        for (const u of m.units.filter(movable).sort((a, b) => footprint(b) - footprint(a)).slice(0, 3)) {
          const c = candidates(m, u, rng, 40);
          if (c.length) setPose(u, c[Math.floor(rng.next() * c.length)]);
        }
        st.rebuild();
        repair(st, rng);
        anneal(st, rng, 400);
        repair(st, rng);
        const h = st.hard();
        if (h < bestHard - 1e-9) {
          bestHard = h;
          best = snapshot(m);
          if (h < 1e-9) break;
        }
      }
      restore(m, best ?? snap);
      st.rebuild();
      if (best) continue;
    }
    const target = choice?.u ?? units.find((u) => !u.kitchen);
    if (!target) break;
    const reason = reasonFor(vs.find((v) => target.main && v.items.includes(target.main.id)) ?? vs[0], target.required);
    if (target.main) dropNode(st, target.main, reason, dropped);
    else for (const n of [...target.nodes]) if (m.nodes.has(n.id)) dropNode(st, n, reason, dropped);
    const rng = fresh();
    repair(st, rng, 3);
    anneal(st, rng, 200);
  }
  return dropped;
}

/** Optional pieces tried before a required one is made smaller. */
const SPARE_TRIES = 8;

/**
 * The first optional piece on the floor (the smallest first: a nightstand, a side table, a shelf)
 * without which every hard rule holds again (trial with repair). Pieces of a required unit count,
 * the required main pieces themselves never do.
 */
function spareToLeaveOut(st: State, units: Unit[], fresh: (k: number) => Rng): { node: Node; places: Snapshot } | null {
  const m = st.m;
  const area = (n: Node) => n.spec.width * n.spec.depth;
  const candidates = units
    .filter((u) => !u.kitchen && u.kind !== 'fixed')
    .flatMap((u) => u.nodes.filter((n) => n.gridBox && !n.prog?.required && (n !== u.main || !u.required) && n.run === undefined))
    .sort((a, b) => area(a) - area(b))
    .slice(0, SPARE_TRIES);
  for (const [k, n] of candidates.entries()) {
    const u = m.units[n.unit];
    const gone = new Set<Node>([n]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of u.nodes) {
        if (gone.has(x) || !x.parent || ![...gone].some((g) => g.id === x.parent)) continue;
        gone.add(x);
        grew = true;
      }
    }
    const snap = snapshot(m);
    const nodes = u.nodes;
    const wasActive = u.active;
    st.ungrid(u);
    if (n === u.main) u.active = false;
    else {
      u.nodes = nodes.filter((x) => !gone.has(x));
      for (const x of gone) m.nodes.delete(x.id);
    }
    st.rebuild();
    const rng = fresh(k);
    repair(st, rng, 3);
    anneal(st, rng, 200);
    const h = st.hard();
    const places = snapshot(m);
    st.ungrid(u);
    u.nodes = nodes;
    if (n !== u.main) for (const x of gone) m.nodes.set(x.id, x);
    u.active = wasActive;
    restore(m, snap);
    st.rebuild();
    if (h < 1e-9) return { node: n, places };
  }
  return null;
}

/** Smaller variants of a unit's main piece; keeps the first after which the hard rules improve and the piece itself fits. */
function tryFallbacks(st: State, u: Unit, rng: Rng): boolean {
  const m = st.m;
  const n = u.main!;
  const original = n.catalogId;
  const before = st.hard();
  const snap = snapshot(m);
  for (const id of smallerOptions(n.replaces ?? original, n.prog?.fallbacks ?? [])) {
    if (id === n.catalogId || !resizeNode(m, n, id)) continue;
    st.rebuild();
    // the smaller piece looks for its own new place first, then the others adjust
    repair(st, rng, 2, [u]);
    repair(st, rng, 3);
    anneal(st, rng, 150);
    if (st.hard() < before - 1e-9 && st.unitHard(u) < 1e-9) return true;
    restore(m, snap);
  }
  // back to the original piece
  resizeNode(m, n, original);
  if (n.replaces === original) delete n.replaces;
  restore(m, snap);
  st.rebuild();
  return false;
}

function toLayout(st: State, dropped: DroppedItem[], seed: number): Layout {
  const m = st.m;
  const items: PlacedItem[] = [];
  for (const u of m.units) {
    if (!u.active) continue;
    for (const n of u.nodes) {
      const parent = n.parent && m.nodes.has(n.parent) ? n.parent : undefined;
      items.push({
        id: n.id,
        catalogId: n.catalogId,
        zone: n.zone,
        x: n.box.x,
        y: n.box.y,
        rotation: wrapAngle(n.box.rotation),
        elevation: n.elevation,
        width: 2 * n.box.hw,
        depth: 2 * n.box.hd,
        height: n.spec.height,
        ...(n.replaces && n.replaces !== n.catalogId ? { replaces: n.replaces } : {}),
        ...(parent ? { parent } : {}),
        ...(n.run !== undefined ? { kitchenRun: n.run } : {}),
      });
    }
  }
  items.push(...kitchenTops(m));
  const vs = violations(st);
  let soft = st.total() - st.hard();
  if (!Number.isFinite(soft)) soft = 0;
  return { roomId: m.ctx.analysis.roomId, items, dropped, cost: Math.round(soft * 1000) / 1000, unsolved: [...new Set(vs.map((v) => v.text))], seed };
}

export { runId };
