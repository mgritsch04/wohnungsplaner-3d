/**
 * Furniture groups as a designer plans them (mgritsch04/wohnungsplaner-3d#436): a seating group is
 * not a sofa with some pieces somewhere near it, it is sofa, coffee table centred in front of it,
 * a rug that holds both, a lamp and a place for a cup at the arms, armchairs turned towards it.
 * Claude places the anchor pieces; `completeGroups` makes every group complete and ties its members
 * with the relations and measures of the rule book (`../rulebook.ts`), so the solver moves the
 * group as one unit. What Claude already planned stays; only missing members are added and loose
 * ones bound. Every addition is named in the notes and carries the rule id in its reason.
 *
 * Groups (`GROUPS`): Sitzgruppe (sofa), Schlafplatz (bed), Essplatz (dining table), Arbeitsplatz
 * (desk), Leseecke (armchair on its own) and the room's main light.
 */
import { PLACEHOLDERS } from '../../assistant/design';
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import { roleOf, shapeOf, type Role } from '../../suggest/roomGeometry';
import type { ProgramItem, Relation, RoomProgram, RoomType } from '../types';

export type GroupKind = 'sitzgruppe' | 'schlafplatz' | 'essplatz' | 'arbeitsplatz' | 'leseecke';

/** The groups as the prompt names them, with what belongs to each (measures from the rule book). */
export const GROUPS: Record<GroupKind, { anchor: string; members: string }> = {
  sitzgruppe: {
    anchor: 'Sofa',
    members:
      'Couchtisch mittig 40–45 cm vor dem Sofa (½–⅔ der Sofalänge, W2/W3), Teppich mittig unter Sofa-Vorderfüßen und Couchtisch, breiter als das Sofa (W6), Beistelltisch an einer Armlehne (W4), Steh- oder Leselampe an der anderen (L2), Sessel an der Stirnseite des Couchtischs zur Gruppe gedreht (W1), Blickpunkt mittig gegenüber (Fernseher, Fenster, Bild; W5/W7)',
  },
  schlafplatz: {
    anchor: 'Bett',
    members: 'Nachttische als Paar (Einzelbett: einer) mit je einer Leselampe (S4), Teppich quer unter dem unteren ⅔ des Bettes (S5), Bild über dem Kopfteil (S6)',
  },
  essplatz: { anchor: 'Esstisch', members: 'Stühle rundum (E1/E2), Pendelleuchte mittig 60–70 cm über der Tischplatte (E3)' },
  arbeitsplatz: { anchor: 'Schreibtisch', members: 'Stuhl davor mit 100 cm Bewegungsfläche (A2), Arbeitsleuchte auf dem Tisch (A3), seitlich zum Fenster (A1)' },
  leseecke: { anchor: 'Sessel für sich', members: 'Leselampe neben oder leicht hinter dem Sessel (L4), Beistelltisch an der anderen Seite (W4), gern am Fenster (R6)' },
};

/** Gap between a coffee table and the sofa front (W2). */
export const COFFEE_GAP = 0.45;
/** Gap between an armchair at the end of the coffee table and the table (W1, W2). */
export const FLANK_GAP = 0.4;
/** Gap between a side table or lamp and the arm of the seat (W4). */
const ARM_GAP = 0.05;
/** Lower edge of a pendant above a dining table: top 75 cm plus 65 cm (E3). */
const PENDANT_OVER_TABLE = 1.4;
/** Rooms where every group is completed; balconies, baths and halls keep what Claude planned. */
const ROOMS: RoomType[] = ['living', 'bedroom', 'kids', 'office', 'dining', 'kitchen', 'other'];
/** Rooms that get a ceiling light as their main light when none is planned (L1). */
const MAIN_LIGHT: RoomType[] = ['living', 'bedroom', 'kids', 'office', 'dining', 'kitchen'];
/** Below this room area (m²) per function the room is compact (studio, living kitchen). */
const AREA_PER_FUNCTION = 8;
/** A living room below this area (m²) is compact. */
const SMALL_LIVING = 14;

