import { isOutdoorRoom, roomWindows } from './daylight';
import type { DerivedPlan } from './derived';
import type { Furniture, Project, Room } from './schema';
import { boundsOf, pointInPolygon, type Vec2 } from './vec';

/**
 * Rough light estimate in lux per room (#360)
 * -------------------------------------------
 * Illuminance on a horizontal plane from placed lamps and, optionally, daylight. An ESTIMATE for the
 * buying decision ("is one ceiling lamp enough?"), not a lighting design:
 * - Direct light of every lamp by the inverse-square law, E = I·cosθ / d². Pendant and table lamps
 *   shine downwards (I = Φ/π · cosθ), floor lamps and smart lights in all directions (I = Φ/4π).
 * - Reflected light from walls and ceiling: a flat share of the room's total lumen per m² floor.
 * - A lamp lights only the room it stands in (walls stop the light, as in the 3D view #130);
 *   furniture does not shade.
 * - Daylight by the daylight-factor method (DF ≈ glass·T·ε·M / (surface·(1−ρ²))) under an overcast
 *   sky, falling off with the distance to the nearest window. No sun, no shading by buildings or trees.
 * Lumen values of lamps without a stated value are TYPICAL values of the lamp type (assumptions).
 */

/** Typical luminous flux (lm) per lamp shape when the lamp has no stated value: a 40 W / 60 W-equivalent bulb. */
export const DEFAULT_LUMEN: Record<string, number> = { 'table-lamp': 450, 'floor-lamp': 800, pendant: 800 };
export const FALLBACK_LUMEN = 600;
/** A placed smart light (project.lights) counts with this many lumen per brightness unit (1.0 = a 60 W-equivalent bulb). */
export const LUMEN_PER_LIGHT_UNIT = 800;
/** Reflected light: share of the room's total lumen that arrives per m² of floor (utilisation × maintenance, rough). */
export const INDIRECT_SHARE = 0.3;
/** Utilisation factor of the lumen method for the recommendation (lumen = lux · m² / factor). */
export const LUMEN_METHOD_FACTOR = 0.45;
/** Illuminance outdoors under an overcast sky at midday (lx). */
export const OVERCAST_LUX = 10000;
/** Daylight-factor constants: glass transmittance, sky view through the window, maintenance, mean surface reflectance. */
const DF_T = 0.7;
const DF_EPS = 0.5;
const DF_M = 0.9;
const DF_RHO = 0.5;
const CEILING_HEIGHT_FALLBACK = 2.5;
const PLANE_GENERAL = 0.8;
const CELL = 0.25;

export type LuxMode = 'evening' | 'day';
export const MODE_LABEL: Record<LuxMode, string> = { evening: 'Abend (nur Lampen)', day: 'Tag, bedeckt (Tageslicht + Lampen)' };

/** Colour steps of the layer (lx, lower limit). */
export const LUX_STEPS: { min: number; color: string; label: string }[] = [
  { min: 0, color: '#1e3a8a', label: 'unter 50 lx' },
  { min: 50, color: '#2563eb', label: '50–100 lx' },
  { min: 100, color: '#06b6d4', label: '100–200 lx' },
  { min: 200, color: '#84cc16', label: '200–500 lx' },
  { min: 500, color: '#facc15', label: 'ab 500 lx' },
];
export const stepOf = (lux: number): number => {
  let k = 0;
  LUX_STEPS.forEach((s, i) => lux >= s.min && (k = i));
  return k;
};

/** Guide values for general room lighting (lx), by room name. Typical planning values, rough orientation. */
const ROOM_TARGETS: { re: RegExp; lux: number; label: string }[] = [
  { re: /(bad|wc|toilette|dusche)/i, lux: 200, label: 'Bad' },
  { re: /(küche|kueche|kochen)/i, lux: 300, label: 'Küche' },
  { re: /(arbeit|büro|buero|homeoffice)/i, lux: 300, label: 'Arbeitszimmer' },
  { re: /(flur|diele|gang|eingang)/i, lux: 100, label: 'Flur' },
  { re: /(schlaf)/i, lux: 100, label: 'Schlafzimmer' },
  { re: /(wohn|ess)/i, lux: 150, label: 'Wohnen' },
];
export const roomTarget = (name: string): { lux: number; label: string } => ROOM_TARGETS.find((t) => t.re.test(name)) ?? { lux: 100, label: 'Raum' };

