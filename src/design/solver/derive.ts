/**
 * Poses of a unit: the main piece from the unit's state (on a wall or free), the kitchen run
 * as a block, and every dependent piece from its parent (chairs round the table, nightstands,
 * rug, picture above, lamp on top, curtain at the window).
 */
import { add, pointInPolygon, scale, type Vec2 } from '../../model/vec';
import { rotationFacing, SOFT_SHAPES } from '../../suggest/roomGeometry';
import { axisX, axisY, boxCorners, clamp, distToBox, distToSegment, outsideAmount, overlapDepth, WALL_TOL, type Box } from './geom';
import { specOf, type Spec } from './items';
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
/** How far an open panel reaches past the frame at most (m). */
const CURTAIN_BEYOND = 0.25;
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

/** Whether a rug reaches into the swing of a door: the door catches on it (D5). */
export function inSwing(m: Model, b: Box): boolean {
  const poly = boxCorners(b);
  return m.ctx.swings.some((s) => overlapDepth(poly, s.poly) > 1e-3);
}

/**
 * Floor left free between a rug and the walls (m, smallest over its corners); a curtain standing
 * on the rug counts as 0. A grown rug keeps a border of floor round it (image review r13: 13 cm to
 * the window wall, the curtains standing on it).
 */
export function rugBorder(m: Model, b: Box): number {
  const poly = boxCorners(b);
  for (const n of m.nodes.values()) if (n.spec.base === 'curtain' && m.units[n.unit].active && overlapDepth(poly, n.poly) > 1e-3) return 0;
  const room = m.ctx.poly;
  let d = Infinity;
  for (const p of poly) for (let i = 0; i < room.length; i++) d = Math.min(d, distToSegment(p, room[i], room[(i + 1) % room.length]));
  return d;
}

/** The first rug option inside the room and out of every door swing, else the first inside, else the one that sticks out least. */
function pickRug(m: Model, options: Box[]): Box {
  // lazily, as before: the search derives rugs on every move
  let firstInside: Box | null = null;
  for (const b of options) {
    if (insideScore(m, b) !== 0) continue;
    if (!m.ctx.swings.length || !inSwing(m, b)) return b;
    firstInside ??= b;
  }
  return firstInside ?? options.reduce((a, b) => (insideScore(m, b) < insideScore(m, a) ? b : a));
}

/**
 * Where a wall piece hangs above its parent: on the wall behind it (a free-standing parent: the
 * nearest wall to its place), never lower than the parent's top (Claude's height can be too low).
 */
/** Height of a picture's middle above the floor (R7: 145–155 cm). */
const ART_MIDDLE = 1.5;
/** Highest middle of a mirror lifted over what stands below it (m): face height. */
const MIRROR_MIDDLE_MAX = 1.75;

/**
 * Height of a wall piece that hangs on its own. A picture's middle at eye height (R7): the
 * catalogue heights put a 70 cm picture's middle at 1.70–1.75 m, which the image review of r7
 * called much too high.
 */
function ownWallElevation(s: Spec): number {
  const art = s.shape === 'picture' || s.shape === 'picture-set';
  return art ? Math.min(s.elevation, ART_MIDDLE - s.height / 2) : s.elevation;
}

/** A television stands on the piece or hangs over it: a picture there keeps its own height. */
function screenOn(m: Model, parent: string): boolean {
  for (const o of m.nodes.values()) if (o.parent === parent && o.spec.role === 'tv') return true;
  return false;
}

