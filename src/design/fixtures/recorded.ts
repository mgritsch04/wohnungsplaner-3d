/**
 * Claude's unchanged answers from the first „Konzept zuerst“ trial (23.10.2026, Opus) for test
 * flats A and B: the flat concept and one room programme per room, keyed by room name. They are
 * the realistic input for the parser of stage 1 and 2 (including its repairs: a few relations
 * lie outside the vocabulary) and, once parsed, for the solver and the walk-through.
 *
 * Format of the prototype: room coordinates in cm from the room's north-west corner, facing as
 * N/O/S/W, relations as [a, relation, b, value?]. The parser turns this into the types in
 * ../types.ts.
 */
import recordedA from './recorded/A.json';
import recordedB from './recorded/B.json';
import type { FlatKey } from './flats';

export interface RawConcept {
  living: string;
  style: { idea: string; materials: string[]; palette: { name: string; hex: string }[] };
  functions: { function: string; room: string; why: string }[];
  rooms: { room: string; type: string; role: string; functions: string[]; anchor: string; accent?: string; avoid: string[] }[];
}

export interface RawProgram {
  reading: string;
  zones: { id: string; function: string; rect: number[]; why: string }[];
  items: { id: string; catalogId: string; zone: string; x: number; y: number; facing: string; label?: string; color?: string; why: string }[];
  relations: (string | number)[][];
  kitchen?: { wall: string; from: number[]; to: number[]; modules: string[] };
  walk: string;
  check: string[];
}

export interface RecordedRun {
  source: string;
  concept: RawConcept;
  /** By room name. */
  programs: Record<string, RawProgram>;
}

export const RECORDED: Partial<Record<FlatKey, RecordedRun>> = { A: recordedA, B: recordedB };