interface Ctx {
  program: RoomProgram;
  items: ProgramItem[];
  relations: Relation[];
  catalog: CatalogItem[];
  notes: string[];
  added: Map<string, string[]>;
}

const lookup = (c: Ctx, id: string) => c.catalog.find((x) => x.id === id) ?? findCatalogItem(id);
const roleOfItem = (c: Ctx, it: ProgramItem): Role | null => {
  const item = lookup(c, it.catalogId);
  return item ? roleOf({ ...item, catalogId: item.id }) : null;
};
const widthOf = (c: Ctx, it: ProgramItem) => lookup(c, it.catalogId)?.width ?? 0;
const isGeneric = (it: ProgramItem) => it.catalogId.startsWith('generic-');

/** Relations that bind `id` to something else (it is derived from a parent in the solver). */
const DERIVED: Relation['kind'][] = ['front-of', 'left-of', 'right-of', 'pair', 'flank', 'above', 'under-front', 'under-all', 'on', 'around'];
const bound = (c: Ctx, id: string) =>
  c.relations.some((r) => (r.kind === 'around' ? r.items.includes(id) : r.kind === 'pair' ? r.item === id || r.item2 === id : 'item' in r && r.item === id && DERIVED.includes(r.kind)));
const placedBy = (c: Ctx, id: string) => c.relations.some((r) => 'item' in r && r.item === id && (r.kind === 'wall' || r.kind === 'corner' || r.kind === 'window'));
const targetsOf = (c: Ctx, id: string): string[] =>
  c.relations.flatMap((r) => (r.kind === 'around' ? (r.items.includes(id) ? [r.target] : []) : r.kind === 'pair' ? (r.item === id || r.item2 === id ? [r.target] : []) : 'item' in r && r.item === id && 'target' in r ? [r.target] : []));

function uniqueId(c: Ctx, base: string): string {
  let id = base;
  for (let k = 2; c.items.some((i) => i.id === id); k++) id = `${base}${k}`;
  return id;
}

function add(c: Ctx, anchor: ProgramItem, group: string, catalogId: string, idBase: string, why: string, extra: Partial<ProgramItem> = {}): ProgramItem | null {
  const item = lookup(c, catalogId);
  if (!item) return null;
  const it: ProgramItem = { id: uniqueId(c, idBase), catalogId, zone: anchor.zone, ...(anchor.hint ? { hint: { ...anchor.hint } } : {}), label: item.name, why, ...extra };
  c.items.push(it);
  c.added.set(group, [...(c.added.get(group) ?? []), item.name]);
  return it;
}

/** Replace every relation that places `id` by `rel` (keeps relations where it is the target). */
function rebind(c: Ctx, id: string, rel: Relation): void {
  c.relations = c.relations.filter((r) => !('item' in r && r.item === id && r.kind !== 'wall' && r.kind !== 'corner') && !(r.kind === 'around' && r.items.includes(id) && r.items.length === 1));
  c.relations.push(rel);
}

const inZone = (c: Ctx, zone: string, roles: Role[]) => c.items.filter((i) => i.zone === zone && roles.includes(roleOfItem(c, i)!));

/**
 * How much of a group a room gets: `full` in a living room with space, `compact` where several
 * functions share the room (studio, living kitchen: no extra side table, no rug under the bed),
 * `light` for a second sofa in a study, children's or bedroom (only its lamp).
 */
export type GroupScope = 'full' | 'compact' | 'light';

