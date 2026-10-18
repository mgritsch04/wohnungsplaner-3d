import { CATALOG_FORMAT, parseCatalogJsonWithModels } from './catalogFormat';
import { attachModelFiles, storeAsset } from './catalogImport';
import { useCatalogStore } from './catalogStore';
import { useIkeaDrafts, type PendingDraft } from './ikeaDrafts';
import { checkModelBlob } from './providers/modelFetch';
import { suggestUnit } from '../import/gltf';
import { ackInbox, fetchHelperModel, fetchHelperProduct, fetchInbox, type HelperProduct } from './providers/ikeaHelper';
import { completeDraft, formatArticle, parseArticleList, type DimKey } from './providers/ikeaList';
import type { CatalogItem } from './types';

/** Catalog source name of products fetched through the IKEA section. */
export const IKEA_SELECTION_SOURCE = 'IKEA-Auswahl';
/** Upper bound per run – the helper fetches one page every 1.5 s. */
export const IKEA_SELECTION_MAX = 25;

/** Products shown under „Meine IKEA-Auswahl“ (fetched here or imported from an ikea-import folder). */
export const isIkeaItem = (i: CatalogItem) => i.sourceName === IKEA_SELECTION_SOURCE || i.retailer === 'IKEA Österreich';

export interface IkeaFetchOutcome {
  article: string;
  ok: boolean;
  /** catalog id of the added product */
  id?: string;
  name?: string;
  withModel?: boolean;
  /** dimensions missing on the page: waits under „Maße fehlen“ (#269) */
  pending?: boolean;
  message?: string;
}

export interface IkeaFetchDeps {
  fetchProduct: typeof fetchHelperProduct;
  fetchModel: typeof fetchHelperModel;
  store: (blob: Blob) => Promise<string>;
  check?: Parameters<typeof attachModelFiles>[4];
  addItems: (items: CatalogItem[]) => Promise<number>;
  /** keeps a product whose dimensions are missing until the user enters them */
  addDraft?: (d: PendingDraft) => void;
}

const defaultDeps: IkeaFetchDeps = {
  fetchProduct: fetchHelperProduct,
  fetchModel: fetchHelperModel,
  store: storeAsset,
  addItems: (items) => useCatalogStore.getState().addItems(items),
  addDraft: (d) => useIkeaDrafts.getState().add(d),
};

/**
 * Fetch the IKEA articles found in `text` (article numbers or ikea.com links) through the
 * local helper and add them to the catalog, with their 3D model when wanted and available.
 * Each article is reported separately; one failure does not stop the others.
 */
export async function addIkeaArticles(
  text: string,
  opts: { model: boolean; onProgress?: (done: number, total: number, current: string) => void },
  deps: IkeaFetchDeps = defaultDeps,
): Promise<{ outcomes: IkeaFetchOutcome[]; skipped: number }> {
  const all = parseArticleList(text);
  const articles = all.slice(0, IKEA_SELECTION_MAX);
  const outcomes: IkeaFetchOutcome[] = [];
  for (const [n, a] of articles.entries()) {
    const article = formatArticle(a);
    opts.onProgress?.(n, articles.length, article);
    try {
      outcomes.push(await addHelperProduct(await deps.fetchProduct(a, { model: opts.model }), opts.model, deps));
    } catch (e) {
      outcomes.push({ article, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  opts.onProgress?.(articles.length, articles.length, '');
  return { outcomes, skipped: all.length - articles.length };
}

/**
 * Take one product the helper delivered (fetched by article number, or sent by the bookmarklet)
 * into the catalog: validated with the catalog schema, with its 3D model when wanted and available.
 */
export async function addHelperProduct(hp: HelperProduct, withModel: boolean, deps: IkeaFetchDeps = defaultDeps): Promise<IkeaFetchOutcome> {
  const article = hp.article;
  if (!hp.entry && hp.draft) {
    deps.addDraft?.({ article, draft: hp.draft, model: hp.model, receivedAt: new Date().toISOString() });
    return { article, ok: false, pending: true, name: hp.draft.name, message: 'Maße fehlen auf der Seite – bitte unter „Maße fehlen“ eintragen.' };
  }
  if (!hp.entry) return { article, ok: false, message: hp.reason ?? 'keine Produktdaten' };
  try {
    const list = JSON.stringify({ format: CATALOG_FORMAT, version: 1, name: IKEA_SELECTION_SOURCE, units: 'cm', items: [hp.entry] });
    const { items, modelFiles } = parseCatalogJsonWithModels(list, IKEA_SELECTION_SOURCE);
    let result = items;
    let warning: string | undefined;
    const wanted = items[0] && modelFiles.get(items[0].id);
    if (withModel && wanted) {
      try {
        const file = await deps.fetchModel(wanted);
        const res = await attachModelFiles(items, modelFiles, [file], deps.store, deps.check);
        result = res.items;
        warning = res.warnings[0];
      } catch (e) {
        warning = `3D-Modell nicht geladen (${e instanceof Error ? e.message : String(e)}) – Näherungsmodell verwendet.`;
      }
    }
    await deps.addItems(result);
    return { article, ok: true, id: result[0].id, name: result[0].name, withModel: result[0].model.type === 'gltf', message: warning ?? hp.note };
  } catch (e) {
    return { article, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Take over what the bookmarklet sent (#221). Items are acknowledged at the helper once handled,
 * also when they were invalid, so nothing is offered twice.
 */
export async function takeInbox(
  deps: IkeaFetchDeps & { fetchInbox: typeof fetchInbox; ackInbox: typeof ackInbox } = { ...defaultDeps, fetchInbox, ackInbox },
): Promise<IkeaFetchOutcome[]> {
  const items = await deps.fetchInbox();
  const outcomes: IkeaFetchOutcome[] = [];
  for (const i of items) outcomes.push(await addHelperProduct(i.product, true, deps));
  await deps.ackInbox(items.map((i) => i.id));
  return outcomes;
}

/**
 * Take over a product from „Maße fehlen“ (#269) with the dimensions the user entered (cm).
 * The draft stays when something is still missing or the catalog rejects it.
 */
export async function completePending(
  p: PendingDraft,
  dims: Partial<Record<DimKey, number | null>>,
  deps: IkeaFetchDeps & { removeDraft: (article: string) => void } = { ...defaultDeps, removeDraft: (a) => useIkeaDrafts.getState().remove(a) },
): Promise<IkeaFetchOutcome> {
  const entry = completeDraft(p.draft, dims);
  if (!entry) return { article: p.article, ok: false, name: p.draft.name, message: 'Bitte Breite, Tiefe und Höhe eintragen (in cm, größer als 0).' };
  const outcome = await addHelperProduct({ article: p.article, entry, model: p.model }, !!p.model, deps);
  if (outcome.ok) deps.removeDraft(p.article);
  return outcome;
}

/**
 * Approximate size (cm) of the IKEA 3D model the helper already cached for this product –
 * no further download. Plants: the leaves count, not only the pot.
 */
export async function estimateFromModel(
  file: string,
  deps: Pick<IkeaFetchDeps, 'fetchModel' | 'check'> = defaultDeps,
): Promise<Record<DimKey, number>> {
  const { info } = await (deps.check ?? checkModelBlob)(await deps.fetchModel(file));
  const k = suggestUnit(info.size).factor * 100;
  const cm = (v: number) => Math.max(1, Math.round(v * k));
  // glTF: X = width, Y = height, Z = depth
  return { width: cm(info.size.x), depth: cm(info.size.z), height: cm(info.size.y) };
}
