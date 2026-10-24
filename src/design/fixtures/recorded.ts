/**
 * Claude's unchanged answers for the test flats. A and B: the first „Konzept zuerst“ trial
 * (23.10.2026, Opus, prototype prompt). C–F: a run with the prompts of ../concept/ (Opus for
 * main rooms, Sonnet for small ones), per request the valid answer after at most one repair.
 * Each run holds the flat concept and one room programme per room, keyed by room name. They are
 * the realistic input for the parser of stage 1 and 2 (including its repairs: a few relations
 * lie outside the vocabulary) and, once parsed, for the solver and the walk-through.
 *
 * Format of the prototype: room coordinates in cm from the room's north-west corner, facing as
 * N/O/S/W, relations as [a, relation, b, value?]. The parser turns this into the types in
 * ../types.ts.
 */
import recordedA from './recorded/A.json';
import recordedB from './recorded/B.json';
import recordedC from './recorded/C.json';
import recordedD from './recorded/D.json';
import recordedE from './recorded/E.json';
import recordedF from './recorded/F.json';
import type { FlatKey } from './flats';

export interface RawConcept {
  living: string;
  style: { idea: string; materials: string[]; palette: { name: string; hex: string }[] };
  /** `wishes`: numbers of the wishes a function meets (prompts of concept/, from C on). */
  functions: { function: string; room: string; why: string; wishes?: (number | string)[] }[];
  /** `anchor` in the first trial, `anchors` with the prompts of concept/. */
  rooms: { room: string; type: string; role: string; functions: string[]; anchor?: string; anchors?: string[]; accent?: string; avoid: string[] }[];
}

export interface RawKitchen {
  wall: string;
  from: number[];
  to: number[];
  modules: string[];
}

export interface RawProgram {
  reading: string;
  zones: { id: string; function: string; rect: number[]; why: string; userZone?: string }[];
  items: { id: string; catalogId: string; zone: string; x: number; y: number; facing: string; label?: string; color?: string; why: string; anchor?: boolean; fallbacks?: string[] }[];
  relations: (string | number)[][];
  /** One run in the first trial, a list of runs (L-shaped kitchen) with the prompts of concept/. */
  kitchen?: RawKitchen | RawKitchen[];
  walk: string;
  check: string[];
}

export interface RecordedRun {
  source: string;
  concept: RawConcept;
  /** By room name. */
  programs: Record<string, RawProgram>;
}

/** A and B: first trial (prototype prompt). C–F: the prompts of concept/, the valid answer per request. */
export const RECORDED: Partial<Record<FlatKey, RecordedRun>> = { A: recordedA, B: recordedB, C: recordedC, D: recordedD, E: recordedE, F: recordedF };
