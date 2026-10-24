/**
 * Costs of a layout. Hard rules (inside the room, no overlap, door swing, the strip behind
 * doors, nothing higher than the sill in front of a window, movement areas, areas to keep free,
 * marked zones, wall pieces off openings, walkways and reach) cost HARD and more; soft rules
 * (relations, Claude's place and zone, comfortable distances, design rules) cost a little.
 *
 * The total splits into a part per unit (`unitCost`), a part per pair of units (`pairCost`) and
 * the walking grid (`gridCost`), so the search can recompute only what a move touches.
 */
import { add, closestPointOnSegment, scale, type Vec2 } from '../../model/vec';
import { axisX, axisY, distToBox, gapBetween, outsideAmount, overlapDepth, WALL_TOL, wrapAngle, type Box } from './geom';
import type { Model, Node, SoftRelation, Unit } from './model';
import { usesWater } from '../../model/fixtures';
import { frontClearance } from '../../model/placementRules';
import { doorSeed, sideStrip, wallStrip } from './room';

/** Weight of one broken hard rule; amounts (overlap depth, distance outside) add to it. */
export const HARD = 4;
/** Overlaps up to this depth count as touching: below the plan's own checks (3 mm, see `placementIssues`). */
const EPS = 0.002;
/** The plan checks door swings to 1 mm. */
const SWING_EPS = 0.0005;
/** Movement areas are guide values: a few centimetres of overlap do not count (a basin beside the WC in a 125 cm room). */
const CLEAR_EPS = 0.03;

/**
 * q stands in the corner at one end of p, both against walls at right angles (shelves in an L,
 * two kitchen runs): the corner piece takes the end of p's front area, which stays usable.
 */
function inCorner(p: Node, q: Node): boolean {
  if (p.run !== undefined && q.run !== undefined) return true;
  if (p.spec.wall !== 'always' || q.spec.wall !== 'always') return false;
  if (Math.abs(Math.cos(p.box.rotation - q.box.rotation)) > 0.1) return false;
  const ax = axisX(p.box.rotation);
  const u = Math.abs((q.box.x - p.box.x) * ax.x + (q.box.y - p.box.y) * ax.y);
  // q's extent along p's width is its depth (at right angles)
  return q.box.hd <= 0.35 && u + q.box.hd >= p.box.hw - 0.02 && u - q.box.hd >= p.box.hw - 2 * q.box.hd - 0.05 && p.box.hw * 2 - 2 * q.box.hd >= 0.3;
}

/** A broken hard rule, for the debugging list `Layout.unsolved` and drop reasons. */
export interface Violation {
  rule: string;
  items: string[];
  text: string;
}

export type Sink = ((v: Violation) => void) | null;

export interface Cost {
  hard: number;
  soft: number;
}

const zero = (): Cost => ({ hard: 0, soft: 0 });

/** Stands on the floor and blocks the way (plants and floor lamps too, rugs not). */
export function isFloor(n: Node): boolean {
  return (n.spec.base === 'floor' || (n.spec.base === 'stack' && !n.rule)) && n.elevation < 0.05;
}
const isRug = (n: Node) => n.spec.base === 'rug';
const isWallItem = (n: Node) => n.spec.base === 'wall' && !n.spec.item.kitchen;
/** Furniture one cannot squeeze past: not plants, lamps or chairs (C9). */
const isFirm = (n: Node) => isFloor(n) && n.spec.shape !== 'plant' && n.spec.role !== 'floor-lamp' && n.spec.role !== 'seat' && n.spec.shape !== 'vacuum';
/** Kitchen modules that end at worktop height; a tall unit or fridge is as tall as it is. */
const WORKTOP = new Set(['base', 'sink', 'dishwasher', 'oven']);
const top = (n: Node) => n.elevation + (n.run !== undefined && WORKTOP.has(n.spec.item.kitchen?.type ?? '') ? 0.9 : n.spec.height);

const name = (n: Node) => n.spec.name;

