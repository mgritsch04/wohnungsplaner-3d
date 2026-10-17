import type { DerivedPlan } from '../model/derived';
import type { Automation, Project, SmartDevice } from '../model/schema';
import { sightOccluders, type Segment } from '../model/visibility';
import { boundsOf, pointInPolygon, type Vec2 } from '../model/vec';
import { sunElevationDeg } from '../view3d/lighting';
import { ASSUMED, productById } from './catalog';

/**
 * Smart-home simulation (#170)
 * ----------------------------
 * Pure step function that behaves like Home Assistant with real sensors: a person moves
 * through the plan, sensors detect them inside their range and opening angle with line of
 * sight (walls and closed doors block, see sightOccluders), report "no motion" only after
 * their hold time, and automations switch lights. A PIR motion sensor only sees a MOVING
 * person, a mmWave presence sensor also a still one. No real devices are involved.
 */

export interface EntityState {
  on: boolean;
  /** lights: 1..100 % */
  brightness?: number;
  /** sensors: simulated second of the last detection */
  lastSeen?: number;
}

export interface SimEvent {
  t: number;
  hour: number;
  text: string;
}

export interface SimState {
  /** simulated seconds since start */
  t: number;
  /** simulated time of day (0..24) */
  hour: number;
  entities: Record<string, EntityState>;
  /** motion automations with an off-delay: 'armed' while motion lasts, else the due second */
  pendingOff: Record<string, 'armed' | number>;
  events: SimEvent[];
}

export interface SimInput {
  /** position of the simulated person (null = nobody in the flat) */
  person: Vec2 | null;
  /** did the person move in the last moment? (PIR sensors need movement) */
  moving: boolean;
  /** sensors triggered by hand ("Auslösen" in the device info) */
  triggered?: ReadonlySet<string>;
}

export interface SensorParams {
  rangeM: number;
  angleDeg: number;
  holdS: number;
  /** which values are assumptions, not from a datasheet */
  assumed: { range: boolean; angle: boolean; hold: boolean };
}

const MAX_EVENTS = 50;
const isSensor = (d: SmartDevice) => d.kind === 'motion' || d.kind === 'presence';

export function sensorParams(d: SmartDevice): SensorParams {
  const p = productById(d.productId);
  const range = d.rangeM ?? p?.rangeM;
  const angle = d.angleDeg ?? p?.angleDeg;
  return {
    rangeM: range ?? ASSUMED.rangeM,
    angleDeg: angle ?? ASSUMED.angleDeg,
    holdS: d.holdS ?? ASSUMED.holdS,
    assumed: { range: range === undefined, angle: angle === undefined, hold: d.holdS === undefined },
  };
}

function segmentsCross(a: Vec2, b: Vec2, s: Segment): boolean {
  const d1x = b.x - a.x, d1y = b.y - a.y;
  const d2x = s.b.x - s.a.x, d2y = s.b.y - s.a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const ax = s.a.x - a.x, ay = s.a.y - a.y;
  const t = (ax * d2y - ay * d2x) / den;
  const u = (ax * d1y - ay * d1x) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1;
}

/** Inside range and opening angle, with a free line of sight. */
export function inDetectionArea(d: SmartDevice, params: SensorParams, p: Vec2, occluders: Segment[]): boolean {
  const dx = p.x - d.x, dy = p.y - d.y;
  const r = Math.hypot(dx, dy);
  if (r > params.rangeM) return false;
  if (r < 1e-6) return true;
  if (params.angleDeg < 360) {
    let diff = Math.atan2(dy, dx) - d.rotation;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > (params.angleDeg * Math.PI) / 360) return false;
  }
  // start a few centimetres in front of the device: it sits on a wall face
  const k = Math.min(0.05, r / 2) / r;
  const start = { x: d.x + dx * k, y: d.y + dy * k };
  return !occluders.some((s) => segmentsCross(start, p, s));
}

export const isDark = (hour: number) => sunElevationDeg(hour) < 0;

export function initialState(project: Project, hour = project.settings.timeOfDay): SimState {
  const entities: Record<string, EntityState> = {};
  for (const d of project.devices) {
    if (d.kind === 'light') {
      const l = project.lights.find((x) => x.id === d.lightId);
      entities[d.id] = { on: l?.on ?? false, brightness: 100 };
    } else if (d.kind === 'contact') {
      entities[d.id] = { on: project.openings.find((o) => o.id === d.openingId)?.open ?? false };
    } else entities[d.id] = { on: false };
  }
  return { t: 0, hour, entities, pendingOff: {}, events: [] };
}

const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
export { fmtHour as formatSimHour };

/** Did the clock pass `h` between `from` (exclusive) and `to` (inclusive)? Handles midnight. */
function passed(from: number, to: number, h: number): boolean {
  return from <= to ? h > from && h <= to : h > from || h <= to;
}

