import { CATALOG_FORMAT, parseCatalogJsonWithModels } from './catalogFormat';
import { attachModelFiles, storeAsset } from './catalogImport';
import { useCatalogStore } from './catalogStore';
import { fetchHelperModel, fetchHelperProduct } from './providers/ikeaHelper';
import { formatArticle, parseArticleList } from './providers/ikeaList';
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
  name?: string;
  withModel?: boolean;
  message?: string;
}

export interface IkeaFetchDeps {
  fetchProduct: typeof fetchHelperProduct;
  fetchModel: typeof fetchHelperModel;
  store: (blob: Blob) => Promise<string>;
  check?: Parameters<typeof attachModelFiles>[4];
  addItems: (items: CatalogItem[]) => Promise<number>;
}

const defaultDeps: IkeaFetchDeps = {
  fetchProduct: fetchHelperProduct,
  fetchModel: fetchHelperModel,
  store: storeAsset,
  addItems: (items) => useCatalogStore.getState().addItems(items),
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
      const hp = await deps.fetchProduct(a, { model: opts.model });
      if (!hp.entry) {
        outcomes.push({ article, ok: false, message: hp.reason ?? 'keine Produktdaten' });
        continue;
      }
      const list = JSON.stringify({ format: CATALOG_FORMAT, version: 1, name: IKEA_SELECTION_SOURCE, units: 'cm', items: [hp.entry] });
      const { items, modelFiles } = parseCatalogJsonWithModels(list, IKEA_SELECTION_SOURCE);
      let result = items;
      let warning: string | undefined;
      const wanted = items[0] && modelFiles.get(items[0].id);
      if (opts.model && wanted) {
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
      outcomes.push({ article, ok: true, name: result[0].name, withModel: result[0].model.type === 'gltf', message: warning ?? hp.note });
    } catch (e) {
      outcomes.push({ article, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  opts.onProgress?.(articles.length, articles.length, '');
  return { outcomes, skipped: all.length - articles.length };
}
