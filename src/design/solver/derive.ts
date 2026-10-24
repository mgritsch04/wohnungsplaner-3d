/**
 * Poses of a unit: the main piece from the unit's state (on a wall or free), the kitchen run
 * as a block, and every dependent piece from its parent (chairs round the table, nightstands,
 * rug, picture above, lamp on top, curtain at the window).
 */
import { add, pointInPolygon, scale, type Vec2 } from '../../model/vec';
import { rotationFacing } from '../../suggest/roomGeometry';
import { axisX, axisY, boxCorners, clamp, distToBox, outsideAmount, overlapDepth, WALL_TOL, type Box } from './geom';
import { specOf } from './items';
import type { Model, Node, Rule, Unit } from './model';
import { runId } from './model';
import { boxOnWall, pointOnWall, sideStrip } from './room';
import { frontClearance } from '../../model/placementRules';

const WALL_GAP = 0.005;

/** Box of the main piece of a unit from its state. */
export function mainBox(m: Model, u: Unit, n: Node): Box {
  const { width, depth } = n.spec;
  if (u.mode === 'wall') {
    const w = m.ctx.walls[u.wall];
    const t = w.length >= width ? clamp(u.t, width / 2, w.length - width / 2) : w.length / 2;
    u.t = t;
    return boxOnWall(w, t, width, depth, WALL_GAP);
  }
  return { x: u.x, y: u.y, hw: width / 2, hd: depth / 2, rotation: u.rot };
}

/** Parent box of a dependent (a piece, an existing piece or a kitchen run). */
function parentBox(m: Model, id: string): { box: Box; top: number; elevation: number } | null {
  const n = m.nodes.get(id);
  if (n) return { box: n.box, top: n.elevation + n.spec.height, elevation: n.elevation };
  const f = m.ctx.fixedById.get(id);
  if (f) return { box: f.box, top: (f.piece.elevation ?? 0) + f.piece.height, elevation: f.piece.elevation ?? 0 };
  const u = m.units.find((x) => x.id === id && x.kitchen);
  if (u?.kitchen) {
    const w = m.ctx.walls[u.kitchen.wall];
    return { box: boxOnWall(w, u.kitchen.s + u.kitchen.length / 2, u.kitchen.length, 0.6, WALL_GAP), top: 0.9, elevation: 0 };
  }
  return null;
}

/** How far an open curtain panel covers the frame of its window (m). */
const CURTAIN_OVERLAP = 0.08;
/** Width of an open, gathered curtain panel: about a third of its fabric, 30 to 50 cm. */
export const curtainOpenWidth = (fabric: number): number => clamp(fabric * 0.35, 0.3, 0.5);

/** Rotate a rug so its longer side runs along `along` (the parent's width axis). */
function rugBox(center: Vec2, parentRot: number, w: number, d: number, longAlongWidth: boolean): Box {
  // catalogue rugs are given as width × depth; turn by 90° when the long side should lie the other way
  const longIsDepth = d >= w;
  const turn = longAlongWidth === longIsDepth;
  return { x: center.x, y: center.y, hw: w / 2, hd: d / 2, rotation: parentRot + (turn ? Math.PI / 2 : 0) };
}

/** Extents of a box along the parent's width (x) and front (y) axes. */
function extents(b: Box, parentRot: number): { ex: number; ey: number } {
  const turned = Math.abs(Math.sin(b.rotation - parentRot)) > 0.5;
  return turned ? { ex: b.hd, ey: b.hw } : { ex: b.hw, ey: b.hd };
}

