/**
 * Wall decoration and plants as a designer adds them at the end (mgritsch04/wohnungsplaner-3d#436):
 * a room is not finished with furniture alone. `completeDecor` hangs a picture over the sofa, the
 * bed and a sideboard, a mirror in the hall and at the wardrobe, a still life of three (vase, books,
 * bowl) on a sideboard, chest or lowboard, and gives a room that is lived in one large plant. Few good pieces rather than many (SL6): every room has a budget, what Claude
 * already planned counts against it. Pictures take the accent colour of the palette (SL2); sizes
 * follow the piece below (R7: about two thirds of its width, lower edge 15–25 cm above it).
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

export function completeDecor(program: RoomProgram, type: RoomType, area: number, products: CatalogItem[] = [], accent?: string): { program: RoomProgram; notes: string[] } {
  const budget = PICTURE_BUDGET[type];
  if (budget === undefined && !PLANT_ROOMS.includes(type)) return { program, notes: [] };
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

  for (const [g, names] of c.added) c.notes.push(`${g} ergänzt: ${names.join(', ')}.`);
  return { program: { ...program, items: c.items, relations: c.relations }, notes: c.notes };
}
