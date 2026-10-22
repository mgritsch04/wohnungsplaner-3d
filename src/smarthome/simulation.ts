import type { DerivedPlan } from '../model/derived';
import type { Automation, Project, SmartDevice } from '../model/schema';
import { sightOccluders, type Segment } from '../model/visibility';
import { LEAF_OPEN_ANGLE, leafPolygon } from '../model/geometry/leaves';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { boundsOf, pointInPolygon, type Vec2 } from '../model/vec';
import { sunElevationDeg } from '../view3d/lighting';
import { ASSUMED, productById } from './catalog';

/**
 * Smart-home simulation (#170)
 * ----------------------------
 * Pure step function that behaves like Home Assistant with real sensors: a person moves
 * through the plan, sensors detect them inside their range and opening angle with line of
 * sight (walls and closed doors block, see sightOccluders; open door leaves and tall furniture
 * too, #236), report "no motion" only after
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

/**
 * Edge that blocks the line of sight (#236). Without z0/z1 it blocks at any height (wall
 * faces, closed doors); with them only where the sight line passes between z0 and z1 metres
 * above the floor (an open door leaf, a wardrobe; a low sofa lies below the line).
 */
export interface Occluder extends Segment {
  z0?: number;
  z1?: number;
}

/** Height the sensor aims at: the middle of the body of a standing or walking person (m). */
export const PERSON_Z = 1.0;

/**
 * Part of the sight line sensor (height zs) → person (PERSON_Z) inside the vertical band
 * z0..z1, as fractions [fa, fb] of the line (0 = sensor, 1 = person); null if it misses it.
 */
function blockedFractions(zs: number, o: Occluder): [number, number] | null {
  if (o.z0 === undefined || o.z1 === undefined) return [0, 1];
  const dz = PERSON_Z - zs;
  if (Math.abs(dz) < 1e-9) return zs >= o.z0 && zs <= o.z1 ? [0, 1] : null;
  const f0 = (o.z0 - zs) / dz, f1 = (o.z1 - zs) / dz;
  const fa = Math.max(0, Math.min(f0, f1)), fb = Math.min(1, Math.max(f0, f1));
  return fa <= fb ? [fa, fb] : null;
}

/** Parameter t (0..1) where segment a→b crosses s, or null. */
function crossing(a: Vec2, b: Vec2, s: Segment): number | null {
  const d1x = b.x - a.x, d1y = b.y - a.y;
  const d2x = s.b.x - s.a.x, d2y = s.b.y - s.a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const ax = s.a.x - a.x, ay = s.a.y - a.y;
  const t = (ax * d2y - ay * d2x) / den;
  const u = (ax * d1y - ay * d1x) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1 ? t : null;
}

/** Inside range and opening angle, with a free line of sight. */
export function inDetectionArea(d: SmartDevice, params: SensorParams, p: Vec2, occluders: Occluder[]): boolean {
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
  return !occluders.some((s) => {
    const t = crossing(start, p, s);
    if (t === null) return false;
    const band = blockedFractions(d.elevation, s);
    const f = k + (1 - k) * t; // fraction of the whole line sensor → person
    return !!band && f >= band[0] && f <= band[1];
  });
}

export const isDark = (hour: number) => sunElevationDeg(hour) < 0;

/** Clock set by hand: the simulation continues from `hour`; pending time triggers are not replayed. */
export function withHour(state: SimState, hour: number, text = `Uhrzeit von Hand auf ${fmtHour(hour)} gestellt`): SimState {
  const h = ((hour % 24) + 24) % 24;
  return { ...state, hour: h, events: [...state.events, { t: state.t, hour: h, text }].slice(-MAX_EVENTS) };
}

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
export function step(project: Project, occluders: Occluder[], prev: SimState, dt: number, input: SimInput): SimState {
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

/**
 * Everything that blocks a sensor's view: wall faces and closed doors/windows (full height),
 * opened door leaves and window sashes within their height, and solid furniture within
 * its height (#236). Rugs, lamps and other non-solid items do not block.
 */
export function occludersOf(project: Project, derived: DerivedPlan): Occluder[] {
  const out: Occluder[] = sightOccluders(project, derived);
  const outline = (poly: Vec2[], z0: number, z1: number) => {
    for (let i = 0; i < poly.length; i++) out.push({ a: poly[i], b: poly[(i + 1) % poly.length], z0, z1 });
  };
  for (const leaves of derived.leaves.values()) for (const l of leaves) if (l.open) outline(leafPolygon(l, LEAF_OPEN_ANGLE), l.z0, l.z1);
  for (const f of project.furniture) if (f.solid) outline(furnitureCorners(f), f.elevation, f.elevation + f.height);
  return out;
}

/**
 * Share (0..1) of each room's floor that at least one motion/presence sensor covers
 * (grid sampling, line of sight respected). Rooms without a sensor get 0.
 */
export function roomCoverage(project: Project, derived: DerivedPlan, occluders: Occluder[], cell = 0.2): Map<string, number> {
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

/**
 * Distance from `o` along unit direction `d` to the first point a person can no longer be
 * seen (or `max`). A full-height occluder hides everything behind its crossing at tc; a
 * height-limited one (furniture, door leaf) hides a person at distance r when the crossing
 * lies in its blocked band, i.e. from r = tc / fb on. `back` is the distance from the device
 * to `o` (the line of sight starts at the device). Conservative: a person far behind a
 * medium-high item may be visible again, which the 2D outline does not show.
 */
function castRay(o: Vec2, d: Vec2, occluders: Occluder[], max: number, zs: number, back: number): number {
  let best = max;
  for (const s of occluders) {
    const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = s.a.x - o.x, ay = s.a.y - o.y;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * d.y - ay * d.x) / den;
    if (!(t > 1e-9 && t < best && u >= 0 && u <= 1)) continue;
    const band = blockedFractions(zs, s);
    if (!band || band[1] <= 0) continue;
    // a person at device distance r is hidden when (t + back) / r lies in the band
    const r = (t + back) / band[1];
    best = Math.min(best, Math.max(t, r - back));
  }
  return best;
}

/**
 * Outline of the area a sensor actually covers: its wedge, cut off where walls, closed
 * doors, open door leaves or tall furniture block the line of sight (rays every ~2°). Used for the 2D display.
 */
export function detectionPolygon(d: SmartDevice, params: SensorParams, occluders: Occluder[]): Vec2[] {
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
    const r = castRay(o, dir, occluders, params.rangeM - 0.05, d.elevation, 0.05) + 0.05;
    pts.push({ x: d.x + dir.x * r, y: d.y + dir.y * r });
  }
  return pts;
}
