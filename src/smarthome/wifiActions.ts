import { newId } from '../model/ids';
import type { WifiClient, WifiClientType, WifiNeighbor } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { placeDevice, roomAt } from './actions';
import { derivePlan } from '../model/derived';
import { CLIENT_TYPES, type NodeSuggestion } from './wifiPlan';

/** Project changes of the WLAN planning (#492): neighbour networks, own devices, taking a suggestion. */

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const st = () => useProjectStore.getState();

export function addNeighbor(n: Omit<WifiNeighbor, 'id'>): string {
  const id = newId('wn');
  st().apply((d) => void d.wifiNeighbors.push({ ...n, id, x: r3(n.x), y: r3(n.y) }));
  return id;
}

export function updateNeighbor(id: string, patch: Partial<Omit<WifiNeighbor, 'id'>>) {
  st().apply((d) => {
    const n = d.wifiNeighbors.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (n as Record<string, unknown>)[k];
  });
}

export const removeNeighbor = (id: string) => st().apply((d) => void (d.wifiNeighbors = d.wifiNeighbors.filter((x) => x.id !== id)));

export function addClient(type: WifiClientType, at: Vec2): string {
  const id = newId('wc');
  const p = st().project;
  const room = p.rooms.find((r) => r.id === roomAt(p, derivePlan(p), at));
  const base = `${CLIENT_TYPES[type].label}${room ? ` ${room.name}` : ''}`;
  const n = p.wifiClients.filter((c) => c.name === base || c.name.startsWith(`${base} `)).length;
  st().apply((d) => void d.wifiClients.push({ id, name: n ? `${base} ${n + 1}` : base, type, x: r3(at.x), y: r3(at.y) }));
  useUiStore.getState().toast(`${CLIENT_TYPES[type].label} ${room ? `in „${room.name}“ ` : ''}gesetzt – Strg+Z macht es rückgängig.`, 'success');
  return id;
}

export function updateClient(id: string, patch: Partial<Omit<WifiClient, 'id'>>) {
  st().apply((d) => {
    const c = d.wifiClients.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (c as Record<string, unknown>)[k];
  });
}

export const removeClient = (id: string) => st().apply((d) => void (d.wifiClients = d.wifiClients.filter((x) => x.id !== id)));

/** Put a suggested repeater / mesh node / access point into the plan as a real device. */
export function applySuggestion(s: NodeSuggestion): string {
  const p = st().project;
  const standard = p.devices.find((d) => d.kind === 'router' && (d.wifi?.role ?? 'router') === 'router')?.wifi?.standard;
  const backhaul = s.role === 'ap' ? 'wired' : s.role === 'mesh' && (standard === 'wifi6e' || standard === 'wifi7') ? 'wireless-dedicated' : 'wireless-shared';
  return placeDevice('router', undefined, s.roomId || roomAt(p, derivePlan(p), s), { x: r3(s.x), y: r3(s.y) }, { role: s.role, standard, backhaul, uplinkId: s.uplinkId || undefined });
}
