import { create } from 'zustand';
import { db } from '../persistence/db';
import { normalizeShapeDims } from './shapeDims';
import type { CatalogItem } from './types';

/** Repairs flat items stored with mixed-up axes (curtain length as depth …). */
export function normalizeItem(i: CatalogItem): CatalogItem {
  if (i.model.type !== 'procedural') return i;
  const d = normalizeShapeDims(i.model.shape, i);
  return d.width === i.width && d.depth === i.depth && d.height === i.height ? i : { ...i, ...d };
}

const KEY = 'importedCatalog';

interface CatalogStore {
  items: CatalogItem[];
  loaded: boolean;
  load: () => Promise<void>;
  addItems: (items: CatalogItem[]) => Promise<number>;
  removeSource: (sourceName: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

/** User-imported catalog entries, persisted locally (IndexedDB). */
export const useCatalogStore = create<CatalogStore>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    const items = ((await db.getMeta<CatalogItem[]>(KEY).catch(() => undefined)) ?? []).map(normalizeItem);
    set({ items, loaded: true });
  },
  addItems: async (items) => {
    const byId = new Map(get().items.map((i) => [i.id, i]));
    for (const i of items) byId.set(i.id, i);
    const next = [...byId.values()];
    set({ items: next });
    await db.putMeta(KEY, next);
    return items.length;
  },
  removeSource: async (sourceName) => {
    const next = get().items.filter((i) => i.sourceName !== sourceName);
    set({ items: next });
    await db.putMeta(KEY, next);
  },
  removeItem: async (id) => {
    const next = get().items.filter((i) => i.id !== id);
    set({ items: next });
    await db.putMeta(KEY, next);
  },
}));
