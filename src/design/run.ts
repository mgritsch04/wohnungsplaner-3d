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
import { askChecked, runConcept, TIMEOUTS, type CallLog, type ConceptRunResult } from './concept/run';
import { parseRoomProgram } from './concept/roomProgram';
import { buildComparePrompt, buildVariantPrompt, layoutKey, planFacts, verdictOf, type Verdict } from './choose';
import type { RoomProgramInput } from './concept/roomProgram';
import { buildCritiquePrompt, LOOK_ENOUGH, parseCritique, type CritiqueInput } from './critique';
import { roomPlanSvg, roomTextMap, type RoomPlan } from './render';
import { reviewFlat, reviewRoom, type ReviewInput } from './review';
import { BALANCED } from './review/overallRules';
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
  /**
   * Pictures of the placed room in 3D, as the image review sees it (from the main door, cut at
   * 1.20 m, and from above), for the look before handing over; only where the 3D view runs.
   */
  toRoomShots?: (room: ShotRoom) => Promise<SampleImage[] | undefined>;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (p: DesignRunProgress) => void;
  /** Overrides the time limits (tests). */
  timeouts?: { opus: number; sonnet: number };
}

/** One placed room, for `toRoomShots`. */
export interface ShotRoom {
  analysis: RoomAnalysis;
  type: RoomType;
  layout: Layout;
  program: RoomProgram;
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

/** Room types that get the look before handing over: where a person lives, not where they pass through. */
export const LOOK_TYPES: ReadonlySet<RoomType> = new Set<RoomType>(['living', 'bedroom', 'kitchen', 'dining', 'kids', 'office']);

/**
 * Whether the look's answer replaces a room that already passed: it must still pass, keep nearly
 * all its points (the look trades a few points for a better picture) and place no fewer pieces.
 */
export function lookKeeps(before: RoomResult, after: RoomResult): boolean {
  if (after.layout.items.length * 2 < before.layout.items.length) return false;
  return after.review.passed && after.review.score >= before.review.score - LOOK_TOLERANCE && after.layout.dropped.length <= before.layout.dropped.length;
}

/** Points the look may cost (#443). */
export const LOOK_TOLERANCE = 4;
/**
 * Looks at the picture at most; a further one only while Claude rates its own room below `LOOK_ENOUGH`.
 * One: in the real run of 25.10. a second look kept Claude's own note and did not move the image review (#443).
 */
export const LOOK_ROUNDS = 1;

/** Claude's own mark for the room it looked at (`"note"` in the answer), if it gave one. */
export function lookNote(raw: unknown): number | null {
  const n = (raw as { note?: unknown } | null)?.note;
  return typeof n === 'number' && n >= 1 && n <= 10 ? n : null;
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
  const layout = solveRoom(work.analysis, program, { existing: work.existing, seed, catalog: work.base.products, spread: BALANCED.has(work.type) });
  const review = reviewRoom(work.review(layout, program));
  return { roomId: work.analysis.roomId, program, layout, review, rounds };
}

/**
 * Stage 5 for one room. First, while the walk-through fails, at most `MAX_ROUNDS` rounds: show
 * Claude the placed room and let it change the programme, then place and walk through again,
 * keeping the best round. Then a main room that passes gets the look before handing over (#443):
 * Claude sees the room as the image review does (3D from the door and from above, plus the plan),
 * rates it, and improves the worst points; a second look follows while its own mark stays below
 * `LOOK_ENOUGH`. A look replaces the room only if `lookKeeps`. Any error simply ends the critique:
 * the room keeps what it already has.
 */
async function critique(input: FurnishRunInput, work: RoomWork, first: RoomResult, image: (r: RoomResult) => Promise<SampleImage | undefined>, calls: CallLog[]): Promise<RoomResult> {
  let best = first;
  let rounds = 0;
  const model = input.wishes.quality === 'fast' ? 'sonnet' : 'opus';
  /** One critique call; null when it failed (the critique ends there). */
  const ask = async (from: RoomResult, round: number, look: boolean): Promise<{ result: RoomResult; note: number | null } | null> => {
    const label = `Kritik: ${work.analysis.name} (${look ? (round === 1 ? 'Blick' : `Blick ${round}`) : `Runde ${round}`})`;
    const log: CallLog = { label, model, round, attempts: 1, ms: 0, problems: [] };
    const t0 = Date.now();
    calls.push(log);
    try {
      const img = await image(from);
      const views = look && img && input.toRoomShots ? await input.toRoomShots({ analysis: work.analysis, type: work.type, layout: from.layout, program: from.program }).catch(() => undefined) : undefined;
      // the look is about what the picture shows; without one the rules have said all there is
      if (look && !img) {
        calls.pop();
        return null;
      }
      const ci: CritiqueInput = {
        base: work.base,
        program: from.program,
        layout: from.layout,
        review: from.review,
        round,
        ...(look ? { look } : {}),
        ...(views?.length ? { views: views.length } : {}),
        ...(img ? { image: img } : { textMap: roomTextMap({ analysis: work.analysis, layout: from.layout, program: from.program, existing: asPlaced(work.existing), ...(work.base.products ? { catalog: work.base.products } : {}) }) }),
      };
      const images = img ? [...(views ?? []), img] : [];
      const opts: SampleOptions = { model, modelTier: model === 'opus' ? 'complex' : 'default', label, signal: input.signal, ...(images.length ? { images } : {}) };
      const raw = await withTimeout(input.sample.json(buildCritiquePrompt(ci), opts), (input.timeouts ?? TIMEOUTS)[model], input.signal);
      const checked = parseCritique(raw, ci);
      log.problems = checked.problems;
      rounds++;
      return { result: placeAndReview(work, checked.value, (input.seed ?? 1) + rounds, rounds), note: look ? lookNote(raw) : null };
    } catch (e) {
      log.error = codeOf(e);
      if (isCancel(e)) throw e;
      return null;
    } finally {
      log.ms = Date.now() - t0;
    }
  };
  let current = first;
  for (let round = 1; round <= MAX_ROUNDS && !goodEnough(best); round++) {
    const got = await ask(current, round, false);
    if (!got) return { ...best, rounds };
    current = got.result;
    best = better(best, current);
  }
  if (goodEnough(best) && LOOK_TYPES.has(work.type) && input.wishes.quality !== 'fast') {
    for (let round = 1; round <= LOOK_ROUNDS; round++) {
      const got = await ask(best, round, true);
      if (!got) break;
      // the rules must keep it, and in the pictures it must look better than before (#436)
      if (lookKeeps(best, got.result) && lookWins(await compareRooms(input, work, best, got.result, calls, 'Blick'))) best = got.result;
      // Claude rates the room it looked at, before its changes: good enough means hand it over
      if (got.note !== null && got.note >= LOOK_ENOUGH) break;
    }
  }
  return { ...best, rounds };
}

/** Whether main rooms get a second design to choose from (#436). */
export const VARIANTS = true;

/** The look's change is kept when the pictures show it better, or when there are no pictures to compare (the rules decided). */
export const lookWins = (v: Verdict | null) => v === null || v === 'second';

/**
 * Which of two placed versions of a room looks better: the pair comparison of the image review,
 * in both orders, with the 3D pictures of both. Null when there are no pictures or a request
 * failed (the caller then decides by the rules). Two layouts with every piece in the same place
 * are „same“ without asking.
 */
export async function compareRooms(input: FurnishRunInput, work: RoomWork, a: RoomResult, b: RoomResult, calls: CallLog[], what: string): Promise<Verdict | null> {
  if (layoutKey(a) === layoutKey(b)) return 'same';
  if (!input.toRoomShots || !input.sample.images) return null;
  const shots = async (r: RoomResult) => input.toRoomShots!({ analysis: work.analysis, type: work.type, layout: r.layout, program: r.program }).catch(() => undefined);
  const sa = await shots(a);
  const sb = sa?.length === 2 ? await shots(b) : undefined;
  if (sa?.length !== 2 || sb?.length !== 2) return null;
  const facts: [string, string] = [planFacts(work.analysis, a), planFacts(work.analysis, b)];
  const label = `Vergleich: ${work.analysis.name} (${what})`;
  const log: CallLog = { label, model: 'opus', round: 1, attempts: 0, ms: 0, problems: [] };
  calls.push(log);
  const t0 = Date.now();
  try {
    const one = (f: [string, string], images: SampleImage[]) => {
      log.attempts++;
      return withTimeout(input.sample.json(buildComparePrompt(work.analysis, work.type, f), { model: 'opus', modelTier: 'complex', label, images, signal: input.signal }), (input.timeouts ?? TIMEOUTS).sonnet, input.signal);
    };
    // one after the other: the local helper takes only a few requests at a time
    const ab = await one(facts, [...sa, ...sb]);
    const ba = await one([facts[1], facts[0]], [...sb, ...sa]);
    const v = verdictOf(ab, ba);
    log.note = { first: 'erster besser', second: 'zweiter besser', same: 'gleich gut', split: 'uneinig' }[v];
    return v;
  } catch (e) {
    log.error = codeOf(e);
    if (isCancel(e)) throw e;
    return null;
  } finally {
    log.ms = Date.now() - t0;
  }
}

/**
 * Two designs, one choice (#436): Claude writes a second, fundamentally different programme
 * for a main room, both are placed and walked through, and the better one goes on: passing the
 * walk-through beats failing it, then the pictures decide, and where they cannot, the rules
 * (`better`). Any error keeps the first design.
 */
async function secondDesign(input: FurnishRunInput, work: RoomWork, first: RoomResult, calls: CallLog[]): Promise<RoomResult> {
  let second: RoomResult;
  try {
    // like the first design, the second sees the empty room (stage 2)
    const empty = input.toImage && input.sample.images ? await input.toImage(roomPlanSvg({ analysis: work.analysis, roomNames: Object.fromEntries(input.project.rooms.map((r) => [r.id, r.name])), existing: asPlaced(work.existing) })).catch(() => undefined) : undefined;
    const base: RoomProgramInput = { ...work.base, ...(empty ? { image: true } : {}) };
    const got = await askChecked(input, buildVariantPrompt(base, first.program), (raw) => parseRoomProgram(raw, base), 'opus', `Entwurf 2: ${work.analysis.name}`, calls, empty ? [empty] : undefined);
    second = placeAndReview(work, got.value, input.seed ?? 1, 0);
  } catch (e) {
    if (isCancel(e)) throw e;
    return first;
  }
  const note = (text: string) => {
    const log = [...calls].reverse().find((c) => c.label === `Entwurf 2: ${work.analysis.name}`);
    if (log) log.note = text;
  };
  if (second.layout.items.length * 2 < first.layout.items.length) return note('Entwurf 1 (Entwurf 2 fast leer)'), first;
  if (first.review.passed !== second.review.passed) {
    note(`Entwurf ${first.review.passed ? 1 : 2} (nur er besteht die Begehung)`);
    return first.review.passed ? first : second;
  }
  const v = await compareRooms(input, work, first, second, calls, 'Entwürfe');
  if (v === 'first' || v === 'second') {
    note(`Entwurf ${v === 'first' ? 1 : 2} (Bildvergleich)`);
    return v === 'first' ? first : second;
  }
  const pick = better(first, second);
  note(`Entwurf ${pick === first ? 1 : 2} (Begehung, Bildvergleich ${v ?? 'ohne Ergebnis'})`);
  return pick;
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
    ...(input.toImage && input.sample.images
      ? {
          roomImage: async (id: string) => {
            const room = analysis.rooms.find((r) => r.roomId === id);
            if (!room) return undefined;
            return input.toImage!(roomPlanSvg({ analysis: room, roomNames: Object.fromEntries(project.rooms.map((r) => [r.id, r.name])), existing: asPlaced(existingPieces(project, room)) }));
          },
        }
      : {}),
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
        let first = placeAndReview(work, program, input.seed ?? 1, 0);
        if (VARIANTS && LOOK_TYPES.has(type) && wishes.quality !== 'fast' && input.toRoomShots && input.sample.images) first = await secondDesign(input, work, first, concept.calls);
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
