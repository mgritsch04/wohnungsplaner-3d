/**
 * The whole new furnishing run (#442), stages 0 to 5: read the room, ask Claude for a flat
 * concept and a room programme, place it millimetre-exact, walk through it, and let Claude
 * improve what the walk-through found – with the picture of its own room in front of it.
 *
 * Everything here is pure logic: the caller passes Claude (`sample`) and, where pictures are
 * possible, a function that turns a room plan into a PNG (that needs a browser). Without
 * pictures the critique sees the text map instead, so the run works in tests and in Node.
 */
import type { CatalogItem } from '../catalog/types';
import type { DesignWishes } from '../assistant/design';
import type { Sample, SampleError, SampleImage, SampleOptions } from '../assistant/claude';
import { runPool } from '../assistant/pool';
import type { Project } from '../model/schema';
import type { RoomType } from '../suggest/furnishing';
import { analyzeFlat, flatSketch, roomSketch } from './analysis';
import { roomConceptOf } from './concept/flatConcept';
import { runConcept, TIMEOUTS, type CallLog, type ConceptRunResult } from './concept/run';
import type { RoomProgramInput } from './concept/roomProgram';
import { buildCritiquePrompt, parseCritique, type CritiqueInput } from './critique';
import { roomPlanSvg, roomTextMap, type RoomPlan } from './render';
import { reviewFlat, reviewRoom, type ReviewInput } from './review';
import { existingPieces, solveRoom } from './solver/solve';
import type { FlatAnalysis, FlatResult, Layout, PlacedItem, RoomAnalysis, RoomProgram, RoomResult } from './types';

/** Rooms placed, walked through and criticised at the same time. */
export const RUN_PARALLEL = 3;
/** Critique rounds at most (the plan: two). */
export const MAX_ROUNDS = 2;

export type Stage = 'read' | 'concept' | 'program' | 'place' | 'review' | 'critique' | 'done';

export interface DesignRunProgress {
  stage: Stage;
  done: number;
  total: number;
  /** Room being worked on, where the stage is per room. */
  room?: string;
}

export interface FurnishRunInput {
  sample: Pick<Sample, 'json' | 'images'>;
  project: Project;
  wishes: DesignWishes;
  /** Rooms to furnish (default: all rooms of the flat). */
  roomIds?: string[];
  /** The user's choice of room type, where they made one. */
  roomTypes?: Record<string, RoomType>;
  /** The user's own products besides the generic placeholders. */
  products?: CatalogItem[];
  /** Turns a room plan into a PNG; only where this runs in a browser. */
  toImage?: (plan: RoomPlan) => Promise<SampleImage>;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (p: DesignRunProgress) => void;
  /** Overrides the time limits (tests). */
  timeouts?: { opus: number; sonnet: number };
}

export interface FurnishRunResult extends FlatResult {
  /** Rooms with no usable programme, with the reason. */
  failed: { roomId: string | null; reason: string }[];
  /** Problems the check of the concept found and Claude did not repair. */
  conceptProblems: string[];
  calls: CallLog[];
}

const codeOf = (e: unknown) => (e as SampleError | undefined)?.code ?? 'upstream_error';
const isCancel = (e: unknown) => codeOf(e) === 'cancelled';

/** A room is good enough when the walk-through passes it (no severe finding and at least 85 points). */
export const goodEnough = (r: RoomResult) => r.review.passed;

/** The better of two rounds: passing beats failing, then the higher score, then fewer dropped pieces. */
export function better(a: RoomResult, b: RoomResult): RoomResult {
  // a round that empties the room is never better, however few findings an empty room leaves
  if (b.layout.items.length * 2 < a.layout.items.length) return a;
  if (a.review.passed !== b.review.passed) return a.review.passed ? a : b;
  if (a.review.score !== b.review.score) return a.review.score > b.review.score ? a : b;
  return a.layout.dropped.length <= b.layout.dropped.length ? a : b;
}

/** The pieces already in the room, as the walk-through and the room picture want them. */
export const asPlaced = (pieces: ReturnType<typeof existingPieces>): PlacedItem[] => pieces.map((f) => ({ ...f, elevation: f.elevation ?? 0, zone: 'bestand' }));

