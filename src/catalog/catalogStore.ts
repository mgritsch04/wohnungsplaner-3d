import { create } from 'zustand';
import { db } from '../persistence/db';
import type { CatalogItem } from './types';

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
    const items = (await db.getMeta<CatalogItem[]>(KEY).catch(() => undefined)) ?? [];
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
