/**
 * Stage 2 (mgritsch04/wohnungsplaner-3d#439): the room programme. One request per room: Claude
 * reads the room from the sketch of stage 0, sets zones, places the anchor pieces, then the
 * pieces that belong to them with relations from the closed vocabulary, then light, textiles and
 * decor, and walks through the room in its head. The answer comes in room cm; the parser turns
 * it into a `RoomProgram` in plan coordinates, maps relation words outside the vocabulary,
 * leaves out what is already there and lists what Claude has to repair (unknown ids, zones
 * outside the room, required pieces missing, functions of other rooms, new sanitary objects).
 */
import { type DesignWishes, PLACEHOLDERS, preselect, summarizePlaceholders, summarizeProducts } from '../../assistant/design';
import { findCatalogItem, GENERIC_CATALOG } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import type { Furniture, Project } from '../../model/schema';
import { add, dot, pointInPolygon, scale, sub, type Vec2 } from '../../model/vec';
import { fromRoomCm, parseSide, rotationForSide, toRoomCm } from '../coords';
import type { FlatConcept, KitchenRun, ProgramItem, ProgramZone, RoomAnalysis, RoomConcept, RoomProgram, RoomType } from '../types';
import { type Checked, hex, isKitchenModule, key, num, SANITARY, shapeOf, str, strList, type Thing, thingOf } from './common';
import { existingIn, roomConceptOf, wantsHandBasin } from './flatConcept';
import { diningTable, functionNeeds, isCooking, isDining, isGuestBed, isSleeping, looksLikeGuestBed, type Need, NEEDS } from './needs';
import { completeGroups } from './groups';
import { parseRelations, type RelationItem } from './relations';

export interface RoomProgramInput {
  project: Project;
  concept: FlatConcept;
  room: RoomAnalysis;
  /** Room sketch as text for Claude (stage 0): walls, doors, windows, free stretches, walkways. */
  sketch: string;
  wishes: DesignWishes;
  /** The user's own products (offered next to the placeholders, a preselection per room type). */
  products?: CatalogItem[];
}

/** Own products offered per room. */
export const MAX_ROOM_PRODUCTS = 40;
/** More pieces than this in one room is not a plan any more. */
export const MAX_ITEMS = 45;
/** Same catalogue piece at most this often (chairs, boxes …). */
export const MAX_SAME = 12;

/** Floor modules Claude lines up; wall cabinets, worktop, cooktop and hood are added by the app. */
const KITCHEN_MODULES = GENERIC_CATALOG.filter((c) => isKitchenModule(c) && !['wall', 'hood', 'cooktop', 'countertop'].includes(c.kitchen!.type));
const ADDED_BY_APP = GENERIC_CATALOG.filter((c) => isKitchenModule(c) && !KITCHEN_MODULES.includes(c)).map((c) => c.id);
const cm = (v: number) => Math.round(v * 100);

/** Existing pieces except kitchen modules, with the short labels the prompt gives them (B1, B2 …) for relations. */
export function existingLabels(project: Project, room: RoomAnalysis): { label: string; f: Furniture }[] {
  return existingIn(project, room)
    .filter((f) => !f.kitchen)
    .map((f, i) => ({ label: `B${i + 1}`, f }));
}

const hasKitchen = (pieces: readonly Furniture[]) => pieces.some((f) => !!f.kitchen || shapeOf(f).startsWith('k-'));

/** Does the room get a kitchen run from Claude: cooking is here and no kitchen is there yet. */
export const plansKitchen = (rc: RoomConcept, existing: readonly Furniture[]) => (rc.functions.some(isCooking) || rc.type === 'kitchen') && !hasKitchen(existing);

/** Pieces the room must have: by its type and by the functions the concept gave it. */
export function roomNeeds(rc: RoomConcept, area: number): Need[] {
  // a studio (living room with the bed) or a small living room: one armchair is a seat too
  const studio = rc.type === 'living' && (rc.functions.some(isSleeping) || area < 14);
  const own = NEEDS[rc.type].filter((n) => !n.minArea || area >= n.minArea).map((n) => (studio && n.label.startsWith('Sofa') ? { label: 'Sofa oder Sessel', has: (t: Thing) => t.category === 'sofa' } : n));
  const extra = functionNeeds(rc.functions, rc.type).filter((n) => !own.some((o) => o.label.split(' ')[0] === n.label.split(' ')[0]));
  return [...own, ...extra];
}

