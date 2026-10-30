/**
 * The finished run as the furnishing panel shows it (#442): the rooms of a `FlatResult` become
 * the `DesignProposal` the panel already knows (list of pieces with reason, placeholders for the
 * product search, the design brief per room), and the placed rooms become the preview in 2D and
 * 3D. Pieces of the same kind in the same zone are shown as one line with a count; each line
 * remembers which programme pieces it stands for, so a found product can go back into the
 * programme and the room is placed anew.
 */
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import type { DesignBrief, DesignPick, DesignProposal, DesignRoom } from '../../assistant/design';
import type { Project } from '../../model/schema';
import type { RoomType } from '../../suggest/furnishing';
import { roomConceptOf } from '../concept/flatConcept';
import { reviewFlat, reviewRoom } from '../review';
import { BALANCED } from '../review/overallRules';
import { asPlaced, reviewInputOf, type FurnishRunResult } from '../run';
import { existingPieces, solveRoom } from '../solver/solve';
import type { FlatResult, ProgramItem, RoomResult } from '../types';
import { isPlaceholderId, type PlacedRoom } from './index';

/** The placed rooms for the preview; the type comes from the concept unless the user set one. */
export function placedRooms(result: FlatResult, roomTypes: Record<string, RoomType> = {}): PlacedRoom[] {
  return result.rooms.flatMap((r) => {
    const analysis = result.analysis.rooms.find((a) => a.roomId === r.roomId);
    if (!analysis) return [];
    const type = (roomTypes[r.roomId] ?? roomConceptOf(result.concept, analysis).type) as RoomType;
    return [{ analysis, type, layout: r.layout, program: r.program }];
  });
}

/** What the room is for, in the words of the concept and the programme. */
function briefOf(result: FlatResult, room: RoomResult): DesignBrief | undefined {
  const analysis = result.analysis.rooms.find((a) => a.roomId === room.roomId);
  if (!analysis) return undefined;
  const rc = roomConceptOf(result.concept, analysis);
  return {
    purpose: rc.role,
    zones: room.program.zones.map((z) => `${z.function}: ${z.why}`),
    focus: rc.anchors.join(', '),
    paths: room.program.walk,
    palette: result.concept.style.palette.map((c) => c.hex),
    decor: rc.accent ? `Akzent ${rc.accent}` : '',
  };
}