/** Least room (m) between the desktop and a shelf or cabinet hung over it: screen and desk lamp stand under it. */
const DESK_SHELF_CLEAR = 0.5;

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
  // a picture over a piece: middle at eye height, but 15–30 cm over the piece so it belongs to it (R7)
  const art = s.shape === 'picture' || s.shape === 'picture-set';
  const fallback = art ? clamp(ART_MIDDLE - s.height / 2, parentTop + 0.15, parentTop + 0.3) : Math.max(s.elevation, parentTop + gap);
  let want = Math.max(height ?? fallback, parentTop + 0.02);
  const box = boxOnWall(w, t, s.width, s.depth, 0.002);
  // the parent stands free in the room, the picture on a wall of its own: Claude's height meant
  // „over the sofa“, on the bare wall it hangs at eye height (image review r9: lower edge at 102 cm)
  if (art && distToBox(box.x, box.y, P) > 0.5) want = ART_MIDDLE - s.height / 2;
  // over the piece it belongs to it: 15–30 cm above, whatever height Claude named (image review
  // r14: 65 cm over the lowboard, „wirkt losgelöst“), unless a screen stands or hangs there
  else if (art && height !== undefined && !screenOn(m, n.parent!)) want = clamp(want, parentTop + 0.15, parentTop + 0.3);
  // a shelf over the desk leaves room for the screen and the desk lamp under it (image review r13:
  // 41 cm over the desktop, the monitor stood against the shelf)
  if (!art && s.role !== 'tv' && s.role !== 'mirror' && parentNode?.spec.category === 'desk') want = Math.max(want, parentTop + DESK_SHELF_CLEAR);
  // a mirror over a chest: the lamp or vase standing on it must not hide it (image review r9: the
  // lamp covered half the round mirror). Its lower edge goes over them while its middle stays at
  // face height.
  if (s.role === 'mirror') {
    const tallest = Math.max(0, ...[...m.nodes.values()].filter((o) => o.parent === n.parent && o.rule?.kind === 'on' && !SOFT_SHAPES.has(o.spec.shape)).map((o) => o.spec.height));
    const clear = parentTop + tallest + 0.05;
    if (tallest > 0.1 && clear > want && clear + s.height / 2 <= MIRROR_MIDDLE_MAX) want = clear;
  }
  return { box, elevation: clamp(want, 0, ctx.height - s.height - 0.02) };
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
function hangingFront(m: Model, n: Node, P: Box, z0: number, z1: number, u0 = -Infinity, u1 = Infinity): number {
  const f = axisY(P.rotation);
  const side = axisX(P.rotation);
  let v = -Infinity;
  for (const sib of m.nodes.values()) {
    if (sib === n || sib.parent !== n.parent || sib.spec.base !== 'wall' || sib.rule?.kind !== 'above') continue;
    const pose = wallAbove(m, sib, P, z0, sib.rule.height);
    if (Math.min(z1, pose.elevation + sib.spec.height) - Math.max(z0, pose.elevation) <= 0.005) continue;
    const corners = boxCorners(pose.box);
    // beside it, not under it: nothing to step in front of
    const along = corners.map((c) => (c.x - P.x) * side.x + (c.y - P.y) * side.y);
    if (Math.max(...along) <= u0 + 0.005 || Math.min(...along) >= u1 - 0.005) continue;
    for (const c of corners) v = Math.max(v, (c.x - P.x) * f.x + (c.y - P.y) * f.y);
  }
  return v;
}

/**
 * A lamp on a desk. Someone sitting at a desk looks into it (−front), so the desk's +x is their
 * right: the lamp goes to −x, on the left of a right-handed writer (image review r7, A and B).
 */
function deskLamp(parent: Node | undefined, s: Spec): boolean {
  return parent?.spec.category === 'desk' && s.role === 'table-lamp';
}

/** How far a light over no table reaches down from the ceiling (m); `toLayout` shortens it to that. */
export const CEILING_DROP = 0.25;

/** Lowest edge of a pendant over a coffee table (m above the floor). */
const COFFEE_PENDANT_MIN = 1.9;

/** Gap between two pieces sharing a surface. */
const ON_GAP = 0.05;

/** The pieces sharing a surface with `n` in a row, in row order (`n` among them). */
function rowSiblings(m: Model, n: Node, parent: Node | undefined): Node[] {
  // the pieces that take another branch of the `on` rule do not share the row
  const inRow = (s: Node) => s.spec.role !== 'mattress' && !SOFT_SHAPES.has(s.spec.shape) && !(parent?.spec.shape === 'shelf' && s.spec.role === 'box');
  const sibs = [...m.nodes.values()].filter((s) => s.parent === n.parent && s.rule?.kind === 'on' && inRow(s));
  // the desk lamp first: on the sitter's left (−x), its light does not fall into the shadow of the writing hand
  const lampFirst = (s: Node) => (deskLamp(parent, s.spec) ? 0 : 1);
  return sibs.sort((a, b) => lampFirst(a) - lampFirst(b) || (a.rule as Extract<Rule, { index: number }>).index - (b.rule as Extract<Rule, { index: number }>).index);
}

/**
 * The pieces on a surface are wider together than it is (a lamp and a vase on a nightstand):
 * they stand diagonally, the first at the back edge, the rest at the front one, so their round
 * bodies pass each other. 0 when the row fits, −1 back, +1 front.
 */
function onStagger(m: Model, n: Node, P: Box, parent: Node | undefined): number {
  if (parent?.spec.category === 'table') return 0;
  const sibs = rowSiblings(m, n, parent);
  if (sibs.length < 2 || !sibs.includes(n) || sibs.reduce((v, s) => v + s.spec.width, 0) <= 2 * P.hw + 0.005) return 0;
  return sibs[0] === n ? -1 : 1;
}

/**
 * Where a piece standing on another sits along its width: the pieces share the surface in the
 * order the programme hints them, each taking as much room as it is wide, so the lamp lands beside
 * the TV and not in it. `null` when they do not all fit and the even spread has to do.
 */
