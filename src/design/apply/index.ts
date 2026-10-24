/**
 * Einbau (#442): the placed rooms of the new proposal become furniture of the project. Every
 * piece keeps the exact pose the solver found; placeholders get Claude's description as name and
 * the colour of the programme; each kitchen run gets its worktop. The result is the
 * `FurnishingSuggestion` the old proposal uses too, so the preview in 2D and 3D and „Übernehmen“
 * (one undo step) work unchanged. It also carries the zones of the programmes for the 2D plan.
 */
import { findCatalogItem } from '../../catalog/generic';
import { createFurnitureFromCatalog } from '../../catalog/instantiate';
import type { CatalogItem } from '../../catalog/types';
import { generateCountertops } from '../../kitchen/kitchen';
import type { Furniture, Project } from '../../model/schema';
import { suggestedIn, type FurnishingSuggestion, type RoomSuggestion, type RoomType } from '../../suggest/furnishing';
import type { Layout, ProgramItem, RoomAnalysis, RoomProgram } from '../types';

/** One room of the new proposal as placed by the solver. */
export interface PlacedRoom {
  analysis: RoomAnalysis;
  type: RoomType;
  layout: Layout;
  program?: RoomProgram;
}

export interface RoomFurniture {
  furniture: Furniture[];
  /** Programme pieces that found no place, with the solver's reason. */
  notes: { name: string; why: string }[];
}

/** Hundredths of a millimetre: tidy numbers, far below the plan's 0.1 mm wall tolerance (#442). */
const tidy = (v: number) => Math.round(v * 1e5) / 1e5;
const MAX_NAME = 200;

/** A generic catalogue piece standing in for a product still to be found. */
export const isPlaceholderId = (catalogId: string) => findCatalogItem(catalogId)?.id === catalogId && catalogId.startsWith('generic-');

/** Name a piece shows in the plan: Claude's description for a placeholder, else the product name. */
export function pieceName(item: CatalogItem, prog: ProgramItem | undefined): string {
  const label = prog?.label?.trim();
  return (label && isPlaceholderId(item.id) ? `${label} (Platzhalter)` : item.name).slice(0, MAX_NAME);
}

/** Furniture of one placed room (suggested, not yet in the project), worktops included. */
export function layoutFurniture(project: Project, room: PlacedRoom, catalog: CatalogItem[] = []): RoomFurniture {
  const progs = new Map((room.program?.items ?? []).map((i) => [i.id, i]));
  const furniture: Furniture[] = [];
  const notes: RoomFurniture['notes'] = [];
  for (const p of room.layout.items) {
    const item = findCatalogItem(p.catalogId, catalog);
    const prog = progs.get(p.id);
    if (!item) {
      notes.push({ name: prog?.label || p.catalogId, why: 'Produkt ist nicht mehr im Katalog' });
      continue;
    }
    // the rotation stays exact: rounded, a 2 m runner flush with a wall would tilt into it
    const f = createFurnitureFromCatalog(item, { x: tidy(p.x), y: tidy(p.y), rotation: p.rotation });
    f.name = pieceName(item, prog);
    f.width = tidy(p.width);
    f.depth = tidy(p.depth);
    f.height = tidy(p.height);
    f.elevation = tidy(p.elevation);
    if (prog?.color && isPlaceholderId(item.id)) f.color = prog.color;
    f.suggested = true;
    furniture.push(f);
  }
  const floor = furniture.filter((f) => f.kitchen && f.elevation < 0.01);
  if (floor.length) {
    const temp: Project = { ...project, furniture: floor, groups: [] };
    generateCountertops(temp);
    for (const t of temp.furniture) if (t.kitchen?.type === 'countertop') furniture.push({ ...t, suggested: true });
  }
  for (const d of room.layout.dropped) {
    const prog = progs.get(d.id);
    const name = prog?.label || findCatalogItem(d.catalogId, catalog)?.name || d.id;
    notes.push({ name, why: d.reason });
  }
  return { furniture, notes };
}

/**
 * Preview of the new proposal for these rooms. Furniture of an earlier, applied proposal in
 * the same rooms is replaced (never stacked); what the user placed stays.
 */
export function layoutSuggestion(project: Project, rooms: PlacedRoom[], catalog: CatalogItem[] = []): FurnishingSuggestion {
  const out: RoomSuggestion[] = rooms.map((r) => {
    const { furniture, notes } = layoutFurniture(project, r, catalog);
    return { roomId: r.analysis.roomId, roomName: r.analysis.name, type: r.type, placed: furniture, missing: notes.map((n) => n.name), notes };
  });
  const zones = rooms.flatMap((r) =>
    (r.program?.zones ?? []).map((z) => ({
      roomId: r.analysis.roomId,
      id: z.id,
      label: z.function,
      points: [
        { x: z.rect.x0, y: z.rect.y0 },
        { x: z.rect.x1, y: z.rect.y0 },
        { x: z.rect.x1, y: z.rect.y1 },
        { x: z.rect.x0, y: z.rect.y1 },
      ],
    })),
  );
  return { rooms: out, items: out.flatMap((r) => r.placed), replaces: suggestedIn(project, rooms.map((r) => r.analysis.roomId)), zones };
}
