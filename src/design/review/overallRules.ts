/** E Gesamteindruck (#441): how full, how coherent, which colours, what one sees on entering. */
import { dist, pointInPolygon, type Vec2 } from '../../model/vec';
import type { RoomType } from '../../suggest/furnishing';
import type { RoomCtx } from './context';
import { polyDist, segmentHitsConvex } from './geom';
import { isKitchenModule } from './items';

/** Share of the floor covered by pieces standing on it (chairs at a table do not count extra). */
export function occupancy(ctx: RoomCtx): number {
  const used = ctx.items.filter((i) => i.floor && i.role !== 'seat').reduce((s, i) => s + i.width * i.depth, 0);
  return ctx.an.area > 0 ? used / ctx.an.area : 0;
}

const FULL: Partial<Record<RoomType, [number, number]>> = {
  living: [0.2, 0.45],
  bedroom: [0.25, 0.5],
  kids: [0.25, 0.5],
  office: [0.2, 0.45],
  dining: [0.15, 0.45],
  hall: [0, 0.2],
};
const EMPTY_LIMIT = 0.15;

/** E1 (M): too full or half-heartedly empty. */
export function checkOccupancy(ctx: RoomCtx): void {
  const range = FULL[ctx.type];
  if (!range) return;
  const o = occupancy(ctx);
  const pct = Math.round(o * 100);
  if (o > range[1] + 1e-9) ctx.add('E1', 'M', `Der Raum ist mit ${pct} % der Fläche zu voll, mehr als ${Math.round(range[1] * 100)} % wirken eng.`, [], ctx.an.polygon[0]);
  else if (o < EMPTY_LIMIT && ['living', 'bedroom', 'kids', 'office'].includes(ctx.type)) ctx.add('E1', 'M', `Der Raum wirkt mit nur ${pct} % Möbelfläche halbherzig eingerichtet.`, [], ctx.an.polygon[0]);
  else if (o < range[0] && ['living', 'bedroom', 'kids', 'office'].includes(ctx.type)) ctx.add('E1', 'L', `Der Raum wirkt mit ${pct} % Möbelfläche eher leer, wohnlich sind ab ${Math.round(range[0] * 100)} %.`, [], ctx.an.polygon[0]);
}

const BALANCED: ReadonlySet<RoomType> = new Set<RoomType>(['living', 'bedroom', 'kids', 'office', 'dining']);

/**
 * E6 (M, #443): one half of a room stays almost empty while everything stands in the other – the
 * picture a person notices first („halb eingerichtet“). The room is cut across its longer side;
 * rugs do not fill a half, chairs do.
 */
export function checkBalance(ctx: RoomCtx): void {
  if (!BALANCED.has(ctx.type) || ctx.an.area < 12) return;
  const { share, alongX, mid, box } = halfShares(ctx);
  const [x0, x1, y0, y1] = box;
  const empty = share[0] <= share[1] ? 0 : 1;
  if (share[empty] >= BALANCE_EMPTY || share[1 - empty] < 3 * share[empty]) return;
  const side = alongX ? (empty === 0 ? 'westliche' : 'östliche') : empty === 0 ? 'nördliche' : 'südliche';
  const at = alongX ? { x: empty === 0 ? (x0 + mid) / 2 : (mid + x1) / 2, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: empty === 0 ? (y0 + mid) / 2 : (mid + y1) / 2 };
  ctx.add('E6', 'M', `Die ${side} Hälfte des Raums bleibt fast leer (${Math.round(share[empty] * 100)} % Möbelfläche), in der anderen steht alles (${Math.round(share[1 - empty] * 100)} %).`, [], at);
}

/**
 * E6 (M), the other picture of „half furnished“ (#443): an open patch of floor wider than about
 * 3.6 m, far from every piece and rug, in a room of the balanced kinds. Areas the user keeps free
 * count as furnished. Measured on a 10 cm grid: the largest distance of a free spot to anything.
 */
