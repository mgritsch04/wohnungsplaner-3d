/**
 * Units & coordinate system
 * -------------------------
 * All architectural dimensions are stored in METERS.
 *
 * Plan coordinates (2D, stored in the model):
 *   x → right (east), y → down on screen (south). Origin is arbitrary.
 *   Rotations are in RADIANS; positive rotation turns +x towards +y,
 *   i.e. clockwise as seen on screen in the 2D plan.
 *
 * World coordinates (3D, Three.js):
 *   X = plan x, Z = plan y, Y = vertical height (up). Floor at Y = 0.
 *   A plan rotation r maps to Three.js `rotation.y = -r`.
 */

export const CM = 0.01;
export const MM = 0.001;

export function metersToCm(m: number): number {
  return m * 100;
}

export function cmToMeters(cm: number): number {
  return cm / 100;
}

/** Round to the nearest millimetre to avoid floating point noise in stored data. */
export function roundMm(m: number): number {
  return Math.round(m * 1000) / 1000;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalise an angle to (-PI, PI]. */
export function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Format a length in meters for display, e.g. "3,45 m" or "12 cm". */
export function formatLength(m: number, digits = 2): string {
  if (Math.abs(m) < 1) return `${(m * 100).toLocaleString('de-AT', { maximumFractionDigits: 1 })} cm`;
  return `${m.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits })} m`;
}

export function formatArea(m2: number): string {
  return `${m2.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

export function formatEuro(amount: number): string {
  return amount.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

/** Plan point → Three.js world position (meters). */
export function planToWorld(x: number, y: number, height = 0): [number, number, number] {
  return [x, height, y];
}

/** Plan rotation (radians, clockwise on screen) → Three.js Y rotation. */
export function planRotationToWorldY(r: number): number {
  return -r;
}