/** Guide values (lx) for tasks at a work surface. */
export const TASK_TARGET = { desk: 500, kitchen: 500, reading: 500 } as const;
/** Below this share of the guide value a surface counts as too dark; between it and the guide value as tight. */
export const DARK_SHARE = 0.5;

export interface LampSource {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Height of the light source above the floor, m. */
  z: number;
  lumen: number;
  /** True if the lumen value is the typical value of the lamp type, not entered by the user. */
  assumed: boolean;
  downward: boolean;
}

const shapeOf = (f: Furniture): string => (f.model.type === 'procedural' ? f.model.shape : '');

export function lampSources(project: Project): LampSource[] {
  const out: LampSource[] = [];
  for (const f of project.furniture) {
    if (f.category !== 'lighting') continue;
    const shape = shapeOf(f);
    const stated = f.lumen !== undefined;
    out.push({
      id: f.id,
      name: f.name,
      x: f.x,
      y: f.y,
      z: f.elevation + f.height * 0.85,
      lumen: (stated ? f.lumen! : DEFAULT_LUMEN[shape] ?? FALLBACK_LUMEN) * f.quantity,
      assumed: !stated,
      downward: shape === 'pendant' || shape === 'table-lamp',
    });
  }
  for (const l of project.lights) {
    if (!l.on) continue;
    out.push({ id: l.id, name: l.name || 'Leuchte', x: l.x, y: l.y, z: l.elevation, lumen: l.intensity * LUMEN_PER_LIGHT_UNIT, assumed: true, downward: false });
  }
  return out;
}

interface RoomCtx {
  room: Room;
  poly: Vec2[];
  area: number;
  lamps: LampSource[];
  windows: { pos: Vec2; area: number }[];
  /** Mean daylight illuminance at the work plane (lx), 0 without windows. */
  dayMean: number;
  /** Normalisation of the window-distance weight so its mean over the room is 1. */
  dayNorm: number;
  indirect: number;
  totalLumen: number;
}

const dayWeight = (ctx: RoomCtx, p: Vec2): number => {
  if (!ctx.windows.length) return 0;
  const d = Math.min(...ctx.windows.map((w) => Math.hypot(p.x - w.pos.x, p.y - w.pos.y)));
  return Math.exp(-d / 2) / ctx.dayNorm;
};

function luxAt(ctx: RoomCtx, p: Vec2, z: number, mode: LuxMode): number {
  let e = ctx.indirect;
  for (const l of ctx.lamps) {
    const h = Math.max(l.z - z, 0.1);
    const r2 = (p.x - l.x) ** 2 + (p.y - l.y) ** 2;
    const d2 = r2 + h * h;
    const cos = h / Math.sqrt(d2);
    e += l.downward ? (l.lumen / Math.PI) * (cos * cos) / d2 : (l.lumen / (4 * Math.PI)) * cos / d2;
  }
  if (mode === 'day') e += ctx.dayMean * dayWeight(ctx, p);
  return e;
}

export interface LuxGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** Row-major illuminance (lx); NaN outside every room. */
  lux: Float32Array;
  room: string[];
}

export interface RoomLux {
  roomId: string;
  name: string;
  /** Typical value: median of the room's cells (lx). */
  lux: number;
  /** Guide value for general lighting (lx). */
  target: number;
  targetLabel: string;
  lampCount: number;
  /** Installed lumen of the room's lamps. */
  lumen: number;
  /** Lumen the lumen method asks for to reach the guide value without daylight. */
  neededLumen: number;
  /** True when any lamp in the room has no stated lumen value. */
  assumed: boolean;
}

