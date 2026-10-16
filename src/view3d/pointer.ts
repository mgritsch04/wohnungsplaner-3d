/**
 * Click vs. drag discrimination for the 3D view.
 * React Three Fiber reports `delta` = pointer travel (px) between pointerdown and
 * the current event; anything above the threshold is a drag (orbit/move), not a click.
 */
export const CLICK_THRESHOLD_PX = 5;

export function isClick(e: { delta?: number }): boolean {
  return (e.delta ?? 0) <= CLICK_THRESHOLD_PX;
}
