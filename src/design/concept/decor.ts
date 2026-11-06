/**
 * Wall decoration and plants as a designer adds them at the end (mgritsch04/wohnungsplaner-3d#436):
 * a room is not finished with furniture alone. `completeDecor` hangs a picture over the sofa, the
 * bed and a sideboard, a mirror in the hall and at the wardrobe, a still life of three (vase, books,
 * bowl) on a sideboard, chest or lowboard, and gives a room that is lived in one large plant. Few good pieces rather than many (SL6): every room has a budget, what Claude
 * already planned counts against it. Pictures take the accent colour of the palette (SL2); sizes
 * follow the piece below (R7: about two thirds of its width, lower edge 15–25 cm above it).
 * Soft furnishings and table decoration (G 6.11.: „Deko fehlt“): scatter cushions and a throw on the sofa,
 * cushions and a plaid on the bed, a vase on the dining table, candles on the coffee table, a desk set,
 * herbs on the kitchen window sill, a fruit bowl, a towel rail in the bath, a clock in the kitchen.
 * Everything added is named in the notes and carries the rule id in its reason.
 */
import type { CatalogItem } from '../../catalog/types';
import { shapeOf } from '../../suggest/roomGeometry';
import type { ProgramItem, RoomProgram, RoomType } from '../types';
import { add, lookup, makeCtx, roleOfItem, type Ctx } from './groups';

/** Pictures a room gets at most (planned ones included): living rooms 3, halls 2, others 1–2. */
const PICTURE_BUDGET: Partial<Record<RoomType, number>> = { living: 3, bedroom: 2, kids: 2, office: 1, dining: 1, hall: 2, other: 1 };
/** Rooms that get a large plant when they have none. */
const PLANT_ROOMS: RoomType[] = ['living', 'bedroom', 'office', 'dining', 'kids'];
/** Smallest floor area (m²) for a plant of one's own. */
const PLANT_MIN_AREA = 10;
/** Picture widths in the catalogue, narrow to wide. */
const PICTURES = ['generic-picture', 'generic-picture-large', 'generic-picture-xl', 'generic-picture-wide'];
/** Rooms whose sideboards, chests and lowboards get a still life when nothing but a lamp stands on them. */
const STILL_LIFE_ROOMS: RoomType[] = ['living', 'bedroom', 'kids', 'office', 'dining', 'other'];
/** Lower edge of a picture above a piece: this much above its top (R7). */
const HANG_GAP = 0.2;
/** Rooms that get soft furnishings and table decoration (the picture and plant rooms and kitchen and bath). */
const SOFT_ROOMS: RoomType[] = ['living', 'bedroom', 'kids', 'office', 'dining', 'kitchen', 'bath', 'hall', 'other'];

export interface DecorOptions {
  /** Textile colour of the room scheme (throws, plaid, towels). */
  textile?: string;
  /** Windows of the room: herbs need a sill. */
  windows?: { id: string }[];
  /** `basic` keeps to pictures, mirror and plant (budget tier „günstig“); `full` adds soft furnishings and table decoration. */
  level?: 'basic' | 'full';
}

const shapeOfProgramItem = (c: Ctx, i: ProgramItem): string => {
  const item = lookup(c, i.catalogId);
  return item ? shapeOf(item) : '';
};
const isPicture = (c: Ctx, i: ProgramItem) => ['picture', 'picture-set'].includes(shapeOfProgramItem(c, i));
/** A mirror of any kind: hung (role `mirror`) or the full-length one that leans on the floor. */
const isMirror = (c: Ctx, i: ProgramItem) => shapeOfProgramItem(c, i) === 'panel' && /spiegel/i.test(lookup(c, i.catalogId)?.name ?? '');

