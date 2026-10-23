/**
 * Interior-design rules per room type for the Claude furnishing proposal (#350).
 *
 * The first version left everything to one short prompt and got rooms that looked thrown
 * together: no washbasin in the bath, loose boxes on the floor of the storeroom, a lamp in the
 * middle of the hall, no decor anywhere. Now every room type has
 * - a guide for the prompt (purpose, zones, focal point, walkways, decor – how an interior
 *   designer thinks about the room) and a short example of a good room;
 * - essentials: what the room needs to work; if Claude leaves one out, the planner adds a
 *   placeholder (unless the room already has it);
 * - misfits: items that do not belong there (they are left out with a reason).
 * `completeRoom` applies essentials and misfits to Claude's picks; `src/suggest/furnishing.ts`
 * places everything by the same room-type rules (back to the wall, walkway, curtain at the
 * window, picture above the sofa …).
 */
import { findCatalogItem } from '../catalog/generic';
import type { CatalogItem } from '../catalog/types';
import type { Furniture } from '../model/schema';
import type { RoomType } from '../suggest/furnishing';

type Thing = Pick<CatalogItem, 'name' | 'category' | 'model' | 'height' | 'width' | 'depth'> & { elevation?: number };

const shapeOf = (f: Pick<CatalogItem, 'model'>) => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);
const is = (...shapes: string[]) => (f: Thing) => shapes.includes(shapeOf(f));
const isWallArt = (f: Thing) => ['picture', 'wall-shelf'].includes(shapeOf(f)) || (f.category === 'decor' && /bild|poster|wandbild|leinwand|wandregal/i.test(f.name));

interface Essential {
  /** What is missing, for the note („Waschtisch ergänzt“). */
  label: string;
  has: (f: Thing) => boolean;
  /** Placeholder that is added. */
  add: string;
  quantity?: number;
  /** Only from this floor area (m²) on. */
  minArea?: number;
  /** Only when the room has a window. */
  needsWindow?: boolean;
}

interface Misfit {
  test: (f: Thing) => boolean;
  why: string;
}

interface Guide {
  /** Rules for the prompt (one line each). */
  rules: string[];
  /** A short example of a good room of this type. */
  example: string;
  essentials: Essential[];
  misfits: Misfit[];
}

const LOOSE_BOX: Misfit = { test: (f) => shapeOf(f) === 'box' && f.category === 'storage' && f.height <= 0.45, why: 'lose Kisten am Boden wirken unordentlich – Boxen gehören ins Regal' };

