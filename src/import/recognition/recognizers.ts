import type { FloorPlanRecognizer, RecognitionInput } from './types';
import type { RasterOutput } from './raster';
import { detectVectorWalls } from './vector';

/** Max long side for raster analysis (keeps the worker fast and memory bounded). */
const RASTER_MAX_SIDE = 2400;

/** Dark filled areas with at least this much outline (m) may be how the plan draws its walls. */
const MIN_WALL_FILL_OUTLINE = 6;

type CandidateSegment = { x1: number; y1: number; x2: number; y2: number; width?: number; areaFill?: boolean; darkFill?: boolean; faint?: boolean };

type Pt = { x: number; y: number };
const len = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

/**
 * Vector wall detection with the right wall candidates (#114). Edges of light area fills (room
 * colouring) never outline walls. If the plan has dark filled areas – CAD exports often draw
 * walls as solid fills – the outlines of those fills alone are tried first, so tile/parquet
 * hatches, furniture and dimension lines cannot pair up into phantom walls. That result is
 * only used if it looks like a floor plan (≥ 3 walls, ≥ 8 m in total); otherwise the dark
 * fills were symbols or small overview plans, and all lines are used.
 */
export function detectVectorWallsFromPdf(segments: CandidateSegment[], metersPerPixel: number): RasterOutput {
  const fills = segments.filter((s) => s.darkFill);
  if (fills.reduce((sum, s) => sum + len(s.x1, s.y1, s.x2, s.y2), 0) * metersPerPixel >= MIN_WALL_FILL_OUTLINE) {
    const out = detectVectorWalls(fills, metersPerPixel);
    const wallLength = out.walls.reduce((sum, w) => sum + len(w.a.x, w.a.y, w.b.x, w.b.y), 0);
    if (out.walls.length >= 3 && wallLength * metersPerPixel >= 8) return out;
  }
  const lines = segments.filter((s) => !s.areaFill && !s.faint);
  const heavy = new Set(heavyLines(lines));
  return mainPlanOnly(detectVectorWalls(lines, metersPerPixel, { isWallLine: (i) => heavy.has(lines[i]) }), metersPerPixel);
}

function segmentDistance(p: Pt, q: Pt, a: Pt, b: Pt): number {
  const d = (x: Pt, u: Pt, v: Pt) => {
    const dx = v.x - u.x;
    const dy = v.y - u.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x.x - u.x) * dx + (x.y - u.y) * dy) / l2)) : 0;
    return Math.hypot(x.x - u.x - t * dx, x.y - u.y - t * dy);
  };
  return Math.min(d(p, a, b), d(q, a, b), d(a, p, q), d(b, p, q));
}

/**
 * A plan sheet often carries small overview plans (site plan, other floors) besides the floor
 * plan itself. Walls are grouped into connected clusters; only the cluster with the largest total
 * wall length – the floor plan – is kept, with its openings (#114).
 */
export function mainPlanOnly(out: RasterOutput, metersPerPixel: number): RasterOutput {
  const walls = out.walls;
  if (walls.length < 2) return out;
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tol = 0.15 / metersPerPixel;
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++)
      if (segmentDistance(walls[i].a, walls[i].b, walls[j].a, walls[j].b) <= (walls[i].thickness + walls[j].thickness) / 2 + tol) parent[find(i)] = find(j);
  const length = new Map<number, number>();
  walls.forEach((w, i) => length.set(find(i), (length.get(find(i)) ?? 0) + len(w.a.x, w.a.y, w.b.x, w.b.y)));
  const main = [...length.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const kept = walls.filter((_, i) => find(i) === main);
  const near = (o: RasterOutput['openings'][number]) => kept.some((w) => segmentDistance(o.center, o.center, w.a, w.b) <= w.thickness / 2 + tol);
  return { ...out, walls: kept, openings: out.openings.filter(near) };
}

/**
 * Drafting convention: cut walls are drawn with the heaviest pens, furniture, hatches, tiles and
 * dimensions with thin ones. If the plan uses clearly different stroke widths, only strokes
 * heavier than the most common width are kept (fill outlines, width 0, are kept as well).
 * Plans drawn with one pen keep all lines.
 */
export function heavyLines<T extends CandidateSegment>(segments: T[]): T[] {
  const widths = segments.map((s) => s.width ?? 0).filter((w) => w > 0);
  if (!widths.length) return segments;
  const count = new Map<number, number>();
  for (const w of widths) count.set(Math.round(w * 10) / 10, (count.get(Math.round(w * 10) / 10) ?? 0) + 1);
  const common = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const heavy = segments.filter((s) => !s.width || s.width > common * 1.2);
  return heavy.filter((s) => s.width).length >= 4 ? heavy : segments;
}

export const vectorRecognizer: FloorPlanRecognizer = {
  id: 'local-vector',
  label: 'PDF-Vektordaten (lokal)',
  local: true,
  canHandle: (i) => (i.vectorSegments?.length ?? 0) >= 4,
  recognize: async (i, onProgress) => {
    onProgress(0.3);
    const out = detectVectorWallsFromPdf(i.vectorSegments ?? [], i.metersPerPixel);
    onProgress(1);
    return out;
  },
};

export const rasterRecognizer: FloorPlanRecognizer = {
  id: 'local-raster',
  label: 'Bildanalyse (lokal)',
  local: true,
  canHandle: () => true,
  recognize: async (i: RecognitionInput, onProgress) => {
    const bitmap = await createImageBitmap(i.image);
    const f = Math.min(1, RASTER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * f));
    const h = Math.max(1, Math.round(bitmap.height * f));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let p = 0, q = 0; p < gray.length; p++, q += 4) gray[p] = (data[q] * 0.299 + data[q + 1] * 0.587 + data[q + 2] * 0.114) | 0;
    onProgress(0.1);
    const worker = new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' });
    try {
      const out = await new Promise<RasterOutput>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type === 'progress') onProgress(0.1 + e.data.value * 0.85);
          else if (e.data.type === 'result') resolve(e.data.value);
          else if (e.data.type === 'error') reject(new Error(e.data.message));
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ width: w, height: h, gray, metersPerPixel: i.metersPerPixel / f }, [gray.buffer]);
      });
      // scale back to underlay pixel coordinates
      const s = 1 / f;
      return {
        threshold: out.threshold,
        walls: out.walls.map((x) => ({ ...x, a: { x: x.a.x * s, y: x.a.y * s }, b: { x: x.b.x * s, y: x.b.y * s }, thickness: x.thickness * s })),
        openings: out.openings.map((o) => ({ ...o, center: { x: o.center.x * s, y: o.center.y * s }, width: o.width * s })),
      };
    } finally {
      worker.terminate();
    }
  },
};

/** Ordered list of available recognizers; the first that can handle the input is used. */
export const RECOGNIZERS: FloorPlanRecognizer[] = [vectorRecognizer, rasterRecognizer];