function onRow(m: Model, n: Node, P: Box, parent: Node | undefined): number | null {
  const sibs = rowSiblings(m, n, parent);
  // a screen or a picture hanging over the piece takes its middle: what stands on it goes to the ends (#443, R7)
  const screenAbove = [...m.nodes.values()].some((s) => s.parent === n.parent && s.rule?.kind === 'above' && (s.spec.role === 'tv' || s.spec.shape === 'picture' || s.spec.shape === 'picture-set'));
  if (sibs.length < 2 && !screenAbove) return null;
  const widths = sibs.reduce((v, s) => v + s.spec.width, 0);
  const total = widths + ON_GAP * (sibs.length - 1);
  if (total > 2 * P.hw) {
    // too narrow for a row with gaps (a lamp and a vase on a nightstand): the first piece at the
    // left end, the last at the right end, the rest spread between, so they touch rather than
    // stand in each other (image review r10); `onFront` moves the rest forward when even that is short
    if (sibs.length < 2) return null;
    const k = sibs.indexOf(n);
    if (k < 0) return null;
    const first = -P.hw + sibs[0].spec.width / 2;
    const last = P.hw - sibs[sibs.length - 1].spec.width / 2;
    return first + ((last - first) * k) / (sibs.length - 1);
  }
  const gap = screenAbove && sibs.length > 1 ? (2 * P.hw - widths) / (sibs.length - 1) : ON_GAP;
  let u = screenAbove ? -P.hw : -total / 2;
  for (const s of sibs) {
    if (s === n) return u + s.spec.width / 2;
    u += s.spec.width + gap;
  }
  return null;
}

/** Seat height and bed top of the procedural models (ProceduralModel: sofa seat 0.45, bed 0.32 frame + 0.22 mattress). */
const SEAT_TOP = 0.45;
/** Seat height of the procedural chair (ProceduralModel `chair`). */
const CHAIR_SEAT = 0.47;
const BED_TOP = 0.56;

/**
 * Where cushions and throws lie on a seat or a bed: cushions at one end of the sofa against its back,
 * the throw at the other end; on a bed the cushions in front of the pillows and the plaid across the foot.
 * `null` when the parent offers no seat (they then go like any small piece on a surface).
 */
