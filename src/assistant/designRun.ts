/**
 * Asks Claude for the furnishing proposal of the whole apartment (#350). With several rooms the
 * work is split: one request per room, a few at the same time (a single request for the whole
 * apartment grows with the room count and was slow). To keep the rooms consistent, every
 * request carries the same wishes, style and colours and the plan summary of its room plus the
 * names and types of the other rooms; the budget is split by room area before asking, so the
 * parts add up to the total.
 */
import type { CatalogItem } from '../catalog/types';
import { findCatalogItem } from '../catalog/generic';
import type { Project } from '../model/schema';
import { derivePlan, type DerivedPlan } from '../model/derived';
import { closestPointOnSegment, pointInPolygon } from '../model/vec';
import { guessRoomType, roomIdAt, suggestedIn, suggestFurnishing, type RoomType, type WishItem } from '../suggest/furnishing';
import { isKeepFree, zoneLabels, zoneRoomId } from '../model/zones';
import type { Sample, SampleError } from './claude';
import { buildDesignPrompt, parseDesignAnswer, PLACEHOLDERS, preselect, type DesignProposal, type DesignRoom, type DesignWishes, MAX_PRODUCTS } from './design';
import { completeRoom } from './designGuide';
import { hasKitchen, kitchenFaces } from './kitchenDesign';
import { runPool } from './pool';
import { summarizePlan } from './planSummary';

/** Requests to Claude running at the same time (the local helper allows 4). */
export const DESIGN_PARALLEL = 3;
/** Own products offered per room when the apartment is asked room by room. */
export const MAX_PRODUCTS_PER_ROOM = 40;

/** Splits `total` by weight (room area); 0 stays 0 (no budget). Parts are rounded to 10 € and never negative. */
export function budgetShares(weights: number[], total: number): number[] {
  if (!(total > 0)) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + Math.max(b, 0), 0);
  return weights.map((w) => (sum > 0 ? Math.max(10, Math.round((total * Math.max(w, 0)) / sum / 10) * 10) : Math.round(total / weights.length / 10) * 10));
}

