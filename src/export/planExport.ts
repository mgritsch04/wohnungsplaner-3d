import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { add, boundsOf, rotate, type Bounds, type Vec2 } from '../model/vec';
import { safeFileName } from '../ui/fileUtils';

/** CSS pixels per millimetre (CSS defines 96 px per inch). */
export const PX_PER_MM = 96 / 25.4;

export type PageOrientation = 'portrait' | 'landscape';

/** A4 in millimetres. */
export const A4 = { width: 210, height: 297 } as const;
/** Printable margin on every side (mm), also used in `@page`. */
export const PAGE_MARGIN_MM = 10;

/** Extent of everything drawn in the plan (walls, rooms, furniture, lights), in metres. */
export function planBounds(project: Project, derived: DerivedPlan): Bounds | null {
  const points: Vec2[] = [];
  for (const fp of derived.footprints.values()) points.push(...fp.polygon);
  for (const g of derived.rooms.values()) points.push(...g.interior);
  for (const f of project.furniture) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) points.push(add({ x: f.x, y: f.y }, rotate({ x: (sx * f.width) / 2, y: (sy * f.depth) / 2 }, f.rotation)));
  }
  for (const l of project.lights) points.push({ x: l.x, y: l.y });
  return boundsOf(points);
}

/** Grow bounds by `m` metres on every side. */
export function padBounds(b: Bounds, m: number): Bounds {
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

const BAR_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];

/** Length (m) of a "round" scale bar that takes up at most ~a quarter of the plan width. */
export function scaleBarLength(planWidthM: number): number {
  const target = Math.max(planWidthM, 0) / 4;
  let best = BAR_STEPS[0];
  for (const s of BAR_STEPS) if (s <= target) best = s;
  return best;
}

/** Usual architectural scales (1 : n). */
export const STANDARD_SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500, 1000, 2000];

export interface PrintFit {
  /** Plan scale 1 : denominator on paper. */
  denominator: number;
  /** Size of the drawn plan on paper (mm). */
  widthMm: number;
  heightMm: number;
  /** CSS pixels per metre at that scale – the `zoom` for the plan drawing. */
  pxPerM: number;
}

/** Largest standard scale at which the plan fits into a box of `boxWmm × boxHmm`. */
export function fitPlanToBox(b: Bounds, boxWmm: number, boxHmm: number): PrintFit {
  const w = Math.max(b.maxX - b.minX, 0.01);
  const h = Math.max(b.maxY - b.minY, 0.01);
  const denominator = STANDARD_SCALES.find((n) => (w * 1000) / n <= boxWmm && (h * 1000) / n <= boxHmm) ?? Math.ceil(Math.max((w * 1000) / boxWmm, (h * 1000) / boxHmm));
  const mmPerM = 1000 / denominator;
  return { denominator, widthMm: w * mmPerM, heightMm: h * mmPerM, pxPerM: mmPerM * PX_PER_MM };
}

/** Box (mm) left for the plan on one A4 page; the rest holds title and parts list. */
export function planBoxOnA4(orientation: PageOrientation): { widthMm: number; heightMm: number } {
  const pageW = orientation === 'portrait' ? A4.width : A4.height;
  const pageH = orientation === 'portrait' ? A4.height : A4.width;
  const innerW = pageW - 2 * PAGE_MARGIN_MM;
  const innerH = pageH - 2 * PAGE_MARGIN_MM;
  const header = 16;
  // portrait: plan above the list; landscape: plan left, list in a 95 mm column on the right
  return orientation === 'portrait' ? { widthMm: innerW, heightMm: (innerH - header) * 0.62 } : { widthMm: innerW - 95 - 6, heightMm: innerH - header };
}

/** Date as YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function planFileName(projectName: string, date: Date, ext: 'png' | 'pdf'): string {
  return `${safeFileName(projectName)}-grundriss-${isoDate(date)}.${ext}`;
}
