import { useMemo } from 'react';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useSimStore } from './simStore';
import { BAND_COLOR, levelOf, LEVEL_COLOR, LEVEL_ORDER, recommendBands, wifiGrid, type WifiGrid, type WifiLevel } from './wifi';

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
  const rec = useSimStore((s) => s.wifiRec);
  const recRooms = useMemo(() => {
    if (!on || !rec) return null;
    const derived = derivePlan(project);
    return recommendBands(project, derived).map((r) => ({ ...r, poly: derived.rooms.get(r.roomId)?.interior ?? [] }));
  }, [on, rec, project]);
  const paths = useMemo(() => {
    if (!on || rec) return null;
    const g = wifiGrid(project, derivePlan(project), band);
    return g && levelPaths(g);
  }, [on, rec, band, project]);
  if (recRooms)
    return (
      <g data-testid="wifi-rec-overlay" pointerEvents="none">
        {recRooms.map((r) => (
          <path key={r.roomId} d={`M${r.poly.map((p) => `${p.x} ${p.y}`).join('L')}z`} fill={BAND_COLOR[r.band]} fillOpacity={0.4} data-band={r.band} />
        ))}
      </g>
    );
  if (!paths) return null;
  return (
    <g data-testid="wifi-overlay" pointerEvents="none">
      {LEVEL_ORDER.map((l) => (
        <path key={l} d={paths[l]} fill={LEVEL_COLOR[l]} fillOpacity={0.38} data-level={l} />
      ))}
    </g>
  );
}