export interface DesignRunInput {
  sample: Pick<Sample, 'json'>;
  project: Project;
  roomIds: string[];
  roomTypes: Record<string, RoomType>;
  wishes: DesignWishes;
  products: CatalogItem[];
  /** „Gefällt mir nicht“ (#350): what the user wants different, for a rerun of these rooms. */
  feedback?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface DesignRunResult {
  proposal: DesignProposal;
  /** Rooms whose request failed or gave nothing usable (the rest is still shown). */
  failedRooms: string[];
  /** Products offered to Claude (union over the rooms), needed to look picks up later. */
  offered: CatalogItem[];
}

const nameOf = (project: Project, id: string) => project.rooms.find((r) => r.id === id)?.name || 'Raum ohne Namen';
const isFatal = (e: unknown) => {
  const code = (e as SampleError | undefined)?.code;
  return code !== undefined && code !== 'invalid_json' && code !== 'empty_completion' && code !== 'upstream_error';
};

const cm = (v: number) => Math.round(v * 100);

/** Claude's picks of a room as the wish list of the placement, with their marked area (#416). */
export const designWishes = (room: DesignRoom): WishItem[] => room.picks.map((p) => ({ catalogId: p.catalogId, quantity: p.quantity, ...(p.zone ? { zoneId: p.zone } : {}) }));

/**
 * The planner's check of Claude's picks for one room (#350, `completeRoom`): misfits out, missing
 * essentials in as placeholders, a mattress for a bare bed frame. Changes `room` in place.
 */
export function finishRoom(room: DesignRoom, project: Project, derived: DerivedPlan, type: RoomType, lookup: (id: string) => CatalogItem | undefined): void {
  const g = derived.rooms.get(room.roomId);
  const existing = project.furniture.filter((f) => roomIdAt(project, derived, f) === room.roomId);
  const r = completeRoom({ type, picks: room.picks, existing, area: g?.area ?? 0, hasWindow: roomHasWindow(project, room.roomId), lookup });
  room.picks = room.picks.filter((_, i) => !r.drop.includes(i));
  for (const a of r.add) {
    const c = findCatalogItem(a.catalogId);
    if (!c) continue;
    const same = room.picks.find((p) => p.catalogId === a.catalogId);
    if (same) continue;
    room.picks.push({ catalogId: a.catalogId, quantity: a.quantity, reason: a.why, placeholder: true, label: c.name, search: c.name, alternatives: [] });
  }
  room.fixes = [...(room.fixes ?? []), ...r.fixes];
}

function roomHasWindow(project: Project, roomId: string): boolean {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  const nodes = new Set(room.nodeIds);
  const walls = new Set(project.walls.filter((w) => nodes.has(w.a) && nodes.has(w.b)).map((w) => w.id));
  return project.openings.some((o) => o.kind === 'window' && walls.has(o.wallId));
}

/**
 * How the planner placed Claude's picks (#350, second round „gründlich“): what stands where
 * (at a wall, hanging, free in the room), what found no place and why, what the planner changed.
 */
export function placementReport(project: Project, room: DesignRoom, type: RoomType, catalog: CatalogItem[]): string {
  const s = suggestFurnishing(project, [{ roomId: room.roomId, type, wishes: designWishes(room) }], catalog, { replace: suggestedIn(project, [room.roomId]) });
  const r = s.rooms[0];
  const d = derivePlan(project);
  const g = d.rooms.get(room.roomId);
  const atWall = (f: { x: number; y: number; depth: number }) => !!g && g.interior.some((a, i) => closestPointOnSegment(f, a, g.interior[(i + 1) % g.interior.length]).distance < f.depth / 2 + 0.06);
  // marked areas (#416): which zone each item stands in, and zones that stayed empty
  const keys = zoneLabels(project.zones ?? []);
  const zones = (project.zones ?? []).filter((z) => zoneRoomId(project, d, z) === room.roomId);
  const inZone = (f: { x: number; y: number }) => zones.find((z) => pointInPolygon(f, z.points));
  const lines = (r?.placed ?? []).map((f) => {
    const z = inZone(f);
    return `- ${f.name} (${cm(f.width)}×${cm(f.depth)} cm): ${f.elevation > 0.6 ? `hängt an der Wand in ${cm(f.elevation)} cm Höhe` : f.elevation > 0.05 ? `steht auf einem Möbel` : atWall(f) ? 'an der Wand' : 'frei im Raum'}${z ? `, im Bereich ${keys.get(z.id)}` : ''}`;
  });
  const empty = zones
    .filter((z) => !isKeepFree(z.purpose) && !(r?.placed ?? []).some((f) => f.elevation < 0.05 && pointInPolygon(f, z.points)))
    .map((z) => `- Bereich ${keys.get(z.id)} „${z.purpose || 'ohne Angabe'}“ ist leer geblieben – Möbel dafür mit "zone":"${keys.get(z.id)}" einplanen`);
  const missing = (r?.notes ?? []).map((n) => `- kein Platz: ${n.name} – ${n.why}`);
  const fixes = (room.fixes ?? []).map((f) => `- Planer hat ${f.kind === 'added' ? 'ergänzt' : 'weggelassen'}: ${f.name} (${f.why})`);
  const area = g ? `Raumfläche ${g.area.toFixed(1)} m², davon zugestellt ca. ${(((r?.placed ?? []).filter((f) => f.elevation < 0.05 && f.solid).reduce((a, f) => a + f.width * f.depth, 0) / Math.max(g.area, 0.1)) * 100).toFixed(0)} %.` : '';
  return [area, 'Aufgestellt:', ...(lines.length ? lines : ['- nichts']), ...missing, ...empty, ...fixes].filter(Boolean).join('\n');
}

export async function runDesign(input: DesignRunInput): Promise<DesignRunResult> {
  const { sample, roomIds, roomTypes, wishes, products, signal, onProgress, feedback } = input;
  // furniture of an earlier proposal is replaced by this one (#350): Claude plans as if it were not there
  const project: Project = { ...input.project, furniture: input.project.furniture.filter((f) => !f.suggested) };
  const typeOf = (id: string) => roomTypes[id] ?? guessRoomType(nameOf(project, id));
  const derived = derivePlan(project);
  // a kitchen room without kitchen run: Claude plans the run from its wall faces
  const facesOf = (id: string) => (typeOf(id) === 'kitchen' && !hasKitchen(project, id, derived) ? kitchenFaces(project, id, derived) : []);
  const kitchenRooms = roomIds.filter((id) => facesOf(id).length);
  const thorough = wishes.quality !== 'fast';
  const opts = (label: string) => ({ signal, modelTier: 'complex' as const, label, ...(thorough ? { model: 'opus' as const } : {}) });
  const single = roomIds.length <= 1;
  const shares = single ? [wishes.budget] : budgetShares(roomIds.map((id) => derived.rooms.get(id)?.area ?? 0), wishes.budget);
  const steps = thorough ? 2 : 1;
  const total = Math.max(1, roomIds.length) * steps;
  let done = 0;
  onProgress?.(0, total);

  /** One room: first answer, planner check, and in „gründlich“ a second round with the placement report. */
  const designRoom = async (id: string | undefined, i: number): Promise<{ proposal: DesignProposal; offer: CatalogItem[] }> => {
    const offer = single ? preselect(products, roomIds.map(typeOf), wishes.budget, MAX_PRODUCTS) : preselect(products, [typeOf(id!)], shares[i], MAX_PRODUCTS_PER_ROOM);
    const plan = summarizePlan(project, { roomTypes, focusRoomId: id ?? null });
    const others = roomIds
      .filter((x) => x !== id)
      .map((x) => `${nameOf(project, x)} (${typeOf(x)})`)
      .join(', ');
    const room = single ? undefined : { others, wholeBudget: wishes.budget };
    const extra = { types: id ? [typeOf(id)] : roomIds.map(typeOf), ...(feedback ? { feedback } : {}) };
    const faces = id ? facesOf(id) : undefined;
    const label = `Einrichtung: ${id ? nameOf(project, id) : 'Wohnung'}${single ? '' : ` (${i + 1} von ${roomIds.length} Räumen)`}`;
    const catalog = [...offer, ...PLACEHOLDERS];
    const lookup = (c: string) => catalog.find((x) => x.id === c);
    const finish = (p: DesignProposal) => {
      for (const r of p.rooms) {
        // the type the user chose wins over Claude's, then Claude's over the guess from the name
        r.type = roomTypes[r.roomId] ?? r.type ?? typeOf(r.roomId);
        finishRoom(r, project, derived, r.type, lookup);
      }
      return p;
    };
    const w = { ...wishes, budget: shares[i] };
    const first = finish(parseDesignAnswer(await sample.json(buildDesignPrompt(w, plan, offer, undefined, room, faces, extra), opts(label)), plan, id ? [id] : roomIds, offer, undefined, kitchenRooms));
    onProgress?.(++done, total);
    if (!thorough) return { proposal: first, offer };
    // second round: Claude sees how its picks were placed and improves the room (keeps the first answer if that fails)
    const rooms: DesignRoom[] = [];
    for (const r of first.rooms) {
      const review = placementReport(project, r, r.type ?? typeOf(r.roomId), catalog);
      const prev = JSON.stringify({ room: Object.entries(plan.roomKeys).find(([, v]) => v === r.roomId)?.[0], type: r.type, brief: r.brief, items: r.picks.map((p) => ({ catalogId: p.catalogId, quantity: p.quantity, ...(p.zone ? { zone: Object.entries(plan.zoneKeys).find(([, v]) => v === p.zone)?.[0] } : {}) })) });
      try {
        const again = parseDesignAnswer(
          await sample.json(buildDesignPrompt(w, plan, offer, undefined, room, faces, { ...extra, review: `Dein erster Vorschlag: ${prev}\n${review}` }), opts(`${label}, Nachprüfung`)),
          plan,
          [r.roomId],
          offer,
          undefined,
          kitchenRooms,
        );
        const better = finish(again).rooms.find((x) => x.roomId === r.roomId);
        rooms.push(better ? { ...better, kitchen: better.kitchen ?? r.kitchen, brief: better.brief ?? r.brief, reviewed: true } : r);
      } catch (e) {
        if (signal?.aborted || isFatal(e)) throw e;
        rooms.push(r);
      }
    }
    onProgress?.(++done, total);
    return { proposal: { ...first, rooms }, offer };
  };

  if (single) {
    const { proposal, offer } = await designRoom(roomIds[0], 0);
    return { proposal, failedRooms: [], offered: offer };
  }

  const parts: DesignProposal[] = [];
  const offered = new Map<string, CatalogItem>();
  const failed: string[] = [];
  await runPool(
    roomIds,
    DESIGN_PARALLEL,
    async (id, i) => {
      try {
        const { proposal, offer } = await designRoom(id, i);
        parts.push(proposal);
        for (const c of offer) offered.set(c.id, c);
      } catch (e) {
        if (signal?.aborted || isFatal(e)) throw e;
        failed.push(id);
        done += steps;
        onProgress?.(Math.min(done, total), total);
      }
    },
    () => !!signal?.aborted,
  );
  if (!parts.length) throw failed.length ? { code: 'invalid_json' } satisfies SampleError : new Error('Keine verwertbaren Möbel.');
  const order = new Map(roomIds.map((id, i) => [id, i]));
  const rooms = parts.flatMap((p) => p.rooms).sort((a, b) => (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0));
  const concepts = rooms.map((r) => `${nameOf(project, r.roomId)}: ${r.concept}`).filter((s) => !s.endsWith(': '));
  const summary = [`${wishes.style ? `Stil „${wishes.style}“ durch alle Räume.` : ''}`, ...concepts].filter(Boolean).join(' ').slice(0, 800);
  return { proposal: { summary, rooms, dropped: parts.reduce((a, p) => a + p.dropped, 0) }, failedRooms: failed, offered: [...offered.values()] };
}