const RULES = `- Wege zwischen den Türen bleiben frei: 90 cm breit in Gang, Vorraum und Durchgangszimmern, sonst mindestens 70 cm. Nichts im Schwenkbereich einer Tür (Viertelkreis mit der Türbreite als Radius auf der Seite, auf die das Türblatt aufschlägt), auch keine Pflanze und keine Stehlampe.
- Vor Fenstern nichts, was höher als die Brüstung ist (außer Vorhängen); große Pflanzen und Stehlampen seitlich daneben.
- Abstände (Neufert): vor Schränken und Kommoden 80–90 cm frei, neben dem Bett 60–70 cm (Doppelbett von beiden Seiten zugänglich), hinter Esstischstühlen 75–90 cm bis zur Wand oder zum Weg, Couchtisch 40–50 cm vor dem Sofa, Stuhlzone am Schreibtisch 75 cm, Arbeitsgang vor der Küchenzeile 100–120 cm, vor WC und Waschtisch 60–75 cm, Fernseher gegenüber dem Sofa im 1,5- bis 2,5-fachen Abstand der Bilddiagonale. Zwei Möbel, zwischen denen man sitzt oder geht, mindestens 20 cm auseinander (oder bündig aneinander).
- Bett mit dem Kopfteil an eine geschlossene Wand, nicht unter das Fenster. Schreibtisch seitlich zum Fenster, nicht mit dem Bildschirm vor dem Fenster. Sofa nicht mit dem Rücken direkt vor eine Tür. Hohe Möbel (über 1,2 m) an die Wand, nicht frei in den Raum.
- Pflanzen: in eine echte Ecke, neben ein Möbel oder ans Fenster, nie frei im Raum oder im Weg. Kleine Pflanzen und Kräuter auf Fensterbank, Regal oder Arbeitsplatte, nicht auf den Boden.
- Tischlampen stehen auf Nachttisch, Sideboard, Kommode, Schreibtisch oder Regal, nie auf dem Esstisch. Licht in drei Ebenen: Grundlicht (Decke), Zonenlicht (Pendel über dem Esstisch, Leselampe, Schreibtischlampe), Stimmungslicht; warmweiß.
- Teppich im Wohnbereich: mindestens die vorderen Füße von Sofa und Sesseln liegen darauf. Unter dem Bett ragt der Teppich seitlich 40–60 cm heraus. Kein Teppich im Türschwenk, ein Läufer mittig im Gang.
- Bild über Sofa oder Bett: etwa zwei Drittel der Möbelbreite, mittig darüber; Bildmitte auf etwa 150 cm. Nichts über Fenster oder Tür. Der Badspiegel hängt über dem Waschtisch.
- Vorhänge als Paar: je Fenster zwei Schals (zwei Teile, beide mit [..,"window","F1","over"]); sie hängen offen links und rechts neben dem Fenster, zusammen mindestens so breit wie das Fenster.
- Jede Zone vollständig, so wie eine Innenarchitektin sie abgibt: Sitzgruppe mit Sofa, Couchtisch, Teppich unter den Vorderfüßen und einer Steh- oder Tischlampe daneben, ab etwa 16 m² dazu ein Sessel, der zur Gruppe schaut, mit Beistelltisch daneben; Essplatz mit Tisch, Stühlen und Pendelleuchte; Arbeitsplatz mit Tisch, Stuhl, Lampe und Regal oder Rollcontainer in Griffnähe; Schlafplatz mit Bett, Nachttischen mit Lampen und Schrank oder Kommode (außer die Kleidung hat einen eigenen Raum); Kinderzimmer mit einer Spielfläche auf dem Teppich (Spielkiste, niedriges Regal oder Sitzsack); Leseecke mit Sessel, Beistelltisch, Leselampe und kleinem Teppich. Ein Arbeitszimmer bekommt höchstens ein kleines Sofa oder einen Sessel, kein großes Wohnzimmersofa.
- Die Zonen verteilen sich über den ganzen Raum: keine Hälfte bleibt leer, während anderswo alles dicht steht. In Wohn- und Schlafräumen ist etwa ein Viertel bis zwei Fünftel des Bodens möbliert. Ein Sessel steht neben dem Fenster oder zur Sitzgruppe gedreht, nicht davor.
- Jedes Sofa hat ein Gegenüber: Fernseher oder Medienwand, ein Fenster mit Ausblick, ein großes Bild an der Wand gegenüber oder Sessel, die zum Sofa schauen. Ein Sofa, das auf eine leere Wand, ein Regal oder Türen schaut, wirkt abgestellt.
- Ein Blickfang, den man beim Hereinkommen sieht; Farben aus der Palette; lieber weniger und stimmig. Nichts ohne Grund, nichts doppelt (im Gang höchstens eine Deckenleuchte je 6 m²).`;

