import type { FloorPlanRecognizer, RecognitionInput } from './types';
import type { RasterOutput } from './raster';
import { detectVectorWalls } from './vector';

/** Max long side for raster analysis (keeps the worker fast and memory bounded). */
const RASTER_MAX_SIDE = 2400;

export const vectorRecognizer: FloorPlanRecognizer = {
  id: 'local-vector',
  label: 'PDF-Vektordaten (lokal)',
  local: true,
  canHandle: (i) => (i.vectorSegments?.length ?? 0) > 20,
  recognize: async (i, onProgress) => {
    onProgress(0.3);
    const out = detectVectorWalls(i.vectorSegments ?? [], i.metersPerPixel);
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
