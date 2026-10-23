/**
 * Points of the walk-through (#436, stage 4): each room starts at 100 and loses points per
 * finding. The solver uses the same weights for its costs, the critique stage stops on them, the
 * tests and the benchmark measure with them.
 */
import type { Finding, RoomReview, Severity } from './types';

export const SEVERITY_POINTS: Readonly<Record<Severity, number>> = { S: 25, M: 8, L: 2 };

/** A room passes with no severe finding and at least this many points. */
export const PASS_SCORE = 85;

/** Acceptance of the whole pipeline: no room of a test flat below this. */
export const MIN_ROOM_SCORE = 75;

export function roomScore(findings: readonly Pick<Finding, 'severity'>[]): number {
  return Math.max(0, 100 - findings.reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0));
}

export const hasSevere = (findings: readonly Pick<Finding, 'severity'>[]): boolean => findings.some((f) => f.severity === 'S');

export const passes = (findings: readonly Pick<Finding, 'severity'>[]): boolean => !hasSevere(findings) && roomScore(findings) >= PASS_SCORE;

/** Mean (one decimal) and lowest score of the rooms; 100 for a flat without rooms. */
export function flatScore(rooms: readonly Pick<RoomReview, 'score'>[]): { score: number; minScore: number } {
  if (!rooms.length) return { score: 100, minScore: 100 };
  const sum = rooms.reduce((s, r) => s + r.score, 0);
  return { score: Math.round((sum / rooms.length) * 10) / 10, minScore: Math.min(...rooms.map((r) => r.score)) };
}