function seatingGroup(c: Ctx, sofa: ProgramItem, scope: GroupScope): void {
  const g = `Sitzgruppe „${sofa.id}“`;
  if (scope === 'light') {
    const lit = inZone(c, sofa.zone, ['floor-lamp', 'table-lamp']).length > 0;
    if (!lit) {
      const lamp = add(c, sofa, g, 'generic-floor-lamp', `${sofa.id}_stehlampe`, 'Leselicht am Sofa (L2, L4).')!;
      rebind(c, lamp.id, { kind: 'left-of', item: lamp.id, target: sofa.id, gap: ARM_GAP });
    }
    return;
  }
  const sofaWidth = widthOf(c, sofa);
  const sofaItem = lookup(c, sofa.catalogId);
  const corner = !!sofaItem && shapeOf(sofaItem) === 'sofa-corner';
  // coffee table centred in front (W2, W3)
  let coffee = inZone(c, sofa.zone, ['coffee-table'])[0];
  if (!coffee) {
    const id = sofaWidth >= 1.9 || corner ? 'generic-coffee-table' : 'generic-coffee-table-round';
    coffee = add(c, sofa, g, id, `${sofa.id}_couchtisch`, 'Gehört zur Sitzgruppe: Couchtisch mittig 40–45 cm vor dem Sofa (W2, W3).', { fallbacks: id === 'generic-coffee-table' ? ['generic-coffee-table-round'] : ['generic-side-table'] })!;
  }
  const front = c.relations.find((r) => r.kind === 'front-of' && r.item === coffee.id && r.target === sofa.id) as Extract<Relation, { kind: 'front-of' }> | undefined;
  if (!front || front.gap === undefined || front.gap < 0.3 || front.gap > 0.5) rebind(c, coffee.id, { kind: 'front-of', item: coffee.id, target: sofa.id, gap: COFFEE_GAP });

  // rug centred under the group, wider than the sofa (W6)
  const wantRug = corner ? 'generic-rug-240' : sofaWidth >= 1.9 ? 'generic-rug-200' : 'generic-rug-160';
  const fallbackRugs = ['generic-rug-240', 'generic-rug-200', 'generic-rug-160', 'generic-rug-120'].filter((r) => r !== wantRug && (lookup(c, r)?.depth ?? 0) <= (lookup(c, wantRug)?.depth ?? 0));
  let rug = inZone(c, sofa.zone, ['rug']).find((r) => !targetsOf(c, r.id).some((t) => t !== sofa.id && t !== coffee.id));
  if (!rug) rug = add(c, sofa, g, wantRug, `${sofa.id}_teppich`, 'Gehört zur Sitzgruppe: Teppich mittig unter Sofa-Vorderfüßen und Couchtisch, breiter als das Sofa (W6).', { fallbacks: fallbackRugs })!;
  else if (isGeneric(rug) && Math.max(lookup(c, rug.catalogId)?.width ?? 0, lookup(c, rug.catalogId)?.depth ?? 0) < sofaWidth + 0.3) {
    rug.fallbacks = [rug.catalogId, ...fallbackRugs.filter((f) => f !== rug!.catalogId)];
    rug.catalogId = wantRug;
    c.notes.push(`${g}: Teppich vergrößert, er muss breiter als das Sofa sein (W6).`);
  }
  if (!c.relations.some((r) => r.kind === 'under-front' && r.item === rug!.id && r.target === sofa.id)) rebind(c, rug.id, { kind: 'under-front', item: rug.id, target: sofa.id });

  // light and a place for a cup at the arms (W4, L2): lamp on one side, side table on the other
  const beside = (id: string) => c.relations.find((r) => (r.kind === 'left-of' || r.kind === 'right-of') && r.item === id && r.target === sofa.id) as Extract<Relation, { kind: 'left-of' | 'right-of' }> | undefined;
  const lamps = inZone(c, sofa.zone, ['floor-lamp']);
  let lamp = lamps.find((l) => beside(l.id)) ?? lamps.find((l) => !bound(c, l.id) && !placedBy(c, l.id) && !targetsOf(c, l.id).length);
  const tableLamp = inZone(c, sofa.zone, ['table-lamp']).some((l) => targetsOf(c, l.id).some((t) => inZone(c, sofa.zone, ['side-table']).some((s) => s.id === t)));
  if (!lamp && !tableLamp) lamp = add(c, sofa, g, 'generic-floor-lamp', `${sofa.id}_stehlampe`, 'Gehört zur Sitzgruppe: Steh- oder Leselampe an der Armlehne, Zonenlicht für Lesen und Plaudern (L2, L4).')!;
  const lampSide = lamp ? (beside(lamp.id)?.kind ?? 'left-of') : 'left-of';
  if (lamp && !beside(lamp.id)) rebind(c, lamp.id, { kind: lampSide, item: lamp.id, target: sofa.id, gap: ARM_GAP });
  const otherSide = lampSide === 'left-of' ? 'right-of' : 'left-of';
  let side = inZone(c, sofa.zone, ['side-table']).find((s) => beside(s.id) || !bound(c, s.id));
  if (!side && scope === 'full' && !corner) side = add(c, sofa, g, 'generic-side-table', `${sofa.id}_beistelltisch`, 'Gehört zur Sitzgruppe: Beistelltisch an der Armlehne für Tasse und Buch (W4).')!;
  if (side && !beside(side.id)) rebind(c, side.id, { kind: otherSide, item: side.id, target: sofa.id, gap: ARM_GAP });

  // armchairs of the zone that stand loose: at the ends of the coffee table, turned to it (W1)
  const loose = inZone(c, sofa.zone, ['armchair']).filter((a) => !bound(c, a.id) && !placedBy(c, a.id));
  loose.slice(0, 2).forEach((a, k) => {
    rebind(c, a.id, { kind: 'flank', item: a.id, target: coffee.id, side: k === 0 ? (lampSide === 'left-of' ? 'right' : 'left') : lampSide === 'left-of' ? 'left' : 'right', gap: FLANK_GAP });
    c.notes.push(`${g}: Sessel „${a.id}“ an die Stirnseite des Couchtischs gedreht (W1).`);
  });

  // the screen faces the sofa (W5); the solver centres it on the sofa's axis
  const screen = c.items.find((i) => roleOfItem(c, i) === 'tv-board') ?? c.items.find((i) => roleOfItem(c, i) === 'tv');
  if (screen && !c.relations.some((r) => r.kind === 'facing' && ((r.item === screen.id && r.target === sofa.id) || (r.item === sofa.id && r.target === screen.id)))) {
    c.relations.push({ kind: 'facing', item: screen.id, target: sofa.id });
  }
}