export function checkOpenPatch(ctx: RoomCtx): void {
  if (!BALANCED.has(ctx.type) || ctx.an.area < 12) return;
  const r = largestOpening(ctx);
  if (r.radius <= OPEN_RADIUS) return;
  ctx.add('E6', 'M', `Eine Fläche von etwa ${(2 * r.radius).toFixed(1)} m Durchmesser bleibt ganz ohne Möbel, der Raum wirkt dort unbewohnt.`, [], r.at);
}

/** Radius (m) of the largest open patch a furnished room may keep (walkways and space to move included). */
export const OPEN_RADIUS = 1.8;

/** The free spot farthest from every piece on the floor and every rug (walls do not count). */
export function largestOpening(ctx: RoomCtx): { radius: number; at: Vec2 } {
  const xs = ctx.an.polygon.map((p) => p.x);
  const ys = ctx.an.polygon.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pieces = ctx.items.filter((i) => i.floor || i.role === 'rug');
  const kept = ctx.an.userZones.filter((z) => z.keepFree).map((z) => z.points);
  const step = 0.1;
  const free: Vec2[] = [];
  const used: Vec2[] = [];
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, ctx.an.polygon)) continue;
      (pieces.some((i) => pointInPolygon(p, i.poly)) || kept.some((z) => pointInPolygon(p, z)) ? used : free).push(p);
    }
  let best = { radius: 0, at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
  if (!used.length) return best;
  for (const p of free) {
    let d = Infinity;
    for (const u of used) {
      const e = Math.hypot(u.x - p.x, u.y - p.y);
      if (e < d) d = e;
      if (d <= best.radius) break;
    }
    if (d > best.radius) best = { radius: d, at: p };
  }
  return best;
}

/** Below this share of furniture a half of the room counts as empty. */
export const BALANCE_EMPTY = 0.15;

/** Share of the floor covered by standing pieces in the two halves of the room, cut across its longer side. */
export function halfShares(ctx: RoomCtx): { share: [number, number]; alongX: boolean; mid: number; box: [number, number, number, number] } {
  const xs = ctx.an.polygon.map((p) => p.x);
  const ys = ctx.an.polygon.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const alongX = x1 - x0 >= y1 - y0;
  const mid = alongX ? (x0 + x1) / 2 : (y0 + y1) / 2;
  const pieces = ctx.items.filter((i) => i.floor);
  const halves = [
    { total: 0, used: 0 },
    { total: 0, used: 0 },
  ];
  const step = 0.1;
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, ctx.an.polygon)) continue;
      const h = halves[(alongX ? x : y) < mid ? 0 : 1];
      h.total++;
      if (pieces.some((i) => pointInPolygon(p, i.poly))) h.used++;
    }
  const share = halves.map((h) => (h.total ? h.used / h.total : 0)) as [number, number];
  return { share, alongX, mid, box: [x0, x1, y0, y1] };
}

/** E2 (L): a piece far outside its zone, zones overlapping. */
export function checkZones(ctx: RoomCtx): void {
  const prog = ctx.program;
  if (!prog) return;
  for (const i of ctx.placed) {
    if (!i.floor && i.elevation > 0.05 && ctx.parentOf(i)) continue;
    const z = prog.zones.find((q) => q.id === i.zone);
    if (!z) continue;
    const r = z.rect;
    const out = Math.hypot(Math.max(r.x0 - i.x, i.x - r.x1, 0), Math.max(r.y0 - i.y, i.y - r.y1, 0));
    if (out > 1.0) ctx.add('E2', 'L', `${ctx.label(i)} steht ${out.toFixed(1)} m außerhalb von „${z.function}“.`, [i], i);
  }
  const area = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  for (let a = 0; a < prog.zones.length; a++)
    for (let b = a + 1; b < prog.zones.length; b++) {
      const p = prog.zones[a].rect;
      const q = prog.zones[b].rect;
      const w = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
      const h = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
      if (w > 0 && h > 0 && w * h > 0.5 * Math.min(area(p), area(q)))
        ctx.add('E2', 'L', `Die Zonen „${prog.zones[a].function}“ und „${prog.zones[b].function}“ überlappen stark.`, [], { x: Math.max(p.x0, q.x0) + w / 2, y: Math.max(p.y0, q.y0) + h / 2 });
    }
}

