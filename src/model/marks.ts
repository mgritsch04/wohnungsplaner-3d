import type { DerivedPlan } from './derived';
import type { Mark, MarkKind, Project } from './schema';
import { pointInPolygon } from './vec';

/** Mieter-Paket (#362): Markierungen für Übergabeprotokoll und Bohrloch-Plan. */
export const MARK_KINDS: { id: MarkKind; label: string; short: string; color: string }[] = [
  { id: 'condition', label: 'Zustand', short: 'Z', color: '#2563eb' },
  { id: 'drill', label: 'Bohrloch', short: 'B', color: '#dc2626' },
  { id: 'glue', label: 'Klebestelle', short: 'K', color: '#d97706' },
];

export const markKindInfo = (k: MarkKind) => MARK_KINDS.find((m) => m.id === k)!;

/** Label shown in the plan and the protocol, numbered per kind in list order: Z1, B2 … */
export function markLabels(marks: Mark[]): Map<string, string> {
  const counts: Record<MarkKind, number> = { condition: 0, drill: 0, glue: 0 };
  const out = new Map<string, string>();
  for (const m of marks) out.set(m.id, `${markKindInfo(m.kind).short}${++counts[m.kind]}`);
  return out;
}

export const OUTSIDE_ROOM = 'Außerhalb der Räume';

export function roomNameAt(project: Project, derived: DerivedPlan, p: { x: number; y: number }): string {
  const hits = project.rooms
    .map((r) => ({ r, g: derived.rooms.get(r.id) }))
    .filter((h) => h.g && pointInPolygon(p, h.g.interior))
    .sort((a, b) => a.g!.area - b.g!.area);
  return hits.length ? hits[0].r.name || 'Raum' : OUTSIDE_ROOM;
}

/** Marks grouped by room, in room order; marks outside every room come last. */
export function marksByRoom(project: Project, derived: DerivedPlan): { room: string; marks: Mark[] }[] {
  const groups = new Map<string, Mark[]>();
  for (const m of project.marks) {
    const room = roomNameAt(project, derived, m);
    groups.set(room, [...(groups.get(room) ?? []), m]);
  }
  const order = [...project.rooms.map((r) => r.name || 'Raum'), OUTSIDE_ROOM];
  return [...groups.entries()].map(([room, marks]) => ({ room, marks })).sort((a, b) => order.indexOf(a.room) - order.indexOf(b.room));
}
