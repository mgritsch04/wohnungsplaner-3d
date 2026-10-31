/**
 * Einrichtungsblatt (#436): the finished proposal as a sheet to furnish the flat by, room by room –
 * what goes where (measures, wall and distance from the corner, which way it faces), the lights
 * with their height and a recommended colour temperature, and why each piece is there. Markdown,
 * so it reads in any editor and prints plainly.
 */
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import { roleOf, type Role } from '../../suggest/roomGeometry';
import { paletteText, roomConceptOf } from '../concept/flatConcept';
import { schemeOf, schemeText } from '../concept/scheme';
import { sideOfRotation, toRoomCm } from '../coords';
import type { FurnishRunResult } from '../run';
import type { PlacedItem, RoomAnalysis, RoomType, WallInfo } from '../types';

const cm = (m: number) => Math.round(m * 100);
const SIDE_NAME = { N: 'Norden', O: 'Osten', S: 'Süden', W: 'Westen' } as const;
const LIGHTS: Role[] = ['pendant', 'floor-lamp', 'table-lamp'];
/** Recommended colour temperature (L3): warm where one lives and sleeps, neutral where one works. */
const KELVIN: Partial<Record<RoomType, number>> = { living: 2700, bedroom: 2700, kids: 2700, dining: 2700, kitchen: 3000, bath: 3000, office: 3000, hall: 3000 };

/** Wall a floor piece stands against with its back (within 10 cm), and how far its middle is from the corner where the wall starts. */
function wallPlace(room: RoomAnalysis, it: PlacedItem): string {
  const front = { x: -Math.sin(it.rotation), y: Math.cos(it.rotation) };
  const back = { x: it.x - front.x * (it.depth / 2), y: it.y - front.y * (it.depth / 2) };
  let best: { w: WallInfo; d: number; t: number } | null = null;
  for (const w of room.walls) {
    const rel = { x: back.x - w.a.x, y: back.y - w.a.y };
    const t = rel.x * w.dir.x + rel.y * w.dir.y;
    const d = rel.x * w.inward.x + rel.y * w.inward.y;
    if (t < -0.05 || t > w.length + 0.05 || Math.abs(d) > 0.1) continue;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { w, d, t };
  }
  const facing = `Blick nach ${SIDE_NAME[sideOfRotation(it.rotation)]}`;
  if (best) {
    const prev = room.walls.find((x) => Math.hypot(x.b.x - best!.w.a.x, x.b.y - best!.w.a.y) < 0.02);
    const mid = { x: it.x - best.w.a.x, y: it.y - best.w.a.y };
    const along = mid.x * best.w.dir.x + mid.y * best.w.dir.y;
    return `an ${best.w.id}${best.w.side ? ` (${SIDE_NAME[best.w.side]})` : ''}, Mitte ${cm(along)} cm von der Ecke${prev ? ` mit ${prev.id}` : ''}; ${facing}`;
  }
  const p = toRoomCm(room.origin, it);
  return `frei im Raum, Mitte ${p.x} cm von der Westseite und ${p.y} cm von der Nordseite; ${facing}`;
}