function sleepingPlace(c: Ctx, bed: ProgramItem, scope: GroupScope): void {
  const g = `Schlafplatz „${bed.id}“`;
  const double = widthOf(c, bed) >= 1.35;
  const pairRel = c.relations.find((r) => r.kind === 'pair' && r.target === bed.id) as Extract<Relation, { kind: 'pair' }> | undefined;
  const stands = inZone(c, bed.zone, ['nightstand']).filter((n) => !bound(c, n.id) || targetsOf(c, n.id).includes(bed.id));
  const tables: ProgramItem[] = [];
  if (pairRel) tables.push(...[pairRel.item, pairRel.item2].map((id) => c.items.find((i) => i.id === id)!).filter(Boolean));
  else {
    tables.push(...stands.slice(0, double ? 2 : 1));
    while (tables.length < (double ? 2 : 1)) tables.push(add(c, bed, g, 'generic-nightstand', `${bed.id}_nachttisch`, 'Gehört zum Schlafplatz: Nachttisch mit Ablage auf Matratzenhöhe (S4).')!);
    if (double) {
      for (const t of tables) c.relations = c.relations.filter((r) => !('item' in r && r.item === t.id && r.kind !== 'wall'));
      c.relations.push({ kind: 'pair', item: tables[0].id, item2: tables[1].id, target: bed.id });
    } else if (!bound(c, tables[0].id)) rebind(c, tables[0].id, { kind: 'right-of', item: tables[0].id, target: bed.id, gap: 0.03 });
  }
  // a reading light on every nightstand (S4)
  for (const t of tables) {
    const lit = c.items.some((i) => ['table-lamp'].includes(roleOfItem(c, i)!) && targetsOf(c, i.id).includes(t.id));
    if (lit) continue;
    const loose = inZone(c, bed.zone, ['table-lamp']).find((l) => !bound(c, l.id) && !placedBy(c, l.id));
    const lamp = loose ?? add(c, bed, g, 'generic-table-lamp', `${t.id}_lampe`, 'Gehört zum Schlafplatz: Leselampe auf dem Nachttisch, einzeln schaltbar (S4).')!;
    rebind(c, lamp.id, { kind: 'on', item: lamp.id, target: t.id });
  }
  // rug across the lower two thirds (S5), for a double bed
  if (double && scope === 'full' && !c.items.some((i) => roleOfItem(c, i) === 'rug' && targetsOf(c, i.id).includes(bed.id))) {
    const rug = inZone(c, bed.zone, ['rug']).find((r) => !bound(c, r.id) && !placedBy(c, r.id)) ?? add(c, bed, g, 'generic-rug-200', `${bed.id}_teppich`, 'Gehört zum Schlafplatz: Teppich quer unter dem unteren Teil des Bettes, morgens weich aufstehen (S5).', { fallbacks: ['generic-rug-160'] })!;
    rebind(c, rug.id, { kind: 'under-all', item: rug.id, target: bed.id });
  }
}

