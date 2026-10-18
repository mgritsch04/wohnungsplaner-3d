/**
 * Field of view in the walkthrough: mouse-wheel zoom (#228) narrows it like binoculars, starting
 * from a base value – the usual wide angle or, with "Echt-Maßstab" (#256), the angle the picture
 * actually covers for the viewer, so rooms and furniture look as large as in reality.
 */
export const WALK_FOV = 70;
export const WALK_FOV_MIN = 20;
/** The wheel zooms in down to this share of the base field of view (70° → 20°). */
const ZOOM_RANGE = WALK_FOV_MIN / WALK_FOV;
/** One wheel notch (deltaY ≈ 100) changes the field of view by this factor. */
const STEP = 1.15;

/** Wheel deltaY in pixels: line or page deltas (Firefox) are scaled to roughly one notch. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
}

/** Field of view after a wheel turn: forward (negative deltaY) zooms in, back zooms out (multiplicative, so it feels even). */
export function nextWalkFov(fov: number, deltaY: number, base = WALK_FOV): number {
  const f = fov * STEP ** (deltaY / 100);
  return Math.max(base * ZOOM_RANGE, Math.min(base, f));
}

/** Look speed factor: zoomed in, the view turns slower, so aiming stays calm. */
export function zoomLookFactor(fov: number, base = WALK_FOV): number {
  return Math.tan(((fov / 2) * Math.PI) / 180) / Math.tan(((base / 2) * Math.PI) / 180);
}

export interface TrueScaleInput {
  /** Screen diagonal in inches. */
  diagonalInch: number;
  /** Distance between the eyes and the screen, metres. */
  distance: number;
  /** Height of the 3D view and of the whole screen, in CSS pixels; screen width for its aspect ratio. */
  viewHeightPx: number;
  screenWidthPx: number;
  screenHeightPx: number;
}

/**
 * Vertical field of view (degrees) at which the 3D view shows the world in its real size (#256):
 * the view's physical height on the screen, seen from the viewing distance. Clamped to 20–70°.
 */
export function trueScaleFov(p: TrueScaleInput): number {
  const aspect = p.screenWidthPx > 0 && p.screenHeightPx > 0 ? p.screenWidthPx / p.screenHeightPx : 16 / 9;
  const screenHeightM = (p.diagonalInch * 0.0254) / Math.sqrt(1 + aspect * aspect);
  const share = p.screenHeightPx > 0 ? Math.min(1, Math.max(0.05, p.viewHeightPx / p.screenHeightPx)) : 1;
  const fov = (2 * Math.atan((screenHeightM * share) / 2 / Math.max(0.1, p.distance)) * 180) / Math.PI;
  return Math.max(WALK_FOV_MIN, Math.min(WALK_FOV, fov));
}
