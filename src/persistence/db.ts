import { createStore, del, get, keys, set } from 'idb-keyval';

/**
 * Local persistence in IndexedDB (no backend required).
 *   projects: project id → serialized project JSON (string)
 *   assets:   asset id   → Blob (floor-plan images, original PDFs, GLB models)
 *   meta:     misc keys (last opened project, project list metadata)
 */
const projectStore = createStore('wohnungsplaner-projects', 'projects');
const assetStore = createStore('wohnungsplaner-assets', 'assets');
const metaStore = createStore('wohnungsplaner-meta', 'meta');

export const db = {
  getProject: (id: string) => get<string>(id, projectStore),
  putProject: (id: string, json: string) => set(id, json, projectStore),
  deleteProject: (id: string) => del(id, projectStore),
  listProjectIds: () => keys(projectStore) as Promise<string[]>,
  getAsset: (id: string) => get<Blob>(id, assetStore),
  putAsset: (id: string, blob: Blob) => set(id, blob, assetStore),
  deleteAsset: (id: string) => del(id, assetStore),
  listAssetIds: () => keys(assetStore) as Promise<string[]>,
  getMeta: <T>(key: string) => get<T>(key, metaStore),
  putMeta: <T>(key: string, value: T) => set(key, value, metaStore),
};