function diningPlace(c: Ctx, table: ProgramItem): void {
  const g = `Essplatz „${table.id}“`;
  const pendant = c.items.find((i) => roleOfItem(c, i) === 'pendant' && c.relations.some((r) => r.kind === 'above' && r.item === i.id && r.target === table.id));
  if (!pendant) {
    const p = add(c, table, g, 'generic-pendant', `${table.id}_pendel`, 'Gehört zum Essplatz: Pendelleuchte mittig über der Tischmitte, 60–70 cm über der Platte (E3).')!;
    c.relations.push({ kind: 'above', item: p.id, target: table.id, height: PENDANT_OVER_TABLE });
    return;
  }
  const rel = c.relations.find((r) => r.kind === 'above' && r.item === pendant.id) as Extract<Relation, { kind: 'above' }>;
  if (rel.height === undefined || rel.height < 1.3 || rel.height > 1.5) rel.height = PENDANT_OVER_TABLE;
}

function workPlace(c: Ctx, desk: ProgramItem): void {
  const g = `Arbeitsplatz „${desk.id}“`;
  if (!c.items.some((i) => roleOfItem(c, i) === 'seat' && targetsOf(c, i.id).includes(desk.id))) {
    const chair = inZone(c, desk.zone, ['seat']).find((s) => !bound(c, s.id) && /büro|office/i.test(`${s.catalogId} ${s.label ?? ''}`)) ?? add(c, desk, g, 'generic-office-chair', `${desk.id}_stuhl`, 'Gehört zum Arbeitsplatz: Stuhl davor mit 100 cm Bewegungsfläche (A2).')!;
    rebind(c, chair.id, { kind: 'front-of', item: chair.id, target: desk.id });
  }
  if (!c.items.some((i) => roleOfItem(c, i) === 'table-lamp' && targetsOf(c, i.id).includes(desk.id))) {
    const lamp = inZone(c, desk.zone, ['table-lamp']).find((l) => !bound(c, l.id) && !placedBy(c, l.id)) ?? add(c, desk, g, 'generic-table-lamp', `${desk.id}_leuchte`, 'Gehört zum Arbeitsplatz: Arbeitsleuchte auf dem Tisch (A3, 500 lx).')!;
    rebind(c, lamp.id, { kind: 'on', item: lamp.id, target: desk.id });
  }
}