const RELATIONS = `Beziehungen (nur diese Wörter; a, b, c sind ids aus "items", Abstände und Höhen in cm):
- [a,"wall","W2"] Rücken von a an der Wand W2; mit Bereich [a,"wall","W2",von,bis] (x-Werte an Nord-/Südwänden, y-Werte an Ost-/Westwänden)
- [a,"corner","W1","W2"] a in der Ecke von W1 und W2
- [a,"center"] a steht frei in der Mitte seiner Zone (Esstisch, Raumteiler)
- [a,"front-of",b,45] a vor der Vorderseite von b, 45 cm dazwischen (Couchtisch vor dem Sofa)
- [a,"left-of",b,10] und [a,"right-of",b,10] a neben b, links bzw. rechts aus Sicht von b (wie man auf dem Sofa sitzt oder im Bett liegt)
- [a,"pair",c,b] a und c spiegelgleich links und rechts von b (Nachttische am Bett)
- [a,"facing",b,250] a schaut zu b, 250 cm zwischen den Vorderseiten (Fernseher und Sofa)
- [a,"around",b] Stuhl a am Tisch b (eine Zeile je Stuhl)
- [a,"above",b,140] a hängt mittig über b, Unterkante 140 cm (Bild über dem Sofa, Pendelleuchte über dem Esstisch, Spiegel über dem Waschtisch)
- [a,"under-front",b] Teppich a unter dem vorderen Teil von b (Sofa, Sessel); [a,"under-all",b] ganz darunter (Bett, Essgruppe)
- [a,"on",b] a steht auf b (Tischlampe auf dem Nachttisch); [a,"on","F1"] auf der Fensterbank von F1
- [a,"window","F1","beside"] a seitlich am Fenster F1; "front" davor unter der Brüstung; "over" darüber (Vorhang)
- [a,"near",b,80] Mitte von a höchstens 80 cm von b; [a,"away",b,200] mindestens 200 cm entfernt
- [a,"align",b] a und b in einer Flucht (Regale nebeneinander, Schränke in einer Reihe)
Andere Wörter (next-to, beside, against …) versteht der Aufsteller nicht. Türen sind kein Ziel. Bestand (B1 …) darf Ziel sein, z. B. [mirror,"above","B2"].`;

const format = (userZone: string | null) => `{"reading":"2–4 Sätze: was diesen Raum prägt (Licht, Wege, ruhige Seite, Blick beim Hereinkommen)",
 "zones":[{"id":"sitzen","function":"Sitzen/Fernsehen","rect":[x0,y0,x1,y1],"why":"…"${userZone ? `,"userZone":"${userZone}"` : ''}}],
 "items":[{"id":"sofa","catalogId":"generic-sofa-3","zone":"sitzen","x":215,"y":140,"facing":"S","label":"kurze Produktbeschreibung","color":"#rrggbb","why":"…","anchor":true,"fallbacks":["generic-sofa-2"]}],
 "relations":[["coffee","front-of","sofa",45],["rug","under-front","sofa"],["ns1","pair","ns2","bed"],["pendant","above","table",160],["plant1","corner","W1","W2"],["tv","facing","sofa",250],["curtain1","window","F1","over"]],
 "kitchen":[{"wall":"W2","from":[x,y],"to":[x,y],"modules":["generic-k-fridge","…"]}],
 "walk":"wie man durch den eingerichteten Raum geht (Wege, Breiten)",
 "check":["was du bei der Begehung geprüft hast, Punkt für Punkt"]}`;

