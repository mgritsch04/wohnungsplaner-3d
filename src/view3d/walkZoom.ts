/** Mouse-wheel zoom in the walkthrough (#228): narrows the field of view like binoculars. */
export const WALK_FOV = 70;
export const WALK_FOV_MIN = 20;
/** One wheel notch (deltaY ≈ 100) changes the field of view by this factor. */
const STEP = 1.15;

/** Wheel deltaY in pixels: line or page deltas (Firefox) are scaled to roughly one notch. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
}

/** Field of view after a wheel turn: forward (negative deltaY) zooms in, back zooms out (multiplicative, so it feels even). */
export function nextWalkFov(fov: number, deltaY: number): number {
  const f = fov * STEP ** (deltaY / 100);
  return Math.max(WALK_FOV_MIN, Math.min(WALK_FOV, f));
}

/** Look speed factor: at strong zoom the view turns slower, so aiming stays calm. */
export function zoomLookFactor(fov: number): number {
  return Math.tan(((fov / 2) * Math.PI) / 180) / Math.tan(((WALK_FOV / 2) * Math.PI) / 180);
}