/** The picture whose width is closest to two thirds of `width`, never wider than 90 % of it (R7). */
export function pictureFor(width: number): string | null {
  const cand = PICTURES.map((id) => ({ id, w: PICTURE_WIDTH[id] })).filter((p) => p.w <= width * 0.9);
  if (!cand.length) return null;
  return cand.sort((a, b) => Math.abs(a.w - (2 * width) / 3) - Math.abs(b.w - (2 * width) / 3))[0].id;
}
const PICTURE_WIDTH: Record<string, number> = { 'generic-picture': 0.5, 'generic-picture-large': 1.0, 'generic-picture-xl': 1.2, 'generic-picture-wide': 1.4 };

export function completeDecor(program: RoomProgram, type: RoomType, area: number, products: CatalogItem[] = [], accent?: string, opts: DecorOptions = {}): { program: RoomProgram; notes: string[] } {
  const budget = PICTURE_BUDGET[type];
  const level = opts.level ?? 'full';
  if (budget === undefined && !PLANT_ROOMS.includes(type) && !(level === 'full' && SOFT_ROOMS.includes(type))) return { program, notes: [] };
  const c = makeCtx(program, products);
  let pictures = c.items.filter((i) => isPicture(c, i)).length;
  const hangs = (id: string) => c.relations.some((r) => r.kind === 'above' && r.target === id && c.items.some((i) => i.id === r.item && (isPicture(c, i) || isMirror(c, i))));
  const free = () => (budget ?? 0) - pictures;
  const colour = accent ? { color: accent } : {};

  // above a piece: picture of two thirds its width, lower edge 20 cm over its top (R7, S6)
  const hangOver = (anchor: ProgramItem, rule: string, what: string): void => {
    if (free() <= 0 || hangs(anchor.id)) return;
    const item = lookup(c, anchor.catalogId);
    if (!item) return;
    const id = pictureFor(item.width);
    if (!id) return;
    const smaller = PICTURES.slice(0, PICTURES.indexOf(id)).reverse();
    const pic = add(c, anchor, 'Wanddeko', id, `${anchor.id}_bild`, `Wanddeko: Bild mittig über ${what}, etwa zwei Drittel von dessen Breite, Unterkante 15–25 cm darüber (${rule}).`, { fallbacks: smaller, ...colour });
    if (!pic) return;
    c.relations.push({ kind: 'above', item: pic.id, target: anchor.id, height: Math.round(((item.elevation ?? 0) + item.height + HANG_GAP) * 100) / 100 });
    pictures++;
  };

  const withRole = (roles: string[]) => c.items.filter((i) => roles.includes(roleOfItem(c, i) ?? ''));
  // over the headboard first (S6), then over the sofa, then over a sideboard or chest of drawers (R7)
  if (type !== 'hall') {
    for (const b of withRole(['bed'])) hangOver(b, 'S6', 'dem Kopfteil');
    for (const s of withRole(['sofa'])) if (type === 'living' || type === 'other' || area >= 12) hangOver(s, 'R7', 'dem Sofa');
    for (const s of c.items.filter((i) => ['cabinet', 'dresser'].includes(shapeOfProgramItem(c, i)) && lookup(c, i.catalogId)?.category === 'storage' && (lookup(c, i.catalogId)?.height ?? 9) <= 1.1 && roleOfItem(c, i) !== 'tv-board' && !c.relations.some((r) => r.kind === 'above' && r.target === i.id)))
      if ((lookup(c, s.catalogId)?.width ?? 0) >= 0.8 && !c.relations.some((r) => r.kind === 'on' && r.target === s.id && roleOfItem(c, c.items.find((i) => i.id === r.item) ?? s) === 'tv')) hangOver(s, 'R7', 'dem Sideboard');
  }

  // a still life of three heights on a sideboard, chest or lowboard (SL6); a narrow piece with a lamp
  // is full already, a still life beside the lamp would crowd the picture above it (image review)
  if (STILL_LIFE_ROOMS.includes(type)) {
    for (const s of [...c.items]) {
      const item = lookup(c, s.catalogId);
      const role = roleOfItem(c, s);
      const chest = role === 'wall' && item?.category === 'storage' && ['cabinet', 'dresser'].includes(shapeOfProgramItem(c, s)) && item.height <= 1.1;
      if (!item || !(chest || role === 'tv-board')) continue;
      const on = c.relations.flatMap((r) => (r.kind === 'on' && r.target === s.id ? [c.items.find((i) => i.id === r.item)] : []));
      const onlyLamps = on.every((i) => i && roleOfItem(c, i) === 'table-lamp');
      if (!onlyLamps || (on.length > 0 && item.width < 1.2)) continue;
      const set = add(c, s, 'Wanddeko', 'generic-decor-set', `${s.id}_deko`, 'Deko: Vase, Bücher und Schale als Dreiergruppe in verschiedenen Höhen auf der Ablage (SL6).', { fallbacks: [] });
      if (set) c.relations.push({ kind: 'on', item: set.id, target: s.id });
    }
  }

  // mirror: in the hall a last look when leaving (ST3), in a bedroom at the wardrobe to dress (S7)
  if (!c.items.some((i) => isMirror(c, i))) {
    const wardrobe = c.items.find((i) => shapeOfProgramItem(c, i) === 'wardrobe');
    const anchor = type === 'hall' ? c.items.find((i) => i.required) ?? c.items[0] : type === 'bedroom' || type === 'kids' ? wardrobe : undefined;
    if (anchor) {
      add(c, anchor, 'Wanddeko', type === 'hall' ? 'generic-mirror-round' : 'generic-mirror', 'spiegel', type === 'hall' ? 'Wanddeko: Spiegel beim Eingang, ein letzter Blick beim Gehen, er macht den Gang heller und weiter (ST3, SL4).' : 'Wanddeko: Standspiegel beim Schrank zum Anziehen, an der Wand angelehnt (S7).');
    }
  }

  // hall: a picture on the long wall gives the way a goal (V2)
  if (type === 'hall' && free() > 0 && area >= 4) {
    const anchor = c.items.find((i) => i.required) ?? c.items[0];
    if (anchor && add(c, anchor, 'Wanddeko', 'generic-picture', 'gang_bild', 'Wanddeko: Bild auf Augenhöhe, gibt dem Gang ein Ziel (V2).', { fallbacks: [], ...colour })) pictures++;
  }

  // a large plant in every room one lives in; the solver puts it into a corner or at the window (R9, D1)
  if (PLANT_ROOMS.includes(type) && area >= PLANT_MIN_AREA && !c.items.some((i) => shapeOfProgramItem(c, i) === 'plant')) {
    const anchor = c.items.find((i) => i.required) ?? c.items[0];
    if (anchor) add(c, anchor, 'Grün', 'generic-plant', 'pflanze', 'Pflanze in einer Ecke oder am Fenster, sie rahmt den Raum und macht ihn lebendig (R9, SL6).', { fallbacks: ['generic-plant-small'] });
  }

  if (level === 'full' && SOFT_ROOMS.includes(type)) softDecor(c, type, area, colour, opts);

  for (const [g, names] of c.added) c.notes.push(`${g} ergänzt: ${names.join(', ')}.`);
  return { program: { ...program, items: c.items, relations: c.relations }, notes: c.notes };
}