export const GUIDES: Record<RoomType, Guide> = {
  living: {
    rules: [
      'Zonen: Sitzgruppe (Sofa an einer geschlossenen Wand, Couchtisch davor, Sessel seitlich zugewandt, Teppich verbindet), gegenüber der Blickfang (TV-Lowboard mit Fernseher oder Regal/Kamin); bei genug Fläche (ab ca. 20 m²) ein Essplatz als eigene Zone.',
      'Licht in drei Ebenen: Stehlampe neben dem Sofa, Tischlampe auf Sideboard/Regal, Pendelleuchte über dem Esstisch.',
      'Laufweg von der Tür zum Fenster und zum Sitzplatz mindestens 80 cm frei; nichts quer in die Raummitte stellen, was nicht zur Sitzgruppe gehört.',
      'Wanddeko: mindestens ein großes Bild über dem Sofa (oder zwei kleine), dazu Pflanzen; Vorhänge an den Fenstern.',
    ],
    example: 'Beispiel 18 m²: Sofa 3-Sitzer an der Längswand, Couchtisch, Teppich 200×300, Sessel, TV-Lowboard + TV gegenüber, Stehlampe, Wandbild über dem Sofa, große Pflanze in der Ecke, Vorhang am Fenster.',
    essentials: [
      { label: 'Sofa', has: is('sofa', 'sofa-corner'), add: 'generic-sofa-3' },
      { label: 'Couchtisch', has: (f) => f.category === 'table' && f.height < 0.6, add: 'generic-coffee-table' },
      { label: 'Stehlampe', has: (f) => f.category === 'lighting', add: 'generic-floor-lamp' },
      { label: 'Teppich', has: is('rug'), add: 'generic-rug-200', minArea: 12 },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-picture-large' },
    ],
    misfits: [LOOSE_BOX, { test: is('bed'), why: 'ein Bett gehört ins Schlafzimmer' }],
  },
  bedroom: {
    rules: [
      'Bett mit dem Kopfteil an eine geschlossene Wand (nicht unters Fenster, nicht neben die Tür), beidseitig Nachttische mit Leselampen, vor dem Bett mindestens 70 cm frei.',
      'Kleiderschrank an eine freie Wand, vor den Türen 80 cm frei; Kommode optional.',
      'Ein Bettgestell ohne Matratze braucht eine Matratze (Platzhalter „generic-mattress“).',
      'Schreibtisch nur, wenn gewünscht, dann an die Wand (am besten seitlich zum Fenster), nie frei in der Raummitte.',
      'Ruhige Farben; Bild über dem Bett, Vorhang (blickdicht) am Fenster, eine Pflanze.',
    ],
    example: 'Beispiel 13 m²: Doppelbett 160×200 an der Wand gegenüber dem Fenster, zwei Nachttische mit Tischlampen, Kleiderschrank 150 cm an der Seitenwand, Teppich am Bettende, Bild über dem Bett, Vorhang.',
    essentials: [
      { label: 'Bett', has: (f) => f.category === 'bed' && shapeOf(f) === 'bed', add: 'generic-bed-160' },
      { label: 'Nachttisch', has: (f) => f.category === 'bed' && shapeOf(f) !== 'bed', add: 'generic-nightstand', quantity: 2 },
      { label: 'Kleiderschrank', has: is('wardrobe'), add: 'generic-wardrobe-150' },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-picture' },
      { label: 'Vorhang', has: is('curtain'), add: 'generic-curtain', needsWindow: true },
    ],
    misfits: [LOOSE_BOX, { test: is('tv'), why: 'kein Fernseher im Schlafzimmer, außer ausdrücklich gewünscht' }],
  },
  kids: {
    rules: ['Bett an die Wand, Spielfläche frei in der Mitte, Schreibtisch am Fenster, Stauraum in Kinderhöhe, weicher Teppich, fröhliche Wanddeko.'],
    example: 'Beispiel 11 m²: Einzelbett 90×200 an der Wand, Schreibtisch 100 cm am Fenster mit Bürostuhl, Würfelregal mit Boxen, Kleiderschrank 100 cm, Teppich in der Mitte, zwei Bilder.',
    essentials: [
      { label: 'Bett', has: (f) => f.category === 'bed' && shapeOf(f) === 'bed', add: 'generic-bed-90' },
      { label: 'Kleiderschrank', has: is('wardrobe'), add: 'generic-wardrobe-100' },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-picture' },
    ],
    misfits: [],
  },
  office: {
    rules: ['Schreibtisch an die Wand mit Tageslicht von der Seite (Fenster links oder vorne), Bürostuhl dazu, Regal in Griffweite, gutes Licht (Steh- oder Schreibtischlampe), eine Pflanze, ein Bild oder Wandregal.'],
    example: 'Beispiel 9 m²: Schreibtisch 140×70 am Fenster, Bürostuhl, zwei Regale 80 cm an der Seitenwand, Stehlampe, Wandregal über dem Schreibtisch, Pflanze.',
    essentials: [
      { label: 'Schreibtisch', has: (f) => f.category === 'desk', add: 'generic-desk' },
      { label: 'Bürostuhl', has: is('office-chair'), add: 'generic-office-chair' },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-wall-shelf' },
    ],
    misfits: [LOOSE_BOX],
  },
  dining: {
    rules: ['Esstisch mittig mit 80–90 cm Platz rundum für die Stühle, Pendelleuchte darüber, Sideboard an der Wand, Bild an der Wand.'],
    example: 'Beispiel 12 m²: Esstisch für 6 mit 6 Stühlen, Pendelleuchte, Sideboard an der Längswand, großes Wandbild darüber.',
    essentials: [
      { label: 'Esstisch', has: (f) => f.category === 'table' && f.height >= 0.6, add: 'generic-dining-table-4' },
      { label: 'Stühle', has: (f) => f.category === 'chair', add: 'generic-chair', quantity: 4 },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-picture-large' },
    ],
    misfits: [LOOSE_BOX],
  },
  kitchen: {
    rules: ['Küchenzeile wie unten beschrieben; bei Platz ein kleiner Esstisch mit Stühlen, der den Arbeitsbereich nicht zustellt.'],
    example: 'Beispiel Wohnküche 12 m²: Küchenzeile an der langen Wand, Esstisch für 4 mit Stühlen am Fenster, Pendelleuchte darüber.',
    essentials: [],
    misfits: [LOOSE_BOX],
  },
  bath: {
    rules: [
      'Pflicht: Waschtisch mit Spiegel darüber (Badspiegel), WC und Dusche/Badewanne – nur wenn sie nicht schon im Raum stehen (die Liste der Möbel im Raum ist maßgeblich).',
      'Waschmaschine, wenn Platz ist und keine andere Stelle vorgesehen; schmaler Hochschrank für Handtücher; Badematte vor dem Waschtisch.',
      'Türaufschlag frei halten, vor WC und Waschtisch je 60 cm frei. Keine Kisten am Boden, keine Wohnmöbel.',
    ],
    example: 'Beispiel 5 m²: Waschtisch 60 cm mit Badspiegel darüber, WC, Dusche 90×90 in der Ecke, Waschmaschine, Bad-Hochschrank, Badematte.',
    essentials: [
      { label: 'Waschtisch', has: is('washbasin'), add: 'generic-washbasin' },
      { label: 'Spiegel', has: (f) => is('panel')(f) || /spiegel/i.test(f.name), add: 'generic-bath-mirror' },
      { label: 'WC', has: is('toilet'), add: 'generic-toilet' },
      { label: 'Dusche oder Badewanne', has: is('shower', 'bathtub'), add: 'generic-shower', minArea: 3 },
      { label: 'Waschmaschine', has: is('washer'), add: 'generic-washer', minArea: 4.5 },
    ],
    misfits: [LOOSE_BOX, { test: (f) => ['sofa', 'bed', 'desk', 'table'].includes(f.category), why: 'gehört nicht ins Bad' }],
  },
  hall: {
    rules: [
      'Der Gang ist ein Durchgang: mindestens 90 cm Laufweg frei, nur flache Möbel (Tiefe bis ca. 40 cm).',
      'Pflicht: Schuhschrank oder schmale Kommode, Wandgarderobe mit Haken nahe der Eingangstür, ein großer Spiegel.',
      'Licht an der Decke statt Stehlampen im Weg; Bilder an der langen Wand; kein großer Kleiderschrank, wenn der Gang schmal ist.',
    ],
    example: 'Beispiel Gang 1,4 × 4 m: Schuhschrank 80×30 cm, Wandgarderobe mit Haken neben der Tür, Wandspiegel, zwei Bilder, Läufer.',
    essentials: [
      { label: 'Kommode/Schuhschrank', has: (f) => is('cabinet', 'dresser')(f) && f.category === 'storage', add: 'generic-shoe-cabinet' },
      { label: 'Garderobe', has: (f) => is('coat-rack')(f) || /garderobe/i.test(f.name), add: 'generic-coat-rack' },
      { label: 'Spiegel', has: (f) => is('panel')(f) || /spiegel/i.test(f.name), add: 'generic-mirror' },
      { label: 'Wanddeko', has: isWallArt, add: 'generic-picture' },
    ],
    misfits: [
      LOOSE_BOX,
      { test: is('floor-lamp'), why: 'eine Stehlampe steht im Gang im Weg – dort besser Deckenlicht' },
      { test: (f) => ['sofa', 'bed'].includes(f.category) || shapeOf(f) === 'armchair', why: 'gehört nicht in den Gang' },
    ],
  },
  utility: {
    rules: [
      'Abstellraum: Lagerregale an den Wänden (tief genug für Kisten), Kisten/Boxen kommen in die Regale, nie lose auf den Boden.',
      'Ein Platz für Staubsauger, Besen und Bügelbrett: Putzschrank oder Akku-Staubsauger mit Wandhalter; Mitte frei zum Hineingehen.',
      'Keine Wohnmöbel, keine Deko, keine Teppiche.',
    ],
    example: 'Beispiel 2 m²: zwei Lagerregale 90×45 cm mit Boxen, Putzschrank für Besen und Staubsauger.',
    essentials: [
      { label: 'Regal', has: (f) => is('shelf')(f) && f.category === 'storage', add: 'generic-utility-shelf', quantity: 2 },
      { label: 'Platz für Staubsauger und Besen', has: (f) => is('vacuum')(f) || /putz|besen|staubsauger/i.test(f.name), add: 'generic-broom-cabinet' },
    ],
    misfits: [
      { test: (f) => ['sofa', 'bed', 'textile', 'desk', 'lighting'].includes(f.category) || isWallArt(f) || shapeOf(f) === 'plant', why: 'gehört nicht in den Abstellraum' },
    ],
  },
  balcony: {
    rules: [
      'Balkon/Terrasse: nur wetterfeste Outdoor-Möbel – klappbarer Balkontisch mit zwei Balkonstühlen (oder Loungesessel), Pflanzkübel, Outdoor-Teppich.',
      'Balkontür und ein Gang zur Brüstung frei lassen. Keine Innenmöbel, keine Kisten, keine Stehlampe.',
    ],
    example: 'Beispiel Balkon 4 m²: Balkontisch Ø 60 klappbar, zwei Balkonstühle, zwei Pflanzkübel in den Ecken, Outdoor-Teppich.',
    essentials: [
      { label: 'Balkontisch', has: (f) => f.category === 'table', add: 'generic-balcony-table' },
      { label: 'Sitzplatz', has: (f) => f.category === 'chair' || shapeOf(f) === 'armchair', add: 'generic-balcony-chair', quantity: 2 },
      { label: 'Pflanzen', has: is('plant'), add: 'generic-planter', quantity: 2 },
    ],
    misfits: [
      LOOSE_BOX,
      { test: (f) => ['bed', 'desk'].includes(f.category) || ['wardrobe', 'shelf', 'cabinet', 'dresser', 'floor-lamp', 'table-lamp', 'tv', 'sofa', 'sofa-corner', 'picture', 'curtain'].includes(shapeOf(f)), why: 'kein Möbel für draußen' },
    ],
  },
  other: { rules: ['Zweck aus dem Raumnamen ableiten; lieber wenige, passende Möbel an den Wänden, Mitte frei.'], example: '', essentials: [], misfits: [LOOSE_BOX] },
};

