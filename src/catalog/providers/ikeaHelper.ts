/**
 * Client for the local IKEA helper (`npm run ikea-helper`, scripts/ikea-helper.mjs).
 * The browser cannot read IKEA pages itself (no public API; IKEA blocks other origins),
 * so the helper running on the user's computer fetches ONE public product page per
 * article number the user pasted – nothing is searched and nothing is guessed.
 */
import type { ArticleRef } from './ikeaList';
import { formatArticle } from './ikeaList';

export const IKEA_HELPER_URL = 'http://127.0.0.1:4791';

/** What the helper returns for one article. `entry` is a product list entry in cm. */
export interface HelperProduct {
  article: string;
  entry: unknown;
  model: string | null;
  reason?: string;
  note?: string;
  cached?: boolean;
}

type Fetch = typeof fetch;

/** True when the helper answers on this computer. */
export async function helperAvailable(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await f(`${base}/status`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown; name?: unknown };
    return body.ok === true && body.name === 'wohnungsplaner-ikea-helper';
  } catch {
    return false;
  }
}

export async function fetchHelperProduct(a: ArticleRef, opts: { model: boolean; refresh?: boolean }, base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<HelperProduct> {
  const q = new URLSearchParams({ article: formatArticle(a) });
  if (opts.model) q.set('model', '1');
  if (opts.refresh) q.set('refresh', '1');
  let res: Response;
  try {
    res = await f(`${base}/product?${q}`);
  } catch {
    throw new Error('Der IKEA-Helfer antwortet nicht. Läuft „npm run ikea-helper“ noch?');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<HelperProduct> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `IKEA-Helfer: HTTP ${res.status}`);
  return {
    article: typeof body.article === 'string' ? body.article : formatArticle(a),
    entry: body.entry ?? null,
    model: typeof body.model === 'string' && /^s?\d{8}\.glb$/.test(body.model) ? body.model : null,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    cached: body.cached === true,
  };
}

/** The cached 3D model as a File (name = the entry's modelFile). */
export async function fetchHelperModel(file: string, base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<File> {
  const res = await f(`${base}/model/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`3D-Modell ${file}: HTTP ${res.status}`);
  return new File([await res.blob()], file, { type: 'model/gltf-binary' });
}
