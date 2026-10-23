import { useMemo } from 'react';
import { derivePlan } from '../model/derived';
import { computeLux, LUX_STEPS, stepOf, type LuxGrid } from '../model/lux';
import type { Project } from '../model/schema';
import { useLuxStore } from '../ui/luxStore';

/** One path per colour step: horizontal runs of equal step are merged to keep the SVG small. */
export function luxPaths(grid: LuxGrid): string[] {
  const out = LUX_STEPS.map(() => '');
  const { cols, rows, cell, minX, minY, lux } = grid;
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      const v = lux[j * cols + i];
      if (Number.isNaN(v)) {
        i++;
        continue;
      }
      const s = stepOf(v);
      let k = i + 1;
      while (k < cols && !Number.isNaN(lux[j * cols + k]) && stepOf(lux[j * cols + k]) === s) k++;
      out[s] += `M${minX + i * cell} ${minY + j * cell}h${(k - i) * cell}v${cell}h${-(k - i) * cell}z`;
      i = k;
    }
  }
  return out;
}

/** Estimated illuminance as a colour layer over the rooms of the 2D plan, with a warning mark on too dark work surfaces (#360). */
export function LuxOverlay2D({ project, px }: { project: Project; px: number }) {
  const on = useLuxStore((s) => s.on);
  const mode = useLuxStore((s) => s.mode);
  const result = useMemo(() => (on ? computeLux(project, derivePlan(project), mode) : null), [on, mode, project]);
  const paths = useMemo(() => (result?.grid ? luxPaths(result.grid) : null), [result]);
  if (!result || !paths) return null;
  const r = 11 * px;
  return (
    <g data-testid="lux-overlay" pointerEvents="none">
      {LUX_STEPS.map((s, i) => (
        <path key={s.min} d={paths[i]} fill={s.color} fillOpacity={0.42} data-step={i} />
      ))}
      {result.surfaces
        .filter((s) => s.status !== 'ok')
        .map((s) => (
          <g key={s.id} data-testid="lux-warning" data-status={s.status} transform={`translate(${s.at.x} ${s.at.y})`}>
            <circle r={r} fill={s.status === 'dark' ? '#dc2626' : '#d97706'} stroke="#fff" strokeWidth={1.5 * px} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={14 * px} fontWeight={700} fill="#fff">
              !
            </text>
          </g>
        ))}
    </g>
  );
}
