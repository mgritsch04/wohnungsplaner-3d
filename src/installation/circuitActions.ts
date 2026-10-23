import { newId } from '../model/ids';
import type { Circuit, Load } from '../model/schema';
import { useProjectStore } from '../store/projectStore';

/** Editing operations of the power check (#135); each is one undo step. */

const store = () => useProjectStore.getState();

export function addCircuit(): string {
  const id = newId('circ');
  store().apply((d) => {
    d.circuits.push({ id, name: `Stromkreis ${d.circuits.length + 1}`, amps: 16 });
  });
  return id;
}

export function updateCircuit(id: string, fn: (c: Circuit) => void) {
  store().apply((d) => {
    const c = d.circuits.find((x) => x.id === id);
    if (c) fn(c);
  });
}

/** Removing a circuit unassigns its sockets and consumers; the consumers stay. */
export function deleteCircuit(id: string) {
  store().apply((d) => {
    d.circuits = d.circuits.filter((c) => c.id !== id);
    for (const f of d.fixtures) if (f.circuitId === id) f.circuitId = undefined;
    for (const l of d.loads) if (l.circuitId === id) l.circuitId = undefined;
  });
}

export function setSocketCircuit(fixtureId: string, circuitId: string | undefined) {
  store().apply((d) => {
    const f = d.fixtures.find((x) => x.id === fixtureId);
    if (f) f.circuitId = circuitId;
  });
}

export function addLoad(name: string, watts: number, target: { fixtureId?: string; circuitId?: string }): string {
  const id = newId('load');
  store().apply((d) => {
    d.loads.push({ id, name: name.trim().slice(0, 80) || 'Verbraucher', watts: Math.max(0, Math.min(30000, watts)), ...target });
  });
  return id;
}

export function updateLoad(id: string, fn: (l: Load) => void) {
  store().apply((d) => {
    const l = d.loads.find((x) => x.id === id);
    if (l) fn(l);
  });
}

export function deleteLoad(id: string) {
  store().apply((d) => {
    d.loads = d.loads.filter((l) => l.id !== id);
  });
}
