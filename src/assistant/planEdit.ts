/**
 * Plan edit by text (#415): the user tells Claude in free text what to change in the existing plan
 * („Sofa ans Fenster“, „Küche an die andere Wand“, „Schreibtisch raus, dafür ein Regal“) and gets
 * targeted changes instead of a new furnishing.
 *
 * Claude sees the rooms with their walls (W1 … per room: side in the plan, length, doors, windows,
 * neighbour room), the furniture (M1 …: size, at which wall) and the kitchen runs (K1 …) and
 * answers with operations: move, remove, replace, add, move a kitchen run to another wall. Claude
 * never gives coordinates: the app places every piece itself with the checks of the furnishing
 * suggestion (`placeNear`, `layoutKitchenRun`), so nothing collides; locked pieces and pieces
 * already in the flat stay. The result is a furnishing preview (moved and new pieces, the
 * originals hidden), taken over in one undo step. Walls and the floor plan are not changed.
 * Only plan geometry and furniture names/sizes go out – no project name, notes, links or prices.
 */
import { z } from 'zod';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import type { CatalogItem } from '../catalog/types';
import { generateCountertops, layoutKitchenRun, type RunModule } from '../kitchen/kitchen';
import { derivePlan, type DerivedPlan } from '../model/derived';
import type { Furniture, Project } from '../model/schema';
import { add, closestPointOnSegment, dist, dot, normalize, perp, pointInPolygon, scale, sub, type Vec2 } from '../model/vec';
import { guessRoomType, placeNear, roomIdAt, ROOM_TYPES, suggestFurnishing, type FurnishingSuggestion, type PlaceTarget, type RoomType } from '../suggest/furnishing';
import { describeZone, isKeepFree, zoneCenter, zoneLabels, zoneRoomId } from '../model/zones';
import { kitchenFaces } from './kitchenDesign';
import { summarizeCatalog } from './planSummary';

export const MAX_INSTRUCTION = 800;
export const MAX_CHANGES = 12;
export const MAX_ITEMS = 120;
const MAX_QUANTITY = 6;

const cm = (v: number) => Math.round(v * 100);
const m2 = (v: number) => v.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const key = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/** One wall of a room as Claude sees it: the room's interior edge a→b. */
export interface EditWall {
  a: Vec2;
  b: Vec2;
  inward: Vec2;
  /** „oben“, „unten“, „links“, „rechts“ (in the plan) or „schräg“. */
  side: string;
  windows: Vec2[];
  doors: Vec2[];
}

export interface EditInput {
  /** Text for the prompt. */
  text: string;
  /** R1 → room id */
  roomKeys: Record<string, string>;
  /** M1 → furniture id */
  itemKeys: Record<string, string>;
  /** Z1 → zone id (marked areas, #416) */
  zoneKeys: Record<string, string>;
  /** K1 → ids of the kitchen modules of that run */
  kitchenKeys: Record<string, { roomId: string; ids: string[] }>;
  /** Room id → its walls, W1 = index 0 */
  walls: Record<string, EditWall[]>;
  /** Rooms the edit may touch. */
  roomIds: string[];
}

const frontOf = (f: Pick<Furniture, 'rotation'>): Vec2 => ({ x: -Math.sin(f.rotation), y: Math.cos(f.rotation) });

function sideName(inward: Vec2): string {
  // plan y grows downwards: a wall whose room side faces down is the upper wall
  if (inward.y > 0.7) return 'oben';
  if (inward.y < -0.7) return 'unten';
  if (inward.x > 0.7) return 'links';
  if (inward.x < -0.7) return 'rechts';
  return 'schräg';
}

/** The walls of a room (interior edges of at least 30 cm, like the furnishing suggestion) with their doors and windows. */
export function roomWalls(derived: DerivedPlan, roomId: string): EditWall[] {
  const g = derived.rooms.get(roomId);
  if (!g) return [];
  const poly = g.interior;
  const openings: { at: Vec2; window: boolean; reach: number }[] = [];
  for (const [wallId, list] of derived.openings) {
    const fp = derived.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) openings.push({ at: add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2)), window: r.opening.kind === 'window', reach: fp.thickness / 2 + 0.08 });
  }
  const out: EditWall[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (dist(a, b) < 0.3) continue;
    let inward = perp(normalize(sub(b, a)));
    if (!pointInPolygon(add(scale(add(a, b), 0.5), scale(inward, 0.02)), poly)) inward = scale(inward, -1);
    const on = openings.filter((o) => closestPointOnSegment(o.at, a, b).distance <= o.reach);
    out.push({ a, b, inward, side: sideName(inward), windows: on.filter((o) => o.window).map((o) => o.at), doors: on.filter((o) => !o.window).map((o) => o.at) });
  }
  return out;
}

