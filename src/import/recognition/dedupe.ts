import type { Vec2 } from '../../model/vec';

interface OpeningLike {
  center: Vec2;
  width: number;
  kind: 'door' | 'window' | 'passage';
  confidence: number;
  swingSide?: Vec2;
}

/** Two openings whose centres are closer than this share of their mean width overlap (#373). */
const OVERLAP = 0.7;

/**
 * Recognisers can report the same door twice (gap in the wall plus swing arc, extra pass for
 * oblique walls). Overlapping openings are merged: the one with the higher confidence stays,
 * a door symbol (swing side) beats a bare gap at equal confidence. Returns the number removed.
 */
export function dedupeOpenings<T extends OpeningLike>(openings: T[]): { openings: T[]; removed: number } {
  const order = [...openings].sort((a, b) => b.confidence - a.confidence || Number(!!b.swingSide) - Number(!!a.swingSide));
  const kept: T[] = [];
  for (const o of order) {
    const twin = kept.some((k) => Math.hypot(k.center.x - o.center.x, k.center.y - o.center.y) < (OVERLAP * (k.width + o.width)) / 2);
    if (!twin) kept.push(o);
  }
  const keepSet = new Set(kept);
  return { openings: openings.filter((o) => keepSet.has(o)), removed: openings.length - kept.length };
}