/** Prompt part with the guide of one room type. */
export function guidePrompt(type: RoomType): string[] {
  const g = GUIDES[type];
  return [...g.rules.map((r) => `- ${r}`), ...(g.example ? [`- ${g.example}`] : [])];
}

export interface RoomFix {
  kind: 'added' | 'removed';
  name: string;
  why: string;
}

export interface CompleteInput {
  type: RoomType;
  /** catalogIds with quantity, as Claude picked them. */
  picks: { catalogId: string; quantity: number; placeholder: boolean }[];
  /** Furniture already standing in the room (kept). */
  existing: Pick<Furniture, 'name' | 'category' | 'model' | 'height' | 'width' | 'depth' | 'elevation'>[];
  area: number;
  hasWindow: boolean;
  lookup: (id: string) => CatalogItem | undefined;
}

export interface CompleteResult {
  /** Indices of picks to drop. */
  drop: number[];
  /** Placeholders to add. */
  add: { catalogId: string; quantity: number; why: string }[];
  fixes: RoomFix[];
}

const MATTRESS_IN_NAME = /matratze|boxspring|polsterbett mit|inkl\.? matratze|wasserbett/i;

/**
 * Planner check after Claude's answer (#350): misfits are dropped, missing essentials added as
 * placeholders, a bed frame (imported model) gets a mattress. Pure; the caller changes the proposal.
 */