/** Floor clearance under an opened door leaf (`DOOR_LEAF_UNDERCUT`): a flat rug may lie below it. */
const LEAF_UNDERCUT = 0.015;

/**
 * The plan's own rule (`frontClearance`): doors and drawers need room in front, and anything at
 * their height is in the way – a hanging lamp in front of a wardrobe as much as a chest of drawers.
 */
function frontCost(a: Node, b: Node, hard: (amount: number, v: () => Violation) => void, soft: (x: number) => void): void {
  const need = frontClearance({ ...a.spec.item, elevation: a.elevation });
  if (!need || a === b || b.spec.base === 'rug' || b.parent === a.id || a.parent === b.id || tucked(a, b)) return;
  // the real heights: a fridge is 1.85 m tall, not the 0.9 m of the worktop
  if (b.elevation > a.elevation + a.spec.height - 0.005 || b.elevation + b.spec.height < a.elevation + 0.05) return;
  if (a.run !== undefined && b.run !== undefined) return; // modules of a kitchen: the corner is the kitchen's own
  const d = overlapDepth(sideStrip(a.box, 'front', need), b.poly);
  if (d > 0.003) hard(0.5 * (1 + 5 * d), () => ({ rule: 'clearance', items: [a.id, b.id], text: `${name(b)} steht vor den Türen von ${name(a)}` }));
  else if (d > 0) soft(0.2);
}

/** Seat that may stand partly under its own table or desk. */
function tucked(a: Node, b: Node): boolean {
  const seatUnder = (s: Node, t: Node) => s.spec.category === 'chair' && s.parent === t.id && (t.spec.category === 'table' || t.spec.category === 'desk');
  return seatUnder(a, b) || seatUnder(b, a);
}

/** Polygons of a unit's movement areas, with `either` groups reduced to the best strip. */
function clearOf(n: Node) {
  return n.clear;
}

const sampleCache = new WeakMap<Model, { x: number; y: number; r: number }[]>();

