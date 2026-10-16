import type { Plane, Vector3 } from 'three';

/**
 * Click vs. drag discrimination for the 3D view.
 * React Three Fiber reports `delta` = pointer travel (px) between pointerdown and
 * the current event; anything above the threshold is a drag (orbit/move), not a click.
 */
export const CLICK_THRESHOLD_PX = 5;

export function isClick(e: { delta?: number }): boolean {
  return (e.delta ?? 0) <= CLICK_THRESHOLD_PX;
}

interface HitEvent {
  point: Vector3;
  stopPropagation: () => void;
}

/** Section planes currently cutting the view (set by the scene); used to ignore invisible hits. */
let pickClipping: Plane[] = [];
export function setPickClipping(planes: Plane[]) {
  pickClipping = planes;
}

/**
 * Raycasting ignores clipping planes. A hit on a part that the section cut has
 * removed is invisible to the user and must not be picked – the event then
 * continues to the object behind it.
 */
export function isClippedHit(e: Pick<HitEvent, 'point'>): boolean {
  return pickClipping.some((pl) => pl.distanceToPoint(e.point) < 0);
}

/** Visible solid geometry (walls…) blocks pointer events for objects behind it. */
export function blockBehind(e: HitEvent) {
  if (!isClippedHit(e)) e.stopPropagation();
}
