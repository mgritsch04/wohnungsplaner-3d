/**
 * Plan summary for a question to Claude (#151): rooms with area and extent, doors and windows,
 * the furniture per room, and the catalogue Claude may choose new furniture from.
 *
 * Only plan geometry and furniture go out – no project name, notes, underlay, product links,
 * prices or anything else personal. Rooms get short keys (R1, R2 …) so Claude can refer to
 * them; `roomKeys` maps them back to the project's room ids.
 */
import type { CatalogItem } from '../catalog/types';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { boundsOf } from '../model/vec';
import { describeZone, isKeepFree, zoneLabels, zoneRoomId } from '../model/zones';
import { guessRoomType, roomIdAt, ROOM_TYPES, type RoomType } from '../suggest/furnishing';

export interface PlanSummary {
  text: string;
  /** R1 → room id */
  roomKeys: Record<string, string>;
  /** Z1 → id of a marked area (#416) */
  zoneKeys: Record<string, string>;
  /** Room id → keys of the marked areas in it (#416). */
  zonesByRoom: Record<string, string[]>;
  /** Keys of the marked areas that appear in `text` (#416). */
  listedZones: string[];
}

const m = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
const cm = (v: number) => Math.round(v * 100);

/** At most this many catalogue entries go into a question (keeps the prompt small). */
export const MAX_CATALOG = 150;

export function summarizePlan(project: Project, opts: { roomTypes?: Record<string, RoomType>; focusRoomId?: string | null } = {}): PlanSummary {
  const d = derivePlan(project);
  const roomKeys: Record<string, string> = {};
  const keyOf = new Map<string, string>();
  project.rooms.forEach((r, i) => {
    roomKeys[`R${i + 1}`] = r.id;
    keyOf.set(r.id, `R${i + 1}`);
  });

  const furnitureByRoom = new Map<string | null, string[]>();
  for (const f of project.furniture) {
    const rid = roomIdAt(project, d, f);
    const list = furnitureByRoom.get(rid) ?? [];
    list.push(`${f.quantity > 1 ? `${f.quantity}× ` : ''}${f.name} (${cm(f.width)}×${cm(f.depth)} cm)`);
    furnitureByRoom.set(rid, list);
  }

  // marked areas with their purpose (#416)
  const zoneKey = zoneLabels(project.zones ?? []);
  const zoneKeys: Record<string, string> = {};
  const zonesByRoom: Record<string, string[]> = {};
  const zoneLines = new Map<string | null, string[]>();
  for (const z of project.zones ?? []) {
    const key = zoneKey.get(z.id)!;
    const rid = zoneRoomId(project, d, z);
    zoneKeys[key] = z.id;
    if (rid) zonesByRoom[rid] = [...(zonesByRoom[rid] ?? []), key];
    const purpose = z.purpose.trim().replace(/\s+/g, ' ').slice(0, 200) || 'ohne Angabe';
    zoneLines.set(rid, [...(zoneLines.get(rid) ?? []), `${key} „${purpose}“${isKeepFree(purpose) ? ' (frei lassen)' : ''}: ${describeZone(d, z, rid)}`]);
  }

  const lines: string[] = [];
  const listedZones: string[] = [];
  const focus = opts.focusRoomId ? project.rooms.find((r) => r.id === opts.focusRoomId) : undefined;
  for (const r of focus ? [focus] : project.rooms) {
    const g = d.rooms.get(r.id);
    const type = opts.roomTypes?.[r.id] ?? guessRoomType(r.name);
    const typeLabel = ROOM_TYPES.find((t) => t.id === type)?.label ?? type;
    const b = g ? boundsOf(g.interior) : null;
    const nodes = new Set(r.nodeIds);
    const walls = project.walls.filter((w) => nodes.has(w.a) && nodes.has(w.b));
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = project.openings.filter((o) => wallIds.has(o.wallId));
    const count = (kind: string) => openings.filter((o) => o.kind === kind);
    const doors = count('door');
    const windows = count('window');
    const passages = count('passage');
    const parts = [
      `${keyOf.get(r.id)} „${r.name || 'Raum ohne Namen'}“ (Typ: ${typeLabel})`,
      g ? `Fläche ${m(g.area)} m²` : 'Fläche unbekannt',
      b ? `Ausdehnung ca. ${m(b.maxX - b.minX)} × ${m(b.maxY - b.minY)} m` : null,
      `Türen ${doors.length}${doors.length ? ` (${doors.map((o) => `${cm(o.width)} cm`).join(', ')})` : ''}`,
      `Fenster ${windows.length}${windows.length ? ` (${windows.map((o) => `${cm(o.width)} cm breit`).join(', ')})` : ''}`,
      passages.length ? `Durchgänge ${passages.length}` : null,
    ].filter(Boolean);
    lines.push(`- ${parts.join('; ')}`);
    const furn = furnitureByRoom.get(r.id) ?? [];
    lines.push(`  Möbel: ${furn.length ? furn.join(', ') : 'keine'}`);
    const zl = zoneLines.get(r.id) ?? [];
    listedZones.push(...(zonesByRoom[r.id] ?? []));
    if (zl.length) lines.push(`  Vom Bewohner markierte Bereiche: ${zl.join('; ')}`);
  }
  const loose = furnitureByRoom.get(null) ?? [];
  if (!focus && loose.length) lines.push(`- Außerhalb der Räume: ${loose.join(', ')}`);

  const header = focus
    ? `Gewählter Raum (die Wohnung hat insgesamt ${project.rooms.length} Räume):`
    : `Wohnung mit ${project.rooms.length} Räumen:`;
  return { text: `${header}\n${lines.join('\n')}`, roomKeys, zoneKeys, zonesByRoom, listedZones };
}

/** Catalogue lines „id: Name, B×T×H cm, Kategorie“ – Claude may only propose these ids. */
export function summarizeCatalog(items: CatalogItem[]): string {
  return items
    .slice(0, MAX_CATALOG)
    .map((c) => `${c.id}: ${c.name}, ${cm(c.width)}×${cm(c.depth)}×${cm(c.height)} cm, ${c.category}`)
    .join('\n');
}