/** Points every 20 cm along the reference walkways, with half their width. */
function walkSamples(m: Model): { x: number; y: number; r: number }[] {
  let out = sampleCache.get(m);
  if (out) return out;
  out = [];
  for (const w of m.ctx.walkways) {
    for (let i = 0; i + 1 < w.path.length; i++) {
      const a = w.path[i];
      const b = w.path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.max(1, Math.ceil(len / 0.2));
      for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k, r: w.width / 2 });
    }
  }
  sampleCache.set(m, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// per unit
// ---------------------------------------------------------------------------------------------

export function unitCost(m: Model, u: Unit, sink: Sink = null): Cost {
  const c = zero();
  if (!u.active) return c;
  const ctx = m.ctx;
  const hard = (amount: number, v: () => Violation) => {
    c.hard += HARD * amount;
    if (sink) sink(v());
  };
  for (const n of u.nodes) {
    const floor = isFloor(n);
    const rug = isRug(n);
    const wallItem = isWallItem(n);
    // the opened door leaf is solid up to the door's top: nothing may stand or hang in it (#442)
    for (const l of ctx.leaves) {
      if (Math.min(top(n), l.z1) - Math.max(n.elevation, LEAF_UNDERCUT) <= 0.005) continue;
      const d = overlapDepth(n.poly, l.poly);
      if (d > SWING_EPS) hard(1 + 10 * d, () => ({ rule: 'swing', items: [n.id], text: `${name(n)} steht im geöffneten Türblatt von ${l.label}` }));
    }
    // the plan reports anything reaching into a wall by more than 0.1 mm (`placementIssues`)
    if (floor || rug || wallItem || n.spec.base === 'curtain' || n.spec.base === 'ceiling') {
      const out = outsideAmount(n.poly, ctx.poly, WALL_TOL);
      if (out > 0) hard(1 + 5 * out, () => ({ rule: 'inside', items: [n.id], text: `${name(n)} ragt aus dem Raum` }));
    }
    if (floor) {
      for (const s of ctx.swings) {
        const d = overlapDepth(n.poly, s.poly);
        if (d > SWING_EPS) hard(1 + 10 * d, () => ({ rule: 'swing', items: [n.id], text: `${name(n)} steht im Türschwenk von ${s.label}` }));
      }
      if (n.spec.item.solid !== false && !usesWater(n.spec.item)) {
        for (const k of ctx.connections) {
          const d = overlapDepth(n.poly, k.poly);
          if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'connection', items: [n.id], text: `${name(n)} steht vor einem Wasseranschluss` }));
        }
      }
      for (const door of ctx.doors) {
        const d = overlapDepth(n.poly, door.entry);
        if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'entry', items: [n.id], text: `${name(n)} steht direkt hinter ${door.label}` }));
      }
      for (const w of ctx.windows) {
        if (top(n) <= w.sill + 0.02) continue;
        const d = overlapDepth(n.poly, w.zone);
        if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'window', items: [n.id], text: `${name(n)} steht höher als die Brüstung vor ${w.label}` }));
      }
      for (const f of ctx.fixed) {
        if (!f.floor) continue;
        const d = overlapDepth(n.poly, f.poly);
        if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'overlap', items: [n.id, f.piece.id], text: `${name(n)} überschneidet ${f.spec?.name ?? f.piece.id}` }));
        for (const cl of f.clear) {
          const e = overlapDepth(n.poly, cl);
          if (e > CLEAR_EPS) hard(0.5 * (1 + 5 * e), () => ({ rule: 'clearance', items: [n.id, f.piece.id], text: `${name(n)} steht in der Bewegungsfläche vor ${f.spec?.name ?? f.piece.id}` }));
        }
      }
      // movement areas inside the room and clear of existing pieces
      const either = n.clear.filter((x) => x.either);
      const eitherOk = either.some((x) => outsideAmount(x.poly, ctx.poly) <= 0.02);
      for (const cl of clearOf(n)) {
        const out = outsideAmount(cl.poly, ctx.poly);
        if (out > 0.02 && !(cl.either && eitherOk)) hard(0.5 * (1 + 5 * out), () => ({ rule: 'clearance', items: [n.id], text: `vor ${name(n)} fehlt Bewegungsfläche` }));
        for (const f of ctx.fixed) {
          if (!f.floor || (n.run !== undefined && f.spec?.item.kitchen)) continue;
          const d = overlapDepth(cl.poly, f.poly);
          if (d > CLEAR_EPS) hard(0.5 * (1 + 5 * d), () => ({ rule: 'clearance', items: [n.id, f.piece.id], text: `${f.spec?.name ?? f.piece.id} steht in der Bewegungsfläche von ${name(n)}` }));
        }
      }
      for (const cp of n.comfort) c.soft += 0.3 * Math.min(1, outsideAmount(cp, ctx.poly));
      // the reference walkway: keep it where that is easy (soft); a plant has no business there at all (D1)
      const perSample = n.spec.shape === 'plant' ? 0.15 : 0.03;
      const reach = Math.hypot(n.box.hw, n.box.hd) + 0.45;
      for (const p of walkSamples(m)) if (Math.abs(p.x - n.box.x) < reach && Math.abs(p.y - n.box.y) < reach && distToBox(p.x, p.y, n.box) < p.r) c.soft += perSample;
    }
    if (floor || rug) {
      for (const z of ctx.keepFree) {
        const d = overlapDepth(n.poly, z.poly);
        if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'keep-free', items: [n.id], text: `${name(n)} steht im frei zu lassenden Bereich ${z.id}` }));
      }
      const uz = m.zones.get(n.zone)?.userZone;
      const zp = uz ? ctx.userZones.get(uz) : undefined;
      if (zp && (n === u.main || floor)) {
        const out = outsideAmount(n.poly, zp);
        if (out > 0.02) hard(1 + 5 * out, () => ({ rule: 'user-zone', items: [n.id], text: `${name(n)} liegt nicht im markierten Bereich ${uz}` }));
      }
    }
    if (rug) for (const s of ctx.swings) if (overlapDepth(n.poly, s.poly) > 0.02) c.soft += 0.3;
    if (wallItem) {
      for (const w of ctx.walls) {
        for (const o of w.openings) {
          const strip = wallStrip(w, o.t0, o.t1, 0.1);
          if (overlapDepth(n.poly, strip) > 0.01) {
            const winTop = o.top ?? 2.1;
            const below = o.kind === 'window' && n.elevation + n.spec.height <= (o.sill ?? 0.9) - 0.02;
            const above = n.elevation >= winTop + 0.02;
            if (!below && !above) hard(1, () => ({ rule: 'wall-opening', items: [n.id], text: `${name(n)} hängt über ${o.id}` }));
          }
        }
      }
      for (const f of ctx.fixed) {
        if (f.floor && (f.piece.elevation ?? 0) + f.piece.height > n.elevation + 0.05 && overlapDepth(n.poly, f.poly) > EPS) {
          hard(0.5, () => ({ rule: 'hidden', items: [n.id], text: `${name(n)} hängt hinter ${f.spec?.name ?? f.piece.id}` }));
        }
      }
    }
  }
  // pieces of one group among themselves: the derivation places them, so an overlap left here
  // means one of them has to go (two chairs in the same place at a small table); a parent may
  // cover its child, and the modules of a kitchen run meet by design
  for (let i = 0; i < u.nodes.length; i++) {
    const a = u.nodes[i];
    if (!isFloor(a)) continue;
    for (let j = i + 1; j < u.nodes.length; j++) {
      const b = u.nodes[j];
      if (!isFloor(b) || a.parent === b.id || b.parent === a.id || (a.run !== undefined && b.run !== undefined) || tucked(a, b)) continue;
      const d = overlapDepth(a.poly, b.poly);
      if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'overlap', items: [a.id, b.id], text: `${name(a)} überschneidet ${name(b)}` }));
    }
  }
  for (const a of u.nodes) for (const b of u.nodes) frontCost(a, b, hard, (x) => (c.soft += x));

  // the unit's own design: Claude's place and zone, wanted wall, design rules
  const n = u.main;
  if (n && u.kind !== 'fixed') {
    if (u.hint) {
      c.soft += 0.25 * Math.hypot(n.box.x - u.hint.x, n.box.y - u.hint.y);
      if (Math.abs(wrapAngle(n.box.rotation - u.hint.rotation)) > 0.8) c.soft += 0.5;
    }
    if (u.zoneRect) {
      const r = u.zoneRect;
      const dx = Math.max(r.x0 - n.box.x, 0, n.box.x - r.x1);
      const dy = Math.max(r.y0 - n.box.y, 0, n.box.y - r.y1);
      c.soft += 0.6 * Math.hypot(dx, dy);
    }
    if (u.wantWall !== null && (u.mode !== 'wall' || u.wall !== u.wantWall)) c.soft += 0.8;
    c.soft += designCost(m, u, n);
  }
  if (u.kitchen) c.soft += 0.3 * Math.abs(u.kitchen.s - u.kitchen.preferred) + (u.kitchen.reversed ? 0.3 : 0);
  for (const r of relationsOf(m, u.index, -1)) c.soft += relationCost(m, r);
  return c;
}

