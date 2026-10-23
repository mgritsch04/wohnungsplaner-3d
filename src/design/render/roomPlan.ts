/**
 * The furnished room from above as an image for Claude's critique (#442, stage 5 of
 * docs/EINRICHTUNG_NEU.md): walls with their labels (W1 …, T1 …, F1 …) as in the room sketch,
 * the 50 cm grid with room coordinates in cm, the zones of the programme, every piece with its
 * id and front, the ways between the doors as they run in the furnished room (free, too narrow,
 * blocked) and the findings of the walk-through where they are. Pure text out (SVG), so it
 * renders in the browser, in Node and in tests; `raster.ts` turns it into a PNG.
 */
import type { CatalogItem } from '../../catalog/types';
import { add, cross, dist, dot, pointInPolygon, scale, sub, type Vec2 } from '../../model/vec';
import { checkWalkways, type WalkCheck } from '../analysis';
import { toRItem, type RItem } from '../review/items';
import type { Layout, PlacedItem, RoomAnalysis, RoomProgram, RoomReview, Severity, WallInfo, WallOpening } from '../types';
import { LabelLayer, boxAround, type Box } from './labels';
import { pieceSvg } from './symbols';
import { el, points, ringPath, textWidth } from './svg';

export interface RoomPlanInput {
  analysis: RoomAnalysis;
  layout?: Layout;
  /** Pieces that were in the room before the proposal (fitted bath, existing kitchen). */
  existing?: PlacedItem[];
  /** For the zones and the item ids Claude knows. */
  program?: RoomProgram;
  review?: RoomReview;
  /** Names of the other rooms by id, for the door labels. */
  roomNames?: Record<string, string>;
  /** Products of the user, besides the generic catalogue. */
  catalog?: CatalogItem[];
}

export interface RoomPlanOptions {
  /** Longer side of the room in px (default 900, about what Claude looks at in detail). */
  size?: number;
  /** Labels of the pieces: their programme id (default with a programme) or their name. */
  labels?: 'id' | 'name';
  /** Legend below the plan (default true). */
  legend?: boolean;
}

export interface RoomPlan {
  svg: string;
  width: number;
  height: number;
  /** The ways between the doors, measured again in the furnished room, as drawn. */
  ways: WalkCheck[];
}

const FONT = 'Helvetica, Arial, sans-serif';
const FLOOR = '#fbf8f3';
const WALL = '#474747';
const INK = '#111827';
const GREY = '#6b7280';
const TEAL = '#0f766e';
export const SEVERITY_COLOR: Record<Severity, string> = { S: '#d93025', M: '#e8710a', L: '#b98900' };
const SEVERITY_WORD: Record<Severity, string> = { S: 'schwer', M: 'mittel', L: 'leicht' };
const ZONE_COLORS = ['#2563eb', '#16a34a', '#c2410c', '#9333ea', '#0e7490', '#be185d', '#4d7c0f'];
const WAY = { ok: '#16a34a', narrow: '#d97706', blocked: '#dc2626' };

const KITCHEN_WORD: Record<string, string> = { sink: 'Spüle', cooktop: 'Herd', oven: 'Backofen', fridge: 'Kühlschrank', dishwasher: 'Spülmaschine', tall: 'Hochschrank', base: 'Unterschrank', wall: 'Oberschrank', hood: 'Dunstabzug' };

const de = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',');
const cm = (m: number) => Math.round(m * 100);

/** Text next to an opening, as the room sketch names it. */
function openingText(a: RoomAnalysis, o: WallOpening, names: Record<string, string>): string {
  if (o.kind === 'window') return (o.sill ?? 1) < 0.05 ? `${o.id} Fenstertür` : o.id;
  if (o.toRoomId) return `${o.id} ${names[o.toRoomId] ?? 'Nachbarraum'}`;
  return a.entrance && o.id === a.mainDoor ? `${o.id} Wohnungstür` : `${o.id} ins Freie`;
}