function softOn(parent: Spec, s: Spec, P: Box): { u: number; v: number; hw: number; elevation: number } | null {
  const hw = s.width / 2;
  if (parent.role === 'bed') {
    if (s.shape === 'bed-throw') return { u: 0, v: P.hd - s.depth / 2 - 0.12, hw: Math.min(hw, P.hw), elevation: BED_TOP + 0.03 };
    if (s.shape === 'cushions') return { u: 0, v: -P.hd + 0.62 + s.depth / 2, hw: Math.min(hw, P.hw - 0.05), elevation: BED_TOP + 0.03 };
    return null;
  }
  // a cushion on a dining or desk chair lies on its seat against the back, not on top of the back
  // rest (image review r13, A Küche: „Sitzkissen auf Lehnenhöhe, 86 cm“)
  if (parent.shape === 'chair') {
    const seat = Math.min(CHAIR_SEAT, parent.height * 0.55);
    return { u: 0, v: -P.hd + Math.min(s.depth, 2 * P.hd) / 2 + 0.03, hw: Math.min(hw, P.hw), elevation: seat };
  }
  if (parent.shape !== 'sofa' && parent.shape !== 'armchair' && parent.shape !== 'sofa-corner') return null;
  const arm = Math.min(0.2, 2 * P.hw * 0.13);
  const seatTop = Math.min(SEAT_TOP, parent.height * 0.55);
  const reach = Math.max(0, P.hw - arm - hw - 0.03);
  const back = -P.hd + Math.min(0.24, 2 * P.hd * 0.27) * 0.6 + 0.06 + s.depth / 2;
  if (parent.shape === 'armchair') return { u: s.shape === 'throw' ? Math.min(reach, 0.1) : 0, v: s.shape === 'throw' ? back + 0.18 : back, hw, elevation: seatTop };
  // sofa: cushions in the corner at the right arm, throw at the left one
  return { u: s.shape === 'cushions' ? reach : -reach, v: s.shape === 'cushions' ? back : back + 0.1, hw, elevation: seatTop };
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
    // a light that hangs over no table sits close under the ceiling: a pendant at 1.90 m in the
    // middle of the room is at head height where people walk (paired image review r13, A Zimmer 2:
    // „hängt mitten im Durchgang auf 190 cm, besser eine flache Deckenleuchte“)
    n.elevation = overTable ? Math.min(s.elevation, ctx.height - s.height - 0.05) : ctx.height - Math.min(s.height, CEILING_DROP);
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
      // the rod reaches 10–25 cm past the frame (image review r7: 40 cm looked too wide)
      const g = Math.min(curtainOpenWidth(s.width), CURTAIN_BEYOND + CURTAIN_OVERLAP);
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
    case 'flank': {
      // at the end of the table, turned towards it: the armchair that closes a seating group (W1)
      let side = r.side === 'left' ? 1 : r.side === 'right' ? -1 : 1;
      if (!r.side && hint) {
        const rel = (hint.x - P.x) * x.x + (hint.y - P.y) * x.y;
        if (Math.abs(rel) > 0.05) side = rel > 0 ? 1 : -1;
      }
      // level with the far half of the table: clear of the sofa's legroom, the group a U
      const place = (sd: number): Box => {
        const c = at(sd * (P.hw + r.gap + s.depth / 2), P.hd);
        return { x: c.x, y: c.y, hw: s.width / 2, hd: s.depth / 2, rotation: rotationFacing(scale(x, -sd)) };
      };
      const a = place(side);
      n.box = insideScore(m, a) > 0 && insideScore(m, place(-side)) === 0 ? place(-side) : a;
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
        // the first that lies inside the room and out of the door swings, else as close as it gets
      n.box = pickRug(m, options);
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
      // under a bed a rug lies across it, 40–60 cm out on both sides (#443); under a sofa its long side runs along the sofa
      // (`longAlong`: the long side runs along the parent's width, i.e. across the bed; the order was
      // the wrong way round and laid a 160×230 rug lengthwise under a 160 bed, hidden – test flat B, 6.11.)
      for (const longAlong of [true, false]) {
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
      // the first that lies inside the room and out of the door swings (D5), else as close as it gets
      n.box = pickRug(m, options);
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
        // over the coffee table it hangs above the line of sight from the sofa and above the head of
        // someone getting up (image review r9: „Deckenleuchte auf 160 cm“); 60–70 cm is for the dining table
        const coffee = parentNode?.spec.role === 'coffee-table';
        n.elevation = clamp(coffee ? Math.max(want, COFFEE_PENDANT_MIN) : want, p.top + 0.3, ctx.height - s.height - 0.05);
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
      if (SOFT_SHAPES.has(s.shape) && parentNode) {
        const pose = softOn(parentNode.spec, s, P);
        if (pose) {
          const c = at(pose.u, pose.v);
          n.box = { x: c.x, y: c.y, hw: pose.hw, hd: s.depth / 2, rotation: P.rotation };
          n.elevation = pose.elevation;
          return;
        }
      }
      if (parentNode?.spec.shape === 'shelf' && s.role === 'box') {
        const perRow = Math.max(1, Math.floor((2 * P.hw) / (s.width + 0.02)));
        const col = r.index % perRow;
        const row = Math.floor(r.index / perRow);
        const c = at(-P.hw + (2 * P.hw * (col + 0.5)) / Math.min(perRow, r.count), -P.hd + Math.min(s.depth, 2 * P.hd) / 2);
        n.box = { x: c.x, y: c.y, hw: s.width / 2, hd: Math.min(s.depth, 2 * P.hd) / 2, rotation: P.rotation };
        // a still life goes on a board at eye level, boxes fill the shelf from the bottom (#436)
        const decor = s.shape === 'decor' && s.category === 'decor';
        n.elevation = p.elevation + 0.03 + (decor ? Math.max(0, Math.min(3, Math.floor((p.top - p.elevation - 0.4) / 0.38))) : row) * 0.38;
        return;
      }
      const row = onRow(m, n, P, parentNode);
      const u = row ?? -P.hw + (2 * P.hw * (r.index + 0.5)) / r.count;
      const lim = Math.max(0, P.hw - s.width / 2);
      // on a table the chairs tuck in at the edges: what stands on it goes in the middle
      const table = parentNode?.spec.category === 'table';
      const alone = Math.min(lim, P.hw * 0.45) * (P.hw > 0.4 ? 1 : 0) * (deskLamp(parentNode, s) ? -1 : 1);
      const side = clamp(r.count === 1 && !table && row === null ? alone : table && r.count === 1 ? 0 : u, -lim, lim);
      // it stands on the piece, not behind it (a pot on a wall shelf would reach into the wall), and
      // in front of what hangs over the piece at the same height (the lamp beside, not behind, the TV)
      const back = Math.max(-P.hd, hangingFront(m, n, P, p.top, p.top + s.height, side - s.width / 2, side + s.width / 2) + 0.01) + s.depth / 2;
      const v0 = table ? Math.max(0, back) : Math.max(back, -P.hd + Math.min(s.depth / 2 + 0.05, P.hd));
      const stagger = row === null ? 0 : onStagger(m, n, P, parentNode);
      const v = stagger > 0 ? Math.max(v0, P.hd - s.depth / 2 - 0.01) : stagger < 0 ? Math.max(back, Math.min(v0, -P.hd + s.depth / 2 + 0.01)) : v0;
      const c = at(side, Math.min(v, P.hd));
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
      n.elevation = n.spec.base === 'wall' ? ownWallElevation(n.spec) : 0;
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