/** The walk-through's input for one placed room: the same for the run and for the product step. */
export function reviewInputOf(args: { analysis: RoomAnalysis; type: RoomType; layout: Layout; program: RoomProgram; existing: PlacedItem[]; palette: string[]; catalog?: CatalogItem[] }): ReviewInput {
  const { analysis, type, layout, program, existing, palette } = args;
  return { analysis, type, layout, program, existing, palette, ...(args.catalog ? { catalog: args.catalog } : {}) };
}

interface RoomWork {
  analysis: RoomAnalysis;
  type: RoomType;
  base: RoomProgramInput;
  existing: ReturnType<typeof existingPieces>;
  review: (layout: Layout, program: RoomProgram) => ReviewInput;
}

/** Place and walk through one programme. */
function placeAndReview(work: RoomWork, program: RoomProgram, seed: number, rounds: number): RoomResult {
  const layout = solveRoom(work.analysis, program, { existing: work.existing, seed, catalog: work.base.products });
  const review = reviewRoom(work.review(layout, program));
  return { roomId: work.analysis.roomId, program, layout, review, rounds };
}

/**
 * Stage 5 for one room: at most `MAX_ROUNDS` times, show Claude the placed room and let it
 * change the programme, then place and walk through again. Keeps the best round. Any error in a
 * round simply ends the critique: the room keeps what it already has.
 */
