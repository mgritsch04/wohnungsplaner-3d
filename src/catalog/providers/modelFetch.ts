import { inspectModel, ModelFileError, sniffModelFile, type ModelInfo } from '../../import/gltf';

export type ModelFetchError = 'cors-or-network' | 'http' | 'timeout' | 'invalid';

export interface FetchedModel {
  blob: Blob;
  info: ModelInfo;
}

/**
 * Try to fetch a retailer model URL directly from the browser. This only works
 * if the server allows cross-origin requests (CORS) – the app never tries to
 * work around that. Callers fall back to "download in the browser, then pick the file".
 */
export async function fetchModel(url: string, timeoutMs = 15000): Promise<{ ok: true; model: FetchedModel } | { ok: false; error: ModelFetchError; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { ok: false, error: 'http', detail: `HTTP ${res.status}` };
    const blob = await res.blob();
    return { ok: true, model: await checkModelBlob(blob) };
  } catch (e) {
    if (e instanceof ModelFileError) return { ok: false, error: 'invalid', detail: e.message };
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, error: 'timeout', detail: `keine Antwort nach ${timeoutMs / 1000} s` };
    return { ok: false, error: 'cors-or-network', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkModelBlob(blob: Blob): Promise<FetchedModel> {
  await sniffModelFile(blob);
  const info = await inspectModel(await blob.arrayBuffer());
  return { blob, info };
}

export interface DimensionCheck {
  axis: 'width' | 'depth' | 'height';
  productCm: number;
  modelCm: number;
  deviation: number;
}

/**
 * Compare model bounding box (glTF: X = width, Y = height, Z = depth, meters)
 * with the product's stated dimensions. Also reports the best match if the
 * model is rotated by 90° around the vertical axis.
 */
export function compareDimensions(size: { x: number; y: number; z: number }, product: { width: number; depth: number; height: number }): { checks: DimensionCheck[]; rotated: boolean; maxDeviation: number } {
  const build = (w: number, d: number): DimensionCheck[] => [
    { axis: 'width', productCm: product.width, modelCm: w * 100, deviation: (w * 100 - product.width) / product.width },
    { axis: 'depth', productCm: product.depth, modelCm: d * 100, deviation: (d * 100 - product.depth) / product.depth },
    { axis: 'height', productCm: product.height, modelCm: size.y * 100, deviation: (size.y * 100 - product.height) / product.height },
  ];
  const straight = build(size.x, size.z);
  const turned = build(size.z, size.x);
  const max = (c: DimensionCheck[]) => Math.max(...c.map((x) => Math.abs(x.deviation)));
  const rotated = max(turned) + 1e-9 < max(straight);
  const checks = rotated ? turned : straight;
  return { checks, rotated, maxDeviation: max(checks) };
}