/** Index of the wall `f` stands (or hangs) with its back against, or -1 when it stands free. */
function wallOf(f: Furniture, walls: EditWall[]): number {
  let best = -1;
  let bestD = Infinity;
  walls.forEach((w, i) => {
    if (dot(frontOf(f), w.inward) < 0.7) return;
    const d = closestPointOnSegment(f, w.a, w.b).distance;
    if (d < f.depth / 2 + 0.12 && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

const ABOVE = new Set(['wall', 'hood', 'cooktop']);
const isModule = (f: Furniture) => !!f.kitchen && f.kitchen.type !== 'countertop';
const isFixed = (f: Furniture) => f.locked || f.existing;

/** Kitchen modules of a room grouped into runs (same direction, same back line). */
function kitchenRuns(project: Project, derived: DerivedPlan, roomId: string): Furniture[][] {
  const runs: Furniture[][] = [];
  for (const f of project.furniture) {
    if (!isModule(f) || roomIdAt(project, derived, f) !== roomId) continue;
    const n = frontOf(f);
    const back = dot(f, n) - f.depth / 2;
    const run = runs.find((r) => {
      const o = r[0];
      return Math.cos(f.rotation - o.rotation) > 0.999 && Math.abs(dot(o, n) - Math.max(...r.map((x) => x.depth)) / 2 - back) < 0.4;
    });
    if (run) run.push(f);
    else runs.push([f]);
  }
  return runs;
}

export function buildEditInput(project: Project, scope: string | null, roomTypes: Record<string, RoomType> = {}): EditInput {
  const derived = derivePlan(project);
  const roomKeys: Record<string, string> = {};
  const keyOf = new Map<string, string>();
  project.rooms.forEach((r, i) => {
    roomKeys[`R${i + 1}`] = r.id;
    keyOf.set(r.id, `R${i + 1}`);
  });
  const roomIds = scope && project.rooms.some((r) => r.id === scope) ? [scope] : project.rooms.map((r) => r.id);
  const itemKeys: Record<string, string> = {};
  const kitchenKeys: EditInput['kitchenKeys'] = {};
  const walls: Record<string, EditWall[]> = {};
  const lines: string[] = [];
  const zoneKeys: Record<string, string> = {};
  const zoneKey = zoneLabels(project.zones ?? []);
  let n = 0;
  let k = 0;
  for (const id of roomIds) {
    const room = project.rooms.find((r) => r.id === id)!;
    const g = derived.rooms.get(id);
    const type = roomTypes[id] ?? guessRoomType(room.name);
    const ws = roomWalls(derived, id);
    walls[id] = ws;
    lines.push(`${keyOf.get(id)} „${room.name || 'Raum ohne Namen'}“ (Typ: ${ROOM_TYPES.find((t) => t.id === type)?.label ?? type}${g ? `, ${m2(g.area)} m²` : ''})`);
    ws.forEach((w, i) => {
      const beyond = roomIdAt(project, derived, sub(scale(add(w.a, w.b), 0.5), scale(w.inward, 0.45)));
      const neighbour = beyond && beyond !== id ? project.rooms.find((r) => r.id === beyond) : undefined;
      const parts = [`${m2(dist(w.a, w.b))} m`, w.windows.length ? `${w.windows.length === 1 ? '1 Fenster' : `${w.windows.length} Fenster`}` : null, w.doors.length ? `${w.doors.length === 1 ? '1 Tür' : `${w.doors.length} Türen`}` : null, neighbour ? `grenzt an ${keyOf.get(neighbour.id)} „${neighbour.name || 'Raum ohne Namen'}“` : null];
      lines.push(`  W${i + 1} (${w.side}): ${parts.filter(Boolean).join(', ')}`);
    });
    for (const z of project.zones ?? []) {
      if (zoneRoomId(project, derived, z) !== id) continue;
      const zk = zoneKey.get(z.id)!;
      zoneKeys[zk] = z.id;
      const purpose = z.purpose.trim().replace(/\s+/g, ' ').slice(0, 200) || 'ohne Angabe';
      lines.push(`  ${zk} „${purpose}“${isKeepFree(purpose) ? ' (frei lassen)' : ''}: ${describeZone(derived, z, id)}`);
    }
    for (const run of kitchenRuns(project, derived, id)) {
      k++;
      kitchenKeys[`K${k}`] = { roomId: id, ids: run.map((f) => f.id) };
      const floor = run.filter((f) => !ABOVE.has(f.kitchen!.type));
      const at = wallOf(floor[0] ?? run[0], ws);
      lines.push(`  K${k}: Küchenzeile${at >= 0 ? ` an W${at + 1}` : ''}, ${run.length} Module, ${m2(floor.reduce((s, f) => s + f.width, 0))} m lang`);
    }
    for (const f of project.furniture) {
      if (f.kitchen || roomIdAt(project, derived, f) !== id || n >= MAX_ITEMS) continue;
      n++;
      itemKeys[`M${n}`] = f.id;
      const at = wallOf(f, ws);
      const where = at >= 0 ? `${f.elevation > 0.6 ? 'hängt' : 'steht'} an W${at + 1}` : f.elevation > 0.05 ? 'steht auf einem Möbel' : 'frei im Raum';
      lines.push(`  M${n}: ${f.quantity > 1 ? `${f.quantity}× ` : ''}${f.name}, ${cm(f.width)}×${cm(f.depth)} cm, ${where}${isFixed(f) ? ' (fest, nicht änderbar)' : ''}`);
    }
  }
  const header = roomIds.length === 1 && project.rooms.length > 1 ? `Gewählter Raum (die Wohnung hat ${project.rooms.length} Räume):` : `Wohnung mit ${project.rooms.length} Räumen:`;
  return { text: `${header}\n${lines.join('\n')}`, roomKeys, itemKeys, zoneKeys, kitchenKeys, walls, roomIds };
}

export function buildEditPrompt(instruction: string, input: EditInput, catalog: CatalogItem[]): string {
  return [
    'Du hilfst in einem Wohnungsplaner, einen bestehenden Plan nach einer Anweisung des Nutzers gezielt zu ändern (Antwort auf Deutsch).',
    'Ändere nur, was die Anweisung verlangt; alles andere bleibt, wie es ist. Plane nicht neu.',
    '',
    `Anweisung: ${instruction.trim().slice(0, MAX_INSTRUCTION)}`,
    '',
    input.text,
    '',
    'Wände: W1, W2 … je Raum, mit Lage im Grundriss (oben = Norden). Möbel: M1, M2 …; markierte Bereiche: Z1 …; Küchenzeilen: K1 …',
    '',
    'Katalog für neue Möbel (nur diese ids; Format „id: Name, Breite×Tiefe×Höhe, Kategorie“):',
    summarizeCatalog(catalog),
    '',
    'Mögliche Änderungen ("op"):',
    '- "move": Möbel umstellen. "item" = M…, optional "room" (R…, sonst bleibt der Raum), "wall" (W… des Zielraums) und/oder "near" ("window", "door", ein Möbel M… oder ein Bereich Z…).',
    '- "remove": Möbel entfernen ("item").',
    '- "replace": Möbel durch ein Katalog-Möbel ersetzen ("item", "catalogId"); es kommt an dieselbe Stelle.',
    '- "add": Katalog-Möbel hinzufügen ("room", "catalogId", "quantity", optional "wall", "near").',
    '- "kitchen": Küchenzeile an eine andere Wand desselben Raums stellen ("run" = K…, "wall" = W…). Einzelne Küchenmodule nicht ändern.',
    'Die App stellt die Möbel selbst kollisionsfrei auf; keine Koordinaten angeben. Möbel mit „fest“ nicht ändern. Bereiche mit „frei lassen“ nicht zustellen; Möbel für einen Bereich mit "near":"Z…" dorthin.',
    'Wände, Türen, Fenster und die Raumform kann die App nicht ändern: solche Wünsche kurz in "notPossible" nennen (was und warum), nichts erfinden.',
    `Höchstens ${MAX_CHANGES} Änderungen, jede mit "why" (ein kurzer Satz). Keine Marken, Händler oder Preise erfinden.`,
    '',
    'Antworte nur mit JSON in genau dieser Form:',
    '{"summary":"1–2 Sätze, was du änderst","changes":[{"op":"move","item":"M2","wall":"W3","near":"window","why":"…"},{"op":"add","room":"R1","catalogId":"generic-armchair","quantity":1,"near":"M2","why":"…"},{"op":"kitchen","run":"K1","wall":"W2","why":"…"}],"notPossible":[]}',
  ].join('\n');
}

export type EditNear = { kind: 'window' } | { kind: 'door' } | { kind: 'item'; furnitureId: string } | { kind: 'zone'; zoneId: string };

export type EditChange =
  | { op: 'move'; furnitureId: string; roomId: string; wall?: number; near?: EditNear; why: string }
  | { op: 'remove'; furnitureId: string; why: string }
  | { op: 'replace'; furnitureId: string; catalogId: string; why: string }
  | { op: 'add'; roomId: string; catalogId: string; quantity: number; wall?: number; near?: EditNear; why: string }
  | { op: 'kitchen'; run: string; roomId: string; wall: number; why: string };

export interface EditAnswer {
  summary: string;
  changes: EditChange[];
  /** What Claude says cannot be done (walls, windows …). */
  notPossible: string[];
  /** Changes that referred to unknown or fixed pieces, rooms, walls or catalogue ids. */
  dropped: number;
}

const ChangeSchema = z.object({
  op: z.unknown(),
  item: z.unknown().optional(),
  room: z.unknown().optional(),
  wall: z.unknown().optional(),
  near: z.unknown().optional(),
  run: z.unknown().optional(),
  catalogId: z.unknown().optional(),
  quantity: z.unknown().optional(),
  why: z.unknown().optional(),
});
const AnswerSchema = z.object({
  summary: z.unknown().optional(),
  changes: z.array(z.unknown()).catch([]),
  notPossible: z.array(z.unknown()).optional().catch([]),
});

/** Checks Claude's answer against the request: only known pieces, rooms, walls and catalogue ids. Throws when nothing is left. */
export function parseEditAnswer(raw: unknown, input: EditInput, project: Project, derived: DerivedPlan, catalog: CatalogItem[]): EditAnswer {
  const parsed = AnswerSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Antwort hat nicht die erwartete Form.');
  const ids = new Set(catalog.map((c) => c.id));
  const inScope = new Set(input.roomIds);
  const piece = (v: unknown) => {
    const f = project.furniture.find((x) => x.id === input.itemKeys[key(v)]);
    return f && !isFixed(f) ? f : undefined;
  };
  const room = (v: unknown, fallback?: string | null) => {
    const id = input.roomKeys[key(v)] ?? fallback ?? undefined;
    return id && inScope.has(id) ? id : undefined;
  };
  const wall = (v: unknown, roomId: string) => {
    const m = /^W(\d+)$/.exec(key(v));
    const i = m ? Number(m[1]) - 1 : -1;
    return i >= 0 && i < (input.walls[roomId]?.length ?? 0) ? i : undefined;
  };
  const near = (v: unknown): EditNear | undefined => {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (s === 'window' || s === 'fenster') return { kind: 'window' };
    if (s === 'door' || s === 'tür') return { kind: 'door' };
    const zone = input.zoneKeys[key(v)];
    if (zone) return { kind: 'zone', zoneId: zone };
    const id = input.itemKeys[key(v)];
    return id ? { kind: 'item', furnitureId: id } : undefined;
  };
  const changes: EditChange[] = [];
  const touched = new Set<string>();
  let dropped = 0;
  for (const c of parsed.data.changes) {
    if (changes.length >= MAX_CHANGES) break;
    const p = ChangeSchema.safeParse(c);
    if (!p.success) {
      dropped++;
      continue;
    }
    const v = p.data;
    const why = clip(v.why, 200);
    const op = typeof v.op === 'string' ? v.op.trim().toLowerCase() : '';
    let ch: EditChange | null = null;
    if (op === 'move' || op === 'remove' || op === 'replace') {
      const f = piece(v.item);
      const from = f ? roomIdAt(project, derived, f) : null;
      if (f && !touched.has(f.id) && from && inScope.has(from)) {
        if (op === 'remove') ch = { op, furnitureId: f.id, why };
        else if (op === 'replace') {
          const cid = typeof v.catalogId === 'string' ? v.catalogId.trim() : '';
          if (ids.has(cid)) ch = { op, furnitureId: f.id, catalogId: cid, why };
        } else {
          const to = room(v.room, from);
          if (to) {
            const w = v.wall === undefined || v.wall === null ? undefined : wall(v.wall, to);
            const nr = v.near === undefined || v.near === null ? undefined : near(v.near);
            const named = (v.wall !== undefined && v.wall !== null) || (v.near !== undefined && v.near !== null) || to !== from;
            // a move needs a target that can be found: an unknown wall or anchor alone is dropped
            if ((w !== undefined || nr || to !== from) && !(nr?.kind === 'item' && nr.furnitureId === f.id) && named) ch = { op, furnitureId: f.id, roomId: to, ...(w !== undefined ? { wall: w } : {}), ...(nr ? { near: nr } : {}), why };
          }
        }
      }
      if (ch) touched.add(f!.id);
    } else if (op === 'add') {
      const to = room(v.room, input.roomIds.length === 1 ? input.roomIds[0] : null);
      const cid = typeof v.catalogId === 'string' ? v.catalogId.trim() : '';
      if (to && ids.has(cid)) {
        const w = v.wall === undefined || v.wall === null ? undefined : wall(v.wall, to);
        const nr = v.near === undefined || v.near === null ? undefined : near(v.near);
        const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.round(Number(v.quantity ?? 1)) || 1));
        ch = { op, roomId: to, catalogId: cid, quantity, ...(w !== undefined ? { wall: w } : {}), ...(nr ? { near: nr } : {}), why };
      }
    } else if (op === 'kitchen') {
      const run = input.kitchenKeys[key(v.run)] ?? (Object.values(input.kitchenKeys).length === 1 ? Object.values(input.kitchenKeys)[0] : undefined);
      const runKey = Object.entries(input.kitchenKeys).find(([, r]) => r === run)?.[0];
      const w = run ? wall(v.wall, run.roomId) : undefined;
      if (run && runKey && w !== undefined && !touched.has(runKey)) {
        ch = { op, run: runKey, roomId: run.roomId, wall: w, why };
        touched.add(runKey);
      }
    }
    if (ch) changes.push(ch);
    else dropped++;
  }
  const notPossible = (parsed.data.notPossible ?? []).map((s) => clip(s, 200)).filter(Boolean).slice(0, 5);
  const summary = clip(parsed.data.summary, 500);
  if (!changes.length && !notPossible.length) throw new Error('Keine verwertbaren Änderungen.');
  return { summary, changes, notPossible, dropped };
}

export interface EditResult {
  ok: boolean;
  /** What was done (or wanted), e.g. „Sofa an die Wand oben, beim Fenster“. */
  text: string;
  /** Why it was not done or done differently. */
  note?: string;
  why: string;
}

export interface EditPlan {
  /** Moved and new pieces; `replaces` = the originals (hidden in the preview, removed when taken). */
  preview: FurnishingSuggestion;
  results: EditResult[];
}

const ORDER: EditChange['op'][] = ['remove', 'kitchen', 'replace', 'move', 'add'];

/**
 * Carries the changes out on a copy of the plan (removes first, then kitchen runs, replacements,
 * moves, additions; each sees the earlier ones) and returns the difference as a preview.
 */
export function planEdits(project: Project, input: EditInput, answer: EditAnswer, opts: { roomTypes?: Record<string, RoomType>; catalog?: CatalogItem[] } = {}): EditPlan {
  const catalog = opts.catalog ?? [];
  const draft = structuredClone(project);
  const derived = derivePlan(project);
  const typeOf = (id: string) => opts.roomTypes?.[id] ?? guessRoomType(project.rooms.find((r) => r.id === id)?.name ?? '');
  const results: EditResult[] = [];
  const byId = (id: string) => draft.furniture.find((f) => f.id === id);
  const lookup = (id: string) => catalog.find((c) => c.id === id) ?? findCatalogItem(id);
  const wallText = (roomId: string, i: number | undefined) => (i === undefined ? '' : ` an die Wand ${input.walls[roomId][i].side} (W${i + 1})`);
  const nearText = (n?: EditNear) => (!n ? '' : n.kind === 'window' ? ' beim Fenster' : n.kind === 'door' ? ' bei der Tür' : n.kind === 'zone' ? ` in den Bereich „${project.zones?.find((z) => z.id === n.zoneId)?.purpose || 'ohne Angabe'}“` : ` bei „${byId(n.furnitureId)?.name ?? 'Möbel'}“`);
  const moving = new Set(answer.changes.flatMap((c) => (c.op === 'move' || c.op === 'replace' ? [c.furnitureId] : [])));

  const target = (roomId: string, wall?: number, n?: EditNear): PlaceTarget => {
    const ws = input.walls[roomId] ?? [];
    const w = wall !== undefined ? ws[wall] : undefined;
    let point: Vec2 | undefined;
    if (n?.kind === 'item') {
      const o = byId(n.furnitureId);
      if (o) point = { x: o.x, y: o.y };
    } else if (n?.kind === 'zone') {
      const z = project.zones?.find((x) => x.id === n.zoneId);
      if (z) return { ...(w ? { wall: { a: w.a, b: w.b } } : {}), near: zoneCenter(z), zoneId: z.id };
    } else if (n) {
      const pts = (w ? [w] : ws).flatMap((x) => (n.kind === 'window' ? x.windows : x.doors));
      const all = pts.length ? pts : ws.flatMap((x) => (n.kind === 'window' ? x.windows : x.doors));
      point = all[0];
    }
    return { ...(w ? { wall: { a: w.a, b: w.b } } : {}), ...(point ? { near: point } : {}) };
  };

  const runMoves = (moves: Extract<EditChange, { op: 'move' }>[], aside: boolean): EditResult[] =>
    moves.flatMap((c, i): EditResult[] => {
      const f = byId(c.furnitureId);
      if (!f) return [];
      const pending = aside ? moves.slice(i + 1).map((x) => x.furnitureId) : [];
      const placed = placeNear(draft, c.roomId, typeOf(c.roomId), f, target(c.roomId, c.wall, c.near), pending);
      const roomName = project.rooms.find((r) => r.id === c.roomId)?.name || 'Raum ohne Namen';
      const text = `„${f.name}“${roomIdAt(project, derived, f) !== c.roomId ? ` nach „${roomName}“` : ''}${wallText(c.roomId, c.wall)}${nearText(c.near)}`;
      if (!placed) return [{ ok: false, text, note: 'kein freier Platz gefunden, bleibt stehen', why: c.why }];
      Object.assign(f, { x: placed.furniture.x, y: placed.furniture.y, rotation: placed.furniture.rotation });
      return [{ ok: true, text, ...(placed.onTarget ? {} : { note: 'am gewünschten Ort war kein Platz, steht jetzt an der nächsten freien Stelle' }), why: c.why }];
    });

  const sorted = [...answer.changes].sort((p, q) => ORDER.indexOf(p.op) - ORDER.indexOf(q.op));
  let movesDone = false;
  for (const c of sorted) {
    if (c.op === 'remove') {
      const f = byId(c.furnitureId);
      if (!f) continue;
      draft.furniture = draft.furniture.filter((x) => x.id !== f.id);
      results.push({ ok: true, text: `„${f.name}“ entfernen`, why: c.why });
    } else if (c.op === 'kitchen') {
      results.push({ ...moveKitchen(draft, derived, input, c, moving), why: c.why });
    } else if (c.op === 'replace') {
      const f = byId(c.furnitureId);
      const item = lookup(c.catalogId);
      const roomId = f ? roomIdAt(project, derived, f) : null;
      if (!f || !item || !roomId) continue;
      const back = sub(f, scale(frontOf(f), f.depth / 2));
      const at = add(back, scale(frontOf(f), item.depth / 2));
      const fresh = createFurnitureFromCatalog(item, { x: at.x, y: at.y, rotation: f.rotation });
      fresh.quantity = f.quantity;
      if (f.suggested) fresh.suggested = true;
      if (f.buyPhase) fresh.buyPhase = f.buyPhase;
      const wi = wallOf(f, input.walls[roomId] ?? []);
      const placed = placeNear(draft, roomId, typeOf(roomId), fresh, { near: at, ...(wi >= 0 ? { wall: { a: input.walls[roomId][wi].a, b: input.walls[roomId][wi].b } } : {}) }, [f.id]);
      const text = `„${f.name}“ durch „${item.name}“ ersetzen`;
      if (!placed) results.push({ ok: false, text, note: 'dafür ist dort kein freier Platz', why: c.why });
      else {
        draft.furniture = [...draft.furniture.filter((x) => x.id !== f.id), placed.furniture];
        results.push({ ok: true, text, ...(dist(placed.furniture, at) > 0.3 ? { note: 'steht etwas versetzt, weil es an der alten Stelle nicht passt' } : {}), why: c.why });
      }
    } else if (c.op === 'move') {
      if (movesDone) continue;
      movesDone = true;
      // a swap („Sofa und Schreibtisch tauschen“): first try with the pieces still to move out of the way; if one then finds no place, again one after another
      const moves = sorted.filter((x): x is Extract<EditChange, { op: 'move' }> => x.op === 'move');
      const snapshot = structuredClone(draft.furniture);
      let out = runMoves(moves, true);
      if (out.some((r) => !r.ok)) {
        draft.furniture = snapshot;
        out = runMoves(moves, false);
      }
      results.push(...out);
    } else {
      const item = lookup(c.catalogId);
      if (!item) continue;
      const text = `${c.quantity > 1 ? `${c.quantity}× ` : ''}„${item.name}“ hinzufügen${wallText(c.roomId, c.wall)}${nearText(c.near)}`;
      let placed = 0;
      if (c.wall === undefined && !c.near) {
        const s = suggestFurnishing(draft, [{ roomId: c.roomId, type: typeOf(c.roomId), wishes: [{ catalogId: c.catalogId, quantity: c.quantity }] }], catalog);
        draft.furniture.push(...s.items);
        placed = s.items.length;
      } else {
        for (let i = 0; i < c.quantity; i++) {
          const fresh = createFurnitureFromCatalog(item, { x: 0, y: 0 });
          fresh.suggested = true;
          const p = placeNear(draft, c.roomId, typeOf(c.roomId), fresh, target(c.roomId, c.wall, c.near));
          if (!p) break;
          draft.furniture.push(p.furniture);
          placed++;
        }
      }
      results.push({ ok: placed > 0, text, ...(placed === 0 ? { note: 'kein freier Platz gefunden' } : placed < c.quantity ? { note: `nur ${placed} von ${c.quantity} passen` } : {}), why: c.why });
    }
  }

  const before = new Map(project.furniture.map((f) => [f.id, JSON.stringify(f)]));
  const after = new Set(draft.furniture.map((f) => f.id));
  const items = draft.furniture.filter((f) => before.get(f.id) !== JSON.stringify(f));
  const replaces = project.furniture.filter((f) => !after.has(f.id) || items.some((x) => x.id === f.id)).map((f) => f.id);
  return { preview: { rooms: [], items, replaces }, results };
}

/** Moves kitchen run `c.run` to wall `c.wall` of its room (all modules or none); countertops are made anew. */
function moveKitchen(draft: Project, derived: DerivedPlan, input: EditInput, c: Extract<EditChange, { op: 'kitchen' }>, moving: Set<string>): Omit<EditResult, 'why'> {
  const w = input.walls[c.roomId][c.wall];
  const text = `Küchenzeile an die Wand ${w.side} (W${c.wall + 1})`;
  const ids = new Set(input.kitchenKeys[c.run].ids);
  const run = draft.furniture.filter((f) => ids.has(f.id));
  if (!run.length) return { ok: false, text, note: 'Küchenzeile nicht gefunden' };
  // the matching wall face: parallel to the edge, on the room side
  const mid = scale(add(w.a, w.b), 0.5);
  const dir = normalize(sub(w.b, w.a));
  const face = kitchenFaces(draft, c.roomId, derived)
    .map((f) => {
      const fp = derived.footprints.get(f.wallId)!;
      const off = dot(sub(mid, fp.a), fp.normal);
      const along = dot(sub(mid, fp.a), fp.dir);
      const ok = Math.abs(dot(fp.dir, dir)) > 0.98 && Math.sign(off) === f.side && along > -0.2 && along < fp.length + 0.2;
      return { f, score: ok ? Math.abs(Math.abs(off) - fp.thickness / 2) : Infinity };
    })
    .filter((x) => x.score < 0.15)
    .sort((p, q) => p.score - q.score)[0]?.f;
  if (!face) return { ok: false, text, note: 'an dieser Wand ist keine nutzbare Wandfläche' };
  const runDir = { x: Math.cos(run[0].rotation), y: Math.sin(run[0].rotation) };
  const floor = run.filter((f) => !ABOVE.has(f.kitchen!.type)).sort((p, q) => dot(p, runDir) - dot(q, runDir));
  const above = run.filter((f) => ABOVE.has(f.kitchen!.type));
  const groups = floor.map((f) => ({ floor: f, above: [] as Furniture[] }));
  for (const a of above) {
    const t = dot(a, runDir);
    const g = groups.find((x) => Math.abs(dot(x.floor, runDir) - t) <= x.floor.width / 2) ?? [...groups].sort((p, q) => Math.abs(dot(p.floor, runDir) - t) - Math.abs(dot(q.floor, runDir) - t))[0];
    if (g) g.above.push(a);
  }
  const order = (gs: typeof groups) => gs.flatMap((g) => [...g.above, g.floor]);
  const asModule = (f: Furniture): RunModule => ({ catalogId: f.catalogId ?? f.id, item: { id: f.catalogId ?? f.id, name: f.name, category: f.category, width: f.width, depth: f.depth, height: f.height, elevation: f.elevation, color: f.color, model: f.model, approximate: f.approximate, solid: f.solid, kitchen: f.kitchen, tags: [], source: 'generic' } });
  const length = floor.reduce((s, f) => s + f.width, 0);
  if (length > face.length + 0.005) return { ok: false, text, note: `die Zeile (${m2(length)} m) ist länger als die Wand (${m2(face.length)} m)` };
  const oldTops = draft.furniture.filter((f) => f.kitchen?.type === 'countertop' && f.kitchen.generated && run.some((m) => Math.cos(m.rotation - f.rotation) > 0.999 && dist(m, f) < 1.2 + m.width));
  const gone = new Set([...run.map((f) => f.id), ...oldTops.map((f) => f.id), ...moving]);
  const rest: Project = { ...draft, furniture: draft.furniture.filter((f) => !gone.has(f.id)) };
  const steps = 12;
  let best: { pieces: Furniture[]; problem: string | null; free: number } | null = null;
  for (const gs of groups.length ? [groups, [...groups].reverse()] : [groups]) {
    const list = order(gs);
    for (let i = 0; i <= steps; i++) {
      const start = ((face.length - length) * i) / steps;
      const { slots } = layoutKitchenRun(rest, { wallId: face.wallId, side: face.side, start, modules: list.map(asModule) }, derived);
      const problems = slots.map((s) => s.problem ?? (roomIdAt(draft, derived, s.furniture) !== c.roomId ? 'läge außerhalb des Raums' : null));
      const free = problems.filter((p) => !p).length;
      if (!best || free > best.free) best = { pieces: slots.map((s, j) => ({ ...structuredClone(list[j]), x: s.furniture.x, y: s.furniture.y, rotation: s.furniture.rotation })), problem: problems.find(Boolean) ?? null, free };
      if (free === list.length) break;
    }
    if (best && best.free === run.length) break;
  }
  if (!best || best.free < run.length) return { ok: false, text, note: `passt dort nicht${best?.problem ? `: ein Modul ${best.problem}` : ''}` };
  const temp: Project = { ...draft, furniture: best.pieces.map((f) => structuredClone(f)), groups: [] };
  generateCountertops(temp);
  const tops = temp.furniture.filter((f) => f.kitchen?.type === 'countertop');
  const moved = new Map(best.pieces.map((f) => [f.id, f]));
  draft.furniture = [...draft.furniture.filter((f) => !oldTops.includes(f)).map((f) => moved.get(f.id) ?? f), ...tops];
  return { ok: true, text };
}
