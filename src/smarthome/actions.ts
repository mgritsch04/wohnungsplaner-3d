import { derivePlan, type DerivedPlan } from '../model/derived';
import { newId } from '../model/ids';
import type { Automation, Project, SmartDevice, SmartDeviceKind } from '../model/schema';
import { dist, pointInPolygon, polygonCentroid, type Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { DEFAULT_ELEVATION, KIND_LABEL, productById } from './catalog';

/** Editing operations for smart-home devices and automations (#170); each is one undo step. */

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function roomAt(project: Project, derived: DerivedPlan, p: Vec2): string | null {
  for (const r of project.rooms) {
    const g = derived.rooms.get(r.id);
    if (g && pointInPolygon(p, g.interior)) return r.id;
  }
  return null;
}

/** Centre point of an opening on its wall centre line. */
export function openingPoint(project: Project, openingId: string): Vec2 | null {
  const o = project.openings.find((x) => x.id === openingId);
  const w = o && project.walls.find((x) => x.id === o.wallId);
  const a = w && project.nodes.find((n) => n.id === w.a);
  const b = w && project.nodes.find((n) => n.id === w.b);
  if (!o || !a || !b) return null;
  const len = dist(a, b) || 1;
  return { x: a.x + ((b.x - a.x) * o.offset) / len, y: a.y + ((b.y - a.y) * o.offset) / len };
}

/**
 * Where a new device goes in a room: sensors in the room corner looking at the centre
 * (typical mounting), lights at the centre, contacts on the room's first window/door.
 */
export function placementFor(project: Project, derived: DerivedPlan, kind: SmartDeviceKind, roomId: string | null): Pick<SmartDevice, 'x' | 'y' | 'rotation' | 'openingId'> {
  const g = roomId ? derived.rooms.get(roomId) : undefined;
  if (!g) return { x: 0, y: 0, rotation: 0 };
  const c = polygonCentroid(g.interior);
  if (kind === 'motion' || kind === 'presence') {
    const corner = g.interior.reduce((best, p) => (dist(p, c) > dist(best, c) ? p : best), g.interior[0]);
    const k = 0.08 / (dist(corner, c) || 1);
    return { x: r3(corner.x + (c.x - corner.x) * k), y: r3(corner.y + (c.y - corner.y) * k), rotation: Math.atan2(c.y - corner.y, c.x - corner.x) };
  }
  if (kind === 'contact') {
    const candidates = project.openings
      .filter((o) => o.kind !== 'passage')
      .map((o) => ({ o, p: openingPoint(project, o.id) }))
      .filter((x): x is { o: (typeof x)['o']; p: Vec2 } => !!x.p)
      .sort((a, b) => dist(a.p, c) - dist(b.p, c));
    const hit = candidates[0];
    if (hit) return { x: r3(hit.p.x), y: r3(hit.p.y), rotation: 0, openingId: hit.o.id };
  }
  return { x: r3(c.x), y: r3(c.y), rotation: 0 };
}

const nameFor = (project: Project, kind: SmartDeviceKind, roomName: string | undefined) => {
  const base = `${KIND_LABEL[kind]}${roomName ? ` ${roomName}` : ''}`;
  const n = project.devices.filter((d) => d.name === base || d.name.startsWith(`${base} `)).length;
  return n ? `${base} ${n + 1}` : base;
};

/** Add a device (optionally of a catalog product) to a room. A smart lamp also gets a placed light. */
export function addDevice(kind: SmartDeviceKind, productId: string | undefined, roomId: string | null): string {
  const id = newId('dev');
  const st = useProjectStore.getState();
  const derived = derivePlan(st.project);
  st.apply((d) => {
    const pos = placementFor(d, derived, kind, roomId);
    const room = d.rooms.find((r) => r.id === roomId);
    const product = productById(productId);
    const dev: SmartDevice = { id, name: nameFor(d, kind, room?.name), kind, productId: product?.id, ...pos, elevation: DEFAULT_ELEVATION[kind] };
    if (kind === 'light') {
      const lightId = newId('light');
      const k = product?.kelvin ? Math.min(Math.max(2700, product.kelvin[0]), product.kelvin[1]) : 2700;
      d.lights.push({ id: lightId, name: dev.name, x: dev.x, y: dev.y, elevation: Math.max(1, d.settings.defaultWallHeight - 0.15), temperature: k, intensity: 1.2, on: false });
      dev.lightId = lightId;
      dev.elevation = Math.max(1, d.settings.defaultWallHeight - 0.15);
    }
    d.devices.push(dev);
  });
  return id;
}

export function updateDevice(id: string, patch: Partial<Omit<SmartDevice, 'id' | 'kind'>>) {
  useProjectStore.getState().apply((d) => {
    const dev = d.devices.find((x) => x.id === id);
    if (!dev) return;
    Object.assign(dev, patch);
    syncLight(d, dev);
  });
}

/** A smart lamp's placed light follows the device position. */
export function syncLight(d: Project, dev: SmartDevice) {
  if (dev.kind !== 'light') return;
  const l = d.lights.find((x) => x.id === dev.lightId);
  if (l) {
    l.x = dev.x;
    l.y = dev.y;
  }
}

export function deleteDevice(id: string) {
  useProjectStore.getState().apply((d) => {
    d.devices = d.devices.filter((x) => x.id !== id);
    d.automations = d.automations.filter((a) => !('deviceId' in a.trigger) || a.trigger.deviceId !== id);
    for (const a of d.automations) a.action.deviceIds = a.action.deviceIds.filter((x) => x !== id);
  });
}

/** Default automation for a sensor: lights of the same room on when dark, off 2 min after the last motion. */
export function addAutomationFor(sensorId: string): string | null {
  const st = useProjectStore.getState();
  const p = st.project;
  const sensor = p.devices.find((x) => x.id === sensorId);
  if (!sensor) return null;
  const derived = derivePlan(p);
  const room = roomAt(p, derived, sensor);
  const lights = p.devices.filter((x) => (x.kind === 'light' || x.kind === 'plug') && roomAt(p, derived, x) === room).map((x) => x.id);
  const id = newId('auto');
  const roomName = p.rooms.find((r) => r.id === room)?.name;
  const a: Automation =
    sensor.kind === 'contact'
      ? { id, name: `${roomName ?? sensor.name}: Licht beim Öffnen`, enabled: true, trigger: { type: 'contact', deviceId: sensorId, to: 'open' }, onlyWhenDark: true, action: { deviceIds: lights, on: true } }
      : {
          id,
          name: `${roomName ?? sensor.name}: Licht bei Bewegung`,
          enabled: true,
          trigger: { type: 'motion', deviceId: sensorId },
          onlyWhenDark: true,
          action: { deviceIds: lights, on: true, brightness: 80 },
          offAfterS: 120,
        };
  st.apply((d) => void d.automations.push(a));
  return id;
}

export function updateAutomation(id: string, fn: (a: Automation) => void) {
  useProjectStore.getState().apply((d) => {
    const a = d.automations.find((x) => x.id === id);
    if (a) fn(a);
  });
}

export function deleteAutomation(id: string) {
  useProjectStore.getState().apply((d) => void (d.automations = d.automations.filter((x) => x.id !== id)));
}
