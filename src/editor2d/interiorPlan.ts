import { BOARD, columnWidth } from '../model/interior';
import type { Furniture } from '../model/schema';

/** Shapes in the local, centred frame of the item (local +y = front). */
export type PlanDetail =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  | { type: 'rect'; x: number; y: number; w: number; h: number; dashed?: boolean };

/** How far a drawer is drawn pulled out in the open plan view (m). */
export const PLAN_PULL = 0.3;

/**
 * Top view of a cabinet shown open (#85): dividers between the columns, the clothes rods as
 * lines and the drawers pulled out in front of the cabinet (dashed, as for door swings).
 */
export function interiorPlanDetails(f: Pick<Furniture, 'width' | 'depth' | 'height' | 'interior'>): PlanDetail[] {
  const interior = f.interior;
  if (!interior) return [];
  const w = f.width;
  const d = f.depth;
  const n = interior.columns;
  const cw = columnWidth(f, n);
  const x0 = (c: number) => -w / 2 + BOARD + c * (cw + BOARD);
  const out: PlanDetail[] = [];
  for (let c = 1; c < n; c++) out.push({ type: 'line', x1: x0(c) - BOARD / 2, y1: -d / 2, x2: x0(c) - BOARD / 2, y2: d / 2 });
  const pull = Math.min(PLAN_PULL, d * 0.5);
  for (let c = 0; c < n; c++) {
    const inCol = interior.parts.filter((p) => p.column === c);
    if (inCol.some((p) => p.kind === 'rod')) out.push({ type: 'line', x1: x0(c) + 0.02, y1: 0, x2: x0(c) + cw - 0.02, y2: 0 });
    if (inCol.some((p) => p.kind === 'drawer')) out.push({ type: 'rect', x: x0(c) + 0.01, y: d / 2, w: cw - 0.02, h: pull, dashed: true });
  }
  return out;
}
