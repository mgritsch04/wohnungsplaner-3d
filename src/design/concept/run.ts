/**
 * Stages 1 and 2 together: one flat concept, then the room programmes (a few at a time), each
 * answer checked and, when the check finds problems, repaired once. Every request has a time
 * limit and is asked again once after a timeout or an unreadable answer. The result keeps what
 * is still wrong after the repair (the later stages and the critique work with it) and which
 * rooms failed, so nothing is dropped silently.
 */
import type { CatalogItem } from '../../catalog/types';
import type { DesignWishes } from '../../assistant/design';
import type { Sample, SampleError, SampleImage, SampleOptions } from '../../assistant/claude';
import { runPool } from '../../assistant/pool';
import type { Project } from '../../model/schema';
import type { FlatAnalysis, FlatConcept, RoomProgram } from '../types';
import type { Checked } from './common';
import { buildFlatConceptPrompt, parseFlatConcept, repairPrompt, roomConceptOf, type FlatConceptInput } from './flatConcept';
import { buildRoomProgramPrompt, parseRoomProgram, programModel, type RoomProgramInput } from './roomProgram';

/** Room programmes asked at the same time (the local helper allows 4). */
export const CONCEPT_PARALLEL = 3;

/** Time limits per request (ms): Opus took 1–3 minutes per room in the trial, once 10; in the benchmark (#443) a Wohnküche and a Garçonnière took longer than 12. */
export const TIMEOUTS = { opus: 20 * 60_000, sonnet: 5 * 60_000 } as const;

export interface ConceptRunInput {
  sample: Pick<Sample, 'json'>;
  project: Project;
  analysis: FlatAnalysis;
  /** Text forms of stage 0: overview of the flat and the sketch of one room. */
  flatSketch: string;
  roomSketch: (roomId: string) => string;
  /** Picture of the empty room (walls, openings, what stays) for stage 2; none when the model cannot see. */
  roomImage?: (roomId: string) => Promise<SampleImage | undefined>;
  wishes: DesignWishes;
  products?: CatalogItem[];
  /** Rooms to plan (default: all rooms of the analysis). */
  roomIds?: string[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Overrides the time limits (tests). */
  timeouts?: { opus: number; sonnet: number };
}

export interface CallLog {
  label: string;
  model: 'opus' | 'sonnet';
  /** 1 = first answer, 2 = repair. */
  round: number;
  attempts: number;
  ms: number;
  problems: string[];
  error?: string;
}

export interface RoomOutcome {
  roomId: string;
  model: 'opus' | 'sonnet';
  /** Problems still open after the repair round (empty = valid programme). */
  problems: string[];
  notes: string[];
  repaired: boolean;
}

export interface ConceptRunResult {
  concept: FlatConcept | null;
  conceptProblems: string[];
  conceptNotes: string[];
  programs: RoomProgram[];
  rooms: RoomOutcome[];
  /** Requests that gave nothing usable: room id (null = the flat concept) and why. */
  failed: { roomId: string | null; reason: string }[];
  calls: CallLog[];
}

/** Errors after which asking again does not help (permission, quota, the user stopped it). */
const STOP_CODES = ['cancelled', 'not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'rate_limited', 'session_expired', 'refused', 'prompt_too_large'];

const codeOf = (e: unknown) => (e as SampleError | undefined)?.code ?? 'upstream_error';
const messageOf = (e: unknown) => {
  const err = e as SampleError | undefined;
  return `${codeOf(e)}${err?.message ? `: ${err.message}` : ''}`;
};

/** One request with a time limit, asked again once unless the error is final. */
async function ask(sample: Pick<Sample, 'json'>, prompt: string, opts: SampleOptions, timeoutMs: number, outer?: AbortSignal): Promise<{ answer: unknown; attempts: number }> {
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (outer?.aborted) throw { code: 'cancelled' } satisfies SampleError;
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    outer?.addEventListener('abort', stop);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject({ code: 'timeout', message: `keine Antwort nach ${Math.round(timeoutMs / 1000)} s` } satisfies SampleError);
        }, timeoutMs);
      });
      const answer = await Promise.race([sample.json<unknown>(prompt, { ...opts, signal: ctrl.signal }), timeout]);
      return { answer, attempts: attempt };
    } catch (e) {
      last = outer?.aborted ? { code: 'cancelled' } : e;
      if (STOP_CODES.includes(codeOf(last))) throw last;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', stop);
    }
  }
  throw last;
}