/** Design rules of a main piece (C1, C2, C5). */
function designCost(m: Model, u: Unit, n: Node): number {
  const ctx = m.ctx;
  let s = 0;
  if (n.spec.category === 'desk') {
    const behindScreen = sideStrip(n.box, 'back', 0.3);
    const behindUser = sideStrip(n.box, 'front', 1.6);
    for (const w of ctx.windows) {
      if (overlapDepth(behindScreen, w.zone) > 0.05) s += 0.3;
      if (overlapDepth(behindUser, w.zone) > 0.05) s += 0.2;
    }
  }
  if (n.spec.role === 'sofa' && u.mode === 'free') {
    const behind = sideStrip(n.box, 'back', 1.0);
    for (const d of ctx.doors) if (overlapDepth(behind, d.entry) > 0.02) s += 0.3;
  }
  if (n.spec.role === 'bed') {
    const head = sideStrip(n.box, 'back', 0.3);
    for (const w of ctx.windows) if (overlapDepth(head, w.zone) > 0.05) s += 0.5;
    if (u.mode !== 'wall') s += 1.0;
  }
  if (n.spec.shape === 'plant' && isFloor(n)) s += plantPlaceCost(m, n);
  return s;
}

/** D1: a plant stands in a corner, at a window or at a wall, never free in the room. */
function plantPlaceCost(m: Model, n: Node): number {
  const ctx = m.ctx;
  const p = { x: n.box.x, y: n.box.y };
  if (ctx.analysis.corners.some((c) => !c.reflex && Math.hypot(c.p.x - p.x, c.p.y - p.y) < 0.7)) return 0;
  const on = (wi: number, t: number) => add(ctx.walls[wi].a, scale(ctx.walls[wi].dir, t));
  if (ctx.windows.some((w) => closestPointOnSegment(p, on(w.wall, w.t0), on(w.wall, w.t1)).distance < 1.0)) return 0;
  const gap = Math.min(...ctx.walls.map((w, i) => closestPointOnSegment(p, w.a, on(i, w.length)).distance)) - Math.max(n.box.hw, n.box.hd);
  return gap < 0.35 ? 0 : 1.0;
}