/** The prompt for one room programme. */
export function buildRoomProgramPrompt(input: RoomProgramInput): string {
  const { project, concept, room, sketch } = input;
  const rc = roomConceptOf(concept, room);
  const nameOf = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? id;
  const elsewhere = concept.functions.filter((f) => f.roomId !== room.roomId).map((f) => `${f.function} → ${nameOf(f.roomId)}`);
  const existing = existingLabels(project, room);
  const all = existingIn(project, room);
  const kitchen = plansKitchen(rc, all);
  const needs = roomNeeds(rc, room.area);
  const own = preselect(input.products ?? [], [rc.type], 0, MAX_ROOM_PRODUCTS);
  const zones = room.userZones.filter((z) => !z.keepFree).map((z) => z.id);
  const palette = concept.style.palette.map((c) => `${c.name} ${c.hex}`).join(', ');
  return `Du bist eine erfahrene Innenarchitektin und richtest jetzt EINEN Raum ein, passend zum Wohnkonzept. Arbeite in dieser Reihenfolge:
1. Raum lesen: Wo sind Türen und Fenster, welche Wege laufen durch, welche Wände sind frei, woher kommt das Licht, was sieht man beim Hereinkommen?
2. Zonen festlegen: welche Bereiche, wo genau (Rechteck in Raumkoordinaten), warum dort. Die Wege zwischen den Türen gehören zu keiner Möbelzone.
3. Je Zone zuerst das Ankermöbel ("anchor":true), mit Startplatz und Blickrichtung.
4. Dann die Begleitmöbel mit klaren Beziehungen (Couchtisch 45 cm vor dem Sofa, Nachttische als Paar am Bett, Stühle um den Tisch).
5. Erst dann Licht, Textilien und Deko, jedes Teil mit Platz und Grund.
6. Begehung im Kopf: Kommt man überall bequem durch? Öffnen alle Türen ganz? Ist jedes Möbel erreichbar? Würde jemand das wirklich so einrichten?

Wohnkonzept: ${concept.living}
Stil: ${concept.style.idea}${concept.style.materials.length ? ` Materialien: ${concept.style.materials.join(', ')}.` : ''} Palette: ${palette}.
Dieser Raum: Typ ${rc.type}. ${rc.role} Funktionen: ${rc.functions.join(', ') || '–'}. Ankermöbel: ${rc.anchors.join('; ') || 'nach Funktion'}.${rc.accent ? ` Akzentfarbe ${rc.accent}.` : ''} Nicht hierher: ${rc.avoid.join(', ') || '–'}.
In anderen Räumen (hier NICHT planen): ${elsewhere.join('; ') || '–'}
${room.passThrough ? 'Dieser Raum ist ein Durchgangszimmer: die Wege zwischen seinen Türen bleiben 90 cm breit frei.\n' : ''}
Raumskizze:
${sketch}
${existing.length ? `\nBestand (steht schon, siehe Skizze; NICHT in "items" aufnehmen; als Ziel in Beziehungen mit diesem Kürzel): ${existing.map(({ label, f }) => `${label} = ${f.name} bei (${toRoomCm(room.origin, f).x},${toRoomCm(room.origin, f).y})`).join(', ')}.\n` : ''}${zones.length ? `\nVom Nutzer markierte Bereiche (siehe Skizze): Die Zone für ${zones.join(', ')} bekommt "userZone" mit diesem Kürzel und liegt in dem Bereich. Die Bereiche sind von Hand und nur ungefähr gezeichnet: Ein Möbel darf etwas über den Rand ragen, wenn es so besser passt.\n` : ''}
${needs.length ? `Muss in den Raum (sonst fehlt etwas): ${needs.map((n) => n.label).join(', ')}.\n` : ''}${kitchen ? `Küche: Hier gibt es noch keine Küchenzeile. Plane sie in "kitchen" als gerade Zeile an einer Wand (eine L-Küche sind zwei Zeilen): "from" und "to" sind Punkte an dieser Wand in Raumkoordinaten, "modules" die Bodenmodule in Reihenfolge von "from" nach "to" (Spüle, Kühlschrank, Backofen, Unterschränke; Oberschränke, Arbeitsplatte, Kochfeld und Haube setzt die App). Spüle gern unter dem Fenster; Arbeitsfläche zwischen Spüle und Kochstelle mindestens 60 cm; Kühlschrank, Spüle und Kochstelle in einer zusammenhängenden Zeile (bei einer L-Küche treffen sich beide Zeilen in der Ecke, keine Lücke); die Kochstelle nicht gleich neben die Tür; nichts vor eine Tür oder die Balkontür.
Küchenmodule (nur in "kitchen"):
${summarizePlaceholders(KITCHEN_MODULES)}
` : all.some((f) => !!f.kitchen) ? 'Die Küchenzeile ist vorhanden (Bestand): keine neue planen, nur Essplatz und Rest.\n' : ''}
Feste Regeln:
${RULES}

Möbel (Format „id: Art, Breite×Tiefe×Höhe cm, Kategorie, Richtwert“; nur diese catalogIds):
${summarizePlaceholders(PLACEHOLDERS)}
${own.length ? `\nEigene Produkte des Nutzers (bevorzugt verwenden, wo sie passen):\n${summarizeProducts(own)}\n` : ''}
${RELATIONS}

Antworte nur mit JSON in dieser Form:
${format(zones[0] ?? null)}
x,y = Mittelpunkt des Möbels in cm (Raumkoordinaten). facing = Himmelsrichtung (N, O, S, W), in die die Vorderseite zeigt: Sofa und Sessel in Sitzrichtung, Bett vom Kopfteil zum Fußende, Schrank und Regal mit der Türseite, Schreibtisch zur Sitzseite. Wandteile (Bild, Spiegel, Wandregal, Garderobe, Vorhang) mit x,y direkt an der Wand und facing in den Raum. "fallbacks": kleinere Teile derselben Art, falls das Ankermöbel nicht passt. "kitchen" nur, wenn oben eine Küche verlangt ist.`;
}