export function completeRoom(input: CompleteInput): CompleteResult {
  const g = GUIDES[input.type];
  const drop: number[] = [];
  const fixes: RoomFix[] = [];
  const kept: Thing[] = [...input.existing];
  input.picks.forEach((p, i) => {
    const c = input.lookup(p.catalogId);
    if (!c) return;
    const misfit = g.misfits.find((m) => m.test(c));
    if (misfit) {
      drop.push(i);
      fixes.push({ kind: 'removed', name: c.name, why: misfit.why });
    } else kept.push(c);
  });
  const add: CompleteResult['add'] = [];
  for (const e of g.essentials) {
    if (e.minArea && input.area < e.minArea) continue;
    if (e.needsWindow && !input.hasWindow) continue;
    if (kept.some(e.has)) continue;
    const item = findCatalogItem(e.add);
    if (!item) continue;
    const why = `${e.label} gehört in ${ROOM_LABEL[input.type]} – vom Planer ergänzt`;
    add.push({ catalogId: e.add, quantity: e.quantity ?? 1, why });
    fixes.push({ kind: 'added', name: item.name, why });
  }
  // a bed frame from a retailer comes without mattress: the 3D model shows the bare slats (also while the .glb is not attached yet: imported products start procedural, the model comes later)
  const beds = input.picks.filter((_, i) => !drop.includes(i)).map((p) => ({ p, c: input.lookup(p.catalogId) })).filter((x) => x.c && x.c.category === 'bed' && shapeOf(x.c) === 'bed' && (x.c.model.type === 'gltf' || !x.c.id.startsWith('generic-')) && !MATTRESS_IN_NAME.test(x.c.name));
  const mattresses = kept.filter((f) => shapeOf(f) === 'mattress' || /matratze/i.test(f.name)).length;
  const frames = beds.reduce((n, b) => n + b.p.quantity, 0);
  if (frames > mattresses) {
    const why = 'das Bettgestell kommt ohne Matratze – vom Planer ergänzt';
    add.push({ catalogId: 'generic-mattress', quantity: frames - mattresses, why });
    fixes.push({ kind: 'added', name: 'Matratze', why });
  }
  return { drop, add, fixes };
}