function readingCorner(c: Ctx, chair: ProgramItem, scope: GroupScope): void {
  const g = `Leseecke „${chair.id}“`;
  const at = (role: Role) => c.items.find((i) => roleOfItem(c, i) === role && targetsOf(c, i.id).includes(chair.id));
  // any light of its own counts: a lamp beside it, a pendant above it, a lamp on its side table
  const lamp = at('floor-lamp') ?? at('table-lamp') ?? at('pendant');
  let side: 'left-of' | 'right-of' = 'right-of';
  if (!lamp) {
    const loose = inZone(c, chair.zone, ['floor-lamp']).find((l) => !bound(c, l.id) && !placedBy(c, l.id));
    const l = loose ?? add(c, chair, g, 'generic-floor-lamp', `${chair.id}_leselampe`, 'Gehört zur Leseecke: Leselampe neben dem Sessel, Licht über die Schulter (L4).')!;
    rebind(c, l.id, { kind: 'left-of', item: l.id, target: chair.id, gap: ARM_GAP });
  } else {
    const r = c.relations.find((x) => (x.kind === 'left-of' || x.kind === 'right-of') && x.item === lamp.id);
    side = r?.kind === 'right-of' ? 'left-of' : 'right-of';
  }
  if (!at('side-table') && scope === 'full') {
    const loose = inZone(c, chair.zone, ['side-table']).find((s) => !bound(c, s.id) && !placedBy(c, s.id));
    const t = loose ?? add(c, chair, g, 'generic-side-table', `${chair.id}_beistelltisch`, 'Gehört zur Leseecke: Beistelltisch für Tasse und Buch (W4).')!;
    rebind(c, t.id, { kind: side, item: t.id, target: chair.id, gap: ARM_GAP });
  }
}

/**
 * Completes the furniture groups of a room programme. `type` is the room type of the concept,
 * `area` the room's floor area in m². Returns a new programme and notes for the panel and the
 * critique; the input stays as it is.
 */
export function completeGroups(program: RoomProgram, type: RoomType, area: number, functions: number, products: CatalogItem[] = []): { program: RoomProgram; notes: string[] } {
  if (!ROOMS.includes(type)) return { program, notes: [] };
  const c: Ctx = { program, items: program.items.map((i) => ({ ...i })), relations: program.relations.map((r) => structuredClone(r)), catalog: [...PLACEHOLDERS, ...products], notes: [], added: new Map() };
  const anchors = (roles: Role[]) => c.items.filter((i) => roles.includes(roleOfItem(c, i)!));
  const compact = area / Math.max(1, functions) < AREA_PER_FUNCTION || area < SMALL_LIVING;
  const scope: GroupScope = compact ? 'compact' : 'full';
  const sofas = anchors(['sofa']);
  // the sofa of a living room makes a seating group; in a study or bedroom it is a place to read
  for (const s of sofas) seatingGroup(c, s, ['living', 'dining', 'kitchen', 'other'].includes(type) ? scope : 'light');
  for (const b of anchors(['bed'])) sleepingPlace(c, b, type === 'bedroom' || type === 'kids' ? (area < 10 ? 'compact' : 'full') : 'compact');
  for (const t of anchors(['table']).filter((t) => c.items.some((i) => roleOfItem(c, i) === 'seat' && targetsOf(c, i.id).includes(t.id)))) diningPlace(c, t);
  for (const d of c.items.filter((i) => lookup(c, i.catalogId)?.category === 'desk')) workPlace(c, d);
  // an armchair outside a seating group: a reading corner
  for (const a of anchors(['armchair']).filter((a) => !bound(c, a.id))) readingCorner(c, a, scope);
  // the room's main light (L1): a ceiling light that is not the pendant over a table
  if (MAIN_LIGHT.includes(type) && area >= 6 && !c.items.some((i) => roleOfItem(c, i) === 'pendant' && !bound(c, i.id))) {
    const anchor = c.items.find((i) => i.required) ?? c.items[0];
    if (anchor) add(c, anchor, 'Grundlicht', 'generic-pendant', 'deckenlicht', 'Grundlicht des Raums an der Decke, warmweiß und dimmbar (L1, L3).');
  }
  for (const [g, names] of c.added) c.notes.push(`${g} ergänzt: ${names.join(', ')}.`);
  return { program: { ...program, items: c.items, relations: c.relations }, notes: c.notes };
}