function nearestWallTo(m: Model, p: Vec2): number {
  let best = 0;
  let bd = Infinity;
  m.ctx.walls.forEach((w, i) => {
    const t = clamp((p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y, 0, w.length);
    const q = pointOnWall(w, t);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function insideScore(m: Model, b: Box): number {
  return outsideAmount(boxCorners(b), m.ctx.poly, WALL_TOL);
}

/**
 * Where a wall piece hangs above its parent: on the wall behind it (a free-standing parent: the
 * nearest wall to its place), never lower than the parent's top (Claude's height can be too low).
 */
function wallAbove(m: Model, n: Node, P: Box, parentTop: number, height?: number): { box: Box; elevation: number } {
  const s = n.spec;
  const ctx = m.ctx;
  const parentNode = m.nodes.get(n.parent!);
  const parentUnit = parentNode ? m.units[parentNode.unit] : null;
  const parentOnWall = parentUnit && parentUnit.mode === 'wall' && parentUnit.main === parentNode;
  const wi = parentOnWall ? parentUnit.wall : nearestWallTo(m, n.prog?.hint ?? { x: P.x, y: P.y });
  const w = ctx.walls[wi];
  const t = clamp((P.x - w.a.x) * w.dir.x + (P.y - w.a.y) * w.dir.y, s.width / 2, Math.max(s.width / 2, w.length - s.width / 2));
  const gap = s.role === 'tv' ? 0.05 : 0.2;
  const want = Math.max(height ?? Math.max(s.elevation, parentTop + gap), parentTop + 0.02);
  return { box: boxOnWall(w, t, s.width, s.depth, 0.002), elevation: clamp(want, 0, ctx.height - s.height - 0.02) };
}

/** Room for a hanging lamp at `b`: inside the room, clear of tall furniture, its doors and door leaves. */
function hangFree(m: Model, n: Node, b: Box): boolean {
  if (insideScore(m, b) > 0) return false;
  const poly = boxCorners(b);
  const z0 = n.elevation;
  const z1 = n.elevation + n.spec.height;
  for (const l of m.ctx.leaves) if (Math.min(z1, l.z1) - Math.max(z0, 0.015) > 0.005 && overlapDepth(poly, l.poly) > 0.0005) return false;
  for (const o of m.nodes.values()) {
    if (o === n || o.spec.base !== 'floor' || !m.units[o.unit].active) continue;
    const top = o.elevation + o.spec.height;
    if (z0 > top - 0.005 || z1 < o.elevation + 0.05) continue;
    if (overlapDepth(poly, o.poly) > 0.003) return false;
    const need = frontClearance({ ...o.spec.item, elevation: o.elevation });
    if (need && overlapDepth(poly, sideStrip(o.box, 'front', need)) > 0.003) return false;
  }
  for (const f of m.ctx.fixed) {
    if (!f.floor) continue;
    const top = (f.piece.elevation ?? 0) + f.piece.height;
    if (z0 > top - 0.005 || z1 < (f.piece.elevation ?? 0) + 0.05) continue;
    if (overlapDepth(poly, f.poly) > 0.003) return false;
  }
  return true;
}

/**
 * How far into the room, measured from the parent's middle along its front axis, something
 * hanging over the parent between `z0` and `z1` reaches (the TV over the sideboard): what stands
 * on the piece goes in front of it, not into it. `-Infinity` when nothing hangs there.
 */
function hangingFront(m: Model, n: Node, P: Box, z0: number, z1: number): number {
  const f = axisY(P.rotation);
  let v = -Infinity;
  for (const sib of m.nodes.values()) {
    if (sib === n || sib.parent !== n.parent || sib.spec.base !== 'wall' || sib.rule?.kind !== 'above') continue;
    const pose = wallAbove(m, sib, P, z0, sib.rule.height);
    if (Math.min(z1, pose.elevation + sib.spec.height) - Math.max(z0, pose.elevation) <= 0.005) continue;
    for (const c of boxCorners(pose.box)) v = Math.max(v, (c.x - P.x) * f.x + (c.y - P.y) * f.y);
  }
  return v;
}

/** Gap between two pieces sharing a surface. */
const ON_GAP = 0.05;

/**
 * Where a piece standing on another sits along its width: the pieces share the surface in the
 * order the programme hints them, each taking as much room as it is wide, so the lamp lands beside
 * the TV and not in it. `null` when they do not all fit and the even spread has to do.
 */
function onRow(m: Model, n: Node, P: Box, parent: Node | undefined): number | null {
  // the pieces that take another branch of the `on` rule do not share the row
  const inRow = (s: Node) => s.spec.role !== 'mattress' && !(parent?.spec.shape === 'shelf' && s.spec.role === 'box');
  const sibs = [...m.nodes.values()].filter((s) => s.parent === n.parent && s.rule?.kind === 'on' && inRow(s));
  if (sibs.length < 2) return null;
  sibs.sort((a, b) => (a.rule as Extract<Rule, { index: number }>).index - (b.rule as Extract<Rule, { index: number }>).index);
  const total = sibs.reduce((v, s) => v + s.spec.width, 0) + ON_GAP * (sibs.length - 1);
  if (total > 2 * P.hw) return null;
  let u = -total / 2;
  for (const s of sibs) {
    if (s === n) return u + s.spec.width / 2;
    u += s.spec.width + ON_GAP;
  }
  return null;
}

function deriveNode(m: Model, n: Node): void {
  const r = n.rule!;
  const s = n.spec;
  const ctx = m.ctx;
  const hint = n.prog?.hint;
  n.elevation = s.elevation;
  if (r.kind === 'ceiling') {
    const z = m.zones.get(n.zone);
    // the room's only ceiling light is its main light: in the middle of the room, where the outlet
    // usually is, not wherever the programme happened to put it (#443)
    const overTable = hint && [...m.nodes.values()].some((o) => o.spec.role === 'table' && o.prog?.hint && Math.hypot(o.prog.hint.x - hint.x, o.prog.hint.y - hint.y) < 0.6);
    const only = !overTable && ![...m.nodes.values()].some((o) => o !== n && o.rule?.kind === 'ceiling' && !o.parent);
    const middle = centroidOf(ctx.poly);
    const c = only && pointInPolygon(middle, ctx.poly) ? middle : (hint ?? (z ? { x: (z.rect.x0 + z.rect.x1) / 2, y: (z.rect.y0 + z.rect.y1) / 2 } : middle));
    n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: 0 };
    n.elevation = Math.min(s.elevation, ctx.height - s.height - 0.05);
    // a hanging lamp gives way to tall furniture, its doors and an opened door leaf (#442)
    if (!hangFree(m, n, n.box)) {
      for (const d of [0.3, 0.6, 0.9, 1.2]) {
        const hit = Array.from({ length: 8 }, (_, k) => ({ ...n.box, x: c.x + Math.cos((k * Math.PI) / 4) * d, y: c.y + Math.sin((k * Math.PI) / 4) * d })).find((b) => hangFree(m, n, b));
        if (hit) {
          n.box = hit;
          break;
        }
      }
    }
    return;
  }
  if (r.kind === 'sill' || r.kind === 'curtain') {
    const win = ctx.windows.find((w) => w.label === r.window)!;
    const w = ctx.walls[win.wall];
    const span = win.t1 - win.t0;
    if (r.kind === 'sill') {
      const t = win.t0 + (span * (r.index + 0.5)) / r.count;
      n.box = boxOnWall(w, t, s.width, s.depth, 0.02);
      n.elevation = win.sill;
    } else {
      // drawn open: each panel gathered beside the frame, overlapping it a little; a pair frames the
      // window, a single panel goes to the side with more wall; near a corner it slides along the wall
      const g = curtainOpenWidth(s.width);
      const left = win.t0 - g / 2 + CURTAIN_OVERLAP;
      const right = win.t1 + g / 2 - CURTAIN_OVERLAP;
      const side = r.count === 1 ? (win.t0 >= w.length - win.t1 ? left : right) : r.index % 2 === 0 ? left : right;
      const t = clamp(side, g / 2, w.length - g / 2);
      n.box = boxOnWall(w, t, g, s.depth, 0.08);
      n.elevation = Math.max(0, Math.min(0.02, ctx.height - s.height - 0.02));
    }
    return;
  }
  const p = parentBox(m, n.parent!);
  if (!p) return;
  const P = p.box;
  const f = axisY(P.rotation);
  const x = axisX(P.rotation);
  const at = (u: number, v: number): Vec2 => ({ x: P.x + x.x * u + f.x * v, y: P.y + x.y * u + f.y * v });
  switch (r.kind) {
    case 'beside': {
      // left = to the left of someone sitting on the parent and looking out of its front (+x)
      let side = r.side === 'left' ? 1 : -1;
      if (!r.pair && hint) {
        const rel = (hint.x - P.x) * x.x + (hint.y - P.y) * x.y;
        if (Math.abs(rel) > P.hw * 0.5) side = rel > 0 ? 1 : -1;
      }
      const place = (sd: number): Box => {
        const c = at(sd * (P.hw + r.gap + s.width / 2), -P.hd + s.depth / 2);
        return { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation };
      };
      const a = place(side);
      n.box = !r.pair && insideScore(m, a) > 0 && insideScore(m, place(-side)) === 0 ? place(-side) : a;
      return;
    }
    case 'front': {
      if (s.role === 'seat') {
        // desk chair: faces the piece, pushed in a little
        const tuck = Math.min(0.2, s.depth * 0.35);
        const c = at(0, P.hd + s.depth / 2 - tuck + r.gap);
        n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation + Math.PI };
      } else if (s.base === 'rug') {
        // runner or mat in front of the piece; slid back towards it until it lies inside the room
        const v0 = P.hd + r.gap + Math.min(s.width, s.depth) / 2 + (n.parent?.startsWith('kitchen') ? 0.08 : 0);
        const options: Box[] = [];
        for (let back = 0; back <= v0 + 0.01; back += 0.05) options.push(rugBox(at(0, v0 - back), P.rotation, s.width, s.depth, true));
        n.box = options.find((b) => insideScore(m, b) === 0) ?? options[0];
      } else {
        const c = at(0, P.hd + r.gap + s.depth / 2);
        n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation };
      }
      return;
    }
    case 'under-front':
    case 'under-all': {
      const parentNode = m.nodes.get(n.parent!);
      const all = r.kind === 'under-all' || parentNode?.spec.role === 'table' || parentNode?.spec.role === 'coffee-table';
      const bed = parentNode?.spec.role === 'bed';
      const options: Box[] = [];
      // under a bed a rug that is long enough lies across it, 40–60 cm out on both sides (#443)
      const across = bed && Math.max(s.width, s.depth) >= 2 * P.hw + 0.6;
      for (const longAlong of across ? [false, true] : [true, false]) {
        const probe = rugBox({ x: 0, y: 0 }, P.rotation, s.width, s.depth, longAlong);
        const { ey } = extents(probe, P.rotation);
        let v: number;
        // from just below the nightstands to about 55 cm past the foot of the bed
        if (bed) v = -P.hd + clamp(2 * P.hd + 0.55 - 2 * ey, 0.3, 0.7) + ey;
        else if (all) v = 0;
        else v = P.hd - 0.2 + ey;
        for (const shift of [0, -0.2, -0.4, 0.2]) {
          const c = at(0, v + (all && !bed ? 0 : shift));
          options.push({ ...probe, x: c.x, y: c.y });
          if (all && !bed) break;
        }
      }
      n.box = options.find((b) => insideScore(m, b) === 0) ?? options[0];
      return;
    }
    case 'around': {
      const slots = chairSlots(P, s.depth);
      const open = slots.filter((sl) => insideScore(m, sl.box(s.width, s.depth)) === 0 && !m.ctx.fixed.some((fx) => fx.floor && distToBox(sl.c.x, sl.c.y, fx.box) < s.depth / 2));
      const pool = open.length >= r.count ? open : [...open, ...slots.filter((sl) => !open.includes(sl))];
      const chosen = pickSlots(pool, r.count, s.width, s.depth);
      const sl = chosen[r.index] ?? chosen[chosen.length - 1];
      n.box = sl.box(s.width, s.depth);
      return;
    }
    case 'above': {
      const parentNode = m.nodes.get(n.parent!);
      if (s.base === 'ceiling') {
        n.box = { x: P.x, y: P.y, hw: s.width / 2, hd: s.depth / 2, rotation: 0 };
        const tableLike = parentNode && ['table', 'coffee-table'].includes(parentNode.spec.role);
        const want = r.height ?? (tableLike || parentNode?.spec.category === 'desk' ? p.top + 0.65 : s.elevation);
        n.elevation = clamp(want, p.top + 0.3, ctx.height - s.height - 0.05);
        return;
      }
      if (s.base === 'wall' || s.item.kitchen) {
        const pose = wallAbove(m, n, P, p.top, r.height);
        n.box = pose.box;
        n.elevation = pose.elevation;
        return;
      }
      // stacked on top (dryer on the washer)
      n.box = { x: P.x, y: P.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation };
      n.elevation = p.top;
      return;
    }
    case 'on': {
      const parentNode = m.nodes.get(n.parent!);
      if (s.role === 'mattress') {
        n.box = { x: P.x, y: P.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation };
        n.elevation = Math.max(0, p.top - s.height);
        return;
      }
      if (parentNode?.spec.shape === 'shelf' && s.role === 'box') {
        const perRow = Math.max(1, Math.floor((2 * P.hw) / (s.width + 0.02)));
        const col = r.index % perRow;
        const row = Math.floor(r.index / perRow);
        const c = at(-P.hw + (2 * P.hw * (col + 0.5)) / Math.min(perRow, r.count), -P.hd + Math.min(s.depth, 2 * P.hd) / 2);
        n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: Math.min(s.depth, 2 * P.hd) / 2, rotation: P.rotation };
        n.elevation = p.elevation + 0.03 + row * 0.38;
        return;
      }
      const u = onRow(m, n, P, parentNode) ?? -P.hw + (2 * P.hw * (r.index + 0.5)) / r.count;
      const lim = Math.max(0, P.hw - s.width / 2);
      // on a table the chairs tuck in at the edges: what stands on it goes in the middle
      const table = parentNode?.spec.category === 'table';
      // it stands on the piece, not behind it (a pot on a wall shelf would reach into the wall), and
      // in front of what hangs over the piece at the same height (the lamp beside, not behind, the TV)
      const back = Math.max(-P.hd, hangingFront(m, n, P, p.top, p.top + s.height) + 0.01) + s.depth / 2;
      const v = table ? Math.max(0, back) : Math.max(back, -P.hd + Math.min(s.depth / 2 + 0.05, P.hd));
      const c = at(clamp(r.count === 1 && !table ? Math.min(lim, P.hw * 0.45) * (P.hw > 0.4 ? 1 : 0) : table && r.count === 1 ? 0 : u, -lim, lim), Math.min(v, P.hd));
      n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: P.rotation };
      n.elevation = p.top;
      return;
    }
  }
}

