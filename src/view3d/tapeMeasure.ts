/**
 * 3D tape measure (#88) – pure helpers. Points are three.js world coordinates in
 * metres (X/Z = plan, Y = height). Values are rounded to whole centimetres.
 */
export type V3 = [number, number, number];

export interface TapeReading {
  /** Straight distance (m, cm-rounded). */
  length: number;
  /** Distance projected onto the floor (m). */
  horizontal: number;
  /** Height difference (m, always ≥ 0). */
  vertical: number;
}

const cm = (m: number) => Math.round(m * 100) / 100;

export function measureBetween(a: V3, b: V3): TapeReading {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return { length: cm(Math.hypot(dx, dy, dz)), horizontal: cm(Math.hypot(dx, dz)), vertical: cm(Math.abs(dy)) };
}

/** "2,35 m" */
export const formatTape = (m: number) => `${m.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