/** E3 (L): things that belong together stand apart. */
export function checkTogether(ctx: RoomCtx): void {
  const chairs = ctx.items.filter((i) => i.role === 'seat' && i.shape === 'chair');
  if (chairs.length && !ctx.items.some((i) => i.role === 'table' || i.category === 'desk' || isKitchenModule(i)))
    ctx.add('E3', 'L', 'Es stehen Stühle im Raum, aber kein Tisch dazu.', chairs, chairs[0]);
  const shelves = ctx.placed.filter((i) => i.floor && i.shape === 'shelf');
  const groups = new Map<string, typeof shelves>();
  for (const s of shelves) groups.set(`${s.catalogId}|${s.zone}`, [...(groups.get(`${s.catalogId}|${s.zone}`) ?? []), s]);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const wallOf = (s: (typeof g)[number]) => {
      const back: Vec2 = { x: s.x - s.front.x * s.depth / 2, y: s.y - s.front.y * s.depth / 2 };
      return ctx.an.walls.reduce((best, w) => {
        const d = Math.abs((back.x - w.a.x) * w.inward.x + (back.y - w.a.y) * w.inward.y);
        return d < best.d ? { d, id: w.id } : best;
      }, { d: Infinity, id: '' }).id;
    };
    if (new Set(g.map(wallOf)).size > 1) ctx.add('E3', 'L', `${ctx.label(g[0])} steht ${g.length}× an verschiedenen Wänden, zusammen wirkt es ruhiger.`, g, g[0]);
  }
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** E4 (L): a colour outside the palette; neutrals (white, grey, black) always fit. */
export function checkPalette(ctx: RoomCtx): void {
  const pal = ctx.palette.map(rgb).filter((c): c is [number, number, number] => !!c);
  if (!pal.length || !ctx.program) return;
  for (const p of ctx.program.items) {
    const c = p.color ? rgb(p.color) : null;
    const it = ctx.byId(p.id);
    if (!c || !it) continue;
    const max = Math.max(...c);
    const min = Math.min(...c);
    if (max - min < 28) continue;
    if (!pal.some((q) => Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < 90)) ctx.add('E4', 'L', `${ctx.label(it)} hat die Farbe ${p.color}, die nicht zur Farbwelt der Wohnung passt.`, [it], it);
  }
}

/** E5 (L): the eye-catcher is hidden from the main door. */
export function checkFocus(ctx: RoomCtx): void {
  const door = ctx.doors.find((d) => d.label === ctx.an.mainDoor);
  if (!door) return;
  const pick = ctx.type === 'bedroom' || ctx.type === 'kids' ? ctx.placed.find((i) => i.shape === 'bed') : ctx.type === 'living' ? ctx.placed.find((i) => i.role === 'sofa') : ctx.type === 'dining' ? ctx.placed.find((i) => i.role === 'table') : ctx.type === 'office' ? ctx.placed.find((i) => i.category === 'desk') : undefined;
  if (!pick) return;
  for (const o of ctx.items) {
    if (o === pick || !o.floor || o.height < 1.2 || o.role === 'seat' || dist(o, pick) < 0.01) continue;
    if (polyDist(o.poly, pick.poly) < 0.05) continue;
    if (segmentHitsConvex(door.entry, pick, o.poly)) {
      ctx.add('E5', 'L', `Von der Tür ${door.label} sieht man zuerst ${ctx.label(o)}, ${ctx.label(pick)} bleibt verdeckt.`, [o, pick], o);
      return;
    }
  }
}