/** C2: an armchair on its own looks at the seating group (sofa and coffee table), not at a wall. */
function armchairCost(a: Unit, group: Unit): number {
  const chair = a.main;
  if (!chair || chair.spec.role !== 'armchair' || !isFloor(chair)) return 0;
  const sofa = group.nodes.find((x) => x.spec.role === 'sofa' && isFloor(x));
  const table = group.nodes.find((x) => x.spec.role === 'coffee-table');
  const ref = sofa ?? table;
  if (!ref) return 0;
  const cx = table && sofa ? (sofa.box.x + table.box.x) / 2 : ref.box.x;
  const cy = table && sofa ? (sofa.box.y + table.box.y) / 2 : ref.box.y;
  const dx = cx - chair.box.x;
  const dy = cy - chair.box.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.4) return 0;
  const f = axisY(chair.box.rotation);
  return 1.0 * Math.max(0, COS_AIM - (f.x * dx + f.y * dy) / len);
}
// aimed at 60° so the search does not stop right at the 70° the walk-through allows
const COS_AIM = Math.cos((60 * Math.PI) / 180);

// ---------------------------------------------------------------------------------------------
// per pair of units
// ---------------------------------------------------------------------------------------------

export function pairCost(m: Model, u: Unit, v: Unit, sink: Sink = null): Cost {
  const c = zero();
  if (!u.active || !v.active) return c;
  const hard = (amount: number, viol: () => Violation) => {
    c.hard += HARD * amount;
    if (sink) sink(viol());
  };
  const near = u.bounds.x0 < v.bounds.x1 && v.bounds.x0 < u.bounds.x1 && u.bounds.y0 < v.bounds.y1 && v.bounds.y0 < u.bounds.y1;
  for (const a of near ? u.nodes : []) {
    const fa = isFloor(a);
    const wa = isWallItem(a);
    if (isRug(a)) {
      // a rug does not run under cabinets, wardrobes or a kitchen run
      for (const b of v.nodes) {
        if (!isFloor(b) || b.spec.wall !== 'always') continue;
        const d = overlapDepth(a.poly, b.poly);
        if (d > 0.02) hard(0.5 + 5 * d, () => ({ rule: 'overlap', items: [a.id, b.id], text: `${name(a)} liegt unter ${name(b)}` }));
      }
      continue;
    }
    if (!fa && !wa) continue;
    for (const b of v.nodes) {
      if (isRug(b) && fa && a.spec.wall === 'always') {
        const d = overlapDepth(a.poly, b.poly);
        if (d > 0.02) hard(0.5 + 5 * d, () => ({ rule: 'overlap', items: [b.id, a.id], text: `${name(b)} liegt unter ${name(a)}` }));
        continue;
      }
      const fb = isFloor(b);
      const wb = isWallItem(b);
      if (!fb && !wb) continue;
      if (Math.hypot(a.box.x - b.box.x, a.box.y - b.box.y) > a.reach + b.reach) continue;
      if (fa && fb) {
        if (!tucked(a, b)) {
          const d = overlapDepth(a.poly, b.poly);
          if (d > EPS) hard(1 + 10 * d, () => ({ rule: 'overlap', items: [a.id, b.id], text: `${name(a)} überschneidet ${name(b)}` }));
        }
        for (const [p, q] of [
          [a, b],
          [b, a],
        ] as const) {
          if (inCorner(p, q)) continue;
          for (const cl of p.clear) {
            const d = overlapDepth(cl.poly, q.poly);
            if (d <= CLEAR_EPS) continue;
            if (cl.either) c.soft += 0.5 + 2 * d;
            else hard(0.5 * (1 + 5 * d), () => ({ rule: 'clearance', items: [p.id, q.id], text: `${name(q)} steht in der Bewegungsfläche von ${name(p)}` }));
          }
          for (const cp of p.comfort) c.soft += 0.4 * Math.min(0.5, overlapDepth(cp, q.poly));
        }
        if (isFirm(a) && isFirm(b) && Math.hypot(a.box.x - b.box.x, a.box.y - b.box.y) - Math.hypot(a.box.hw, a.box.hd) - Math.hypot(b.box.hw, b.box.hd) < 0.2) {
          const g = gapBetween(a.poly, b.poly);
          const row = (a.spec.category === 'storage' || a.run !== undefined) && (b.spec.category === 'storage' || b.run !== undefined);
          if (g > 0.02 && g < 0.2 && !row) c.soft += 0.5;
        }
      } else if (wa !== wb) {
        const w = wa ? a : b;
        const f = wa ? b : a;
        if (top(f) > w.elevation + 0.005 && overlapDepth(w.poly, f.poly) > EPS) hard(0.5, () => ({ rule: 'hidden', items: [w.id, f.id], text: `${name(w)} hängt hinter ${name(f)}` }));
      } else if (wa && wb) {
        const zOverlap = Math.min(a.elevation + a.spec.height, b.elevation + b.spec.height) - Math.max(a.elevation, b.elevation);
        if (zOverlap > 0.02 && overlapDepth(a.poly, b.poly) > EPS) hard(0.5, () => ({ rule: 'overlap', items: [a.id, b.id], text: `${name(a)} hängt über ${name(b)}` }));
      }
    }
  }
  if (near)
    for (const a of u.nodes)
      for (const b of v.nodes) {
        frontCost(a, b, hard, (x) => (c.soft += x));
        frontCost(b, a, hard, (x) => (c.soft += x));
      }
  for (const r of relationsOf(m, u.index, v.index)) c.soft += relationCost(m, r);
  c.soft += armchairCost(u, v) + armchairCost(v, u);
  return c;
}

