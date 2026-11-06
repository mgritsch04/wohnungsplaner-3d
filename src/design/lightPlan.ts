/**
 * Lichtplan of the furnishing (mgritsch04/wohnungsplaner-3d#436, research of 6.11.2026, rules L3,
 * L6, L9, L12): which colour temperature and colour rendering a lamp of the proposal gets for its
 * room and its use, and how much light a room needs. Warm where one lives and sleeps, neutral
 * where one works (desk, kitchen worktop); Ra ≥ 90 where colours matter (kitchen, bath, dining).
 * The values are planning recommendations (licht.de, DIN EN 12464-1, DGUV 215-410, IES in second
 * sources), not a lighting design; the lumen per lamp type are the typical values of `model/lux.ts`.
 */
import { findCatalogItem } from '../catalog/generic';
import type { CatalogItem } from '../catalog/types';
import { DEFAULT_LUMEN, FALLBACK_LUMEN } from '../model/lux';
import { roleOf } from '../suggest/roomGeometry';
import type { PlacedItem, RoomType } from './types';

/** How a lamp is used: the room's main light, light for a task, or light for the mood of the evening. */
export type LightUse = 'grund' | 'arbeit' | 'zone' | 'stimmung';

export interface LampPlan {
  kelvin: number;
  /** Minimum colour rendering index Ra. */
  ra: number;
  use: LightUse;
}

/** Rooms one lives, eats and sleeps in: warm white (L3, L9). */
const WARM: RoomType[] = ['living', 'bedroom', 'kids', 'dining', 'other'];

/**
 * Colour temperature and colour rendering of one lamp (L9, L12). `role` is the catalogue role
 * (`pendant`, `floor-lamp`, `table-lamp`), `on` the category or role of the piece it stands on or
 * hangs over, `strip` marks the light strip under the wall cabinets, `openKitchen` a kitchen that
 * is part of a living room (its work light stays at 3000 K, so it does not clash with the lamps of
 * the sofa).
 */
export function lampPlan(type: RoomType, role: string, opts: { on?: string; strip?: boolean; openKitchen?: boolean } = {}): LampPlan {
  const on = opts.on ?? '';
  if (opts.strip) return { kelvin: opts.openKitchen || type !== 'kitchen' ? 3000 : 4000, ra: 90, use: 'arbeit' };
  if (role === 'table-lamp' && on === 'desk') return { kelvin: 4000, ra: 80, use: 'arbeit' };
  if (role === 'pendant' && (on === 'table' || on === 'dining')) return { kelvin: 2700, ra: 90, use: 'zone' };
  if (role === 'pendant') {
    if (type === 'bath') return { kelvin: 3000, ra: 90, use: 'grund' };
    if (type === 'kitchen') return { kelvin: 3000, ra: 90, use: 'grund' };
    if (type === 'office' || type === 'hall' || type === 'utility') return { kelvin: 3000, ra: 80, use: 'grund' };
    return { kelvin: 2700, ra: 80, use: 'grund' };
  }
  // floor and table lamps: reading light at a seat or bed, mood light elsewhere
  const zone = on === 'sofa' || on === 'armchair' || on === 'nightstand' || on === 'bed' || on === 'side-table';
  return { kelvin: WARM.includes(type) || type === 'hall' ? 2700 : 3000, ra: 80, use: zone ? 'zone' : 'stimmung' };
}

/** Light a room needs from its lamps, in lumen per m² floor (L6; licht.de, sanier.de, IES). */
export const LUMEN_PER_M2: Partial<Record<RoomType, number>> = { living: 100, bedroom: 100, kids: 100, dining: 100, hall: 100, other: 100, office: 150, bath: 200, kitchen: 250 };

/** Luminous flux of a lamp of this shape when the product names none (typical bulb, `model/lux.ts`). */
export const lumenOf = (shape: string, stated?: number): number => stated ?? DEFAULT_LUMEN[shape] ?? FALLBACK_LUMEN;

/** The scenes of the day for the sheet (L9, L10): what is on in the day, the evening and before sleep. */
export const LIGHT_SCENES: Partial<Record<RoomType, string>> = {
  living: 'Tag: Tageslicht, Decke nur bei trübem Wetter. Abend: Decke gedimmt oder aus, Steh- und Stimmungslicht warm. Vor dem Schlafen: nur die niedrigen Lampen, gedimmt (≤ 2200 K).',
  bedroom: 'Abend: Nachttischleuchten warm, Decke nur zum Anziehen. Vor dem Schlafen: eine Leselampe gedimmt, dann dunkel; nachts höchstens ein schwaches warmes Orientierungslicht.',
  kids: 'Tag: Schreibtischleuchte zum Lernen. Abend: warmes, gedimmtes Licht; nachts ein kleines warmes Nachtlicht.',
  office: 'Tag: Tageslicht seitlich und Schreibtischleuchte (500 lx). Abend: nie nur die Arbeitsleuchte im dunklen Raum, das Raumlicht bleibt an (Kontrast höchstens 3 : 1).',
  kitchen: 'Kochen: Lichtleiste unter den Oberschränken (500 lx auf der Arbeitsplatte). Essen: Pendel über dem Tisch warm, die Arbeitsleiste aus.',
  dining: 'Essen: Pendel über dem Tisch warm und gedimmt, das übrige Raumlicht schwächer.',
  bath: 'Spiegel: Licht von beiden Seiten oder rundum auf Gesichtshöhe. Nachts: gedimmt oder ein Nachtlicht, kein volles Licht.',
  hall: 'Licht an jeder Tür schaltbar oder über Bewegungsmelder; nachts ein schwaches warmes Orientierungslicht auf dem Weg zum Bad.',
};

/** The light strip under the wall cabinets (K5). */
export const isLightStrip = (catalogId: string, tags: readonly string[] = []): boolean => catalogId === 'generic-k-light' || tags.includes('lichtleiste');

/**
 * The plan of a placed lamp of a layout, `null` for a piece that is no lamp. The piece it stands
 * on, beside or under (its `parent`) tells the use: a lamp on the desk is work light, a pendant
 * over the table lights the meal, a lamp at the sofa or bed is reading light.
 */
export function placedLampPlan(type: RoomType, p: PlacedItem, items: readonly PlacedItem[], catalog: CatalogItem[] = []): LampPlan | null {
  const cat = findCatalogItem(p.catalogId, catalog);
  if (!cat) return null;
  const kitchen = items.some((i) => i.kitchenRun !== undefined);
  if (isLightStrip(cat.id, cat.tags)) return lampPlan(type, 'strip', { strip: true, openKitchen: kitchen && type !== 'kitchen' });
  const role = roleOf({ ...cat, catalogId: cat.id });
  if (role !== 'pendant' && role !== 'floor-lamp' && role !== 'table-lamp') return null;
  const parent = p.parent ? items.find((i) => i.id === p.parent) : undefined;
  const pc = parent ? findCatalogItem(parent.catalogId, catalog) : undefined;
  const on = pc ? (pc.category === 'desk' ? 'desk' : roleOf({ ...pc, catalogId: pc.id })) : undefined;
  return lampPlan(type, role, { on });
}
