/**
 * Stimmungslicht (mgritsch04/wohnungsplaner-3d#436, rule L8, research of 6.11.2026): a living room
 * of some size gets a third light layer beside the ceiling light and the reading lamp at the sofa,
 * a low warm lamp in the other half of the room. It lights the walls, which makes the room look
 * wider and more pleasant than ceiling light alone (Flynn et al., Mistrick et al., Manav & Yener)
 * and gives the evening its islands of light (licht.de: Stimmungslicht). The app puts a table lamp
 * on a free sideboard, chest, shelf or TV board; where there is none, it adds nothing (a free
 * floor lamp would only stir up the solver).
 */
import type { CatalogItem } from '../../catalog/types';
import type { ProgramItem, RoomProgram, RoomType } from '../types';
import { add, lookup, makeCtx, roleOfItem } from './groups';

/** Rooms that get a mood light of their own, and the smallest floor area (m²) for it. */
const MOOD_ROOMS: RoomType[] = ['living', 'other'];
export const MOOD_MIN_AREA = 14;
const LAMPS = ['floor-lamp', 'table-lamp'];
/** Pieces a lamp of the reading light belongs to: these lamps are not mood light. */
const SEATS = ['sofa', 'armchair', 'nightstand', 'bed', 'side-table'];

export function completeLight(program: RoomProgram, type: RoomType, area: number, products: CatalogItem[] = []): { program: RoomProgram; notes: string[] } {
  if (!MOOD_ROOMS.includes(type) || area < MOOD_MIN_AREA) return { program, notes: [] };
  const c = makeCtx(program, products);
  const byId = new Map(c.items.map((i) => [i.id, i]));
  const target = (id: string) => c.relations.flatMap((r) => ('item' in r && r.item === id && 'target' in r ? [byId.get(r.target)] : []))[0];
  const role = (i: ProgramItem | undefined) => (i ? roleOfItem(c, i) ?? '' : '');
  const lamps = c.items.filter((i) => LAMPS.includes(role(i)));
  // a lamp Claude placed on its own or on a piece of storage is a mood light already
  const mood = lamps.some((l) => {
    const t = target(l.id);
    return !t || (!SEATS.includes(role(t)) && lookup(c, t.catalogId)?.category !== 'desk');
  });
  if (mood || !c.items.some((i) => role(i) === 'sofa')) return { program, notes: [] };
  const hasLamp = (id: string) => c.relations.some((r) => r.kind === 'on' && r.target === id && LAMPS.includes(role(byId.get(r.item))));
  const surface = (i: ProgramItem) => {
    const it = lookup(c, i.catalogId);
    if (!it || hasLamp(i.id)) return 0;
    const r = role(i);
    if (r === 'tv-board') return 1;
    if (it.category !== 'storage' || r === 'box' || it.width < 0.6 || it.height < 0.5 || it.height > 1.3) return 0;
    // a sideboard or chest beats an open shelf
    return /regal|shelf/i.test(it.name) ? 2 : 3;
  };
  const base = [...c.items].sort((a, b) => surface(b) - surface(a))[0];
  if (!base || surface(base) === 0) return { program, notes: [] };
  const lamp = add(c, base, 'Stimmungslicht', 'generic-table-lamp', `${base.id}_stimmung`, 'Stimmungslicht: niedrige Tischlampe, warmweiß 2700 K und gedimmt, in der anderen Raumhälfte als die Leselampe; sie hellt die Wände auf, der Raum wirkt abends weiter und gemütlicher (L1, L8).');
  if (!lamp) return { program, notes: [] };
  c.relations.push({ kind: 'on', item: lamp.id, target: base.id });
  for (const [g, names] of c.added) c.notes.push(`${g} ergänzt: ${names.join(', ')}.`);
  return { program: { ...program, items: c.items, relations: c.relations }, notes: c.notes };
}
