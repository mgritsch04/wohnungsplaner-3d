import type { Circuit, Load, Project } from './schema';

/**
 * Power check per circuit (#135): sums the consumers attached to a circuit (directly or via a
 * socket) and compares them with the fuse. A guide value only – no electrical planning.
 */

export const MAINS_VOLTAGE = 230;
export const FUSE_OPTIONS = [10, 13, 16, 20, 25, 32];

/** Typical power of common appliances (W) – rough guide values to start from, editable per consumer. */
export const LOAD_PRESETS: { name: string; watts: number }[] = [
  { name: 'Wasserkocher', watts: 2000 },
  { name: 'Toaster', watts: 900 },
  { name: 'Kaffeemaschine', watts: 1000 },
  { name: 'Mikrowelle', watts: 1200 },
  { name: 'Staubsauger', watts: 1400 },
  { name: 'Waschmaschine', watts: 2200 },
  { name: 'Geschirrspüler', watts: 1800 },
  { name: 'Wäschetrockner', watts: 2400 },
  { name: 'Haartrockner', watts: 1800 },
  { name: 'Bügeleisen', watts: 2000 },
  { name: 'Fernseher', watts: 100 },
  { name: 'Computer mit Monitor', watts: 300 },
  { name: 'Kühlschrank', watts: 150 },
  { name: 'Elektroheizlüfter', watts: 2000 },
];

export type CircuitStatus = 'ok' | 'warn' | 'over';

export interface CircuitLoadInfo {
  circuit: Circuit;
  loads: Load[];
  totalW: number;
  /** Nominal power of the fuse (V × A). */
  capacityW: number;
  /** Continuous-load limit (capacity × limit share). */
  limitW: number;
  /** Total as a share of the nominal power, percent. */
  percent: number;
  status: CircuitStatus;
}

export interface CircuitCheck {
  circuits: CircuitLoadInfo[];
  /** Consumers whose socket or circuit is missing / not assigned. */
  unassigned: Load[];
}

/** Circuit a consumer belongs to: via its socket first, then directly. */
export function circuitOfLoad(p: Pick<Project, 'fixtures' | 'circuits'>, load: Load): Circuit | null {
  if (load.fixtureId) {
    const f = p.fixtures.find((x) => x.id === load.fixtureId && x.kind === 'socket');
    return (f?.circuitId && p.circuits.find((c) => c.id === f.circuitId)) || null;
  }
  return (load.circuitId && p.circuits.find((c) => c.id === load.circuitId)) || null;
}

export function checkCircuits(p: Pick<Project, 'fixtures' | 'circuits' | 'loads' | 'settings'>): CircuitCheck {
  const share = p.settings.circuitLimitPct / 100;
  const byCircuit = new Map<string, Load[]>(p.circuits.map((c) => [c.id, []]));
  const unassigned: Load[] = [];
  for (const l of p.loads) {
    const c = circuitOfLoad(p, l);
    if (c) byCircuit.get(c.id)!.push(l);
    else unassigned.push(l);
  }
  const circuits = p.circuits.map((circuit) => {
    const loads = byCircuit.get(circuit.id)!;
    const totalW = loads.reduce((s, l) => s + l.watts, 0);
    const capacityW = circuit.amps * MAINS_VOLTAGE;
    const limitW = Math.round(capacityW * share);
    const status: CircuitStatus = totalW > capacityW ? 'over' : totalW > limitW ? 'warn' : 'ok';
    return { circuit, loads, totalW, capacityW, limitW, percent: Math.round((totalW / capacityW) * 100), status };
  });
  return { circuits, unassigned };
}

export const formatWatts = (w: number) => `${Math.round(w).toLocaleString('de-DE')} W`;