/** Colour of a programme item, lower case; empty when it has none. */
const colourOf = (c: Ctx, i: ProgramItem) => (i.color ?? lookup(c, i.catalogId)?.color ?? '').toLowerCase();

/**
 * Soft furnishings and table decoration, as a designer dresses the room at the end (SL8):
 * what makes a plan look lived in (SL8). Each piece belongs to a piece below it and is only added where
 * that piece is free; kitchen, bath and hall get the small things that belong there.
 */
function softDecor(c: Ctx, type: RoomType, area: number, colour: { color?: string }, opts: DecorOptions): void {
  const textile = opts.textile ? { color: opts.textile } : {};
  const on = (id: string) => c.relations.filter((r) => r.kind === 'on' && r.target === id).flatMap((r) => (r.kind === 'on' ? [c.items.find((i) => i.id === r.item)] : []));
  const taken = (id: string) => on(id).length > 0;
  const onlyLamps = (id: string) => on(id).every((i) => i && roleOfItem(c, i) === 'table-lamp');
  const put = (target: ProgramItem, catalogId: string, idBase: string, group: string, why: string, extra: Partial<ProgramItem> = {}): boolean => {
    // Claude planned it already, on this piece or without saying where: it stays, nothing doubles
    const planned = c.items.some((i) => i.catalogId === catalogId && (c.relations.flatMap((r) => (r.kind === 'on' && r.item === i.id ? [r.target] : []))[0] ?? target.id) === target.id);
    if (planned) return false;
    const it = add(c, target, group, catalogId, `${target.id}_${idBase}`, why, { fallbacks: [], ...extra });
    if (!it) return false;
    c.relations.push({ kind: 'on', item: it.id, target: target.id });
    return true;
  };
  const sameTone = (i: ProgramItem, tone: string | undefined) => !!tone && colourOf(c, i) === tone.toLowerCase();
  const withRole = (roles: string[]) => c.items.filter((i) => roles.includes(roleOfItem(c, i) ?? ''));
  const living = ['living', 'other', 'office', 'kids', 'bedroom'].includes(type);

  // sofa and armchair: scatter cushions in the accent colour, a throw over the arm of the sofa (SL5)
  if (living) {
    const sofas = withRole(['sofa']).filter((s) => !c.relations.some((r) => r.kind === 'on' && r.target === s.id));
    for (const s of sofas.slice(0, 2)) {
      const wide = (lookup(c, s.catalogId)?.width ?? 0) >= 1.5;
      const cushionTone = sameTone(s, colour.color) ? textile : colour;
      put(s, wide ? 'generic-cushions' : 'generic-cushion', 'kissen', 'Textilien', 'Textilien: Zierkissen in der Akzentfarbe am Sofa, sie machen es einladend und holen die Farbe in die Sitzgruppe (SL8).', cushionTone);
      if (wide && type === 'living') put(s, 'generic-throw', 'decke', 'Textilien', 'Textilien: gefaltete Wohndecke am anderen Ende des Sofas, Material zum Anfassen (SL8).', textile);
    }
    const chair = withRole(['armchair'])[0];
    if (chair && type === 'living' && !taken(chair.id)) put(chair, 'generic-cushion', 'kissen', 'Textilien', 'Textilien: ein Zierkissen im Sessel, in der Farbe passend zu den Sofakissen (SL8).', sameTone(chair, colour.color) ? textile : colour);
  }

  // bed: cushions in front of the pillows, a plaid across the foot (S6, SL5)
  if (['bedroom', 'kids', 'other'].includes(type)) {
    for (const b of withRole(['bed']).slice(0, 1)) {
      if (taken(b.id)) continue;
      const w = lookup(c, b.catalogId)?.width ?? 0;
      put(b, w >= 1.2 ? 'generic-cushions' : 'generic-cushion', 'kissen', 'Textilien', 'Textilien: Zierkissen vor den Kopfkissen, sie geben dem Bett ein Gesicht (SL8).', colour);
      if (type !== 'kids') put(b, 'generic-bed-throw', 'plaid', 'Textilien', 'Textilien: Plaid quer über das Fußende, Farbe und Struktur zur Bettwäsche (SL8).', textile);
    }
  }

  // tables: candles on the coffee table, a vase on the dining table, a fruit bowl in the kitchen (SL6)
  const coffee = c.items.find((i) => roleOfItem(c, i) === 'coffee-table');
  if (coffee && ['living', 'other'].includes(type) && !taken(coffee.id)) put(coffee, 'generic-candle-tray', 'tablett', 'Deko', 'Deko: Tablett mit Kerzen mitten auf dem Couchtisch, es fasst die Dinge auf dem Tisch zusammen (SL8).');
  const dining = c.items.find((i) => roleOfItem(c, i) === 'table' && lookup(c, i.catalogId)?.category === 'table');
  if (dining && ['dining', 'living', 'kitchen', 'other'].includes(type) && !taken(dining.id)) {
    if (type === 'kitchen') put(dining, 'generic-fruit-bowl', 'obst', 'Deko', 'Deko: Obstschale auf dem Küchentisch, Farbe und Einladung zum Zugreifen (SL8).');
    else put(dining, 'generic-vase', 'vase', 'Deko', 'Deko: Vase mit Zweigen in der Mitte des Esstischs, nicht höher als 50 cm, damit man sich noch sieht (SL8).', colour);
  }

  // desk: pencil cup, notebook and a small plant (SL6)
  const desk = c.items.find((i) => lookup(c, i.catalogId)?.category === 'desk');
  if (desk && !['kitchen', 'bath', 'hall'].includes(type) && (lookup(c, desk.catalogId)?.width ?? 0) >= 1 && onlyLamps(desk.id)) put(desk, 'generic-desk-set', 'set', 'Deko', 'Deko: Stiftebecher, Notizbuch und eine kleine Pflanze auf dem Schreibtisch, so sieht man, dass hier gearbeitet wird (SL8).', { ...colour });

  // hall: a vase on the shoe cabinet or chest (SL6)
  if (type === 'hall' && area >= 3) {
    const chest = c.items.find((i) => ['cabinet', 'dresser'].includes(shapeOfProgramItem(c, i)) && lookup(c, i.catalogId)?.category === 'storage' && (lookup(c, i.catalogId)?.height ?? 9) <= 1.1 && (lookup(c, i.catalogId)?.width ?? 0) >= 0.7);
    if (chest && !taken(chest.id)) put(chest, 'generic-vase', 'vase', 'Deko', 'Deko: Vase mit Zweigen auf dem Schuhschrank, das Erste, was man beim Ankommen sieht (SL8).', colour);
  }

  // kitchen and bath: the small things that belong there
  const anchor = c.items.find((i) => i.required) ?? c.items[0] ?? zoneAnchor(c);
  if (type === 'kitchen' && anchor) {
    if (opts.windows?.length) add(c, anchor, 'Grün', 'generic-herbs', 'kraeuter', 'Grün: Kräutertöpfe auf der Fensterbank, frisch zum Kochen und ein Hingucker am Licht (SL8).', { fallbacks: [] });
    if (area >= 5 && !c.items.some((i) => shapeOfProgramItem(c, i) === 'wall-clock')) add(c, anchor, 'Wanddeko', 'generic-wall-clock', 'uhr', 'Wanddeko: Wanduhr an der Küchenwand, praktisch beim Kochen (SL8).', { fallbacks: [] });
  }
  if (type === 'bath') {
    // the washbasin is often the flat's own and not in the programme: any piece of the room will do as anchor
    const basin = c.items.find((i) => shapeOfProgramItem(c, i) === 'washbasin') ?? anchor;
    if (basin && area >= 3 && !c.items.some((i) => shapeOfProgramItem(c, i) === 'towels')) add(c, basin, 'Textilien', 'generic-towels', 'handtuecher', 'Textilien: Handtuchstange mit zwei Handtüchern in Griffweite des Waschtischs (SL8).', { fallbacks: [], ...textile });
  }
}

/** A stand-in anchor for a room without a single planned piece (a kitchen that is only a run of units). */
function zoneAnchor(c: Ctx): ProgramItem | undefined {
  const z = c.program.zones[0];
  return z ? { id: 'anker', catalogId: '', zone: z.id, label: '', why: '' } : undefined;
}