/** The sheet of the whole run (or the rooms in `roomIds`). */
export function furnishingSheet(result: FurnishRunResult, names: Record<string, string>, catalog: CatalogItem[] = [], roomIds?: string[], variant: 'Ideal' | 'Kaufbar' = 'Kaufbar'): string {
  const item = (id: string) => catalog.find((c) => c.id === id) ?? findCatalogItem(id);
  const style = result.concept.style;
  const out: string[] = [
    `# Einrichtungsblatt (${variant})`,
    '',
    result.concept.living,
    '',
    `**Stil:** ${style.idea}${style.materials.length ? ` Materialien: ${style.materials.join(', ')}.` : ''}${style.forms ? ` Formen: ${style.forms}` : ''}`,
    `**Palette:** ${style.palette.map(paletteText).join(', ')}`,
    '',
    '_Maße in cm (Breite × Tiefe × Höhe). Positionen ab der Innenecke der Wand; „Ecke mit W1“ ist die Ecke, an der die Wand beginnt. Wände W1 … wie im Plan des Vorschlags. Lichtfarbe als Empfehlung (Regel L3)._',
  ];
  for (const r of result.rooms) {
    if (roomIds && !roomIds.includes(r.roomId)) continue;
    const room = result.analysis.rooms.find((a) => a.roomId === r.roomId);
    if (!room) continue;
    const type = roomConceptOf(result.concept, room).type;
    const why = new Map(r.program.items.map((i) => [i.id, i]));
    const label = (p: PlacedItem) => why.get(p.id)?.label || item(p.catalogId)?.name || p.catalogId;
    const real = (p: PlacedItem) => {
      const c = item(p.catalogId);
      return c && !p.catalogId.startsWith('generic-') ? ` – ${c.name}${c.retailer ? ` (${c.retailer}${c.price ? `, ${Math.round(c.price.amount)} €` : ''})` : ''}` : '';
    };
    const roleOfPlaced = (p: PlacedItem): Role | null => {
      const c = item(p.catalogId);
      return c ? roleOf({ ...c, catalogId: c.id }) : null;
    };
    out.push('', `## ${names[r.roomId] ?? room.name}`, '', r.program.reading, '', `**Farbschema:** ${schemeText(schemeOf(roomConceptOf(result.concept, room), style), style)}`);
    if (r.program.zones.length) out.push('', '**Zonen:**', ...r.program.zones.map((z) => `- ${z.function}: ${z.why}`));
    if (r.program.walk) out.push('', `**Wege:** ${r.program.walk}`);
    const curtain = (p: PlacedItem) => roleOfPlaced(p) === 'curtain';
    const floor = r.layout.items.filter((p) => !p.parent && p.elevation < 0.05 && !LIGHTS.includes(roleOfPlaced(p) ?? 'wall') && !curtain(p) && p.kitchenRun === undefined);
    /** „4 × Stuhl (45 × 52)“: equal pieces once with their count. */
    const counted = (list: PlacedItem[]) => {
      const by = new Map<string, number>();
      for (const k of list) {
        const t = `${label(k)} (${cm(k.width)} × ${cm(k.depth)})`;
        by.set(t, (by.get(t) ?? 0) + 1);
      }
      return [...by].map(([t, n]) => (n > 1 ? `${n} × ${t}` : t)).join(', ');
    };
    if (floor.length) {
      out.push('', '| Möbel | Maße | Platz | Warum |', '|---|---|---|---|');
      for (const p of floor) {
        const kids = r.layout.items.filter((k) => k.parent === p.id && !LIGHTS.includes(roleOfPlaced(k) ?? 'wall'));
        const with_ = kids.length ? ` Dazu: ${counted(kids)}.` : '';
        out.push(`| ${label(p)}${real(p)} | ${cm(p.width)} × ${cm(p.depth)} × ${cm(p.height)} | ${wallPlace(room, p)} | ${(why.get(p.id)?.why ?? '').replace(/\|/g, '/')}${with_} |`);
      }
    }
    const curtains = r.layout.items.filter(curtain);
    if (curtains.length) out.push('', `**Vorhänge:** ${counted(curtains)}, Stange 10–15 cm über dem Fenster und 10–25 cm seitlich darüber hinaus (R8).`);
    const kitchen = r.layout.items.filter((p) => p.kitchenRun !== undefined);
    if (kitchen.length) out.push('', `**Küche:** ${kitchen.length} Module, ${[...new Set(kitchen.map((k) => item(k.catalogId)?.name ?? k.catalogId))].join(', ')}.`);
    const lights = r.layout.items.filter((p) => LIGHTS.includes(roleOfPlaced(p) ?? 'wall'));
    if (lights.length) {
      const k = KELVIN[type] ?? 2700;
      out.push('', '**Licht:**');
      for (const l of lights) {
        const role = roleOfPlaced(l);
        const parent = l.parent ? r.layout.items.find((x) => x.id === l.parent) : undefined;
        const where = role === 'pendant' ? `Unterkante ${cm(l.elevation)} cm über dem Boden${parent ? `, über ${label(parent)}` : ''}` : role === 'table-lamp' ? `auf ${parent ? label(parent) : 'einem Möbel'}` : `${cm(l.height)} cm hoch${parent ? `, neben ${label(parent)}` : ''}`;
        const kelvin = role === 'table-lamp' && parent && item(parent.catalogId)?.category === 'desk' ? 4000 : k;
        out.push(`- ${label(l)}${real(l)}: ${where}; ${kelvin} K, dimmbar. ${why.get(l.id)?.why ?? ''}`.trimEnd());
      }
    }
    if (r.layout.dropped.length) out.push('', '**Nicht untergebracht:**', ...r.layout.dropped.map((d) => `- ${item(d.catalogId)?.name ?? d.catalogId}: ${d.reason}`));
  }
  return out.join('\n') + '\n';
}