interface ProgramFacts {
  rc: RoomConcept;
  room: RoomAnalysis;
  existing: { label: string; f: Furniture }[];
  /** All existing pieces, kitchen modules included. */
  all: Furniture[];
  catalog: CatalogItem[];
  /** Plan point of room cm. */
  P: (x: number, y: number) => Vec2;
}

/** Bounding box of the room in cm with a tolerance. */
function inRoom(room: RoomAnalysis, x: number, y: number, tol: number): boolean {
  return x >= -tol && y >= -tol && x <= cm(room.size.x) + tol && y <= cm(room.size.y) + tol;
}

const ALIASES: [RegExp, string][] = [
  [/wc|toilet|klo/i, 'toilet'],
  [/basin|waschtisch|waschbecken|lavabo/i, 'washbasin'],
  [/shower|dusch/i, 'shower'],
  [/tub|wanne/i, 'bathtub'],
];

/**
 * Parses and checks the room programme answer. Coordinates go from room cm to plan metres;
 * pieces already in the room (Claude listed the existing WC again in the trial) are left out.
 */
export function parseRoomProgram(raw: unknown, input: RoomProgramInput): Checked<RoomProgram> {
  const { room } = input;
  const f: ProgramFacts = {
    rc: roomConceptOf(input.concept, room),
    room,
    existing: existingLabels(input.project, room),
    all: existingIn(input.project, room),
    catalog: [...PLACEHOLDERS, ...(input.products ?? [])],
    P: (x, y) => fromRoomCm(room.origin, x, y),
  };
  const problems: string[] = [];
  const notes: string[] = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (o !== raw) problems.push('Die Antwort ist kein JSON-Objekt der verlangten Form.');
  const lookup = (id: string) => f.catalog.find((c) => c.id === id) ?? findCatalogItem(id, input.products ?? []);

  // zones
  const zones: ProgramZone[] = [];
  const userZones = new Set(room.userZones.filter((z) => !z.keepFree).map((z) => z.id));
  for (const z of Array.isArray(o.zones) ? o.zones : []) {
    const e = (z ?? {}) as Record<string, unknown>;
    let id = str(e.id, 40);
    if (!id) continue;
    if (zones.some((x) => x.id === id)) {
      notes.push(`Zone „${id}“ doppelt, umbenannt.`);
      id = `${id}_${zones.length + 1}`;
    }
    const r = (Array.isArray(e.rect) ? e.rect : []).map(num);
    if (r.length !== 4 || r.some((v) => v === null)) {
      problems.push(`Zone „${id}“: "rect" muss [x0,y0,x1,y1] in cm sein.`);
      continue;
    }
    let [x0, y0, x1, y1] = r as number[];
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
    [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (!inRoom(room, x0, y0, 30) || !inRoom(room, x1, y1, 30)) {
      problems.push(`Zone „${id}“ [${[x0, y0, x1, y1].join(',')}] liegt außerhalb des Raums (Innenmaß ${cm(room.size.x)} × ${cm(room.size.y)} cm).`);
      continue;
    }
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const c = [clamp(x0, cm(room.size.x)), clamp(y0, cm(room.size.y)), clamp(x1, cm(room.size.x)), clamp(y1, cm(room.size.y))];
    if (c.some((v, i) => v !== [x0, y0, x1, y1][i])) notes.push(`Zone „${id}“ auf den Raum gekürzt.`);
    const a = f.P(c[0], c[1]);
    const b = f.P(c[2], c[3]);
    const inside = [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }].map((p) => ({ x: p.x + Math.sign((a.x + b.x) / 2 - p.x) * 0.05, y: p.y + Math.sign((a.y + b.y) / 2 - p.y) * 0.05 }));
    if (!inside.some((p) => pointInPolygon(p, room.polygon))) {
      problems.push(`Zone „${id}“ liegt außerhalb der Raumfläche (der Raum ist nicht rechteckig).`);
      continue;
    }
    const uz = str(e.userZone, 10).toUpperCase();
    if (uz && !userZones.has(uz)) notes.push(`Zone „${id}“: markierter Bereich „${uz}“ unbekannt, weggelassen.`);
    zones.push({ id, function: str(e.function, 80), rect: { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, why: str(e.why, 500), ...(uz && userZones.has(uz) ? { userZone: uz } : {}) });
  }
  if (!zones.length) problems.push('"zones" ist leer: mindestens eine Zone mit Rechteck angeben.');
  for (const uz of userZones) if (!zones.some((z) => z.userZone === uz)) notes.push(`Markierter Bereich ${uz} hat keine eigene Zone bekommen.`);

  // items
  const items: ProgramItem[] = [];
  const things = new Map<string, RelationItem>();
  const existingShapes = new Set(f.all.map(shapeOf));
  const handBasin = wantsHandBasin(f.all);
  const leftOut = new Set<string>();
  /** Pieces Claude listed again although they are there: relations to them go to the existing piece. */
  const duplicateOf = new Map<string, string>();
  const rawItems = Array.isArray(o.items) ? o.items : [];
  if (!rawItems.length) problems.push('"items" ist leer.');
  for (const it of rawItems.slice(0, 120)) {
    const e = (it ?? {}) as Record<string, unknown>;
    let id = str(e.id, 40);
    const catalogId = str(e.catalogId, 120);
    const label = str(e.label, 160);
    if (!id) id = `${catalogId || 'teil'}_${items.length + 1}`;
    const c = lookup(catalogId);
    if (!c) {
      problems.push(`Teil „${id}“: catalogId „${catalogId}“ gibt es nicht – nur ids aus der Möbelliste verwenden.`);
      leftOut.add(id);
      continue;
    }
    const t = thingOf(c);
    // already there: the existing WC or basin listed again, a piece with the id or name of an existing one
    if (f.existing.some((x) => x.label === id || x.f.id === id || key(x.f.name) === key(label)) || ((SANITARY.has(t.shape) || isKitchenModule(c)) && existingShapes.has(t.shape)) || /\(bestand\)|\bbestand\b|vorhanden/i.test(label)) {
      notes.push(`Teil „${id}“ (${c.name}) ist schon da (Bestand), nicht noch einmal aufgenommen.`);
      const same = f.existing.find((x) => x.label === id || x.f.id === id || shapeOf(x.f) === t.shape);
      if (same) duplicateOf.set(id, same.label);
      else leftOut.add(id);
      continue;
    }
    if (isKitchenModule(c)) {
      problems.push(`Teil „${id}“: Küchenmodule (${catalogId}) gehören in "kitchen", nicht in "items".`);
      leftOut.add(id);
      continue;
    }
    if (SANITARY.has(t.shape) && !(t.shape === 'washbasin' && handBasin && !items.some((x) => shapeOf(lookup(x.catalogId)!) === 'washbasin'))) {
      problems.push(`Teil „${id}“ (${c.name}): Sanitärobjekte sind fest eingebaut und werden nicht dazugeplant${t.shape === 'washbasin' ? ' (ein Handwaschbecken nur im WC ohne Becken)' : ''}.`);
      leftOut.add(id);
      continue;
    }
    if (things.has(id)) {
      notes.push(`Teil-id „${id}“ doppelt, umbenannt.`);
      id = `${id}_${items.length + 1}`;
    }
    let zone = str(e.zone, 40);
    if (!zones.some((z) => z.id === zone)) {
      if (zones.length) problems.push(`Teil „${id}“: Zone „${zone}“ gibt es nicht (Zonen: ${zones.map((z) => z.id).join(', ')}).`);
      zone = zones[0]?.id ?? zone;
    }
    const x = num(e.x);
    const y = num(e.y);
    const side = parseSide(str(e.facing, 10));
    let hint: ProgramItem['hint'];
    if (x === null || y === null) problems.push(`Teil „${id}“: Startplatz x, y fehlt.`);
    else if (!inRoom(room, x, y, 20)) problems.push(`Teil „${id}“ bei (${x},${y}) liegt außerhalb des Raums (Innenmaß ${cm(room.size.x)} × ${cm(room.size.y)} cm).`);
    else if (!side) problems.push(`Teil „${id}“: Blickrichtung „${str(e.facing, 10)}“ ist keine Himmelsrichtung (N, O, S, W).`);
    else hint = { ...f.P(x, y), rotation: rotationForSide(side) };
    const color = hex(e.color);
    const fallbacks = strList(e.fallbacks, 120, 4).filter((id2) => {
      const fc = lookup(id2);
      return !!fc && fc.category === c.category && !isKitchenModule(fc);
    });
    const item: ProgramItem = { id, catalogId: c.id, zone, ...(hint ? { hint } : {}), ...(label ? { label } : {}), ...(color ? { color } : {}), why: str(e.why, 500), ...(fallbacks.length ? { fallbacks } : {}), ...(e.anchor === true || e.required === true ? { required: true } : {}) };
    items.push(item);
    things.set(id, { thing: t, ...(hint ? { hint } : {}) });
  }
  if (items.length > MAX_ITEMS) problems.push(`${items.length} Teile sind zu viele für einen Raum – auf das Wesentliche kürzen (höchstens ${MAX_ITEMS}).`);
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.catalogId, (counts.get(it.catalogId) ?? 0) + 1);
  for (const [id, n] of counts) if (n > MAX_SAME) problems.push(`${n}× ${lookup(id)?.name ?? id} ist zu viel.`);

  // what the room must have; the first piece that gives it is required
  const pieces = items.map((it) => ({ it, t: things.get(it.id)!.thing }));
  for (const need of roomNeeds(f.rc, room.area)) {
    if (f.all.some((e) => need.has(thingOfFurniture(e)))) continue;
    const hit = pieces.find((p) => need.has(p.t));
    if (hit) hit.it.required = true;
    else problems.push(`Es fehlt: ${need.label} (Raumtyp ${f.rc.type}${f.rc.functions.length ? `, Funktionen ${f.rc.functions.join(', ')}` : ''}).`);
  }
  // functions the concept gave other rooms
  const nameOf = (id: string) => input.project.rooms.find((r) => r.id === id)?.name ?? id;
  const dining = input.concept.functions.find((a) => isDining(a.function) && a.roomId !== room.roomId);
  if (dining && !f.rc.functions.some(isDining) && f.rc.type !== 'balcony') {
    for (const p of pieces) if (diningTable(p.t) && p.t.shape !== 'desk') problems.push(`Teil „${p.it.id}“ ist ein Esstisch – Essen ist laut Wohnkonzept in „${nameOf(dining.roomId)}“.`);
  }
  const guest = input.concept.functions.find((a) => isGuestBed(a.function) && a.roomId !== room.roomId);
  if (guest && !f.rc.functions.some(isGuestBed)) {
    for (const p of pieces) if (looksLikeGuestBed(p.t, p.it.label ?? '', f.rc.type)) problems.push(`Teil „${p.it.id}“ ist ein Gästeschlafplatz – der ist laut Wohnkonzept in „${nameOf(guest.roomId)}“.`);
  }

  // relations; existing pieces as targets under their label, also when Claude made up a name („basin-existing“)
  const existingPlaces = new Map(f.existing.map(({ label, f: e }) => [label, { x: e.x, y: e.y, width: e.width, depth: e.depth, rotation: e.rotation }] as const));
  const resolve = (v: unknown): unknown => {
    const s = str(v, 60);
    if (!s || things.has(s) || /^[WFTE]\d+$/i.test(s)) return v;
    if (duplicateOf.has(s)) return duplicateOf.get(s);
    const hit = f.existing.find((x) => x.label === s.toUpperCase() || x.f.id === s) ?? f.existing.find((x) => ALIASES.some(([re, shape]) => re.test(s) && shapeOf(x.f) === shape));
    return hit ? hit.label : v;
  };
  const rawRelations = (Array.isArray(o.relations) ? o.relations : []).filter((r) => !(Array.isArray(r) && (leftOut.has(str(r[0], 40)) || duplicateOf.has(str(r[0], 40)) || leftOut.has(str(r[2], 40))))).map((r) => (Array.isArray(r) ? r.map((v, i) => (i >= 2 ? resolve(v) : v)) : r));
  const rel = parseRelations(rawRelations, { items: things, walls: room.walls, existing: existingPlaces, zones: new Set(zones.map((z) => z.id)), origin: room.origin, loose: new Set(['room', 'raum', 'kitchen', 'küche', 'küchenzeile', ...input.project.rooms.map((r) => key(r.name))]) });
  problems.push(...rel.problems);
  notes.push(...rel.notes);

  // kitchen
  const kitchen = parseKitchen(o.kitchen, f, problems, notes);
  if (plansKitchen(f.rc, f.all) && !kitchen?.length) problems.push('Hier wird gekocht, aber "kitchen" fehlt: die Küchenzeile mit Wand, von, bis und Modulen planen.');
  if (kitchen?.length) {
    const mods = kitchen.flatMap((k) => k.modules.map((m) => lookup(m) ?? findCatalogItem(m)!));
    for (const [type, label] of [['sink', 'Spüle'], ['fridge', 'Kühlschrank']] as const) if (!mods.some((m) => m.kitchen?.type === type)) problems.push(`Die Küchenzeile hat keine ${label}.`);
  }

  const parsed: RoomProgram = {
    roomId: room.roomId,
    reading: str(o.reading, 1200),
    zones,
    items,
    relations: rel.relations,
    ...(kitchen?.length ? { kitchen } : {}),
    walk: str(o.walk, 1200),
    check: strList(o.check, 300, 30),
  };
  // every furniture group complete and bound as a designer plans it (Sitzgruppe, Schlafplatz …)
  const groups = completeGroups(parsed, f.rc.type, room.area, f.rc.functions.length, input.products);
  notes.push(...groups.notes);
  return { value: groups.program, problems, notes };
}

