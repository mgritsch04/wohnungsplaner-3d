import type { Furniture } from '../model/schema';

/**
 * Before/after comparison (#76) – furniture differences between two saved states
 * --------------------------------------------------------------------------------
 * Pure function, no store access. Items are matched
 *  1. by their id (a saved state keeps the ids of the project), otherwise
 *  2. by name + category (e.g. an item deleted and placed again from the catalog);
 *     among several candidates the nearest pairs win.
 * A matched item counts as „verschoben/gedreht“ when it moved by at least
 * `MOVE_THRESHOLD_M` (horizontal and height) or turned by at least `ROTATE_THRESHOLD_DEG`;
 * smaller changes are rounding noise and count as „unverändert“.
 * Changes of size, colour or price are not position changes and stay „unverändert“ here
 * (the key-figure table of the versions dialog covers prices and areas).
 */

export const MOVE_THRESHOLD_M = 0.02;
export const ROTATE_THRESHOLD_DEG = 1;

export type DiffStatus = 'added' | 'removed' | 'moved' | 'unchanged';

export interface FurnitureDiffEntry {
  status: DiffStatus;
  /** The item in state A (null when it is new in B). */
  a: Furniture | null;
  /** The item in state B (null when it was removed). */
  b: Furniture | null;
  /** How A and B were paired (null for added/removed). */
  match: 'id' | 'name' | null;
  /** Distance between the positions in metres (0 for added/removed). */
  distance: number;
  /** Absolute rotation difference in degrees, 0 … 180 (0 for added/removed). */
  turn: number;
  moved: boolean;
  rotated: boolean;
}

export interface FurnitureDiff {
  entries: FurnitureDiffEntry[];
  counts: Record<DiffStatus, number>;
}

export interface DiffOptions {
  moveThreshold?: number;
  rotateThresholdDeg?: number;
}

const EPS = 1e-9;

/** Smallest absolute angle between two plan rotations (radians in, degrees out). */
export function rotationDeltaDeg(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs((d * 180) / Math.PI);
}

const distanceOf = (a: Furniture, b: Furniture) => Math.hypot(b.x - a.x, b.y - a.y, (b.elevation ?? 0) - (a.elevation ?? 0));
const nameKey = (f: Furniture) => `${f.category}\u0000${f.name.trim().toLowerCase()}`;

function pairEntry(a: Furniture, b: Furniture, match: 'id' | 'name', moveThreshold: number, rotateThreshold: number): FurnitureDiffEntry {
  const distance = distanceOf(a, b);
  const turn = rotationDeltaDeg(a.rotation ?? 0, b.rotation ?? 0);
  const moved = distance >= moveThreshold - EPS;
  const rotated = turn >= rotateThreshold - EPS;
  return { status: moved || rotated ? 'moved' : 'unchanged', a, b, match, distance, turn, moved, rotated };
}

/** Compare the furniture of state A (before) with state B (after). */
export function diffFurniture(before: readonly Furniture[], after: readonly Furniture[], opts: DiffOptions = {}): FurnitureDiff {
  const moveThreshold = opts.moveThreshold ?? MOVE_THRESHOLD_M;
  const rotateThreshold = opts.rotateThresholdDeg ?? ROTATE_THRESHOLD_DEG;

  // 1. same id
  const aById = new Map(before.map((f) => [f.id, f]));
  const pairedA = new Set<Furniture>();
  const byB = new Map<Furniture, FurnitureDiffEntry>();
  for (const b of after) {
    const a = aById.get(b.id);
    if (a && !pairedA.has(a)) {
      pairedA.add(a);
      byB.set(b, pairEntry(a, b, 'id', moveThreshold, rotateThreshold));
    }
  }

  // 2. same name + category, nearest pairs first
  const restA = before.filter((a) => !pairedA.has(a));
  const restB = after.filter((b) => !byB.has(b));
  const candidates: { a: Furniture; b: Furniture; d: number }[] = [];
  for (const b of restB) for (const a of restA) if (nameKey(a) === nameKey(b)) candidates.push({ a, b, d: distanceOf(a, b) });
  candidates.sort((x, y) => x.d - y.d);
  for (const { a, b } of candidates) {
    if (pairedA.has(a) || byB.has(b)) continue;
    pairedA.add(a);
    byB.set(b, pairEntry(a, b, 'name', moveThreshold, rotateThreshold));
  }

  const entries: FurnitureDiffEntry[] = after.map(
    (b) => byB.get(b) ?? { status: 'added', a: null, b, match: null, distance: 0, turn: 0, moved: false, rotated: false },
  );
  for (const a of before) {
    if (!pairedA.has(a)) entries.push({ status: 'removed', a, b: null, match: null, distance: 0, turn: 0, moved: false, rotated: false });
  }
  const counts: Record<DiffStatus, number> = { added: 0, removed: 0, moved: 0, unchanged: 0 };
  for (const e of entries) counts[e.status]++;
  return { entries, counts };
}

/** Short summary for the legend, e.g. „2 verschoben, 1 neu, 1 entfernt“. */
export function diffSummary(counts: Record<DiffStatus, number>): string {
  const parts = [
    counts.moved && `${counts.moved} verschoben`,
    counts.added && `${counts.added} neu`,
    counts.removed && `${counts.removed} entfernt`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Keine Unterschiede bei den Möbeln';
}