function centroidOf(poly: Vec2[]): Vec2 {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

interface Slot {
  side: number;
  c: Vec2;
  rot: number;
  box: (w: number, d: number) => Box;
}

/** Chair places round a table: long sides first, then the ends, spread along each side. */
function chairSlots(P: Box, chairDepth: number): Slot[] {
  const f = axisY(P.rotation);
  const x = axisX(P.rotation);
  const tuck = 0.12;
  const out: Slot[] = [];
  const sides: { n: Vec2; half: number; len: number; along: Vec2; cap: number; id: number }[] = [
    { n: f, half: P.hd, len: 2 * P.hw, along: x, cap: Math.max(1, Math.floor((2 * P.hw) / 0.6)), id: 0 },
    { n: scale(f, -1), half: P.hd, len: 2 * P.hw, along: x, cap: Math.max(1, Math.floor((2 * P.hw) / 0.6)), id: 1 },
    { n: x, half: P.hw, len: 2 * P.hd, along: f, cap: 2 * P.hd >= 0.6 ? 1 : 0, id: 2 },
    { n: scale(x, -1), half: P.hw, len: 2 * P.hd, along: f, cap: 2 * P.hd >= 0.6 ? 1 : 0, id: 3 },
  ];
  for (const sd of sides) {
    for (let k = 0; k < sd.cap; k++) {
      const off = -sd.len / 2 + (sd.len * (k + 0.5)) / sd.cap;
      const c = add(add({ x: P.x, y: P.y }, scale(sd.n, sd.half + chairDepth / 2 - tuck)), scale(sd.along, off));
      const rot = rotationFacing(scale(sd.n, -1));
      out.push({ side: sd.id, c, rot, box: (w, d) => ({ x: c.x, y: c.y, hw: w / 2, hd: d / 2, rotation: rot }) });
    }
  }
  return out;
}

/** n slots, alternating between the open sides so chairs face each other; never two chairs in one place. */
function pickSlots(pool: Slot[], n: number, width: number, depth: number): Slot[] {
  const bySide = new Map<number, Slot[]>();
  for (const s of pool) bySide.set(s.side, [...(bySide.get(s.side) ?? []), s]);
  const order = [0, 1, 2, 3].filter((s) => bySide.has(s));
  const out: Slot[] = [];
  const used = new Map<number, number>();
  // fill the long sides evenly, the ends only when the long sides are full
  for (let guard = 0; out.length < n && guard < 40; guard++) {
    let progressed = false;
    for (const sd of order) {
      if (out.length >= n) break;
      if (sd >= 2 && order.some((o) => o < 2 && (used.get(o) ?? 0) < bySide.get(o)!.length)) continue;
      const list = bySide.get(sd)!;
      let k = used.get(sd) ?? 0;
      // at a small table the places of two sides meet in the corner: skip a place already taken
      while (k < list.length && out.some((o) => overlapDepth(boxCorners(o.box(width, depth)), boxCorners(list[k].box(width, depth))) > 0.002)) k++;
      if (k < list.length) {
        out.push(list[k]);
        used.set(sd, k + 1);
        progressed = true;
      } else if ((used.get(sd) ?? 0) < list.length) used.set(sd, list.length);
    }
    if (!progressed) break;
  }
  if (!out.length && pool.length) out.push(pool[0]);
  // keep chairs of one side spread evenly over the side
  return out;
}

/** Kitchen modules along the wall from the block start. */
function placeKitchen(m: Model, u: Unit): void {
  const k = u.kitchen!;
  const w = m.ctx.walls[k.wall];
  k.s = clamp(k.s, 0, Math.max(0, w.length - k.length));
  const mods = u.nodes.filter((n) => n.run !== undefined);
  // program order runs from `from` to `to`; along the wall that is forwards or backwards
  let order = k.backwards ? [...mods].reverse() : [...mods];
  if (k.reversed) order = order.reverse();
  let t = k.s;
  for (const n of order) {
    n.box = boxOnWall(w, t + n.spec.width / 2, n.spec.width, n.spec.depth, WALL_GAP);
    n.elevation = 0;
    t += n.spec.width;
  }
}

/** Recompute every pose of a unit and the derived polygons. */
export function refreshUnit(m: Model, u: Unit): void {
  if (u.kitchen) placeKitchen(m, u);
  for (const n of u.nodes) {
    if (n.run !== undefined) continue;
    if (n.rule && (n !== u.main || u.kind === 'fixed')) deriveNode(m, n);
    else {
      n.box = mainBox(m, u, n);
      n.elevation = n.spec.base === 'wall' ? n.spec.elevation : 0;
    }
  }
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of u.nodes) {
    finishNode(n);
    b.x0 = Math.min(b.x0, n.box.x - n.reach);
    b.y0 = Math.min(b.y0, n.box.y - n.reach);
    b.x1 = Math.max(b.x1, n.box.x + n.reach);
    b.y1 = Math.max(b.y1, n.box.y + n.reach);
  }
  u.bounds = b;
}

