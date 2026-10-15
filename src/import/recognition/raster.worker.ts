/// <reference lib="webworker" />
import { detectRasterWalls, type RasterInput } from './raster';

self.onmessage = (e: MessageEvent<RasterInput>) => {
  try {
    const out = detectRasterWalls(e.data, (p) => self.postMessage({ type: 'progress', value: p }));
    self.postMessage({ type: 'result', value: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