const thingOfFurniture = (f: Furniture): Thing => ({ category: f.category, shape: shapeOf(f), height: f.height, width: f.width, depth: f.depth, name: f.name });

function parseKitchen(raw: unknown, f: ProgramFacts, problems: string[], notes: string[]): KitchenRun[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const runs = Array.isArray(raw) ? raw : [raw];
  if (!plansKitchen(f.rc, f.all)) {
    if (runs.length) {
      if (f.all.some((e) => !!e.kitchen)) notes.push('Küchenzeile ist vorhanden, "kitchen" nicht übernommen.');
      else problems.push('"kitchen": hier wird laut Wohnkonzept nicht gekocht – keine Küchenzeile planen.');
    }
    return undefined;
  }
  const out: KitchenRun[] = [];
  for (const k of runs) {
    const e = (k ?? {}) as Record<string, unknown>;
    const wall = f.room.walls.find((w) => w.id === str(e.wall, 10).toUpperCase());
    if (!wall) {
      problems.push(`"kitchen": Wand „${str(e.wall, 10)}“ gibt es nicht (Wände: ${f.room.walls.map((w) => w.id).join(', ')}).`);
      continue;
    }
    const listed = strList(e.modules, 60, 20);
    const modules = listed.filter((m) => !ADDED_BY_APP.includes(m));
    if (modules.length < listed.length) notes.push(`"kitchen": Oberschränke, Kochfeld und Haube setzt die App, aus der Modulliste genommen.`);
    const bad = modules.filter((m) => !KITCHEN_MODULES.some((c) => c.id === m));
    if (bad.length) problems.push(`"kitchen": ${bad.map((b) => `„${b}“`).join(', ')} ist kein Küchenmodul.`);
    const good = modules.filter((m) => !bad.includes(m));
    if (!good.length) continue;
    // from/to as points on the wall: project onto it, keep the order Claude gave
    const onWall = (v: unknown, fallback: number): Vec2 => {
      const p = Array.isArray(v) ? v.map(num) : [];
      const t = p.length === 2 && p[0] !== null && p[1] !== null ? dot(sub(f.P(p[0], p[1]), wall.a), wall.dir) : fallback;
      return add(wall.a, scale(wall.dir, Math.max(0, Math.min(wall.length, t))));
    };
    const from = onWall(e.from, 0);
    const to = onWall(e.to, wall.length);
    const width = good.reduce((s, m) => s + (findCatalogItem(m)?.width ?? 0), 0);
    const room = Math.hypot(to.x - from.x, to.y - from.y);
    if (width > room + 0.05) problems.push(`"kitchen" an ${wall.id}: die Module sind ${cm(width)} cm breit, von–bis sind nur ${cm(room)} cm.`);
    out.push({ wall: wall.id, from, to, modules: good });
  }
  return out;
}

/** Room types asked with the strongest model when thorough: main rooms; small rooms go to Sonnet. */
const MAIN_TYPES: RoomType[] = ['living', 'bedroom', 'kids', 'kitchen', 'dining', 'office'];

/** Model for a room programme (#436 stage 2): thorough = Opus for main and pass-through rooms, Sonnet for small ones; fast = Sonnet. */
export function programModel(rc: Pick<RoomConcept, 'type'>, room: Pick<RoomAnalysis, 'passThrough' | 'area'>, quality: DesignWishes['quality']): 'opus' | 'sonnet' {
  if (quality === 'fast') return 'sonnet';
  return MAIN_TYPES.includes(rc.type) || (room.passThrough && rc.type !== 'hall' && room.area >= 8) ? 'opus' : 'sonnet';
}