export type SurfaceKind = 'desk' | 'kitchen' | 'reading';
export type SurfaceStatus = 'ok' | 'tight' | 'dark';
export interface WorkSurface {
  id: string;
  kind: SurfaceKind;
  roomId: string;
  label: string;
  at: Vec2;
  lux: number;
  target: number;
  status: SurfaceStatus;
}

export interface LuxResult {
  grid: LuxGrid | null;
  rooms: RoomLux[];
  surfaces: WorkSurface[];
}

const statusOf = (lux: number, target: number): SurfaceStatus => (lux >= target ? 'ok' : lux >= target * DARK_SHARE ? 'tight' : 'dark');

function contexts(project: Project, plan: DerivedPlan, mode: LuxMode): RoomCtx[] {
  const lamps = lampSources(project);
  const out: RoomCtx[] = [];
  for (const room of project.rooms) {
    if (isOutdoorRoom(room)) continue;
    const geo = plan.rooms.get(room.id);
    if (!geo) continue;
    const poly = geo.interior;
    const mine = lamps.filter((l) => pointInPolygon({ x: l.x, y: l.y }, poly));
    const windows = roomWindows(plan, room);
    const totalLumen = mine.reduce((t, l) => t + l.lumen, 0);
    const glass = windows.reduce((t, w) => t + w.area, 0);
    const surfaces = 2 * geo.area + geo.perimeter * CEILING_HEIGHT_FALLBACK;
    const df = surfaces > 0 ? (glass * DF_T * DF_EPS * DF_M) / (surfaces * (1 - DF_RHO * DF_RHO)) : 0;
    const ctx: RoomCtx = { room, poly, area: geo.area, lamps: mine, windows, dayMean: df * OVERCAST_LUX, dayNorm: 1, indirect: geo.area > 0 ? (INDIRECT_SHARE * totalLumen) / geo.area : 0, totalLumen };
    if (mode === 'day' && windows.length) {
      // weights are normalised on the room's own cells, so the room mean equals the daylight-factor result
      const b = boundsOf(poly);
      let sum = 0;
      let n = 0;
      if (b) {
        for (let y = b.minY + CELL / 2; y < b.maxY; y += CELL)
          for (let x = b.minX + CELL / 2; x < b.maxX; x += CELL)
            if (pointInPolygon({ x, y }, poly)) {
              sum += Math.exp(-Math.min(...windows.map((w) => Math.hypot(x - w.pos.x, y - w.pos.y))) / 2);
              n++;
            }
      }
      ctx.dayNorm = n > 0 && sum > 0 ? sum / n : 1;
    }
    out.push(ctx);
  }
  return out;
}

const KITCHEN_WORKTOP = new Set(['base', 'sink', 'cooktop', 'countertop']);

