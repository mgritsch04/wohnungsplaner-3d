import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { formatLength } from '../model/units';
import type { Bounds } from '../model/vec';
import { PlanDrawing } from '../editor2d/PlanDrawing';
import { PX_PER_MM, scaleBarLength } from './planExport';

export const SHEET_PAD = 16;
const PAD = SHEET_PAD;
const HEADER = 46;
export const SHEET_FOOTER = 40;
const FOOTER = SHEET_FOOTER;

interface Props {
  project: Project;
  derived: DerivedPlan;
  /** Plan extent in metres (already padded). */
  bounds: Bounds;
  /** CSS pixels per metre. */
  pxPerM: number;
  /** Title and date inside the image (PNG); the print view shows them as HTML instead. */
  header?: { title: string; date: string };
  /** e.g. 100 → "Maßstab 1:100" (only meaningful when printed at its physical size) */
  scaleDenominator?: number;
  /** Render at physical size (mm) instead of CSS px. */
  physical?: boolean;
}

export function planSheetSize(bounds: Bounds, pxPerM: number, withHeader: boolean) {
  const planW = (bounds.maxX - bounds.minX) * pxPerM;
  const planH = (bounds.maxY - bounds.minY) * pxPerM;
  return { width: Math.max(planW, 240) + 2 * PAD, height: planH + (withHeader ? HEADER : PAD) + FOOTER, planW, planH };
}

/**
 * Static plan for export/print: the same drawing as the 2D editor (PlanDrawing) without
 * selection, hover, grid or underlay, plus scale bar (and optionally title and date).
 * The scale bar is computed from the same px-per-metre as the drawing, so it stays correct
 * however the whole sheet is scaled afterwards.
 */
export function PlanSheet({ project, derived, bounds, pxPerM, header, scaleDenominator, physical }: Props) {
  const { width, height, planW, planH } = planSheetSize(bounds, pxPerM, !!header);
  const top = header ? HEADER : PAD;
  const left = PAD + (width - 2 * PAD - planW) / 2;
  const bar = scaleBarLength(bounds.maxX - bounds.minX);
  const barPx = bar * pxPerM;
  const fy = top + planH + 14;
  const ticks = [0, 0.5, 1];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={physical ? `${width / PX_PER_MM}mm` : width}
      height={physical ? `${height / PX_PER_MM}mm` : height}
      fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      data-testid="plan-sheet"
    >
      <rect width={width} height={height} fill="#ffffff" />
      {header && (
        <g>
          <text x={PAD} y={24} fontSize={18} fontWeight={700} fill="#111827">
            {header.title}
          </text>
          <text x={width - PAD} y={24} fontSize={12} textAnchor="end" fill="#4b5563">
            {header.date}
          </text>
        </g>
      )}
      <g transform={`translate(${left - bounds.minX * pxPerM} ${top - bounds.minY * pxPerM}) scale(${pxPerM})`}>
        <PlanDrawing project={project} derived={derived} selection={null} hover={null} zoom={pxPerM} showDimensions />
      </g>
      <g data-testid="scale-bar" data-length-m={bar} data-length-px={barPx}>
        <rect x={PAD} y={fy} width={barPx / 2} height={6} fill="#111827" />
        <rect x={PAD + barPx / 2} y={fy} width={barPx / 2} height={6} fill="#ffffff" stroke="#111827" strokeWidth={1} />
        <rect x={PAD} y={fy} width={barPx} height={6} fill="none" stroke="#111827" strokeWidth={1} />
        {ticks.map((t) => (
          <text key={t} x={PAD + t * barPx} y={fy + 18} fontSize={10} textAnchor="middle" fill="#111827">
            {t === 0 ? '0' : formatLength(bar * t)}
          </text>
        ))}
        {scaleDenominator && (
          <text x={width - PAD} y={fy + 10} fontSize={11} textAnchor="end" fill="#111827">
            Maßstab 1:{scaleDenominator} (A4)
          </text>
        )}
      </g>
    </svg>
  );
}