/** Pieces of the same kind, in the same zone, with the same description are one line. */
function picksOf(room: RoomResult, catalog: CatalogItem[]): DesignPick[] {
  const dropped = new Set(room.layout.dropped.map((d) => d.id));
  const byKey = new Map<string, DesignPick & { items: string[] }>();
  const placed = new Map(room.layout.items.map((i) => [i.id, i]));
  for (const it of room.program.items) {
    if (dropped.has(it.id)) continue;
    // a piece the placement had to make smaller is shown as what really stands there
    const catalogId = placed.get(it.id)?.catalogId ?? it.catalogId;
    const item = catalog.find((c) => c.id === catalogId) ?? findCatalogItem(catalogId);
    if (!item) continue;
    const key = `${catalogId}|${it.zone}|${it.label ?? ''}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.quantity++;
      seen.items.push(it.id);
      continue;
    }
    byKey.set(key, {
      catalogId,
      quantity: 1,
      reason: it.why,
      placeholder: isPlaceholderId(catalogId),
      label: it.label ?? item.name,
      search: it.label ?? item.name,
      ...(it.color ? { color: it.color } : {}),
      ...(it.features?.length ? { features: it.features } : {}),
      zone: it.zone,
      alternatives: [],
      items: [it.id],
    });
  }
  return [...byKey.values()];
}

/** The programme items a shown line stands for (set by `picksOf`). */
export const pickItems = (p: DesignPick): string[] => (p as DesignPick & { items?: string[] }).items ?? [];

/** The programme piece behind an id, for the product search. */
export const programItem = (room: RoomResult, id: string): ProgramItem | undefined => room.program.items.find((i) => i.id === id);

export function proposalFrom(result: FlatResult, project: Project, roomTypes: Record<string, RoomType> = {}, catalog: CatalogItem[] = []): DesignProposal {
  const rooms: DesignRoom[] = result.rooms.flatMap((r) => {
    const analysis = result.analysis.rooms.find((a) => a.roomId === r.roomId);
    if (!analysis || !project.rooms.some((p) => p.id === r.roomId)) return [];
    const rc = roomConceptOf(result.concept, analysis);
    const brief = briefOf(result, r);
    return [
      {
        roomId: r.roomId,
        type: (roomTypes[r.roomId] ?? rc.type) as RoomType,
        concept: r.program.reading,
        ...(brief ? { brief } : {}),
        reviewed: r.rounds > 0,
        picks: picksOf(r, catalog),
        fixes: r.layout.dropped.map((d) => ({ kind: 'removed' as const, name: findCatalogItem(d.catalogId)?.name ?? d.catalogId, why: d.reason })),
      },
    ];
  });
  return { summary: result.concept.living, rooms, dropped: 0 };
}

export interface ProductSwap {
  roomId: string;
  /** Programme pieces this product stands for (`pickItems` of the shown line). */
  items: string[];
  catalogId: string;
}

/**
 * Stage 6 (#442): a found product goes into the programme and the room is placed and walked
 * through again – a real wardrobe is deeper than its placeholder and may block a door. A product
 * that brings a new severe finding or costs a piece its place is not taken; the placeholder stays
 * and the caller says why.
 */
export function withProduct(
  result: FurnishRunResult,
  project: Project,
  swap: ProductSwap,
  catalog: CatalogItem[],
  roomTypes: Record<string, RoomType> = {},
  seed = 1,
): { result: FurnishRunResult; taken: boolean; why?: string } {
  const index = result.rooms.findIndex((r) => r.roomId === swap.roomId);
  const room = result.rooms[index];
  const analysis = result.analysis.rooms.find((a) => a.roomId === swap.roomId);
  if (!room || !analysis) return { result, taken: false, why: 'Der Raum gehört nicht zu diesem Vorschlag.' };
  const ids = new Set(swap.items);
  const program = { ...room.program, items: room.program.items.map((it) => (ids.has(it.id) ? { ...it, catalogId: swap.catalogId } : it)) };
  const existing = existingPieces(project, analysis);
  const type = (roomTypes[swap.roomId] ?? roomConceptOf(result.concept, analysis).type) as RoomType;
  const layout = solveRoom(analysis, program, { existing, seed, catalog, spread: BALANCED.has(type) });
  const palette = result.concept.style.palette.map((c) => c.hex);
  const review = reviewRoom(reviewInputOf({ analysis, type, layout, program, existing: asPlaced(existing), palette, catalog }));
  const severe = (r: typeof review) => r.findings.filter((f) => f.severity === 'S').length;
  if (severe(review) > severe(room.review)) return { result, taken: false, why: review.findings.find((f) => f.severity === 'S')?.text ?? 'Die Begehung fand einen schweren Mangel.' };
  if (layout.dropped.length > room.layout.dropped.length) return { result, taken: false, why: layout.dropped.at(-1)?.reason ?? 'Damit passt ein anderes Möbel nicht mehr in den Raum.' };
  const rooms = [...result.rooms];
  rooms[index] = { ...room, program, layout, review };
  const inputs = rooms.map((r) => {
    const a = result.analysis.rooms.find((x) => x.roomId === r.roomId)!;
    return reviewInputOf({ analysis: a, type: (roomTypes[r.roomId] ?? roomConceptOf(result.concept, a).type) as RoomType, layout: r.layout, program: r.program, existing: asPlaced(existingPieces(project, a)), palette, catalog });
  });
  return { result: { ...result, rooms, review: reviewFlat(inputs) }, taken: true };
}
