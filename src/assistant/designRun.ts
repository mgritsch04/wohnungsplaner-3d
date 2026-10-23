/**
 * Asks Claude for the furnishing proposal of the whole apartment (#350). With several rooms the
 * work is split: one request per room, a few at the same time (a single request for the whole
 * apartment grows with the room count and was slow). To keep the rooms consistent, every
 * request carries the same wishes, style and colours and the plan summary of its room plus the
 * names and types of the other rooms; the budget is split by room area before asking, so the
 * parts add up to the total.
 */
import type { CatalogItem } from '../catalog/types';
import type { Project } from '../model/schema';
import { derivePlan } from '../model/derived';
import { guessRoomType, type RoomType } from '../suggest/furnishing';
import type { Sample, SampleError } from './claude';
import { buildDesignPrompt, parseDesignAnswer, preselect, type DesignProposal, type DesignWishes, MAX_PRODUCTS } from './design';
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

export async function runDesign(input: DesignRunInput): Promise<DesignRunResult> {
  const { sample, project, roomIds, roomTypes, wishes, products, signal, onProgress } = input;
  const typeOf = (id: string) => roomTypes[id] ?? guessRoomType(nameOf(project, id));
  const derived = derivePlan(project);
  // a kitchen room without kitchen run: Claude plans the run from its wall faces
  const facesOf = (id: string) => (typeOf(id) === 'kitchen' && !hasKitchen(project, id, derived) ? kitchenFaces(project, id, derived) : []);
  const kitchenRooms = roomIds.filter((id) => facesOf(id).length);
  if (roomIds.length <= 1) {
    const offer = preselect(
      products,
      roomIds.map(typeOf),
      wishes.budget,
      MAX_PRODUCTS,
    );
    const plan = summarizePlan(project, { roomTypes, focusRoomId: roomIds[0] ?? null });
    onProgress?.(0, 1);
    const label = `Einrichtung: ${roomIds.length ? nameOf(project, roomIds[0]) : 'Wohnung'}`;
    const raw = await sample.json(buildDesignPrompt(wishes, plan, offer, undefined, undefined, roomIds[0] ? facesOf(roomIds[0]) : undefined), { signal, modelTier: 'complex', label });
    onProgress?.(1, 1);
    return { proposal: parseDesignAnswer(raw, plan, roomIds, offer, undefined, kitchenRooms), failedRooms: [], offered: offer };
  }

  const shares = budgetShares(roomIds.map((id) => derived.rooms.get(id)?.area ?? 0), wishes.budget);
  const parts: DesignProposal[] = [];
  const offered = new Map<string, CatalogItem>();
  const failed: string[] = [];
  let done = 0;
  onProgress?.(0, roomIds.length);
  await runPool(
    roomIds,
    DESIGN_PARALLEL,
    async (id, i) => {
      const offer = preselect(products, [typeOf(id)], shares[i], MAX_PRODUCTS_PER_ROOM);
      const plan = summarizePlan(project, { roomTypes, focusRoomId: id });
      const others = roomIds
        .filter((x) => x !== id)
        .map((x) => `${nameOf(project, x)} (${typeOf(x)})`)
        .join(', ');
      const prompt = buildDesignPrompt({ ...wishes, budget: shares[i] }, plan, offer, undefined, { others, wholeBudget: wishes.budget }, facesOf(id));
      try {
        const raw = await sample.json(prompt, { signal, modelTier: 'complex', label: `Einrichtung: ${nameOf(project, id)} (${i + 1} von ${roomIds.length} Räumen)` });
        parts.push(parseDesignAnswer(raw, plan, [id], offer, undefined, kitchenRooms));
        for (const c of offer) offered.set(c.id, c);
      } catch (e) {
        if (signal?.aborted || isFatal(e)) throw e;
        failed.push(id);
      }
      onProgress?.(++done, roomIds.length);
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