// ---------------------------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------------------------

const relCache = new WeakMap<Model, Map<string, SoftRelation[]>>();

/** Soft relations between unit a and unit b (b = −1: within a or with something fixed). */
export function relationsOf(m: Model, a: number, b: number): SoftRelation[] {
  let map = relCache.get(m);
  if (!map) {
    map = new Map();
    for (const r of expandRelations(m)) {
      const ua = m.nodes.get(r.item)?.unit;
      if (ua === undefined) continue;
      const ub = r.target ? m.nodes.get(r.target)?.unit : undefined;
      const key = ub === undefined || ub === ua ? `${ua}|-1` : `${Math.min(ua, ub)}|${Math.max(ua, ub)}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    relCache.set(m, map);
  }
  const key = b < 0 ? `${a}|-1` : `${Math.min(a, b)}|${Math.max(a, b)}`;
  return map.get(key) ?? [];
}

/** Call after units or relations change shape (fallback pieces keep ids, so rarely needed). */
export function resetRelations(m: Model): void {
  relCache.delete(m);
}

function expandRelations(m: Model): SoftRelation[] {
  const out: SoftRelation[] = [];
  for (const s of m.soft) {
    if (s.rel.kind === 'align') {
      const ids = s.rel.items.filter((i) => m.nodes.has(i));
      for (let i = 0; i + 1 < ids.length; i++) out.push({ rel: { kind: 'align', items: [ids[i], ids[i + 1]] }, item: ids[i], target: ids[i + 1] });
    } else if (m.nodes.has(s.item)) out.push(s);
  }
  return out;
}

function targetBox(m: Model, id: string): Box | null {
  const n = m.nodes.get(id);
  if (n) return m.units[n.unit].active ? n.box : null;
  return m.ctx.fixedById.get(id)?.box ?? null;
}

export function relationCost(m: Model, s: SoftRelation): number {
  return (s.weight ?? 1) * plainRelationCost(m, s);
}

function plainRelationCost(m: Model, s: SoftRelation): number {
  const n = m.nodes.get(s.item);
  if (!n || !m.units[n.unit].active) return 0;
  const B = n.box;
  const r = s.rel;
  const ctx = m.ctx;
  switch (r.kind) {
    case 'wall': {
      if (!r.along) return 0;
      const wi = ctx.wallIndex.get(r.wall);
      if (wi === undefined) return 0;
      const w = ctx.walls[wi];
      const t = (B.x - w.a.x) * w.dir.x + (B.y - w.a.y) * w.dir.y;
      const t0 = (r.along.from.x - w.a.x) * w.dir.x + (r.along.from.y - w.a.y) * w.dir.y;
      const t1 = (r.along.to.x - w.a.x) * w.dir.x + (r.along.to.y - w.a.y) * w.dir.y;
      return 0.5 * Math.max(0, Math.min(t0, t1) - t, t - Math.max(t0, t1));
    }
    case 'corner': {
      const corner = ctx.analysis.corners.find((c) => c.walls.includes(r.walls[0]) && c.walls.includes(r.walls[1]));
      return corner ? 1.0 * distToBox(corner.p.x, corner.p.y, B) : 0;
    }
    case 'center': {
      const z = m.zones.get(n.zone);
      const c = z ? { x: (z.rect.x0 + z.rect.x1) / 2, y: (z.rect.y0 + z.rect.y1) / 2 } : null;
      return c ? 0.3 * Math.hypot(B.x - c.x, B.y - c.y) : 0;
    }
    case 'front-of': {
      const T = targetBox(m, r.target);
      if (!T) return 0;
      const f = axisY(T.rotation);
      const want = add({ x: T.x, y: T.y }, scale(f, T.hd + (r.gap ?? 0.6) + B.hd));
      return 0.6 * Math.hypot(B.x - want.x, B.y - want.y);
    }
    case 'left-of':
    case 'right-of': {
      const T = targetBox(m, r.target);
      if (!T) return 0;
      const x = axisX(T.rotation);
      const side = r.kind === 'left-of' ? 1 : -1;
      const want = (sd: number) => add({ x: T.x, y: T.y }, scale(x, sd * (T.hw + (r.gap ?? 0.1) + B.hw)));
      const d = (sd: number) => Math.hypot(B.x - want(sd).x, B.y - want(sd).y);
      return 0.5 * Math.min(d(side), d(-side) + 0.4);
    }
    case 'facing': {
      const T = targetBox(m, r.target);
      if (!T) return 0;
      const dx = T.x - B.x;
      const dy = T.y - B.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return 0;
      const f = axisY(B.rotation);
      let cost = 0.6 * (1 - (f.x * dx + f.y * dy) / len);
      if (r.distance !== undefined) cost += 0.4 * Math.abs(len - B.hd - T.hd - r.distance);
      return cost;
    }
    case 'near': {
      const T = targetBox(m, r.target);
      return T ? 0.6 * Math.max(0, Math.hypot(B.x - T.x, B.y - T.y) - (r.max ?? 1.2)) : 0;
    }
    case 'away': {
      const T = targetBox(m, r.target);
      return T ? 0.6 * Math.max(0, (r.min ?? 2) - Math.hypot(B.x - T.x, B.y - T.y)) : 0;
    }
    case 'align': {
      const T = targetBox(m, r.items[1]);
      if (!T || Math.abs(Math.sin(wrapAngle(T.rotation - B.rotation))) > 0.1) return 0;
      const f = axisY(B.rotation);
      const front = (b: Box) => (b.x * f.x + b.y * f.y) + b.hd;
      return 0.5 * Math.min(1, Math.abs(front(B) - front(T)));
    }
    case 'window': {
      const win = ctx.windows.find((w) => w.label === r.window);
      if (!win) return 0;
      const w = ctx.walls[win.wall];
      const mid = (win.t0 + win.t1) / 2;
      const pts: Vec2[] =
        r.place === 'front'
          ? [add(add(w.a, scale(w.dir, mid)), scale(w.inward, 0.4 + B.hd))]
          : [win.t0 - 0.1 - B.hw, win.t1 + 0.1 + B.hw].map((t) => add(add(w.a, scale(w.dir, t)), scale(w.inward, 0.6)));
      return 0.5 * Math.min(...pts.map((p) => Math.hypot(B.x - p.x, B.y - p.y)));
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// walking grid: walkways (B1/B2) and reach (B7)
// ---------------------------------------------------------------------------------------------

export function gridCost(m: Model, sink: Sink = null): number {
  const ctx = m.ctx;
  let cost = 0;
  if (!ctx.doors.length) return 0;
  const doorBy = new Map(ctx.doors.map((d) => [d.label, d]));
  for (const [width, layer] of ctx.walkLayers) {
    const ways = ctx.walkways.filter((w) => w.width === width);
    const labels = [...new Set(ways.flatMap((w) => [w.from, w.to]))].filter((l) => doorBy.has(l));
    const comps = ctx.grid.components(
      layer,
      labels.map((l) => doorSeed(ctx, doorBy.get(l)!, width / 2)),
    );
    const comp = new Map(labels.map((l, i) => [l, comps[i]]));
    for (const w of ways) {
      const a = comp.get(w.from);
      const b = comp.get(w.to);
      if (a === undefined || b === undefined) continue;
      if (a < 0 || b < 0 || a !== b) {
        cost += 3 * HARD;
        if (sink) sink({ rule: 'walkway', items: [], text: `kein ${Math.round(width * 100)} cm breiter Weg zwischen ${w.from} und ${w.to}` });
      }
    }
  }
  ctx.grid.components(
    ctx.reachLayer,
    ctx.doors.map((d) => doorSeed(ctx, d, ctx.grid.radii[ctx.reachLayer])),
  );
  for (const u of m.units) {
    if (!u.active) continue;
    const r = ctx.grid.radii[ctx.reachLayer];
    const reached = (n: Node, side: 'front' | 'left' | 'right' | 'back') => ctx.grid.reached(ctx.reachLayer, sideStrip(n.box, side, r + 0.4));
    if (u.kitchen) {
      // a run is reached along its front; its corner module may stand in front of another run
      const mods = u.nodes.filter((n) => n.run !== undefined);
      if (mods.length && !mods.some((n) => reached(n, 'front'))) {
        cost += HARD * 0.8;
        if (sink) sink({ rule: 'reach', items: [mods[0].id], text: `${name(mods[0])} ist nicht erreichbar` });
      }
      continue;
    }
    const list = u.main && isFloor(u.main) ? [u.main] : [];
    for (const n of list) {
      if (!n.spec.access.length) continue;
      // seats in front of it (desk chair, chairs at the table) are pulled out: behind them counts
      const ok = n.spec.access.some((side) => reached(n, side)) || u.nodes.some((c) => c.parent === n.id && c.spec.role === 'seat' && isFloor(c) && reached(c, 'back'));
      if (!ok) {
        cost += HARD * 0.8;
        if (sink) sink({ rule: 'reach', items: [n.id], text: `${name(n)} ist nicht erreichbar` });
      }
    }
  }
  return cost;
}