/** Polygons of a node after its box changed. */
export function finishNode(n: Node): void {
  n.poly = boxCorners(n.box);
  // a chair needs room behind it only at a table or desk (pulled out); a hall chair stands at the wall
  const atTable = n.rule?.kind === 'around' || n.rule?.kind === 'front';
  const clear = n.spec.role === 'seat' && !atTable ? n.spec.clear.filter((c) => c.side !== 'back') : n.spec.clear;
  // the band a movement area blocks: from a hand's width above the piece's base to its top
  const z0 = n.elevation + 0.05;
  const z1 = n.elevation + n.spec.height;
  n.clear = clear.map((c) => ({ poly: sideStrip(n.box, c.side, c.min, c.from ?? 0, c.to ?? 1), either: !!c.either, z0, z1 }));
  // what the plan insists on: the doors and drawers in front have to open (`placementIssues`).
  // The same strip as there, a centimetre narrower on each side so a corner does not count.
  const need = frontClearance({ ...n.spec.item, elevation: n.spec.item.elevation ?? 0 });
  const inset = Math.min(0.3, 0.01 / Math.max(0.05, n.spec.width));
  if (need > 0) n.clear.push({ poly: sideStrip(n.box, 'front', need, inset, 1 - inset), either: false, strict: true, z0, z1 });
  let c = 0;
  for (const x of clear) c = Math.max(c, x.comfort);
  n.reach = Math.hypot(n.box.hw + c, n.box.hd + c) + 0.25;
  n.comfort = clear.filter((c) => c.comfort > c.min).map((c) => sideStrip(n.box, c.side, c.comfort, c.from ?? 0, c.to ?? 1));
}

/** Swap a node to a smaller catalogue piece (fallback). */
export function resizeNode(m: Model, n: Node, catalogId: string): boolean {
  const spec = specOf(catalogId, m.ctx.catalog);
  if (!spec) return false;
  n.replaces ??= n.catalogId;
  n.catalogId = catalogId;
  n.spec = spec;
  return true;
}

export { runId };
