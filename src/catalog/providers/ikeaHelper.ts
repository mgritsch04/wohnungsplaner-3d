/**
 * Client for the local IKEA helper (`npm run ikea-helper`, scripts/ikea-helper.mjs).
 * The browser cannot read IKEA pages itself (no public API; IKEA blocks other origins),
 * so the helper running on the user's computer fetches ONE public product page per
 * article number the user pasted – nothing is searched and nothing is guessed.
 */
import type { ArticleRef, DraftEntry } from './ikeaList';
import { TableBaseSchema, type TableBase } from '../../model/schema';
import { DIM_KEYS, formatArticle } from './ikeaList';

export const IKEA_HELPER_URL = 'http://127.0.0.1:4791';

/** What the helper returns for one article. `entry` is a product list entry in cm. */
export interface HelperProduct {
  article: string;
  entry: unknown;
  model: string | null;
  /** product photo cached by the helper for a page without 3D model (#273) */
  image?: string;
  /** what the page states when dimensions are missing (#269); the user fills in the rest */
  draft?: DraftEntry;
  reason?: string;
  note?: string;
  cached?: boolean;
}

/** A draft sent by the helper (or kept in the browser), reduced to known fields; the catalog schema checks it again on completion. */
export function readDraft(v: unknown): DraftEntry | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as Record<string, unknown>;
  const str = (k: string, max = 2000) => (typeof d[k] === 'string' && (d[k] as string).length <= max ? (d[k] as string) : undefined);
  const pos = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k]) && (d[k] as number) > 0 ? (d[k] as number) : null);
  const name = str('name', 200);
  if (!name) return undefined;
  const dims = { width: pos('width'), depth: pos('depth'), height: pos('height') };
  const modelFile = str('modelFile', 200);
  const hex = (k: string) => (typeof d[k] === 'string' && /^#[0-9a-f]{6}$/i.test(d[k] as string) ? { [k]: d[k] as string } : {});
  const size = (k: string) => (pos(k) !== null ? { [k]: pos(k) as number } : {});
  const base = typeof d.base === 'string' && TableBaseSchema.safeParse(d.base).success ? { base: d.base as TableBase } : {};
  return {
    id: str('id', 100),
    name,
    category: str('category', 40) ?? 'decor',
    shape: str('shape', 40),
    ...dims,
    missing: DIM_KEYS.filter((k) => dims[k] === null),
    price: typeof d.price === 'number' && Number.isFinite(d.price) && d.price >= 0 ? d.price : undefined,
    priceDate: str('priceDate', 40),
    brand: str('brand', 100),
    retailer: str('retailer', 100),
    productUrl: str('productUrl'),
    imageUrl: str('imageUrl'),
    articleNumber: str('articleNumber', 60),
    modelFile: modelFile && /^s?\d{8}\.glb$/i.test(modelFile) ? modelFile : undefined,
    // build details from the page text (#273)
    ...hex('color'),
    ...hex('secondaryColor'),
    ...base,
    ...size('topThickness'),
    ...size('legSize'),
    ...size('seatHeight'),
  };
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
    draft: readDraft(body.draft),
    model: typeof body.model === 'string' && /^s?\d{8}\.glb$/.test(body.model) ? body.model : null,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    cached: body.cached === true,
  };
}

const IMAGE_FILE = /^(?:s?\d{8}|mx[0-9a-f]{10})\.(?:jpg|png|webp)$/;
export const helperImageName = (v: unknown) => (typeof v === 'string' && IMAGE_FILE.test(v) ? v : undefined);

/** A product photo the helper cached for a sent page (#273). */
export async function fetchHelperImage(file: string, base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<Blob> {
  const res = await f(`${base}/image/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`Produktfoto ${file}: HTTP ${res.status}`);
  return res.blob();
}

/** The cached 3D model as a File (name = the entry's modelFile). */
export async function fetchHelperModel(file: string, base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<File> {
  const res = await f(`${base}/model/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`3D-Modell ${file}: HTTP ${res.status}`);
  return new File([await res.blob()], file, { type: 'model/gltf-binary' });
}

/** Secret of the bookmarklet (#221), created by the helper on this computer; only the local planer may read it. */
export async function fetchBookmarkletToken(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<string | null> {
  try {
    const res = await f(`${base}/bookmarklet`);
    const body = (await res.json()) as { token?: unknown };
    return res.ok && typeof body.token === 'string' && /^[0-9a-f]{16,128}$/.test(body.token) ? body.token : null;
  } catch {
    return null;
  }
}

export interface InboxItem {
  id: string;
  receivedAt: string;
  product: HelperProduct;
}

/** Products the bookmarklet sent to the helper and the planner has not taken over yet. */
export async function fetchInbox(base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<InboxItem[]> {
  const res = await f(`${base}/inbox`);
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { items?: unknown };
  if (!Array.isArray(body.items)) return [];
  return body.items
    .filter((i): i is { id: string; receivedAt?: unknown; product: Record<string, unknown> } => !!i && typeof i.id === 'string' && !!i.product && typeof i.product === 'object')
    .map((i) => ({
      id: i.id,
      receivedAt: typeof i.receivedAt === 'string' ? i.receivedAt : '',
      product: {
        article: typeof i.product.article === 'string' ? i.product.article : i.id,
        entry: i.product.entry ?? null,
        draft: readDraft(i.product.draft),
        model: typeof i.product.model === 'string' && /^s?\d{8}\.glb$/.test(i.product.model) ? i.product.model : null,
        image: helperImageName(i.product.image),
        note: typeof i.product.note === 'string' ? i.product.note : undefined,
      },
    }));
}

export async function ackInbox(ids: string[], base = IKEA_HELPER_URL, f: Fetch = fetch): Promise<void> {
  if (!ids.length) return;
  await f(`${base}/inbox/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
}
