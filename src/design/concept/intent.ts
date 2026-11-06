/**
 * Does Claude's own plan keep the rules it was given? (mgritsch04/wohnungsplaner-3d#436, research of
 * 6.11.2026: self-correction only works with reliable feedback, and a contradiction in the programme
 * is cheaper to fix before the solver than after it, LayoutVLM „self-consistent decoding“.)
 *
 * The check reads the start places and directions of the programme, before anything is placed, and
 * names what already breaks a rule there: the television not opposite the sofa or far off it (W5), the sofa
 * looking at the kitchen run (W10). These go back to Claude with the other problems of the answer
 * (one repair round); a finding the solver causes later is not Claude's to fix.
 */
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import type { Furniture } from '../../model/schema';
import { dist, sub, type Vec2 } from '../../model/vec';
import { roleOf, shapeOf } from '../../suggest/roomGeometry';
import { sideOfVector } from '../coords';
import { tvRange } from '../tvDistance';
import type { ProgramItem, RoomProgram } from '../types';

const deg = (d: number) => (d * Math.PI) / 180;
/** Front of a piece with this rotation (local +y), as `Furniture.rotation`. */
const frontOf = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });
const angle = (a: Vec2, b: Vec2) => {
  const l = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return l < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / l)));
};
const SIDE_NAMES = { N: 'Norden', O: 'Osten', S: 'Süden', W: 'Westen' } as const;
const sideName = (v: Vec2) => {
  const s = sideOfVector(v, 45);
  return s ? SIDE_NAMES[s] : 'schräg';
};

/** The television must lie within this angle of the sofa's view (W5; the walkthrough flags 30°). */
export const TV_CONE = deg(30);
/** The sofa does not look at kitchen pieces within this cone and distance (W10, as the walkthrough). */
const KITCHEN_CONE = deg(35);
const KITCHEN_RANGE = 5;

interface Placed {
  id: string;
  at: Vec2;
  front: Vec2;
  role: string;
  shape: string;
  width: number;
  depth: number;
}

function placedOf(items: readonly ProgramItem[], products: readonly CatalogItem[]): Placed[] {
  return items.flatMap((it) => {
    const c = findCatalogItem(it.catalogId, [...products]);
    if (!c || !it.hint) return [];
    return [{ id: it.id, at: { x: it.hint.x, y: it.hint.y }, front: frontOf(it.hint.rotation), role: roleOf(c), shape: shapeOf(c), width: c.width, depth: c.depth }];
  });
}

/** Points of the kitchen run along its wall, and pieces of a kitchen already in the room. */
function kitchenPoints(program: RoomProgram, existing: readonly Furniture[]): Vec2[] {
  const out: Vec2[] = [];
  for (const k of program.kitchen ?? [])
    for (let t = 0; t <= 1.0001; t += 0.25) out.push({ x: k.from.x + (k.to.x - k.from.x) * t, y: k.from.y + (k.to.y - k.from.y) * t });
  for (const f of existing) if (f.kitchen || shapeOf(f).startsWith('k-')) out.push({ x: f.x, y: f.y });
  return out;
}

/**
 * Problems in the programme's own start places, as lines for the repair prompt. `existing` are the
 * pieces already in the room (a fitted kitchen counts as kitchen run).
 */
export function intentProblems(program: RoomProgram, existing: readonly Furniture[] = [], products: readonly CatalogItem[] = []): string[] {
  const problems: string[] = [];
  const pieces = placedOf(program.items, products);
  const sofas = pieces.filter((p) => p.role === 'sofa');
  const tvs = pieces.filter((p) => p.role === 'tv');
  const kitchen = kitchenPoints(program, existing);
  for (const tv of tvs) {
    const sofa = sofas.slice().sort((a, b) => dist(a.at, tv.at) - dist(b.at, tv.at))[0];
    if (!sofa) continue;
    const to = sub(tv.at, sofa.at);
    if (Math.hypot(to.x, to.y) > 0.3 && angle(sofa.front, to) > TV_CONE + deg(5))
      problems.push(
        `„${tv.id}“ steht nach deinen Startplätzen nicht gegenüber von „${sofa.id}“: das Sofa schaut nach ${sideName(sofa.front)}, der Fernseher liegt von ihm aus im ${sideName(to)} (W5: Fernseher mittig gegenüber dem Hauptsitz). Sofa und Fernseher an gegenüberliegende Wände stellen oder die Blickrichtung des Sofas ändern.`,
      );
    else {
      const range = tvRange(tv.width);
      const d = Math.hypot(to.x, to.y) - sofa.depth / 2;
      if (d > range.hi + 0.3 || d < range.lo - 0.3)
        problems.push(
          `Zwischen der Vorderkante von „${sofa.id}“ und „${tv.id}“ liegen nach deinen Startplätzen etwa ${d.toFixed(1).replace('.', ',')} m, bei diesem Fernseher sind ${range.lo.toFixed(1).replace('.', ',')} bis ${range.hi.toFixed(1).replace('.', ',')} m angenehm (W5). Das Sofa näher oder weiter weg stellen, notfalls frei im Raum mit Konsole dahinter.`,
        );
    }
  }
  if (kitchen.length)
    for (const s of sofas) {
      const tv = tvs.find((t) => angle(s.front, sub(t.at, s.at)) <= KITCHEN_CONE);
      const seen = kitchen.filter((k) => {
        const to = sub(k, s.at);
        const d = Math.hypot(to.x, to.y);
        return d <= KITCHEN_RANGE && angle(s.front, to) <= KITCHEN_CONE && !(tv && dist(tv.at, s.at) < d);
      });
      if (seen.length)
        problems.push(
          `„${s.id}“ schaut nach deinen Startplätzen nach ${sideName(s.front)} direkt auf die Küchenzeile (W10). Das Sofa so drehen oder stellen, dass es auf Fenster, Fernseher oder die Sitzgruppe schaut; die Küche liegt seitlich oder im Rücken, dann mit Konsole oder Sideboard dahinter.`,
        );
    }
  return problems;
}
