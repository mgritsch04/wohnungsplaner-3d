import { nextClosed } from '../model/shading';
import type { Shading } from '../model/schema';
import { useProjectStore } from '../store/projectStore';

/** Editing operations for window coverings and curtains (#413); each is one undo step. */

const store = () => useProjectStore.getState();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Set (patch) or remove (null) the covering of a window. A new covering starts open. */
export function setShading(openingId: string, patch: Partial<Shading> | null) {
  if (store().txBase) return;
  store().apply((d) => {
    const o = d.openings.find((x) => x.id === openingId);
    if (!o || o.kind !== 'window') return;
    if (patch === null) delete o.shading;
    else o.shading = { closed: 0, motor: false, type: 'roller', ...o.shading, ...patch };
    if (o.shading) o.shading.closed = clamp01(o.shading.closed);
  });
}

export function setCurtainClosed(furnitureId: string, closed: number) {
  if (store().txBase) return;
  store().apply((d) => {
    const f = d.furniture.find((x) => x.id === furnitureId);
    if (f) f.closed = clamp01(closed);
  });
}

/** Click cycle on a covering in 3D: offen → halb → zu. */
export function cycleShading(openingId: string) {
  const o = store().project.openings.find((x) => x.id === openingId);
  if (o?.shading) setShading(openingId, { closed: nextClosed(o.shading.closed) });
}

export function cycleCurtain(furnitureId: string) {
  const f = store().project.furniture.find((x) => x.id === furnitureId);
  if (f) setCurtainClosed(furnitureId, nextClosed(f.closed ?? 0));
}
