/**
 * Poses of a unit: the main piece from the unit's state (on a wall or free), the kitchen run
 * as a block, and every dependent piece from its parent (chairs round the table, nightstands,
 * rug, picture above, lamp on top, curtain at the window).
 */
import { add, scale, type Vec2 } from '../../model/vec';
import { rotationFacing } from '../../suggest/roomGeometry';
import { axisX, axisY, boxCorners, clamp, distToBox, outsideAmount, type Box } from './geom';
import { specOf } from './items';
import type { Model, Node, Unit } from './model';
import { runId } from './model';
import { boxOnWall, pointOnWall, sideStrip } from './room';

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
  return outsideAmount(boxCorners(b), m.ctx.poly);
}

function deriveNode(m: Model, n: Node): void {
  const r = n.rule!;
  const s = n.spec;
  const ctx = m.ctx;
  const hint = n.prog?.hint;
  n.elevation = s.elevation;
  if (r.kind === 'ceiling') {
    const z = m.zones.get(n.zone);
    const c = hint ?? (z ? { x: (z.rect.x0 + z.rect.x1) / 2, y: (z.rect.y0 + z.rect.y1) / 2 } : centroidOf(ctx.poly));
    n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: 0 };
    n.elevation = Math.min(s.elevation, ctx.height - s.height - 0.05);
    return;
  }
  if (r.kind === 'sill' || r.kind === 'curtain') {
    const win = ctx.windows.find((w) => w.label === r.window)!;
    const w = ctx.walls[win.wall];
    const mid = (win.t0 + win.t1) / 2;
    const span = win.t1 - win.t0;
    if (r.kind === 'sill') {
      const t = win.t0 + (span * (r.index + 0.5)) / r.count;
      n.box = boxOnWall(w, t, s.width, s.depth, 0.02);
      n.elevation = win.sill;
    } else {
      const t = r.count === 1 ? mid : clamp(win.t0 + (span * r.index) / (r.count - 1), s.width / 2, w.length - s.width / 2);
      n.box = boxOnWall(w, t, s.width, s.depth, 0.08);
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
        const v0 = P.hd + r.gap + Math.min(s.width, s.depth) / 2 + (n.parent?.startsWith('kitchen') ? 0.15 : 0);
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
      for (const longAlong of [true, false]) {
        const probe = rugBox({ x: 0, y: 0 }, P.rotation, s.width, s.depth, longAlong);
        const { ey } = extents(probe, P.rotation);
        let v: number;
        if (bed) v = -P.hd + 0.35 * 2 * P.hd + ey;
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
      const chosen = pickSlots(pool, r.count);
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
        // hangs on the wall behind the parent; a free-standing parent: on the wall nearest the hint
        const parentUnit = parentNode ? m.units[parentNode.unit] : null;
        const parentOnWall = parentUnit && parentUnit.mode === 'wall' && parentUnit.main === parentNode;
        const wi = parentOnWall ? parentUnit.wall : nearestWallTo(m, hint ?? { x: P.x, y: P.y });
        const w = ctx.walls[wi];
        const t = clamp((P.x - w.a.x) * w.dir.x + (P.y - w.a.y) * w.dir.y, s.width / 2, Math.max(s.width / 2, w.length - s.width / 2));
        n.box = boxOnWall(w, t, s.width, s.depth, 0.002);
        const gap = s.role === 'tv' ? 0.05 : 0.2;
        const want = r.height ?? Math.max(s.elevation, p.top + gap);
        n.elevation = clamp(want, 0, ctx.height - s.height - 0.02);
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
      const u = -P.hw + (2 * P.hw * (r.index + 0.5)) / r.count;
      const lim = Math.max(0, P.hw - s.width / 2);
      const c = at(clamp(r.count === 1 ? Math.min(lim, P.hw * 0.45) * (P.hw > 0.4 ? 1 : 0) : u, -lim, lim), -P.hd + Math.min(s.depth / 2 + 0.05, P.hd));
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

/** n slots, alternating between the open sides so chairs face each other. */
function pickSlots(pool: Slot[], n: number): Slot[] {
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
      const k = used.get(sd) ?? 0;
      const list = bySide.get(sd)!;
      if (k < list.length) {
        out.push(list[k]);
        used.set(sd, k + 1);
        progressed = true;
      }
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
  n.clear = n.spec.clear.map((c) => ({ poly: sideStrip(n.box, c.side, c.min, c.from ?? 0, c.to ?? 1), either: !!c.either }));
  let c = 0;
  for (const x of n.spec.clear) c = Math.max(c, x.comfort);
  n.reach = Math.hypot(n.box.hw + c, n.box.hd + c) + 0.25;
  n.comfort = n.spec.clear.filter((c) => c.comfort > c.min).map((c) => sideStrip(n.box, c.side, c.comfort, c.from ?? 0, c.to ?? 1));
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
