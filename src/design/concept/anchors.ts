/**
 * What the room programme prompt gets from the code besides the sketch (mgritsch04/wohnungsplaner-3d#436):
 * the checked places for the anchor pieces (sofa, bed, desk, dining table; `analysis/slots.ts`).
 */
import type { Furniture, Project } from '../../model/schema';
import { gazePieceOf } from '../analysis/gaze';
import { anchorSlots, slotLines, type AnchorSize, type Slot } from '../analysis/slots';
import type { FlatConcept, RoomAnalysis, RoomConcept, RoomType } from '../types';
import { shapeOf } from './common';
import { existingIn, roomConceptOf } from './flatConcept';
import { isDining, isSleeping } from './needs';

const NOISY: RoomType[] = ['bath', 'kitchen', 'utility'];
const WORKS = /arbeit|büro|homeoffice|schreibtisch|\bpc\b|computer|gaming|monitor/i;

/** Anchor pieces the room gets from its type and functions, with the size the places are checked for. */
export function anchorSizes(rc: RoomConcept, area: number, existing: readonly Furniture[]): AnchorSize[] {
  const has = (shape: string) => existing.some((f) => shapeOf(f) === shape);
  const out: AnchorSize[] = [];
  const living = rc.type === 'living' || rc.functions.some((f) => /wohnen|sitzen|fernseh|couch|sofa/i.test(f));
  if (living && !has('sofa') && !has('sofa-corner') && area >= 9) out.push(area >= 14 ? { kind: 'sofa', name: 'Sofa 3-Sitzer', width: 2.1, depth: 0.9 } : { kind: 'sofa', name: 'Sofa 2-Sitzer', width: 1.6, depth: 0.88 });
  const sleeps = rc.type === 'bedroom' || rc.type === 'kids' || rc.functions.some(isSleeping);
  if (sleeps && !has('bed')) out.push(rc.type === 'kids' ? { kind: 'bed', name: 'Einzelbett', width: 0.95, depth: 2.05 } : area >= 10 ? { kind: 'bed', name: 'Doppelbett 160', width: 1.65, depth: 2.08 } : { kind: 'bed', name: 'Doppelbett 140', width: 1.45, depth: 2.05 });
  const works = rc.type === 'office' || rc.type === 'kids' || rc.functions.some((f) => WORKS.test(f));
  if (works && !has('desk')) out.push(area < 8 ? { kind: 'desk', name: 'Schreibtisch 100', width: 1.0, depth: 0.6 } : { kind: 'desk', name: 'Schreibtisch 140', width: 1.4, depth: 0.7 });
  const dines = rc.type === 'dining' || rc.functions.some(isDining);
  if (dines && !existing.some((f) => f.category === 'table' && f.height >= 0.6 && Math.max(f.width, f.depth) >= 0.75)) out.push(area >= 22 ? { kind: 'dining', name: 'Esstisch 6 Personen', width: 1.8, depth: 0.9 } : { kind: 'dining', name: 'Esstisch 4 Personen', width: 1.4, depth: 0.85 });
  return out;
}

/** Walls one would rather not sleep or work against: bath, kitchen or utility room behind, or outside without a window. */
export function loudWalls(room: RoomAnalysis, project: Project, concept: FlatConcept): Set<string> {
  const typeOf = (id: string) => roomConceptOf(concept, { roomId: id, name: project.rooms.find((r) => r.id === id)?.name ?? '' }).type;
  return new Set(
    room.walls
      .filter((w) => w.behind.some((b) => !!b && NOISY.includes(typeOf(b))) || (w.behind.includes(null) && !w.openings.some((o) => o.kind === 'window')))
      .map((w) => w.id),
  );
}

export interface RoomSlots {
  /** Sizes and places per anchor, in the order they appear in the prompt. */
  anchors: { size: AnchorSize; slots: Slot[] }[];
}

/** The checked places of all anchor pieces of the room. */
export function roomSlots(project: Project, concept: FlatConcept, room: RoomAnalysis): RoomSlots {
  const rc = roomConceptOf(concept, room);
  const present = existingIn(project, room);
  const existing = present.map(gazePieceOf);
  const loud = loudWalls(room, project, concept);
  return { anchors: anchorSizes(rc, room.area, present).map((size) => ({ size, slots: anchorSlots({ room, existing, loud }, size) })) };
}

/** Section for the prompt, or an empty string when the room has no anchor piece to place. */
export function slotSection(slots: RoomSlots, plansKitchen = false): string {
  if (!slots.anchors.length) return '';
  return `Geprüfte Plätze für die Ankermöbel (vom Programm berechnet, beste zuerst): Das Teil passt, Türschwenk und Wege bleiben frei, das Blickziel ist ausgerechnet (lege es nicht selbst fest, ob Sofa oder Bett auf die Küchenzeile oder die Tür schauen, das steht hier). Wähle für jedes Ankermöbel genau einen Platz und trage seine Kennung als "slot" ein (z. B. "slot":"SOFA-1"); Mitte, Wand und Blickrichtung setzt dann die App, x, y und facing darfst du weglassen. Passt dir keiner, wähle selbst und schreibe in "why", warum.${plansKitchen ? ' Die Küchenzeile planst du auch: lege sie zuerst fest, ein Platz, dessen Blickziel die Wand mit der Küchenzeile ist, gilt dann nicht (W10), nimm einen anderen.' : ''}
${slots.anchors.map((a) => slotLines(a.size, a.slots)).join('\n')}
`;
}

/** Slot of a given id in this room, or undefined. */
export const slotById = (slots: RoomSlots, id: string): Slot | undefined => slots.anchors.flatMap((a) => a.slots).find((s) => s.id.toLowerCase() === id.trim().toLowerCase());
