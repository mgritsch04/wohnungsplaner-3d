import { useMemo } from 'react';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useSimStore } from './simStore';
import { levelOf, LEVEL_COLOR, LEVEL_ORDER, wifiGrid, type WifiGrid, type WifiLevel } from './wifi';

/** One path per level: horizontal runs of equal level are merged to keep the SVG small. */
export function levelPaths(grid: WifiGrid): Record<WifiLevel, string> {
  const out: Record<WifiLevel, string> = { good: '', medium: '', weak: '', none: '' };
  const { cols, rows, cell, minX, minY, dbm } = grid;
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      const v = dbm[j * cols + i];
      if (Number.isNaN(v)) {
        i++;
        continue;
      }
      const lvl = levelOf(v);
      let k = i + 1;
      while (k < cols && !Number.isNaN(dbm[j * cols + k]) && levelOf(dbm[j * cols + k]) === lvl) k++;
      out[lvl] += `M${minX + i * cell} ${minY + j * cell}h${(k - i) * cell}v${cell}h${-(k - i) * cell}z`;
      i = k;
    }
  }
  return out;
}

/** Estimated WLAN signal as a colour layer over the rooms of the 2D plan (#253). */
export function WifiOverlay2D({ project }: { project: Project }) {
  const on = useSimStore((s) => s.wifiOn);
  const band = useSimStore((s) => s.wifiBand);
  const paths = useMemo(() => {
    if (!on) return null;
    const g = wifiGrid(project, derivePlan(project), band);
    return g && levelPaths(g);
  }, [on, band, project]);
  if (!paths) return null;
  return (
    <g data-testid="wifi-overlay" pointerEvents="none">
      {LEVEL_ORDER.map((l) => (
        <path key={l} d={paths[l]} fill={LEVEL_COLOR[l]} fillOpacity={0.38} data-level={l} />
      ))}
    </g>
  );
}