async function critique(input: FurnishRunInput, work: RoomWork, first: RoomResult, image: (r: RoomResult) => Promise<SampleImage | undefined>, calls: CallLog[]): Promise<RoomResult> {
  let best = first;
  let current = first;
  for (let round = 1; round <= MAX_ROUNDS && !goodEnough(best); round++) {
    const model = input.wishes.quality === 'fast' ? 'sonnet' : 'opus';
    const label = `Kritik: ${work.analysis.name} (Runde ${round})`;
    const log: CallLog = { label, model, round, attempts: 1, ms: 0, problems: [] };
    const t0 = Date.now();
    calls.push(log);
    try {
      const img = await image(current);
      const ci: CritiqueInput = {
        base: work.base,
        program: current.program,
        layout: current.layout,
        review: current.review,
        round,
        ...(img ? { image: img } : { textMap: roomTextMap({ analysis: work.analysis, layout: current.layout, program: current.program, existing: asPlaced(work.existing), ...(work.base.products ? { catalog: work.base.products } : {}) }) }),
      };
      const opts: SampleOptions = { model, modelTier: model === 'opus' ? 'complex' : 'default', label, signal: input.signal, ...(img ? { images: [img] } : {}) };
      const raw = await withTimeout(input.sample.json(buildCritiquePrompt(ci), opts), (input.timeouts ?? TIMEOUTS)[model], input.signal);
      const checked = parseCritique(raw, ci);
      log.problems = checked.problems;
      current = placeAndReview(work, checked.value, (input.seed ?? 1) + round, round);
      best = better(best, current);
    } catch (e) {
      log.error = codeOf(e);
      if (isCancel(e)) throw e;
      break;
    } finally {
      log.ms = Date.now() - t0;
    }
  }
  return { ...best, rounds: current.rounds };
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject({ code: 'timeout', message: `keine Antwort nach ${Math.round(ms / 1000)} s` } satisfies SampleError), ms);
      signal?.addEventListener('abort', () => reject({ code: 'cancelled' } satisfies SampleError));
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** The whole run for a flat. Throws only when the user cancels or no room worked at all. */
export async function runFurnishing(input: FurnishRunInput): Promise<FurnishRunResult> {
  const { project, wishes, signal } = input;
  const report = (stage: Stage, done: number, total: number, room?: string) => input.onProgress?.({ stage, done, total, ...(room ? { room } : {}) });

  // stage 0: read every room
  report('read', 0, 1);
  const analysis: FlatAnalysis = analyzeFlat(project);
  const ctx = { project, flat: analysis };
  const roomIds = (input.roomIds ?? analysis.rooms.map((r) => r.roomId)).filter((id) => analysis.rooms.some((r) => r.roomId === id));
  report('read', 1, 1);

  // stages 1 and 2: flat concept and room programmes
  const concept: ConceptRunResult = await runConcept({
    sample: input.sample,
    project,
    analysis,
    flatSketch: flatSketch(ctx),
    roomSketch: (id) => {
      const room = analysis.rooms.find((r) => r.roomId === id);
      return room ? roomSketch(ctx, room) : '';
    },
    wishes,
    roomIds,
    ...(input.products ? { products: input.products } : {}),
    ...(signal ? { signal } : {}),
    ...(input.timeouts ? { timeouts: input.timeouts } : {}),
    onProgress: (done, total) => report(done === 0 ? 'concept' : 'program', done, total),
  });
  if (!concept.concept) throw (concept.failed[0] ? { code: 'upstream_error', message: concept.failed[0].reason } : { code: 'empty_completion' }) satisfies SampleError;

  // stages 3 to 5, room by room (a few at a time)
  const names = new Map(project.rooms.map((r) => [r.id, r.name]));
  const roomNames = Object.fromEntries(names);
  const results: RoomResult[] = [];
  const total = concept.programs.length;
  let done = 0;
  report('place', 0, total);
  let stopped: unknown = null;
  await runPool(
    concept.programs,
    RUN_PARALLEL,
    async (program) => {
      const room = analysis.rooms.find((r) => r.roomId === program.roomId);
      if (!room) return;
      const rc = roomConceptOf(concept.concept!, room);
      const type = (input.roomTypes?.[room.roomId] ?? rc.type) as RoomType;
      const palette = concept.concept!.style.palette.map((c) => c.hex);
      const existing = existingPieces(project, room);
      const work: RoomWork = {
        analysis: room,
        type,
        existing,
        base: {
          project,
          concept: concept.concept!,
          room,
          sketch: roomSketch(ctx, room),
          wishes,
          ...(input.products ? { products: input.products } : {}),
        },
        review: (layout, prog) => reviewInputOf({ analysis: room, type, layout, program: prog, palette, existing: asPlaced(existing), ...(input.products ? { catalog: input.products } : {}) }),
      };
      const image = async (r: RoomResult): Promise<SampleImage | undefined> => {
        if (!input.toImage || !input.sample.images) return undefined;
        try {
          return await input.toImage(roomPlanSvg({ analysis: room, layout: r.layout, program: r.program, review: r.review, roomNames, existing: asPlaced(existing), ...(input.products ? { catalog: input.products } : {}) }));
        } catch {
          return undefined; // no picture: the critique reads the text map
        }
      };
      try {
        const first = placeAndReview(work, program, input.seed ?? 1, 0);
        report('review', done, total, room.name);
        results.push(await critique(input, work, first, image, concept.calls));
      } catch (e) {
        if (isCancel(e)) stopped = e;
        else results.push(placeAndReview(work, program, input.seed ?? 1, 0));
      } finally {
        report('critique', ++done, total, room.name);
      }
    },
    () => stopped !== null || !!signal?.aborted,
  );
  if (stopped) throw stopped;
  if (signal?.aborted) throw { code: 'cancelled' } satisfies SampleError;
  const order = (id: string) => roomIds.indexOf(id);
  results.sort((a, b) => order(a.roomId) - order(b.roomId));

  const review = reviewFlat(
    results.map((r) => {
      const room = analysis.rooms.find((x) => x.roomId === r.roomId)!;
      const rc = roomConceptOf(concept.concept!, room);
      return reviewInputOf({ analysis: room, type: (input.roomTypes?.[r.roomId] ?? rc.type) as RoomType, layout: r.layout, program: r.program, palette: concept.concept!.style.palette.map((c) => c.hex), existing: asPlaced(existingPieces(project, room)), ...(input.products ? { catalog: input.products } : {}) });
    }),
  );
  report('done', total, total);
  return { analysis, concept: concept.concept, rooms: results, review, failed: concept.failed, conceptProblems: concept.conceptProblems, calls: concept.calls };
}