/** Outer edge of the walls: each face moved out by its wall's thickness, joined at the corners. */
function outerRing(walls: WallInfo[]): Vec2[] {
  const th = (w: WallInfo) => Math.max(0.05, w.thickness);
  const out: Vec2[] = [];
  walls.forEach((w, i) => {
    const prev = walls[(i - 1 + walls.length) % walls.length];
    const p = sub(prev.a, scale(prev.inward, th(prev)));
    const q = sub(w.a, scale(w.inward, th(w)));
    const den = cross(prev.dir, w.dir);
    if (Math.abs(den) > 1e-6) {
      const t = cross(sub(q, p), w.dir) / den;
      const x = add(p, scale(prev.dir, t));
      // a very sharp corner would make a long spike: cut it off
      if (dist(x, w.a) <= 4 * Math.max(th(prev), th(w))) {
        out.push(x);
        return;
      }
    }
    out.push(sub(prev.b, scale(prev.inward, th(prev))), q);
  });
  return out;
}

export function roomPlanSvg(input: RoomPlanInput, options: RoomPlanOptions = {}): RoomPlan {
  const a = input.analysis;
  const names = input.roomNames ?? {};
  const extra = input.catalog ?? [];
  const placed = (input.layout?.items ?? []).map((i) => toRItem(i, false, extra));
  const existing = (input.existing ?? []).map((i) => toRItem(i, true, extra));
  const items = [...existing, ...placed];
  const ways = checkWalkways(
    a,
    items.filter((i) => i.obstacle).map((i) => i.poly),
  );
  const byLabel = options.labels ?? (input.program ? 'id' : 'name');
  const uid = `r${a.roomId.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;

  // scale and frame: the room in the middle, the labels of the walls and the coordinates around it
  const s = Math.min(220, Math.max(50, (options.size ?? 900) / Math.max(a.size.x, a.size.y, 0.5)));
  const thick = Math.max(0.05, ...a.walls.map((w) => w.thickness)) * s;
  const ROW = 15;
  const openingLabels = a.walls.flatMap((w) => w.openings.map((o) => ({ w, o, text: openingText(a, o, names) })));
  const sideLabel = Math.max(24, ...openingLabels.filter((l) => Math.abs(l.w.inward.x) > 0.5).map((l) => textWidth(l.text, 11, true)));
  const ringX = Math.ceil(thick + 10 + sideLabel);
  const ringTop = Math.ceil(thick + 10 + 2 * ROW + 18);
  const ringBottom = Math.ceil(thick + 10 + 2 * ROW);
  const TICKS = 30;
  const titleH = 52;
  const planW = a.size.x * s;
  const planH = a.size.y * s;
  const width = Math.max(560, Math.ceil(TICKS + 2 * ringX + planW));
  const legend = options.legend === false ? null : legendSvg(width - 32, uid);
  const legendH = legend ? legend.height + 16 : 0;
  const height = Math.ceil(titleH + ringTop + planH + ringBottom + legendH);
  const ox = TICKS + ringX + (width - TICKS - 2 * ringX - planW) / 2;
  const oy = titleH + ringTop;
  const P = (p: Vec2) => ({ x: ox + (p.x - a.origin.x) * s, y: oy + (p.y - a.origin.y) * s });
  const labels = new LabelLayer({ x0: 2, y0: titleH, x1: width - 2, y1: height - legendH });
  const text = (x: number, y: number, t: string, size: number, extraAttrs: Record<string, string | number | undefined> = {}) =>
    el('text', { x, y: y + size * 0.35, 'font-size': size, 'text-anchor': 'middle', fill: INK, stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round', ...extraAttrs }, escText(t));

  const out: string[] = [];
  const defs = [
    el('clipPath', { id: `${uid}-clip` }, el('polygon', { points: points(a.polygon.map(P)) })),
    el('pattern', { id: `${uid}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#6b7280', 'stroke-width': 1.2 })),
    el('pattern', { id: `${uid}-free`, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#dc2626', 'stroke-width': 1.5, 'stroke-opacity': 0.5 })),
  ];
  out.push(el('rect', { width, height, fill: '#ffffff' }));

  // floor, 50 cm grid (darker each metre) and the room coordinates in cm
  out.push(el('polygon', { points: points(a.polygon.map(P)), fill: FLOOR }));
  const grid: string[] = [];
  for (let k = 1; k * 0.5 < a.size.x - 1e-6; k++) {
    const x = ox + k * 0.5 * s;
    grid.push(el('line', { x1: x, y1: oy, x2: x, y2: oy + planH, stroke: k % 2 ? '#efebe4' : '#e1d9cc', 'stroke-width': 1 }));
  }
  for (let k = 1; k * 0.5 < a.size.y - 1e-6; k++) {
    const y = oy + k * 0.5 * s;
    grid.push(el('line', { x1: ox, y1: y, x2: ox + planW, y2: y, stroke: k % 2 ? '#efebe4' : '#e1d9cc', 'stroke-width': 1 }));
  }
  out.push(el('g', { 'clip-path': `url(#${uid}-clip)` }, grid));
  const ticks: string[] = [];
  const tickY = oy - ringTop + 9;
  for (let c = 0; c <= cm(a.size.x) + 1; c += 100) ticks.push(el('text', { x: ox + (c / 100) * s, y: tickY + 3.5, 'font-size': 10, 'text-anchor': 'middle', fill: GREY }, String(c)));
  for (let c = 0; c <= cm(a.size.y) + 1; c += 100) ticks.push(el('text', { x: TICKS - 4, y: oy + (c / 100) * s + 3.5, 'font-size': 10, 'text-anchor': 'end', fill: GREY }, String(c)));
  ticks.push(el('text', { x: TICKS - 4, y: tickY + 3.5, 'font-size': 10, 'text-anchor': 'end', fill: GREY }, 'cm'));
  out.push(el('g', { 'data-layer': 'coordinates' }, ticks));

  // areas the user marked, then the zones of the programme
  const zoneLabels: { text: string; color: string; box: Box; data: string }[] = [];
  for (const z of a.userZones) {
    const pts = z.points.map(P);
    out.push(el('polygon', { points: points(pts), fill: z.keepFree ? `url(#${uid}-free)` : '#7c3aed', 'fill-opacity': z.keepFree ? 1 : 0.06, stroke: z.keepFree ? '#dc2626' : '#7c3aed', 'stroke-width': 1.2, 'stroke-dasharray': '3 3', 'data-userzone': z.id }));
    zoneLabels.push({ text: z.keepFree ? `${z.id} frei lassen` : `${z.id} ${z.purpose}`, color: z.keepFree ? '#b91c1c' : '#6d28d9', box: bbox(pts), data: z.id });
  }
  (input.program?.zones ?? []).forEach((z, k) => {
    const color = ZONE_COLORS[k % ZONE_COLORS.length];
    const p0 = P({ x: Math.min(z.rect.x0, z.rect.x1), y: Math.min(z.rect.y0, z.rect.y1) });
    const p1 = P({ x: Math.max(z.rect.x0, z.rect.x1), y: Math.max(z.rect.y0, z.rect.y1) });
    out.push(el('rect', { x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y, fill: color, 'fill-opacity': 0.07, stroke: color, 'stroke-opacity': 0.8, 'stroke-width': 1.3, 'stroke-dasharray': '7 4', 'data-zone': z.id }));
    zoneLabels.push({ text: z.id, color, box: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }, data: z.id });
  });

  // door leaves swinging into the room
  for (const w of a.walls)
    for (const o of w.openings) {
      if (!o.swing || o.swing.length < 3) continue;
      const hinge = o.swing[0];
      const leaf = o.swing.slice(1).reduce((best, p) => (dot(sub(p, hinge), w.inward) > dot(sub(best, hinge), w.inward) ? p : best));
      out.push(
        el('g', { 'data-swing': o.id }, [
          el('polygon', { points: points(o.swing.map(P)), fill: '#fdf3d8', 'fill-opacity': 0.8, stroke: '#a8a29e', 'stroke-width': 0.8, 'stroke-dasharray': '3 2' }),
          el('line', { x1: P(hinge).x, y1: P(hinge).y, x2: P(leaf).x, y2: P(leaf).y, stroke: '#57534e', 'stroke-width': 1.6 }),
        ]),
      );
    }

  // rugs, the ways that still fit, then the pieces from the floor up
  const order = (i: RItem) => (i.role === 'rug' || (i.category === 'textile' && i.role !== 'curtain') ? 0 : i.floor ? 1 + i.height / 10 : 2 + i.elevation);
  const sorted = [...items].sort((x, y) => order(x) - order(y));
  const rugs = sorted.filter((i) => order(i) === 0);
  for (const i of rugs) out.push(pieceSvg(i, P(i), s, `${uid}-hatch`));
  // the ways that still fit as one tinted area (the group's opacity keeps overlaps from adding up), cut at the walls
  const open = ways.filter((w) => w.fits > 0 && w.path.length >= 2);
  const kind = (w: WalkCheck) => (w.fits >= w.width - 1e-6 ? 'ok' : 'narrow');
  for (const k of ['ok', 'narrow'] as const) {
    const list = open.filter((w) => kind(w) === k);
    if (!list.length) continue;
    const band = (w: WalkCheck) => el('polyline', { points: points(w.path.map(P)), fill: 'none', stroke: WAY[k], 'stroke-width': w.fits * s, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    out.push(el('g', { 'clip-path': `url(#${uid}-clip)`, opacity: k === 'ok' ? 0.14 : 0.26 }, list.map(band)));
  }
  for (const w of open)
    out.push(el('polyline', { points: points(w.path.map(P)), fill: 'none', stroke: WAY[kind(w)], 'stroke-opacity': 0.75, 'stroke-width': 1.2, 'stroke-dasharray': '6 5', 'data-way': kind(w), 'data-from': w.from, 'data-to': w.to }));
  for (const i of sorted) if (order(i) > 0) out.push(pieceSvg(i, P(i), s, `${uid}-hatch`));

  // walls with the openings cut in
  out.push(el('path', { d: ringPath([outerRing(a.walls).map(P), a.polygon.map(P)]), fill: WALL, 'fill-rule': 'evenodd', 'data-layer': 'walls' }));
  for (const w of a.walls)
    for (const o of w.openings) {
      const t = Math.max(0.05, w.thickness);
      const q = [add(w.a, scale(w.dir, o.t0)), add(w.a, scale(w.dir, o.t1))];
      const quad = [add(q[0], scale(w.inward, 0.01)), add(q[1], scale(w.inward, 0.01)), sub(q[1], scale(w.inward, t + 0.01)), sub(q[0], scale(w.inward, t + 0.01))].map(P);
      if (o.kind === 'window') {
        const m0 = P(sub(q[0], scale(w.inward, t / 2)));
        const m1 = P(sub(q[1], scale(w.inward, t / 2)));
        out.push(
          el('g', { 'data-opening': o.id }, [
            el('polygon', { points: points(quad), fill: '#dbeafe', stroke: '#3b78b8', 'stroke-width': 0.8 }),
            el('line', { x1: m0.x, y1: m0.y, x2: m1.x, y2: m1.y, stroke: '#3b78b8', 'stroke-width': 1.2, 'stroke-dasharray': (o.sill ?? 1) < 0.05 ? '4 2' : undefined }),
          ]),
        );
      } else out.push(el('polygon', { points: points(quad), fill: FLOOR, 'data-opening': o.id }));
    }

  // the main door: one comes in here
  const main = a.walls.flatMap((w) => w.openings.map((o) => ({ w, o }))).find((x) => x.o.id === a.mainDoor);
  if (main) {
    const mid = add(main.w.a, scale(main.w.dir, (main.o.t0 + main.o.t1) / 2));
    const p0 = P(add(mid, scale(main.w.inward, 0.06)));
    const p1 = P(add(mid, scale(main.w.inward, 0.55)));
    const dir = { x: (p1.x - p0.x) / Math.hypot(p1.x - p0.x, p1.y - p0.y), y: (p1.y - p0.y) / Math.hypot(p1.x - p0.x, p1.y - p0.y) };
    const head = [p1, { x: p1.x - dir.x * 9 - dir.y * 5, y: p1.y - dir.y * 9 + dir.x * 5 }, { x: p1.x - dir.x * 9 + dir.y * 5, y: p1.y - dir.y * 9 - dir.x * 5 }];
    out.push(el('g', { 'data-main-door': main.o.id }, [el('line', { x1: p0.x, y1: p0.y, x2: p1.x - dir.x * 6, y2: p1.y - dir.y * 6, stroke: TEAL, 'stroke-width': 2.5 }), el('polygon', { points: points(head), fill: TEAL })]));
  }

  // ways that no longer fit: their line in the empty room, on top of what blocks them
  for (const w of ways) {
    if (w.fits > 0) continue;
    const empty = a.walkways.find((x) => x.from === w.from && x.to === w.to);
    if (!empty || empty.path.length < 2) continue;
    out.push(el('polyline', { points: points(empty.path.map(P)), fill: 'none', stroke: WAY.blocked, 'stroke-width': 2.2, 'stroke-dasharray': '7 5', 'data-way': 'blocked', 'data-from': w.from, 'data-to': w.to }));
  }

  // findings where they are (labels keep away from them)
  const marks: string[] = [];
  const stack = new Map<string, number>();
  for (const f of input.review?.findings ?? []) {
    if (!f.where) continue;
    const p = P(f.where);
    const key = `${Math.round(p.x / 12)},${Math.round(p.y / 12)}`;
    const n = stack.get(key) ?? 0;
    stack.set(key, n + 1);
    const w = textWidth(f.rule, 10, true) + 8;
    const y = p.y + n * 15;
    labels.block(boxAround(p.x, y, w, 14));
    marks.push(
      el('g', { 'data-finding': f.rule, 'data-severity': f.severity }, [
        el('rect', { x: p.x - w / 2, y: y - 7, width: w, height: 14, rx: 7, fill: SEVERITY_COLOR[f.severity], stroke: '#ffffff', 'stroke-width': 1.5 }),
        el('text', { x: p.x, y: y + 3.5, 'font-size': 10, 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#ffffff' }, f.rule),
      ]),
    );
  }

  // labels: openings and walls outside, zones in their corner, pieces on or next to themselves
  const lab: string[] = [];
  const outside = (w: WallInfo, t: number, txt: string, size: number, bold: boolean) => {
    const { w: bw, h: bh } = LabelLayer.size(txt, size, bold);
    const o = scale(w.inward, -1);
    const reach = Math.abs(o.x) * (bw / 2) + Math.abs(o.y) * (bh / 2);
    const step = Math.abs(o.x) * bw + Math.abs(o.y) * bh + 2;
    const face = P(add(w.a, scale(w.dir, t)));
    const d0 = Math.max(0.05, w.thickness) * s + 4 + reach;
    const along = { x: w.dir.x, y: w.dir.y };
    return [0, 1].flatMap((row) => [0, -0.6, 0.6].map((k) => ({ x: face.x + o.x * (d0 + row * step) + along.x * k * bw, y: face.y + o.y * (d0 + row * step) + along.y * k * bh * 1.2 })));
  };
  for (const { w, o, text: t } of openingLabels) {
    const isMain = o.id === a.mainDoor;
    const at = labels.place(t, 11, true, outside(w, (o.t0 + o.t1) / 2, t, 11, true));
    lab.push(text(at.x, at.y, t, 11, { 'font-weight': 'bold', fill: o.kind === 'window' ? '#1d4f91' : isMain ? TEAL : '#7c2d12', 'data-label': o.id }));
  }
  for (const w of a.walls) {
    const spots = [...w.free].sort((x, y) => y.t1 - y.t0 - (x.t1 - x.t0)).map((f) => (f.t0 + f.t1) / 2);
    const ts = [...spots, w.length / 2, w.length * 0.2, w.length * 0.8];
    // outside the wall first; where the door labels crowd it, just inside
    const { w: bw, h: bh } = LabelLayer.size(w.id, 12, true);
    const reach = Math.abs(w.inward.x) * (bw / 2) + Math.abs(w.inward.y) * (bh / 2) + 3;
    const inside = ts.map((t) => {
      const p = P(add(w.a, scale(w.dir, t)));
      return { x: p.x + w.inward.x * reach, y: p.y + w.inward.y * reach };
    });
    const at = labels.place(w.id, 12, true, [...ts.flatMap((t) => outside(w, t, w.id, 12, true)), ...inside]);
    lab.push(text(at.x, at.y, w.id, 12, { 'font-weight': 'bold', fill: '#374151', 'data-label': w.id }));
  }
  for (const z of zoneLabels) {
    const { w: bw, h: bh } = LabelLayer.size(z.text, 11, true);
    const inset = 4;
    const cands = [
      { x: z.box.x0 + inset + bw / 2, y: z.box.y0 + inset + bh / 2 },
      { x: z.box.x1 - inset - bw / 2, y: z.box.y0 + inset + bh / 2 },
      { x: z.box.x0 + inset + bw / 2, y: z.box.y1 - inset - bh / 2 },
      { x: z.box.x1 - inset - bw / 2, y: z.box.y1 - inset - bh / 2 },
    ];
    const at = labels.place(z.text, 11, true, cands);
    lab.push(text(at.x, at.y, z.text, 11, { 'font-weight': 'bold', fill: z.color, 'data-label': z.data }));
  }
  const cooktops = items.filter((i) => i.kitchen === 'cooktop' && !i.floor);
  const quiet = (i: RItem) => !!i.kitchen && !i.existing && (i.floor ? cooktops.some((c) => pointInPolygon(c, i.poly)) : i.kitchen !== 'cooktop');
  for (const i of sorted) {
    const t = quiet(i) ? '' : itemLabel(i, byLabel);
    if (!t) continue;
    const c = P(i);
    const b = bbox(i.poly.map(P));
    const { w: bw, h: bh } = LabelLayer.size(t, 11);
    const beside = [{ x: c.x, y: b.y0 - bh / 2 - 1 }, { x: c.x, y: b.y1 + bh / 2 + 1 }, { x: b.x0 - bw / 2 - 2, y: c.y }, { x: b.x1 + bw / 2 + 2, y: c.y }];
    const parent = i.parent ? items.find((x) => x.id === i.parent) : undefined;
    if (parent) {
      // a chair or lamp: beside it first on the side away from its table or sofa
      const away = sub(c, P(parent));
      beside.sort((p, q) => dot(sub(q, c), away) - dot(sub(p, c), away));
    }
    const at = labels.place(t, 11, false, [c, ...beside]);
    lab.push(text(at.x, at.y, t, 11, { fill: i.existing ? '#4b5563' : INK, 'font-style': i.existing ? 'italic' : undefined, 'data-label': i.id }));
  }

  // title, compass and legend
  const head: string[] = [];
  const title = `${a.name} · ${de(a.area)} m² · ${cm(a.size.x)} × ${cm(a.size.y)} cm`;
  head.push(el('text', { x: 16, y: 24, 'font-size': 17, 'font-weight': 'bold', fill: INK }, escText(title)));
  const r = input.review;
  if (r) {
    const count = (sev: Severity) => r.findings.filter((f) => f.severity === sev).length;
    const line = `Begehung: ${r.score} Punkte, ${r.passed ? 'bestanden' : 'nicht bestanden'} · ${(['S', 'M', 'L'] as const).map((sev) => `${count(sev)} ${SEVERITY_WORD[sev]}`).join(', ')}`;
    head.push(el('text', { x: 16, y: 43, 'font-size': 12, fill: r.passed ? '#15803d' : '#b91c1c' }, escText(line)));
  } else head.push(el('text', { x: 16, y: 43, 'font-size': 12, fill: GREY }, escText(`Raumhöhe ${cm(a.height)} cm · Koordinaten in cm ab der Nordwest-Ecke`)));
  head.push(el('g', { 'data-layer': 'north' }, [el('polygon', { points: `${width - 24},12 ${width - 29},26 ${width - 19},26`, fill: INK }), el('text', { x: width - 24, y: 40, 'font-size': 12, 'font-weight': 'bold', 'text-anchor': 'middle', fill: INK }, 'N')]));

  const svg = el(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': FONT, 'data-room': a.roomId },
    [el('defs', {}, defs), ...out, el('g', { 'data-layer': 'labels' }, lab), el('g', { 'data-layer': 'findings' }, marks), ...head, legend ? el('g', { transform: `translate(16 ${height - legendH + 12})` }, legend.svg) : ''],
  );
  return { svg, width, height, ways };
}

/** `el` escapes attributes, text content is escaped here. */
const escText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bbox(pts: readonly { x: number; y: number }[]): Box {
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}

function itemLabel(i: RItem, by: 'id' | 'name'): string {
  if (i.kitchen && !i.existing) return KITCHEN_WORD[i.kitchen] ?? '';
  if (i.existing || by === 'name') {
    const n = i.name.replace(/\s*\(.*\)$/, '');
    return n.length > 18 ? `${n.slice(0, 17)}…` : n;
  }
  return i.id;
}

/** Two lines (more when narrow): the ways and the main door, then the drawing conventions and the findings. */
function legendSvg(maxW: number, uid: string): { svg: string; height: number } {
  const parts: string[] = [];
  const x0 = 0;
  let x = x0;
  let y = 0;
  const item = (sym: (x: number, y: number) => string, label: string, symW = 22) => {
    const w = symW + 6 + textWidth(label, 11) + 14;
    if (x + w > x0 + maxW) {
      x = x0;
      y += 18;
    }
    parts.push(sym(x, y), el('text', { x: x + symW + 6, y: y + 4, 'font-size': 11, fill: '#374151' }, escText(label)));
    x += w;
  };
  const band = (color: string, op: number) => (bx: number, by: number) =>
    el('g', {}, [el('line', { x1: bx, y1: by, x2: bx + 22, y2: by, stroke: color, 'stroke-opacity': op, 'stroke-width': 9 }), el('line', { x1: bx, y1: by, x2: bx + 22, y2: by, stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': '6 5' })]);
  item(band(WAY.ok, 0.18), 'Weg frei');
  item(band(WAY.narrow, 0.3), 'Weg zu schmal');
  item((bx, by) => el('line', { x1: bx, y1: by, x2: bx + 22, y2: by, stroke: WAY.blocked, 'stroke-width': 2.2, 'stroke-dasharray': '7 5' }), 'Weg versperrt');
  item((bx, by) => el('g', {}, [el('line', { x1: bx, y1: by, x2: bx + 14, y2: by, stroke: TEAL, 'stroke-width': 2.5 }), el('polygon', { points: `${bx + 22},${by} ${bx + 13},${by - 5} ${bx + 13},${by + 5}`, fill: TEAL })]), 'Haupttür');
  x = x0;
  y += 18;
  item((bx, by) => el('g', {}, [el('rect', { x: bx + 4, y: by - 6, width: 14, height: 12, fill: '#cbc2b2', stroke: '#4b5563' }), el('polygon', { points: `${bx + 8},${by + 1} ${bx + 14},${by + 1} ${bx + 11},${by + 5}`, fill: '#374151' })]), 'Vorderseite');
  item((bx, by) => el('rect', { x: bx + 4, y: by - 6, width: 14, height: 12, fill: '#dba7a7', 'fill-opacity': 0.45, stroke: '#4b5563', 'stroke-dasharray': '4 3' }), 'hängt oder steht auf etwas');
  item((bx, by) => el('g', {}, [el('rect', { x: bx + 4, y: by - 6, width: 14, height: 12, fill: '#d4d4d4', stroke: '#4b5563' }), el('rect', { x: bx + 4, y: by - 6, width: 14, height: 12, fill: `url(#${uid}-hatch)` })]), 'Bestand');
  item(
    (bx, by) =>
      el(
        'g',
        {},
        (['S', 'M', 'L'] as const).map((sev, k) => el('rect', { x: bx + k * 9, y: by - 5, width: 8, height: 10, rx: 4, fill: SEVERITY_COLOR[sev] })),
      ),
    'Befund schwer, mittel, leicht',
    26,
  );
  return { svg: el('g', { 'data-layer': 'legend' }, parts), height: y + 12 };
}

