/**
 * Smart-home suggestion per room (#225): room type → basic equipment from the device
 * catalogue (docs/smart-home/CONCEPT.md §4). Motion/presence sensors are placed where the
 * simulation profile (range, angle, line of sight, `inDetectionArea`) covers most of the
 * floor; contacts sit on windows and outer doors, smart bulbs take over the room's existing
 * lights, a plug goes to the TV. Only catalogue products with a datasheet are used.
 *
 * Pure function on a project; nothing changes until the caller applies the suggestion.
 */
import { derivePlan, type DerivedPlan } from '../model/derived';
import type { Project, SmartDevice, SmartDeviceKind } from '../model/schema';
import { add, boundsOf, dist, normalize, perp, pointInPolygon, polygonCentroid, scale, sub, type Vec2 } from '../model/vec';
import { guessRoomType, type RoomType } from '../suggest/furnishing';
import { openingPoint } from './actions';
import { DEFAULT_ELEVATION, KIND_LABEL, productById } from './catalog';
import { inDetectionArea, occludersOf, sensorParams } from './simulation';

export interface DeviceProposal {
  /** stable within one suggestion */
  key: string;
  roomId: string;
  kind: SmartDeviceKind;
  /** absent for loudspeakers (#138): generic type only, no product */
  productId?: string;
  speakerType?: SmartDevice['speakerType'];
  name: string;
  x: number;
  y: number;
  rotation: number;
  elevation: number;
  openingId?: string;
  /** existing light (project.lights) this bulb takes over */
  lightId?: string;
  /** one short sentence: why here */
  reason: string;
}

export interface RoomCoverageChange {
  roomId: string;
  before: number;
  after: number;
}

export interface SmartHomeSuggestion {
  items: DeviceProposal[];
  /** coverage of the rooms that got a sensor */
  coverage: RoomCoverageChange[];
  /** cost range in € of the items with a known price, and how many items have none */
  cost: { min: number; max: number; unknown: number };
  /** wishes the planner cannot place yet (no device type for them) */
  later: { roomId: string; text: string }[];
  /** Part of a whole-apartment concept (#375): shown in its own card, not in the room suggestion's list. */
  concept?: true;
}

const COVER_GOAL = 0.9;
const CELL = 0.25;
const SENSOR_PRODUCT: Record<'motion' | 'presence', string> = { motion: 'ikea-vallhorn', presence: 'sonoff-snzb-06p' };
const CONTACT_PRODUCT = 'sonoff-snzb-04p';
const LIGHT_PRODUCT = 'ikea-kajplats-1055';
const PLUG_PRODUCT = 'ikea-inspelning';
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Hall, kitchen, bath: PIR sensor for light; living areas: mmWave presence sensor (CONCEPT §4). */
function sensorKindFor(type: RoomType): 'motion' | 'presence' {
  return type === 'living' || type === 'bedroom' || type === 'kids' || type === 'office' || type === 'dining' ? 'presence' : 'motion';
}

const LATER: Partial<Record<RoomType, string>> = {
  bath: 'Feuchtesensor und Wasserleckmelder (noch kein Gerätetyp im Planer)',
  kitchen: 'Wasserleckmelder unter der Spüle (noch kein Gerätetyp im Planer)',
  bedroom: 'CO₂- und Temperatursensor (noch kein Gerätetyp im Planer)',
  living: 'CO₂- und Temperatursensor sowie Funktaster (noch kein Gerätetyp im Planer)',
};

/** Room an outer opening belongs to: the room on one of its two sides; null if both or none (inner door, free-standing). */
function roomOfOpening(project: Project, derived: DerivedPlan, openingId: string, roomIds: Set<string>): string | null {
  const o = project.openings.find((x) => x.id === openingId);
  const w = o && project.walls.find((x) => x.id === o.wallId);
  const a = w && project.nodes.find((n) => n.id === w.a);
  const b = w && project.nodes.find((n) => n.id === w.b);
  const c = openingPoint(project, openingId);
  if (!o || !w || !a || !b || !c) return null;
  const n = perp(normalize(sub(b, a)));
  const d = w.thickness / 2 + 0.25;
  const sides = [add(c, scale(n, d)), add(c, scale(n, -d))].map((p) => project.rooms.find((r) => {
    const g = derived.rooms.get(r.id);
    return g && pointInPolygon(p, g.interior);
  })?.id ?? null);
  const inside = sides.filter((s): s is string => !!s);
  // windows: any side; doors: only if the other side is outside (entrance, balcony)
  if (o.kind === 'window') return inside[0] && roomIds.has(inside[0]) ? inside[0] : null;
  return inside.length === 1 && roomIds.has(inside[0]) ? inside[0] : null;
}