/** Advance the simulation by `dt` simulated seconds. Returns a new state. */
export function step(project: Project, occluders: Segment[], prev: SimState, dt: number, input: SimInput): SimState {
  const t = prev.t + dt;
  const hour = (prev.hour + dt / 3600) % 24;
  const entities: Record<string, EntityState> = {};
  for (const [k, v] of Object.entries(prev.entities)) entities[k] = { ...v };
  const pendingOff = { ...prev.pendingOff };
  const events = [...prev.events];
  const devices = new Map(project.devices.map((d) => [d.id, d]));
  const log = (text: string) => events.push({ t, hour, text });
  const rising = new Set<string>();
  const falling = new Set<string>();

  for (const d of project.devices) {
    const e = (entities[d.id] ??= { on: false });
    const was = e.on;
    if (isSensor(d)) {
      const params = sensorParams(d);
      const sees = !!input.triggered?.has(d.id) || (!!input.person && (d.kind === 'presence' || input.moving) && inDetectionArea(d, params, input.person, occluders));
      if (sees) {
        e.lastSeen = t;
        e.on = true;
      } else if (e.on && t - (e.lastSeen ?? 0) >= params.holdS) e.on = false;
    } else if (d.kind === 'contact') {
      e.on = project.openings.find((o) => o.id === d.openingId)?.open ?? e.on;
    }
    if (e.on !== was) {
      (e.on ? rising : falling).add(d.id);
      if (d.kind !== 'light' && d.kind !== 'plug') log(`${d.name}: ${d.kind === 'contact' ? (e.on ? 'offen' : 'geschlossen') : e.on ? 'Bewegung erkannt' : 'keine Bewegung mehr'}`);
    }
  }

  const act = (a: Automation, on: boolean) => {
    for (const id of a.action.deviceIds) {
      const d = devices.get(id);
      if (!d || (d.kind !== 'light' && d.kind !== 'plug')) continue;
      const e = (entities[id] ??= { on: false });
      if (e.on === on && (!on || e.brightness === (a.action.brightness ?? 100))) continue;
      e.on = on;
      if (on) e.brightness = a.action.brightness ?? 100;
      log(`${a.name}: ${d.name} ${on ? 'an' : 'aus'}`);
    }
  };

  for (const a of project.automations) {
    if (!a.enabled) {
      delete pendingOff[a.id];
      continue;
    }
    const tr = a.trigger;
    const fires =
      (tr.type === 'motion' && rising.has(tr.deviceId)) ||
      (tr.type === 'contact' && (tr.to === 'open' ? rising : falling).has(tr.deviceId)) ||
      (tr.type === 'time' && passed(prev.hour, hour, tr.hour));
    if (fires && (!a.onlyWhenDark || isDark(hour))) {
      act(a, a.action.on);
      if (tr.type === 'motion' && a.action.on && a.offAfterS !== undefined) pendingOff[a.id] = 'armed';
    }
    const pend = pendingOff[a.id];
    if (pend === undefined || tr.type !== 'motion') continue;
    // mode: restart – new motion re-arms, "no motion" starts the off-delay
    if (rising.has(tr.deviceId)) pendingOff[a.id] = 'armed';
    else if (pend === 'armed' && falling.has(tr.deviceId)) pendingOff[a.id] = t + (a.offAfterS ?? 0);
    const due = pendingOff[a.id];
    if (typeof due === 'number' && t >= due) {
      act(a, false);
      delete pendingOff[a.id];
    }
  }

  return { t, hour, entities, pendingOff, events: events.slice(-MAX_EVENTS) };
}

/** Light switch states the simulation imposes on placed lights (project.lights ids). */
export function lightOverrides(project: Project, state: SimState): Map<string, { on: boolean; brightness: number }> {
  const out = new Map<string, { on: boolean; brightness: number }>();
  for (const d of project.devices) {
    if (d.kind !== 'light' || !d.lightId) continue;
    const e = state.entities[d.id];
    if (e) out.set(d.lightId, { on: e.on, brightness: e.brightness ?? 100 });
  }
  return out;
}

export const occludersOf = (project: Project, derived: DerivedPlan) => sightOccluders(project, derived);

/**
 * Share (0..1) of each room's floor that at least one motion/presence sensor covers
 * (grid sampling, line of sight respected). Rooms without a sensor get 0.
 */
export function roomCoverage(project: Project, derived: DerivedPlan, occluders: Segment[], cell = 0.2): Map<string, number> {
  const out = new Map<string, number>();
  const sensors = project.devices.filter(isSensor).map((d) => ({ d, p: sensorParams(d) }));
  for (const room of project.rooms) {
    const g = derived.rooms.get(room.id);
    const b = g && boundsOf(g.interior);
    if (!g || !b) continue;
    let total = 0;
    let hit = 0;
    for (let y = b.minY + cell / 2; y < b.maxY; y += cell) {
      for (let x = b.minX + cell / 2; x < b.maxX; x += cell) {
        const p = { x, y };
        if (!pointInPolygon(p, g.interior)) continue;
        total++;
        if (sensors.some((s) => inDetectionArea(s.d, s.p, p, occluders))) hit++;
      }
    }
    out.set(room.id, total ? hit / total : 0);
  }
  return out;
}

/** Distance from `o` along unit direction `d` to the nearest occluder (or `max`). */
function castRay(o: Vec2, d: Vec2, occluders: Segment[], max: number): number {
  let best = max;
  for (const s of occluders) {
    const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = s.a.x - o.x, ay = s.a.y - o.y;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * d.y - ay * d.x) / den;
    if (t > 1e-9 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}

/**
 * Outline of the area a sensor actually covers: its wedge, cut off where walls or closed
 * doors block the line of sight (rays every ~2°). Used for the 2D display.
 */
export function detectionPolygon(d: SmartDevice, params: SensorParams, occluders: Segment[]): Vec2[] {
  const full = params.angleDeg >= 360;
  const span = (Math.min(params.angleDeg, 360) * Math.PI) / 180;
  const n = Math.max(8, Math.ceil(Math.min(params.angleDeg, 360) / 2));
  const pts: Vec2[] = full ? [] : [{ x: d.x, y: d.y }];
  for (let i = 0; i <= n; i++) {
    if (full && i === n) break;
    const a = d.rotation - span / 2 + (span * i) / n;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    // start a few centimetres in front of the device (it sits on a wall face), like inDetectionArea
    const o = { x: d.x + dir.x * 0.05, y: d.y + dir.y * 0.05 };
    const r = castRay(o, dir, occluders, params.rangeM - 0.05) + 0.05;
    pts.push({ x: d.x + dir.x * r, y: d.y + dir.y * r });
  }
  return pts;
}
