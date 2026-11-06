import { useMemo } from 'react';
import { derivePlan, type DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useSimStore } from './simStore';
import { accessPoints, BAND_COLOR, BANDS, levelOf, LEVEL_COLOR, LEVEL_ORDER, recommendBands, wifiGrid, type WifiBand, type WifiGrid, type WifiLevel } from './wifi';
import { buildNet, LOSS_COLOR, LOSS_ORDER, lossLevel, RATE_COLOR, RATE_ORDER, rateGrid, rateLevel, type HeatBand } from './wifiPlan';

interface CellGrid {
  cols: number;
  rows: number;
  cell: number;
  minX: number;
  minY: number;
}

/** One path per class: horizontal runs of equal class are merged to keep the SVG small. */
export function cellPaths<K extends string>(grid: CellGrid, values: ArrayLike<number>, classify: (v: number) => K): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  const { cols, rows, cell, minX, minY } = grid;
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      const v = values[j * cols + i];
      if (Number.isNaN(v)) {
        i++;
        continue;
      }
      const c = classify(v);
      let k = i + 1;
      while (k < cols && !Number.isNaN(values[j * cols + k]) && classify(values[j * cols + k]) === c) k++;
      out[c] = (out[c] ?? '') + `M${minX + i * cell} ${minY + j * cell}h${(k - i) * cell}v${cell}h${-(k - i) * cell}z`;
      i = k;
    }
  }
  return out;
}

/** One path per signal level (kept for the tests and other callers). */
export function levelPaths(grid: WifiGrid): Record<WifiLevel, string> {
  const p = cellPaths(grid, grid.dbm, levelOf);
  return { good: p.good ?? '', medium: p.medium ?? '', weak: p.weak ?? '', none: p.none ?? '' };
}

/** Signal grid of one band, or the strongest band per cell. */
export function signalGrid(project: Project, derived: DerivedPlan, band: HeatBand): WifiGrid | null {
  if (band !== 'best') return wifiGrid(project, derived, band);
  const bands = BANDS.filter((b) => accessPoints(project).some((a) => a.bands.includes(b)));
  const grids = bands.map((b) => wifiGrid(project, derived, b as WifiBand)).filter((g): g is WifiGrid => !!g);
  if (!grids.length) return null;
  const dbm = new Float32Array(grids[0].dbm.length);
  for (let k = 0; k < dbm.length; k++) dbm[k] = Math.max(...grids.map((g) => g.dbm[k]));
  return { ...grids[0], dbm };
}

/** Estimated WLAN as a colour layer over the rooms of the 2D plan (#253, #492): signal, data rate or neighbour interference. */
export function WifiOverlay2D({ project }: { project: Project }) {
  const on = useSimStore((s) => s.wifiOn);
  const band = useSimStore((s) => s.wifiBand);
  const rec = useSimStore((s) => s.wifiRec);
  const mode = useSimStore((s) => s.wifiMode);
  const recRooms = useMemo(() => {
    if (!on || !rec) return null;
    const derived = derivePlan(project);
    return recommendBands(project, derived).map((r) => ({ ...r, poly: derived.rooms.get(r.roomId)?.interior ?? [] }));
  }, [on, rec, project]);
  const layer = useMemo(() => {
    if (!on || rec) return null;
    const derived = derivePlan(project);
    if (mode === 'signal') {
      const g = signalGrid(project, derived, band);
      return g && { testId: 'wifi-overlay', order: LEVEL_ORDER as string[], color: LEVEL_COLOR as Record<string, string>, paths: cellPaths(g, g.dbm, levelOf) as Record<string, string> };
    }
    const g = rateGrid(buildNet(project, derived), band, mode === 'interference');
    if (!g) return null;
    return mode === 'rate'
      ? { testId: 'wifi-overlay', order: RATE_ORDER as string[], color: RATE_COLOR as Record<string, string>, paths: cellPaths(g, g.mbps, rateLevel) as Record<string, string> }
      : { testId: 'wifi-overlay', order: LOSS_ORDER as string[], color: LOSS_COLOR as Record<string, string>, paths: cellPaths(g, g.loss, lossLevel) as Record<string, string> };
  }, [on, rec, band, mode, project]);
  if (recRooms)
    return (
      <g data-testid="wifi-rec-overlay" pointerEvents="none">
        {recRooms.map((r) => (
          <path key={r.roomId} d={`M${r.poly.map((p) => `${p.x} ${p.y}`).join('L')}z`} fill={BAND_COLOR[r.band]} fillOpacity={0.4} data-band={r.band} />
        ))}
      </g>
    );
  if (!layer) return null;
  return (
    <g data-testid={layer.testId} data-mode={mode} pointerEvents="none">
      {layer.order.map((l) => layer.paths[l] && <path key={l} d={layer.paths[l]} fill={layer.color[l]} fillOpacity={0.4} data-level={l} />)}
    </g>
  );
}