const ROOM_LABEL: Record<RoomType, string> = {
  living: 'ein Wohnzimmer',
  bedroom: 'ein Schlafzimmer',
  kids: 'ein Kinderzimmer',
  office: 'ein Arbeitszimmer',
  dining: 'ein Esszimmer',
  kitchen: 'eine Küche',
  bath: 'ein Bad',
  hall: 'einen Gang',
  utility: 'einen Abstellraum',
  balcony: 'einen Balkon',
  other: 'diesen Raum',
};

/**
 * Dimensions that cannot be the whole product (#350): an office chair 45 cm high (seat height),
 * a desk 4 cm high (top only), a bed 1 m long. Such a product would stand squashed or flat in
 * the room, so it is not offered to Claude; returns why, or null when plausible.
 */
export function implausibleSize(c: Pick<CatalogItem, 'name' | 'category' | 'model' | 'width' | 'depth' | 'height'>): string | null {
  const shape = shapeOf(c);
  const h = c.height;
  const long = Math.max(c.width, c.depth);
  if (shape === 'office-chair' && h < 0.8) return 'Bürostuhl niedriger als 80 cm (wohl nur die Sitzhöhe)';
  if (shape === 'chair' && h < 0.6) return 'Stuhl niedriger als 60 cm (wohl nur die Sitzhöhe)';
  if ((shape === 'desk' || c.category === 'desk') && h < 0.55) return 'Schreibtisch niedriger als 55 cm (wohl nur die Platte)';
  if (c.category === 'table' && h < 0.2) return 'Tisch niedriger als 20 cm (wohl nur die Platte)';
  if (shape === 'bed' && c.category === 'bed' && long < 1.8) return 'Bett kürzer als 1,8 m';
  if (shape === 'wardrobe' && h < 1.2) return 'Kleiderschrank niedriger als 1,2 m';
  if ((shape === 'sofa' || shape === 'sofa-corner') && h < 0.45) return 'Sofa niedriger als 45 cm';
  return null;
}