/** Candidate wall spots of a room: corners and points along the walls, set 8 cm into the room, looking at its centre. */
function sensorSpots(interior: Vec2[]): { x: number; y: number; rotation: number }[] {
  const c = polygonCentroid(interior);
  const out: { x: number; y: number; rotation: number }[] = [];
  const put = (p: Vec2, towards: Vec2) => {
    const k = 0.08 / (dist(p, towards) || 1);
    const q = { x: p.x + (towards.x - p.x) * k, y: p.y + (towards.y - p.y) * k };
    if (!pointInPolygon(q, interior)) return;
    out.push({ x: r3(q.x), y: r3(q.y), rotation: Math.atan2(c.y - q.y, c.x - q.x) });
  };
  interior.forEach((p, i) => {
    put(p, c);
    const q = interior[(i + 1) % interior.length];
    for (const t of [0.25, 0.5, 0.75]) put({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, c);
  });
  return out;
}

function roomCells(interior: Vec2[]): Vec2[] {
  const b = boundsOf(interior);
  const cells: Vec2[] = [];
  if (!b) return cells;
  for (let y = b.minY + CELL / 2; y < b.maxY; y += CELL) for (let x = b.minX + CELL / 2; x < b.maxX; x += CELL) if (pointInPolygon({ x, y }, interior)) cells.push({ x, y });
  return cells;
}

const proposalDevice = (kind: SmartDeviceKind, productId: string, s: { x: number; y: number; rotation: number }): SmartDevice => ({
  id: 'proposal',
  name: '',
  kind,
  productId,
  x: s.x,
  y: s.y,
  rotation: s.rotation,
  elevation: DEFAULT_ELEVATION[kind],
});

/** The device as the proposal would become it (for drawing the detection area of a preview). */
export const deviceOfProposal = (p: DeviceProposal): SmartDevice => ({ id: p.key, name: p.name, kind: p.kind, productId: p.productId, speakerType: p.speakerType, x: p.x, y: p.y, rotation: p.rotation, elevation: p.elevation, openingId: p.openingId, lightId: p.lightId });

/**
 * Suggest equipment for the given rooms (default: all). `types` overrides the room type
 * guessed from the name. Rooms that are covered well enough already get nothing more.
 */
export function suggestSmartHome(project: Project, roomIds?: string[], types: Record<string, RoomType> = {}): SmartHomeSuggestion {
  const derived = derivePlan(project);
  const rooms = project.rooms.filter((r) => !roomIds || roomIds.includes(r.id));
  const roomSet = new Set(rooms.map((r) => r.id));
  const occluders = occludersOf(project, derived);
  const items: DeviceProposal[] = [];
  const coverage: RoomCoverageChange[] = [];
  const later: SmartHomeSuggestion['later'] = [];
  const nameCount = new Map<string, number>();
  const nameOf = (kind: SmartDeviceKind, roomName: string, suffix = '') => {
    const base = `${KIND_LABEL[kind]}${suffix} ${roomName}`;
    const n = (nameCount.get(base) ?? 0) + 1;
    nameCount.set(base, n);
    const existing = project.devices.filter((d) => d.name === base || d.name.startsWith(`${base} `)).length;
    return n + existing > 1 ? `${base} ${n + existing}` : base;
  };

  for (const room of rooms) {
    const g = derived.rooms.get(room.id);
    if (!g) continue;
    const type = types[room.id] ?? guessRoomType(room.name);

    // 1. sensor: greedy choice of wall spots until the goal share of the floor is seen
    const kind = sensorKindFor(type);
    const productId = SENSOR_PRODUCT[kind];
    const cells = roomCells(g.interior);
    if (cells.length) {
      const seen = cells.map(() => false);
      for (const d of project.devices) {
        if (d.kind !== 'motion' && d.kind !== 'presence') continue;
        const par = sensorParams(d);
        cells.forEach((p, i) => {
          if (!seen[i] && inDetectionArea(d, par, p, occluders)) seen[i] = true;
        });
      }
      const share = () => seen.filter(Boolean).length / cells.length;
      const before = share();
      const spots = sensorSpots(g.interior).map((s) => {
        const dev = proposalDevice(kind, productId, s);
        const par = sensorParams(dev);
        return { s, hit: cells.map((p) => inDetectionArea(dev, par, p, occluders)) };
      });
      const maxSensors = g.area > 30 ? 3 : 2;
      const existing = project.devices.filter((d) => (d.kind === 'motion' || d.kind === 'presence') && pointInPolygon(d, g.interior)).length;
      let added = 0;
      while (share() < COVER_GOAL && existing + added < maxSensors) {
        let best: (typeof spots)[number] | null = null;
        let bestGain = 0;
        for (const c of spots) {
          const gain = c.hit.reduce((n, h, i) => n + (h && !seen[i] ? 1 : 0), 0);
          if (gain > bestGain) {
            bestGain = gain;
            best = c;
          }
        }
        // a further sensor must be worth it: at least 5 % of the floor
        if (!best || bestGain / cells.length < 0.05) break;
        best.hit.forEach((h, i) => h && (seen[i] = true));
        added++;
        items.push({
          key: `${room.id}:sensor:${added}`,
          roomId: room.id,
          kind,
          productId,
          name: nameOf(kind, room.name),
          ...best.s,
          elevation: DEFAULT_ELEVATION[kind],
          reason: kind === 'motion' ? 'Bewegungsmelder an der Wand, deckt den Raum für Licht ab' : 'Präsenzsensor an der Wand, erkennt auch ruhende Personen',
        });
      }
      if (added) coverage.push({ roomId: room.id, before, after: share() });
    }

    // 2. smart bulbs for the room's existing lights
    for (const l of project.lights) {
      if (project.devices.some((d) => d.lightId === l.id) || !pointInPolygon(l, g.interior)) continue;
      items.push({
        key: `${room.id}:light:${l.id}`,
        roomId: room.id,
        kind: 'light',
        productId: LIGHT_PRODUCT,
        name: nameOf('light', room.name),
        x: l.x,
        y: l.y,
        rotation: 0,
        elevation: l.elevation,
        lightId: l.id,
        reason: `vorhandenes Licht „${l.name}“ smart machen`,
      });
    }

    // 3. plug for the TV in the living room
    if (type === 'living' && !project.devices.some((d) => d.kind === 'plug' && pointInPolygon(d, g.interior))) {
      const tv = project.furniture.find((f) => /\btv\b|fernseh/i.test(`${f.catalogId ?? ''} ${f.name}`) && pointInPolygon(f, g.interior));
      if (tv) {
        items.push({
          key: `${room.id}:plug:${tv.id}`,
          roomId: room.id,
          kind: 'plug',
          productId: PLUG_PRODUCT,
          name: nameOf('plug', room.name, ' Medien'),
          x: r3(tv.x),
          y: r3(tv.y),
          rotation: 0,
          elevation: DEFAULT_ELEVATION.plug,
          reason: `schaltet und misst „${tv.name}“`,
        });
      }
    }

    if (LATER[type]) later.push({ roomId: room.id, text: LATER[type]! });
  }

  // 4. contacts on windows and outer doors
  for (const o of project.openings) {
    if (o.kind === 'passage' || project.devices.some((d) => d.openingId === o.id)) continue;
    const roomId = roomOfOpening(project, derived, o.id, roomSet);
    const p = roomId && openingPoint(project, o.id);
    const room = roomId && rooms.find((r) => r.id === roomId);
    if (!p || !room) continue;
    items.push({
      key: `${roomId}:contact:${o.id}`,
      roomId: room.id,
      kind: 'contact',
      productId: CONTACT_PRODUCT,
      name: nameOf('contact', room.name),
      x: r3(p.x),
      y: r3(p.y),
      rotation: 0,
      elevation: DEFAULT_ELEVATION.contact,
      openingId: o.id,
      reason: o.kind === 'window' ? 'meldet geöffnetes Fenster (Lüften, Abwesenheit)' : 'meldet die Außentür',
    });
  }

  const cost = { min: 0, max: 0, unknown: 0 };
  for (const it of items) {
    const price = productById(it.productId)?.priceEur;
    if (price) {
      cost.min += price[0];
      cost.max += price[1];
    } else cost.unknown++;
  }
  cost.min = Math.round(cost.min * 100) / 100;
  cost.max = Math.round(cost.max * 100) / 100;
  return { items, coverage, cost, later };
}
