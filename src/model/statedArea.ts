import type { Room } from './schema';

export interface StatedAreaSummary {
  /** Sum of the areas the source plan states (m²), only rooms that have one. */
  stated: number;
  /** Sum of the computed net areas of exactly these rooms (m²). */
  computed: number;
  /** computed − stated (m²). */
  diff: number;
  /** Rooms with a stated area / all rooms. */
  withStated: number;
}

/**
 * Compares the stated areas of an imported plan with the computed (net, inside the wall surfaces) areas of the same rooms.
 * Null when no room carries a stated area. The totals are over the SAME rooms, so the difference is not caused by rooms
 * without a stated area (hall, niches).
 */
export function statedAreaSummary(rooms: Room[], geometry: Map<string, { area: number }>): StatedAreaSummary | null {
  let stated = 0;
  let computed = 0;
  let n = 0;
  for (const r of rooms) {
    const g = geometry.get(r.id);
    if (r.statedArea === undefined || !g) continue;
    stated += r.statedArea;
    computed += g.area;
    n++;
  }
  if (!n) return null;
  return { stated, computed, diff: computed - stated, withStated: n };
}