export function computeLux(project: Project, plan: DerivedPlan, mode: LuxMode): LuxResult {
  const ctxs = contexts(project, plan, mode);
  const b = boundsOf(ctxs.flatMap((c) => c.poly));
  if (!b) return { grid: null, rooms: [], surfaces: [] };
  const cols = Math.ceil((b.maxX - b.minX) / CELL);
  const rows = Math.ceil((b.maxY - b.minY) / CELL);
  const lux = new Float32Array(cols * rows).fill(NaN);
  const roomOf: string[] = new Array(cols * rows).fill('');
  const perRoom = new Map<string, number[]>();
  for (const c of ctxs) {
    const vals: number[] = [];
    perRoom.set(c.room.id, vals);
    const rb = boundsOf(c.poly)!;
    const i0 = Math.max(0, Math.floor((rb.minX - b.minX) / CELL));
    const i1 = Math.min(cols - 1, Math.ceil((rb.maxX - b.minX) / CELL));
    const j0 = Math.max(0, Math.floor((rb.minY - b.minY) / CELL));
    const j1 = Math.min(rows - 1, Math.ceil((rb.maxY - b.minY) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const p = { x: b.minX + (i + 0.5) * CELL, y: b.minY + (j + 0.5) * CELL };
        if (!pointInPolygon(p, c.poly)) continue;
        const v = luxAt(c, p, PLANE_GENERAL, mode);
        lux[j * cols + i] = v;
        roomOf[j * cols + i] = c.room.id;
        vals.push(v);
      }
  }

  const rooms: RoomLux[] = [];
  for (const c of ctxs) {
    const v = (perRoom.get(c.room.id) ?? []).sort((x, y) => x - y);
    if (!v.length) continue;
    const t = roomTarget(c.room.name);
    rooms.push({
      roomId: c.room.id,
      name: c.room.name,
      lux: v[Math.floor(v.length / 2)],
      target: t.lux,
      targetLabel: t.label,
      lampCount: c.lamps.length,
      lumen: c.totalLumen,
      neededLumen: (t.lux * c.area) / LUMEN_METHOD_FACTOR,
      assumed: c.lamps.some((l) => l.assumed),
    });
  }

  const surfaces: WorkSurface[] = [];
  for (const c of ctxs) {
    let kitchenWorst: WorkSurface | null = null;
    for (const f of project.furniture) {
      const at = { x: f.x, y: f.y };
      if (!pointInPolygon(at, c.poly)) continue;
      if (f.category === 'desk') {
        const e = luxAt(c, at, f.elevation + f.height, mode);
        surfaces.push({ id: f.id, kind: 'desk', roomId: c.room.id, label: f.name, at, lux: e, target: TASK_TARGET.desk, status: statusOf(e, TASK_TARGET.desk) });
      } else if (f.kitchen && KITCHEN_WORKTOP.has(f.kitchen.type)) {
        const e = luxAt(c, at, f.elevation + f.height, mode);
        if (!kitchenWorst || e < kitchenWorst.lux) kitchenWorst = { id: f.id, kind: 'kitchen', roomId: c.room.id, label: 'Küchen-Arbeitsfläche', at, lux: e, target: TASK_TARGET.kitchen, status: statusOf(e, TASK_TARGET.kitchen) };
      } else if (f.category === 'sofa' && /(sessel|lese)/i.test(f.name)) {
        const e = luxAt(c, at, 1, mode);
        surfaces.push({ id: f.id, kind: 'reading', roomId: c.room.id, label: f.name, at, lux: e, target: TASK_TARGET.reading, status: statusOf(e, TASK_TARGET.reading) });
      }
    }
    if (kitchenWorst) surfaces.push(kitchenWorst);
  }
  return { grid: { cell: CELL, minX: b.minX, minY: b.minY, cols, rows, lux, room: roomOf }, rooms, surfaces };
}

export const SURFACE_STATUS_LABEL: Record<SurfaceStatus, string> = { ok: 'Richtwert erreicht', tight: 'knapp', dark: 'zu dunkel' };
export const SURFACE_KIND_LABEL: Record<SurfaceKind, string> = { desk: 'Arbeitsfläche', kitchen: 'Arbeitsfläche', reading: 'Leseplatz' };

/** Short advice for a room: is the installed lumen enough, and what to add. Null when nothing needs saying. */
export function roomAdvice(r: RoomLux): string | null {
  const have = Math.round(r.lumen);
  const need = Math.round(r.neededLumen / 50) * 50;
  if (r.lampCount === 0) return `Keine Lampe im Raum. Für ca. ${r.target} lx braucht der Raum rund ${need} lm Lampenlicht, z. B. ${Math.max(1, Math.ceil(need / 800))} Lampe(n) mit je 800 lm.`;
  if (r.lumen >= r.neededLumen) return null;
  const missing = Math.round((r.neededLumen - r.lumen) / 50) * 50;
  return `Installiert ${have} lm, für ca. ${r.target} lx sind rund ${need} lm nötig: noch etwa ${missing} lm ergänzen (z. B. Steh- oder Deckenlampe).`;
}

export function surfaceAdvice(s: WorkSurface): string | null {
  if (s.status === 'ok') return null;
  if (s.kind === 'desk') return 'Eine Schreibtischlampe direkt über der Fläche (ab ca. 500 lm) bringt hier am meisten.';
  if (s.kind === 'kitchen') return 'Unterbauleuchten oder eine Lampe über der Arbeitsfläche ergänzen.';
  return 'Eine Leselampe neben dem Sessel ergänzen.';
}