/** Asks, checks, and repairs once when the check finds problems; keeps the better of the two answers. */
async function askChecked<T>(
  run: Pick<ConceptRunInput, 'sample' | 'signal' | 'timeouts'>,
  prompt: string,
  parse: (raw: unknown) => Checked<T>,
  model: 'opus' | 'sonnet',
  label: string,
  calls: CallLog[],
  images?: SampleImage[],
): Promise<Checked<T> & { repaired: boolean }> {
  const opts: SampleOptions = { model, modelTier: model === 'opus' ? 'complex' : 'default', label, ...(images?.length ? { images } : {}) };
  const timeoutMs = (run.timeouts ?? TIMEOUTS)[model];
  const call = async (p: string, round: number) => {
    const t0 = Date.now();
    const log: CallLog = { label, model, round, attempts: 0, ms: 0, problems: [] };
    calls.push(log);
    try {
      const { answer, attempts } = await ask(run.sample, p, opts, timeoutMs, run.signal);
      log.attempts = attempts;
      const checked = parse(answer);
      log.problems = checked.problems;
      return { answer, checked };
    } catch (e) {
      log.error = messageOf(e);
      throw e;
    } finally {
      log.ms = Date.now() - t0;
    }
  };
  const first = await call(prompt, 1);
  if (!first.checked.problems.length) return { ...first.checked, repaired: false };
  let second: Awaited<ReturnType<typeof call>> | null = null;
  try {
    second = await call(repairPrompt(prompt, first.answer, first.checked.problems), 2);
  } catch (e) {
    if (codeOf(e) === 'cancelled') throw e;
  }
  return second && second.checked.problems.length <= first.checked.problems.length ? { ...second.checked, repaired: true } : { ...first.checked, repaired: false };
}

/** Stage 1 and 2 for a flat. Throws only when the user cancels; everything else ends up in the result. */
export async function runConcept(input: ConceptRunInput): Promise<ConceptRunResult> {
  const calls: CallLog[] = [];
  const failed: ConceptRunResult['failed'] = [];
  const roomIds = input.roomIds ?? input.analysis.rooms.map((r) => r.roomId);
  const total = roomIds.length + 1;
  let done = 0;
  input.onProgress?.(0, total);
  const flatInput: FlatConceptInput = { project: input.project, analysis: input.analysis, sketch: input.flatSketch, wishes: input.wishes };
  const model = input.wishes.quality === 'fast' ? 'sonnet' : 'opus';
  let concept: (Checked<FlatConcept> & { repaired: boolean }) | null = null;
  try {
    concept = await askChecked(input, buildFlatConceptPrompt(flatInput), (raw) => parseFlatConcept(raw, flatInput), model, 'Wohnkonzept', calls);
  } catch (e) {
    if (codeOf(e) === 'cancelled') throw e;
    failed.push({ roomId: null, reason: messageOf(e) });
  }
  input.onProgress?.(++done, total);
  const result: ConceptRunResult = { concept: concept?.value ?? null, conceptProblems: concept?.problems ?? [], conceptNotes: concept?.notes ?? [], programs: [], rooms: [], failed, calls };
  if (!concept) return result;

  let stopped: unknown = null;
  await runPool(
    roomIds,
    CONCEPT_PARALLEL,
    async (roomId) => {
      const room = input.analysis.rooms.find((r) => r.roomId === roomId);
      if (!room) return;
      const image = await input.roomImage?.(roomId).catch(() => undefined);
      const roomInput: RoomProgramInput = { project: input.project, concept: concept.value, room, sketch: input.roomSketch(roomId), wishes: input.wishes, products: input.products, ...(image ? { image: true } : {}) };
      const m = programModel(roomConceptOf(concept.value, room), room, input.wishes.quality);
      try {
        const r = await askChecked(input, buildRoomProgramPrompt(roomInput), (raw) => parseRoomProgram(raw, roomInput), m, room.name, calls, image ? [image] : undefined);
        result.programs.push(r.value);
        result.rooms.push({ roomId, model: m, problems: r.problems, notes: r.notes, repaired: r.repaired });
      } catch (e) {
        if (codeOf(e) === 'cancelled') stopped = e;
        failed.push({ roomId, reason: messageOf(e) });
      } finally {
        input.onProgress?.(++done, total);
      }
    },
    () => stopped !== null || !!input.signal?.aborted,
  );
  if (stopped) throw stopped;
  // keep the room order of the flat
  const order = (id: string) => roomIds.indexOf(id);
  result.programs.sort((a, b) => order(a.roomId) - order(b.roomId));
  result.rooms.sort((a, b) => order(a.roomId) - order(b.roomId));
  return result;
}
